// Pruebas de src/federacion.js sin red: de la página de un grupo a las filas de la agenda (recortes reales en
// test/datos) y la actualización de los grupos con la federación simulada (fetch) y el reloj simulado: las pausas
// entre peticiones y los reintentos no se esperan de verdad.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DIAS_REPASO, ESPERAS_GRUPOS, HORAS_COPIA, HORAS_GUARDAR, HORAS_REPASO, PAUSA_MS, actualizarFederacion, categoriaDe, filaAgenda,
  filasDeCache, gruposConfig, lugaresDeCache,
} from '../src/federacion.js';
import { convertirPartidos } from '../src/partidos.js';
import { anotarGrupos, anotarResultados, leerGrupos, leerResultados } from '../src/resultados.js';
import { fechaPared, fmt } from '../src/util.js';

const DOMPA = '206572580';
const IDS = new Set([DOMPA]);
const XUVENIL = '2ªDIV. XUVENIL FEMENINA';
const APERTURA = 'TORNEO APERTURA INFANTIL F';
const AHORA = fechaPared(2026, 11, 6, 20, 0);
const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) calendario-voley/1.0';

function pagina(nombre) { return readFileSync(new URL(`./datos/${nombre}`, import.meta.url), 'utf8'); }
// Grupo 3941 (XF1, liga) del 06/11/2026, recortado: 7 partidos, 5 del club.
const LIGA = pagina('grupo-3941-2026-11.html');

const CFG = { federacion: { grupos: [{ equipo: 'DOMPAVOLEI XF1', grupo: '3941', competicion: '1537' }] } };
const CFG_APERTURA = { federacion: { grupos: [{ equipo: 'DOMPAVOLEI IF1', grupo: '4064', competicion: '1511' }] } };

// --- config.json, categoría y filas ------------------------------------------------------------------

test('gruposConfig: los grupos de config.json (federacion.grupos) con sus cifras; si faltan, cómo apuntarlos', () => {
  const cfg = { federacion: { grupos: [
    { equipo: 'DOMPAVOLEI SM1', grupo: '3857', competicion: '1516' },
    { equipo: 'DOMPAVOLEI XF1', grupo: 3941, competicion: ' 1537 ' },
    { grupo: '4064', competicion: '1511' },
  ] } };
  assert.deepEqual(gruposConfig(cfg), [
    { equipo: 'DOMPAVOLEI SM1', grupo: '3857', competicion: '1516' },
    { equipo: 'DOMPAVOLEI XF1', grupo: '3941', competicion: '1537' },
    { equipo: '', grupo: '4064', competicion: '1511' },
  ]);
  for (const sin of [null, {}, { federacion: {} }, { federacion: { grupos: [] } }, { federacion: { grupos: '3857' } }]) {
    assert.throws(() => gruposConfig(sin), (e) => /^config\.json no tiene los grupos de la federación \(federacion\.grupos\)/.test(e.message)
      && /id=/.test(e.message) && /id_competicion=/.test(e.message), JSON.stringify(sin));
  }
  const con = (...grupos) => () => gruposConfig({ federacion: { grupos } });
  assert.throws(con({ equipo: 'DOMPAVOLEI SM1', grupo: '38a7', competicion: '1516' }),
    { message: 'En el grupo n.º 1 de federacion.grupos de config.json (DOMPAVOLEI SM1), «grupo» tiene que ser un número (el id= de la dirección de la página del grupo), no «38a7».' });
  assert.throws(con(cfg.federacion.grupos[0], { grupo: '3941' }),
    { message: 'En el grupo n.º 2 de federacion.grupos de config.json, «competicion» tiene que ser un número (el id_competicion= de la dirección de la página del grupo), no «».' });
  assert.throws(con('3857'), { message: /^El grupo n\.º 1 de federacion\.grupos de config\.json tiene que ser así:/ });
  assert.throws(con(cfg.federacion.grupos[0], cfg.federacion.grupos[0]), { message: 'El grupo 3857 está repetido en federacion.grupos de config.json.' });
});

test('categoriaDe: la categoría como la mandaba la agenda, sacada del nombre de la competición', () => {
  const casos = {
    '1ªDIV. SENIOR MASCULINA': 'SENIOR', '1ªDIV. JUNIOR FEMENINA': 'JUNIOR', [XUVENIL]: 'JUVENIL', 'TORNEO APERTURA XUVENIL F': 'JUVENIL',
    'LIGA JUVENIL MASCULINA': 'JUVENIL', '3ªDIV. CADETE FEMENINA': 'CADETE', '2ªDIV. INFANTIL FEMENINA': 'INFANTIL',
    '1ªDIV. ALEVIN MASCULINA': 'ALEVIN', 'TORNEO ALEVÍN MIXTO': 'ALEVIN', '1ªDIV. BENXAMIN FEMENINA': 'BENJAMIN',
    'BENJAMÍN MIXTO': 'BENJAMIN', 'COPA FEDERACION 2026': '', '': '',
    // Las ligas nacionales sin edad en el nombre son de mayores; con la edad, la edad.
    '1ª DIV. NACIONAL FEMENINA': 'SENIOR', 'SUPERLIGA 2 MASCULINA': 'SENIOR', 'SEGUNDA DIVISIÓN NACIONAL MASCULINO': 'SENIOR',
    'SUPERLIGA JUNIOR MASCULINA': 'JUNIOR',
  };
  for (const [competicion, categoria] of Object.entries(casos)) assert.equal(categoriaDe(competicion), categoria, competicion);
});

test('filaAgenda: cada partido de la página con las propiedades de la agenda, en su formato exacto', () => {
  const filas = leerResultados(LIGA);
  const de = (id) => filaAgenda(filas.find((f) => f.id === id), XUVENIL);
  // Por jugar, con hora: confirmada. Las 10 propiedades que lee convertirPartidos, en su orden, y el id del partido.
  assert.deepEqual(Object.entries(de('98199')), Object.entries({
    id_club_local: '206572588', id_club_visitante: DOMPA, nombre_local: 'XAV CAMBADOS AZUL', nombre_visitante: 'DOMPAVOLEI XF1',
    nombre_competicion: XUVENIL, campo: 'RAMON CABANILLAS - PISTA 2', categoria: 'JUVENIL', fecha: '2026-11-08 11:30:00',
    fecha_confirmada: '1', fecha_calendario: '2026-11-08', id_partido: '98199',
  }));
  // Sin hora («0:00»): a las 00:00:00 y sin confirmar, como en la agenda.
  assert.deepEqual([de('98202').fecha, de('98202').fecha_confirmada, de('98202').fecha_calendario], ['2026-11-14 00:00:00', '', '2026-11-14']);
  // Sin pabellón.
  assert.deepEqual([de('98247').campo, de('98247').fecha, de('98247').fecha_confirmada], ['', '2027-02-13 00:00:00', '']);
  // Jugado: confirmado, y el pabellón con <br> en una línea.
  assert.deepEqual([de('98193').fecha, de('98193').fecha_confirmada, de('98193').campo],
    ['2026-10-31 12:30:00', '1', 'ANEXO PM OS REMEDIOS - ANEXO OS REMEDIOS - PISTA 2']);
  // Ya jugado y sin hora: también confirmado.
  const jugado = filaAgenda({ ...filas[1], hora: '' }, XUVENIL);
  assert.deepEqual([jugado.fecha, jugado.fecha_confirmada], ['2026-10-25 00:00:00', '1']);
  // Aplazado o suspendido: aunque conserve la hora de antes, en su día, sin hora y sin confirmar. En juego, como siempre.
  const conHora = filas.find((f) => f.id === '98199');
  for (const estado of ['Aplazado', 'SUSPENDIDO']) {
    const f = filaAgenda({ ...conHora, estado }, XUVENIL);
    assert.deepEqual([f.fecha, f.fecha_confirmada, f.fecha_calendario], ['2026-11-08 00:00:00', '', '2026-11-08'], estado);
  }
  const enJuego = filaAgenda({ ...conHora, estado: 'En progreso' }, XUVENIL);
  assert.deepEqual([enJuego.fecha, enJuego.fecha_confirmada], ['2026-11-08 11:30:00', '1']);
});

