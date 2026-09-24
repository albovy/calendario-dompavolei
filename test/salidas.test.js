// Pruebas de src/salidas.js, sin red (fetch simulado). Los valores esperados salen de las funciones
// originales de calendario-voley.ps1 con las mismas entradas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aNumero, anadirSalidas, buscarCampos, configPedirBus, configSalidas, direccionCampo, distanciaKm,
  guardarCachePabellones, leerCachePabellones, lineasSalida, resolverPabellones, rutaCoche, textoSalida,
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
  assert.deepEqual(ps.map((p) => [p.viajeFuente, p.municipio, p.km]), [
    ['', 'OURENSE', 0.7], ['osrm', 'MONFORTE DE LEMOS', 46.1], ['osrm', 'MONFORTE DE LEMOS', 46.1],
    ['manual', '', null], ['', '', null], ['osrm', 'MONFORTE DE LEMOS', 46.1], ['', '', null],
  ]);

  assert.deepEqual(ps.map((p) => lineasSalida(p, cfg).join(' || ')), [
    'En casa · calentamiento 10:30 · partido 11:30',
    'Salida 09:30 desde Os Remedios · bus 1 h || Calentamiento 10:30 · partido 11:30',
    '2º partido del día: se va con el primero (salida 09:30)',
    'Salida 16:15 desde Os Remedios · bus 40 min || Calentamiento 17:00 · partido 18:00',
    'Viaje sin calcular · calentamiento 11:00 · partido 12:00',
    'Salida 16:00 desde Os Remedios · bus 1 h || Calentamiento 17:00 · partido 18:00 (provisional)',
    '',
  ]);
  assert.deepEqual(ps.map(textoSalida), ['En casa', '09:30', '2º partido', '16:15', 'Sin calcular', '16:00', '']);
  assert.deepEqual(lineasSalida(ps[0], null), []);
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
  assert.deepEqual({ ...cfg, manual: [...cfg.manual] }, {
    origen: 'el pabellón del club', lat: 42.5, lon: -7.8, calentamiento: 60, factorBus: 1.25, margen: 0,
    redondeoViaje: 1, redondeo: 15, radioCasaKm: 2, manual: [['PAZO DOS DEPORTES', 26]],
  });
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

test('buscarCampos: exacto, por principio y por palabras significativas', () => {
  const campo = (id, nombre) => ({ id, nombre, municipio: 'M', clave: nombre });
  const campos = [
    campo('1', 'A PINGUELA'), campo('2', 'A PINGUELA PISTA 1'), campo('3', 'PAZO DOS DEPORTES'),
    campo('4', 'PAZO DOS DEPORTES PISTA 2'), campo('5', 'POLIDEPORTIVO MUNICIPAL DE TEIS'), campo('6', 'PISTA 1'),
  ];
  const ids = (n) => buscarCampos(n, campos).map((c) => c.id).join(',');
  assert.equal(ids('Pazo dos Deportes'), '3');                   // exacto (sin tildes ni mayúsculas)
  assert.equal(ids('PAZO DOS DEPORTES - PISTA 3'), '3');         // el de la federación es el principio
  assert.equal(ids('A PINGUELA'), '1');
  assert.equal(ids('PAZO'), '4,3');                              // el del partido es el principio (el más largo antes)
  assert.equal(ids('PABELLÓN DE TEIS - PISTA 2'), '5');          // palabras significativas: TEIS
  assert.equal(ids('ANEXO - PISTA 1'), '');                      // sin palabras significativas
  assert.equal(ids(''), '');
});

