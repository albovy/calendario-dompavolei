// Pruebas de src/whatsapp.js: el mensaje para el grupo de WhatsApp de las familias.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensajesWhatsApp } from '../src/whatsapp.js';
import { fechaPared } from '../src/util.js';

const HOY = fechaPared(2026, 9, 25, 12, 0);
const PABELLONES = { 'PABELLÓN COLEGIO SAN NARCISO PISTA 1': { municipio: 'Marín', lat: 42.3905, lon: -8.7076 } };
const OPCIONES = {
  salidas: { origen: 'Os Remedios' }, pedirBus: { dirOrigen: 'Rúa Pardo de Cela, 2, Ourense' }, duracion: 120,
  pabellones: PABELLONES, hoy: HOY,
};

// Partido del IF1 como los de convertirPartidos + anadirSalidas (solo lo que usa whatsapp.js).
function partido(cambios = {}) {
  const fecha = cambios.fecha ?? fechaPared(2026, 9, 26, 10, 0);
  return {
    fecha, temporada: 2026, estado: 'confirmada', local: 'SEI SAN NARCISO IF', visitante: 'DOMPAVOLEI IF1',
    esLocal: false, esVisitante: true, condicion: 'visitante', nuestros: ['DOMPAVOLEI IF1'], rival: 'SEI SAN NARCISO IF',
    competicion: 'TORNEO APERTURA INFANTIL F', categoria: 'Infantil F', pabellon: 'PABELLÓN COLEGIO SAN NARCISO PISTA 1',
    inicio: fecha, salida: null, calentamiento: null, viajeMin: null, enCasa: false, municipio: 'Marín', segundo: false,
    ...cambios,
  };
}

test('mensajesWhatsApp: fuera, en bus y con dos partidos el mismo día: un mensaje, en el primero', () => {
  const primero = partido({ salida: fechaPared(2026, 9, 26, 7, 15), calentamiento: fechaPared(2026, 9, 26, 9, 0), viajeMin: 105 });
  const segundo = partido({
    fecha: fechaPared(2026, 9, 26, 11, 30), local: 'DOMPAVOLEI IF1', visitante: 'CV OLEIROS IFA', esLocal: true, esVisitante: false,
    condicion: 'local', rival: 'CV OLEIROS IFA', segundo: true,
  });
  const m = mensajesWhatsApp([segundo, primero], OPCIONES);
  assert.deepEqual([...m.keys()], [primero]);
  assert.equal(m.get(primero), [
    '🏐 *DOMPAVOLEI IF1* (Infantil F)',
    '📅 *Sábado 26 de septiembre*',
    '',
    '🚌 *Salida: 07:15* desde Os Remedios',
    '    (Rúa Pardo de Cela, 2, Ourense)',
    '🏟️ PABELLÓN COLEGIO SAN NARCISO PISTA 1 (Marín)',
    '    https://www.google.com/maps/search/?api=1&query=42.3905,-8.7076',
    '🔥 Calentamiento: 09:00',
    '🆚 10:00 contra SEI SAN NARCISO IF',
    '🆚 11:30 contra CV OLEIROS IFA',
    '🔙 Vuelta a Os Remedios hacia las 15:15 (aprox.)',
  ].join('\n'));
});

test('mensajesWhatsApp: vuelta redondeada al alza a 15 min; un partido en otro pabellón', () => {
  const a = partido({ salida: fechaPared(2026, 9, 26, 7, 15), calentamiento: fechaPared(2026, 9, 26, 9, 0), viajeMin: 100 });
  const b = partido({ fecha: fechaPared(2026, 9, 26, 12, 0), local: 'CV OLEIROS IFA', rival: 'CV OLEIROS IFA', pabellon: 'OTRO PABELLÓN' });
  const lineas = mensajesWhatsApp([a, b], OPCIONES).get(a).split('\n');
  assert.equal(lineas.at(-2), '🆚 12:00 contra CV OLEIROS IFA (en OTRO PABELLÓN)');
  // 12:00 + 120 min de partido + 100 de viaje = 15:40 -> 15:45.
  assert.equal(lineas.at(-1), '🔙 Vuelta a Os Remedios hacia las 15:45 (aprox.)');
});