test('filaAgenda: con convertirPartidos sale lo mismo que con la fila de la agenda (UID, estado, pabellón, categoría...)', () => {
  const nuestras = leerResultados(LIGA).filter((f) => f.clubLocal === DOMPA || f.clubVisitante === DOMPA);
  // Las mismas filas como las mandaba la agenda (las tres últimas, tal como las dio el 06/11/2026).
  const agenda = (fecha, confirmada, local, idLocal, visitante, idVisitante, campo) => ({
    id_club_local: idLocal, id_club_visitante: idVisitante, nombre_local: local, nombre_visitante: visitante,
    nombre_competicion: XUVENIL, campo, categoria: 'JUVENIL', fecha, fecha_confirmada: confirmada, fecha_calendario: fecha.slice(0, 10),
  });
  const filasAgenda = [
    agenda('2026-10-25 10:00:00', '1', 'CLUB VIGO VOLEIBOL', '206572606', 'DOMPAVOLEI XF1', DOMPA, 'PABELLÓN MUNICIPAL DE COIA - PISTA 2'),
    agenda('2026-10-31 12:30:00', '1', 'DOMPAVOLEI XF1', DOMPA, 'BREIJO ARQUITECTURA E INGENIERIA XIRIA VOLEI', '206572607',
      'ANEXO PM OS REMEDIOS<br>ANEXO OS REMEDIOS - PISTA 2'),
    agenda('2026-11-08 11:30:00', '1', 'XAV CAMBADOS AZUL', '206572588', 'DOMPAVOLEI XF1', DOMPA, 'RAMON CABANILLAS - PISTA 2'),
    agenda('2026-11-14 00:00:00', '', 'DOMPAVOLEI XF1', DOMPA, 'CV CIUDAD DE A CORUÑA JF B', '206572595', 'A CARBALLEIRA'),
    agenda('2027-02-13 00:00:00', '', 'CV CIUDAD DE A CORUÑA JF B', '206572595', 'DOMPAVOLEI XF1', DOMPA, ''),
  ];
  const resumen = (p) => ({
    uid: p.uid, fecha: fmt(p.fecha, 'yyyy-MM-dd HH:mm'), estado: p.estado, local: p.local, visitante: p.visitante,
    condicion: p.condicion, competicion: p.competicion, categoria: p.categoria, claveCategoria: p.claveCategoria, pabellon: p.pabellon,
  });
  const desdePaginas = convertirPartidos(nuestras.map((f) => filaAgenda(f, XUVENIL)), IDS).map(resumen);
  assert.deepEqual(desdePaginas, convertirPartidos(filasAgenda, IDS).map(resumen));
  assert.deepEqual(desdePaginas.map((p) => [p.estado, p.categoria]), [
    ['confirmada', 'Juvenil F'], ['confirmada', 'Juvenil F'], ['confirmada', 'Juvenil F'], ['pendiente', 'Juvenil F'], ['pendiente', 'Juvenil F'],
  ]);
});

test('filasDeCache y lugaresDeCache: toda la temporada; en las copias viejas el club sale del nombre de su equipo', () => {
  const esNuestro = (_nombre, club) => club === DOMPA;
  const cache = { temporada: 2026, clubs: [DOMPA], competiciones: {}, grupos: {} };
  anotarGrupos(cache, XUVENIL, '1537', leerGrupos(LIGA), esNuestro);
  anotarResultados(cache.grupos['3941'], leerResultados(LIGA), esNuestro, AHORA);
  cache.grupos['3941'].competicion = XUVENIL;
  // Un grupo guardado antes de noviembre de 2026: sin ID de los clubs, sin pabellón y sin id.
  cache.grupos['4064'] = {
    competicion: APERTURA, id_competicion: '1511', nombre: 'PRIMERA FASE - GRUPO H', equipos: ['DOMPAVOLEI IF1'], consultado: '2026-09-25 11:16',
    terminado: true, firma: 'e0df43d9b483a5be', firma_clasificacion: 'e0df43d9b483a5be', clasificacion: null,
    partidos: [{ local: 'EMEVÉ COLEXIO SAN LORENZO IF', visitante: 'DOMPAVOLEI IF1', dia: '2026-09-19', hora: '10:00', estado: 'Finalizado', marcador: [0, 3], sets: [] }],
  };
  const filas = filasDeCache(cache, IDS);
  assert.deepEqual(filas.map((f) => f.id_partido), ['98188', '98193', '98199', '98202', '98247', '']);
  assert.deepEqual(filas[5], {
    id_club_local: '', id_club_visitante: DOMPA, nombre_local: 'EMEVÉ COLEXIO SAN LORENZO IF', nombre_visitante: 'DOMPAVOLEI IF1',
    nombre_competicion: APERTURA, campo: '', categoria: 'INFANTIL', fecha: '2026-09-19 10:00:00', fecha_confirmada: '1',
    fecha_calendario: '2026-09-19', id_partido: '',
  });
  assert.equal(convertirPartidos(filas, IDS).length, 6);
  // Los pabellones de los partidos del club, con su sitio (el primero que sale de cada uno).
  const lugares = lugaresDeCache(cache);
  assert.deepEqual([...lugares.keys()], [
    'PABELLÓN MUNICIPAL DE COIA - PISTA 2', 'ANEXO PM OS REMEDIOS - ANEXO OS REMEDIOS - PISTA 2', 'RAMON CABANILLAS - PISTA 2', 'A CARBALLEIRA',
  ]);
  assert.deepEqual(lugares.get('A CARBALLEIRA'), { lat: 42.332355, lon: -7.8742318, direccion: 'RúA DO CASTELO RAMIRO, 28, 32002 OURENSE, ESPAñA, 32002' });
});

// --- actualizarFederacion con la federación simulada ---------------------------------------------------

