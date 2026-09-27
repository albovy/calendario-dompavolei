// Pruebas de src/demo.js: los dos partidos de prueba (uno fuera y otro en casa) para enseñar la página.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPETICION_DEMO, RIVAL_DEMO, partidosDemo } from '../src/demo.js';
import { configSalidas } from '../src/salidas.js';
import { fechaPared, fmt, hora } from '../src/util.js';

const IF1 = { nombre: 'DOMPAVOLEI IF1', categoria: 'Infantil F', claveCategoria: 'infantil', ordenCategoria: 3 };
const CF1 = { nombre: 'DOMPAVOLEI CF1', categoria: 'Cadete F', claveCategoria: 'cadete', ordenCategoria: 4 };
const SALIDAS = configSalidas({ salidas: { origen: 'Os Remedios', latitud: 42.3442759, longitud: -7.8713948, factor_bus: 1 } });
const PABELLONES = {
  'PABELLÓN LEJOS': { lat: 42.39, lon: -8.70, municipio: 'MARÍN', km: 103.7, minutos_coche: 85, fuente: 'osrm' },
  'ANEXO OS REMEDIOS - PISTA 1': { lat: 42.3443, lon: -7.8714, municipio: 'OURENSE', km: 0.1, minutos_coche: 1, fuente: 'osrm' },
};
// Partidos reales ya con sus salidas (como los deja anadirSalidas): de ahí salen los pabellones.
function real(campos) {
  return { nuestros: ['DOMPAVOLEI IF1'], condicion: 'visitante', viajeMin: null, segundo: false, enCasa: false, pabellon: '', ...campos };
}
const REALES = [
  real({ fecha: fechaPared(2026, 10, 3, 11, 0), pabellon: 'PABELLÓN LEJOS', viajeMin: 90 }),
  real({ fecha: fechaPared(2026, 10, 4, 12, 0), nuestros: ['DOMPAVOLEI CF1'], condicion: 'local', enCasa: true, pabellon: 'ANEXO OS REMEDIOS - PISTA 1' }),
];

test('demo: uno fuera (con su salida en bus) y otro en casa, mañana, con el rival y la competición de prueba', () => {
  const [fuera, casa] = partidosDemo({ partidos: REALES, equipos: [IF1, CF1], pabellones: PABELLONES, salidas: SALIDAS, hoy: fechaPared(2026, 9, 27, 14, 0) });
  assert.equal(fmt(fuera.fecha, 'yyyy-MM-dd HH:mm'), '2026-09-28 12:00');
  assert.deepEqual([fuera.local, fuera.visitante, fuera.condicion, fuera.esLocal, fuera.esVisitante], [RIVAL_DEMO, 'DOMPAVOLEI IF1', 'visitante', false, true]);
  assert.deepEqual([fuera.pabellon, fuera.municipio, fuera.viajeMin, hora(fuera.calentamiento), hora(fuera.salida)],
    ['PABELLÓN LEJOS', 'MARÍN', 90, '11:00', '09:30']);
  assert.equal(fmt(casa.fecha, 'yyyy-MM-dd HH:mm'), '2026-09-28 18:00');
  assert.deepEqual([casa.local, casa.visitante, casa.condicion, casa.enCasa, hora(casa.calentamiento), casa.salida],
    ['DOMPAVOLEI CF1', RIVAL_DEMO, 'local', true, '17:00', null]);
  for (const p of [fuera, casa]) {
    assert.equal(p.demo, true);
    assert.equal(p.competicion, COMPETICION_DEMO);
    assert.equal(p.estado, 'confirmada');
    assert.equal(p.rival, RIVAL_DEMO);
  }
  assert.deepEqual([fuera.categoria, fuera.claveCategoria, casa.categoria, casa.claveCategoria], ['Infantil F', 'infantil', 'Cadete F', 'cadete']);
});

test('demo: el primer día desde mañana en que no juega ninguno de los dos equipos (no se mezclan con los reales)', () => {
  const reales = [
    ...REALES,
    real({ fecha: fechaPared(2026, 9, 28, 10, 0) }),                              // IF1 juega mañana
    real({ fecha: fechaPared(2026, 9, 29, 10, 0), nuestros: ['DOMPAVOLEI CF1'] }), // CF1, pasado mañana
    real({ fecha: fechaPared(2026, 9, 30, 10, 0), nuestros: ['DOMPAVOLEI SF1'] }), // otro equipo: da igual
  ];
  const demo = partidosDemo({ partidos: reales, equipos: [IF1, CF1], hoy: fechaPared(2026, 9, 27, 23, 30) });
  assert.deepEqual(demo.map((p) => fmt(p.fecha, 'yyyy-MM-dd')), ['2026-09-30', '2026-09-30']);
});

test('demo: con un solo equipo, los dos partidos son suyos; sin equipos, ninguno; sin salidas, sin horas de bus', () => {
  const uno = partidosDemo({ partidos: [], equipos: [IF1], hoy: fechaPared(2026, 9, 27) });
  assert.deepEqual(uno.map((p) => p.nuestros), [['DOMPAVOLEI IF1'], ['DOMPAVOLEI IF1']]);
  // Sin partidos reales de los que sacar pabellones, uno de prueba (sin viaje calculado).
  assert.deepEqual(uno.map((p) => [p.pabellon, p.salida, p.enCasa]), [['PABELLÓN DE PRUEBA', null, false], ['PABELLÓN DE PRUEBA', null, false]]);
  assert.deepEqual(partidosDemo({ partidos: [], equipos: [], hoy: fechaPared(2026, 9, 27) }), []);
});
