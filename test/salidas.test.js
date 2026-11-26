// Pruebas de src/salidas.js, sin red (fetch simulado). Los valores esperados salen de las funciones
// originales de calendario-voley.ps1 con las mismas entradas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aNumero, anadirSalidas, cercaSinMunicipio, configPedirBus, configSalidas, direccionCampo, distanciaKm,
  guardarCachePabellones, leerCachePabellones, lineasSalida, municipioDe, resolverPabellones, rutaCoche, textoSalida,
} from '../src/salidas.js';
import { fechaPared } from '../src/util.js';

const ORIGEN = { origen: 'Os Remedios', latitud: 42.3442759, longitud: -7.8713948 };

const PABELLONES = {
  'ANEXO OS REMEDIOS - PISTA 1': { lat: 42.3438638, lon: -7.8701618, km: 0.7, minutos_coche: 1, municipio: 'OURENSE', fuente: 'osrm' },
  'A PINGUELA - PISTA 1': { lat: 42.51356, lon: -7.52425, km: 46.1, minutos_coche: 42, municipio: 'MONFORTE DE LEMOS', fuente: 'osrm' },
};

// Partido con lo que usa anadirSalidas. fecha: 'aaaa-mm-dd HH:mm'.
function partido(fecha, pabellon, equipo, estado = 'confirmada') {
  const [a, m, d, hh, mm] = fecha.split(/[- :]/).map(Number);
  const f = fechaPared(a, m, d, hh, mm);
  return {
    fecha: f, estado, pabellon, nuestros: [equipo], inicio: f, salida: null, calentamiento: null, viajeMin: null,
    viajeFuente: '', enCasa: false, municipio: '', km: null, segundo: false, salidaPrimero: null,
  };
}

const hm = (d) => (d ? d.toISOString().slice(11, 16) : '-');

// Ejecuta f con el reloj simulado y lo adelanta hasta que termina: la espera de 1,1 s antes de cada
// consulta a OSRM no se espera de verdad.
async function sinEsperas(t, f) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let terminado = false;
    const promesa = f();
    promesa.then(() => { terminado = true; }, () => { terminado = true; });
    while (!terminado) {
      await new Promise((seguir) => { setImmediate(seguir); });
      t.mock.timers.tick(1000);
    }
    return await promesa;
  } finally {
    t.mock.timers.reset();
  }
}

// Ejecuta f sin escribir en la consola y devuelve [resultado, líneas escritas].
async function enSilencio(f) {
  const lineas = [];
  const original = console.log;
  console.log = (texto) => lineas.push(texto);
  try {
    return [await f(), lineas];
  } finally {
    console.log = original;
  }
}

test('salidas: casa, fuera, 2º partido, tiempo a mano y pabellón desconocido', () => {
  const cfg = configSalidas({ salidas: { ...ORIGEN, tiempos_viaje_minutos: { 'PAZO DOS DEPORTES': 40 } } });
  const ps = [
    partido('2026-10-03 11:30', 'ANEXO OS REMEDIOS - PISTA 1', 'IF1'),
    partido('2026-10-04 11:30', 'A PINGUELA - PISTA 1', 'CF1'),
    partido('2026-10-04 13:00', 'A PINGUELA - PISTA 1', 'CF1'),
    partido('2026-10-10 18:00', 'PAZO DOS DEPORTES PISTA 2', 'SM1'),
    partido('2026-10-11 12:00', 'PABELLON DESCONOCIDO', 'SF1'),
    partido('2026-10-17 18:00', 'A PINGUELA - PISTA 1', 'SF1', 'provisional'),
    partido('2026-10-18 00:00', 'A PINGUELA - PISTA 1', 'SF1', 'sinhora'),
  ];
  anadirSalidas(ps, PABELLONES, cfg);
  const r = ps.slice(0, 5).map((p) => `${p.fecha.toISOString().slice(8, 10)} ${hm(p.fecha)} casa=${p.enCasa} `
    + `viaje=${p.viajeMin ?? ''} salida=${hm(p.salida)} inicio=${hm(p.inicio)} seg=${p.segundo}`);
  // Manual 40 min: 18:00 - 60 - 40 = 16:20 -> 16:15.
  assert.deepEqual(r, [
    '03 11:30 casa=true viaje= salida=- inicio=10:30 seg=false',
    '04 11:30 casa=false viaje=60 salida=09:30 inicio=09:30 seg=false',
    '04 13:00 casa=false viaje=60 salida=- inicio=13:00 seg=true',
    '10 18:00 casa=false viaje=40 salida=16:15 inicio=16:15 seg=false',
    '11 12:00 casa=false viaje= salida=- inicio=11:00 seg=false',
  ]);
  assert.equal(ps[2].salidaPrimero, ps[1]);
  // El partido sin hora también sabe dónde se juega (municipio y km), pero no tiene viaje propio.
  assert.deepEqual(ps.map((p) => [p.viajeFuente, p.municipio, p.km]), [
    ['', 'OURENSE', 0.7], ['osrm', 'MONFORTE DE LEMOS', 46.1], ['osrm', 'MONFORTE DE LEMOS', 46.1],
    ['manual', '', null], ['', '', null], ['osrm', 'MONFORTE DE LEMOS', 46.1], ['', 'MONFORTE DE LEMOS', 46.1],
  ]);

  assert.deepEqual(ps.map((p) => lineasSalida(p, cfg).join(' || ')), [
    'En casa · calentamiento 10:30 · partido 11:30',
    'Salida 09:30 desde Os Remedios · bus 1 h || Calentamiento 10:30 · partido 11:30',
    '2º partido del día: se va con el primero (salida 09:30)',
    // El calentamiento de fuera empieza al llegar: 16:15 + 40 min = 16:55 (con el redondeo, algo más de 1 h).
    'Salida 16:15 desde Os Remedios · bus 40 min || Calentamiento 16:55 · partido 18:00',
    'Viaje sin calcular · calentamiento 11:00 · partido 12:00',
    'Salida 16:00 desde Os Remedios · bus 1 h || Calentamiento 17:00 · partido 18:00 (provisional)',
    '',
  ]);
  assert.deepEqual(ps.map(textoSalida), ['En casa', '09:30', '2º partido', '16:15', 'Sin calcular', '16:00', '']);
  assert.deepEqual(lineasSalida(ps[0], null), []);
});