const PAGINAS = {
  'grupo 3941': LIGA,
  'clasificacion 3941': pagina('clasificacion-3857-2026-11.html'),
  // Apertura (páginas de septiembre): el grupo 4064 ya terminado; su página lista también el 3818, con el IF1.
  'grupo 4064': pagina('grupo-4064.html'),
  'clasificacion 4064': pagina('clasificacion-4064.html'),
  'grupo 3818': pagina('grupo-3818.html'),
  'clasificacion 3818': pagina('clasificacion-3818.html'),
};
// La página del 4064 como estaba el 19/09 por la noche: la primera fase ya jugada y la segunda (3818) aún sin equipos (la
// federación los pone cuando se sabe quién pasa).
const SIN_FASE_2 = PAGINAS['grupo 4064'].replace(/<a href="equipo\.php\?seleccion=0&id_equipo=\d+&id=3818">[\s\S]*?<\/a>/g, '');
// La página del 3941 con otro grupo en su lista de grupos (una fase nueva) en el que juega el XF1.
function conFase(html, torneo) {
  const bloque = '<h4 style="font-weight: bold;">SEGUNDA FASE - GRUPO A</h4><div>'
    + `<a href="equipo.php?seleccion=0&id_equipo=5555&id=${torneo}&id_superficie=1"><img src="https://voleibol.isquad.es/images/afiliacion_clubs/${DOMPA}/x.jpg" /></a>`
    + `<a href="equipo.php?seleccion=0&id_equipo=5555&id=${torneo}&id_superficie=1">DOMPAVOLEI XF1</a></div>`;
  const i = html.indexOf('<div class="limpio"></div>', html.indexOf('GRUPOS DE LA COMPETICI'));
  return html.slice(0, i) + bloque + html.slice(i);
}
// La página de un grupo con su calendario aún sin hacer: la lista de grupos, pero ningún partido.
const SIN_PARTIDOS = LIGA.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody></tbody>');
const TEXTOS = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' };

// fetch que responde como la federación con PAGINAS o con «cambios» (un texto, un código HTTP o un Error que lanzar)
// y apunta cada petición, con la hora (simulada) a la que llega.
function federacion(pedidas, cambios) {
  return async (url, opciones = {}) => {
    const u = new URL(String(url));
    const nombre = `${u.pathname === '/clasificacion.php' ? 'clasificacion' : 'grupo'} ${u.searchParams.get('id')}`;
    pedidas.push({ nombre, url: u, opciones, cuando: Date.now() });
    const r = Object.hasOwn(cambios, nombre) ? cambios[nombre] : PAGINAS[nombre];
    if (r instanceof Error) throw r;
    if (typeof r === 'number') return new Response('', { status: r, statusText: TEXTOS[r] });
    if (r === undefined) return new Response('', { status: 404, statusText: 'Not Found' });
    return new Response(r);
  };
}

// Reglas de red: solo GET a competicion_completa.php y clasificacion.php de la web de resultados, con el User-Agent
// del programa y ninguna otra cabecera, y sin seguir redirecciones; nada bajo /json/, ni equipo.php, ni actas, ni previos.
function comprobarReglas(pedidas) {
  for (const { url, opciones } of pedidas) {
    assert.equal(url.origin, 'https://resultadosvoleibol.isquad.es', url.href);
    assert.ok(['/competicion_completa.php', '/clasificacion.php'].includes(url.pathname), url.href);
    assert.ok(!/json|equipo|acta|previo/i.test(url.href), url.href);
    assert.equal(opciones.method, 'GET');
    assert.equal(opciones.body, undefined);
    assert.deepEqual(opciones.headers, { 'User-Agent': AGENTE });
    assert.equal(opciones.redirect, 'manual');
  }
}

// Ejecuta actualizarFederacion con la federación simulada y el reloj simulado. Devuelve { resultado, error, pedidas,
// avisos }; comprueba siempre las reglas de red.
async function actualizar(t, opciones, cambios = {}) {
  const pedidas = [];
  const avisos = [];
  const original = globalThis.fetch;
  globalThis.fetch = federacion(pedidas, cambios);
  const consola = t.mock.method(console, 'log', (texto) => avisos.push(texto));
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    let terminado = false;
    const promesa = actualizarFederacion({ cfg: CFG, ids: IDS, anio: 2026, ahora: AHORA, ...opciones });
    promesa.then(() => { terminado = true; }, () => { terminado = true; });
    while (!terminado) {
      await new Promise((seguir) => { setImmediate(seguir); });
      t.mock.timers.tick(250);
    }
    const [resultado, error] = await promesa.then((r) => [r, null], (e) => [null, e]);
    comprobarReglas(pedidas);
    return { resultado, error, pedidas, avisos };
  } finally {
    t.mock.timers.reset();
    consola.mock.restore();
    globalThis.fetch = original;
  }
}

