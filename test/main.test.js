// Pruebas de src/main.js (opciones, temporada, clubs y el programa entero) sin red: fetch simulado
// y carpetas temporales. Son las pruebas de pruebas.ps1 (secciones 1, 3, 4 y 8) sobre el .ps1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  duracionConfig, fechaParametro, leerConfig, leerOpciones, mostrarError, nuevoRango, principal, rangoTemporada,
  resolverClubs, temporadaAnterior,
} from '../src/main.js';
import { configPedirBus, configSalidas } from '../src/salidas.js';
import { fechaPared, fmt } from '../src/util.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));

// Ejecuta f sin escribir en la consola y devuelve [resultado, líneas escritas].
async function enSilencio(f) {
  const lineas = [];
  const original = console.log;
  console.log = (texto = '') => lineas.push(texto);
  try {
    return [await f(), lineas];
  } finally {
    console.log = original;
  }
}

// Sustituye fetch mientras dura f: responde con responder(url, parámetros del formulario).
async function conFetch(responder, f) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opciones = {}) => {
    const datos = opciones.body ? Object.fromEntries(new URLSearchParams(String(opciones.body))) : {};
    return new Response(responder(String(url), datos), { status: 200 });
  };
  try {
    return await f();
  } finally {
    globalThis.fetch = original;
  }
}

function fila(fecha, local, visitante, idL, idV) {
  return {
    id_club_local: idL, id_club_visitante: idV, nombre_local: local, nombre_visitante: visitante,
    nombre_competicion: 'TORNEO APERTURA INFANTIL F', campo: 'ANEXO OS REMEDIOS - PISTA 1', categoria: 'INFANTIL',
    fecha, fecha_confirmada: '1', fecha_calendario: fecha.slice(0, 10),
  };
}

const DOMPA = '206572580';

