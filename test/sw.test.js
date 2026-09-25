// Pruebas del service worker de la app (src/sw.js), ejecutado con node:vm con la red, la caché, el reloj y
// las ventanas simulados: con cobertura, siempre la página de la red; sin ella (o si tarda o falla), la
// última copia buena, marcada; nada más pasa por él salvo las fuentes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODIGO = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8');
const ALCANCE = 'https://ejemplo.github.io/cal/';
const HTML = { 'content-type': 'text/html; charset=utf-8' };

// Respuesta como las de fetch() dentro del service worker (type 'basic', 'cors', 'opaqueredirect'...).
function resp(cuerpo, { status = 200, type = 'basic', headers = HTML, redirected = false } = {}) {
  return {
    status, ok: status >= 200 && status < 300, type, redirected, headers: new Headers(headers),
    clone() { return resp(cuerpo, { status, type, headers, redirected }); },
    async text() { return cuerpo; },
  };
}

// Promesa que se resuelve o se rechaza desde fuera (una red lenta).
function pendiente() {
  let resolver, rechazar;
  const promesa = new Promise((si, no) => { resolver = si; rechazar = no; });
  return { promesa, resolver, rechazar };
}

// Monta el service worker. red(url, opciones): lo que contesta la red (una promesa); por defecto, sin red.
function montar({ red = () => Promise.reject(new TypeError('Failed to fetch')), cachesPrevias = {} } = {}) {
  const oyentes = {};
  const almacen = new Map(Object.entries(cachesPrevias).map(([n, entradas]) => [n, new Map(Object.entries(entradas))]));
  const pedidas = [];
  const mensajes = [];
  const relojes = [];
  const tiempos = [];
  // Lo que llega desde el vm (otro «realm»), como datos simples para compararlo.
  const plano = (x) => JSON.parse(JSON.stringify(x));
  const caches = {
    async open(nombre) {
      if (!almacen.has(nombre)) almacen.set(nombre, new Map());
      const m = almacen.get(nombre);
      const clave = (k) => (typeof k === 'string' ? k : k.url);
      return {
        async match(k) { const r = m.get(clave(k)); return r ? r.clone() : undefined; },
        async put(k, r) { m.set(clave(k), r); },
      };
    },
    async keys() { return [...almacen.keys()]; },
    async delete(nombre) { return almacen.delete(nombre); },
  };
  const self = {
    registration: { scope: ALCANCE, navigationPreload: { async disable() {} } },
    addEventListener(tipo, fn) { oyentes[tipo] = fn; },
    skipWaiting() {},
    clients: { async claim() {}, async matchAll() { return [{ postMessage: (m) => mensajes.push(plano(m)) }]; } },
  };
  const contexto = {
    self, caches, Response, URL, Headers, AbortController,
    fetch: (pet, opciones) => { const url = typeof pet === 'string' ? pet : pet.url; pedidas.push({ url, opciones: plano(opciones ?? null) }); return red(url, opciones); },
    // Los relojes (los 4 s, los cortes): las pruebas deciden cuándo salta cada uno.
    setTimeout: (fn, ms, arg) => { relojes.push(() => fn(arg)); tiempos.push(ms); return relojes.length; },
    clearTimeout() {},
  };
  vm.createContext(contexto);
  vm.runInContext(CODIGO, contexto);
  return { self, oyentes, almacen, pedidas, mensajes, relojes, tiempos, guardada: (n) => almacen.get(n) };
}

// Lanza un fetch en el service worker. Devuelve { atendida, respuesta (promesa), fin (todas las esperas) }.
function pedir(sw, url, { modo = 'navigate', metodo = 'GET' } = {}) {
  let respuesta = null;
  const esperas = [];
  const evento = {
    request: { url, mode: modo, method: metodo },
    respondWith(p) { respuesta = Promise.resolve(p); esperas.push(respuesta.catch(() => {})); },
    waitUntil(p) { esperas.push(p); },
  };
  sw.oyentes.fetch(evento);
  // Las esperas pueden añadirse después (waitUntil dentro de respondWith): se espera hasta que no crezcan.
  const fin = (async () => { let n; do { n = esperas.length; await Promise.all(esperas); } while (esperas.length !== n); })();
  return { atendida: respuesta !== null, respuesta, fin };
}

const PAGINA_CACHE = 'calendario/cal/:pagina-v1';
const FUENTES_CACHE = 'calendario/cal/:fuentes-v1';
const copiaGuardada = (cuerpo = '<!DOCTYPE html>\n<html lang="es"><p>vieja</p></html>', etag = '"v1"') =>
  ({ [PAGINA_CACHE]: { [ALCANCE]: resp(cuerpo, { headers: { ...HTML, etag } }) } });

