// Pruebas de src/historial.js (sin red). El texto esperado es el que genera Save-Historial de
// calendario-voley.ps1 con los mismos partidos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearHistorial } from '../src/historial.js';
import { fechaPared } from '../src/util.js';

function partido(cambios = {}) {
  const fecha = cambios.fecha ?? fechaPared(2026, 10, 3, 18, 30);
  return {
    fecha, temporada: 2026, estado: 'confirmada', local: 'DOMPAVOLEI CF1', visitante: 'CV VIGO',
    esLocal: true, esVisitante: false, condicion: 'local', nuestros: ['DOMPAVOLEI CF1'], rival: 'CV VIGO',
    competicion: 'LIGA GALEGA CADETE F', categoria: 'Cadete F', claveCategoria: 'cadete', ordenCategoria: 3,
    pabellon: 'PAVILLON DOS REMEDIOS', uid: 'u',
    inicio: fecha, salida: null, calentamiento: null, viajeMin: null, viajeFuente: '',
    enCasa: false, municipio: '', km: null, segundo: false, salidaPrimero: null,
    ...cambios,
  };
}

test('una línea por partido, con el día de la semana y la hora como en la página', () => {
  const lista = [
    partido(),
    partido({
      fecha: fechaPared(2026, 10, 11), estado: 'sinhora', local: 'DOMPAVOLEI CF2', visitante: 'DOMPAVOLEI CF1',
      condicion: 'derbi', competicion: `COPA <A&B> 'X' "Y"`, pabellon: '',
    }),
    partido({ fecha: fechaPared(2026, 10, 14, 20, 15), estado: 'provisional', categoria: 'Juvenil M' }),
    partido({ fecha: fechaPared(2026, 12, 20), estado: 'pendiente', categoria: 'Senior M', pabellon: 'PAZO DOS DEPORTES DE RIAZOR' }),
  ];
  assert.equal(crearHistorial(lista, 'DOMPAVOLEI', '2026/27'), [
    '# Partidos de DOMPAVOLEI, temporada 2026/27 (Federación Galega de Voleibol)',
    '# fecha | hora | categoría | local - visitante | pabellón | competición',
    'sáb 2026-10-03 | 18:30 | Cadete F | DOMPAVOLEI CF1 - CV VIGO | PAVILLON DOS REMEDIOS | LIGA GALEGA CADETE F',
    `dom 2026-10-11 | Por confirmar | Cadete F | DOMPAVOLEI CF2 - DOMPAVOLEI CF1 |  | COPA <A&B> 'X' "Y"`,
    'mié 2026-10-14 | 20:15 (provisional) | Juvenil M | DOMPAVOLEI CF1 - CV VIGO | PAVILLON DOS REMEDIOS | LIGA GALEGA CADETE F',
    'dom 2026-12-20 | Fecha y hora por confirmar | Senior M | DOMPAVOLEI CF1 - CV VIGO | PAZO DOS DEPORTES DE RIAZOR | LIGA GALEGA CADETE F',
    '',
  ].join('\n'));
});

test('sin partidos: solo la cabecera; saltos de línea LF y salto final', () => {
  const texto = crearHistorial([], 'DOMPAVOLEI + OTRO', '2026/27');
  assert.equal(texto, '# Partidos de DOMPAVOLEI + OTRO, temporada 2026/27 (Federación Galega de Voleibol)\n'
    + '# fecha | hora | categoría | local - visitante | pabellón | competición\n');
  assert.ok(!texto.includes('\r'));
});
