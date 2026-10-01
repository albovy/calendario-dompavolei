// Pruebas de src/manuales.js: las horas puestas a mano desde la web (salidas-manuales.json): la salida del bus
// de los partidos de fuera y el calentamiento de los de casa.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aplicarCambio, aplicarManuales, configEdicion, guardarManuales, interpretarCambio, leerManuales, textoPartido,
} from '../src/manuales.js';
import { lineasSalida } from '../src/salidas.js';
import { fechaPared, fmt } from '../src/util.js';

const MODULO = fileURLToPath(new URL('../src/manuales.js', import.meta.url));
const UID = 'a1b2c3d4e5f60718293a4b5c@calendario-voley';
const AHORA = new Date('2026-10-01T16:00:00Z');
const OLEIROS = 'id:a1b2c3d4 · 2026-10-03 11:30 · CV OLEIROS IFA vs DOMPAVOLEI IF1';

// Partido de fuera a las 11:30 con 75 min de bus: calentamiento 10:30, salida calculada 09:00 (a la media).
function partido(campos = {}) {
  return {
    fecha: fechaPared(2026, 10, 3, 11, 30), estado: 'confirmada', local: 'CV OLEIROS IFA', visitante: 'DOMPAVOLEI IF1',
    uid: UID, enCasa: false, segundo: false, viajeMin: 75, calentamiento: fechaPared(2026, 10, 3, 10, 30),
    salida: fechaPared(2026, 10, 3, 9, 0), inicio: fechaPared(2026, 10, 3, 9, 0), salidaPrimero: null, ...campos,
  };
}
// Partido en casa a las 12:00: calentamiento (e inicio) a las 11:00.
function enCasa(campos = {}) {
  return partido({
    fecha: fechaPared(2026, 10, 4, 12, 0), local: 'DOMPAVOLEI IF1', visitante: 'CV RIVAL', uid: 'b1b2c3d4000@x', enCasa: true,
    viajeMin: null, salida: null, calentamiento: fechaPared(2026, 10, 4, 11, 0), inicio: fechaPared(2026, 10, 4, 11, 0), ...campos,
  });
}
const entrada = (campos) => ({ partido: '2026-10-03 11:30', tipo: 'salida', hora: '09:30', texto: 'A vs B', cambiado: 'y', ...campos });
const hm = (d) => fmt(d, 'HH:mm');

test('manuales: el texto del partido (el que manda la web) y su lectura', () => {
  assert.equal(textoPartido(partido()), OLEIROS);
  assert.deepEqual(interpretarCambio(OLEIROS, '08:00'),
    { id: 'a1b2c3d4', partido: '2026-10-03 11:30', texto: 'CV OLEIROS IFA vs DOMPAVOLEI IF1', tipo: 'salida', hora: '08:00' });
  assert.equal(interpretarCambio(OLEIROS, '10:45', 'calentamiento').tipo, 'calentamiento');
  // Hora vacía: quitar la hora a mano. Espacios alrededor, fuera.
  assert.equal(interpretarCambio(` ${OLEIROS} `, ' ').hora, '');
  assert.equal(interpretarCambio(OLEIROS, '7:05').hora, '07:05');
  assert.equal(interpretarCambio(OLEIROS, '11:29').hora, '11:29');
});

