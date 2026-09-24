// Pruebas de src/zip.js y src/xlsx.js (sin red). El .xlsx se abre con un lector de ZIP mínimo y se
// comprueba el XML; los textos esperados son los que genera Save-Xlsx de calendario-voley.ps1.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { crc32, crearZip } from '../src/zip.js';
import { crearXlsx, textoXml } from '../src/xlsx.js';
import { fechaPared } from '../src/util.js';

// CRC-32 bit a bit, sin tabla: comprobación independiente de la de zip.js.
function crcLento(datos) {
  let c = ~0;
  for (const byte of datos) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

// Lector de ZIP mínimo: registro final, directorio central y cabeceras locales. Comprueba que
// las dos cabeceras de cada archivo coinciden y que el CRC y el tamaño son los de los datos.
function leerZip(buf) {
  const fin = buf.length - 22;
  assert.equal(buf.readUInt32LE(fin), 0x06054B50, 'registro final al final del archivo');
  const total = buf.readUInt16LE(fin + 10);
  assert.equal(buf.readUInt16LE(fin + 8), total);
  const tamCentral = buf.readUInt32LE(fin + 12);
  let pos = buf.readUInt32LE(fin + 16);
  assert.equal(pos + tamCentral, fin, 'el directorio central va justo antes del registro final');
  const entradas = [];
  for (let i = 0; i < total; i++) {
    assert.equal(buf.readUInt32LE(pos), 0x02014B50);
    const marcas = buf.readUInt16LE(pos + 8);
    const metodo = buf.readUInt16LE(pos + 10);
    const hora = buf.readUInt16LE(pos + 12);
    const fecha = buf.readUInt16LE(pos + 14);
    const crc = buf.readUInt32LE(pos + 16);
    const comprimido = buf.readUInt32LE(pos + 20);
    const tam = buf.readUInt32LE(pos + 24);
    const largoNombre = buf.readUInt16LE(pos + 28);
    const largoResto = buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const nombre = buf.toString('utf8', pos + 46, pos + 46 + largoNombre);
    // Cabecera local: los mismos campos (desde la versión hasta la longitud del nombre) y el mismo nombre.
    assert.equal(buf.readUInt32LE(local), 0x04034B50);
    assert.deepEqual(buf.subarray(local + 4, local + 28), buf.subarray(pos + 6, pos + 30));
    assert.equal(buf.toString('utf8', local + 30, local + 30 + largoNombre), nombre);
    const ini = local + 30 + largoNombre + buf.readUInt16LE(local + 28);
    assert.equal(metodo, 8, 'deflate');
    const datos = inflateRawSync(buf.subarray(ini, ini + comprimido));
    assert.equal(datos.length, tam);
    assert.equal(crc, crcLento(datos));
    entradas.push({ nombre, datos, marcas, hora, fecha, local });
    pos += 46 + largoNombre + largoResto;
  }
  return entradas;
}

function partes(xlsx) {
  return Object.fromEntries(leerZip(xlsx).map((e) => [e.nombre, e.datos.toString('utf8')]));
}

// Celdas de la hoja: referencia -> { estilo, valor }.
function celdas(hoja) {
  const r = new Map();
  const patron = /<c r="([A-Z]+\d+)"(?: t="inlineStr")? s="(\d+)">(?:<v>([^<]*)<\/v>|<is><t xml:space="preserve">([^<]*)<\/t><\/is>)<\/c>/g;
  for (const m of hoja.matchAll(patron)) r.set(m[1], { estilo: Number(m[2]), valor: m[3] ?? m[4] });
  return r;
}
function fila(hoja, n) {
  return [...celdas(hoja)].filter(([ref]) => ref.replace(/[A-Z]+/, '') === String(n)).map(([, c]) => c.valor);
}

const GENERADO = new Date(Date.UTC(2026, 8, 24, 13, 45, 7));   // de pared

const SALIDAS = {
  origen: 'Os Remedios', lat: 42.4296, lon: -8.6446, calentamiento: 60, factorBus: 1.1, margen: 0,
  redondeoViaje: 15, redondeo: 15, radioCasaKm: 1, manual: new Map(),
};

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

const DERBI = partido({
  fecha: fechaPared(2026, 10, 11), estado: 'pendiente', local: 'DOMPAVOLEI CF2', visitante: 'DOMPAVOLEI CF1',
  esVisitante: true, condicion: 'derbi', nuestros: ['DOMPAVOLEI CF2', 'DOMPAVOLEI CF1'], rival: '',
  competicion: `COPA <A&B> 'X'${String.fromCharCode(1)} "Y"`, pabellon: '',
});

describe('crearZip', () => {
  test('CRC-32 de ZIP', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
    assert.equal(crc32(Buffer.alloc(0)), 0);
    const aleatorio = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919 + 13) % 256));
    assert.equal(crc32(aleatorio), crcLento(aleatorio));
  });

  test('archivos en el orden dado, con texto en UTF-8 sin BOM, binarios y vacíos', () => {
    const binario = Buffer.from([0, 1, 2, 250, 255]);
    const zip = crearZip([
      { nombre: 'b.txt', contenido: 'Pabellón 🏐' },
      { nombre: 'a/bin.dat', contenido: binario },
      { nombre: 'vacío.txt', contenido: '' },
    ]);
    const e = leerZip(zip);
    assert.deepEqual(e.map((x) => x.nombre), ['b.txt', 'a/bin.dat', 'vacío.txt']);
    assert.deepEqual(e[0].datos, Buffer.from('Pabellón 🏐', 'utf8'));
    assert.deepEqual(e[1].datos, binario);
    assert.equal(e[2].datos.length, 0);
    // Bit 11 solo cuando el nombre no es ASCII.
    assert.deepEqual(e.map((x) => x.marcas), [0, 0, 0x0800]);
    assert.equal(e[0].local, 0);
  });

  test('fecha de los archivos: la indicada (hora de pared) o el 01/01/1980', () => {
    const [con] = leerZip(crearZip([{ nombre: 'x', contenido: 'x' }], GENERADO));
    assert.equal(con.fecha, ((2026 - 1980) << 9) | (9 << 5) | 24);
    assert.equal(con.hora, (13 << 11) | (45 << 5) | 3);   // los segundos van de dos en dos
    const [sin] = leerZip(crearZip([{ nombre: 'x', contenido: 'x' }]));
    assert.equal(sin.fecha, (1 << 5) | 1);
    assert.equal(sin.hora, 0);
  });

  test('ZIP sin archivos', () => {
    const zip = crearZip([]);
    assert.equal(zip.length, 22);
    assert.deepEqual(leerZip(zip), []);
  });
});