test('dirección del pabellón: tildes reparadas, en mayúsculas y sin ", ESPAÑA"', () => {
  assert.equal(direccionCampo('RÃºA SOBER, 6, 27420 MONFORTE DE LEMOS, LUGO, ESPAÃ±A'), 'RÚA SOBER, 6, 27420 MONFORTE DE LEMOS, LUGO');
  assert.equal(direccionCampo('Rúa do Pino, 3<br>Lugo, España '), 'RÚA DO PINO, 3 LUGO');
  assert.equal(direccionCampo(null), '');
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

test('resolverPabellones: con la caché al día no se consulta nada ni se reescribe', async () => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    const cache = { 'A PINGUELA - PISTA 1': { id_campo: '68', municipio: 'MONFORTE DE LEMOS', direccion: 'RÚA SOBER', lat: 42.51356, lon: -7.52425, km: 46.1, minutos_coche: 42, fuente: 'osrm', origen: ORIGEN_TXT, fecha: '2026-09-24' } };
    writeFileSync(ruta, JSON.stringify(cache));
    const antes = readFileSync(ruta, 'utf8');
    const ps = [partido('2026-10-04 11:30', 'A PINGUELA - PISTA 1', 'CF1'), partido('2026-10-05 00:00', 'OTRO', 'CF1', 'pendiente')];
    const [r, pedidas] = await conFetch(() => { throw new Error('no debería consultar'); }, () => resolverPabellones(ps, CFG, fechaPared(2025, 8, 1), ruta));
    assert.deepEqual(pedidas, []);
    assert.deepEqual(r['A PINGUELA - PISTA 1'], cache['A PINGUELA - PISTA 1']);
    assert.equal(readFileSync(ruta, 'utf8'), antes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolverPabellones: pabellón nuevo, sin datos y dirección que faltaba', async (t) => {
  const dir = carpetaTemporal();
  try {
    const ruta = join(dir, 'pabellones.json');
    // Guardado antes de que se apuntara la dirección: se completa una vez.
    writeFileSync(ruta, JSON.stringify({ 'VIEJO': { id_campo: '30', municipio: 'CARBALLO', lat: 43.2, lon: -8.7, km: 151.1, minutos_coche: 120, fuente: 'osrm', origen: ORIGEN_TXT, fecha: '2026-01-01' } }));
    const ps = ['VIEJO', 'NUEVO PABELLON - PISTA 1', 'NINGUNO'].map((n) => partido('2026-10-04 11:30', n, n));
    const responder = (url, datos) => {
      if (url.includes('router.project-osrm.org')) return JSON.stringify({ code: 'Ok', routes: [{ distance: 46149.3, duration: 2501.2 }] });
      if (datos.accion === 'obtener_pabellones') return JSON.stringify({ data: [{ id_campo: '68', nombre: 'NUEVO PABELLON', municipio: 'MONFORTE DE LEMOS' }] });
      if (datos.accion === 'obtener_info_campo') {
        const direccion = datos.id === '68' ? 'RÃºA SOBER, 6, ESPAÃ±A' : 'RÃºA CARBALLO CALERO, 15, ESPAÃ±A';
        return JSON.stringify({ data: [{ direccion, latitud: '42.51356', longitud: '-7.52425' }] });
      }
      throw new Error(`no previsto: ${url}`);
    };
    const [cache, pedidas] = await sinEsperas(t, () => conFetch(responder,
      () => resolverPabellones(ps, CFG, fechaPared(2025, 8, 1), ruta)));
    assert.deepEqual(pedidas, ['obtener_pabellones', 'obtener_info_campo', pedidas[2], 'obtener_info_campo']);
    assert.match(pedidas[2], /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/-7\.8713948,42\.3442759;-7\.52425,42\.51356\?overview=false$/);
    const hoy = cache.NINGUNO.fecha;
    assert.match(hoy, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(cache['NUEVO PABELLON - PISTA 1'], {
      id_campo: '68', municipio: 'MONFORTE DE LEMOS', direccion: 'RÚA SOBER, 6', lat: 42.51356, lon: -7.52425,
      km: 46.1, minutos_coche: 42, fuente: 'osrm', origen: ORIGEN_TXT, fecha: hoy,
    });
    assert.deepEqual(cache.NINGUNO, { fuente: 'sin-datos', origen: ORIGEN_TXT, fecha: hoy });
    assert.deepEqual(Object.keys(cache.VIEJO), ['id_campo', 'municipio', 'direccion', 'lat', 'lon', 'km', 'minutos_coche', 'fuente', 'origen', 'fecha']);
    assert.equal(cache.VIEJO.direccion, 'RÚA CARBALLO CALERO, 15');
    // Se guarda en orden alfabético, con cuatro espacios.
    const guardado = readFileSync(ruta, 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(guardado)), ['NINGUNO', 'NUEVO PABELLON - PISTA 1', 'VIEJO']);
    assert.ok(guardado.startsWith('{\n    "NINGUNO": {\n        "fuente": "sin-datos",'));
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
      () => resolverPabellones(ps, CFG, fechaPared(2025, 8, 1), ruta));
    assert.deepEqual(pedidas, []);
    assert.equal(readFileSync(ruta, 'utf8'), antes);
    anadirSalidas(ps, cache, CFG);
    assert.deepEqual(ps.map((p) => hm(p.salida)), ['09:30', '09:30']);

    // Si hay que volver a calcular la ruta (era una estimación de otro día), la entrada conserva su nombre.
    writeFileSync(ruta, JSON.stringify({ 'A PINGUELA - PISTA 1': { ...entrada, fuente: 'estimado', fecha: '2026-01-01' } }));
    const osrm = () => JSON.stringify({ code: 'Ok', routes: [{ distance: 46149.3, duration: 2501.2 }] });
    const [nueva, consultas] = await sinEsperas(t, () => conFetch(osrm,
      () => resolverPabellones([ps[0]], CFG, fechaPared(2025, 8, 1), ruta, fechaPared(2026, 9, 25))));
    assert.equal(consultas.length, 1);
    assert.deepEqual(Object.keys(nueva), ['A PINGUELA - PISTA 1']);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(ruta, 'utf8'))), ['A PINGUELA - PISTA 1']);
    assert.deepEqual([nueva['A PINGUELA - PISTA 1'].fuente, nueva['A PINGUELA - PISTA 1'].fecha], ['osrm', '2026-09-25']);
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
