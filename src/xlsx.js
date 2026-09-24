// Hoja de Excel (.xlsx) con los partidos: un ZIP con las partes XML mínimas de SpreadsheetML.
//
// Traducción de Save-Xlsx de calendario-voley.ps1: mismas partes, mismo XML y mismos estilos.

import { DIAS, compararTexto, fmt, formatDuracion, hora, soloDia, txt } from './util.js';
import { formatHora } from './partidos.js';
import { textoSalida } from './salidas.js';
import { crearZip } from './zip.js';

const ESCAPES_XML = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '&': '&amp;' };

// Caracteres que no se pueden escribir en XML: los de control (salvo tabulador y saltos de línea), y
// U+FFFE y U+FFFF, que el .ps1 deja pasar (y entonces Excel dice que el archivo está dañado).
const NO_XML = new RegExp(`[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F${String.fromCharCode(0xFFFE, 0xFFFF)}]`, 'g');

export function textoXml(texto) {
  if (!texto) return '';
  return String(texto).replace(NO_XML, '').replace(/[<>"'&]/g, (c) => ESCAPES_XML[c]);
}

function letraColumna(indice) { return String.fromCharCode(65 + indice); }   // hasta 26 columnas

// Número de serie de Excel del día del partido (días desde el 30/12/1899, como DateTime.ToOADate).
function serialExcel(d) { return (soloDia(d).getTime() - Date.UTC(1899, 11, 30)) / 86400000; }

// titulo, ancho, estilo (0 normal, 1 fecha, 4 ajustar texto) y valor de cada fila.
// La columna de la hora (hora: true) va en cursiva naranja (estilo 3) si no está confirmada.
function columnas(cfgSalidas) {
  const lista = [
    { titulo: 'Fecha', ancho: 11, estilo: 1 },
    { titulo: 'Día', ancho: 10, estilo: 0, valor: (p) => DIAS[p.fecha.getUTCDay()] },
  ];
  if (cfgSalidas) {
    lista.push(
      { titulo: 'Salida (bus)', ancho: 12, estilo: 0, valor: (p) => textoSalida(p) },
      {
        titulo: 'Viaje en bus', ancho: 13, estilo: 0,
        valor: (p) => (p.viajeMin != null && !p.segundo ? formatDuracion(p.viajeMin) : ''),
      },
      {
        titulo: 'Calentamiento', ancho: 14, estilo: 0,
        valor: (p) => (p.segundo ? '' : hora(p.calentamiento)),
      },
    );
  }
  lista.push(
    { titulo: cfgSalidas ? 'Partido' : 'Hora', ancho: 16, estilo: 0, hora: true, valor: (p) => formatHora(p) },
    { titulo: 'Equipo del club', ancho: 22, estilo: 4, valor: (p) => [...p.nuestros].sort(compararTexto).join(' / ') },
    { titulo: 'Rival', ancho: 34, estilo: 4, valor: (p) => (p.rival ? p.rival : '(derbi)') },
    { titulo: 'Local / visitante', ancho: 16, estilo: 0, valor: (p) => textoCondicion(p) },
    { titulo: 'Categoría', ancho: 13, estilo: 0, valor: (p) => p.categoria },
    { titulo: 'Competición', ancho: 30, estilo: 4, valor: (p) => p.competicion },
    { titulo: 'Pabellón', ancho: 38, estilo: 4, valor: (p) => p.pabellon },
  );
  if (cfgSalidas) lista.push({ titulo: 'Municipio', ancho: 18, estilo: 0, valor: (p) => p.municipio });
  lista.push(
    { titulo: 'Equipo local', ancho: 32, estilo: 4, valor: (p) => p.local },
    { titulo: 'Equipo visitante', ancho: 32, estilo: 4, valor: (p) => p.visitante },
  );
  return lista;
}

function textoCondicion(p) {
  switch (p.condicion) {
    case 'local': return 'Local';
    case 'visitante': return 'Visitante';
    default: return 'Derbi';
  }
}

function celdaTexto(ref, valor, estilo) {
  return `<c r="${ref}" t="inlineStr" s="${estilo}"><is><t xml:space="preserve">${textoXml(valor)}</t></is></c>`;
}

function crearHoja(partidos, cols, rango, pie) {
  const x = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
    `<dimension ref="${rango}"/>`,
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="15"/><cols>',
  ];
  cols.forEach((col, c) => x.push(`<col min="${c + 1}" max="${c + 1}" width="${col.ancho}" customWidth="1"/>`));
  x.push('</cols><sheetData>');

  x.push('<row r="1">');
  cols.forEach((col, c) => x.push(celdaTexto(`${letraColumna(c)}1`, col.titulo, 2)));
  x.push('</row>');

  partidos.forEach((p, i) => {
    const fila = i + 2;
    x.push(`<row r="${fila}">`);
    x.push(`<c r="A${fila}" s="1"><v>${serialExcel(p.fecha)}</v></c>`);
    for (let c = 1; c < cols.length; c++) {
      const col = cols[c];
      const estilo = col.hora && p.estado !== 'confirmada' ? 3 : col.estilo;
      x.push(celdaTexto(`${letraColumna(c)}${fila}`, txt(col.valor(p)), estilo));
    }
    x.push('</row>');
  });
  x.push(
    '</sheetData>',
    `<autoFilter ref="${rango}"/>`,
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.6" header="0.3" footer="0.3"/>',
    '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>',
    `<headerFooter><oddFooter>${textoXml(pie)}</oddFooter></headerFooter>`,
    '</worksheet>',
  );
  return x.join('');
}

const TIPOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';

const RELACIONES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

const RELACIONES_LIBRO = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';

// Estilos de celda: 0 normal, 1 fecha, 2 cabecera (blanco sobre azul), 3 hora sin confirmar
// (cursiva naranja), 4 texto que se ajusta a la columna.
const ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="11"/><color rgb="FF9C5700"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E4C92"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

// Libro con una sola hoja. El filtro y la fila de títulos que se repite al imprimir van como nombres definidos.
function crearLibro(ultima, filas) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Partidos" sheetId="1" r:id="rId1"/></sheets><definedNames>'
    + `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">Partidos!$A$1:$${ultima}$${filas}</definedName>`
    + '<definedName name="_xlnm.Print_Titles" localSheetId="0">Partidos!$1:$1</definedName></definedNames></workbook>';
}

export function crearXlsx(partidos, generadoPared, nombreClub, cfgSalidas) {
  const cols = columnas(cfgSalidas);
  const ultima = letraColumna(cols.length - 1);
  const filas = partidos.length + 1;
  // En el pie, "&" empieza un código de formato (&B = negrita): el "&" del nombre se escribe "&&". El
  // .ps1 no lo hace y con «Club A&B» el pie salía en negrita desde la B.
  const club = txt(nombreClub).replace(/&/g, '&&');
  const pie = `&L&8${club} · generado el ${fmt(generadoPared, 'dd/MM/yyyy HH:mm')} · fuente: volei.gal&R&8Página &P de &N`;
  return crearZip([
    { nombre: '[Content_Types].xml', contenido: TIPOS },
    { nombre: '_rels/.rels', contenido: RELACIONES },
    { nombre: 'xl/workbook.xml', contenido: crearLibro(ultima, filas) },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: RELACIONES_LIBRO },
    { nombre: 'xl/styles.xml', contenido: ESTILOS },
    { nombre: 'xl/worksheets/sheet1.xml', contenido: crearHoja(partidos, cols, `A1:${ultima}${filas}`, pie) },
  ], generadoPared);
}