test('sw: con red, la página de la red (sin la caché HTTP), y queda guardada para sin conexión', async () => {
  const sw = montar({ red: async () => resp('<html><p>nueva</p></html>', { headers: { ...HTML, etag: '"v2"' } }) });
  for (const ruta of ['', 'index.html', 'calendario.html']) {
    const p = pedir(sw, ALCANCE + ruta);
    assert.ok(p.atendida, ruta);
    assert.equal(await (await p.respuesta).text(), '<html><p>nueva</p></html>');
    await p.fin;
  }
  assert.deepEqual(sw.pedidas.map((x) => x.opciones), Array(3).fill({ cache: 'no-cache', redirect: 'manual', signal: {} }));
  assert.equal(await sw.guardada(PAGINA_CACHE).get(ALCANCE).text(), '<html><p>nueva</p></html>');
  assert.deepEqual(sw.mensajes, []);
});

test('sw: sin red, la última copia, marcada con data-sw-copia; sin copia, «Sin conexión»', async () => {
  let sw = montar({ cachesPrevias: copiaGuardada() });
  let p = pedir(sw, ALCANCE);
  assert.equal(await (await p.respuesta).text(), '<!DOCTYPE html>\n<html data-sw-copia="" lang="es"><p>vieja</p></html>');
  await p.fin;
  assert.deepEqual(sw.mensajes, []);   // la red no contestó: no hay nada que avisar
  sw = montar();
  p = pedir(sw, ALCANCE + 'index.html');
  const r = await p.respuesta;
  assert.equal(r.status, 503);
  const sinConexion = await r.text();
  assert.match(sinConexion, /Sin conexión\. El calendario se abrirá en cuanto haya cobertura\./);
  // Se recupera sola (en la app del iPhone no hay botón de recargar): cada 30 s, al volver la red o a la app,
  // y con «Reintentar».
  assert.match(sinConexion, /<meta http-equiv="refresh" content="30">/);
  assert.match(sinConexion, /<button type="button" onclick="location\.reload\(\)"[^>]*>Reintentar<\/button>/);
  assert.match(sinConexion, /addEventListener\("online", function \(\) \{ location\.reload\(\); \}\)/);
  assert.match(sinConexion, /visibilitychange", function \(\) \{ if \(document\.visibilityState === "visible"\) location\.reload\(\); \}/);
});

test('sw: si la web contesta con un error (404, 500), la copia; sin copia, «Sin conexión» (que se reintenta sola)', async () => {
  for (const status of [404, 500, 503]) {
    const sw = montar({ red: async () => resp('error', { status }), cachesPrevias: copiaGuardada() });
    const p = pedir(sw, ALCANCE);
    assert.match(await (await p.respuesta).text(), /data-sw-copia/, String(status));
    await p.fin;
    assert.match(await sw.guardada(PAGINA_CACHE).get(ALCANCE).text(), /vieja/);   // el error no pisa la copia
  }
  // Sin copia, «Sin conexión» (se reintenta sola), no la página de error de la web (se quedaría ahí).
  for (const status of [404, 500]) {
    const sw = montar({ red: async () => resp('error de la web', { status }) });
    const r = await pedir(sw, ALCANCE).respuesta;
    assert.equal(r.status, 503);
    assert.match(await r.text(), /http-equiv="refresh"/);
  }
});

test('sw: si la red tarda más de 4 s, la copia; cuando llega, se avisa a la página (y se guarda)', async () => {
  for (const [etag, cambiada] of [['"v2"', true], ['"v1"', false]]) {
    const lenta = pendiente();
    const sw = montar({ red: () => lenta.promesa, cachesPrevias: copiaGuardada() });
    const p = pedir(sw, ALCANCE);
    await new Promise((listo) => setImmediate(listo));
    assert.deepEqual(sw.tiempos, [30000, 4000]);   // el corte de la petición y los 4 s
    sw.relojes[1]();   // pasan los 4 s
    assert.match(await (await p.respuesta).text(), /data-sw-copia/);
    lenta.resolver(resp('<html><p>nueva</p></html>', { headers: { ...HTML, etag } }));
    await p.fin;
    assert.deepEqual(sw.mensajes, [{ type: 'sw-fresh', changed: cambiada }], etag);
    assert.match(await sw.guardada(PAGINA_CACHE).get(ALCANCE).text(), /nueva/);
  }
  // Sin copia, se espera a la red; si al final da un error, «Sin conexión».
  for (const [final, esperado] of [[resp('<html><p>por fin</p></html>'), '<html><p>por fin</p></html>'], [resp('error', { status: 502 }), /Sin conexión/]]) {
    const lenta = pendiente();
    const sw = montar({ red: () => lenta.promesa });
    const p = pedir(sw, ALCANCE);
    await new Promise((listo) => setImmediate(listo));
    sw.relojes[sw.tiempos.indexOf(4000)]();   // pasan los 4 s
    lenta.resolver(final);
    const texto = await (await p.respuesta).text();
    if (typeof esperado === 'string') assert.equal(texto, esperado); else assert.match(texto, esperado);
  }
});

test('sw: las peticiones a la web llevan un corte (10 s al instalarse, 30 s las de la página): no se quedan colgadas', async () => {
  const cortes = [];
  const sw = montar({
    red: (_url, op) => new Promise((_si, no) => {
      cortes.push(op.signal);
      op.signal.addEventListener('abort', () => no(new DOMException('cortada', 'AbortError')));
    }),
  });
  const esperas = [];
  sw.oyentes.install({ waitUntil(p) { esperas.push(p); } });
  pedir(sw, ALCANCE);
  await new Promise((listo) => setImmediate(listo));
  assert.equal(cortes.length, 2);
  // Los relojes: [corte de la instalación (10 s), corte de la página (30 s), los 4 s de la página].
  assert.equal(sw.tiempos.slice(0, 3).join(','), '10000,30000,4000');
  sw.relojes[0]();
  await Promise.all(esperas);   // la instalación termina aunque la red no contestara
  assert.equal(cortes[0].aborted, true);
  assert.equal(cortes[1].aborted, false);
  sw.relojes[1]();
  assert.equal(cortes[1].aborted, true);
});

test('sw: solo se guarda una página buena (ni redirecciones, ni otro tipo, ni opaqueredirect)', async () => {
  const casos = [
    resp('<html>r</html>', { redirected: true }),
    resp('{}', { headers: { 'content-type': 'application/json' } }),
    resp('', { status: 0, type: 'opaqueredirect' }),
    resp('<html>de otra web</html>', { type: 'cors' }),
  ];
  for (const r of casos) {
    const sw = montar({ red: async () => r });
    const p = pedir(sw, ALCANCE);
    assert.equal(await p.respuesta, r);   // se entrega tal cual
    await p.fin;
    assert.equal(sw.guardada(PAGINA_CACHE)?.size ?? 0, 0, JSON.stringify({ type: r.type, status: r.status }));
  }
});

test('sw: salidas.html (la dirección antigua) lleva a la página sin ir a la red, con o sin cobertura', async () => {
  const sw = montar({ red: async () => resp('<html>no se pide</html>') });
  const r = await pedir(sw, ALCANCE + 'salidas.html').respuesta;
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), ALCANCE);
  assert.deepEqual(sw.pedidas, []);
});