// Carpeta temporal para resultados.json; se borra al acabar la prueba.
function carpeta(t) {
  const dir = mkdtempSync(join(tmpdir(), 'federacion-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'resultados.json');
}

const nombres = (pedidas) => pedidas.map((p) => p.nombre);

test('actualizarFederacion: el grupo y su clasificación; guarda resultados.json y devuelve las filas, los pabellones y la caché', async (t) => {
  const ruta = carpeta(t);
  const { resultado, error, pedidas, avisos } = await actualizar(t, { ruta });
  assert.equal(error, null);
  assert.deepEqual(avisos, []);
  assert.deepEqual(nombres(pedidas), ['grupo 3941', 'clasificacion 3941']);
  assert.equal(pedidas[0].url.href, 'https://resultadosvoleibol.isquad.es/competicion_completa.php?seleccion=0&id=3941&id_ambito=6'
    + '&id_territorial=20&id_superficie=1&iframe=0&id_competicion=1537');
  assert.equal(pedidas[1].url.href, 'https://resultadosvoleibol.isquad.es/clasificacion.php?seleccion=0&id=3941&id_ambito=6'
    + '&id_territorial=20&id_superficie=1&iframe=0&id_competicion=1537');
  const { cache, filas, lugares, anterior, fallo } = resultado;
  assert.equal(fallo, null);
  assert.deepEqual(Object.keys(cache), ['temporada', 'clubs', 'competiciones', 'grupos']);
  assert.deepEqual([cache.temporada, cache.clubs], [2026, [DOMPA]]);
  // revisado: cuándo se miró si hay fases nuevas con todos los grupos del club terminados (aún no).
  assert.deepEqual(cache.competiciones, { [XUVENIL]: { id: '1537', torneos: ['3941', '3942', '3943', '3944'], revisado: '' } });
  const g = cache.grupos['3941'];
  assert.deepEqual(
    [g.competicion, g.id_competicion, g.nombre, g.equipos, g.consultado, g.terminado, g.firma_clasificacion === g.firma, g.clasificacion.length],
    [XUVENIL, '1537', 'PRIMERA FASE - LIGA REGULAR', ['DOMPAVOLEI XF1'], '2026-11-06 20:00', false, true, 10],
  );
  // Solo los partidos del club, con todo; las filas, de ellos.
  assert.deepEqual(g.partidos.map((p) => p.id), ['98188', '98193', '98199', '98202', '98247']);
  assert.deepEqual(g.partidos[2], leerResultados(LIGA)[3]);
  assert.deepEqual(filas, g.partidos.map((p) => filaAgenda(p, XUVENIL)));
  assert.deepEqual(lugares, lugaresDeCache(cache));
  assert.equal(lugares.size, 4);
  assert.deepEqual(anterior, []);
  assert.deepEqual(JSON.parse(readFileSync(ruta, 'utf8')), JSON.parse(JSON.stringify(cache)));
});

test('actualizarFederacion: con guardar=false no escribe resultados.json', async (t) => {
  const ruta = carpeta(t);
  const { error, resultado } = await actualizar(t, { ruta, guardar: false });
  assert.equal(error, null);
  assert.equal(resultado.filas.length, 5);
  assert.equal(existsSync(ruta), false);
});

test('actualizarFederacion: con un 403 no se reintenta; sin copia de menos de 48 h es un error y no se toca ningún archivo', async (t) => {
  for (const codigo of [401, 403, 404, 429]) {
    const ruta = carpeta(t);
    const { error, pedidas } = await actualizar(t, { ruta }, { 'grupo 3941': codigo });
    assert.deepEqual(nombres(pedidas), ['grupo 3941'], `${codigo}: un solo intento`);
    assert.equal(error.message, `No se pudo actualizar el grupo 3941 (DOMPAVOLEI XF1) desde la federación (respuesta ${codigo} ${TEXTOS[codigo]}).\n`
      + '    No hay una copia de menos de 48 horas de: el grupo 3941 (DOMPAVOLEI XF1). No se ha cambiado ningún archivo.');
    assert.equal(existsSync(ruta), false);
  }
});

test('actualizarFederacion: si falla y lo guardado tiene menos de 48 h, aviso y se sigue con ello; si es más antiguo, error', async (t) => {
  const ruta = carpeta(t);
  assert.equal(HORAS_COPIA, 48);
  const primera = await actualizar(t, { ruta });
  const guardado = readFileSync(ruta, 'utf8');
  const casi = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 8, 19, 59) }, { 'grupo 3941': 403 });
  assert.equal(casi.error, null);
  assert.deepEqual(casi.avisos, ['  ! No se pudo actualizar el grupo 3941 (DOMPAVOLEI XF1) desde la federación (respuesta 403 Forbidden). '
    + 'Hasta la próxima ejecución se usa lo guardado, de hace menos de 48 horas.']);
  // El fallo va también en el resultado: así main.js no le pide nada más a la federación en esta ejecución.
  assert.deepEqual([casi.resultado.fallo.motivo, casi.resultado.fallo.estado], ['respuesta 403 Forbidden', 403]);
  assert.deepEqual(casi.resultado.filas, primera.resultado.filas);
  assert.deepEqual(casi.resultado.lugares, primera.resultado.lugares);
  assert.equal(readFileSync(ruta, 'utf8'), guardado);
  const tarde = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 8, 20, 0) }, { 'grupo 3941': 403 });
  assert.match(tarde.error.message, /\(respuesta 403 Forbidden\)\.\n {4}No hay una copia de menos de 48 horas de: el grupo 3941 \(DOMPAVOLEI XF1\)\. No se ha cambiado ningún archivo\.$/);
  assert.equal(readFileSync(ruta, 'utf8'), guardado);
});

test('actualizarFederacion: la red o un 5xx se reintentan a los 15 y a los 30 s; si sigue igual, cuenta como fallo', async (t) => {
  assert.deepEqual(ESPERAS_GRUPOS, [15, 30]);
  const ruta = carpeta(t);
  const caida = await actualizar(t, { ruta }, { 'grupo 3941': 503 });
  assert.deepEqual(nombres(caida.pedidas), ['grupo 3941', 'grupo 3941', 'grupo 3941']);
  const [a, b, c] = caida.pedidas.map((p) => p.cuando);
  assert.ok(b - a >= 15000 && c - b >= 30000, `${a} ${b} ${c}`);
  assert.deepEqual(caida.avisos, [
    '  ! La web de la federación no responde; se vuelve a intentar en 15 s (intento 2 de 3)...',
    '  ! La web de la federación no responde; se vuelve a intentar en 30 s (intento 3 de 3)...',
  ]);
  assert.match(caida.error.message, /^No se pudo actualizar el grupo 3941 \(DOMPAVOLEI XF1\) desde la federación \(respuesta 503 Service Unavailable\)\./);
  const red = await actualizar(t, { ruta }, { 'grupo 3941': new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') }) });
  assert.equal(red.pedidas.length, 3);
  assert.match(red.error.message, /\(Connect Timeout Error\)/);
  assert.equal(existsSync(ruta), false);
});

test('actualizarFederacion: los grupos nuevos de la competición se descubren y se piden; los terminados ya no se piden', async (t) => {
  const ruta = carpeta(t);
  // La página del 4064 (ya terminado) lista también el 3818 (segunda fase), donde juega el IF1. Primero las páginas de
  // los grupos y, al final, las clasificaciones.
  const primera = await actualizar(t, { ruta, cfg: CFG_APERTURA, ahora: fechaPared(2026, 9, 26, 0, 30) });
  assert.equal(primera.error, null);
  assert.deepEqual(nombres(primera.pedidas), ['grupo 4064', 'grupo 3818', 'clasificacion 4064', 'clasificacion 3818']);
  const { cache } = primera.resultado;
  assert.deepEqual(Object.keys(cache.grupos), ['3818', '4064']);
  assert.deepEqual([cache.grupos['4064'].terminado, cache.grupos['3818'].terminado], [true, false]);
  assert.deepEqual([cache.grupos['3818'].competicion, cache.grupos['3818'].id_competicion, cache.grupos['3818'].nombre],
    [APERTURA, '1511', 'SEGUNDA FASE - GRUPO 1']);
  assert.equal(primera.resultado.filas.length, 6);
  // Al menos 1,5 s entre dos peticiones seguidas.
  assert.equal(PAUSA_MS, 1500);
  const horas = primera.pedidas.map((p) => p.cuando);
  for (let i = 1; i < horas.length; i++) assert.ok(horas[i] - horas[i - 1] >= 1500, `${horas}`);
  // Una hora después: el 4064 ya no se pide; el 3818, sí (sin cambios: sin clasificación).
  const otra = await actualizar(t, { ruta, cfg: CFG_APERTURA, ahora: fechaPared(2026, 9, 26, 1, 30) });
  assert.deepEqual(nombres(otra.pedidas), ['grupo 3818']);
  assert.deepEqual(otra.resultado.filas, primera.resultado.filas);
});

test('actualizarFederacion: la clasificación solo se pide cuando cambian los partidos del grupo', async (t) => {
  const ruta = carpeta(t);
  assert.deepEqual(nombres((await actualizar(t, { ruta })).pedidas), ['grupo 3941', 'clasificacion 3941']);
  assert.deepEqual(nombres((await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 21, 0) })).pedidas), ['grupo 3941']);
  // Se aplaza un partido: cambia la firma del grupo.
  const aplazado = LIGA.replace("<i-t page='common'>Pendiente</i-t>", "<i-t page='common'>Aplazado</i-t>");
  const cambio = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 22, 0) }, { 'grupo 3941': aplazado });
  assert.deepEqual(nombres(cambio.pedidas), ['grupo 3941', 'clasificacion 3941']);
  // Si falla la clasificación, aviso; se vuelve a pedir la próxima vez.
  const otro = LIGA.replace("<i-t page='common'>Pendiente</i-t>", "<i-t page='common'>Suspendido</i-t>");
  const falla = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 23, 0) }, { 'grupo 3941': otro, 'clasificacion 3941': 403 });
  assert.equal(falla.error, null);
  assert.deepEqual(falla.avisos, ['  ! No se pudo actualizar la clasificación del grupo 3941 (DOMPAVOLEI XF1) desde la federación '
    + '(respuesta 403 Forbidden): se enseña la guardada y se vuelve a pedir en la próxima ejecución.']);
  const luego = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 7, 0, 0) }, { 'grupo 3941': otro });
  assert.deepEqual(nombres(luego.pedidas), ['grupo 3941', 'clasificacion 3941']);
});