test('manuales: entradas que no valen (lo que llegue del workflow puede venir de cualquiera con la llave)', () => {
  const malos = [
    ['id:A1B2C3D4 · 2026-10-03 11:30 · A vs B', '08:00', 'salida', /partido/],     // id en mayúsculas
    ['id:a1b2c3 · 2026-10-03 11:30 · A vs B', '08:00', 'salida', /partido/],       // id corto
    ['id:a1b2c3d4 · 2026-13-03 11:30 · A vs B', '08:00', 'salida', /partido/],     // mes 13
    ['id:a1b2c3d4 · 2026-10-03 25:30 · A vs B', '08:00', 'salida', /partido/],     // hora 25
    ['id:a1b2c3d4 · 2026-10-03 11:30', '08:00', 'salida', /partido/],              // sin equipos
    [`id:a1b2c3d4 · 2026-10-03 11:30 · ${'X'.repeat(300)}`, '08:00', 'salida', /partido/],
    ['id:a1b2c3d4 · 2026-10-03 11:30 · A vs B\n$(rm -rf /)', '08:00', 'salida', /partido/],
    ['', '08:00', 'salida', /partido/],
    [OLEIROS, '24:00', 'salida', /hora/],
    [OLEIROS, '8.00', 'salida', /hora/],
    [OLEIROS, '08:00; echo', 'salida', /hora/],
    // Antes del partido: 18:30 por 06:30 (un selector de 12 horas) haría un evento que acaba antes de empezar.
    [OLEIROS, '11:30', 'salida', /antes del partido \(11:30\)/],
    [OLEIROS, '18:30', 'calentamiento', /antes del partido/],
    [OLEIROS, '08:00', 'bus', /tipo/],
    [OLEIROS, '08:00', '', /tipo/],
    // Nada que el registro de GitHub Actions pueda tomar por una orden («::» o «##[»), ni caracteres de control.
    ['id:a1b2c3d4 · 2026-10-03 11:30 · x ##[error]Falso', '08:00', 'salida', /partido/],
    ['id:a1b2c3d4 · 2026-10-03 11:30 · x ::warning::y', '08:00', 'salida', /partido/],
    ['id:a1b2c3d4 · 2026-10-03 11:30 · A\u2028B', '08:00', 'salida', /partido/],
    ['id:a1b2c3d4 · 2026-10-03 11:30 · A\u0007B', '08:00', 'salida', /partido/],
  ];
  for (const [texto, hora, tipo, error] of malos) {
    assert.throws(() => interpretarCambio(texto, hora, tipo), error, JSON.stringify([texto, hora, tipo]));
  }
  // Lo que llega no sale en el mensaje de error.
  for (const [hora, tipo] of [['##[warning]zz', 'salida'], ['08:00', '##[error]x']]) {
    assert.throws(() => interpretarCambio(OLEIROS, hora, tipo), (e) => !e.message.includes('##['), JSON.stringify([hora, tipo]));
  }
});

test('manuales: guardar un cambio (vale el último), la misma hora otra vez no cambia nada, y quitarlo con la hora vacía', () => {
  let datos = {};
  datos = aplicarCambio(datos, interpretarCambio('id:a1b2c3d4 · 2026-10-03 11:30 · A vs B', '08:00'), AHORA);
  datos = aplicarCambio(datos, interpretarCambio('id:a1b2c3d4 · 2026-10-03 11:30 · A vs B', '07:45'), AHORA);
  datos = aplicarCambio(datos, interpretarCambio('id:ffffffff · 2026-10-04 12:00 · C vs D', '10:30', 'calentamiento'), AHORA);
  assert.deepEqual(datos, {
    a1b2c3d4: { partido: '2026-10-03 11:30', tipo: 'salida', hora: '07:45', texto: 'A vs B', cambiado: '2026-10-01T16:00:00.000Z' },
    ffffffff: { partido: '2026-10-04 12:00', tipo: 'calentamiento', hora: '10:30', texto: 'C vs D', cambiado: '2026-10-01T16:00:00.000Z' },
  });
  // La misma hora otra vez: nada cambia (ni la fecha del cambio: así no hay commit).
  const igual = aplicarCambio(datos, interpretarCambio('id:ffffffff · 2026-10-04 12:00 · C vs D', '10:30', 'calentamiento'), new Date('2026-10-02T08:00:00Z'));
  assert.equal(igual.ffffffff.cambiado, '2026-10-01T16:00:00.000Z');
  datos = aplicarCambio(datos, interpretarCambio('id:a1b2c3d4 · 2026-10-03 11:30 · A vs B', ''), AHORA);
  assert.deepEqual(Object.keys(datos), ['ffffffff']);
});

