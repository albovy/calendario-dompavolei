// Pruebas de src/main.js (opciones, temporada, clubs y el programa entero) sin red: la federación simulada (fetch),
// el reloj simulado (las pausas entre peticiones no se esperan de verdad) y carpetas temporales. Son las pruebas de
// pruebas.ps1 (secciones 1, 3, 4 y 8) sobre el .ps1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

const TEXTOS = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests', 503: 'Service Unavailable' };

// Sustituye fetch mientras dura f: responde con responder(url, parámetros del formulario), que da un texto (200) o un
// código HTTP (un número). Cada petición se apunta en «pedidas» ({ url, opciones }).
async function conFetch(responder, f, pedidas = []) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opciones = {}) => {
    pedidas.push({ url: new URL(String(url)), opciones });
    const datos = opciones.body ? Object.fromEntries(new URLSearchParams(String(opciones.body))) : {};
    const r = responder(String(url), datos);
    if (typeof r === 'number') return new Response('', { status: r, statusText: TEXTOS[r] });
    return new Response(r, { status: 200 });
  };
  try {
    return await f();
  } finally {
    globalThis.fetch = original;
  }
}

// Ejecuta f con el reloj simulado y lo adelanta hasta que termina: las pausas de 1,5 s entre peticiones a la
// federación, las esperas de los reintentos y la de antes de OSRM no se esperan de verdad.
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

// Reglas de red: a la federación, solo GET a competicion_completa.php y clasificacion.php (y listado_clubs.php, solo
// con --listar-clubs), con el User-Agent del programa y ninguna otra cabecera; nunca nada bajo /json/, ni equipo.php,
// ni actas, ni previos.
function comprobarReglas(pedidas, listar) {
  const paginas = ['/competicion_completa.php', '/clasificacion.php', ...(listar ? ['/listado_clubs.php'] : [])];
  for (const { url, opciones } of pedidas) {
    if (url.origin === 'https://router.project-osrm.org') continue;
    assert.equal(url.origin, 'https://resultadosvoleibol.isquad.es', url.href);
    assert.ok(paginas.includes(url.pathname), url.href);
    assert.ok(!/json|equipo|acta|previo/i.test(url.href), url.href);
    assert.equal(opciones.method, 'GET', url.href);
    assert.equal(opciones.body, undefined, url.href);
    assert.deepEqual(Object.keys(opciones.headers), ['User-Agent'], url.href);
  }
}

// Ejecuta el programa entero (principal) con la federación simulada y el reloj simulado, sin escribir en la consola.
// Devuelve { error (null si todo fue bien), consola, pedidas }. Comprueba siempre las reglas de red.
async function ejecutar(t, responder, args, ahora) {
  const pedidas = [];
  let error = null;
  const [, consola] = await enSilencio(async () => {
    try {
      await sinEsperas(t, () => conFetch(responder, () => principal(args, ahora), pedidas));
    } catch (e) {
      error = e;
    }
  });
  comprobarReglas(pedidas, args.includes('--listar-clubs'));
  return { error, consola, pedidas };
}

// Como ejecutar, pero un error del programa hace fallar la prueba.
async function generar(t, responder, args, ahora) {
  const r = await ejecutar(t, responder, args, ahora);
  if (r.error) throw r.error;
  return r;
}

function fila(fecha, local, visitante, idL, idV) {
  return {
    id_club_local: idL, id_club_visitante: idV, nombre_local: local, nombre_visitante: visitante,
    nombre_competicion: 'TORNEO APERTURA INFANTIL F', campo: 'ANEXO OS REMEDIOS - PISTA 1', categoria: 'INFANTIL',
    fecha, fecha_confirmada: '1', fecha_calendario: fecha.slice(0, 10),
  };
}

const DOMPA = '206572580';
// El grupo de config.json de las pruebas (federacion.grupos).
const GRUPO = { equipo: 'DOMPAVOLEI IF1', grupo: '1001', competicion: '1511' };