test('actualizarFederacion: un fallo de la clasificación solo es un aviso: antes se han pedido todos los grupos', async (t) => {
  const ruta = carpeta(t);
  const cfg = { federacion: { grupos: [...CFG.federacion.grupos, ...CFG_APERTURA.federacion.grupos] } };
  // Sin copia (como con una de más de 48 horas): si la clasificación del primero cortara, los demás grupos se quedarían
  // sin leer y no se publicaría nada.
  const r = await actualizar(t, { ruta, cfg }, { 'clasificacion 3941': 404 });
  assert.equal(r.error, null);
  assert.deepEqual(nombres(r.pedidas), ['grupo 3941', 'grupo 4064', 'grupo 3818', 'clasificacion 3941']);
  assert.deepEqual(r.avisos, ['  ! No se pudo actualizar la clasificación del grupo 3941 (DOMPAVOLEI XF1) desde la federación '
    + '(respuesta 404 Not Found): se enseña la guardada y no se vuelve a pedir hasta que cambien sus partidos.']);
  assert.equal(r.resultado.filas.length, 11);
  assert.deepEqual([r.resultado.fallo.motivo, r.resultado.fallo.estado], ['respuesta 404 Not Found', 404]);
  // A la hora siguiente, las que quedaron sin pedir; la que no existe (404), no, mientras no cambien sus partidos.
  const luego = await actualizar(t, { ruta, cfg, ahora: fechaPared(2026, 11, 6, 21, 0) });
  assert.deepEqual(nombres(luego.pedidas), ['grupo 3941', 'grupo 3818', 'clasificacion 3818', 'clasificacion 4064']);
  assert.deepEqual([luego.avisos, luego.resultado.fallo], [[], null]);
});

test('actualizarFederacion: si falla la clasificación justo cuando el grupo termina, se pide (solo ella) en la siguiente ejecución', async (t) => {
  const ruta = carpeta(t);
  await actualizar(t, { ruta });
  const jugada = LIGA.replaceAll("<i-t page='common'>Pendiente</i-t>", "<i-t page='common'>Finalizado</i-t>");
  const fin = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 21, 0) }, { 'grupo 3941': jugada, 'clasificacion 3941': 503 });
  assert.equal(fin.error, null);
  assert.deepEqual(nombres(fin.pedidas), ['grupo 3941', 'clasificacion 3941', 'clasificacion 3941', 'clasificacion 3941']);
  assert.equal(fin.avisos.at(-1), '  ! No se pudo actualizar la clasificación del grupo 3941 (DOMPAVOLEI XF1) desde la federación '
    + '(respuesta 503 Service Unavailable): se enseña la guardada y se vuelve a pedir en la próxima ejecución.');
  const g = fin.resultado.cache.grupos['3941'];
  assert.equal(g.terminado, true);
  assert.notEqual(g.firma_clasificacion, g.firma);
  // Ya terminado, su página no se vuelve a pedir; su clasificación final, sí.
  const luego = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 22, 0) }, { 'grupo 3941': jugada });
  assert.deepEqual(nombres(luego.pedidas), ['clasificacion 3941']);
  const h = luego.resultado.cache.grupos['3941'];
  assert.equal(h.firma_clasificacion, h.firma);
});

test('actualizarFederacion: fases nuevas cuando el club ya ha terminado sus grupos: su lista de grupos se mira una vez al día', async (t) => {
  assert.deepEqual([HORAS_REPASO, DIAS_REPASO], [20, 60]);
  const ruta = carpeta(t);
  const pide = (ahora, cambios = {}) => actualizar(t, { ruta, cfg: CFG_APERTURA, ahora }, cambios);
  // 19/09 por la noche: el grupo de la primera fase ya está terminado y la segunda, sin equipos todavía.
  const primera = await pide(fechaPared(2026, 9, 19, 22, 0), { 'grupo 4064': SIN_FASE_2 });
  assert.deepEqual(nombres(primera.pedidas), ['grupo 4064', 'clasificacion 4064']);
  assert.deepEqual(Object.keys(primera.resultado.cache.grupos), ['4064']);
  // Hasta pasadas 20 horas no se vuelve a mirar.
  assert.deepEqual(nombres((await pide(fechaPared(2026, 9, 20, 10, 0), { 'grupo 4064': SIN_FASE_2 })).pedidas), []);
  // A las 20 horas: la federación ya ha puesto al IF1 en el 3818, que se pide en la misma ejecución.
  const fase = await pide(fechaPared(2026, 9, 20, 18, 0));
  assert.equal(fase.error, null);
  assert.deepEqual(nombres(fase.pedidas), ['grupo 4064', 'grupo 3818', 'clasificacion 3818']);
  assert.deepEqual(Object.keys(fase.resultado.cache.grupos), ['3818', '4064']);
  assert.equal(fase.resultado.filas.length, 6);
  // Con un grupo sin terminar en la competición ya no hace falta: se pide ese.
  assert.deepEqual(nombres((await pide(fechaPared(2026, 9, 21, 10, 0))).pedidas), ['grupo 3818']);
});

test('actualizarFederacion: si falla el repaso de las fases, es un aviso y no se vuelve a mirar hasta el día siguiente', async (t) => {
  const ruta = carpeta(t);
  const pide = (ahora, cambios = {}) => actualizar(t, { ruta, cfg: CFG_APERTURA, ahora }, cambios);
  await pide(fechaPared(2026, 9, 19, 22, 0), { 'grupo 4064': SIN_FASE_2 });
  const falla = await pide(fechaPared(2026, 9, 20, 18, 0), { 'grupo 4064': 403 });
  assert.equal(falla.error, null);
  assert.deepEqual(nombres(falla.pedidas), ['grupo 4064']);
  assert.deepEqual(falla.avisos, ['  ! No se pudo mirar en la página del grupo 4064 (DOMPAVOLEI IF1) si hay fases nuevas de '
    + `${APERTURA} (respuesta 403 Forbidden): se vuelve a mirar mañana.`]);
  assert.deepEqual(nombres((await pide(fechaPared(2026, 9, 20, 19, 0))).pedidas), []);
  assert.deepEqual(nombres((await pide(fechaPared(2026, 9, 21, 14, 0))).pedidas), ['grupo 4064', 'grupo 3818', 'clasificacion 3818']);
});

