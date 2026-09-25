// Pruebas de src/html.js (página HTML) sin red: datos embebidos, escape de "<", título y plantilla.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codificarHtml, crearHtml, crearHtmlSalidas } from '../src/html.js';
import { fechaPared } from '../src/util.js';

// Sin CR, como las lee html.js (Git puede sacarlas con CRLF en Windows).
const PLANTILLA = readFileSync(new URL('../src/plantilla.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PLANTILLA_SALIDAS = readFileSync(new URL('../src/plantilla-salidas.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const INICIO_DATOS = '<script id="datos" type="application/json">';
const BARRA = String.fromCharCode(92);
const SEPARADOR_LINEA = String.fromCharCode(0x2028);

// JSON tal como va en la página: entre <script id="datos"> y el primer </script> que le sigue.
function jsonDe(html) {
  const ini = html.indexOf(INICIO_DATOS) + INICIO_DATOS.length;
  return html.slice(ini, html.indexOf('</script>', ini));
}
function datosDe(html) { return JSON.parse(jsonDe(html)); }
function veces(texto, trozo) { return texto.split(trozo).length - 1; }

function partido(campos = {}) {
  const fecha = campos.fecha ?? fechaPared(2026, 10, 3, 17, 30);
  return {
    fecha, temporada: 2026, estado: 'confirmada',
    local: 'DOMPAVOLEI IF1', visitante: 'CV RIVAL', esLocal: true, esVisitante: false, condicion: 'local',
    nuestros: ['DOMPAVOLEI IF1'], rival: 'CV RIVAL', competicion: 'LIGA INFANTIL F', categoria: 'Infantil F',
    claveCategoria: 'infantil', ordenCategoria: 2, pabellon: 'PM A PINGUELA', uid: 'abc@calendario-voley',
    inicio: fecha, salida: null, calentamiento: null, viajeMin: null, viajeFuente: '',
    enCasa: false, municipio: '', km: null, segundo: false, salidaPrimero: null,
    ...campos,
  };
}

function equipo(nombre, partidos, campos = {}) {
  return { nombre, categoria: 'Infantil F', claveCategoria: 'infantil', ordenCategoria: 2, partidos, ics: '', ...campos };
}

function opciones(campos = {}) {
  const partidos = campos.partidos ?? [partido()];
  return {
    partidos,
    equipos: [equipo('DOMPAVOLEI IF1', partidos)],
    nombreClub: 'DOMPAVOLEI',
    temporada: '2026/27',
    ics: 'calendario-dompavolei-2026-27.ics',
    xlsx: 'calendario-dompavolei-2026-27.xlsx',
    generado: { pared: fechaPared(2026, 9, 24, 9, 5), utc: new Date(Date.UTC(2026, 8, 24, 7, 5)) },
    urlPublicada: '',
    salidas: null,
    pabellones: null,
    pedirBus: null,
    duracion: 120,
    ...campos,
  };
}

const SALIDAS = {
  origen: 'Pabellón de Lalín', lat: 42.66, lon: -8.11, calentamiento: 90, factorBus: 1.1, margen: 0,
  redondeoViaje: 15, redondeo: 15, radioCasaKm: 1, manual: new Map(),
};

test('plantilla.html: la cabecera no lleva las rayas de la pista (la red y las líneas de ataque cruzaban el texto)', () => {
  assert.doesNotMatch(PLANTILLA, /\.pista::(before|after)/);
});

test('plantilla.html: un solo __TITULO__ y __DATOS__, y el código de la página sin errores de sintaxis', () => {
  assert.equal(veces(PLANTILLA, '__TITULO__'), 1);
  assert.equal(veces(PLANTILLA, '__DATOS__'), 1);
  const codigo = PLANTILLA.slice(PLANTILLA.lastIndexOf('<script>') + '<script>'.length, PLANTILLA.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(codigo));
});

test('crearHtml: mismos datos, claves y formatos que New-Html', () => {
  const p1 = partido({
    fecha: fechaPared(2026, 10, 3, 17, 30), local: 'CV VIGO', visitante: 'DOMPAVOLEI IF1',
    esLocal: false, esVisitante: true, condicion: 'visitante', pabellon: 'PAV. DAS TRAVESAS',
    salida: fechaPared(2026, 10, 3, 14, 45), calentamiento: fechaPared(2026, 10, 3, 16, 0),
    viajeMin: 75, municipio: 'Vigo', km: 90.4,
  });
  const p2 = partido({
    fecha: fechaPared(2026, 10, 3, 19, 0), local: 'DOMPAVOLEI IF1', visitante: 'CV TRAVESAS',
    esLocal: true, esVisitante: false, pabellon: 'PAV. DAS TRAVESAS', calentamiento: fechaPared(2026, 10, 3, 17, 30),
    viajeMin: 75, municipio: 'Vigo', segundo: true, salidaPrimero: p1,
  });
  const p3 = partido({ fecha: fechaPared(2026, 10, 10), estado: 'sinhora', pabellon: 'SIN DATOS' });
  const p4 = partido({
    fecha: fechaPared(2026, 10, 17), estado: 'pendiente', local: 'DOMPAVOLEI CF1', visitante: 'DOMPAVOLEI IF1',
    esVisitante: true, condicion: 'derbi', pabellon: '', competicion: 'COPA', categoria: 'Cadete F', claveCategoria: 'cadete',
  });
  const p5 = partido({
    fecha: fechaPared(2026, 10, 24, 12, 0), estado: 'provisional', calentamiento: fechaPared(2026, 10, 24, 10, 30),
    enCasa: true, municipio: 'Monforte de Lemos',
  });
  const partidos = [p1, p2, p3, p4, p5];
  const pabellones = {
    'PM A PINGUELA': { id_campo: '65', municipio: 'Monforte de Lemos', lat: 42.52, lon: -7.51, km: 60, minutos_coche: 50, fuente: 'osrm' },
    'PAV. DAS TRAVESAS': {
      id_campo: '30', municipio: 'Vigo', direccion: 'RÚA DAS TRAVESAS 1', lat: 42.22, lon: -8.73, km: 90.4, minutos_coche: 68, fuente: 'osrm',
    },
    'SIN DATOS': { fuente: 'sin-datos', origen: '42.66,-8.11', fecha: '2026-09-24' },
    'NO SE USA': { id_campo: '1', municipio: 'Lugo', direccion: 'X', lat: 43, lon: -7.5 },
  };
  const pedirBus = { para: 'bus@example.com', cc: '', plazas: '55', firma: 'Dompavolei', origen: SALIDAS.origen, dirOrigen: 'Rúa do Pabellón 1' };
  const equipos = [
    equipo('DOMPAVOLEI IF1', partidos, { ics: 'equipos/dompavolei-if1.ics' }),
    equipo('DOMPAVOLEI CF1', [p4], { categoria: 'Cadete F', claveCategoria: 'cadete', ics: 'equipos/dompavolei-cf1.ics' }),
    equipo('DOMPAVOLEI SM', [], { categoria: 'Senior M', claveCategoria: 'senior' }),
  ];
  const html = crearHtml(opciones({
    partidos, equipos, salidas: SALIDAS, pabellones, pedirBus, duracion: 105,
    urlPublicada: 'https://example.github.io/calendario/calendario-dompavolei-2026-27.ics',
  }));
  const d = datosDe(html);

  assert.deepEqual(Object.keys(d), ['club', 'corto', 'temporada', 'generado', 'ics', 'xlsx', 'pub', 'sal', 'bus', 'pabs', 'equipos', 'partidos', 'clas']);
  assert.equal(d.club, 'DOMPAVOLEI');
  // Nombre corto del club (config.json › nombre_corto) para «DOMPA INFANTIL» en la página nueva; sin él, ''.
  assert.equal(d.corto, '');
  assert.equal(datosDe(crearHtml(opciones({ nombreCorto: 'Dompa' }))).corto, 'Dompa');
  assert.equal(d.temporada, '2026/27');
  assert.equal(d.generado, '24/09/2026 09:05');
  assert.equal(d.ics, 'calendario-dompavolei-2026-27.ics');
  assert.equal(d.xlsx, 'calendario-dompavolei-2026-27.xlsx');
  assert.deepEqual(d.pub, { base: 'https://example.github.io/calendario/', ics: 'calendario-dompavolei-2026-27.ics' });
  assert.deepEqual(d.sal, { origen: 'Pabellón de Lalín', cal: 90 });
  assert.deepEqual(d.bus, { ...pedirBus, dur: 105 });
  assert.deepEqual(Object.keys(d.bus), ['para', 'cc', 'plazas', 'firma', 'origen', 'dirOrigen', 'dur']);
  // Solo los pabellones de los partidos con coordenadas, ordenados; sin dirección guardada, ''.
  assert.deepEqual(Object.keys(d.pabs), ['PAV. DAS TRAVESAS', 'PM A PINGUELA']);
  assert.deepEqual(d.pabs, {
    'PAV. DAS TRAVESAS': { dir: 'RÚA DAS TRAVESAS 1', mun: 'Vigo' },
    'PM A PINGUELA': { dir: '', mun: 'Monforte de Lemos' },
  });
  assert.deepEqual(d.equipos, [
    { n: 'DOMPAVOLEI IF1', cat: 'Infantil F', ck: 'infantil', ics: 'equipos/dompavolei-if1.ics', np: 5 },
    { n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: 'equipos/dompavolei-cf1.ics', np: 1 },
    { n: 'DOMPAVOLEI SM', cat: 'Senior M', ck: 'senior', ics: '', np: 0 },
  ]);
  assert.deepEqual(Object.keys(d.partidos[0]),
    ['f', 'h', 'e', 'cat', 'ck', 'comp', 'l', 'v', 'lo', 'vo', 'pab', 'cond', 's', 'ca', 'vj', 'casa', 'seg', 'sp', 'mun', 'r', 'wa']);
  const comun = { cat: 'Infantil F', ck: 'infantil', comp: 'LIGA INFANTIL F' };
  assert.deepEqual(d.partidos.map(({ wa, ...resto }) => resto), [
    { f: '2026-10-03', h: '17:30', e: 'c', ...comun, l: 'CV VIGO', v: 'DOMPAVOLEI IF1', lo: false, vo: true,
      pab: 'PAV. DAS TRAVESAS', cond: 'visitante', s: '14:45', ca: '16:00', vj: 75, casa: false, seg: false, sp: '', mun: 'Vigo', r: null },
    // 2º partido del día en el mismo pabellón: sin calentamiento ni viaje propios; la salida es la del primero.
    { f: '2026-10-03', h: '19:00', e: 'c', ...comun, l: 'DOMPAVOLEI IF1', v: 'CV TRAVESAS', lo: true, vo: false,
      pab: 'PAV. DAS TRAVESAS', cond: 'local', s: '', ca: '', vj: 0, casa: false, seg: true, sp: '14:45', mun: 'Vigo', r: null },
    { f: '2026-10-10', h: '', e: 'h', ...comun, l: 'DOMPAVOLEI IF1', v: 'CV RIVAL', lo: true, vo: false,
      pab: 'SIN DATOS', cond: 'local', s: '', ca: '', vj: 0, casa: false, seg: false, sp: '', mun: '', r: null },
    { f: '2026-10-17', h: '', e: 'x', cat: 'Cadete F', ck: 'cadete', comp: 'COPA', l: 'DOMPAVOLEI CF1', v: 'DOMPAVOLEI IF1',
      lo: true, vo: true, pab: '', cond: 'derbi', s: '', ca: '', vj: 0, casa: false, seg: false, sp: '', mun: '', r: null },
    { f: '2026-10-24', h: '12:00', e: 'p', ...comun, l: 'DOMPAVOLEI IF1', v: 'CV RIVAL', lo: true, vo: false,
      pab: 'PM A PINGUELA', cond: 'local', s: '', ca: '10:30', vj: 0, casa: true, seg: false, sp: '', mun: 'Monforte de Lemos', r: null },
  ]);
  // Mensaje de WhatsApp: p1 abre el día 3/10 (p2 va en su mensaje); p4 tiene la fecha sin confirmar.
  assert.deepEqual(d.partidos.map((x) => Boolean(x.wa)), [true, false, true, false, true]);
  assert.deepEqual(d.clas, []);

  // Fuera de __TITULO__ y __DATOS__, la página es la plantilla sin tocar.
  const [antes, resto] = PLANTILLA.split('__TITULO__');
  const [medio, despues] = resto.split('__DATOS__');
  const titulo = 'Partidos &#183; DOMPAVOLEI &#183; 2026/27';
  assert.equal(html, antes + titulo + medio + jsonDe(html) + despues);
  // Sin espacios: como ConvertTo-Json -Compress.
  assert.ok(jsonDe(html).startsWith('{"club":"DOMPAVOLEI","corto":"","temporada":"2026/27","generado":"24/09/2026 09:05",'));
});

test('crearHtml: sin salidas, sin pabellones y sin dirección publicada', () => {
  const d = datosDe(crearHtml(opciones({ equipos: [], partidos: [] })));
  assert.equal(d.pub, null);
  assert.equal(d.sal, null);
  assert.equal(d.bus, null);
  assert.deepEqual(d.pabs, {});
  assert.deepEqual(d.equipos, []);
  assert.deepEqual(d.partidos, []);
});

test('crearHtml: los valores que faltan salen como null, sin perder la propiedad', () => {
  const p = partido({ estado: 'rara', categoria: undefined, municipio: undefined });
  const d = datosDe(crearHtml(opciones({ partidos: [p] })));
  assert.equal(Object.keys(d.partidos[0]).length, 21);
  assert.equal(d.partidos[0].e, null);
  assert.equal(d.partidos[0].cat, null);
  assert.equal(d.partidos[0].mun, '');
  assert.equal(d.partidos[0].h, '');
});

test('crearHtml: un pabellón con otras mayúsculas que en la caché también tiene dirección (@{} en el .ps1)', () => {
  const pabellones = { 'PM A PINGUELA': { municipio: 'Monforte de Lemos', direccion: 'RÚA SOBER, 6', lat: 42.52, lon: -7.51 } };
  const d = datosDe(crearHtml(opciones({ partidos: [partido({ pabellon: 'PM A Pinguela' })], pabellones })));
  // Con el nombre que trae el partido, como el .ps1.
  assert.deepEqual(d.pabs, { 'PM A Pinguela': { dir: 'RÚA SOBER, 6', mun: 'Monforte de Lemos' } });
});

test('crearHtml: generado puede ser { pared, utc } o el Date de pared', () => {
  const d = datosDe(crearHtml(opciones({ generado: fechaPared(2027, 1, 2, 23, 59) })));
  assert.equal(d.generado, '02/01/2027 23:59');
});

test('crearHtml: dirección publicada como -match de PowerShell', () => {
  const pub = (url) => datosDe(crearHtml(opciones({ urlPublicada: url }))).pub;
  assert.deepEqual(pub('HTTP://example.org/a/b/CAL.ICS'), { base: 'HTTP://example.org/a/b/', ics: 'CAL.ICS' });
  assert.deepEqual(pub('https://example.org/a b/cal.ics\n'), { base: 'https://example.org/a b/', ics: 'cal.ics' });
  assert.equal(pub('https://example.org/cal.ics?v=1'), null);
  assert.equal(pub('https://example.org/cal.ics\n\n'), null);
  assert.equal(pub('https://example.org/'), null);
  assert.equal(pub('https://cal.ics'), null);
  assert.equal(pub('ftp://example.org/cal.ics'), null);
  assert.equal(pub(undefined), null);
});

test('crearHtml: nombres con </script>, <!--, comillas, &, $ y emojis', () => {
  const raros = [
    '</script><script>alert(1)</script>',
    '<!-- <script> -->',
    'Comillas "dobles" y \'simples\' & &amp; &lt; >',
    'Vóley 🏐 ñandú €',
    "Dólar $& $' $` $$ $1",
    `Barra ${BARRA} invertida, tab\ty separador${SEPARADOR_LINEA}de línea`,
  ];
  for (const raro of raros) {
    const p = partido({ local: raro, visitante: raro, competicion: raro, categoria: raro, pabellon: raro, municipio: raro });
    const html = crearHtml(opciones({
      partidos: [p], equipos: [equipo(raro, [p])], nombreClub: raro, salidas: { ...SALIDAS, origen: raro },
      pabellones: { [raro]: { municipio: raro, direccion: raro, lat: 42, lon: -8 } },
      pedirBus: { para: raro, cc: '', plazas: '', firma: raro, origen: raro, dirOrigen: raro },
    }));
    const json = jsonDe(html);
    assert.ok(!json.includes('<'), `queda un "<" en los datos con ${raro}`);
    assert.equal(veces(html, '</script>'), veces(PLANTILLA, '</script>'));
    assert.equal(veces(html, '<!--'), veces(PLANTILLA, '<!--'));
    const d = JSON.parse(json);
    for (const valor of [d.club, d.sal.origen, d.bus.para, d.bus.firma, d.bus.dirOrigen, d.equipos[0].n,
      d.pabs[raro].dir, d.pabs[raro].mun]) {
      assert.equal(valor, raro);
    }
    for (const k of ['cat', 'comp', 'l', 'v', 'pab', 'mun']) assert.equal(d.partidos[0][k], raro);
    assert.ok(html.includes(`<title>${codificarHtml(`Partidos · ${raro} · 2026/27`)}</title>`));
  }
});

test('crearHtml: "<" y los separadores de línea van escapados como en ConvertTo-Json', () => {
  const json = jsonDe(crearHtml(opciones({ nombreClub: `a<b${SEPARADOR_LINEA}c` })));
  assert.ok(json.includes(`"club":"a${BARRA}u003cb${BARRA}u2028c"`));
});

test('codificarHtml como WebUtility.HtmlEncode de .NET', () => {
  assert.equal(codificarHtml('Partidos · DOMPAVOLEI · 2026/27'), 'Partidos &#183; DOMPAVOLEI &#183; 2026/27');
  assert.equal(codificarHtml('<a href="x">\'&</a>'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;');
  assert.equal(codificarHtml('Ñandú €'), '&#209;and&#250; €');
  // Del 160 al 255 van como entidad; justo fuera de ese tramo, no.
  const limites = String.fromCharCode(0x9F, 0xA0, 0xFF, 0x100);
  assert.equal(codificarHtml(limites), `${String.fromCharCode(0x9F)}&#160;&#255;${String.fromCharCode(0x100)}`);
  assert.equal(codificarHtml('Vóley 🏐'), 'V&#243;ley &#127952;');
  // Un sustituto suelto pasa a U+FFFD.
  const suelto = String.fromCharCode(0xD83C);
  assert.equal(codificarHtml(`${suelto}x`), `${String.fromCharCode(0xFFFD)}x`);
  assert.equal(codificarHtml(null), '');
});

test('crearHtml: resultados de los partidos y clasificaciones', () => {
  const p = partido({ resultado: { marcador: [3, 1], sets: [[25, 20], [20, 25], [25, 18], [25, 22]] } });
  const clas = [{
    equipo: 'DOMPAVOLEI IF1', competicion: 'TORNEO APERTURA INFANTIL F', grupo: 'PRIMERA FASE - GRUPO H',
    url: 'https://resultadosvoleibol.isquad.es/clasificacion.php?id=4064', actualizado: fechaPared(2026, 9, 26, 0, 30),
    filas: [{ pos: 1, equipo: 'DOMPAVOLEI IF1', club: '206572580', pt: 6, pj: 2, pg: 2, pp: 0, sf: 6, sc: 0, nuestro: true }],
  }];
  const d = datosDe(crearHtml(opciones({ partidos: [p, partido()], clasificaciones: clas })));
  assert.deepEqual(d.partidos.map((x) => x.r), [{ m: [3, 1], s: [[25, 20], [20, 25], [25, 18], [25, 22]] }, null]);
  assert.deepEqual(d.clas, [{
    eq: 'DOMPAVOLEI IF1', comp: 'TORNEO APERTURA INFANTIL F', g: 'PRIMERA FASE - GRUPO H',
    url: 'https://resultadosvoleibol.isquad.es/clasificacion.php?id=4064', act: '26/09 00:30',
    filas: [{ p: 1, n: 'DOMPAVOLEI IF1', pt: 6, pj: 2, pg: 2, pp: 0, sf: 6, sc: 0, o: true }],
  }]);
});

test('crearHtml: mensaje de WhatsApp en el primer partido del día de cada equipo', () => {
  const salidas = { ...SALIDAS, origen: 'Os Remedios' };
  const p1 = partido({ salida: fechaPared(2026, 10, 3, 15, 0), calentamiento: fechaPared(2026, 10, 3, 16, 30), viajeMin: 30 });
  const p2 = partido({ fecha: fechaPared(2026, 10, 3, 19, 0), segundo: true });
  const d = datosDe(crearHtml(opciones({ partidos: [p1, p2], salidas, duracion: 90 })));
  assert.equal(d.partidos[1].wa, '');
  const lineas = d.partidos[0].wa.split('\n');
  assert.equal(lineas[0], '🏐 *DOMPAVOLEI IF1* (Infantil F)');
  assert.equal(lineas[3], '🚌 *Salida: 15:00* desde Os Remedios');
  // 19:00 + 90 min + 30 de viaje = 21:00.
  assert.equal(lineas.at(-1), '🔙 Vuelta a Os Remedios hacia las 21:00 (aprox.)');
});

// --- Página nueva (salidas.html) --------------------------------------------------------------------

test('plantilla-salidas.html: un solo __TITULO__ y __DATOS__, y los datos en <script id="datos">', () => {
  assert.equal(veces(PLANTILLA_SALIDAS, '__TITULO__'), 1);
  assert.equal(veces(PLANTILLA_SALIDAS, '__DATOS__'), 1);
  assert.ok(PLANTILLA_SALIDAS.includes(`${INICIO_DATOS}__DATOS__</script>`));
  assert.ok(PLANTILLA_SALIDAS.includes('<title>__TITULO__</title>'));
});

test('crearHtmlSalidas: la plantilla nueva con los mismos datos que crearHtml y el escudo como data URI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'escudo-'));
  try {
    const rutaEscudo = join(dir, 'escudo.png');
    const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0xFF, 0xFE, 0x3E, 0x3F]);
    writeFileSync(rutaEscudo, png);
    const p1 = partido({
      local: 'CV VIGO', visitante: 'DOMPAVOLEI IF1', esLocal: false, esVisitante: true, condicion: 'visitante',
      salida: fechaPared(2026, 10, 3, 14, 45), calentamiento: fechaPared(2026, 10, 3, 16, 30), viajeMin: 75, municipio: 'Vigo',
    });
    const p2 = partido({ fecha: fechaPared(2026, 10, 10), estado: 'sinhora', enCasa: true, municipio: 'Ourense' });
    const op = opciones({
      partidos: [p1, p2], salidas: SALIDAS, duracion: 90,
      urlPublicada: 'https://example.github.io/calendario/calendario.ics',
      clasificaciones: [{ equipo: 'DOMPAVOLEI IF1', competicion: 'LIGA', grupo: 'G', url: 'u', actualizado: null, filas: [] }],
    });
    const html = crearHtmlSalidas({ ...op, rutaEscudo });
    const { escudo, ...resto } = datosDe(html);
    assert.equal(escudo, `data:image/png;base64,${png.toString('base64')}`);
    assert.deepEqual(resto, datosDe(crearHtml(op)));
    assert.equal(Object.keys(datosDe(html)).at(-1), 'escudo');

    // Fuera de __TITULO__ y __DATOS__, la página es plantilla-salidas.html sin tocar; el título, el de siempre.
    const [antes, despuesTitulo] = PLANTILLA_SALIDAS.split('__TITULO__');
    const [medio, despues] = despuesTitulo.split('__DATOS__');
    assert.equal(html, antes + 'Partidos &#183; DOMPAVOLEI &#183; 2026/27' + medio + jsonDe(html) + despues);

    // La página de siempre no lleva el escudo aunque se le pase la ruta.
    assert.equal(Object.hasOwn(datosDe(crearHtml({ ...op, rutaEscudo })), 'escudo'), false);
    // Sin escudo.png (o sin ruta), "".
    assert.equal(datosDe(crearHtmlSalidas({ ...op, rutaEscudo: join(dir, 'no-existe.png') })).escudo, '');
    assert.equal(datosDe(crearHtmlSalidas(op)).escudo, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crearHtmlSalidas: un escudo que no se puede leer avisa y la página sale sin él', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'escudo-'));
  try {
    const avisos = [];
    t.mock.method(console, 'log', (texto) => avisos.push(texto));
    // Una carpeta en lugar del archivo: no se puede leer como imagen.
    assert.equal(datosDe(crearHtmlSalidas({ ...opciones(), rutaEscudo: dir })).escudo, '');
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /^ {2}! No se pudo leer el escudo \(.+\); la página nueva sale sin él\.$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crearHtmlSalidas: nombres con </script> y <!-- también van escapados en la página nueva', () => {
  const raro = '</script><!-- <script>';
  const p = partido({ local: raro, pabellon: raro });
  const html = crearHtmlSalidas(opciones({ partidos: [p], equipos: [equipo(raro, [p])], nombreClub: raro }));
  assert.ok(!jsonDe(html).includes('<'));
  assert.equal(veces(html, '</script>'), veces(PLANTILLA_SALIDAS, '</script>'));
  assert.equal(veces(html, '<!--'), veces(PLANTILLA_SALIDAS, '<!--'));
  assert.equal(datosDe(html).club, raro);
  assert.ok(html.includes(`<title>${codificarHtml(`Partidos · ${raro} · 2026/27`)}</title>`));
});