// Carpeta temporal con config.json (con el grupo de las pruebas si no trae otros); devuelve su ruta.
function carpetaConConfig(config = { clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }] }) {
  const dir = mkdtempSync(join(tmpdir(), 'calendario-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ federacion: { grupos: [GRUPO] }, ...config }));
  return dir;
}

// Página de un grupo de la federación (competicion_completa.php) con estas filas (como las de la agenda: fila()), con
// el formato de noviembre de 2026 y lo justo para leerla: el club de cada equipo (por el escudo), día y hora («0:00»,
// sin hora), pabellón con su sitio, estado y, si la fila los trae, marcador y sets (estado, marcador, sets).
function paginaGrupo(filas, competicion = 'TORNEO APERTURA INFANTIL F') {
  const escudo = (lado, club) => `<a href='#' class="escudo-${lado}-wrap">`
    + `${club ? `<img src='https://voleibol.isquad.es/images/afiliacion_clubs/${club}/escudo.jpg'>` : ''}</a>`;
  const tanteo = (par) => (par ? `<div class="custom-col"><span>${par[0]}</span>-<span>${par[1]}</span></div>` : '');
  const partido = (f, i) => {
    const [, a, m, d, hh, mm] = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(f.fecha);
    const hora = hh === '00' && mm === '00' ? '0:00' : `${hh}:${mm}`;
    const sitio = `[&quot;https://www.google.com/maps/?q=42.8805,-8.5457&amp;output=embed&quot;,&quot;${f.campo.replace(/<br>/g, ' ')}`
      + '&quot;,&quot;RúA DO PINO, 3, 15701 SANTIAGO DE COMPOSTELA, A CORUñA, ESPAñA, 15701&quot;]';
    const lugar = f.campo ? `<a href='#' onclick='mostrarLugar(...${sitio}); return false;'><span>${f.campo}</span></a>` : '';
    const estado = f.estado ?? 'Pendiente';
    return `<tr class="partido" data-id="${90000 + i}" data-estado="${estado}"><td><div class="equipos-col">`
      + `<div class="escudos-partido">${escudo('local', f.id_club_local)}${escudo('visitante', f.id_club_visitante)}</div>`
      + `<div class="nombres-equipos"><a href='#'>${f.nombre_local}</a> - <a href='#'>${f.nombre_visitante}</a></div></div></td>`
      + `<td class="col-marcador">${tanteo(f.marcador ?? [0, 0])}</td>`
      + [0, 1, 2, 3, 4].map((k) => `<td>${tanteo(f.sets?.[k])}</td>`).join('')
      + `<td><div class='negrita'>${d}/${m}/${a} </div><div>${hora}</div></td><td class="col-lugar">${lugar}</td>`
      + `<td><span class='custom-col'><i-t page='common'>${estado}</i-t></span></td><td></td><td></td></tr>`;
  };
  return `<html><body><h2>RESULTADOS DE LA COMPETICIÓN</h2><h4>${competicion}</h4>`
    + `<table><tbody>\n${filas.map(partido).join('\n')}\n</tbody></table></body></html>`;
}

const SIN_CLASIFICACION = "<h2 style='text-align: center;'>Clasificación NO DISPONIBLE PARA ESTA COMPETICIÓN</h2>";

// La federación de las pruebas: la página del grupo de config.json con estas filas, y sin clasificación. Cualquier otra
// petición es un error de la prueba.
function soloPartidos(filas, competicion) {
  return (url) => {
    const { pathname } = new URL(url);
    if (pathname === '/competicion_completa.php') return paginaGrupo(filas, competicion);
    if (pathname === '/clasificacion.php') return SIN_CLASIFICACION;
    throw new Error(`no previsto: ${url}`);
  };
}

// La federación de las pruebas con una página por grupo (id=): mapa grupo -> filas; sin clasificación y con un listado
// de clubs mínimo.
function porGrupo(mapa) {
  return (url) => {
    const u = new URL(url);
    if (u.pathname === '/competicion_completa.php') return paginaGrupo(mapa[u.searchParams.get('id')] ?? []);
    if (u.pathname === '/clasificacion.php') return SIN_CLASIFICACION;
    if (u.pathname === '/listado_clubs.php') return `<img src='https://x/afiliacion_clubs/${DOMPA}/a.jpg' alt='CV SAN MARTIÑO'>`;
    throw new Error(`no previsto: ${url}`);
  };
}

// La federación diciendo que no (403...) a todo.
function rechazo(codigo) { return () => codigo; }

function eventos(ruta) { return readFileSync(ruta, 'utf8').split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length; }

// Lo que hay en una carpeta (archivos y su contenido), para ver que no cambia nada.
function contenido(dir) {
  const r = {};
  for (const f of readdirSync(dir, { recursive: true })) {
    const ruta = join(dir, f);
    try {
      r[f] = readFileSync(ruta, 'utf8');
    } catch {
      r[f] = '(carpeta)';
    }
  }
  return r;
}

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

test('clubs: config.json, --club por ID o por nombre (entre los clubs de los grupos de config.json), y nombres ambiguos', () => {
  const cfg = { clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI', nombre_corto: ' Dompa ' }, { id: '', nombre: 'sin id' }, { id: 123 }] };
  // nombre_corto (opcional): «DOMPA INFANTIL» en la página.
  assert.deepEqual(resolverClubs('', [], cfg), [{ id: DOMPA, nombre: 'DOMPAVOLEI', corto: 'Dompa' }, { id: '123', nombre: 'Club 123' }]);
  assert.throws(() => resolverClubs('', [], null), /No hay ningún club configurado en config.json/);

  // Los partidos de los grupos de config.json (sin el listado oficial de clubs: --club no lo descarga).
  const filas = [
    fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'CV SAN SADURNIÑO', DOMPA, '206572600'),
    fila('2026-10-04 11:00:00', 'DOMPAVOLEI CF1', 'SAN MARTIÑO CF', DOMPA, '206572601'),
  ];
  const clubs = (texto) => resolverClubs(texto, filas, cfg);
  assert.deepEqual(clubs('dompa').map((c) => [c.id, c.nombre]), [[DOMPA, 'DOMPAVOLEI']]);
  assert.deepEqual(clubs('206572601; dompavolei if1').map((c) => [c.id, c.nombre]),
    [[DOMPA, 'DOMPAVOLEI'], ['206572601', 'SAN MARTIÑO CF']]);
  assert.deepEqual(clubs('99999').map((c) => [c.id, c.nombre]), [['99999', 'Club 99999']]);
  // En el orden del catálogo (por nombre).
  assert.throws(() => clubs('san'), {
    message: 'Hay varios clubs que coinciden con «san»; indica el ID:\n    206572600  CV SAN SADURNIÑO\n    206572601  SAN MARTIÑO CF',
  });
  assert.throws(() => clubs('inexistente'), /^Error: Ningún club ni equipo de los grupos de config\.json coincide con «inexistente»/);
});

test('config.json: los nombres no distinguen mayúsculas, como en ConvertFrom-Json', async () => {
  const dir = carpetaConConfig({
    Clubs: [{ ID: DOMPA, Nombre: 'DOMPAVOLEI', NOMBRE_CORTO: 'Dompa' }],
    SALIDAS: {
      Origen: 'Os Remedios', Latitud: 42.3442759, LONGITUD: -7.8713948,
      Tiempos_Viaje_Minutos: { 'Pazo dos Deportes': 40, Malo: 'mucho' },
    },
    Pedir_Bus: { Para: 'bus@x.es' },
  });
  try {
    const cfg = leerConfig(join(dir, 'config.json'));
    assert.deepEqual(resolverClubs('', [], cfg), [{ id: DOMPA, nombre: 'DOMPAVOLEI', corto: 'Dompa' }]);
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
  const ejecutarPrograma = (args) => spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: entorno });
  for (const programa of ['src/main.js', 'src/main', './src/main.js']) {
    const r = ejecutarPrograma([programa, '--duracion-minutos', '999']);
    assert.equal(r.status, 1, programa);
    assert.deepEqual(r.stdout.split(/\r?\n/),
      ['', '  ERROR: --duracion-minutos tiene que ser un número entero de 0 a 600 (no «999»).', '']);
    assert.equal(r.stderr, '', programa);
  }
  const importado = ejecutarPrograma(['-e', "import('./src/main.js').then(() => console.log('importado'))", 'x']);
  assert.deepEqual([importado.status, importado.stdout.trim(), importado.stderr], [0, 'importado', '']);
});

test('noviembre, el club sin partidos: error y no se publica la temporada anterior', async (t) => {
  const dir = carpetaConConfig();
  try {
    // La temporada anterior está guardada, pero ya no se publica en su lugar.
    writeFileSync(join(dir, 'temporada-anterior.json'), JSON.stringify({
      temporada: '2025/26', anio: 2025, clubs: [DOMPA], partidos: [fila('2025-10-04 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1')],
    }));
    const salida = join(dir, 'salida');
    const historial = join(dir, 'historial', 'partidos.txt');
    // En el grupo de config.json solo juegan otros clubs.
    const r = await ejecutar(t, soloPartidos([fila('2026-11-14 11:00:00', 'OTRO', 'RIVAL', '2', '1')]),
      ['--config', dir, '--salida', salida, '--historial', historial], new Date('2026-11-15T10:00:00Z'));
    assert.equal(r.error.message, 'DOMPAVOLEI no tiene ningún partido de la temporada 2026/27 en los grupos de config.json '
      + '(federacion.grupos). Revisa que estén los de esta temporada: hay que apuntarlos al empezar cada una (ver README). '
      + 'No se publica nada.');
    assert.equal(existsSync(salida), false);
    assert.equal(existsSync(historial), false);
    assert.ok(r.consola.includes('  ! En el grupo 1001 (DOMPAVOLEI IF1) de config.json no hay ningún partido del club: revisa '
      + 'federacion.grupos en config.json.'), r.consola.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('al empezar la temporada (antes de octubre) puede no haber nada publicado del club todavía', async (t) => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const { consola } = await generar(t, soloPartidos([fila('2026-09-26 11:00:00', 'OTRO', 'RIVAL', '2', '1')]),
      ['--config', join(dir, 'config.json'), '--salida', salida], new Date('2026-09-10T10:00:00Z'));
    assert.equal(existsSync(salida), true);
    assert.ok(consola.includes('  ! Todavía no hay partidos publicados de este club para la temporada 2026/27.'), consola.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--temporada, --desde o --hasta de otra temporada: error claro, sin descargar nada; dentro de la temporada en curso, valen', async (t) => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const ahora = new Date('2026-11-06T18:00:00Z');
    const nada = () => { throw new Error('no debería descargar nada'); };
    for (const [opcion, valor, temporada] of [['--temporada', '2025-26', '2025/26'], ['--desde', '2026-03-01', '2025/26'], ['--hasta', '2027-08-15', '2027/28']]) {
      const r = await ejecutar(t, nada, ['--config', dir, '--salida', salida, opcion, valor], ahora);
      assert.equal(r.error?.message, `La temporada ${temporada} no se puede generar: la federación ya no deja descargar su agenda `
        + 'y los partidos salen de las páginas de los grupos de la temporada en curso (2026/27). --temporada, --desde y --hasta '
        + 'solo valen dentro de ella.', opcion);
      assert.deepEqual(r.pedidas, [], opcion);
    }
    assert.equal(existsSync(salida), false);
    assert.deepEqual(readdirSync(dir), ['config.json']);
    // Dentro de la temporada en curso, sí.
    const filas = [fila('2026-11-07 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'), fila('2026-11-21 11:00:00', 'RIVAL', 'DOMPAVOLEI IF1', '1', DOMPA)];
    await generar(t, soloPartidos(filas), ['--config', dir, '--salida', salida, '--temporada', '2026-27', '--hasta', '2026-11-14',
      '--nombre-base', 'cal'], ahora);
    assert.equal(eventos(join(salida, 'cal.ics')), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la federación da 403 y la copia es reciente: se publica con aviso, sin reintentos', async (t) => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const args = ['--config', dir, '--salida', salida, '--nombre-base', 'cal'];
    const filas = [fila('2026-11-08 11:30:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'), fila('2026-11-15 12:00:00', 'RIVAL', 'DOMPAVOLEI IF1', '1', DOMPA)];
    await generar(t, soloPartidos(filas), args, new Date('2026-11-05T19:00:00Z'));
    const guardado = readFileSync(join(dir, 'resultados.json'), 'utf8');
    rmSync(salida, { recursive: true, force: true });
    // 23 horas después la federación dice que no: lo guardado vale todavía.
    const r = await generar(t, rechazo(403), args, new Date('2026-11-06T18:00:00Z'));
    assert.equal(r.pedidas.length, 1);
    assert.ok(r.consola.includes('  ! No se pudo actualizar el grupo 1001 (DOMPAVOLEI IF1) desde la federación (respuesta 403 '
      + 'Forbidden). Hasta la próxima ejecución se usa lo guardado, de hace menos de 48 horas.'), r.consola.join('\n'));
    assert.equal(eventos(join(salida, 'cal.ics')), 2);
    assert.equal(readFileSync(join(dir, 'resultados.json'), 'utf8'), guardado);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la federación da 403 y la copia es vieja: error y no se escribe nada', async (t) => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const historial = join(dir, 'historial', 'partidos.txt');
    const args = ['--config', dir, '--salida', salida, '--historial', historial];
    const filas = [fila('2026-11-08 11:30:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1')];
    await generar(t, soloPartidos(filas), args, new Date('2026-11-01T10:00:00Z'));
    rmSync(salida, { recursive: true, force: true });
    rmSync(join(dir, 'historial'), { recursive: true, force: true });
    const antes = contenido(dir);
    const r = await ejecutar(t, rechazo(403), args, new Date('2026-11-06T18:00:00Z'));
    assert.equal(r.error.message, 'No se pudo actualizar el grupo 1001 (DOMPAVOLEI IF1) desde la federación (respuesta 403 '
      + 'Forbidden).\n    No hay una copia de menos de 48 horas de: el grupo 1001 (DOMPAVOLEI IF1). No se ha cambiado ningún archivo.');
    assert.equal(r.pedidas.length, 1);
    assert.deepEqual(contenido(dir), antes);
    assert.equal(existsSync(salida), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('temporada anterior: de temporada-anterior.json si es suya; si no, de lo que tenía resultados.json, que se guarda; nunca se descarga', async () => {
  const dir = carpetaConConfig();
  try {
    const ruta = join(dir, 'temporada-anterior.json');
    const rango = nuevoRango(2026);
    const ids = new Set([DOMPA]);
    // Las filas de la temporada 2025/26 que tenía resultados.json (actualizarFederacion, al cambiar de temporada).
    const anterior = [
      { ...fila('2025-10-04 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'), id_partido: '97117' },
      fila('2025-10-04 11:00:00', 'OTRO', 'RIVAL', '2', '1'),        // de otro club: no se guarda
      fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'), // de la temporada en curso: no se guarda
    ];
    const nada = () => { throw new Error('no debería descargar nada'); };
    const [primera, avisos] = await enSilencio(() => conFetch(nada, () => temporadaAnterior({ rango, ids, ruta, guardar: true, anterior })));
    assert.deepEqual(primera, [fila('2025-10-04 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1')]);
    assert.deepEqual(avisos, ['  Se guardan los partidos de la temporada 2025/26 en temporada-anterior.json.']);
    const copia = JSON.parse(readFileSync(ruta, 'utf8'));
    assert.deepEqual([copia.temporada, copia.anio, copia.clubs, copia.partidos], ['2025/26', 2025, [DOMPA], primera]);

    // Luego, de la copia.
    const [segunda] = await enSilencio(() => conFetch(nada, () => temporadaAnterior({ rango, ids, ruta, guardar: true, anterior: [] })));
    assert.deepEqual(segunda, primera);

    // Otro club: la copia no vale; sin filas guardadas, aviso y se sigue sin ella (y no se toca la copia).
    const guardada = readFileSync(ruta, 'utf8');
    const [otro, aviso] = await enSilencio(() => conFetch(nada, () => temporadaAnterior({ rango, ids: new Set(['1']), ruta, guardar: true })));
    assert.deepEqual(otro, []);
    assert.deepEqual(aviso, ['  ! No hay partidos guardados del club de la temporada 2025/26 (temporada-anterior.json): se sigue sin ella.']);
    // Con guardar false (otro club con --club), no se escribe.
    const [suyas] = await enSilencio(() => temporadaAnterior({ rango, ids: new Set(['2']), ruta, guardar: false, anterior }));
    assert.deepEqual(suyas.map((p) => p.nombre_local), ['OTRO']);
    assert.equal(readFileSync(ruta, 'utf8'), guardada);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('en agosto: al cambiar de temporada se guarda la anterior y, sin partidos aún en la nueva, se genera esa', async (t) => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const filas = [
      fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'),
      fila('2027-03-06 12:00:00', 'RIVAL', 'DOMPAVOLEI IF1', '1', DOMPA),
      fila('2026-10-03 11:00:00', 'OTRO', 'RIVAL', '2', '1'),
    ];
    // La última ejecución de julio deja resultados.json con la temporada 2026/27.
    await generar(t, soloPartidos(filas), ['--config', dir, '--salida', salida], new Date('2027-07-20T08:00:00Z'));
    rmSync(salida, { recursive: true, force: true });
    // En agosto, temporada nueva (los grupos de config.json aún son los de la anterior).
    const ahora = new Date('2027-08-20T08:00:00Z');   // 10:00 en Galicia
    const historial = join(dir, 'historial', 'partidos.txt');
    const { consola } = await generar(t, soloPartidos(filas), ['--config', dir, '--salida', salida, '--historial', historial], ahora);
    assert.deepEqual(readdirSync(salida).sort(), [
      'calendario-dompavolei-2026-27.html', 'calendario-dompavolei-2026-27.ics', 'calendario-dompavolei-2026-27.xlsx', 'equipos',
    ]);
    assert.equal(eventos(join(salida, 'calendario-dompavolei-2026-27.ics')), 2);
    assert.equal(eventos(join(salida, 'equipos', 'dompavolei-if1.ics')), 2);
    assert.ok(consola.includes('  ! Todavía no hay partidos de DOMPAVOLEI publicados para la temporada 2027/28.'));
    assert.ok(consola.includes('  Mientras tanto se genera el calendario de la temporada 2026/27.'));
    assert.ok(consola.includes('  2 partidos (0 por jugar) de 1 equipos.'));
    assert.equal(readFileSync(historial, 'utf8').split('\n')[0], '# Partidos de DOMPAVOLEI, temporada 2026/27 (Federación Galega de Voleibol)');
    // La temporada 2026/27 queda guardada en temporada-anterior.json (solo los partidos del club) y resultados.json
    // empieza la 2027/28.
    const copia = JSON.parse(readFileSync(join(dir, 'temporada-anterior.json'), 'utf8'));
    assert.deepEqual([copia.anio, copia.clubs, copia.partidos.map((p) => p.fecha)], [2026, [DOMPA], ['2026-10-03 11:00:00', '2027-03-06 12:00:00']]);
    assert.equal(JSON.parse(readFileSync(join(dir, 'resultados.json'), 'utf8')).temporada, 2027);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rango parcial: nombre propio, sin calendarios por equipo; horas de salida con la caché', async (t) => {
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
    const { consola, pedidas } = await generar(t, soloPartidos(filas),
      ['--config', join(dir, 'config.json'), '--salida', salida, '--desde', '2026-09-26', '--hasta', '2026-09-27'], ahora);
    const base = 'calendario-dompavolei-2026-27-20260926-20260927';
    assert.deepEqual(readdirSync(salida).sort(), [`${base}.html`, `${base}.ics`, `${base}.xlsx`]);
    assert.equal(eventos(join(salida, `${base}.ics`)), 2);
    assert.ok(consola.includes('  Calculando horas de salida desde Os Remedios...'));
    assert.ok(consola.some((l) => /^ {2}sáb 26\/09 +11:30 +en casa +Infantil F +DOMPAVOLEI IF1 - RIVAL$/.test(l)), consola.join('\n'));
    assert.ok(pedidas.every((p) => p.url.origin !== 'https://router.project-osrm.org'));
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

test('resultados: el .ics y la página llevan el marcador y la clasificación, de la misma descarga; se guarda resultados.json', async (t) => {
  // El grupo del XF1 en la liga (página real del 06/11/2026, recortada) y una clasificación de noviembre.
  const dir = carpetaConConfig({
    clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }],
    federacion: { grupos: [{ equipo: 'DOMPAVOLEI XF1', grupo: '3941', competicion: '1537' }] },
  });
  try {
    // El escudo del club, junto a config.json: la página lo lleva dentro.
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
    writeFileSync(join(dir, 'escudo.png'), png);
    const salida = join(dir, 'salida');
    const responder = (url) => {
      const u = new URL(url);
      const id = u.searchParams.get('id');
      if (u.pathname === '/competicion_completa.php' && id === '3941') return paginaDatos('grupo-3941-2026-11.html');
      if (u.pathname === '/clasificacion.php' && id === '3941') return paginaDatos('clasificacion-3857-2026-11.html');
      throw new Error(`no previsto: ${url}`);
    };
    const { consola, pedidas } = await generar(t, responder, ['--config', dir, '--salida', salida, '--nombre-base', 'cal'],
      new Date('2026-11-06T19:00:00Z'));
    // Una página del grupo y su clasificación: nada más (los resultados salen de la misma página).
    assert.deepEqual(pedidas.map((p) => `${p.url.pathname} ${p.url.searchParams.get('id')}`), ['/competicion_completa.php 3941', '/clasificacion.php 3941']);
    const ics = readFileSync(join(salida, 'cal.ics'), 'utf8').replace(/\r\n /g, '');
    assert.match(ics, /\r\nSUMMARY:❌ DOMPAVOLEI XF1 0-3 CLUB VIGO VOLEIBOL\r\n/);
    assert.match(ics, /\r\nSUMMARY:❌ DOMPAVOLEI XF1 0-3 BREIJO ARQUITECTURA E INGENIERIA XIRIA VOLEI\r\n/);
    assert.match(readFileSync(join(salida, 'cal.html'), 'utf8'), /"clas":\[\{"eq":"DOMPAVOLEI XF1","comp":"2ªDIV\. XUVENIL FEMENINA","g":"PRIMERA FASE - LIGA REGULAR"/);
    const cache = JSON.parse(readFileSync(join(dir, 'resultados.json'), 'utf8'));
    assert.deepEqual([cache.temporada, Object.keys(cache.grupos), cache.grupos['3941'].partidos.length], [2026, ['3941'], 5]);
    assert.ok(consola.includes('  5 partidos del club en 1 grupo de la federación (temporada 2026/27).'), consola.join('\n'));
    assert.ok(consola.includes('  2 resultado(s) y 1 clasificación(es).'), consola.join('\n'));

    // Una sola página, con el escudo dentro.
    assert.deepEqual(readdirSync(salida).sort(), ['cal.html', 'cal.ics', 'cal.xlsx', 'equipos']);
    assert.equal(datosDePagina(join(salida, 'cal.html')).escudo, `data:image/png;base64,${png.toString('base64')}`);
    assert.ok(consola.some((l) => /^ {4}cal\.html +<- /.test(l)), consola.join('\n'));
    assert.ok(!consola.some((l) => l.includes('-salidas')), consola.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--listar-clubs: los clubs de los grupos de config.json y el listado oficial, con un aviso', async (t) => {
  const dir = carpetaConConfig();
  try {
    const filas = [
      fila('2026-11-07 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL IF', DOMPA, '206572600'),
      fila('2026-11-08 11:00:00', 'RIVAL IF', 'DOMPAVOLEI CF1', '206572600', DOMPA),
      fila('2026-11-14 11:00:00', 'RIVAL IF', 'OTRO IF', '206572600', '206572601'),
    ];
    const listado = `<img src='https://x/afiliacion_clubs/${DOMPA}/a.jpg' alt='CV SAN MARTIÑO'>`
      + "<img src='https://x/afiliacion_clubs/206572699/b.jpg' alt='CLUB LEJANO'>";
    const responder = (url) => (new URL(url).pathname === '/listado_clubs.php' ? listado : soloPartidos(filas)(url));
    const { consola, pedidas } = await generar(t, responder, ['--config', dir, '--listar-clubs'], new Date('2026-11-06T18:00:00Z'));
    assert.deepEqual(pedidas.map((p) => p.url.pathname), ['/competicion_completa.php', '/clasificacion.php', '/listado_clubs.php']);
    const club = (id) => consola.find((l) => l.includes(` ${id} `)) ?? '';
    // El club, con el nombre de sus equipos y el oficial; los rivales, con sus partidos contra él.
    assert.match(club(DOMPA), /DOMPAVOLEI +2 +206572580 +CV SAN MARTIÑO/);
    assert.match(club('206572600'), /RIVAL IF +2 +206572600/);
    assert.match(club('206572699'), /CLUB LEJANO +- +206572699/);
    assert.equal(club('206572601'), '');   // no juega con el club: no se sabe de él
    assert.ok(consola.some((l) => l.startsWith('  ! Solo salen los partidos y los equipos de los grupos de config.json')), consola.join('\n'));
    assert.equal(existsSync(join(dir, 'calendario')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--club por nombre: se busca entre los clubs de los grupos de config.json; para otro club, sin tocar las copias del de config.json', async (t) => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const filas = [fila('2026-11-07 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL IF', DOMPA, '206572600'), fila('2026-11-14 11:00:00', 'RIVAL IF', 'OTRO IF', '206572600', '206572601')];
    const { pedidas } = await generar(t, soloPartidos(filas), ['--config', dir, '--salida', salida, '--club', 'rival', '--sin-equipos'],
      new Date('2026-11-06T18:00:00Z'));
    // Primero el grupo con el club de config.json (para buscar el nombre); luego, con el club elegido.
    assert.deepEqual(pedidas.map((p) => p.url.pathname), ['/competicion_completa.php', '/clasificacion.php', '/competicion_completa.php', '/clasificacion.php']);
    assert.deepEqual(readdirSync(salida).sort(), ['calendario-rival-if-2026-27.html', 'calendario-rival-if-2026-27.ics', 'calendario-rival-if-2026-27.xlsx']);
    assert.equal(eventos(join(salida, 'calendario-rival-if-2026-27.ics')), 2);
    // Las copias son del club de config.json: ni la búsqueda ni el otro club las tocan (las pone al día la ejecución normal).
    assert.deepEqual(readdirSync(dir).sort(), ['config.json', 'salida']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('si la federación falla (con copia reciente), --listar-clubs y --club por nombre no le piden nada más', async (t) => {
  const dir = carpetaConConfig();
  try {
    const filas = [fila('2026-11-07 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL IF', DOMPA, '206572600')];
    await generar(t, soloPartidos(filas), ['--config', dir, '--salida', join(dir, 'salida')], new Date('2026-11-06T17:00:00Z'));
    for (const codigo of [403, 429]) {
      // Sin listado oficial: los clubs de la copia, con un aviso.
      const listar = await ejecutar(t, rechazo(codigo), ['--config', dir, '--listar-clubs'], new Date('2026-11-06T18:00:00Z'));
      assert.equal(listar.error, null);
      assert.deepEqual(listar.pedidas.map((p) => p.url.pathname), ['/competicion_completa.php']);
      assert.ok(listar.consola.includes('  ! No se descarga el listado oficial de clubs: la federación ha fallado en esta ejecución.'),
        listar.consola.join('\n'));
      assert.match(listar.consola.find((l) => l.includes(` ${DOMPA} `)) ?? '', /DOMPAVOLEI IF1 +1 +206572580/);
      // Otro club: no se vuelve a pedir la misma página (sería reintentar tras un «no»).
      const otro = await ejecutar(t, rechazo(codigo), ['--config', dir, '--club', 'rival', '--salida', join(dir, 'otra')],
        new Date('2026-11-06T18:00:00Z'));
      assert.deepEqual(otro.pedidas.map((p) => p.url.pathname), ['/competicion_completa.php']);
      assert.equal(otro.error?.message, `No se puede generar el calendario de RIVAL IF: la federación ha fallado en esta ejecución `
        + `(respuesta ${codigo} ${TEXTOS[codigo]}) y de otro club no hay copia. Vuelve a intentarlo más tarde. No se ha cambiado ningún archivo.`);
      assert.equal(existsSync(join(dir, 'otra')), false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cambio de temporada: --listar-clubs o --club por nombre antes de la primera ejecución normal no pierden la temporada anterior', async (t) => {
  for (const opciones of [['--listar-clubs'], ['--club', 'otro', '--sin-equipos']]) {
    const dir = carpetaConConfig({ clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }], federacion: { grupos: [GRUPO] } });
    try {
      const salida = join(dir, 'salida');
      const federacion = porGrupo({
        1001: [fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'), fila('2027-03-06 12:00:00', 'RIVAL', 'DOMPAVOLEI CF1', '1', DOMPA)],
        2001: [fila('2027-09-25 11:00:00', 'DOMPAVOLEI IF1', 'OTRO', DOMPA, '2')],
      });
      // Julio: resultados.json de la temporada 2026/27. En agosto se apuntan los grupos de la nueva.
      await generar(t, federacion, ['--config', dir, '--salida', salida], new Date('2027-07-20T08:00:00Z'));
      rmSync(salida, { recursive: true, force: true });
      writeFileSync(join(dir, 'config.json'), JSON.stringify({
        clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }], federacion: { grupos: [{ equipo: 'DOMPAVOLEI IF1', grupo: '2001', competicion: '1611' }] },
      }));
      const julio = readFileSync(join(dir, 'resultados.json'), 'utf8');
      const r = await ejecutar(t, federacion, ['--config', dir, ...opciones, '--salida', join(dir, 'otra')], new Date('2027-08-20T07:00:00Z'));
      assert.equal(r.error, null, opciones[0]);
      assert.equal(readFileSync(join(dir, 'resultados.json'), 'utf8'), julio, opciones[0]);
      // La primera ejecución normal guarda la temporada anterior: el CF1, que aún no juega, sigue con su calendario.
      await generar(t, federacion, ['--config', dir, '--salida', salida], new Date('2027-08-20T08:00:00Z'));
      assert.equal(JSON.parse(readFileSync(join(dir, 'temporada-anterior.json'), 'utf8')).anio, 2026, opciones[0]);
      assert.deepEqual(readdirSync(join(salida, 'equipos')).sort(), ['dompavolei-cf1.ics', 'dompavolei-if1.ics'], opciones[0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('en agosto, con los grupos de la temporada pasada aún en config.json, sus partidos no salen dos veces', async (t) => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const args = ['--config', dir, '--salida', salida, '--nombre-base', 'cal'];
    const vieja = [fila('2026-10-03 11:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'), fila('2027-03-06 12:00:00', 'RIVAL', 'DOMPAVOLEI IF1', '1', DOMPA)];
    await generar(t, soloPartidos(vieja), args, new Date('2027-07-20T08:00:00Z'));
    assert.equal(eventos(join(salida, 'cal.ics')), 2);
    // En agosto la federación ha cambiado el nombre del rival (un patrocinador nuevo): los partidos de la temporada
    // pasada salen de temporada-anterior.json, no también de la página del grupo viejo.
    const renombrada = vieja.map((f) => ({ ...f, nombre_local: f.nombre_local.replace(/^RIVAL$/, 'RIVAL VOLEIBOL'),
      nombre_visitante: f.nombre_visitante.replace(/^RIVAL$/, 'RIVAL VOLEIBOL') }));
    const { consola } = await generar(t, soloPartidos(renombrada), args, new Date('2027-08-20T08:00:00Z'));
    assert.ok(consola.includes('  Mientras tanto se genera el calendario de la temporada 2026/27.'), consola.join('\n'));
    assert.equal(eventos(join(salida, 'cal.ics')), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Ejecuta el programa entero con el reloj simulado también en Date: apunta a qué hora (simulada) llega cada petición a
// la federación. Devuelve [[ruta, ms], ...].
async function horasDePeticiones(t, responder, args, ahora) {
  const horas = [];
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.origin === 'https://resultadosvoleibol.isquad.es') horas.push([u.pathname, Date.now()]);
    return new Response(responder(String(url)), { status: 200 });
  };
  try {
    await enSilencio(async () => {
      let terminado = false;
      const promesa = principal(args, ahora);
      promesa.then(() => { terminado = true; }, () => { terminado = true; });
      while (!terminado) {
        await new Promise((seguir) => { setImmediate(seguir); });
        t.mock.timers.tick(100);
      }
      await promesa;
    });
    return horas;
  } finally {
    globalThis.fetch = original;
    t.mock.timers.reset();
  }
}

test('--club por nombre y --listar-clubs: al menos 1,5 s entre dos peticiones seguidas a la federación', async (t) => {
  for (const opciones of [['--club', 'otro', '--sin-equipos'], ['--listar-clubs']]) {
    const dir = carpetaConConfig();
    try {
      const horas = await horasDePeticiones(t, porGrupo({ 1001: [fila('2026-11-07 11:00:00', 'DOMPAVOLEI IF1', 'OTRO', DOMPA, '2')] }),
        ['--config', dir, '--salida', join(dir, 's'), ...opciones], new Date('2026-11-06T08:00:00Z'));
      assert.ok(horas.length >= 3, JSON.stringify(horas));
      for (let i = 1; i < horas.length; i++) assert.ok(horas[i][1] - horas[i - 1][1] >= 1500, `${opciones[0]}: ${JSON.stringify(horas)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('un pabellón nuevo sale con las coordenadas y la dirección de la página de su grupo (una consulta a OSRM)', async (t) => {
  const dir = carpetaConConfig({
    clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }], salidas: { origen: 'Os Remedios', latitud: 42.3442759, longitud: -7.8713948 },
  });
  try {
    const partido = { ...fila('2026-11-14 11:00:00', 'OTRO', 'DOMPAVOLEI IF1', '2', DOMPA), campo: 'PAZO NUEVO - PISTA 1' };
    const responder = (url) => {
      if (url.startsWith('https://router.project-osrm.org/')) return JSON.stringify({ code: 'Ok', routes: [{ distance: 120000, duration: 5400 }] });
      return soloPartidos([partido])(url);
    };
    const { pedidas } = await generar(t, responder, ['--config', dir, '--salida', join(dir, 's')], new Date('2026-11-06T08:00:00Z'));
    const osrm = pedidas.filter((p) => p.url.origin === 'https://router.project-osrm.org');
    assert.equal(osrm.length, 1);
    assert.match(osrm[0].url.pathname, /;-8\.5457,42\.8805$/);
    const guardado = JSON.parse(readFileSync(join(dir, 'pabellones.json'), 'utf8'))['PAZO NUEVO - PISTA 1'];
    assert.deepEqual([guardado.lat, guardado.lon, guardado.municipio, guardado.direccion, guardado.fuente],
      [42.8805, -8.5457, 'SANTIAGO DE COMPOSTELA', 'RÚA DO PINO, 3, 15701 SANTIAGO DE COMPOSTELA, A CORUÑA', 'osrm']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ¿Es la página del diseño nuevo, sin el selector de diseño ni nada del anterior?
function esDisenoNuevo(ruta) {
  const html = readFileSync(ruta, 'utf8');
  return html.includes('<header class="barra">') && !html.includes('<header class="cabecera">') && !html.includes('selector-diseno');
}

test('una sola página por temporada, con el diseño nuevo, su nombre y sus partidos', async (t) => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const filas = [
      fila('2025-10-04 11:30:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1'),
      fila('2026-10-03 12:00:00', 'RIVAL', 'DOMPAVOLEI CF1', '1', DOMPA),
    ];
    const generarCon = (filasGrupo, ahora, ...args) => generar(t, soloPartidos(filasGrupo),
      ['--config', dir, '--salida', salida, '--sin-equipos', ...args], ahora);
    // Con --nombre-base, la página se llama así (y nada más: ni «-salidas» ni otra página).
    const { consola } = await generarCon(filas, new Date('2026-09-24T10:00:00Z'), '--temporada', '2026-27', '--nombre-base', 'salidas');
    assert.deepEqual(readdirSync(salida).sort(), ['salidas.html', 'salidas.ics', 'salidas.xlsx']);
    assert.ok(esDisenoNuevo(join(salida, 'salidas.html')));
    assert.ok(consola.some((l) => /^ {4}salidas\.html +<- /.test(l)), consola.join('\n'));
    assert.ok(!consola.some((l) => l.includes('-salidas')), consola.join('\n'));
    // Dos temporadas en la misma carpeta (en agosto, sin partidos aún en la nueva, se genera la anterior, la que guardó
    // resultados.json en julio): cada una, su página con sus partidos.
    rmSync(salida, { recursive: true, force: true });
    rmSync(join(dir, 'resultados.json'));
    await generarCon(filas.slice(0, 1), new Date('2026-07-20T10:00:00Z'));
    await generarCon(filas.slice(0, 1), new Date('2026-08-20T10:00:00Z'));
    await generarCon(filas, new Date('2026-09-24T10:00:00Z'));
    const bases = ['calendario-dompavolei-2025-26', 'calendario-dompavolei-2026-27'];
    assert.deepEqual(readdirSync(salida).filter((f) => f.endsWith('.html')).sort(), bases.map((b) => `${b}.html`));
    for (const base of bases) {
      assert.ok(esDisenoNuevo(join(salida, `${base}.html`)), base);
      const d = datosDePagina(join(salida, `${base}.html`));
      assert.equal(d.escudo, '');   // no hay escudo.png junto a este config.json
      assert.equal(d.ics, `${base}.ics`);
    }
    assert.deepEqual(datosDePagina(join(salida, `${bases[0]}.html`)).partidos.map((p) => p.f), ['2025-10-04']);
    assert.deepEqual(datosDePagina(join(salida, `${bases[1]}.html`)).partidos.map((p) => p.f), ['2026-10-03']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('el nombre corto de la página: el de config.json; si no hay, el del club; con varios clubs, ninguno', async (t) => {
  const filas = [fila('2026-10-03 12:00:00', 'RIVAL', 'DOMPAVOLEI CF1', '1', DOMPA)];
  const corto = async (config) => {
    const dir = carpetaConConfig(config);
    try {
      const salida = join(dir, 'salida');
      await generar(t, soloPartidos(filas),
        ['--config', dir, '--salida', salida, '--sin-equipos', '--nombre-base', 'cal', '--temporada', '2026-27'], new Date('2026-09-24T10:00:00Z'));
      return datosDePagina(join(salida, 'cal.html')).corto;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  assert.equal(await corto({ clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI', nombre_corto: 'Dompa' }] }), 'Dompa');
  assert.equal(await corto({ clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }] }), 'DOMPAVOLEI');
  assert.equal(await corto({ clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI', nombre_corto: 'Dompa' }, { id: '1', nombre: 'RIVAL' }] }), '');
});

test('app instalable: con iconos junto a config.json, manifiesto, iconos y sw.js junto a la página', async (t) => {
  const filas = [fila('2026-10-03 12:00:00', 'RIVAL', 'DOMPAVOLEI CF1', '1', DOMPA)];
  const png = (n) => Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, n]);
  const generarCon = async (config, iconos) => {
    const dir = carpetaConConfig(config);
    if (iconos) {
      mkdirSync(join(dir, 'iconos'));
      iconos.forEach((f, i) => writeFileSync(join(dir, 'iconos', f), png(i)));
    }
    const salida = join(dir, 'salida');
    const { consola } = await generar(t, soloPartidos(filas),
      ['--config', dir, '--salida', salida, '--sin-equipos', '--nombre-base', 'cal', '--temporada', '2026-27'], new Date('2026-09-24T10:00:00Z'));
    return { dir, salida, consola };
  };
  const TODOS = ['192.png', '512.png', 'maskable-192.png', 'maskable-512.png', 'apple-touch-icon.png'];
  const cfg = { clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI', nombre_corto: 'Dompa' }], calendario_publicado: 'https://albovy.github.io/calendario-dompavolei/calendario.ics' };
  let g = await generarCon(cfg, TODOS);
  try {
    assert.deepEqual(readdirSync(g.salida).sort(), ['cal.html', 'cal.ics', 'cal.xlsx', 'iconos', 'manifest.webmanifest', 'sw.js']);
    assert.deepEqual(readdirSync(join(g.salida, 'iconos')).sort(), [...TODOS].sort());
    TODOS.forEach((f, i) => assert.deepEqual(readFileSync(join(g.salida, 'iconos', f)), png(i), f));
    // sw.js: el de src/, byte a byte (si cambiara en cada publicación, se instalaría uno nuevo cada hora).
    assert.deepEqual(readFileSync(join(g.salida, 'sw.js')), readFileSync(join(REPO, 'src', 'sw.js')));
    const m = JSON.parse(readFileSync(join(g.salida, 'manifest.webmanifest'), 'utf8'));
    assert.deepEqual(m, {
      id: '/calendario-dompavolei/', name: 'Calendario Dompavolei', short_name: 'Dompavolei',
      description: 'Partidos, salidas, resultados y clasificaciones de DOMPAVOLEI.',
      lang: 'es', dir: 'ltr', start_url: './', scope: './', display: 'standalone',
      background_color: '#FFFFFF', theme_color: '#FFFFFF',
      icons: [
        { src: 'iconos/192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'iconos/512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: 'iconos/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
        { src: 'iconos/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    });
    const html = readFileSync(join(g.salida, 'cal.html'), 'utf8');
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
    assert.match(html, /<meta name="apple-mobile-web-app-title" content="Dompavolei">/);
    assert.equal(datosDePagina(join(g.salida, 'cal.html')).app, true);
    assert.ok(g.consola.some((l) => /^ {4}manifest\.webmanifest, sw\.js, iconos. +<- /.test(l)), g.consola.join('\n'));
  } finally {
    rmSync(g.dir, { recursive: true, force: true });
  }
  // Solo con los iconos imprescindibles (192 y 512), sin dirección publicada: sin id y sin el icono de iPhone.
  g = await generarCon({ clubs: [{ id: DOMPA, nombre: 'CV SAN MARTIÑO DE LUGO' }] }, ['192.png', '512.png']);
  try {
    const m = JSON.parse(readFileSync(join(g.salida, 'manifest.webmanifest'), 'utf8'));
    assert.equal(m.id, undefined);
    assert.equal(m.short_name, 'Calendario');   // ni el nombre ni el corto caben en 12 letras
    assert.equal(m.name, 'Calendario Cv San Martiño De Lugo');
    assert.deepEqual(m.icons.map((i) => i.src), ['iconos/192.png', 'iconos/512.png']);
    assert.ok(!readFileSync(join(g.salida, 'cal.html'), 'utf8').includes('apple-touch-icon'));
  } finally {
    rmSync(g.dir, { recursive: true, force: true });
  }
  // Sin iconos (o sin alguno de los dos imprescindibles): ni manifiesto ni service worker.
  for (const iconos of [null, ['192.png']]) {
    g = await generarCon(cfg, iconos);
    try {
      assert.deepEqual(readdirSync(g.salida).filter((f) => !f.startsWith('cal.')), [], String(iconos));
      assert.equal(datosDePagina(join(g.salida, 'cal.html')).app, false);
      assert.ok(!readFileSync(join(g.salida, 'cal.html'), 'utf8').includes('rel="manifest"'));
    } finally {
      rmSync(g.dir, { recursive: true, force: true });
    }
  }
});

test('demo (config.json): dos partidos de prueba solo en la página; ni en el .ics, ni en el Excel, ni en el historial', async (t) => {
  const filas = [fila('2026-10-03 12:00:00', 'RIVAL', 'DOMPAVOLEI CF1', '1', DOMPA), fila('2026-10-04 11:00:00', 'DOMPAVOLEI IF1', 'OTRO', DOMPA, '2')];
  const generarCon = async (config) => {
    const dir = carpetaConConfig(config);
    const salida = join(dir, 'salida');
    const historial = join(dir, 'historial.txt');
    const { consola } = await generar(t, soloPartidos(filas),
      ['--config', dir, '--salida', salida, '--nombre-base', 'cal', '--temporada', '2026-27', '--historial', historial], new Date('2026-09-27T10:00:00Z'));
    return { dir, salida, historial, consola };
  };
  const g = await generarCon({ clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }], demo: true });
  try {
    const d = datosDePagina(join(g.salida, 'cal.html'));
    const demo = d.partidos.filter((p) => p.dm);
    assert.equal(d.partidos.length, 4);
    assert.deepEqual(demo.map((p) => [p.f, p.h, p.cond, p.l, p.v, p.comp]), [
      ['2026-09-28', '12:00', 'visitante', 'EQUIPO DE PRUEBA', 'DOMPAVOLEI CF1', 'PARTIDO DE PRUEBA'],
      ['2026-09-28', '18:00', 'local', 'DOMPAVOLEI IF1', 'EQUIPO DE PRUEBA', 'PARTIDO DE PRUEBA'],
    ]);
    // Nada de prueba en lo que se suscribe, se descarga o se guarda.
    assert.equal(eventos(join(g.salida, 'cal.ics')), 2);
    for (const f of readdirSync(join(g.salida, 'equipos'))) assert.doesNotMatch(readFileSync(join(g.salida, 'equipos', f), 'utf8'), /PRUEBA/, f);
    assert.doesNotMatch(readFileSync(join(g.salida, 'cal.ics'), 'utf8'), /PRUEBA/);
    assert.doesNotMatch(readFileSync(g.historial, 'utf8'), /PRUEBA/);
    assert.ok(g.consola.some((l) => /2 partidos de prueba en la página \(solo se ven con «\?demo» en la dirección\)/.test(l)), g.consola.join('\n'));
  } finally {
    rmSync(g.dir, { recursive: true, force: true });
  }
  // Sin «demo» (o con false), ninguno.
  for (const demo of [undefined, false]) {
    const h = await generarCon({ clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }], ...(demo === undefined ? {} : { demo }) });
    try {
      assert.equal(datosDePagina(join(h.salida, 'cal.html')).partidos.filter((p) => p.dm).length, 0);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  }
});

test('horas a mano (salidas-manuales.json): salida de fuera y calentamiento en casa, a la página, al .ics, a WhatsApp y al 2.º partido; si la federación movió el partido, aviso', async (t) => {
  const config = {
    clubs: [{ id: DOMPA, nombre: 'DOMPAVOLEI' }],
    salidas: { origen: 'Os Remedios', latitud: 42.3442759, longitud: -7.8713948, velocidad_bus_kmh: 100, redondeo_salida_minutos: 30 },
    edicion: { repo: 'albovy/calendario-dompavolei' },
  };
  const dir = carpetaConConfig(config);
  try {
    const origen = '42.3442759,-7.8713948';
    writeFileSync(join(dir, 'pabellones.json'), JSON.stringify({
      'PAVILLON DE LUGO': { id_campo: '2', municipio: 'LUGO', direccion: 'X', lat: 43.01, lon: -7.55, km: 100, minutos_coche: 70, fuente: 'osrm', origen, fecha: '2026-09-24' },
      'ANEXO OS REMEDIOS - PISTA 1': { id_campo: '1', municipio: 'OURENSE', direccion: 'X', lat: 42.3438638, lon: -7.8701618, km: 0.7, minutos_coche: 1, fuente: 'osrm', origen, fecha: '2026-09-24' },
    }));
    // Dos partidos del mismo equipo el mismo día en Lugo (el 2.º va con el bus del 1.º) y uno en casa.
    const enLugo = (fecha, local) => ({ ...fila(fecha, local, 'DOMPAVOLEI CF1', '1', DOMPA), campo: 'PAVILLON DE LUGO' });
    const enCasa = fila('2026-10-04 12:00:00', 'DOMPAVOLEI IF1', 'RIVAL', DOMPA, '1');
    const generarCon = async (filas) => {
      const salida = join(dir, 'salida');
      const { consola } = await generar(t, soloPartidos(filas),
        ['--config', dir, '--salida', salida, '--nombre-base', 'cal', '--temporada', '2026-27'], new Date('2026-10-01T10:00:00Z'));
      const ics = readFileSync(join(salida, 'cal.ics'), 'utf8').replace(/\r\n /g, '');
      return { d: datosDePagina(join(salida, 'cal.html')), ics, consola };
    };
    const filas = [enLugo('2026-10-03 11:30:00', 'RIVAL'), enLugo('2026-10-03 13:00:00', 'OTRO'), enCasa];
    const resumen = (d) => d.partidos.map((p) => [p.s, p.ca, p.sp, p.sm]);

    // Sin cambios, lo calculado: 11:30 − 1 h de calentamiento − 1 h de bus = 09:30; el calentamiento, al llegar
    // (09:30 + 1 h). En casa, 1 h antes. Cada partido lleva su id (los 8 primeros caracteres del UID) y la
    // página, a dónde mandar los cambios.
    let g = await generarCon(filas);
    const [id, , idCasa] = g.d.partidos.map((p) => p.id);
    assert.match(id, /^[0-9a-f]{8}$/);
    assert.equal(new Set(g.d.partidos.map((p) => p.id)).size, 3);
    assert.deepEqual(resumen(g.d), [['09:30', '10:30', '', undefined], ['', '', '09:30', undefined], ['', '11:00', '', undefined]]);
    assert.deepEqual(g.d.edicion, { repo: 'albovy/calendario-dompavolei', workflow: 'salida.yml', rama: 'main' });
    // Con el modo entrenador, el botón «Instagram»: arte.js junto a la página (sin patrocinador todavía).
    assert.deepEqual(g.d.insta.pat, []);
    assert.match(g.d.insta.v, /^[0-9a-f]{8}$/);   // la versión de arte.js
    assert.ok(existsSync(join(dir, 'salida', 'arte.js')));
    assert.ok(g.consola.some((l) => /^ {4}arte\.js +<- artes para Instagram/.test(l)), g.consola.join('\n'));

    // Con las horas a mano (las que guarda salida.yml): la salida de Lugo, 45 min antes (se llega antes: más
    // calentamiento), y el calentamiento en casa, a las 10:30.
    writeFileSync(join(dir, 'salidas-manuales.json'), JSON.stringify({
      [id]: { partido: '2026-10-03 11:30', tipo: 'salida', hora: '08:45', texto: 'RIVAL vs DOMPAVOLEI CF1', cambiado: '2026-10-01T09:00:00.000Z' },
      [idCasa]: { partido: '2026-10-04 12:00', tipo: 'calentamiento', hora: '10:30', texto: 'DOMPAVOLEI IF1 vs RIVAL', cambiado: '2026-10-01T09:00:00.000Z' },
    }));
    g = await generarCon(filas);
    assert.deepEqual(resumen(g.d), [['08:45', '09:45', '', 1], ['', '', '08:45', undefined], ['', '10:30', '', 1]]);
    assert.match(g.ics, /Salida 08:45 desde Os Remedios · bus 1 h\\nCalentamiento 09:45 · partido 11:30/);
    assert.match(g.ics, /En casa · calentamiento 10:30 · partido 12:00/);
    assert.match(g.ics, /DTSTART;TZID=Europe\/Madrid:20261004T103000/);
    assert.match(g.d.partidos[0].wa, /Salida: 08:45\* desde Os Remedios/);
    assert.match(g.d.partidos[0].wa, /Calentamiento: 09:45/);
    assert.ok(g.consola.includes('  2 horas puestas a mano (salidas-manuales.json).'), g.consola.join('\n'));

    // La federación cambia la hora del de Lugo: vuelve la calculada, con aviso.
    g = await generarCon([enLugo('2026-10-03 12:00:00', 'RIVAL'), enLugo('2026-10-03 13:30:00', 'OTRO'), enCasa]);
    assert.equal(g.d.partidos[0].id, id);   // el mismo partido
    assert.deepEqual([g.d.partidos[0].s, g.d.partidos[0].sm], ['10:00', undefined]);
    assert.ok(g.consola.some((l) => l.startsWith('  ! Hora puesta a mano que ya no vale')
      && l.includes('RIVAL vs DOMPAVOLEI CF1: era el 2026-10-03 11:30 y ahora es el 2026-10-03 12:00')), g.consola.join('\n'));
    assert.ok(g.consola.includes('  1 hora puesta a mano (salidas-manuales.json).'), g.consola.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // Sin «edicion» en config.json, la página no la ofrece.
  const otra = carpetaConConfig();
  try {
    const salida = join(otra, 'salida');
    await generar(t, soloPartidos([fila('2026-10-03 12:00:00', 'RIVAL', 'DOMPAVOLEI CF1', '1', DOMPA)]),
      ['--config', otra, '--salida', salida, '--nombre-base', 'cal', '--temporada', '2026-27'], new Date('2026-10-01T10:00:00Z'));
    assert.equal(datosDePagina(join(salida, 'cal.html')).edicion, null);
    assert.equal(datosDePagina(join(salida, 'cal.html')).insta, null);
    assert.equal(existsSync(join(salida, 'arte.js')), false);
  } finally {
    rmSync(otra, { recursive: true, force: true });
  }
});

// Lo que ejecuta bash en el bloque «run: |» de un paso del workflow: sus líneas sin la sangría común, como
// las deja YAML.
function pasoRun(workflow, nombre) {
  const lineas = workflow.split('\n');
  const i = lineas.findIndex((l) => l.trim() === `- name: ${nombre}`);
  const j = lineas.findIndex((l, k) => k > i && /^\s+run: \|$/.test(l));
  assert.ok(i >= 0 && j > i, `falta el paso «${nombre}» con run: |`);
  const sangriaRun = lineas[j].search(/\S/);
  const cuerpo = [];
  for (let k = j + 1; k < lineas.length && (!lineas[k].trim() || lineas[k].search(/\S/) > sangriaRun); k++) cuerpo.push(lineas[k]);
  const sangria = Math.min(...cuerpo.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return cuerpo.map((l) => l.slice(sangria)).join('\n').trimEnd();
}

test('la web publica la página como index.html (y calendario.html); salidas.html, donde se probó el diseño, lleva a ella', () => {
  // El workflow genera con --nombre-base calendario: la página sale como calendario.html y se copia a index.html.
  const workflow = readFileSync(join(REPO, '.github', 'workflows', 'calendario.yml'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(workflow, /node src\/main\.js --salida web --nombre-base calendario /);
  assert.doesNotMatch(workflow, /calendario-salidas/);
  const lineas = pasoRun(workflow, 'Página de inicio').split('\n');
  assert.equal(lineas[0], 'cp web/calendario.html web/index.html');
  // salidas.html: una página mínima que lleva a la de inicio (el terminador del heredoc, en la columna 0).
  assert.equal(lineas[1], "cat > web/salidas.html <<'FIN'");
  assert.equal(lineas.at(-1), 'FIN');
  const redireccion = lineas.slice(2, -1).join('\n');
  assert.match(redireccion, /^<!DOCTYPE html>\n<html lang="es">/);
  assert.match(redireccion, /<meta http-equiv="refresh" content="0; url=\.\/">/);
  assert.match(redireccion, /<script>location\.replace\('\.\/'\);<\/script>/);
  assert.match(redireccion, /<a href="\.\/">[^<]+<\/a>/);
  assert.match(redireccion, /<\/html>$/);
});

test('el workflow: lo lanzan cron-job.org, el botón y los cambios subidos; sin schedule ni relanzamientos; una ejecución atascada no bloquea las siguientes', () => {
  const workflow = readFileSync(join(REPO, '.github', 'workflows', 'calendario.yml'), 'utf8').replace(/\r\n/g, '\n');
  const disparos = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:'));
  // cron-job.org cada hora y el botón «Run workflow» (workflow_dispatch, sin entradas), y los cambios subidos.
  assert.match(disparos, /^[ \t]+workflow_dispatch:[^\n]*$/m);
  assert.doesNotMatch(disparos, /inputs:/);
  assert.match(disparos, /^[ \t]+push:\n[ \t]+branches: \[main\]/m);
  // Sin la programación de GitHub (llegaba con retraso y cron-job.org ya lo lanza) ni relanzamientos: si una
  // ejecución falla, ya lo hará la de la hora siguiente.
  assert.doesNotMatch(workflow, /^[ \t]+schedule:|cron:/m);
  assert.doesNotMatch(workflow, /gh workflow run|intento|actions: write|generar\.log/);
  assert.match(workflow, /- name: Generar calendario\n[ \t]+if: steps\.sonda\.outputs\.llega == 'true'\n[ \t]+run: node src\/main\.js --salida web --nombre-base calendario --historial historial\/partidos\.txt\n/);
  // Una ejecución que se queda atascada (el 26/09/2026, 10 horas esperando máquina) no bloquea las
  // siguientes: la nueva cancela a la que siga en marcha. Y ninguna pasa de 15 minutos.
  assert.match(workflow, /^concurrency:\n[ \t]+group: pages\n[ \t]+cancel-in-progress: true$/m);
  // En macOS: el servidor de la federación descarta las conexiones de parte de las máquinas Linux de GitHub
  // (Azure); las macOS salen por otras direcciones (diagnóstico del 28/09/2026: 5 de 5 llegaron).
  assert.match(workflow, /^[ \t]+publicar:\n[ \t]+runs-on: macos-latest\n[ \t]+timeout-minutes: 15\b/m);
});

test('el workflow: primero mira si la máquina llega a la federación (robots.txt, con el User-Agent del programa); si no, termina sin error y con un aviso', () => {
  const workflow = readFileSync(join(REPO, '.github', 'workflows', 'calendario.yml'), 'utf8').replace(/\r\n/g, '\n');
  const pasos = workflow.slice(workflow.indexOf('    steps:\n')).split(/\n(?=      - )/).slice(1);
  const nombre = (p) => (/- (?:name: |uses: |id: )([^\n]+)/.exec(p) || [])[1];
  const sonda = pasos.findIndex((p) => /id: sonda/.test(p));
  assert.ok(sonda >= 0 && sonda <= 1, 'la comprobación va al principio (tras el checkout)');
  const script = pasoRun(workflow, '¿Llega a la federación?');
  // Una página de 1 KB (robots.txt, un 404 de la propia web) y no la portada (874 KB), con el mismo User-Agent que
  // el programa (src/isquad.js) y nada más.
  const agente = /const AGENTE = '([^']+)';/.exec(readFileSync(join(REPO, 'src', 'isquad.js'), 'utf8'))[1];
  const curl = script.split('\n').find((l) => l.includes('curl '));
  assert.ok(curl.includes(` -A '${agente}' `), curl);
  assert.match(curl, /--connect-timeout 8 [^\n]*https:\/\/resultadosvoleibol\.isquad\.es\/robots\.txt\b/);
  assert.doesNotMatch(curl, / -H |--header|client-token|cookie/i);
  assert.match(script, /echo "llega=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(script, /echo "llega=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(script, /::warning::[^\n]*federación/);
  assert.doesNotMatch(script, /exit 1/);   // una máquina bloqueada no es un fallo nuestro
  // Todo lo demás, solo si llega (así una bloqueada no publica nada ni deja la web a medias).
  for (const p of pasos.slice(sonda + 1)) {
    assert.match(p, /\n[ \t]+if: steps\.sonda\.outputs\.llega == 'true'\n/, nombre(p));
  }
  // La prueba de red (temporal) ya no está.
  assert.equal(existsSync(join(REPO, '.github', 'workflows', 'diagnostico-red.yml')), false);
});

test('salida.yml: la página lo lanza con el partido, el tipo y la hora; guarda salidas-manuales.json y lanza la publicación', () => {
  const workflow = readFileSync(join(REPO, '.github', 'workflows', 'salida.yml'), 'utf8').replace(/\r\n/g, '\n');
  const disparos = workflow.slice(workflow.indexOf('\non:\n'), workflow.indexOf('\npermissions:'));
  // Solo workflow_dispatch (la página), con tres entradas: el partido (obligatorio), el tipo y la hora.
  assert.match(disparos, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}partido:\n(?: {8}[^\n]+\n)*? {8}required: true\n(?: {8}[^\n]+\n)*? {8}type: string\n/m);
  // El tipo: la salida del bus (fuera) o el calentamiento (en casa); GitHub solo admite esas dos.
  assert.match(disparos, /^ {6}tipo:\n(?: {8}[^\n]+\n)*? {8}required: true\n(?: {8}[^\n]+\n)*? {8}type: choice\n {8}options: \[salida, calentamiento\]\n/m);
  assert.match(disparos, /^ {6}hora:\n(?: {8}[^\n]+\n)*? {8}required: false\n(?: {8}[^\n]+\n)*? {8}type: string\n/m);
  assert.doesNotMatch(disparos, /push:|schedule:|pull_request/);
  // Guardar y lanzar la publicación; nada más.
  assert.match(workflow, /^permissions:\n {2}contents: write[^\n]*\n {2}actions: write[^\n]*\n\n/m);
  // Los cambios de un mismo partido, en fila y sin cancelar el que está en marcha: vale el último (si llega
  // otro mientras uno espera, ese que esperaba ya no hace falta). Los de partidos distintos no se esperan
  // (en calendario.yml, la nueva cancela a la que siga en marcha: un cambio así se perdería).
  assert.match(workflow, /^concurrency:\n {2}group: salida-\$\{\{ inputs\.partido \}\}\n {2}cancel-in-progress: false\n/m);
  // En Linux: no necesita llegar a la federación.
  assert.match(workflow, /^ {4}runs-on: ubuntu-latest\n {4}timeout-minutes: 5\n/m);
  // Las entradas, solo en variables de entorno: nunca ${{ ... }} dentro de un script (se podría colar código).
  assert.match(workflow, /- name: Guardar la hora\n {8}env:\n {10}PARTIDO: \$\{\{ inputs\.partido \}\}\n {10}TIPO: \$\{\{ inputs\.tipo \}\}\n {10}HORA: \$\{\{ inputs\.hora \}\}\n {10}RAMA: \$\{\{ github\.ref_name \}\}\n {8}run: \|\n/);
  for (const [, cuerpo] of workflow.matchAll(/\n( +)run: ([^\n]*(?:\n\1 +[^\n]*|\n\s*(?=\n))*)/g)) assert.doesNotMatch(cuerpo, /\$\{\{/, cuerpo);
  const guardar = pasoRun(workflow, 'Guardar la hora');
  // Cada intento empieza desde lo último guardado (si otro cambio se guardó a la vez, se rehace encima).
  // En la rama desde la que la lanzó la página (config.json › edicion › rama).
  assert.match(guardar, /for vez in 1 2 3 4 5; do\n {2}git fetch -q origin "\$RAMA"\n {2}git reset -q --hard "origin\/\$RAMA"\n {2}node src\/manuales\.js\n {2}git add salidas-manuales\.json\n/);
  assert.match(guardar, /if git push -q origin "HEAD:\$RAMA"; then\n {4}exit 0\n {2}fi/);
  assert.match(guardar, /::error::[^\n]*\nexit 1$/);
  assert.match(workflow, /- name: Publicar la web\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {10}RAMA: \$\{\{ github\.ref_name \}\}\n {8}run: gh workflow run calendario\.yml --ref "\$RAMA"\n$/);
});