test('en casa por el pabellón aunque el partido no tenga hora todavía (sin salida ni calentamiento)', () => {
  const cfg = configSalidas({ salidas: { ...ORIGEN, tiempos_viaje_minutos: { 'PAZO DOS DEPORTES': 0 } } });
  const ps = [
    partido('2026-10-04 00:00', 'ANEXO OS REMEDIOS - PISTA 1', 'CF1', 'sinhora'),
    partido('2026-10-04 00:00', 'ANEXO OS REMEDIOS - PISTA 1', 'XF1', 'pendiente'),
    partido('2026-10-04 12:00', 'ANEXO OS REMEDIOS - PISTA 1', 'CF1'),              // el mismo día y equipo, con hora
    partido('2026-10-10 00:00', 'PAZO DOS DEPORTES PISTA 2', 'SM1', 'pendiente'),   // tiempo a mano de 0 minutos
    partido('2026-10-11 00:00', 'A PINGUELA - PISTA 1', 'SF1', 'sinhora'),          // lejos
    partido('2026-10-11 00:00', 'PABELLON DESCONOCIDO', 'IF1', 'pendiente'),
  ];
  anadirSalidas(ps, PABELLONES, cfg);
  assert.deepEqual(ps.map((p) => `${p.estado} casa=${p.enCasa} salida=${hm(p.salida)} cal=${hm(p.calentamiento)} `
    + `viaje=${p.viajeMin ?? ''} inicio=${hm(p.inicio)} seg=${p.segundo} mun=${p.municipio} km=${p.km ?? ''}`), [
    'sinhora casa=true salida=- cal=- viaje= inicio=00:00 seg=false mun=OURENSE km=0.7',
    'pendiente casa=true salida=- cal=- viaje= inicio=00:00 seg=false mun=OURENSE km=0.7',
    // El partido sin hora no cuenta como el primero del día: el de las 12:00 no es un «2º partido».
    'confirmada casa=true salida=- cal=11:00 viaje= inicio=11:00 seg=false mun=OURENSE km=0.7',
    'pendiente casa=true salida=- cal=- viaje= inicio=00:00 seg=false mun= km=',
    'sinhora casa=false salida=- cal=- viaje= inicio=00:00 seg=false mun=MONFORTE DE LEMOS km=46.1',
    'pendiente casa=false salida=- cal=- viaje= inicio=00:00 seg=false mun= km=',
  ]);
  // Sin viaje propio (ni «manual»), y el calendario y el resumen siguen sin horas para ellos.
  assert.deepEqual(ps.map((p) => p.viajeFuente), ['', '', '', '', '', '']);
  assert.deepEqual(ps.map((p) => lineasSalida(p, cfg).length), [0, 0, 1, 0, 0, 0]);
  assert.deepEqual(ps.map(textoSalida), ['', '', 'En casa', '', '', '']);
});

test('municipios_casa: un pabellón de esos municipios es «en casa» aunque no esté junto al del club', () => {
  const pabellones = {
    ...PABELLONES,
    // En Ourense, a 1,4 y 1,1 km en línea recta del pabellón del club (más que radio_casa_km, 1 km).
    'O POMPEO - PISTA 1': { lat: 42.3330403, lon: -7.8649539, km: 2.2, minutos_coche: 5, municipio: 'OURENSE', fuente: 'osrm' },
    'I.E.S. AS LAGOAS': { lat: 42.3449319, lon: -7.8578327, km: 2.2, minutos_coche: 5, municipio: 'ORENSE', fuente: 'osrm' },
  };
  const partidos = () => [
    partido('2026-11-28 19:00', 'O POMPEO - PISTA 1', 'SM1'),
    partido('2026-11-28 10:30', 'I.E.S. AS LAGOAS', 'IF1'),                    // el municipio, escrito «ORENSE»
    partido('2026-12-12 00:00', 'O POMPEO - PISTA 1', 'XF1', 'pendiente'),     // sin hora: ya se sabe que es en casa
    partido('2026-11-29 11:30', 'A PINGUELA - PISTA 1', 'CF1'),                // otro municipio
  ];
  const resumen = (p) => `casa=${p.enCasa} salida=${hm(p.salida)} cal=${hm(p.calentamiento)} viaje=${p.viajeMin ?? ''} inicio=${hm(p.inicio)}`;

  // Sin municipios_casa, como siempre: fuera, con salida en bus (5 min * 1,10 -> 15; 19:00 - 60 - 15 = 17:45).
  const antes = partidos();
  anadirSalidas(antes, pabellones, configSalidas({ salidas: ORIGEN }));
  assert.deepEqual(antes.map(resumen), [
    'casa=false salida=17:45 cal=18:00 viaje=15 inicio=17:45',
    'casa=false salida=09:15 cal=09:30 viaje=15 inicio=09:15',
    'casa=false salida=- cal=- viaje= inicio=00:00',
    'casa=false salida=09:30 cal=10:30 viaje=60 inicio=09:30',
  ]);

  // Con municipios_casa: en casa (sin bus; el evento empieza en el calentamiento, una hora antes). Lo demás, igual.
  const cfg = configSalidas({ salidas: { ...ORIGEN, municipios_casa: ['Ourense', 'Orense'] } });
  const ps = partidos();
  anadirSalidas(ps, pabellones, cfg);
  assert.deepEqual(ps.map(resumen), [
    'casa=true salida=- cal=18:00 viaje= inicio=18:00',
    'casa=true salida=- cal=09:30 viaje= inicio=09:30',
    'casa=true salida=- cal=- viaje= inicio=00:00',
    'casa=false salida=09:30 cal=10:30 viaje=60 inicio=09:30',
  ]);
  assert.deepEqual(lineasSalida(ps[0], cfg), ['En casa · calentamiento 18:00 · partido 19:00']);
  assert.deepEqual(ps.map(textoSalida), ['En casa', 'En casa', '', '09:30']);
  assert.deepEqual(ps.map((p) => p.municipio), ['OURENSE', 'ORENSE', 'OURENSE', 'MONFORTE DE LEMOS']);

  // Un pabellón lejos del club no es «en casa» aunque su municipio apuntado coincida: en las direcciones de la
  // federación, detrás del código postal puede venir la provincia (un pabellón de O Barco con «32300 OURENSE»).
  const lejos = { ...pabellones, 'PAVILLON DE LEJOS': { lat: 42.4153, lon: -6.9817, km: 101.2, minutos_coche: 75, municipio: 'OURENSE', fuente: 'osrm' } };
  const r = partido('2026-11-28 17:00', 'PAVILLON DE LEJOS', 'SM O BARCO');
  anadirSalidas([r], lejos, cfg);
  assert.deepEqual([r.enCasa, r.viajeMin, hm(r.salida)], [false, 90, '14:30']);

  // Un tiempo puesto a mano en config.json para un pabellón manda también sobre su municipio.
  const aMano = configSalidas({ salidas: { ...ORIGEN, municipios_casa: 'Ourense', tiempos_viaje_minutos: { 'O Pompeo': 20 } } });
  const [q] = partidos();
  anadirSalidas([q], pabellones, aMano);
  assert.deepEqual([q.enCasa, q.viajeMin, hm(q.salida), q.viajeFuente], [false, 20, '17:30', 'manual']);
});

