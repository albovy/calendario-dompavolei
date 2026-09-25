// Calendario .ics (RFC 5545) para Google Calendar, Outlook, iPhone o Android.
//
// Traducción de New-Ics de calendario-voley.ps1: mismas líneas, en el mismo orden, con saltos CRLF.

import { clave, fmt, sumarDias, sumarMinutos } from './util.js';
import { URL_FUENTE } from './isquad.js';
import { conHora } from './partidos.js';
import { lineasSalida } from './salidas.js';

const ZONA_HORARIA = 'Europe/Madrid';

// Escapes de los valores de texto de RFC 5545.
export function textoIcs(texto) {
  if (!texto) return '';
  return String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function esSustitutoAlto(codigo) { return codigo >= 0xD800 && codigo <= 0xDBFF; }

export function lineaIcs(linea) {
  // RFC 5545: líneas de 75 octetos como máximo; las siguientes empiezan por un espacio.
  // Se corta siempre entre caracteres completos: ni dentro de una secuencia UTF-8 ni de un par
  // sustituto (los emojis como 🚌 ocupan dos posiciones del texto y cuatro octetos).
  if (Buffer.byteLength(linea) <= 75) return `${linea}\r\n`;
  let r = '';
  let bytes = 0;
  let i = 0;
  while (i < linea.length) {
    const largo = esSustitutoAlto(linea.charCodeAt(i)) && i + 1 < linea.length ? 2 : 1;
    const trozo = linea.slice(i, i + largo);
    const b = Buffer.byteLength(trozo);
    if (bytes + b > 75) {
      r += '\r\n ';
      bytes = 1;
    }
    r += trozo;
    bytes += b;
    i += largo;
  }
  return `${r}\r\n`;
}

// Como -match '\bPALABRA\b': la clave del municipio aparece como palabra completa en la del pabellón.
function contienePalabra(texto, palabra) {
  const escapada = palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escapada}\\b`, 'i').test(texto);
}

// Marcador (o set) del lado del club: en los partidos de visitante se da la vuelta.
function delClub(p, par) { return p.condicion === 'visitante' ? [par[1], par[0]] : par; }

// Con resultado: "✅ IF1 3-0 RIVAL" (o ❌), con el marcador del club primero; en un derbi, "🏐 CF1 3-1 CF2".
function tituloResultado(p, corto) {
  const [a, b] = delClub(p, p.resultado.marcador);
  if (p.condicion === 'derbi') return `🏐 ${corto(p.local)} ${a}-${b} ${corto(p.visitante)}`;
  return `${a > b ? '✅' : '❌'} ${corto(p.nuestros[0])} ${a}-${b} ${p.rival}`;
}

// Título corto para que se lea bien en el calendario del móvil: "🚌 IF1 vs RIVAL (10:00)".
// La hora entre paréntesis es la del partido cuando el evento empieza antes (salida del bus o
// calentamiento); los equipos del club van sin el nombre del club delante (prefijo). Ya jugado, con
// el resultado (tituloResultado).
function tituloEvento(p, inicio, prefijo) {
  const corto = (n) => (prefijo && n.startsWith(`${prefijo} `) ? n.slice(prefijo.length + 1) : n);
  if (p.resultado) return tituloResultado(p, corto);
  const partido = p.condicion === 'derbi'
    ? `${corto(p.local)} vs ${corto(p.visitante)}`
    : `${corto(p.nuestros[0])} vs ${p.rival}`;
  const notas = [];
  if (conHora(p) && inicio.getTime() !== p.fecha.getTime()) notas.push(fmt(p.fecha, 'HH:mm'));
  if (p.estado === 'provisional') notas.push('provisional');
  else if (p.estado === 'sinhora') notas.push('sin hora');
  else if (p.estado === 'pendiente') notas.push('por confirmar');
  return `${p.salida ? '🚌 ' : ''}${partido}${notas.length ? ` (${notas.join(', ')})` : ''}`;
}

// Detalle breve: horas del día (si hay horas de salida), el partido y la competición. El pabellón
// ya va en la ubicación del evento.
function detalleEvento(p, cfgSalidas) {
  if (p.resultado) {
    // Ya jugado: los sets, el partido y la competición (las horas de salida ya no hacen falta).
    const sets = p.resultado.sets.map((s) => delClub(p, s).join('-')).join(' · ');
    return [...(sets ? [`Sets: ${sets}`] : []), `${p.local} - ${p.visitante}`, p.competicion].join('\n');
  }
  const lineas = [...lineasSalida(p, cfgSalidas)];
  if (p.estado === 'sinhora') lineas.push('Hora por confirmar');
  else if (p.estado === 'pendiente') lineas.push('Fecha y hora por confirmar (día de la jornada prevista)');
  else if (p.estado === 'provisional' && !lineas.length) lineas.push('Hora provisional');
  lineas.push(`${p.local} - ${p.visitante}`, p.competicion);
  return lineas.join('\n');
}

// generado: { pared, utc } de la generación; cfgSalidas: configuración de las horas de salida o null;
// prefijo: principio común del nombre de los equipos del club ("DOMPAVOLEI"), que se quita en el título.
export function crearIcs(partidos, nombreCalendario, descripcion, duracionMin, generado, cfgSalidas, { prefijo = '' } = {}) {
  const lista = [...(partidos ?? [])];
  const sello = fmt(generado.utc, "yyyyMMdd'T'HHmmss'Z'");
  // SEQUENCE crece en cada generación: Google y Outlook solo aplican un cambio si es mayor que el anterior.
  const secuencia = Math.floor(generado.utc.getTime() / 60000);
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//calendario-voley//Calendario de voleibol (volei.gal)//ES',
    'CALSCALE:GREGORIAN',
  ];
  // METHOD:PUBLISH exige al menos un evento; un calendario todavía vacío va sin él.
  if (lista.length > 0) lineas.push('METHOD:PUBLISH');
  lineas.push(
    `X-WR-CALNAME:${textoIcs(nombreCalendario)}`,
    `X-WR-CALDESC:${textoIcs(descripcion)}`,
    `X-WR-TIMEZONE:${ZONA_HORARIA}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE',
    `TZID:${ZONA_HORARIA}`,
    `X-LIC-LOCATION:${ZONA_HORARIA}`,
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  );

  for (const p of lista) {
    const hora = conHora(p);
    // El evento empieza a la hora de salida (o de calentamiento); la del partido va en el título.
    const inicio = hora && p.inicio ? p.inicio : p.fecha;
    const titulo = tituloEvento(p, inicio, prefijo);
    const desc = detalleEvento(p, cfgSalidas);

    let lugar = p.pabellon;
    if (lugar && p.municipio && !contienePalabra(clave(lugar), clave(p.municipio))) lugar += `, ${p.municipio}`;

    lineas.push(
      'BEGIN:VEVENT',
      `UID:${p.uid}`,
      `DTSTAMP:${sello}`,
      `LAST-MODIFIED:${sello}`,
      `SEQUENCE:${secuencia}`,
    );
    if (hora) {
      lineas.push(
        `DTSTART;TZID=${ZONA_HORARIA}:${fmt(inicio, "yyyyMMdd'T'HHmmss")}`,
        `DTEND;TZID=${ZONA_HORARIA}:${fmt(sumarMinutos(p.fecha, duracionMin), "yyyyMMdd'T'HHmmss")}`,
        'TRANSP:OPAQUE',
      );
    } else {
      lineas.push(
        `DTSTART;VALUE=DATE:${fmt(p.fecha, 'yyyyMMdd')}`,
        `DTEND;VALUE=DATE:${fmt(sumarDias(p.fecha, 1), 'yyyyMMdd')}`,
        'TRANSP:TRANSPARENT',
      );
    }
    lineas.push(`SUMMARY:${textoIcs(titulo)}`);
    if (lugar) lineas.push(`LOCATION:${textoIcs(lugar)}`);
    lineas.push(
      `DESCRIPTION:${textoIcs(desc)}`,
      `CATEGORIES:${textoIcs(p.categoria)}`,
      `STATUS:${p.estado === 'confirmada' ? 'CONFIRMED' : 'TENTATIVE'}`,
      `URL:${URL_FUENTE}`,
      'END:VEVENT',
    );
  }
  lineas.push('END:VCALENDAR');
  return lineas.map(lineaIcs).join('');
}

