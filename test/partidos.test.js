// Pruebas de src/partidos.js (y de las partes de src/isquad.js que no usan la red). Los valores
// esperados salen de las funciones originales de calendario-voley.ps1 con las mismas entradas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarClubs, fechaCruda } from '../src/isquad.js';
import { conHora, convertirPartidos, equipos, formatHora } from '../src/partidos.js';

// Fila de iSquad con lo mínimo (los nombres pueden llevar HTML, como en la web).
function fila({ fecha, conf = '1', local = 'A', visit = 'B', idL = '1', idV = '2', comp = 'LIGA X', campo = 'P', cat = 'CADETE' }) {
  return {
    id_club_local: idL, id_club_visitante: idV, nombre_local: local, nombre_visitante: visit,
    nombre_competicion: comp, campo, categoria: cat, fecha, fecha_confirmada: conf, fecha_calendario: fecha.slice(0, 10),
  };
}

const CLUB = new Set(['1']);

// Ejecuta f sin escribir en la consola y devuelve [resultado, líneas escritas].
function enSilencio(f) {
  const lineas = [];
  const original = console.log;
  console.log = (texto) => lineas.push(texto);
  try {
    return [f(), lineas];
  } finally {
    console.log = original;
  }
}

function texto(d) { return d.toISOString().slice(0, 16).replace('T', ' '); }

test('estados de fecha y hora', () => {
  const ps = convertirPartidos([
    fila({ fecha: '2026-10-03 11:00:00', local: 'A1' }),
    fila({ fecha: '2026-10-04 00:00:00', local: 'A2' }),
    fila({ fecha: '2026-10-05 18:00:00', local: 'A3', conf: null }),
    fila({ fecha: '2026-10-06 00:00:00', local: 'A4', conf: null }),
  ], CLUB);
  assert.deepEqual(ps.map((p) => `${p.estado}=${formatHora(p)}`), [
    'confirmada=11:00', 'sinhora=Por confirmar', 'provisional=18:00 (provisional)', 'pendiente=Fecha y hora por confirmar',
  ]);
  assert.deepEqual(ps.map(conHora), [true, false, true, false]);
  // Un partido con segundos también tiene hora.
  const [p] = convertirPartidos([fila({ fecha: '2026-10-03 00:00:30' })], CLUB);
  assert.equal(p.estado, 'confirmada');
});

test('UID estable ante cambios de hora y de rango; distinta por temporada', () => {
  const u1 = convertirPartidos([fila({ fecha: '2026-10-03 00:00:00', conf: null }), fila({ fecha: '2027-03-06 12:00:00' })], CLUB);
  const u2 = convertirPartidos([fila({ fecha: '2026-10-04 18:30:00' }), fila({ fecha: '2027-03-06 12:00:00' })], CLUB);
  const u3 = convertirPartidos([fila({ fecha: '2027-10-02 12:00:00' })], CLUB);
  // Valores calculados con el .ps1: sha1("2026 LIGA X A B|1") (24 primeras cifras) + "@calendario-voley".
  assert.equal(u1[0].uid, '5bf465ad8c4e46ae63f82ade@calendario-voley');
  assert.equal(u1[1].uid, '6b6300aff28104088b0f6b59@calendario-voley');
  assert.equal(u3[0].uid, 'd950ba98c3a61de5d31e0231@calendario-voley');
  assert.equal(u2[0].uid, u1[0].uid, 'la UID cambió al cambiar la hora');
  assert.equal(u2[1].uid, u1[1].uid);
  assert.notEqual(u1[0].uid, u1[1].uid, 'ida y vuelta con la misma UID');
  assert.equal(u1[0].estado, 'pendiente');
  assert.equal(u2[0].estado, 'confirmada');
});