test('actualizarFederacion: pasados 60 días del último partido del club en una competición acabada, ya no se mira su lista de grupos', async (t) => {
  const ruta = carpeta(t);
  const pide = (ahora) => actualizar(t, { ruta, cfg: CFG_APERTURA, ahora }, { 'grupo 4064': SIN_FASE_2 });
  await pide(fechaPared(2026, 9, 19, 22, 0));
  // Su último partido fue el 19/09: el 17/11 todavía se mira; el 19/11, ya no.
  assert.deepEqual(nombres((await pide(fechaPared(2026, 11, 17, 12, 0))).pedidas), ['grupo 4064']);
  assert.deepEqual(nombres((await pide(fechaPared(2026, 11, 19, 12, 0))).pedidas), []);
});

test('actualizarFederacion: un grupo que aún no tiene partidos (apuntado en config.json o una fase nueva) es un aviso, no un error', async (t) => {
  const ruta = carpeta(t);
  const cfg = { federacion: { grupos: [...CFG.federacion.grupos, { equipo: 'DOMPAVOLEI XF2', grupo: '4600', competicion: '1537' }] } };
  const r = await actualizar(t, { ruta, cfg }, { 'grupo 4600': SIN_PARTIDOS });
  assert.equal(r.error, null);
  // Sin partidos no hay clasificación que pedir ni es que el club no juegue en él.
  assert.deepEqual(nombres(r.pedidas), ['grupo 3941', 'grupo 4600', 'clasificacion 3941']);
  assert.deepEqual(r.avisos, ['  ! El grupo 4600 (DOMPAVOLEI XF2) aún no tiene partidos en la federación: se vuelve a mirar en la próxima ejecución.']);
  assert.deepEqual([r.resultado.cache.grupos['4600'].consultado, r.resultado.cache.grupos['4600'].terminado], ['2026-11-06 20:00', false]);

  // Una fase nueva en la lista de grupos (con el XF1) y aún sin calendario: igual, y se sigue mirando hasta que lo tenga.
  const otra = carpeta(t);
  await actualizar(t, { ruta: otra });
  const fase = await actualizar(t, { ruta: otra, ahora: fechaPared(2026, 11, 6, 21, 0) }, { 'grupo 3941': conFase(LIGA, '4500'), 'grupo 4500': SIN_PARTIDOS });
  assert.equal(fase.error, null);
  assert.deepEqual(nombres(fase.pedidas), ['grupo 3941', 'grupo 4500']);
  assert.deepEqual(fase.avisos, ['  ! El grupo 4500 (DOMPAVOLEI XF1) aún no tiene partidos en la federación: se vuelve a mirar en la próxima ejecución.']);
  const luego = await actualizar(t, { ruta: otra, ahora: fechaPared(2026, 11, 6, 22, 0) },
    { 'grupo 3941': conFase(LIGA, '4500'), 'grupo 4500': LIGA, 'clasificacion 4500': PAGINAS['clasificacion 3941'] });
  assert.deepEqual(nombres(luego.pedidas), ['grupo 3941', 'grupo 4500', 'clasificacion 4500']);
  assert.equal(luego.resultado.cache.grupos['4500'].partidos.length, 5);
});

test('actualizarFederacion: un grupo quitado de config.json, con su competición, se olvida: ni se pide ni salen sus partidos', async (t) => {
  const ruta = carpeta(t);
  const cfg = { federacion: { grupos: [...CFG.federacion.grupos, ...CFG_APERTURA.federacion.grupos] } };
  const antes = await actualizar(t, { ruta, cfg });
  assert.deepEqual(Object.keys(antes.resultado.cache.grupos), ['3818', '3941', '4064']);
  // Se quita el 4064 de config.json: se va con la fase que salió de su página (3818), que es de la misma competición.
  const despues = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 21, 0) });
  assert.equal(despues.error, null);
  assert.deepEqual(nombres(despues.pedidas), ['grupo 3941']);
  assert.deepEqual(despues.avisos, ['  Se quitan de resultados.json los grupos 3818, 4064: su competición ya no está en config.json.']);
  assert.deepEqual(Object.keys(despues.resultado.cache.grupos), ['3941']);
  assert.deepEqual(Object.keys(despues.resultado.cache.competiciones), [XUVENIL]);
  assert.equal(despues.resultado.filas.length, 5);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(ruta, 'utf8')).grupos), ['3941']);
});

test('actualizarFederacion: una fase que no está en config.json y lleva 48 horas sin leerse: el error dice cómo quitarla', async (t) => {
  const ruta = carpeta(t);
  await actualizar(t, { ruta, cfg: CFG_APERTURA, ahora: fechaPared(2026, 9, 26, 0, 30) });
  const r = await actualizar(t, { ruta, cfg: CFG_APERTURA, ahora: fechaPared(2026, 9, 28, 1, 0) }, { 'grupo 3818': 404 });
  assert.deepEqual(nombres(r.pedidas), ['grupo 3818']);
  assert.equal(r.error.message, 'No se pudo actualizar el grupo 3818 (DOMPAVOLEI IF1) desde la federación (respuesta 404 Not Found).\n'
    + '    No hay una copia de menos de 48 horas de: el grupo 3818 (DOMPAVOLEI IF1). No se ha cambiado ningún archivo.\n'
    + '    El grupo 3818 no está en config.json: es una fase que salió en la página de su competición. Si la federación ya no lo '
    + 'tiene, bórralo de resultados.json.');
});

test('actualizarFederacion: si solo cambia la hora de consulta, resultados.json no se reescribe (como mucho, cada 12 horas)', async (t) => {
  assert.equal(HORAS_GUARDAR, 12);
  const ruta = carpeta(t);
  await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 9, 8, 17) });
  const guardado = readFileSync(ruta, 'utf8');
  // Una hora después, la misma página: el archivo no cambia (el workflow no sube nada), aunque la caché va al día.
  const otra = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 9, 9, 17) });
  assert.deepEqual(nombres(otra.pedidas), ['grupo 3941']);
  assert.equal(otra.resultado.cache.grupos['3941'].consultado, '2026-11-09 09:17');
  assert.equal(readFileSync(ruta, 'utf8'), guardado);
  // A las 12 horas de la guardada, sí: la regla de las 48 horas la lee en la próxima ejecución.
  await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 9, 20, 17) });
  assert.equal(JSON.parse(readFileSync(ruta, 'utf8')).grupos['3941'].consultado, '2026-11-09 20:17');
  // Y siempre que cambie algo de la federación.
  const aplazado = LIGA.replace("<i-t page='common'>Pendiente</i-t>", "<i-t page='common'>Aplazado</i-t>");
  await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 9, 21, 17) }, { 'grupo 3941': aplazado });
  assert.equal(JSON.parse(readFileSync(ruta, 'utf8')).grupos['3941'].consultado, '2026-11-09 21:17');
});