test('municipios_casa: cuenta el municipio, no la cercanía (un pabellón de otro municipio a 4 km sigue con su bus)', () => {
  const cfg = configSalidas({ salidas: { ...ORIGEN, municipios_casa: ['Ourense', 'Orense'] } });
  // De un municipio vecino, a 4 km en línea recta (muy dentro de los 15 km): 13 min * 1,10 -> 15; 19:00 - 60 - 15 = 17:45.
  const pabellones = { 'PAVILLON DE BARBADAS': { lat: 42.3156, lon: -7.9003, km: 6.4, minutos_coche: 13, municipio: 'BARBADÁS', fuente: 'osrm' } };
  assert.equal(distanciaKm(ORIGEN.latitud, ORIGEN.longitud, 42.3156, -7.9003).toFixed(1), '4.0');
  const ps = [partido('2026-11-28 19:00', 'PAVILLON DE BARBADAS', 'SM1'), partido('2026-12-12 00:00', 'PAVILLON DE BARBADAS', 'XF1', 'pendiente')];
  anadirSalidas(ps, pabellones, cfg);
  assert.deepEqual(ps.map((p) => [p.enCasa, p.viajeMin, hm(p.salida), p.municipio]),
    [[false, 15, '17:45', 'BARBADÁS'], [false, null, '-', 'BARBADÁS']]);
});

test('municipios_casa: el municipio de pabellones.json (también el escrito a mano) se compara entero, sin mayúsculas ni tildes', () => {
  const cfg = configSalidas({ salidas: { ...ORIGEN, municipios_casa: ['Ourense', 'A Coruña'] } });
  // Todos a 1,4 km del club (más que radio_casa_km). Los que no son en casa: 5 min * 1,10 -> 15; 19:00 - 60 - 15 = 17:45.
  const sitio = { lat: 42.3330403, lon: -7.8649539, km: 2.2, minutos_coche: 5, fuente: 'osrm' };
  const municipios = ['Ourense', ' ourense ', 'A CORUÑA', 'a coruna', '', null, 'OURENSE (A PONTE)', 'SAN CIBRAO DAS VIÑAS, OURENSE'];
  const pabellones = Object.fromEntries(municipios.map((municipio, i) => [`PABELLON ${i}`, { ...sitio, municipio }]));
  pabellones['SIN MUNICIPIO'] = sitio;
  const ps = Object.keys(pabellones).map((n, i) => partido('2026-11-28 19:00', n, `EQUIPO ${i}`));
  anadirSalidas(ps, pabellones, cfg);
  assert.deepEqual(ps.map((p) => (p.enCasa ? 'en casa' : `${p.viajeMin} ${hm(p.salida)}`)),
    ['en casa', 'en casa', 'en casa', 'en casa', '15 17:45', '15 17:45', '15 17:45', '15 17:45', '15 17:45']);
});

test('municipios_casa: solo a menos de 15 km del club en línea recta (a 14,9 km, en casa; a 15,1 km, fuera y con su bus)', () => {
  const cfg = configSalidas({ salidas: { ...ORIGEN, municipios_casa: 'Ourense' } });
  // Un punto a «km» al norte del club (con el radio de distanciaKm, 6371 km, un grado de latitud son 111,19 km).
  const alNorte = (km) => ({ lat: ORIGEN.latitud + km / (6371 * Math.PI / 180), lon: ORIGEN.longitud });
  const pabellones = {
    'A 14,9 KM': { ...alNorte(14.9), km: 19.4, minutos_coche: 20, municipio: 'OURENSE', fuente: 'osrm' },
    'A 15,1 KM': { ...alNorte(15.1), km: 19.6, minutos_coche: 20, municipio: 'OURENSE', fuente: 'osrm' },
  };
  const ps = [partido('2026-11-28 19:00', 'A 14,9 KM', 'SM1'), partido('2026-11-28 19:00', 'A 15,1 KM', 'SF1')];
  anadirSalidas(ps, pabellones, cfg);
  // En casa, el calentamiento una hora antes. Fuera: 20 min * 1,10 = 22 -> 30; 19:00 - 60 - 30 = 17:30.
  assert.deepEqual(ps.map((p) => [p.enCasa, p.viajeMin, hm(p.salida), hm(p.inicio)]),
    [[true, null, '-', '18:00'], [false, 30, '17:30', '17:30']]);
});

test('un tiempo a mano de 0 minutos es "en casa"; margen y redondeos', () => {
  const cfg = configSalidas({
    salidas: {
      ...ORIGEN, calentamiento_minutos: 45, margen_minutos: 10, redondeo_salida_minutos: 10,
      tiempos_viaje_minutos: { 'A Pinguela': 0 },
    },
  });
  const [p] = [partido('2026-10-04 11:30', 'A PINGUELA - PISTA 1', 'CF1')];
  anadirSalidas([p], PABELLONES, cfg);
  assert.deepEqual([p.enCasa, p.viajeMin, hm(p.calentamiento), hm(p.inicio), p.viajeFuente], [true, null, '10:45', '10:45', 'manual']);

  // 42 min * 1,10 = 46,2 -> 60 (al cuarto de hora); 11:30 - 45 - 60 - 10 = 9:35 -> 9:30 (a la decena).
  const sinManual = configSalidas({ salidas: { ...ORIGEN, calentamiento_minutos: 45, margen_minutos: 10, redondeo_salida_minutos: 10 } });
  const q = partido('2026-10-04 11:30', 'A PINGUELA - PISTA 1', 'CF1');
  anadirSalidas([q], PABELLONES, sinManual);
  assert.deepEqual([q.viajeMin, hm(q.salida)], [60, '09:30']);
});

test('pabellón y equipo con otras mayúsculas: la misma entrada de la caché y la misma salida (@{} en el .ps1)', () => {
  const cfg = configSalidas({ salidas: ORIGEN });
  const ps = [
    partido('2026-10-04 11:30', 'A Pinguela - Pista 1', 'DOMPA CF1'),
    partido('2026-10-04 13:00', 'A PINGUELA - PISTA 1', 'Dompa CF1'),
  ];
  anadirSalidas(ps, PABELLONES, cfg);
  // 42 min * 1,10 -> 60; 11:30 - 60 - 60 = 9:30. El segundo partido del día va con el primero.
  assert.deepEqual([ps[0].viajeMin, hm(ps[0].salida), ps[0].municipio], [60, '09:30', 'MONFORTE DE LEMOS']);
  assert.equal(ps[1].segundo, true);
  assert.equal(ps[1].salidaPrimero, ps[0]);
});