// Carpeta temporal con config.json; devuelve su ruta.
function carpetaConConfig(config = { clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }] }) {
  const dir = mkdtempSync(join(tmpdir(), 'calendario-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

function soloPartidos(filas) {
  return (url, datos) => {
    if (datos.accion === 'obtener_partidos') return JSON.stringify({ data: filas });
    throw new Error(`no previsto: ${url}`);
  };
}

function eventos(ruta) { return readFileSync(ruta, 'utf8').split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length; }

test('opciones de la línea de comandos', () => {
  const op = leerOpciones(['--club', 'dompa, 206572577', '--temporada=2026-27', '--sin-equipos', '--duracion-minutos', '90']);
  assert.equal(op.club, 'dompa, 206572577');
  assert.equal(op.temporada, '2026-27');
  assert.equal(op.sinEquipos, true);
  assert.equal(op.listarClubs, false);
  assert.equal(op.duracionMinutos, 90);
  assert.equal(op.salida, '');
  assert.throws(() => leerOpciones(['--no-existe']), /Opciones no válidas/);
  assert.throws(() => leerOpciones(['--duracion-minutos', '601']), /entero de 0 a 600/);
  assert.throws(() => leerOpciones(['--duracion-minutos', 'mucho']), /entero de 0 a 600/);
});

test('duración en config.json: no numérica, fuera de rango o ausente -> 120', async () => {
  const casos = [[120, '120|0'], ['90', '90|0'], [' 45 ', '45|0'], ['+30', '30|0'], [0, '120|0'], ['0', '120|1'],
    [601, '120|1'], ['hora y media', '120|1'], [90.5, '120|1'], [null, '120|0'], ['', '120|0'], [true, '120|1'], ['1e2', '120|1']];
  for (const [valor, esperado] of casos) {
    const [n, avisos] = await enSilencio(() => duracionConfig({ duracion_minutos: valor }));
    assert.equal(`${n}|${avisos.length}`, esperado, JSON.stringify(valor));
  }
  const [, avisos] = await enSilencio(() => duracionConfig({ duracion_minutos: 'hora y media' }));
  assert.deepEqual(avisos, ['  ! duracion_minutos de config.json no es un número válido; se usan 120 minutos.']);
  assert.equal(duracionConfig(null), 120);
});

test('temporada y fechas', () => {
  const hoy = fechaPared(2026, 9, 24);
  const rango = (op) => {
    try {
      const r = rangoTemporada({ temporada: '', desde: '', hasta: '', ...op }, hoy);
      return `${r.etiqueta} ${fmt(r.inicio, 'dd/MM/yyyy')}-${fmt(r.fin, 'dd/MM/yyyy')} parcial=${r.parcial} explicito=${r.explicito}`;
    } catch (e) {
      return e.message;
    }
  };
  assert.equal(rango({}), '2026/27 01/08/2026-31/07/2027 parcial=false explicito=false');
  assert.equal(rango({ temporada: '2025/2026' }), '2025/26 01/08/2025-31/07/2026 parcial=false explicito=true');
  assert.equal(rango({ desde: '2026-09-26', hasta: '2026-09-27' }), '2026/27 26/09/2026-27/09/2026 parcial=true explicito=true');
  assert.equal(rango({ desde: '3/2/2027' }), '2026/27 03/02/2027-31/07/2027 parcial=true explicito=true');
  // Solo --hasta: usa su temporada.
  assert.equal(rango({ hasta: '2026-01-01' }), '2025/26 01/08/2025-01/01/2026 parcial=true explicito=true');
  assert.equal(rango({ temporada: '2026-27', desde: '2025-09-01' }),
    'Las fechas tienen que estar dentro de la temporada 2026/27 (del 01/08/2026 al 31/07/2027).');
  assert.equal(rango({ temporada: '2027-26' }),
    'Temporada no válida: «2027-26». El segundo año tiene que ser el siguiente (p. ej. 2026-27).');
  assert.equal(rango({ temporada: '9999-00' }), 'Temporada no válida: «9999-00».');
  assert.equal(rango({ temporada: '26-27' }), 'Temporada no válida: «26-27». Usa el formato 2026-27.');
  assert.equal(rango({ desde: '2026-10-10', hasta: '2026-10-01' }), 'La fecha final (01/10/2026) es anterior a la inicial (10/10/2026).');
  assert.equal(rango({ desde: '2026-02-30' }), 'Fecha «Desde» no válida: «2026-02-30». Usa el formato aaaa-mm-dd.');
  assert.equal(fmt(fechaParametro(' 03/02/2026 ', 'Desde'), 'yyyy-MM-dd'), '2026-02-03');
  assert.throws(() => fechaParametro('2026-2-3', 'Desde'), /no válida/);
});

test('clubs: config.json, --club por ID o por nombre, y nombres ambiguos', async () => {
  const cfg = { clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }, { id: '', nombre: 'sin id' }, { id: 123 }] };
  assert.deepEqual(await resolverClubs('', [], [], cfg), [{ id: DOMPA, nombre: 'DOMPAVOLEI' }, { id: '123', nombre: 'Club 123' }]);
  await assert.rejects(resolverClubs('', [], [], null), /No hay ningún club configurado en config.json/);

  const crudos = [
    fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'CV SAN SADURNIÑO', DOMPA, '206572600'),
    fila('2026-10-04 11:00:00', 'DOMPAVOLEI CF1', 'SAN MARTIÑO CF', DOMPA, '206572601'),
  ];
  // Listado oficial de clubs con la misma forma que la web de la federación.
  const listado = `<img src='https://x/afiliacion_clubs/${DOMPA}/a.jpg' alt='CV SAN MARTIÑO'>`
    + "<img src='https://x/afiliacion_clubs/206572600/b.jpg' alt='CV SAN SADURNIÑO'>";
  const responder = (url) => {
    if (url.includes('listado_clubs.php')) return listado;
    throw new Error(`no previsto: ${url}`);
  };
  const clubs = (texto) => conFetch(responder, () => resolverClubs(texto, crudos, crudos, cfg));
  assert.deepEqual((await clubs('dompa')).map((c) => [c.id, c.nombre, c.oficial]), [[DOMPA, 'DOMPAVOLEI', 'CV SAN MARTIÑO']]);
  assert.deepEqual((await clubs('206572601; dompavolei if1')).map((c) => [c.id, c.nombre]),
    [[DOMPA, 'DOMPAVOLEI'], ['206572601', 'SAN MARTIÑO CF']]);
  assert.deepEqual((await clubs('99999')).map((c) => [c.id, c.nombre]), [['99999', 'Club 99999']]);
  // En el orden del catálogo (por nombre).
  await assert.rejects(clubs('san'), {
    message: `Hay varios clubs que coinciden con «san»; indica el ID:\n    206572600  CV SAN SADURNIÑO\n    ${DOMPA}  DOMPAVOLEI\n    206572601  SAN MARTIÑO CF`,
  });
  await assert.rejects(clubs('inexistente'), /Ningún club ni equipo coincide con «inexistente»/);
});