test('sw: al instalarse guarda ya la página (la visita que lo instala no pasa por él)', async () => {
  let sw = montar({ red: async () => resp('<html><p>primera</p></html>', { headers: { ...HTML, etag: '"v1"' } }) });
  const esperas = [];
  let saltada = false;
  sw.self.skipWaiting = () => { saltada = true; };
  sw.oyentes.install({ waitUntil(p) { esperas.push(p); } });
  await Promise.all(esperas);
  assert.equal(saltada, true);
  assert.deepEqual(sw.pedidas, [{ url: ALCANCE, opciones: { cache: 'no-cache', redirect: 'manual', signal: {} } }]);
  assert.equal(await sw.guardada(PAGINA_CACHE).get(ALCANCE).text(), '<html><p>primera</p></html>');
  // Sin red (o con una respuesta que no vale), se instala igual y no guarda nada.
  for (const red of [() => Promise.reject(new TypeError('sin red')), async () => resp('error', { status: 500 })]) {
    sw = montar({ red });
    const e = [];
    sw.oyentes.install({ waitUntil(p) { e.push(p); } });
    await Promise.all(e);
    assert.equal(sw.guardada(PAGINA_CACHE)?.size ?? 0, 0);
  }
  // Si la red no contesta, la instalación no espera más de 10 s (se corta la petición).
  sw = montar({ red: (_url, op) => new Promise((_si, no) => op.signal.addEventListener('abort', () => no(new Error('cortada')))) });
  const e = [];
  sw.oyentes.install({ waitUntil(p) { e.push(p); } });
  assert.equal(sw.relojes.length, 1);
  sw.relojes[0]();
  await Promise.all(e);
});