test('configSalidas: valores por defecto, números con coma y avisos', async () => {
  const [cfg, avisos] = await enSilencio(() => configSalidas({
    salidas: { latitud: '42,5', longitud: ' -7.8 ', factor_bus: '1,25', redondeo_viaje_minutos: 0, radio_casa_km: '2',
      tiempos_viaje_minutos: { 'Pazo dos Deportes': '25,6', malo: 'mucho', negativo: -5 } },
  }));
  assert.deepEqual({ ...cfg, manual: [...cfg.manual], municipiosCasa: [...cfg.municipiosCasa] }, {
    origen: 'el pabellón del club', lat: 42.5, lon: -7.8, calentamiento: 60, factorBus: 1.25, velocidadBus: null, margen: 0,
    redondeoViaje: 1, redondeo: 15, radioCasaKm: 2, municipiosCasa: [], manual: [['PAZO DOS DEPORTES', 26]],
  });
  // municipios_casa: una lista (o un solo nombre), sin distinguir mayúsculas ni tildes; lo vacío no cuenta.
  const municipios = async (valor) => {
    const [c, dichos] = await enSilencio(() => configSalidas({ salidas: { ...ORIGEN, municipios_casa: valor } }));
    return [[...c.municipiosCasa], dichos];
  };
  assert.deepEqual(await municipios(['Ourense', ' orense ', '', null, 'A Coruña']), [['OURENSE', 'ORENSE', 'A CORUNA'], []]);
  assert.deepEqual(await municipios('Ourense'), [['OURENSE'], []]);
  for (const nada of [null, '', '  ', []]) assert.deepEqual(await municipios(nada), [[], []], JSON.stringify(nada));
  // Lo que no es un nombre (varios en un mismo texto, una lista dentro de la lista, un número...) se ignora con un aviso:
  // si no, ningún pabellón sería de ese «municipio» y sus partidos saldrían con bus sin que nadie se enterase.
  const noVale = (texto) => `  ! config.json: «${texto}» no vale en "municipios_casa" (un nombre o una lista de nombres: ["Uno", "Otro"]); se ignora.`;
  assert.deepEqual(await municipios('Ourense, Orense'), [[], [noVale('Ourense, Orense')]]);
  assert.deepEqual(await municipios(['Ourense', 'Vigo; Lugo', ['Orense'], { nombre: 'Orense' }, 5, false, '¿?']),
    [['OURENSE'], ['Vigo; Lugo', '["Orense"]', '{"nombre":"Orense"}', '5', 'false', '¿?'].map(noVale)]);
  // velocidad_bus_kmh: el viaje sale de los km por carretera; con coma también. Si no es un número > 0, no vale.
  assert.equal(configSalidas({ salidas: { ...ORIGEN, velocidad_bus_kmh: '100' } }).velocidadBus, 100);
  assert.equal(configSalidas({ salidas: { ...ORIGEN, velocidad_bus_kmh: '87,5' } }).velocidadBus, 87.5);
  for (const malo of [0, -3, 'rápido']) {
    const [c, avisos] = await enSilencio(() => configSalidas({ salidas: { ...ORIGEN, velocidad_bus_kmh: malo } }));
    assert.equal(c.velocidadBus, null, String(malo));
    assert.deepEqual(avisos, ['  ! config.json: "velocidad_bus_kmh" no es un número de km/h mayor que 0; se usa el tiempo en coche.'], String(malo));
  }
  assert.deepEqual(avisos, [
    '  ! config.json: el tiempo de viaje de «malo» no es un número de minutos; se ignora.',
    '  ! config.json: el tiempo de viaje de «negativo» no es un número de minutos; se ignora.',
  ]);
  const [sinCoordenadas, aviso] = await enSilencio(() => configSalidas({ salidas: { origen: 'X', latitud: 'no' } }));
  assert.equal(sinCoordenadas, null);
  assert.deepEqual(aviso, ['  ! config.json: faltan "latitud" y "longitud" del pabellón de salida; no se calculan las horas de salida.']);
  assert.equal(configSalidas(null), null);
  assert.equal(configSalidas({}), null);
});

test('configPedirBus', () => {
  const cfg = { salidas: ORIGEN, pedir_bus: { para: 'bus@x.es', plazas: 30, direccion_origen: 'Rúa Pardo de Cela, 2' } };
  const salidas = configSalidas(cfg);
  assert.deepEqual(configPedirBus(cfg, salidas), {
    para: 'bus@x.es', cc: '', plazas: '30', firma: '', origen: 'Os Remedios', dirOrigen: 'Rúa Pardo de Cela, 2',
  });
  assert.equal(configPedirBus(cfg, null), null);
  assert.equal(configPedirBus({ salidas: ORIGEN }, salidas), null);
});

test('aNumero (ConvertTo-Numero)', () => {
  const casos = [['42,5', 42.5], [' 1e3 ', 1000], ['abc', 'D'], ['', 'D'], [null, 'D'], [5, 5], [true, 1], ['.5', 0.5],
    ['-.5', -0.5], ['5.', 5], ['+7', 7], ['1,234.5', 'D'], ['0x10', 'D'], [' -3,25 ', -3.25], ['1e', 'D']];
  for (const [valor, esperado] of casos) assert.equal(aNumero(valor, 'D'), esperado, JSON.stringify(valor));
});

test('distancia en línea recta', () => {
  // Os Remedios (Ourense) - Marín: 68,89 km con el .ps1.
  assert.ok(Math.abs(distanciaKm(42.3442759, -7.8713948, 42.3889848, -8.7077729) - 68.8929204170882) < 1e-9);
  assert.equal(distanciaKm(42, -7, 42, -7), 0);
});

test('dirección del pabellón: tildes reparadas, en mayúsculas y sin ", ESPAÑA" ni el código postal repetido', () => {
  assert.equal(direccionCampo('RÃºA SOBER, 6, 27420 MONFORTE DE LEMOS, LUGO, ESPAÃ±A'), 'RÚA SOBER, 6, 27420 MONFORTE DE LEMOS, LUGO');
  assert.equal(direccionCampo('Rúa do Pino, 3<br>Lugo, España '), 'RÚA DO PINO, 3 LUGO');
  assert.equal(direccionCampo(null), '');
  // Como la escribe la página del grupo (mostrarLugar): las letras con tilde en minúscula y el código postal otra vez.
  assert.equal(direccionCampo('RúA PARDO DE CELA, 2, 32002 OURENSE, ESPAñA, 32003'), 'RÚA PARDO DE CELA, 2, 32002 OURENSE');
  assert.equal(direccionCampo('RúA BARREIRO, 23, 15959 INSUELA, A CORUñA, ESPAñA, 15959'), 'RÚA BARREIRO, 23, 15959 INSUELA, A CORUÑA');
  // «ESPAÑA» dentro de la dirección se queda.
  assert.equal(direccionCampo('O PAVILLóN VELLO, CALLE ESPAñA, O BARCO, OURENSE, GALICIA, 32300, ESPAñA, 32300'),
    'O PAVILLÓN VELLO, CALLE ESPAÑA, O BARCO, OURENSE, GALICIA, 32300');
});