test('manuales: leer y guardar el archivo (sin archivo o roto: vacío, con aviso si está roto)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'manuales-'));
  try {
    const ruta = join(dir, 'salidas-manuales.json');
    assert.deepEqual(leerManuales(ruta), {});
    guardarManuales(ruta, { zzzzzzzz: entrada({ hora: '07:00' }), a1b2c3d4: entrada({ hora: '08:00' }) });
    // Ordenado por id y legible (así el historial de cambios del repositorio se lee bien).
    assert.equal(readFileSync(ruta, 'utf8').indexOf('a1b2c3d4') < readFileSync(ruta, 'utf8').indexOf('zzzzzzzz'), true);
    assert.ok(readFileSync(ruta, 'utf8').endsWith('}\n'));
    assert.equal(leerManuales(ruta).a1b2c3d4.hora, '08:00');
    // Con BOM (Windows) también se lee.
    writeFileSync(ruta, `\uFEFF${readFileSync(ruta, 'utf8')}`);
    assert.equal(leerManuales(ruta).a1b2c3d4.hora, '08:00');
    writeFileSync(ruta, '{roto');
    const avisos = [];
    t.mock.method(console, 'log', (x) => avisos.push(x));
    assert.deepEqual(leerManuales(ruta), {});
    assert.match(avisos[0], /salidas-manuales\.json no se puede leer/);
    // Al guardar (el workflow), uno que no se puede leer no se pisa: error.
    for (const malo of ['{roto', '[1, 2]', 'null', '{"a": 1,}']) {
      writeFileSync(ruta, malo);
      assert.throws(() => leerManuales(ruta, { estricto: true }), /salidas-manuales\.json no se puede leer/, malo);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('manuales: salida a mano más tarde: el partido no se mueve, el calentamiento empieza al llegar (y se acorta)', () => {
  const p = partido();
  const segundo = partido({ fecha: fechaPared(2026, 10, 3, 13, 0), uid: 'otro@x', segundo: true, salida: null, salidaPrimero: p });
  // 09:30 + 75 min de bus = 10:45: 45 min de calentamiento en vez de 60.
  const r = aplicarManuales([p, segundo], { a1b2c3d4: entrada({ hora: '09:30' }) });
  assert.deepEqual(r, { aplicadas: 1, caducadas: [] });
  assert.deepEqual([fmt(p.salida, 'yyyy-MM-dd HH:mm'), hm(p.inicio), hm(p.calentamiento), hm(p.fecha), p.horaManual],
    ['2026-10-03 09:30', '09:30', '10:45', '11:30', true]);
  assert.equal(hm(segundo.salidaPrimero.salida), '09:30');   // el 2.º del día va en ese bus
});

test('manuales: salida a mano antes de la calculada: se llega antes y hay más calentamiento', () => {
  const p = partido();
  aplicarManuales([p], { a1b2c3d4: entrada({ hora: '08:00' }) });
  assert.deepEqual([hm(p.salida), hm(p.calentamiento)], ['08:00', '09:15']);
});

test('manuales: si con esa salida se llegaría a la hora del partido o después (p. ej. el partido cambió de pabellón), no vale', () => {
  for (const hora of ['10:30', '10:15']) {
    const p = partido();
    const r = aplicarManuales([p], { a1b2c3d4: entrada({ hora }) });
    assert.equal(r.aplicadas, 0, hora);
    assert.match(r.caducadas[0], /^A vs B: con la salida a las 10:[13][05] y 1 h 15 min de viaje se llegaría a las 11:[34][05], y el partido es a las 11:30$/, hora);
    assert.deepEqual([hm(p.salida), hm(p.calentamiento)], ['09:00', '10:30']);   // lo calculado
  }
});

test('manuales: sin tiempo de viaje calculado, con la salida a mano no se inventa el calentamiento', () => {
  const q = partido({ viajeMin: null, salida: null });
  assert.deepEqual(aplicarManuales([q], { a1b2c3d4: entrada({ hora: '09:30' }) }), { aplicadas: 1, caducadas: [] });
  assert.deepEqual([hm(q.salida), q.calentamiento], ['09:30', null]);
  assert.deepEqual(lineasSalida(q, { origen: 'Os Remedios' }), ['Salida 09:30 desde Os Remedios', 'Partido 11:30']);
});

test('manuales: en casa, la hora a mano es la del calentamiento (y el inicio del evento)', () => {
  const p = enCasa();
  const r = aplicarManuales([p], { b1b2c3d4: entrada({ partido: '2026-10-04 12:00', tipo: 'calentamiento', hora: '11:15' }) });
  assert.deepEqual(r, { aplicadas: 1, caducadas: [] });
  assert.deepEqual([p.salida, hm(p.calentamiento), hm(p.inicio), p.horaManual], [null, '11:15', '11:15', true]);
});

test('manuales: si la federación cambió el partido, la hora a mano no vale y se avisa (fecha u hora, casa o fuera, 2.º del día)', () => {
  const movido = partido({ fecha: fechaPared(2026, 10, 3, 12, 0) });
  const ahoraEnCasa = enCasa({ uid: 'cccccccc000@x' });
  const ahoraFuera = partido({ uid: 'dddddddd000@x' });
  const segundo = partido({ uid: 'eeeeeeee000@x', segundo: true, salida: null, salidaPrimero: movido });
  const datos = {
    a1b2c3d4: entrada({ texto: 'CV OLEIROS IFA vs DOMPAVOLEI IF1' }),
    cccccccc: entrada({ partido: '2026-10-04 12:00', texto: 'E vs F' }),
    dddddddd: entrada({ tipo: 'calentamiento', texto: 'G vs H' }),
    eeeeeeee: entrada({ texto: 'I vs J' }),
  };
  const r = aplicarManuales([movido, ahoraEnCasa, ahoraFuera, segundo], datos);
  assert.deepEqual(r.aplicadas, 0);
  assert.deepEqual(r.caducadas, [
    'CV OLEIROS IFA vs DOMPAVOLEI IF1: era el 2026-10-03 11:30 y ahora es el 2026-10-03 12:00',
    'E vs F: era una salida en bus y ahora se juega en casa',
    'G vs H: era un calentamiento en casa y ahora se juega fuera',
    'I vs J: ahora es el 2.º partido del día (va con el 1.º)',
  ]);
  assert.equal(hm(movido.salida), '09:00');   // la calculada
  assert.equal(movido.horaManual, undefined);
  assert.equal(hm(ahoraEnCasa.calentamiento), '11:00');
});

test('manuales: una hora guardada que no es antes del partido, o un partido sin hora: no se aplica (y se avisa)', () => {
  const p = partido();
  assert.deepEqual(aplicarManuales([p], { a1b2c3d4: entrada({ hora: '12:00' }) }),
    { aplicadas: 0, caducadas: ['A vs B: la hora (12:00) no es antes del partido (11:30)'] });
  assert.equal(hm(p.salida), '09:00');
  const sinHora = partido({ estado: 'sin-hora', fecha: fechaPared(2026, 10, 3, 0, 0), salida: null, inicio: null });
  assert.deepEqual(aplicarManuales([sinHora], { a1b2c3d4: entrada({ partido: '2026-10-03 00:00', hora: '07:45' }) }),
    { aplicadas: 0, caducadas: ['A vs B: era el 2026-10-03 00:00 y ahora no tiene hora'] });
  assert.equal(sinHora.salida, null);
  // Un partido sin UID (los de prueba) no casa con nada.
  assert.deepEqual(aplicarManuales([partido({ uid: '' })], { '': entrada() }), { aplicadas: 0, caducadas: [] });
});

test('manuales: config.json › edicion (a dónde manda la página los cambios); sin ella o mal, no hay edición', (t) => {
  const avisos = [];
  t.mock.method(console, 'log', (x) => avisos.push(x));
  assert.equal(configEdicion(null), null);
  assert.equal(configEdicion({}), null);
  assert.deepEqual(configEdicion({ edicion: { repo: 'albovy/calendario-dompavolei' } }),
    { repo: 'albovy/calendario-dompavolei', workflow: 'salida.yml', rama: 'main' });
  assert.deepEqual(configEdicion({ edicion: { repo: 'a/b', workflow: 'otro.yaml', rama: 'publicar' } }), { repo: 'a/b', workflow: 'otro.yaml', rama: 'publicar' });
  assert.equal(avisos.length, 0);
  for (const edicion of [{ repo: 'solo-dueno' }, { repo: 'a/b/c' }, { repo: 'a b/c' }, { repo: 'a/b', workflow: '../x.yml' }, { repo: 'a/b', workflow: 'x.sh' },
    { repo: 'a/b', rama: 'x y' }, { repo: 'a/b', rama: '' }, 'a/b']) {
    assert.equal(configEdicion({ edicion }), null, JSON.stringify(edicion));
  }
  assert.equal(avisos.length, 8);
  assert.match(avisos[0], /config\.json: "edicion"/);
  // La llave cifrada con la contraseña de los entrenadores (la crea la página): pasa tal cual; si no tiene su
  // forma, se ignora (con aviso) y la edición sigue (con la llave).
  const cifrada = `v1.600000.${'A'.repeat(22)}.${'b'.repeat(16)}.${'c_-'.repeat(50)}`;
  assert.deepEqual(configEdicion({ edicion: { repo: 'a/b', cifrada } }), { repo: 'a/b', workflow: 'salida.yml', rama: 'main', cifrada });
  avisos.length = 0;
  for (const mala of ['github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'v1.600000.corta.x.y', `v1.600000.${'A'.repeat(22)}.${'b'.repeat(16)}.<script>`]) {
    assert.deepEqual(configEdicion({ edicion: { repo: 'a/b', cifrada: mala } }), { repo: 'a/b', workflow: 'salida.yml', rama: 'main' }, mala);
  }
  assert.equal(avisos.length, 3);
  assert.match(avisos[0], /"cifrada" no tiene la forma de una llave cifrada/);
});

test('manuales: por consola (el workflow): PARTIDO, TIPO y HORA en variables de entorno, guarda el archivo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manuales-'));
  try {
    const ruta = join(dir, 'salidas-manuales.json');
    const correr = (env) => spawnSync(process.execPath, [MODULO], { encoding: 'utf8', env: { ...process.env, ARCHIVO: ruta, ...env } });
    let r = correr({ PARTIDO: OLEIROS, TIPO: 'salida', HORA: '08:00' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Hora a mano: CV OLEIROS IFA vs DOMPAVOLEI IF1 \(2026-10-03 11:30\) → salida 08:00/);
    assert.equal(JSON.parse(readFileSync(ruta, 'utf8')).a1b2c3d4.hora, '08:00');
    r = correr({ PARTIDO: 'id:ffffffff · 2026-10-04 12:00 · C vs D', TIPO: 'calentamiento', HORA: '10:30' });
    assert.match(r.stdout, /→ calentamiento 10:30/);
    r = correr({ PARTIDO: OLEIROS, TIPO: 'salida', HORA: '' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /vuelve a la calculada/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ruta, 'utf8'))), ['ffffffff']);
    // Si salidas-manuales.json no se puede leer (p. ej. editado a mano y roto), error y no se toca: si no, este
    // cambio borraría todos los demás.
    writeFileSync(ruta, '{"ffffffff": {"hora": "10:30"},}');
    r = correr({ PARTIDO: OLEIROS, TIPO: 'salida', HORA: '08:00' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ERROR: salidas-manuales\.json no se puede leer/);
    assert.equal(readFileSync(ruta, 'utf8'), '{"ffffffff": {"hora": "10:30"},}');
    writeFileSync(ruta, '{}\n');
    r = correr({ PARTIDO: 'cualquier cosa', TIPO: 'salida', HORA: '08:00' });
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /ERROR: .*partido/);
    // Lo que llega no se copia tal cual en el registro: una línea que empezara por «::» sería una orden para
    // GitHub Actions (anotaciones, ocultar texto...).
    for (const env of [{ HORA: '9\n::error title=Falso::x\n::add-mask::y', TIPO: 'salida' }, { HORA: '08:00', TIPO: 'x\n::error::y' }, { HORA: '##[warning]zz', TIPO: 'salida' }]) {
      r = correr({ PARTIDO: 'id:a1b2c3d4 · 2026-10-03 11:30 · A vs B', ...env });
      assert.equal(r.status, 1);
      assert.match(r.stdout, /ERROR: /);
      assert.ok(!(r.stdout + r.stderr).split(/\r?\n/).some((l) => l.startsWith('::') || l.includes('##[')), r.stdout);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