describe('crearXlsx', () => {
  test('partes del paquete, en el mismo orden que el .ps1', () => {
    const e = leerZip(crearXlsx([partido()], GENERADO, 'DOMPAVOLEI', null));
    assert.deepEqual(e.map((x) => x.nombre), [
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    for (const x of e) {
      assert.ok(x.datos.toString('utf8').startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><'), x.nombre);
    }
    assert.equal(e[0].fecha, ((2026 - 1980) << 9) | (9 << 5) | 24, 'fecha de generación');
  });

  test('hoja sin horas de salida: igual que la del .ps1', () => {
    const p = partes(crearXlsx([partido(), DERBI], GENERADO, 'DOMPAVOLEI', null));
    const cabecera = (letra, texto) => `<c r="${letra}1" t="inlineStr" s="2"><is><t xml:space="preserve">${texto}</t></is></c>`;
    const texto = (ref, estilo, valor) => `<c r="${ref}" t="inlineStr" s="${estilo}"><is><t xml:space="preserve">${valor}</t></is></c>`;
    assert.equal(p['xl/worksheets/sheet1.xml'], [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:K3"/>',
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>',
      '<sheetFormatPr defaultRowHeight="15"/><cols>',
      [11, 10, 16, 22, 34, 16, 13, 30, 38, 32, 32].map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${a}" customWidth="1"/>`).join(''),
      '</cols><sheetData><row r="1">',
      cabecera('A', 'Fecha'), cabecera('B', 'Día'), cabecera('C', 'Hora'), cabecera('D', 'Equipo del club'),
      cabecera('E', 'Rival'), cabecera('F', 'Local / visitante'), cabecera('G', 'Categoría'), cabecera('H', 'Competición'),
      cabecera('I', 'Pabellón'), cabecera('J', 'Equipo local'), cabecera('K', 'Equipo visitante'),
      '</row><row r="2"><c r="A2" s="1"><v>46298</v></c>',
      texto('B2', 0, 'sábado'), texto('C2', 0, '18:30'), texto('D2', 4, 'DOMPAVOLEI CF1'), texto('E2', 4, 'CV VIGO'),
      texto('F2', 0, 'Local'), texto('G2', 0, 'Cadete F'), texto('H2', 4, 'LIGA GALEGA CADETE F'),
      texto('I2', 4, 'PAVILLON DOS REMEDIOS'), texto('J2', 4, 'DOMPAVOLEI CF1'), texto('K2', 4, 'CV VIGO'),
      '</row><row r="3"><c r="A3" s="1"><v>46306</v></c>',
      texto('B3', 0, 'domingo'), texto('C3', 3, 'Fecha y hora por confirmar'),
      texto('D3', 4, 'DOMPAVOLEI CF1 / DOMPAVOLEI CF2'), texto('E3', 4, '(derbi)'), texto('F3', 0, 'Derbi'),
      texto('G3', 0, 'Cadete F'), texto('H3', 4, 'COPA &lt;A&amp;B&gt; &apos;X&apos; &quot;Y&quot;'), texto('I3', 4, ''),
      texto('J3', 4, 'DOMPAVOLEI CF2'), texto('K3', 4, 'DOMPAVOLEI CF1'),
      '</row></sheetData><autoFilter ref="A1:K3"/>',
      '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>',
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
      '<headerFooter><oddFooter>&amp;L&amp;8DOMPAVOLEI · generado el 24/09/2026 13:45 · fuente: volei.gal&amp;R&amp;8Página &amp;P de &amp;N</oddFooter></headerFooter>',
      '</worksheet>',
    ].join(''));
    assert.equal(p['xl/workbook.xml'], '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Partidos" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Partidos!$A$1:$K$3</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">Partidos!$1:$1</definedName></definedNames></workbook>');
  });

  test('con horas de salida: columnas de salida, viaje, calentamiento y municipio', () => {
    const fuera = partido({
      fecha: fechaPared(2026, 10, 4, 12, 0), salida: fechaPared(2026, 10, 4, 9, 45), inicio: fechaPared(2026, 10, 4, 9, 45),
      calentamiento: fechaPared(2026, 10, 4, 11, 0), viajeMin: 75, viajeFuente: 'osrm', municipio: 'Lalín', km: 58.4,
    });
    const lista = [
      partido({ enCasa: true, calentamiento: fechaPared(2026, 10, 3, 17, 30), inicio: fechaPared(2026, 10, 3, 17, 30), municipio: 'Pontevedra' }),
      fuera,
      partido({
        fecha: fechaPared(2026, 10, 4, 13, 30), calentamiento: fechaPared(2026, 10, 4, 12, 30), viajeMin: 75,
        municipio: 'Lalín', segundo: true, salidaPrimero: fuera,
      }),
      partido({ fecha: fechaPared(2026, 10, 10, 17, 0), estado: 'provisional', calentamiento: fechaPared(2026, 10, 10, 16, 0) }),
      partido({ fecha: fechaPared(2026, 10, 11), estado: 'sinhora' }),
    ];
    const p = partes(crearXlsx(lista, GENERADO, 'DOMPAVOLEI', SALIDAS));
    const hoja = p['xl/worksheets/sheet1.xml'];
    assert.match(hoja, /<dimension ref="A1:O6"\/>/);
    assert.match(hoja, /<autoFilter ref="A1:O6"\/>/);
    assert.match(p['xl/workbook.xml'], /Partidos!\$A\$1:\$O\$6</);
    assert.match(hoja, /<col min="3" max="3" width="12" customWidth="1"\/><col min="4" max="4" width="13" customWidth="1"\/><col min="5" max="5" width="14" customWidth="1"\/>/);
    assert.deepEqual(fila(hoja, 1), [
      'Fecha', 'Día', 'Salida (bus)', 'Viaje en bus', 'Calentamiento', 'Partido', 'Equipo del club', 'Rival',
      'Local / visitante', 'Categoría', 'Competición', 'Pabellón', 'Municipio', 'Equipo local', 'Equipo visitante',
    ]);
    // Columnas C a F (salida, viaje, calentamiento, partido) y M (municipio).
    const resumen = (n) => { const f = fila(hoja, n); return [...f.slice(2, 6), f[12]]; };
    assert.deepEqual(resumen(2), ['En casa', '', '17:30', '18:30', 'Pontevedra']);
    assert.deepEqual(resumen(3), ['09:45', '1 h 15 min', '11:00', '12:00', 'Lalín']);
    assert.deepEqual(resumen(4), ['2º partido', '', '', '13:30', 'Lalín']);
    assert.deepEqual(resumen(5), ['Sin calcular', '', '16:00', '17:00 (provisional)', '']);
    assert.deepEqual(resumen(6), ['', '', '', 'Por confirmar', '']);
    // La hora del partido va en cursiva (estilo 3) si no está confirmada.
    const c = celdas(hoja);
    assert.deepEqual(['F2', 'F3', 'F4', 'F5', 'F6'].map((r) => c.get(r).estilo), [0, 0, 0, 3, 3]);
  });

  test('sin partidos: solo la fila de títulos', () => {
    const p = partes(crearXlsx([], GENERADO, 'DOMPAVOLEI', null));
    const hoja = p['xl/worksheets/sheet1.xml'];
    assert.match(hoja, /<dimension ref="A1:K1"\/>/);
    assert.match(hoja, /<sheetData><row r="1">.*<\/row><\/sheetData><autoFilter ref="A1:K1"\/>/);
    assert.match(p['xl/workbook.xml'], /Partidos!\$A\$1:\$K\$1</);
  });

  test('pie de página: el "&" del nombre del club no es un código de formato', () => {
    const hoja = partes(crearXlsx([], GENERADO, 'Club A&B', null))['xl/worksheets/sheet1.xml'];
    // "&&" es un "&" de verdad; "&B" pondría el resto del pie en negrita (el .ps1 no lo escapa).
    assert.match(hoja, /<oddFooter>&amp;L&amp;8Club A&amp;&amp;B · generado el /);
  });

  test('fechas como número de serie de Excel (el día, sin la hora)', () => {
    const lista = [
      partido({ fecha: fechaPared(1899, 12, 31) }),
      partido({ fecha: fechaPared(1900, 3, 1) }),
      partido({ fecha: fechaPared(2026, 10, 3, 23, 59) }),
      partido({ fecha: fechaPared(2027, 3, 28, 2, 30) }),
    ];
    const c = celdas(partes(crearXlsx(lista, GENERADO, 'X', null))['xl/worksheets/sheet1.xml']);
    assert.deepEqual(['A2', 'A3', 'A4', 'A5'].map((r) => c.get(r).valor), ['1', '61', '46298', '46474']);
  });

  test('estilos: formato de fecha dd/mm/yyyy y cinco estilos de celda', () => {
    const estilos = partes(crearXlsx([], GENERADO, 'X', null))['xl/styles.xml'];
    assert.match(estilos, /<numFmt numFmtId="164" formatCode="dd\/mm\/yyyy"\/>/);
    assert.match(estilos, /<cellXfs count="5">/);
    assert.equal((estilos.match(/<xf /g) ?? []).length, 6);   // 1 de cellStyleXfs + 5 de cellXfs
  });
});

describe('textoXml', () => {
  test('escapa como SecurityElement.Escape y quita los caracteres de control', () => {
    assert.equal(textoXml(`<a href="x">'Tom' & Jerry</a>`), '&lt;a href=&quot;x&quot;&gt;&apos;Tom&apos; &amp; Jerry&lt;/a&gt;');
    assert.equal(textoXml(`a${String.fromCharCode(0, 8, 11, 12, 14, 31)}b\tc\nd\re`), 'ab\tc\nd\re');
    assert.equal(textoXml(''), '');
    assert.equal(textoXml(null), '');
    // U+FFFE y U+FFFF tampoco son caracteres de XML (el .ps1 los deja y Excel da el archivo por dañado).
    assert.equal(textoXml(`a${String.fromCharCode(0xFFFE)}b${String.fromCharCode(0xFFFF)}c`), 'abc');
  });
});