test('municipioDe: lo que sigue al código postal, hasta la coma', () => {
  assert.equal(municipioDe('RÚA PARDO DE CELA, 2, 32002 OURENSE'), 'OURENSE');
  assert.equal(municipioDe('RÚA BARREIRO, 23, 15959 INSUELA, A CORUÑA'), 'INSUELA');
  assert.equal(municipioDe('AV. DE CASTELAO, 66, COIA, 36209 VIGO, PONTEVEDRA'), 'VIGO');
  assert.equal(municipioDe('RÚA DE EMILIO E MANUEL, 3, 15702 SANTIAGO DE COMPOSTELA, A CORUÑA'), 'SANTIAGO DE COMPOSTELA');
  // Sin nada detrás del código postal, o sin código: sin municipio (se puede poner a mano en pabellones.json).
  assert.equal(municipioDe('O PAVILLÓN VELLO, CALLE ESPAÑA, O BARCO, OURENSE, GALICIA, 32300'), '');
  assert.equal(municipioDe('RÚA DO PINO, 3 LUGO'), '');
  assert.equal(municipioDe(''), '');
  // ... salvo que el nombre del pabellón lo lleve al final, entre paréntesis (no una pista).
  const monteNeme = 'INSTITUTO DE EDUCACIÓN SECUNDARIA MONTE NEME, 29, RÚA ROMEU, FONTE DA CRISTINA, A CRISTINA, CARBALLO, BERGANTIÑOS, '
    + 'LA CORUÑA, GALICIA, 15106';
  assert.equal(municipioDe(monteNeme, 'IES MONTENEME (CARBALLO)'), 'CARBALLO');
  assert.equal(municipioDe(monteNeme, 'PABELLON X (PISTA CENTRAL)'), '');
  assert.equal(municipioDe(monteNeme, 'PABELLON X (2)'), '');
  assert.equal(municipioDe('RÚA PARDO DE CELA, 2, 32002 OURENSE', 'ANEXO (OTRO SITIO)'), 'OURENSE');
});

// --- pabellones.json y consultas (fetch simulado) ------------------------------------------------

const CFG = configSalidas({ salidas: ORIGEN });
const ORIGEN_TXT = '42.3442759,-7.8713948';

// Sustituye fetch mientras dura f; las respuestas salen de responder(url, parámetros).
async function conFetch(responder, f) {
  const original = globalThis.fetch;
  const pedidas = [];
  globalThis.fetch = async (url, opciones = {}) => {
    const datos = opciones.body ? Object.fromEntries(new URLSearchParams(String(opciones.body))) : {};
    pedidas.push(datos.accion ?? String(url));
    return new Response(responder(String(url), datos), { status: 200 });
  };
  try {
    return [await f(), pedidas];
  } finally {
    globalThis.fetch = original;
  }
}

function carpetaTemporal() { return mkdtempSync(join(tmpdir(), 'salidas-')); }

// Respuesta fija de OSRM (46,1 km y 42 min en coche).
const OSRM_LUGO = JSON.stringify({ code: 'Ok', routes: [{ distance: 46149.3, duration: 2501.2 }] });
// Solo responde OSRM: cualquier otra consulta (la federación) es un error de la prueba.
function soloOsrm(respuesta) {
  return (url) => {
    if (url.startsWith('https://router.project-osrm.org/')) return respuesta;
    throw new Error(`no previsto: ${url}`);
  };
}
// El sitio de cada pabellón según las páginas de los grupos (lugaresDeCache de federacion.js): la dirección, tal cual.
const LUGARES = new Map([
  ['NUEVO PABELLON - PISTA 1', { lat: 42.51356, lon: -7.52425, direccion: 'RúA SOBER, 6, 27420 MONFORTE DE LEMOS, LUGO, ESPAñA, 27420' }],
  ['VIEJO', { lat: 43.0, lon: -8.0, direccion: 'RúA CARBALLO CALERO, 15, 15100 CARBALLO, A CORUñA, ESPAñA, 15100' }],
  ['A PINGUELA - PISTA 1', { lat: 42.6, lon: -7.6, direccion: 'OTRA DIRECCIÓN, 1, 27420 MONFORTE DE LEMOS, ESPAñA, 27420' }],
  ['ANEXO OS REMEDIOS - PISTA 1', { lat: 42.3438638, lon: -7.8701618, direccion: 'RúA PARDO DE CELA, 2, 32002 OURENSE, ESPAñA, 32003' }],
  // Como la da la federación para el SF1 del 08/11/2026: el código postal, al final.
  ['IES MONTENEME (CARBALLO)', { lat: 43.21241694345236, lon: -8.703918498991985,
    direccion: 'INSTITUTO DE EDUCACIóN SECUNDARIA MONTE NEME, 29, RúA ROMEU, FONTE DA CRISTINA, A CRISTINA, CARBALLO, BERGANTIñOS, '
      + 'LA CORUñA, GALICIA, 15106, ESPAñA, 15106' }],
]);

