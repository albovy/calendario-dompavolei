// Pruebas de peticion (src/isquad.js) sin red: fetch simulado, reintentos, errores HTTP y de conexión.
// El reloj va simulado: las esperas entre intentos (15 s, 30 s, 1 min y 1,5 min) no se esperan de verdad.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESPERAS_SEGUNDOS, partidosApi, peticion } from '../src/isquad.js';
import { BOM, fechaPared } from '../src/util.js';

const URL_PARTIDOS = 'https://resultadosvoleibol.isquad.es/json/partidos_equipos_consultas.php';
const aviso = (segundos, n) => `  ! La web de la federación no responde; se vuelve a intentar en ${segundos} s (intento ${n} de 5)...`;
const AVISOS = [aviso(15, 2), aviso(30, 3), aviso(60, 4), aviso(90, 5)];

// Ejecuta peticion con fetch simulado (responder(n) da la respuesta a la llamada n o lanza el error) y
// el reloj simulado. Devuelve { resultado, error, avisos, llamadas }.
async function simular(t, responder, ruta = 'json/partidos_equipos_consultas.php', datos = { accion: 'x' }, opciones = undefined) {
  const llamadas = [];
  const avisos = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones });
    return responder(llamadas.length);
  };
  const consola = t.mock.method(console, 'log', (texto) => avisos.push(texto));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let terminado = false;
    const promesa = peticion(ruta, datos, opciones);
    promesa.then(() => { terminado = true; }, () => { terminado = true; });
    while (!terminado) {
      await new Promise((seguir) => { setImmediate(seguir); });
      t.mock.timers.tick(1000);
    }
    const [resultado, error] = await promesa.then((r) => [r, null], (e) => [null, e]);
    return { resultado, error, avisos, llamadas };
  } finally {
    t.mock.timers.reset();
    consola.mock.restore();
    globalThis.fetch = original;
  }
}

function mensajeError(motivo) {
  return `No se pudo descargar ${URL_PARTIDOS}\n    (${motivo})\n    Comprueba la conexión a Internet y vuelve a intentarlo.`;
}

test('peticion: POST con el formulario o GET, y sin los BOM del principio', async (t) => {
  const post = await simular(t, () => new Response(`${BOM}${BOM}{"data":[]}`), 'json/x.php', { accion: 'obtener', id: '7' });
  assert.equal(post.resultado, '{"data":[]}');
  assert.equal(post.llamadas.length, 1);
  const { url, opciones } = post.llamadas[0];
  assert.equal(url, 'https://resultadosvoleibol.isquad.es/json/x.php');
  assert.equal(opciones.method, 'POST');
  assert.equal(String(opciones.body), 'accion=obtener&id=7');
  assert.equal(opciones.headers['User-Agent'], 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) calendario-voley/1.0');
  assert.deepEqual(post.avisos, []);

  const get = await simular(t, () => new Response('<html>'), 'listado_clubs.php?id_territorial=20', null);
  assert.equal(get.resultado, '<html>');
  assert.deepEqual([get.llamadas[0].opciones.method, get.llamadas[0].opciones.body], ['GET', undefined]);
});

test('peticion: si falla, avisa y lo vuelve a intentar con esperas crecientes (5 veces en total)', async (t) => {
  assert.deepEqual(ESPERAS_SEGUNDOS, [15, 30, 60, 90]);
  const bien = await simular(t, (n) => (n === 1 ? new Response('', { status: 503 }) : new Response('{"data":[1]}')));
  assert.equal(bien.resultado, '{"data":[1]}');
  assert.equal(bien.llamadas.length, 2);
  assert.deepEqual(bien.avisos, [AVISOS[0]]);

  // Como en GitHub: no responde durante un rato y al tercer intento sí.
  const tarde = await simular(t, (n) => {
    if (n < 3) throw new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') });
    return new Response('{"data":[2]}');
  });
  assert.equal(tarde.resultado, '{"data":[2]}');
  assert.deepEqual(tarde.avisos, AVISOS.slice(0, 2));

  const mal = await simular(t, () => new Response('x', { status: 500, statusText: 'Internal Server Error' }));
  assert.equal(mal.llamadas.length, 5);
  assert.deepEqual(mal.avisos, AVISOS);
  assert.equal(mal.error.message, mensajeError('respuesta 500 Internal Server Error'));
});

test('peticion: espera de verdad entre intentos (15 s antes del segundo)', async (t) => {
  // Con el reloj simulado parado, el segundo intento no llega hasta que pasan 15 s.
  const llamadas = [];
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    llamadas.push(1);
    if (llamadas.length === 1) throw new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') });
    return new Response('ok');
  };
  const consola = t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const promesa = peticion('json/x.php', null);
    for (let i = 0; i < 5; i++) await new Promise((seguir) => { setImmediate(seguir); });
    t.mock.timers.tick(14000);
    for (let i = 0; i < 5; i++) await new Promise((seguir) => { setImmediate(seguir); });
    assert.equal(llamadas.length, 1, 'a los 14 s todavía no se ha reintentado');
    t.mock.timers.tick(1000);
    assert.equal(await promesa, 'ok');
    assert.equal(llamadas.length, 2);
  } finally {
    t.mock.timers.reset();
    consola.mock.restore();
    globalThis.fetch = original;
  }
});