test('actualizarFederacion: un partido del club sin escudo se reconoce por el nombre de un equipo del club ya conocido', async (t) => {
  const ruta = carpeta(t);
  await actualizar(t, { ruta });
  // La federación deja sin escudo al XF1 en el partido 98199.
  const i = LIGA.indexOf('data-id="98199"');
  const j = LIGA.indexOf('<tr', i);
  const sinEscudo = LIGA.slice(0, i) + LIGA.slice(i, j).replaceAll(`afiliacion_clubs/${DOMPA}/`, 'escudos/') + LIGA.slice(j);
  const r = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 21, 0) }, { 'grupo 3941': sinEscudo });
  const p = r.resultado.cache.grupos['3941'].partidos.find((x) => x.id === '98199');
  assert.equal(p.clubVisitante, '');
  assert.equal(r.resultado.filas.find((f) => f.id_partido === '98199').id_club_visitante, DOMPA);
});

// resultados.json con el grupo 4064 terminado tal como se guardaba antes de noviembre de 2026 (sin id, ID de los
// clubs, pabellón ni lugar en sus partidos), y el 3818 y el 3941, sin terminar, consultados hace una hora.
function copiaConGrupoViejo(ruta) {
  const esNuestro = (_nombre, club) => club === DOMPA;
  const cache = { temporada: 2026, clubs: [DOMPA], competiciones: {}, grupos: {} };
  const hace = fechaPared(2026, 11, 6, 19, 0);
  anotarGrupos(cache, APERTURA, '1511', leerGrupos(PAGINAS['grupo 4064']), esNuestro);
  anotarResultados(cache.grupos['4064'], leerResultados(PAGINAS['grupo 4064']), esNuestro, fechaPared(2026, 9, 25, 11, 16));
  anotarResultados(cache.grupos['3818'], leerResultados(PAGINAS['grupo 3818']), esNuestro, hace);
  anotarGrupos(cache, XUVENIL, '1537', leerGrupos(LIGA), esNuestro);
  anotarResultados(cache.grupos['3941'], leerResultados(LIGA), esNuestro, hace);
  for (const g of Object.values(cache.grupos)) g.firma_clasificacion = g.firma;
  const viejo = cache.grupos['4064'];
  viejo.partidos = viejo.partidos.map(({ local, visitante, dia, hora, estado, marcador, sets }) => ({ local, visitante, dia, hora, estado, marcador, sets }));
  writeFileSync(ruta, JSON.stringify(cache));
  return cache;
}

test('actualizarFederacion: un grupo terminado guardado con el formato viejo se pide una vez para completarlo', async (t) => {
  const ruta = carpeta(t);
  copiaConGrupoViejo(ruta);
  const cfg = { federacion: { grupos: [...CFG.federacion.grupos, ...CFG_APERTURA.federacion.grupos] } };
  const primera = await actualizar(t, { ruta, cfg });
  assert.equal(primera.error, null);
  assert.deepEqual(primera.avisos, []);
  // Primero los grupos sin terminar (los de config.json delante); al final, el que hay que completar. Sin cambios en
  // sus partidos (la misma firma): sin clasificación.
  assert.deepEqual(nombres(primera.pedidas), ['grupo 3941', 'grupo 3818', 'grupo 4064']);
  const g = primera.resultado.cache.grupos['4064'];
  assert.ok(g.partidos.every((p) => Object.hasOwn(p, 'campo') && [p.clubLocal, p.clubVisitante].includes(DOMPA)));
  assert.equal(g.partidos[0].campo, 'POLIDEPORTIVO DE LOS INSTITUTOS, PISTA 2');
  assert.equal(g.consultado, '2026-11-06 20:00');
  // Ya completo: no se vuelve a pedir.
  const segunda = await actualizar(t, { ruta, cfg, ahora: fechaPared(2026, 11, 6, 21, 0) });
  assert.deepEqual(nombres(segunda.pedidas), ['grupo 3941', 'grupo 3818']);
});

test('actualizarFederacion: si no se puede completar un grupo terminado, aviso y se sigue con sus partidos guardados', async (t) => {
  const ruta = carpeta(t);
  copiaConGrupoViejo(ruta);
  const cfg = { federacion: { grupos: [...CFG.federacion.grupos, ...CFG_APERTURA.federacion.grupos] } };
  const { error, avisos, pedidas, resultado } = await actualizar(t, { ruta, cfg }, { 'grupo 4064': 403 });
  assert.equal(error, null);
  assert.deepEqual(nombres(pedidas), ['grupo 3941', 'grupo 3818', 'grupo 4064']);
  assert.deepEqual(avisos, ['  ! No se pudo completar el grupo 4064 (DOMPAVOLEI IF1), ya terminado, con la página de la federación '
    + '(respuesta 403 Forbidden): se usan sus partidos guardados, sin pabellón.']);
  // Sus dos partidos (los del 19/09) siguen en las filas, con el ID del club puesto por el nombre del equipo.
  const viejas = resultado.filas.filter((f) => f.fecha_calendario === '2026-09-19');
  assert.deepEqual(viejas.map((f) => [f.nombre_local, f.id_club_local, f.nombre_visitante, f.id_club_visitante, f.campo, f.nombre_competicion]), [
    ['EMEVÉ COLEXIO SAN LORENZO IF', '', 'DOMPAVOLEI IF1', DOMPA, '', APERTURA],
    ['DOMPAVOLEI IF1', DOMPA, 'CLUB VOLEIBOL PONTEVEDRA IF2', '', '', APERTURA],
  ]);
  // 5 del 3941, 4 del 3818 y 2 del 4064.
  assert.equal(convertirPartidos(resultado.filas, IDS).length, 11);
});

test('actualizarFederacion: un grupo terminado con el formato viejo cuya página ya no existe (404) no se vuelve a pedir', async (t) => {
  const ruta = carpeta(t);
  copiaConGrupoViejo(ruta);
  const cfg = { federacion: { grupos: [...CFG.federacion.grupos, ...CFG_APERTURA.federacion.grupos] } };
  const r = await actualizar(t, { ruta, cfg }, { 'grupo 4064': 404 });
  assert.equal(r.error, null);
  assert.deepEqual(r.avisos, ['  ! No se pudo completar el grupo 4064 (DOMPAVOLEI IF1), ya terminado, con la página de la federación '
    + '(respuesta 404 Not Found): se usan sus partidos guardados, sin pabellón, y no se vuelve a pedir.']);
  // Así no se pide cada hora ni deja sin completar a los que vayan detrás.
  const luego = await actualizar(t, { ruta, cfg, ahora: fechaPared(2026, 11, 6, 21, 0) }, { 'grupo 4064': 404 });
  assert.deepEqual([luego.error, luego.avisos], [null, []]);
  assert.deepEqual(nombres(luego.pedidas), ['grupo 3941', 'grupo 3818']);
  assert.equal(luego.resultado.filas.filter((f) => f.fecha_calendario === '2026-09-19').length, 2);
});