test('resolverPabellones: con la caché al día no se consulta nada ni se reescribe', async () => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    // "OTRO" (de un partido sin fecha ni hora) ya está apuntado como «sin-datos» y la página sigue sin decir dónde está.
    const cache = {
      'A PINGUELA - PISTA 1': { id_campo: '68', municipio: 'MONFORTE DE LEMOS', direccion: 'RÚA SOBER', lat: 42.51356, lon: -7.52425, km: 46.1, minutos_coche: 42, fuente: 'osrm', origen: ORIGEN_TXT, fecha: '2026-09-24' },
      OTRO: { fuente: 'sin-datos', origen: ORIGEN_TXT, fecha: '2026-09-25' },
    };
    writeFileSync(ruta, JSON.stringify(cache));
    const antes = readFileSync(ruta, 'utf8');
    const ps = [partido('2026-10-04 11:30', 'A PINGUELA - PISTA 1', 'CF1'), partido('2026-10-05 00:00', 'OTRO', 'CF1', 'pendiente')];
    // La página da otro sitio para A PINGUELA: lo guardado manda (no se toca).
    const [r, pedidas] = await conFetch(() => { throw new Error('no debería consultar'); },
      () => resolverPabellones(ps, CFG, ruta, fechaPared(2026, 9, 25), { lugares: LUGARES }));
    assert.deepEqual(pedidas, []);
    assert.deepEqual(r['A PINGUELA - PISTA 1'], cache['A PINGUELA - PISTA 1']);
    assert.equal(readFileSync(ruta, 'utf8'), antes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolverPabellones: un pabellón nuevo sale de la página del grupo: ninguna consulta a la federación y una a OSRM', async (t) => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    // VIEJO se guardó sin dirección: se completa con la de la página, sin red y sin tocar lo demás.
    const viejo = { id_campo: '30', municipio: 'CARBALLO', lat: 43.2, lon: -8.7, km: 151.1, minutos_coche: 120, fuente: 'osrm', origen: ORIGEN_TXT, fecha: '2026-01-01' };
    writeFileSync(ruta, JSON.stringify({ VIEJO: viejo }));
    const ps = ['VIEJO', 'NUEVO PABELLON - PISTA 1', 'NINGUNO'].map((n) => partido('2026-10-04 11:30', n, n));
    const [cache, pedidas] = await sinEsperas(t, () => conFetch(soloOsrm(OSRM_LUGO),
      () => resolverPabellones(ps, CFG, ruta, fechaPared(2026, 11, 6), { lugares: LUGARES })));
    assert.equal(pedidas.length, 1);
    assert.match(pedidas[0], /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/-7\.8713948,42\.3442759;-7\.52425,42\.51356\?overview=false$/);
    // El nuevo: sin número de la federación, con el municipio y la dirección limpia de la página.
    assert.deepEqual(cache['NUEVO PABELLON - PISTA 1'], {
      id_campo: '', municipio: 'MONFORTE DE LEMOS', direccion: 'RÚA SOBER, 6, 27420 MONFORTE DE LEMOS, LUGO', lat: 42.51356, lon: -7.52425,
      km: 46.1, minutos_coche: 42, fuente: 'osrm', origen: ORIGEN_TXT, fecha: '2026-11-06',
    });
    // Sin sitio en la página: sin datos (se calculará cuando la página lo traiga).
    assert.deepEqual(cache.NINGUNO, { fuente: 'sin-datos', origen: ORIGEN_TXT, fecha: '2026-11-06' });
    assert.deepEqual(cache.VIEJO, { ...viejo, direccion: 'RÚA CARBALLO CALERO, 15, 15100 CARBALLO, A CORUÑA' });
    assert.deepEqual(Object.keys(cache.VIEJO), ['id_campo', 'municipio', 'direccion', 'lat', 'lon', 'km', 'minutos_coche', 'fuente', 'origen', 'fecha']);
    // Se guarda en orden alfabético, con cuatro espacios.
    const guardado = readFileSync(ruta, 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(guardado)), ['NINGUNO', 'NUEVO PABELLON - PISTA 1', 'VIEJO']);
    assert.ok(guardado.startsWith('{\n    "NINGUNO": {\n        "fuente": "sin-datos",'));
    // Sin lugares (ni federación): el nuevo, sin datos.
    rmSync(ruta);
    const [sin, ninguna] = await conFetch(() => { throw new Error('no debería consultar'); },
      () => resolverPabellones(ps.slice(1, 2), CFG, ruta, fechaPared(2026, 11, 6)));
    assert.deepEqual(ninguna, []);
    assert.deepEqual(sin['NUEVO PABELLON - PISTA 1'], { fuente: 'sin-datos', origen: ORIGEN_TXT, fecha: '2026-11-06' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolverPabellones: un «sin-datos» que sigue sin sitio en la página no se reescribe cada día (solo cambiaría la fecha)', async () => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    // Apuntado ayer: la página sigue dando el pabellón sin coordenadas, y ya no hay nada más que consultar.
    writeFileSync(ruta, JSON.stringify({ OTRO: { fuente: 'sin-datos', origen: ORIGEN_TXT, fecha: '2026-11-25' } }));
    const antes = readFileSync(ruta, 'utf8');
    const ps = [partido('2026-11-28 10:30', 'OTRO', 'IF1')];
    const [cache, pedidas] = await conFetch(() => { throw new Error('no debería consultar'); },
      () => resolverPabellones(ps, CFG, ruta, fechaPared(2026, 11, 26), { lugares: LUGARES }));
    assert.deepEqual(pedidas, []);
    assert.deepEqual(cache.OTRO, { fuente: 'sin-datos', origen: ORIGEN_TXT, fecha: '2026-11-25' });
    assert.equal(readFileSync(ruta, 'utf8'), antes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolverPabellones: un pabellón con las coordenadas puestas a mano (la federación no las da): se calcula el viaje y lo demás se conserva', async (t) => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    // Como se apunta a mano en pabellones.json: municipio, dirección, lat y lon; el viaje lo pone el programa.
    const aMano = { id_campo: '', municipio: 'OURENSE', direccion: 'RÚA DE EDUARDO BLANCO AMOR, AS LAGOAS, OURENSE', lat: 42.3449319, lon: -7.8578327 };
    writeFileSync(ruta, JSON.stringify({ 'I.E.S. AS LAGOAS': aMano }));
    const ps = [partido('2026-11-28 10:30', 'I.E.S. AS LAGOAS', 'IF1')];
    const [cache, pedidas] = await sinEsperas(t, () => conFetch(soloOsrm(OSRM_LUGO),
      () => resolverPabellones(ps, CFG, ruta, fechaPared(2026, 11, 26), { lugares: LUGARES })));
    assert.deepEqual(pedidas, ['https://router.project-osrm.org/route/v1/driving/-7.8713948,42.3442759;-7.8578327,42.3449319?overview=false']);
    assert.deepEqual(cache['I.E.S. AS LAGOAS'], { ...aMano, km: 46.1, minutos_coche: 42, fuente: 'osrm', origen: ORIGEN_TXT, fecha: '2026-11-26' });
    assert.deepEqual(JSON.parse(readFileSync(ruta, 'utf8')), { ...cache });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolverPabellones: un pabellón «sin-datos» se calcula en cuanto la página trae su sitio, aunque ya se mirara hoy', async (t) => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    writeFileSync(ruta, JSON.stringify({ 'NUEVO PABELLON - PISTA 1': { fuente: 'sin-datos', origen: ORIGEN_TXT, fecha: '2026-11-06' } }));
    const ps = [partido('2026-11-08 11:30', 'NUEVO PABELLON - PISTA 1', 'XF1')];
    const [cache, pedidas] = await sinEsperas(t, () => conFetch(soloOsrm(OSRM_LUGO),
      () => resolverPabellones(ps, CFG, ruta, fechaPared(2026, 11, 6), { lugares: LUGARES })));
    assert.equal(pedidas.length, 1);
    assert.deepEqual([cache['NUEVO PABELLON - PISTA 1'].fuente, cache['NUEVO PABELLON - PISTA 1'].km], ['osrm', 46.1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolverPabellones: sin municipio tras el código postal, el que lleva el nombre del pabellón entre paréntesis', async (t) => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    const ps = [partido('2026-11-08 12:00', 'IES MONTENEME (CARBALLO)', 'SF1')];
    const [cache] = await sinEsperas(t, () => conFetch(soloOsrm(OSRM_LUGO),
      () => resolverPabellones(ps, CFG, ruta, fechaPared(2026, 11, 6), { lugares: LUGARES })));
    assert.deepEqual([cache['IES MONTENEME (CARBALLO)'].municipio, cache['IES MONTENEME (CARBALLO)'].direccion], ['CARBALLO',
      'INSTITUTO DE EDUCACIÓN SECUNDARIA MONTE NEME, 29, RÚA ROMEU, FONTE DA CRISTINA, A CRISTINA, CARBALLO, BERGANTIÑOS, LA CORUÑA, GALICIA, 15106']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cercaSinMunicipio: los pabellones cercanos sin municipio apuntado, que salen como de fuera aunque sean de municipios_casa (para avisarlo)', async (t) => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    const cfg = configSalidas({ salidas: { ...ORIGEN, municipios_casa: ['Ourense', 'Orense'], tiempos_viaje_minutos: { 'Con tiempo a mano': 10 } } });
    // A 1,4 km del club (donde O Pompeo), ya con su ruta: no hay nada que consultar.
    const cerca = { lat: 42.3330403, lon: -7.8649539, km: 2.2, minutos_coche: 5, fuente: 'osrm', origen: ORIGEN_TXT, fecha: '2026-11-25' };
    writeFileSync(ruta, JSON.stringify({
      'SOLO LAT Y LON': cerca,                                                           // puesto a mano, sin municipio
      'O POMPEO': { ...cerca, municipio: 'OURENSE' },                                    // en casa por su municipio
      'DE OTRO MUNICIPIO': { ...cerca, municipio: 'BARBADÁS' },                          // de fuera, y se sabe de dónde es
      'CON TIEMPO A MANO': cerca,                                                        // ya decidido en config.json
      'JUNTO AL CLUB': { ...cerca, lat: 42.3438638, lon: -7.8701618 },                   // en casa por radio_casa_km
      LEJOS: { ...cerca, lat: 42.4153, lon: -6.9817, km: 101.2, minutos_coche: 75 },     // a 73 km: no es de aquí
      'SIN SITIO': { fuente: 'sin-datos', origen: ORIGEN_TXT, fecha: '2026-11-25' },     // ya sale «sin tiempo de viaje»
    }));
    // Un pabellón nuevo de Ourense, a 1,1 km, con la dirección como la da la federación para el I.E.S. AS LAGOAS (el
    // código postal, al final): de ella no sale el municipio.
    const lugares = new Map([['IES NUEVO', { lat: 42.3449319, lon: -7.8578327,
      direccion: 'RúA DE EDUARDO BLANCO AMOR, AS LAGOAS, OURENSE, ORENSE, GALICIA, 32003, ESPAñA, 32003' }]]);
    const partidos = () => [
      ...['IES NUEVO', 'Ies Nuevo', 'O POMPEO', 'DE OTRO MUNICIPIO', 'CON TIEMPO A MANO', 'JUNTO AL CLUB', 'LEJOS', 'SIN SITIO', '']
        .map((n, i) => partido('2026-11-28 19:00', n, `EQUIPO ${i}`)),
      partido('2026-12-12 00:00', 'Solo lat y lon', 'XF1', 'pendiente'),                 // sin hora y con otras mayúsculas
    ];
    const ps = partidos();
    const osrm = JSON.stringify({ code: 'Ok', routes: [{ distance: 2200, duration: 290 }] });
    const [cache, pedidas] = await sinEsperas(t, () => conFetch(soloOsrm(osrm),
      () => resolverPabellones(ps, cfg, ruta, fechaPared(2026, 11, 26), { lugares })));
    assert.equal(pedidas.length, 1);
    assert.deepEqual([cache['IES NUEVO'].municipio, cache['IES NUEVO'].direccion],
      ['', 'RÚA DE EDUARDO BLANCO AMOR, AS LAGOAS, OURENSE, ORENSE, GALICIA, 32003']);
    // Salen como de fuera, con su bus (5 min * 1,10 -> 15), igual que el de otro municipio.
    anadirSalidas(ps, cache, cfg);
    assert.deepEqual(ps.map((p) => [p.enCasa, p.viajeMin]),
      [[false, 15], [false, 15], [true, null], [false, 15], [false, 10], [true, null], [false, 90], [false, null], [false, null], [false, null]]);
    // Solo se avisan esos dos (también el del partido sin hora): una vez cada uno, con el nombre de pabellones.json (el
    // que hay que corregir) y los km en línea recta.
    assert.deepEqual(cercaSinMunicipio(ps, cache, cfg), ['IES NUEVO (a 1,1 km)', 'SOLO LAT Y LON (a 1,4 km)']);
    // Sin municipios_casa no hay nada que avisar: nadie es «en casa» por su municipio.
    assert.deepEqual(cercaSinMunicipio(ps, cache, configSalidas({ salidas: ORIGEN })), []);
    // Con el municipio escrito a mano en pabellones.json, en casa y sin aviso.
    const corregido = { ...cache, 'IES NUEVO': { ...cache['IES NUEVO'], municipio: 'Ourense' }, 'SOLO LAT Y LON': { ...cerca, municipio: 'ORENSE' } };
    const qs = partidos();
    anadirSalidas(qs, corregido, cfg);
    assert.deepEqual([qs[0].enCasa, qs[1].enCasa, qs[9].enCasa], [true, true, true]);
    assert.deepEqual(cercaSinMunicipio(qs, corregido, cfg), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolverPabellones: también busca los pabellones de los partidos sin hora (para saber si son en casa)', async (t) => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    const ps = [
      partido('2026-10-04 00:00', 'ANEXO OS REMEDIOS - PISTA 1', 'CF1', 'sinhora'),
      partido('2026-10-11 00:00', 'ANEXO OS REMEDIOS - PISTA 1', 'XF1', 'pendiente'),
      partido('2026-10-11 00:00', '', 'IF1', 'pendiente'),
    ];
    const osrm = JSON.stringify({ code: 'Ok', routes: [{ distance: 700, duration: 60 }] });
    const [cache, pedidas] = await sinEsperas(t, () => conFetch(soloOsrm(osrm),
      () => resolverPabellones(ps, CFG, ruta, fechaPared(2026, 9, 25), { lugares: LUGARES })));
    assert.equal(pedidas.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ruta, 'utf8'))), ['ANEXO OS REMEDIOS - PISTA 1']);
    assert.deepEqual([cache['ANEXO OS REMEDIOS - PISTA 1'].municipio, cache['ANEXO OS REMEDIOS - PISTA 1'].km], ['OURENSE', 0.7]);
    anadirSalidas(ps, cache, CFG);
    assert.deepEqual(ps.map((p) => [p.enCasa, p.municipio]), [[true, 'OURENSE'], [true, 'OURENSE'], [false, '']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolverPabellones: un pabellón con otras mayúsculas usa la entrada que ya hay (@{} en el .ps1)', async (t) => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    const entrada = { id_campo: '68', municipio: 'MONFORTE DE LEMOS', direccion: 'RÚA SOBER', lat: 42.51356, lon: -7.52425, km: 46.1, minutos_coche: 42, fuente: 'osrm', origen: ORIGEN_TXT, fecha: '2026-09-24' };
    writeFileSync(ruta, JSON.stringify({ 'A PINGUELA - PISTA 1': entrada }));
    const antes = readFileSync(ruta, 'utf8');
    // La federación escribe el nombre con otras mayúsculas: ni consultas ni pabellones.json nuevo.
    const ps = [partido('2026-10-04 11:30', 'A Pinguela - Pista 1', 'CF1'), partido('2026-10-11 11:30', 'A PINGUELA - PISTA 1', 'IF1')];
    const [cache, pedidas] = await conFetch(() => { throw new Error('no debería consultar'); },
      () => resolverPabellones(ps, CFG, ruta, fechaPared(2026, 9, 25), { lugares: LUGARES }));
    assert.deepEqual(pedidas, []);
    assert.equal(readFileSync(ruta, 'utf8'), antes);
    anadirSalidas(ps, cache, CFG);
    assert.deepEqual(ps.map((p) => hm(p.salida)), ['09:30', '09:30']);

    // Si hay que volver a calcular la ruta (era una estimación de otro día), la entrada conserva su nombre y su sitio.
    writeFileSync(ruta, JSON.stringify({ 'A PINGUELA - PISTA 1': { ...entrada, fuente: 'estimado', fecha: '2026-01-01' } }));
    const [nueva, consultas] = await sinEsperas(t, () => conFetch(soloOsrm(OSRM_LUGO),
      () => resolverPabellones([ps[0]], CFG, ruta, fechaPared(2026, 9, 25), { lugares: LUGARES })));
    assert.equal(consultas.length, 1);
    assert.match(consultas[0], /;-7\.52425,42\.51356\?/);
    assert.deepEqual(Object.keys(nueva), ['A PINGUELA - PISTA 1']);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ruta, 'utf8'))), ['A PINGUELA - PISTA 1']);
    assert.deepEqual([nueva['A PINGUELA - PISTA 1'].fuente, nueva['A PINGUELA - PISTA 1'].fecha, nueva['A PINGUELA - PISTA 1'].direccion],
      ['osrm', '2026-09-25', 'RÚA SOBER']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rutaCoche: tiempo de OSRM; si falla o no da ruta, estimación por la distancia en línea recta', async (t) => {
  const original = globalThis.fetch;
  const ruta = (responder) => {
    globalThis.fetch = async () => responder();
    return sinEsperas(t, () => rutaCoche(42.3442759, -7.8713948, 42.8805, -8.5457));
  };
  try {
    // Valores del .ps1 (Get-RutaCoche) con las mismas respuestas.
    const osrm = await ruta(() => new Response('{"code":"Ok","routes":[{"distance":46250,"duration":2730.5}]}'));
    assert.deepEqual(osrm, { km: 46.2, minutos: 46, fuente: 'osrm' });
    for (const responder of [
      () => new Response('x', { status: 500 }),
      () => new Response('<html>'),
      () => new Response('{"code":"NoRoute","routes":[]}'),
      () => { throw new TypeError('fetch failed'); },
    ]) {
      assert.deepEqual(await ruta(responder), { km: 109.7, minutos: 95, fuente: 'estimado' });
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('caché de pabellones: archivo que no existe o que no se entiende', async () => {
  const dir = carpetaTemporal();
  try {
    assert.deepEqual({ ...leerCachePabellones(join(dir, 'no-existe.json')) }, {});
    const ruta = join(dir, 'roto.json');
    writeFileSync(ruta, '{ roto');
    const [cache, avisos] = await enSilencio(() => leerCachePabellones(ruta));
    assert.deepEqual({ ...cache }, {});
    assert.deepEqual(avisos, ['  ! pabellones.json no se puede leer; se volverán a calcular los viajes.']);
    guardarCachePabellones({ b: { x: 1 }, Á: { x: 2 }, a: { x: 3 } }, ruta);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ruta, 'utf8'))), ['a', 'Á', 'b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('viaje a 100 km/h con los km por carretera (lo que piden los entrenadores) y salida siempre a la hora o a la media', () => {
  const cfg = configSalidas({ salidas: { ...ORIGEN, velocidad_bus_kmh: 100, redondeo_salida_minutos: 30 } });
  const pabs = {
    ...PABELLONES,
    'PALMEIRA': { lat: 42.581729, lon: -8.9609354, km: 160.4, minutos_coche: 111, municipio: 'PALMEIRA', fuente: 'osrm' },
    'SIN KM': { lat: 42.51356, lon: -7.52425, km: null, minutos_coche: 42, municipio: 'MONFORTE DE LEMOS', fuente: 'osrm' },
  };
  const ps = [
    // 160,4 km a 100 km/h = 96,2 min -> 105 (al cuarto, al alza); 11:30 - 60 - 105 = 8:45 -> 8:30 (a la media, a la baja).
    partido('2026-10-03 11:30', 'PALMEIRA', 'IF1'),
    // 46,1 km = 27,7 min -> 30; 12:15 - 60 - 30 = 10:45 -> 10:30.
    partido('2026-10-04 12:15', 'A PINGUELA - PISTA 1', 'CF1'),
    // 46,1 km -> 30; 11:30 - 60 - 30 = 10:00 (ya en punto: se queda).
    partido('2026-10-05 11:30', 'A PINGUELA - PISTA 1', 'CF1'),
    // Sin km: el tiempo en coche de siempre (42 min * 1,10 -> 60); 11:30 - 60 - 60 = 9:30.
    partido('2026-10-06 11:30', 'SIN KM', 'SF1'),
  ];
  anadirSalidas(ps, pabs, cfg);
  // El calentamiento empieza al llegar (salida + viaje): lo que se gana al redondear la salida es calentamiento.
  assert.deepEqual(ps.map((p) => [p.viajeMin, hm(p.salida), hm(p.calentamiento)]),
    [[105, '08:30', '10:15'], [30, '10:30', '11:00'], [30, '10:00', '10:30'], [60, '09:30', '10:30']]);
  // Nunca a y cuarto ni a menos cuarto.
  for (const p of ps) assert.ok(['00', '30'].includes(hm(p.salida).slice(3)), hm(p.salida));
  // En casa, como siempre: el calentamiento, sin salida.
  const casa = partido('2026-10-03 12:00', 'ANEXO OS REMEDIOS - PISTA 1', 'SM1');
  anadirSalidas([casa], pabs, cfg);
  assert.deepEqual([casa.enCasa, casa.salida, hm(casa.inicio)], [true, null, '11:00']);
});