test('sw: la página le pasa las fuentes de la primera visita y las guarda (solo las de fonts.bunny.net)', async () => {
  const css = 'https://fonts.bunny.net/css?family=barlow:400';
  const letra = 'https://fonts.bunny.net/barlow/files/barlow-latin-400-normal.woff2';
  const rota = 'https://fonts.bunny.net/barlow/files/rota.woff2';
  const opaca = 'https://fonts.bunny.net/barlow/files/opaca.woff2';
  const sw = montar({
    red: async (url) => (url === rota ? resp('no está', { status: 404, type: 'cors', headers: {} })
      : url === opaca ? resp('', { status: 0, type: 'opaque', headers: {} }) : resp(`de ${url}`, { type: 'cors', headers: {} })),
  });
  const esperas = [];
  sw.oyentes.message({ data: { type: 'guardar-fuentes', urls: [css, letra, rota, opaca, 'https://otra.web/x.css', ALCANCE, 7] }, waitUntil(p) { esperas.push(p); } });
  await Promise.all(esperas);
  // Solo las buenas: una letra rota u opaca guardada ya no se volvería a pedir.
  assert.deepEqual([...sw.guardada(FUENTES_CACHE).keys()], [css, letra]);
  assert.deepEqual(sw.pedidas.map((x) => x.opciones), Array(4).fill({ mode: 'cors', credentials: 'omit' }));
  // Las que ya están no se vuelven a pedir; otros mensajes, nada.
  sw.pedidas.length = 0;
  const e2 = [];
  sw.oyentes.message({ data: { type: 'guardar-fuentes', urls: [css] }, waitUntil(p) { e2.push(p); } });
  sw.oyentes.message({ data: { type: 'otra-cosa', urls: [letra] }, waitUntil(p) { e2.push(p); } });
  sw.oyentes.message({ data: null, waitUntil(p) { e2.push(p); } });
  await Promise.all(e2);
  assert.deepEqual(sw.pedidas, []);
});

test('sw: no toca nada más: .ics, .xlsx, equipos/, peticiones que no son de página, POST ni otras webs', () => {
  const sw = montar({ red: async () => resp('x') });
  const noAtendidas = [
    [ALCANCE + 'calendario.ics'], [ALCANCE + 'calendario.xlsx'], [ALCANCE + 'equipos/dompavolei-if1.ics'],
    [ALCANCE + 'otra/pagina.html'], [ALCANCE + 'manifest.webmanifest', { modo: 'no-cors' }], [ALCANCE, { modo: 'cors' }],
    [ALCANCE, { metodo: 'POST' }], ['https://ejemplo.github.io/otra-web/'], ['https://ejemplo.github.io/cal'],
    ['https://www.google.com/maps/search/?api=1&query=x'],
  ];
  for (const [url, op] of noAtendidas) assert.equal(pedir(sw, url, op).atendida, false, url);
  assert.deepEqual(sw.pedidas, []);
});

test('sw: las fuentes se guardan y se sirven sin conexión; la hoja se renueva por detrás, la letra no', async () => {
  const css = 'https://fonts.bunny.net/css?family=barlow:400';
  const letra = 'https://fonts.bunny.net/barlow/files/barlow-latin-400-normal.woff2';
  let conRed = true;
  const sw = montar({ red: async (url) => { if (!conRed) throw new TypeError('sin red'); return resp(`de ${url}`, { type: 'cors', headers: {} }); } });
  for (const url of [css, letra]) {
    const p = pedir(sw, url, { modo: 'cors' });
    assert.equal(await (await p.respuesta).text(), `de ${url}`);
    await p.fin;
  }
  assert.deepEqual([...sw.guardada(FUENTES_CACHE).keys()], [css, letra]);
  // Sin red: de la caché.
  conRed = false;
  for (const url of [css, letra]) {
    const p = pedir(sw, url, { modo: 'cors' });
    assert.equal(await (await p.respuesta).text(), `de ${url}`);
    await p.fin;
  }
  // Con red: la letra guardada no se vuelve a pedir; la hoja sí (por detrás).
  conRed = true;
  sw.pedidas.length = 0;
  await pedir(sw, letra, { modo: 'cors' }).fin;
  assert.deepEqual(sw.pedidas, []);
  await pedir(sw, css, { modo: 'cors' }).fin;
  assert.deepEqual(sw.pedidas.map((x) => x.url), [css]);
  // Una respuesta opaca (hoja pedida sin crossorigin) se entrega pero no se guarda.
  const opaca = montar({ red: async () => resp('', { status: 0, type: 'opaque', headers: {} }) });
  const p = pedir(opaca, css, { modo: 'no-cors' });
  assert.equal((await p.respuesta).type, 'opaque');
  await p.fin;
  assert.equal(opaca.guardada(FUENTES_CACHE).size, 0);
});

test('sw: al activarse borra solo sus cachés viejas, nunca las de otras webs del mismo dominio', async () => {
  const sw = montar({
    cachesPrevias: {
      'calendario/cal/:pagina-v0': {}, [PAGINA_CACHE]: {}, [FUENTES_CACHE]: {},
      'calendario/otra/:pagina-v0': {}, 'otra-cosa': {},
    },
  });
  const esperas = [];
  sw.oyentes.activate({ waitUntil(p) { esperas.push(p); } });
  await Promise.all(esperas);
  assert.deepEqual([...sw.almacen.keys()].sort(), ['calendario/cal/:fuentes-v1', 'calendario/cal/:pagina-v1', 'calendario/otra/:pagina-v0', 'otra-cosa']);
});