test('config.json: los nombres no distinguen mayúsculas, como en ConvertFrom-Json', async () => {
  const dir = carpetaConConfig({
    Clubs: [{ ID: DOMPA, Nombre: 'DOMPAVOLEI' }],
    SALIDAS: {
      Origen: 'Os Remedios', Latitud: 42.3442759, LONGITUD: -7.8713948,
      Tiempos_Viaje_Minutos: { 'Pazo dos Deportes': 40, Malo: 'mucho' },
    },
    Pedir_Bus: { Para: 'bus@x.es' },
  });
  try {
    const cfg = leerConfig(join(dir, 'config.json'));
    assert.deepEqual(await resolverClubs('', [], [], cfg), [{ id: DOMPA, nombre: 'DOMPAVOLEI' }]);
    const [salidas, avisos] = await enSilencio(() => configSalidas(cfg));
    assert.deepEqual([salidas.origen, salidas.lat, salidas.lon, [...salidas.manual]],
      ['Os Remedios', 42.3442759, -7.8713948, [['PAZO DOS DEPORTES', 40]]]);
    // Los nombres de los pabellones se quedan como están (salen así en los avisos).
    assert.deepEqual(avisos, ['  ! config.json: el tiempo de viaje de «Malo» no es un número de minutos; se ignora.']);
    assert.equal(configPedirBus(cfg, salidas).para, 'bus@x.es');

    // Dos nombres que solo cambian en las mayúsculas: ConvertFrom-Json da error y el archivo se ignora.
    writeFileSync(join(dir, 'config.json'), '{"clubs": [], "Clubs": []}');
    const [nada, aviso] = await enSilencio(() => leerConfig(join(dir, 'config.json')));
    assert.equal(nada, null);
    assert.deepEqual(aviso, ['  ! config.json no se puede leer (los nombres «clubs» y «Clubs» están repetidos); se ignora.']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mostrarError: el mensaje en la consola y, si es un fallo del programa, la pila en stderr', async (t) => {
  const errores = [];
  t.mock.method(console, 'error', (texto) => errores.push(texto));
  const detalle = process.env.CALENDARIO_DETALLE;
  delete process.env.CALENDARIO_DETALLE;
  try {
    const aviso = new Error('Temporada no válida.');
    const [, consola] = await enSilencio(() => mostrarError(aviso));
    assert.deepEqual(consola, ['', '  ERROR: Temporada no válida.']);
    assert.deepEqual(errores, []);
    const fallo = new TypeError("Cannot read properties of null (reading 'lat')");
    const [, consola2] = await enSilencio(() => mostrarError(fallo));
    assert.deepEqual(consola2, ['', "  ERROR: Cannot read properties of null (reading 'lat')"]);
    assert.deepEqual(errores, [fallo.stack]);
    // Con CALENDARIO_DETALLE, también la de los mensajes para el usuario (como -Verbose).
    process.env.CALENDARIO_DETALLE = '1';
    await enSilencio(() => mostrarError(aviso));
    assert.deepEqual(errores, [fallo.stack, aviso.stack]);
  } finally {
    if (detalle === undefined) delete process.env.CALENDARIO_DETALLE;
    else process.env.CALENDARIO_DETALLE = detalle;
  }
});

test('se ejecuta con "node src/main.js" y con "node src/main", y no al importarlo', () => {
  const entorno = { ...process.env };
  delete entorno.CALENDARIO_DETALLE;   // sin la pila de los errores
  const ejecutar = (args) => spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: entorno });
  for (const programa of ['src/main.js', 'src/main', './src/main.js']) {
    const r = ejecutar([programa, '--duracion-minutos', '999']);
    assert.equal(r.status, 1, programa);
    assert.deepEqual(r.stdout.split(/\r?\n/),
      ['', '  ERROR: --duracion-minutos tiene que ser un número entero de 0 a 600 (no «999»).', '']);
    assert.equal(r.stderr, '', programa);
  }
  const importado = ejecutar(['-e', "import('./src/main.js').then(() => console.log('importado'))", 'x']);
  assert.deepEqual([importado.status, importado.stdout.trim(), importado.stderr], [0, 'importado', '']);
});