test('partidos repetidos, de otros clubs y sin fecha', () => {
  const [ps, consola] = enSilencio(() => convertirPartidos([
    fila({ fecha: '2026-10-03 11:00:00' }),
    fila({ fecha: '2026-10-03 11:00:00' }),                       // repetido: se descarta
    fila({ fecha: '2026-10-03 11:00:00', campo: 'OTRO' }),        // otro pabellón: es otro partido
    fila({ fecha: '2026-10-03 11:00:00', idL: '7', idV: '8' }),   // no es del club
    fila({ fecha: 'mañana' }),                                    // sin fecha
    { ...fila({ fecha: 'None' }), fecha_calendario: '' },         // sin fecha
    { ...fila({ fecha: '2026-10-10 12:00:00' }), fecha: '2026-10-10' },   // solo el día
    { ...fila({ fecha: '2026-02-30 12:00:00' }), fecha_calendario: '' },  // no existe
  ], CLUB));
  assert.deepEqual(ps.map((p) => `${texto(p.fecha)} ${p.pabellon} ${p.estado}`), [
    '2026-10-03 11:00 P confirmada', '2026-10-03 11:00 OTRO confirmada', '2026-10-10 00:00 P sinhora',
  ]);
  assert.deepEqual(consola, ['  ! 3 partido(s) sin fecha no se han incluido.']);
  assert.equal(fechaCruda({ fecha_calendario: '', fecha: '2026-10-03 11:00:00' }), '2026-10-03');
  assert.equal(fechaCruda({ fecha_calendario: '2026-10-04', fecha: '2026-10-03 11:00:00' }), '2026-10-04');
  assert.equal(fechaCruda({}), '');
});

test('local, visitante, derbi, nombres limpios y categoría', () => {
  const ps = convertirPartidos([
    fila({ fecha: '2026-10-03 11:00:00', local: '<div> <img src=x> DOMPAVOLEI IF1</div>', visit: 'RIVAL &amp; CIA', cat: 'INFANTIL', comp: 'TORNEO APERTURA INFANTIL F' }),
    fila({ fecha: '2026-10-04 11:00:00', idL: '9', idV: '1', local: 'OTROS', visit: 'DOMPAVOLEI SM', cat: 'SUPERLIGA 2', comp: 'SUPERLIGA 2 MASCULINA' }),
    fila({ fecha: '2026-10-05 11:00:00', idV: '1', local: 'DOMPAVOLEI CF1', visit: 'DOMPAVOLEI CF2', cat: 'PRIMERA DIVISION NACIONAL', comp: '1ª DIV. NACIONAL FEMENINA', campo: 'PM A PINGUELA<br>PM A PINGUELA - PISTA 1' }),
  ], CLUB);
  assert.deepEqual(ps.map((p) => [p.condicion, p.local, p.visitante, p.rival, p.nuestros.join('/'), p.esLocal, p.esVisitante]), [
    ['local', 'DOMPAVOLEI IF1', 'RIVAL & CIA', 'RIVAL & CIA', 'DOMPAVOLEI IF1', true, false],
    ['visitante', 'OTROS', 'DOMPAVOLEI SM', 'OTROS', 'DOMPAVOLEI SM', false, true],
    ['derbi', 'DOMPAVOLEI CF1', 'DOMPAVOLEI CF2', '', 'DOMPAVOLEI CF1/DOMPAVOLEI CF2', true, true],
  ]);
  // El sexo de las categorías sale del nombre de la competición (también FEMENINA/MASCULINA).
  assert.deepEqual(ps.map((p) => `${p.categoria}|${p.claveCategoria}|${p.ordenCategoria}`), [
    'Infantil F|infantil|2', 'Superliga 2 M|senior|6', 'Primera División Nacional F|senior|6',
  ]);
  assert.equal(ps[2].pabellon, 'PM A PINGUELA - PISTA 1');
  // Valores por defecto de la hora de salida.
  const p = ps[0];
  assert.equal(p.inicio, p.fecha);
  assert.deepEqual([p.salida, p.calentamiento, p.viajeMin, p.viajeFuente, p.enCasa, p.municipio, p.km, p.segundo, p.salidaPrimero],
    [null, null, null, '', false, '', null, false, null]);
});

test('orden por fecha, categoría, local y visitante; temporada del 1 de agosto al 31 de julio', () => {
  const ps = convertirPartidos([
    fila({ fecha: '2026-10-03 11:00:00', local: 'b', cat: 'CADETE' }),
    fila({ fecha: '2026-10-03 11:00:00', local: 'A', cat: 'CADETE' }),
    fila({ fecha: '2026-10-03 11:00:00', local: 'Z', cat: 'ALEVIN' }),
    fila({ fecha: '2026-08-01 10:00:00', local: 'Y' }),
    fila({ fecha: '2026-07-31 10:00:00', local: 'X' }),
  ], CLUB);
  assert.deepEqual(ps.map((p) => `${p.local} ${p.temporada}`), ['X 2025', 'Y 2026', 'Z 2026', 'A 2026', 'b 2026']);
});

