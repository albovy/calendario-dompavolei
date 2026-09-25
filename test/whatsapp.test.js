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

test('mensajesWhatsApp: vuelta redondeada al alza a 15 min; un partido en otro pabellón no cuenta para la vuelta', () => {
  const a = partido({ salida: fechaPared(2026, 9, 26, 7, 15), calentamiento: fechaPared(2026, 9, 26, 9, 0), viajeMin: 100 });
  const b = partido({ fecha: fechaPared(2026, 9, 26, 11, 30), local: 'CV OLEIROS IFA', rival: 'CV OLEIROS IFA', segundo: true });
  const c = partido({ fecha: fechaPared(2026, 9, 26, 17, 0), local: 'CV VIGO IFA', rival: 'CV VIGO IFA', pabellon: 'OTRO PABELLÓN' });
  const lineas = mensajesWhatsApp([a, b, c], OPCIONES).get(a).split('\n');
  assert.equal(lineas.at(-2), '🆚 17:00 contra CV VIGO IFA (en OTRO PABELLÓN)');
  // Como el correo de «Pedir bus»: el último partido en el pabellón de la salida (11:30) + 120 min de
  // partido + 100 de viaje = 15:10 -> 15:15. El de las 17:00, en otro pabellón, no cuenta.
  assert.equal(lineas.at(-1), '🔙 Vuelta a Os Remedios hacia las 15:15 (aprox.)');
});

test('mensajesWhatsApp: vuelta como el correo de «Pedir bus» aunque el equipo juegue luego en casa', () => {
  const lejos = partido({
    pabellon: 'LEJOS', municipio: 'Lugo', salida: fechaPared(2026, 9, 26, 7, 15), calentamiento: fechaPared(2026, 9, 26, 9, 0), viajeMin: 105,
  });
  const casa = partido({
    fecha: fechaPared(2026, 9, 26, 19, 0), local: 'DOMPAVOLEI IF1', visitante: 'CV OLEIROS IFA', esLocal: true, esVisitante: false,
    condicion: 'local', rival: 'CV OLEIROS IFA', pabellon: 'ANEXO OS REMEDIOS - PISTA 1', municipio: 'Ourense', enCasa: true,
    calentamiento: fechaPared(2026, 9, 26, 18, 0),
  });
  const lineas = mensajesWhatsApp([lejos, casa], OPCIONES).get(lejos).split('\n');
  assert.equal(lineas.at(-2), '🆚 19:00 contra CV OLEIROS IFA (en ANEXO OS REMEDIOS - PISTA 1)');
  // 10:00 + 120 + 105 = 13:45, la llegada del correo; no 19:00 + 120 + 105.
  assert.equal(lineas.at(-1), '🔙 Vuelta a Os Remedios hacia las 13:45 (aprox.)');
});

test('mensajesWhatsApp: un mensaje por equipo y día: dos equipos el mismo día, cada uno con el suyo', () => {
  const if1 = partido({ salida: fechaPared(2026, 9, 26, 7, 15), calentamiento: fechaPared(2026, 9, 26, 9, 0), viajeMin: 105 });
  const if1Segundo = partido({ fecha: fechaPared(2026, 9, 26, 11, 30), local: 'CV OLEIROS IFA', rival: 'CV OLEIROS IFA', segundo: true });
  const xf1 = partido({
    fecha: fechaPared(2026, 9, 26, 11, 0), local: 'CV MONFORTE XF', visitante: 'DOMPAVOLEI XF1', nuestros: ['DOMPAVOLEI XF1'],
    rival: 'CV MONFORTE XF', categoria: 'Juvenil F', pabellon: 'A PINGUELA - PISTA 1', municipio: 'Monforte de Lemos',
    salida: fechaPared(2026, 9, 26, 8, 30), calentamiento: fechaPared(2026, 9, 26, 10, 0), viajeMin: 90,
  });
  const xf1Segundo = partido({
    fecha: fechaPared(2026, 9, 26, 13, 0), local: 'CV LUGO XF', visitante: 'DOMPAVOLEI XF1', nuestros: ['DOMPAVOLEI XF1'],
    rival: 'CV LUGO XF', categoria: 'Juvenil F', pabellon: 'A PINGUELA - PISTA 1', municipio: 'Monforte de Lemos', segundo: true,
  });
  const m = mensajesWhatsApp([xf1Segundo, if1Segundo, xf1, if1], { ...OPCIONES, pabellones: null });
  assert.deepEqual([...m.keys()], [if1, xf1]);
  assert.deepEqual(m.get(if1).split('\n').filter((l) => /^(🏐|🚌|🆚|🔙)/u.test(l)), [
    '🏐 *DOMPAVOLEI IF1* (Infantil F)',
    '🚌 *Salida: 07:15* desde Os Remedios',
    '🆚 10:00 contra SEI SAN NARCISO IF',
    '🆚 11:30 contra CV OLEIROS IFA',
    '🔙 Vuelta a Os Remedios hacia las 15:15 (aprox.)',
  ]);
  assert.equal(m.get(xf1), [
    '🏐 *DOMPAVOLEI XF1* (Juvenil F)',
    '📅 *Sábado 26 de septiembre*',
    '',
    '🚌 *Salida: 08:30* desde Os Remedios',
    '    (Rúa Pardo de Cela, 2, Ourense)',
    '🏟️ A PINGUELA - PISTA 1 (Monforte de Lemos)',
    '    https://www.google.com/maps/search/?api=1&query=A%20PINGUELA%20-%20PISTA%201%2C%20Monforte%20de%20Lemos',
    '🔥 Calentamiento: 10:00',
    '🆚 11:00 contra CV MONFORTE XF',
    '🆚 13:00 contra CV LUGO XF',
    // 13:00 + 120 + 90 = 16:30.
    '🔙 Vuelta a Os Remedios hacia las 16:30 (aprox.)',
  ].join('\n'));
});