test('mensajesWhatsApp: en casa, sin bus ni vuelta', () => {
  const casa = partido({
    fecha: fechaPared(2026, 10, 4, 11, 30), local: 'DOMPAVOLEI CF1', visitante: 'PESCADOR XAV SANXENXO', esLocal: true,
    esVisitante: false, condicion: 'local', nuestros: ['DOMPAVOLEI CF1'], rival: 'PESCADOR XAV SANXENXO', categoria: 'Cadete F',
    pabellon: 'ANEXO OS REMEDIOS PISTA 1', municipio: 'Ourense', enCasa: true, calentamiento: fechaPared(2026, 10, 4, 10, 30),
  });
  assert.equal(mensajesWhatsApp([casa], OPCIONES).get(casa), [
    '🏐 *DOMPAVOLEI CF1* (Cadete F)',
    '📅 *Domingo 4 de octubre*',
    '',
    '🏟️ ANEXO OS REMEDIOS PISTA 1 (en casa)',
    '    https://www.google.com/maps/search/?api=1&query=ANEXO%20OS%20REMEDIOS%20PISTA%201%2C%20Ourense',
    '🔥 Calentamiento: 10:30',
    '🆚 11:30 contra PESCADOR XAV SANXENXO',
  ].join('\n'));
});

test('mensajesWhatsApp: sin hora, hora provisional, fecha sin confirmar y partidos pasados', () => {
  const pasado = partido({ fecha: fechaPared(2026, 9, 19, 10, 0) });
  const deHoy = partido({ fecha: fechaPared(2026, 9, 25, 18, 0) });
  const sinHora = partido({ fecha: fechaPared(2026, 10, 3), estado: 'sinhora', pabellon: 'VALLE INCLAN', municipio: '' });
  const provisional = partido({
    fecha: fechaPared(2026, 10, 10, 12, 0), estado: 'provisional', pabellon: 'PAVILLÓN MUNICIPAL DE LALÍN - PISTA 1', municipio: 'Lalín',
  });
  const pendiente = partido({ fecha: fechaPared(2026, 10, 17), estado: 'pendiente' });
  const m = mensajesWhatsApp([pasado, deHoy, sinHora, provisional, pendiente], { ...OPCIONES, pabellones: null });
  assert.deepEqual([...m.keys()], [deHoy, sinHora, provisional]);
  assert.equal(m.get(sinHora), [
    '🏐 *DOMPAVOLEI IF1* (Infantil F)',
    '📅 *Sábado 3 de octubre*',
    '',
    '⏰ Hora por confirmar',
    '🏟️ VALLE INCLAN',
    '    https://www.google.com/maps/search/?api=1&query=VALLE%20INCLAN%2C%20Galicia',
    '🆚 Contra SEI SAN NARCISO IF (hora por confirmar)',
  ].join('\n'));
  // El municipio ya va en el nombre del pabellón: no se repite.
  assert.deepEqual(m.get(provisional).split('\n').slice(3), [
    '⚠️ Horario provisional: puede cambiar',
    '🏟️ PAVILLÓN MUNICIPAL DE LALÍN - PISTA 1',
    '    https://www.google.com/maps/search/?api=1&query=PAVILL%C3%93N%20MUNICIPAL%20DE%20LAL%C3%8DN%20-%20PISTA%201%2C%20Lal%C3%ADn',
    '🆚 12:00 contra SEI SAN NARCISO IF',
  ]);
});

test('mensajesWhatsApp: derbi, sin horas de salida configuradas y sin pabellón', () => {
  const derbi = partido({
    fecha: fechaPared(2026, 10, 4, 10, 0), local: 'DOMPAVOLEI CF1', visitante: 'DOMPAVOLEI CF2', esLocal: true, esVisitante: true,
    condicion: 'derbi', nuestros: ['DOMPAVOLEI CF1', 'DOMPAVOLEI CF2'], rival: '', categoria: 'Cadete F', pabellon: '', municipio: '',
  });
  assert.equal(mensajesWhatsApp([derbi], { hoy: HOY }).get(derbi), [
    '🏐 *DOMPAVOLEI CF1 y DOMPAVOLEI CF2* (Cadete F)',
    '📅 *Domingo 4 de octubre*',
    '',
    '🏟️ Pabellón por confirmar',
    '🆚 10:00 DOMPAVOLEI CF1 - DOMPAVOLEI CF2',
  ].join('\n'));
});