test('peticion: el motivo del error nunca queda vacío', async (t) => {
  const motivo = async (error) => {
    const { error: e } = await simular(t, () => { throw error; });
    return e.message;
  };
  // DNS: el motivo viene en "cause".
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND resultadosvoleibol.isquad.es'), { code: 'ENOTFOUND' });
  assert.equal(await motivo(new TypeError('fetch failed', { cause: dns })),
    mensajeError('getaddrinfo ENOTFOUND resultadosvoleibol.isquad.es'));
  // Con IPv4 e IPv6 fallan todas las direcciones: la causa es un AggregateError sin texto.
  const todas = Object.assign(new AggregateError([new Error('connect ECONNREFUSED ::1:443'), new Error('connect ECONNREFUSED 127.0.0.1:443')], ''),
    { code: 'ECONNREFUSED' });
  assert.equal(await motivo(new TypeError('fetch failed', { cause: todas })), mensajeError('connect ECONNREFUSED ::1:443'));
  const soloCodigo = Object.assign(new AggregateError([], ''), { code: 'ECONNRESET' });
  assert.equal(await motivo(new TypeError('fetch failed', { cause: soloCodigo })), mensajeError('ECONNRESET'));
  // Tiempo agotado (AbortSignal.timeout).
  assert.equal(await motivo(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    mensajeError('la web no ha respondido a tiempo'));
});

test('peticion: otra web de iSquad y otras esperas', async (t) => {
  const otra = await simular(t, () => new Response('[]'), 'json/api/call.php/x', { a: '1' }, { base: 'https://voleibol.isquad.es' });
  assert.equal(otra.llamadas[0].url, 'https://voleibol.isquad.es/json/api/call.php/x');
  const una = await simular(t, () => new Response('', { status: 503, statusText: 'Service Unavailable' }), 'json/x.php', null, { esperas: [] });
  assert.equal(una.llamadas.length, 1);
  assert.deepEqual(una.avisos, []);
  assert.match(una.error.message, /respuesta 503 Service Unavailable/);
  const dos = await simular(t, (n) => (n === 1 ? new Response('', { status: 503 }) : new Response('ok')), 'json/x.php', null, { esperas: [15] });
  assert.equal(dos.resultado, 'ok');
  assert.deepEqual(dos.avisos, ['  ! La web de la federación no responde; se vuelve a intentar en 15 s (intento 2 de 2)...']);
});

// partidosApi con fetch simulado: la federación responde { data: filas }, con las "/" escapadas como "\/",
// igual que su PHP.
async function partidosCon(filas) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: filas }).replaceAll('/', '\\/'));
  try {
    return await partidosApi(fechaPared(2026, 8, 1));
  } finally {
    globalThis.fetch = original;
  }
}

// El nombre de un equipo tal como lo da la federación: HTML con el escudo del club delante.
function nombreConEscudo(idClub, nombre) {
  return "<div class='nombres-equipos'><div class='image-background'>\n                                            "
    + "<div class='image-container'>\n                                                <div class='image-content'>\n"
    + "                                                <img width='50'\n                                                "
    + `style='mix-blend-mode: multiply;' src='https://voleibol.isquad.es/images/afiliacion_clubs/${idClub}/square_6b656d3467326c68346f.jpg'>`
    + `</div></div></div> ${nombre}</div>`;
}

// Un partido como los que da la federación desde el 28/10/2026: sin id_club_local ni id_club_visitante.
const PARTIDO_SIN_IDS = {
  nombre_local: nombreConEscudo('206572608', 'AUTOS CADISTA VOLEIBOL RIVEIRA'),
  nombre_visitante: nombreConEscudo('206572580', 'DOMPAVOLEI SM1'),
  campo: 'TORRES COLOMER',
  nombre_competicion: '1ªDIV. SENIOR MASCULINA',
  categoria: 'SENIOR',
  fecha: '2026-11-07 17:00:00',
  fecha_confirmada: '1',
  fecha_final: '07/11/2026<br>17:00:00',
  fecha_calendario: '2026-11-07',
};

test('partidosApi: sin id_club_local/visitante (desde el 28/10/2026), el ID del club sale del escudo', async () => {
  const filas = await partidosCon([PARTIDO_SIN_IDS]);
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0], { ...PARTIDO_SIN_IDS, id_club_local: '206572608', id_club_visitante: '206572580' });
});

test('partidosApi: el ID que da la federación manda; sin ID ni escudo queda vacío; lo que no es un partido se quita', async () => {
  const conIds = { ...PARTIDO_SIN_IDS, id_club_local: '1', id_club_visitante: 'None' };
  const sinEscudo = { ...PARTIDO_SIN_IDS, nombre_local: "<div class='nombres-equipos'> EQUIPO SIN ESCUDO</div>" };
  const filas = await partidosCon([conIds, sinEscudo, { otra: 'cosa' }, 'texto', null]);
  assert.equal(filas.length, 2);
  assert.deepEqual([filas[0].id_club_local, filas[0].id_club_visitante], ['1', 'None']);
  assert.deepEqual([filas[1].id_club_local, filas[1].id_club_visitante], ['', '206572580']);
});