test('mensajesWhatsApp: el mismo equipo con los equipos en otro orden (derbi) u otras mayúsculas: un solo mensaje', () => {
  // Como anadirSalidas: el de las 12:00 es el «2º partido» del de las 10:00 y va con su salida.
  const ida = partido({
    local: 'DOMPAVOLEI IF1', visitante: 'DOMPAVOLEI IF2', esLocal: true, condicion: 'derbi', nuestros: ['DOMPAVOLEI IF1', 'DOMPAVOLEI IF2'],
    rival: '', salida: fechaPared(2026, 9, 26, 7, 15), calentamiento: fechaPared(2026, 9, 26, 9, 0), viajeMin: 105,
  });
  const vuelta = partido({
    fecha: fechaPared(2026, 9, 26, 12, 0), local: 'DOMPAVOLEI IF2', visitante: 'DOMPAVOLEI IF1', esLocal: true, condicion: 'derbi',
    nuestros: ['DOMPAVOLEI IF2', 'DOMPAVOLEI IF1'], rival: '', calentamiento: fechaPared(2026, 9, 26, 11, 0), segundo: true,
  });
  const m = mensajesWhatsApp([ida, vuelta], OPCIONES);
  assert.deepEqual([...m.keys()], [ida]);
  assert.equal(m.get(ida), [
    '🏐 *DOMPAVOLEI IF1 y DOMPAVOLEI IF2* (Infantil F)',
    '📅 *Sábado 26 de septiembre*',
    '',
    '🚌 *Salida: 07:15* desde Os Remedios',
    '    (Rúa Pardo de Cela, 2, Ourense)',
    '🏟️ PABELLÓN COLEGIO SAN NARCISO PISTA 1 (Marín)',
    '    https://www.google.com/maps/search/?api=1&query=42.3905,-8.7076',
    '🔥 Calentamiento: 09:00',
    '🆚 10:00 DOMPAVOLEI IF1 - DOMPAVOLEI IF2',
    '🆚 12:00 DOMPAVOLEI IF2 - DOMPAVOLEI IF1',
    // El bus espera al de las 12:00: 12:00 + 120 + 105 = 15:45.
    '🔙 Vuelta a Os Remedios hacia las 15:45 (aprox.)',
  ].join('\n'));

  // iSquad escribe el nombre del equipo con otras mayúsculas en el segundo partido.
  const primero = partido({ salida: fechaPared(2026, 10, 3, 7, 15), fecha: fechaPared(2026, 10, 3, 10, 0), viajeMin: 105 });
  const otraCaja = partido({
    fecha: fechaPared(2026, 10, 3, 12, 0), visitante: 'Dompavolei IF1', nuestros: ['Dompavolei IF1'], local: 'CV OLEIROS IFA',
    rival: 'CV OLEIROS IFA', segundo: true,
  });
  const m2 = mensajesWhatsApp([primero, otraCaja], OPCIONES);
  assert.deepEqual([...m2.keys()], [primero]);
  assert.deepEqual(m2.get(primero).split('\n').slice(-3), [
    '🆚 10:00 contra SEI SAN NARCISO IF',
    '🆚 12:00 contra CV OLEIROS IFA',
    '🔙 Vuelta a Os Remedios hacia las 15:45 (aprox.)',
  ]);
});

test('mensajesWhatsApp: si algún partido del día del equipo ya tiene resultado, no hay mensaje', () => {
  const resultado = { marcador: [3, 1], sets: [[25, 20], [20, 25], [25, 18], [25, 22]] };
  // De hoy, sin hora, con el resultado ya recogido por el repaso diario de resultados.js.
  const sinHora = partido({ fecha: fechaPared(2026, 9, 25), estado: 'sinhora', resultado });
  // Concentración de hoy: el primero ya se jugó; el segundo aún no.
  const jugado = partido({ fecha: fechaPared(2026, 9, 25, 10, 0), nuestros: ['DOMPAVOLEI XF1'], resultado });
  const porJugar = partido({ fecha: fechaPared(2026, 9, 25, 12, 30), nuestros: ['DOMPAVOLEI XF1'], segundo: true });
  const manana = partido();
  const m = mensajesWhatsApp([sinHora, jugado, porJugar, manana], OPCIONES);
  assert.deepEqual([...m.keys()], [manana]);
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

test('mensajesWhatsApp: coordenadas del mapa sin el ruido de coma flotante de pabellones.json', () => {
  // Como las guardó el .ps1: -7.5242499999999994 se escribiría "-7.524249999999999".
  const pabellones = { 'A PINGUELA - PISTA 1': { municipio: 'MONFORTE DE LEMOS', lat: 42.3889848, lon: -7.5242499999999994 } };
  const p = partido({ pabellon: 'A PINGUELA - PISTA 1', municipio: 'MONFORTE DE LEMOS' });
  const lineas = mensajesWhatsApp([p], { ...OPCIONES, pabellones }).get(p).split('\n');
  assert.equal(lineas[4], '    https://www.google.com/maps/search/?api=1&query=42.3889848,-7.52425');
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