test('equipos: los de la temporada anterior sin partidos también salen', () => {
  const actuales = convertirPartidos([
    fila({ fecha: '2026-10-03 11:00:00', local: 'DOMPA CF1', cat: 'CADETE', comp: 'LIGA CADETE F' }),
    fila({ fecha: '2026-10-04 11:00:00', local: 'DOMPA IF1', cat: 'INFANTIL', comp: 'LIGA INFANTIL F' }),
    fila({ fecha: '2026-10-05 11:00:00', local: 'DOMPA IF1', cat: 'CADETE', comp: 'COPA CADETE F' }),
    fila({ fecha: '2026-10-06 11:00:00', local: 'DOMPA IF1', cat: 'INFANTIL', comp: 'LIGA INFANTIL F' }),
  ], CLUB);
  const anteriores = convertirPartidos([
    fila({ fecha: '2025-10-03 11:00:00', local: 'DOMPA AF1', cat: 'ALEVIN', comp: 'LIGA ALEVIN F' }),
    fila({ fecha: '2025-10-04 11:00:00', local: 'DOMPA CF1', cat: 'CADETE', comp: 'LIGA CADETE F' }),
  ], CLUB);
  const lista = equipos(actuales, anteriores);
  assert.deepEqual(lista.map((e) => `${e.nombre}|${e.categoria}|${e.claveCategoria}|${e.ordenCategoria}|${e.partidos.length}|${e.ics}`), [
    'DOMPA AF1|Alevín F|alevin|1|0|',
    'DOMPA IF1|Infantil F|infantil|2|3|',
    'DOMPA CF1|Cadete F|cadete|3|1|',
  ]);
  // Si empatan dos categorías, la del primer partido.
  const empate = convertirPartidos([
    fila({ fecha: '2026-10-03 11:00:00', local: 'T', cat: 'JUVENIL', comp: 'LIGA XUVENIL F' }),
    fila({ fecha: '2026-10-04 11:00:00', local: 'T', cat: 'CADETE', comp: 'LIGA CADETE F' }),
  ], CLUB);
  assert.equal(equipos(empate, [])[0].categoria, 'Juvenil F');
});

test('equipos: el mismo nombre con otras mayúsculas es un solo equipo ([ordered]@{} en el .ps1)', () => {
  const actuales = convertirPartidos([
    fila({ fecha: '2026-10-03 11:00:00', local: 'DOMPA CF1', comp: 'LIGA CADETE F' }),
    fila({ fecha: '2026-10-10 11:00:00', local: 'Dompa CF1', comp: 'LIGA CADETE F' }),
  ], CLUB);
  const anteriores = convertirPartidos([fila({ fecha: '2025-10-04 11:00:00', local: 'dompa cf1', comp: 'LIGA CADETE F' })], CLUB);
  const lista = equipos(actuales, anteriores);
  // Se queda con el nombre que sale primero y con los dos partidos de la temporada.
  assert.deepEqual(lista.map((e) => `${e.nombre}|${e.partidos.length}`), ['DOMPA CF1|2']);
});

test('buscarClubs: todas las palabras, al principio de palabra y sin tildes', () => {
  const catalogo = [
    { id: '1', busqueda: ['DOMPAVOLEI', 'CV SAN MARTINO', 'DOMPAVOLEI IF1'] },
    { id: '2', busqueda: ['CLUB VOLEIBOL PONTEVEDRA', '', 'CLUB VOLEIBOL PONTEVEDRA SF2'] },
    { id: '3', busqueda: ['CV SAN SADURNINO', ''] },
  ];
  const ids = (t) => buscarClubs(catalogo, t).map((c) => c.id).join(',');
  assert.equal(ids('dompa'), '1');
  assert.equal(ids('San Martiño'), '1');
  assert.equal(ids('cv san'), '1,3');
  assert.equal(ids('voleibol pontevedra'), '2');
  assert.equal(ids('ontevedra'), '');
  assert.equal(ids('  '), '');
});