test('actualizarFederacion: cambio de temporada: las filas de la anterior, en «anterior», y se empieza una caché nueva', async (t) => {
  const ruta = carpeta(t);
  const vieja = await actualizar(t, { ruta, anio: 2025 });
  assert.equal(vieja.resultado.cache.temporada, 2025);
  const nueva = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 21, 0) });
  assert.equal(nueva.error, null);
  assert.deepEqual(nueva.resultado.anterior, vieja.resultado.filas);
  assert.equal(nueva.resultado.cache.temporada, 2026);
  assert.deepEqual(nombres(nueva.pedidas), ['grupo 3941', 'clasificacion 3941']);
  assert.equal(JSON.parse(readFileSync(ruta, 'utf8')).temporada, 2026);
  // De otra temporada (ni esta ni la anterior) o de otros clubs: no es la anterior.
  writeFileSync(ruta, JSON.stringify({ ...vieja.resultado.cache, temporada: 2024 }));
  assert.deepEqual((await actualizar(t, { ruta, guardar: false })).resultado.anterior, []);
  writeFileSync(ruta, JSON.stringify({ ...vieja.resultado.cache, clubs: ['1'] }));
  assert.deepEqual((await actualizar(t, { ruta, guardar: false })).resultado.anterior, []);
});

test('actualizarFederacion: resultados.json ilegible, o con grupos sin su competición: se empieza de cero o se dejan', async (t) => {
  const ruta = carpeta(t);
  writeFileSync(ruta, '{');
  const ilegible = await actualizar(t, { ruta });
  assert.equal(ilegible.error, null);
  assert.match(ilegible.avisos[0], /^ {2}! resultados\.json no se puede leer \(.*\); se vuelven a descargar todos los grupos\.$/);
  assert.deepEqual(nombres(ilegible.pedidas), ['grupo 3941', 'clasificacion 3941']);
  // Un grupo sin el número de su competición no se puede pedir: se quita (si es del club, la página lo vuelve a apuntar).
  const copia = JSON.parse(readFileSync(ruta, 'utf8'));
  copia.grupos['9999'] = { competicion: 'X', nombre: '', equipos: [], consultado: '', terminado: false, partidos: [] };
  copia.grupos['9998'] = 'no es un grupo';
  writeFileSync(ruta, JSON.stringify(copia));
  const raro = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 6, 21, 0) });
  assert.equal(raro.error, null);
  assert.deepEqual(nombres(raro.pedidas), ['grupo 3941']);
  assert.deepEqual(Object.keys(raro.resultado.cache.grupos), ['3941']);
});

test('actualizarFederacion: una página sin el formato de siempre es un fallo, con un mensaje claro', async (t) => {
  const ruta = carpeta(t);
  // Ningún partido con fecha: la página ha cambiado. Uno solo sin fecha no es un fallo (la prueba siguiente).
  const sinFechas = LIGA.replace(/\d{2}\/\d{2}\/\d{4}/g, '');
  const casos = [
    ['<html>otra cosa</html>', 'no tiene la lista de partidos'],
    [sinFechas, 'ningún partido tiene fecha'],
  ];
  for (const [html, falta] of casos) {
    const { error, pedidas } = await actualizar(t, { ruta }, { 'grupo 3941': html });
    assert.deepEqual(nombres(pedidas), ['grupo 3941']);
    assert.match(error.message, new RegExp(`^No se pudo actualizar el grupo 3941 \\(DOMPAVOLEI XF1\\) desde la federación `
      + `\\(la página no tiene el formato de siempre: ${falta}; puede que la federación la haya cambiado\\)\\.\\n`));
  }
  assert.equal(existsSync(ruta), false);
  // Sin partidos, cuando el grupo ya tenía partidos del club: con lo guardado de hace menos de 48 h, aviso; si no, error.
  await actualizar(t, { ruta });
  const { error, avisos } = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 7, 20, 0) }, { 'grupo 3941': SIN_PARTIDOS });
  assert.equal(error, null);
  assert.match(avisos[0], /no tiene ningún partido; puede que la federación la haya cambiado\)\. Hasta la próxima ejecución se usa lo guardado/);
  const tarde = await actualizar(t, { ruta, ahora: fechaPared(2026, 11, 8, 20, 0) }, { 'grupo 3941': SIN_PARTIDOS });
  assert.match(tarde.error.message, /\(la página no tiene el formato de siempre: no tiene ningún partido; puede que la federación la haya cambiado\)\.\n/);
});

test('actualizarFederacion: un partido sin fecha (uno aplazado, por ejemplo) no para el grupo: aviso, y no sale hasta que la tenga', async (t) => {
  const ruta = carpeta(t);
  // El XAV CAMBADOS AZUL - DOMPAVOLEI XF1 del 08/11 (98199), sin fecha; los otros 6 partidos, como siempre.
  const { error, avisos, resultado } = await actualizar(t, { ruta }, { 'grupo 3941': LIGA.replace('08/11/2026', '') });
  assert.equal(error, null);
  assert.deepEqual(avisos, ['  ! Un partido del club en el grupo 3941 (DOMPAVOLEI XF1) no tiene fecha en la federación: no sale en '
    + 'el calendario hasta que la tenga.']);
  assert.equal(resultado.filas.length, 5);
  assert.deepEqual(resultado.filas.filter((f) => !f.fecha_calendario).map((f) => f.id_partido), ['98199']);
  // Como con la agenda, convertirPartidos lo deja fuera (con su aviso) y los otros 4 del club siguen.
  const consola = t.mock.method(console, 'log', () => {});
  assert.equal(convertirPartidos(resultado.filas, IDS).length, 4);
  consola.mock.restore();
});

test('actualizarFederacion: un grupo de config.json sin partidos del club es un aviso, no un error', async (t) => {
  const ruta = carpeta(t);
  const { error, avisos, resultado } = await actualizar(t, { ruta, ids: new Set(['999']) });
  assert.equal(error, null);
  assert.deepEqual(avisos, ['  ! En el grupo 3941 (DOMPAVOLEI XF1) de config.json no hay ningún partido del club: revisa federacion.grupos en config.json.']);
  assert.deepEqual(resultado.filas, []);
});

test('actualizarFederacion: sin federacion.grupos en config.json, error antes de pedir nada', async (t) => {
  const ruta = carpeta(t);
  const { error, pedidas } = await actualizar(t, { ruta, cfg: { clubs: [{ id: DOMPA }] } });
  assert.match(error.message, /federacion\.grupos/);
  assert.deepEqual(pedidas, []);
  assert.equal(existsSync(ruta), false);
});

test('actualizarFederacion: si la federación tarda demasiado, deja de pedir páginas (cabe en el tiempo del workflow)', async (t) => {
  const ruta = carpeta(t);
  const cfg = { federacion: { grupos: [...CFG.federacion.grupos, ...CFG_APERTURA.federacion.grupos] } };
  // El 3941 a los 0 s; el 4064, a los 1,5 s, ya no cabe en 1,4 s.
  const { error, pedidas } = await actualizar(t, { ruta, cfg, plazo: 1400 });
  assert.deepEqual(nombres(pedidas), ['grupo 3941']);
  assert.equal(error.message, 'No se pudo actualizar el grupo 4064 (DOMPAVOLEI IF1) desde la federación (la federación tarda demasiado: '
    + 'se deja para la próxima ejecución).\n    No hay una copia de menos de 48 horas de: el grupo 4064 (DOMPAVOLEI IF1). No se ha cambiado ningún archivo.');
  assert.equal(existsSync(ruta), false);
});