test('respuesta vacía de la federación a mitad de temporada: error y ningún archivo', async () => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const args = ['--config', join(dir, 'config.json'), '--salida', salida];
    const noviembre = new Date('2026-11-15T10:00:00Z');
    await enSilencio(() => assert.rejects(conFetch(() => '{"data":[]}', () => principal(args, noviembre)), /ningún partido/));
    await enSilencio(() => assert.rejects(conFetch(() => '{"data":null}', () => principal(args, noviembre)), /respuesta inesperada/));
    await enSilencio(() => assert.rejects(conFetch(() => '<html>', () => principal(args, noviembre)), /datos que no se entienden/));
    assert.equal(existsSync(salida), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('al empezar la temporada (antes de octubre) puede no haber nada publicado todavía', async () => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const args = ['--config', join(dir, 'config.json'), '--salida', salida];
    await enSilencio(() => conFetch(() => '{"data":[]}', () => principal(args, new Date('2026-09-10T10:00:00Z'))));
    assert.equal(existsSync(salida), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('temporada anterior: se descarga una vez, se guarda solo lo del club y luego se usa la copia', async () => {
  const dir = carpetaConConfig();
  try {
    const ruta = join(dir, 'temporada-anterior.json');
    const rango = nuevoRango(2026);
    const ids = new Set([DOMPA]);
    const filas = [
      fila('2025-10-04 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'),
      fila('2025-10-04 11:00:00', 'OTRO', 'RIVAL', '2', '1'),        // de otro club: no se guarda
      fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'), // de la temporada en curso: no se guarda
    ];
    let descargas = 0;
    const descargar = async (desde) => { descargas++; assert.equal(desde.getTime(), Date.UTC(2025, 7, 1)); return filas; };

    const [primera] = await enSilencio(() => temporadaAnterior({ rango, ids, ruta, guardar: true, descargar }));
    assert.equal(descargas, 1);
    assert.equal(primera.length, 1);
    assert.equal(primera[0].nombre_local, 'DOMPAVOLEI IF1');
    const copia = JSON.parse(readFileSync(ruta, 'utf8'));
    assert.equal(copia.anio, 2025);
    assert.deepEqual(copia.clubs, [DOMPA]);

    const [segunda] = await enSilencio(() => temporadaAnterior({ rango, ids, ruta, guardar: true, descargar }));
    assert.equal(descargas, 1, 'con copia no se vuelve a descargar');
    assert.deepEqual(segunda, primera);

    // Otro club: la copia no vale y se descarga de nuevo.
    await enSilencio(() => temporadaAnterior({ rango, ids: new Set(['1']), ruta, guardar: true, descargar }));
    assert.equal(descargas, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('temporada anterior: con otra temporada no se pisa la copia; si falla la descarga se sigue sin ella', async () => {
  const dir = carpetaConConfig();
  try {
    const ruta = join(dir, 'temporada-anterior.json');
    const ids = new Set([DOMPA]);
    await enSilencio(() => temporadaAnterior({ rango: nuevoRango(2024), ids, ruta, guardar: false, descargar: async () => [] }));
    assert.equal(existsSync(ruta), false);
    const [r] = await enSilencio(() => temporadaAnterior({
      rango: nuevoRango(2026), ids, ruta, guardar: true, descargar: async () => { throw new Error('sin red'); },
    }));
    assert.deepEqual(r, []);
    assert.equal(existsSync(ruta), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('en agosto, sin partidos aún en la temporada nueva, se genera la anterior', async () => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const filas = [
      fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'),
      fila('2027-03-06 12:00:00', 'RIVAL', 'DOMPAVOLEI IF1', '1', DOMPA),
      fila('2026-10-03 11:00:00', 'OTRO', 'RIVAL', '2', '1'),
    ];
    const ahora = new Date('2027-08-20T08:00:00Z');   // 10:00 en Galicia
    const historial = join(dir, 'historial', 'partidos.txt');
    const [, consola] = await enSilencio(() => conFetch(soloPartidos(filas),
      () => principal(['--config', dir, '--salida', salida, '--historial', historial], ahora)));
    assert.deepEqual(readdirSync(salida).sort(), [
      'calendario-dompavolei-2026-27.html', 'calendario-dompavolei-2026-27.ics', 'calendario-dompavolei-2026-27.xlsx', 'equipos',
      'salidas.html',
    ]);
    assert.equal(eventos(join(salida, 'calendario-dompavolei-2026-27.ics')), 2);
    assert.equal(eventos(join(salida, 'equipos', 'dompavolei-if1.ics')), 2);
    assert.ok(consola.includes('  ! Todavía no hay partidos de DOMPAVOLEI publicados para la temporada 2027/28.'));
    assert.ok(consola.includes('  Mientras tanto se genera el calendario de la temporada 2026/27.'));
    assert.ok(consola.includes('  2 partidos (0 por jugar) de 1 equipos.'));
    assert.equal(readFileSync(historial, 'utf8').split('\n')[0], '# Partidos de DOMPAVOLEI, temporada 2026/27 (Federación Galega de Voleibol)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rango parcial: nombre propio, sin calendarios por equipo; horas de salida con la caché', async () => {
  const config = {
    clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }],
    salidas: { origen: 'Os Remedios', latitud: 42.3442759, longitud: -7.8713948 },
  };
  const dir = carpetaConConfig(config);
  try {
    // El pabellón ya está en pabellones.json: no hace falta consultar nada.
    const origen = '42.3442759,-7.8713948';
    writeFileSync(join(dir, 'pabellones.json'), JSON.stringify({
      'ANEXO OS REMEDIOS - PISTA 1': { id_campo: '1', municipio: 'OURENSE', direccion: 'X', lat: 42.3438638, lon: -7.8701618, km: 0.7, minutos_coche: 1, fuente: 'osrm', origen, fecha: '2026-09-24' },
    }));
    const salida = join(dir, 'salida');
    const filas = [
      fila('2026-09-26 11:30:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'),
      fila('2026-09-27 12:00:00', 'RIVAL', 'DOMPAVOLEI CF1', '1', DOMPA),
      fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'),
    ];
    const ahora = new Date('2026-09-24T10:00:00Z');
    const [, consola] = await enSilencio(() => conFetch(soloPartidos(filas),
      () => principal(['--config', join(dir, 'config.json'), '--salida', salida, '--desde', '2026-09-26', '--hasta', '2026-09-27'], ahora)));
    const base = 'calendario-dompavolei-2026-27-20260926-20260927';
    assert.deepEqual(readdirSync(salida).sort(), [`${base}.html`, `${base}.ics`, `${base}.xlsx`, 'salidas.html']);
    assert.equal(eventos(join(salida, `${base}.ics`)), 2);
    assert.ok(consola.includes('  Calculando horas de salida desde Os Remedios...'));
    assert.ok(consola.some((l) => /^ {2}sáb 26\/09 +11:30 +en casa +Infantil F +DOMPAVOLEI IF1 - RIVAL$/.test(l)), consola.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function paginaDatos(nombre) { return readFileSync(new URL(`./datos/${nombre}`, import.meta.url), 'utf8'); }

// Los datos (JSON) que lleva una página generada.
function datosDePagina(ruta) {
  const html = readFileSync(ruta, 'utf8');
  const inicio = '<script id="datos" type="application/json">';
  const i = html.indexOf(inicio) + inicio.length;
  return JSON.parse(html.slice(i, html.indexOf('</script>', i)));
}

test('resultados: el .ics y la página llevan el marcador y la clasificación; se guarda resultados.json', async () => {
  const dir = carpetaConConfig();
  try {
    // El escudo del club, junto a config.json: la página nueva (salidas.html) lo lleva dentro.
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
    writeFileSync(join(dir, 'escudo.png'), png);
    const salida = join(dir, 'salida');
    const filas = [
      fila('2026-09-19 10:00:00', 'EMEVÉ COLEXIO SAN LORENZO IF', 'DOMPAVOLEI IF1', '206572578', DOMPA),
      fila('2026-09-26 11:30:00', 'DOMPAVOLEI IF1', 'CV OLEIROS IFA', DOMPA, '206572590'),
    ];
    const arbol = JSON.stringify([{ id: '387', competiciones: [{ id: '1511', nombre: 'TORNEO APERTURA INFANTIL F', torneos: [{ id: '4064' }, { id: '3818' }] }] }]);
    const responder = (url, datos) => {
      if (datos.accion === 'obtener_partidos') return JSON.stringify({ data: filas });
      const u = new URL(url);
      const id = u.searchParams.get('id');
      if (u.pathname.endsWith('/competicion.php')) return '<script>token = "8c513fc98f8c16511d3876664456eef6";</script>';
      if (u.pathname.endsWith('/tree')) return arbol;
      if (u.pathname.endsWith('/competicion_completa.php')) return paginaDatos(`grupo-${id}.html`);
      if (u.pathname.endsWith('/clasificacion.php')) return paginaDatos(`clasificacion-${id}.html`);
      throw new Error(`no previsto: ${url}`);
    };
    const [, consola] = await enSilencio(() => conFetch(responder,
      () => principal(['--config', dir, '--salida', salida, '--nombre-base', 'cal'], new Date('2026-09-25T10:00:00Z'))));
    const ics = readFileSync(join(salida, 'cal.ics'), 'utf8').replace(/\r\n /g, '');
    assert.match(ics, /\r\nSUMMARY:✅ DOMPAVOLEI IF1 3-0 EMEVÉ COLEXIO SAN LORENZO IF\r\n/);
    assert.match(readFileSync(join(salida, 'cal.html'), 'utf8'), /"clas":\[\{"eq":"DOMPAVOLEI IF1","comp":"TORNEO APERTURA INFANTIL F","g":"SEGUNDA FASE - GRUPO 1"/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'resultados.json'), 'utf8')).temporada, 2026);
    assert.ok(consola.includes('  1 resultado(s) y 1 clasificación(es).'), consola.join('\n'));

    // La página nueva, junto a la de siempre: los mismos datos más el escudo.
    assert.deepEqual(readdirSync(salida).sort(), ['cal.html', 'cal.ics', 'cal.xlsx', 'equipos', 'salidas.html']);
    const { escudo, ...datosNueva } = datosDePagina(join(salida, 'salidas.html'));
    assert.equal(escudo, `data:image/png;base64,${png.toString('base64')}`);
    assert.deepEqual(datosNueva, datosDePagina(join(salida, 'cal.html')));
    assert.ok(consola.some((l) => /^ {4}salidas\.html +<- /.test(l)), consola.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
