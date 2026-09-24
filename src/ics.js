// Calendario .ics (RFC 5545) para Google Calendar, Outlook, iPhone o Android.
//
// Traducción de New-Ics de calendario-voley.ps1: mismas líneas, en el mismo orden, con saltos CRLF.

import { clave, fmt, sumarDias, sumarMinutos } from './util.js';
import { URL_FUENTE } from './isquad.js';
import { conHora, sufijoEstado } from './partidos.js';
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

// generado: { pared, utc } de la generación; cfgSalidas: configuración de las horas de salida o null.
export function crearIcs(partidos, nombreCalendario, descripcion, duracionMin, generado, cfgSalidas) {
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

  const actualizado = fmt(generado.pared, 'dd/MM/yyyy HH:mm');
  for (const p of lista) {
    const hora = conHora(p);
    const inicio = hora && p.inicio ? p.inicio : p.fecha;
    // El evento empieza a la hora de salida (o de calentamiento): el título lleva la hora del partido.
    let titulo = `${p.salida ? '🚌 ' : ''}${p.categoria} · ${p.local} - ${p.visitante}`;
    if (hora && inicio.getTime() !== p.fecha.getTime()) titulo += ` · partido ${fmt(p.fecha, 'HH:mm')}`;
    titulo += sufijoEstado(p);

    const desc = [...(lineasSalida(p, cfgSalidas) ?? [])];
    if (desc.length) desc.push('');
    desc.push(
      textoJuega(p),
      `Competición: ${p.competicion}`,
      `Categoría: ${p.categoria}`,
      `Local: ${p.local}`,
      `Visitante: ${p.visitante}`,
      `Pabellón: ${p.pabellon ? p.pabellon : 'por confirmar'}`,
    );
    // Con horas de salida, la hora del partido ya va en las líneas de salida.
    if (!(cfgSalidas && hora)) desc.push(textoCuando(p));
    desc.push('', `Datos de la Federación Galega de Voleibol (${URL_FUENTE}), actualizados el ${actualizado}. Los horarios pueden cambiar.`);

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
      `DESCRIPTION:${textoIcs(desc.join('\n'))}`,
      `CATEGORIES:${textoIcs(p.categoria)}`,
      `STATUS:${p.estado === 'confirmada' ? 'CONFIRMED' : 'TENTATIVE'}`,
      `URL:${URL_FUENTE}`,
      'END:VEVENT',
    );
  }
  lineas.push('END:VCALENDAR');
  return lineas.map(lineaIcs).join('');
}

function textoJuega(p) {
  switch (p.condicion) {
    case 'local': return `${p.local} juega como local`;
    case 'visitante': return `${p.visitante} juega como visitante`;
    default: return 'Partido entre dos equipos del club';
  }
}

function textoCuando(p) {
  switch (p.estado) {
    case 'confirmada': return `Hora: ${fmt(p.fecha, 'HH:mm')}`;
    case 'provisional': return `Fecha y hora provisionales (${fmt(p.fecha, 'HH:mm')}): la federación aún no las ha confirmado`;
    case 'sinhora': return 'Hora: por confirmar';
    default: return 'Fecha y hora por confirmar: el día indicado es el de la jornada prevista';
  }
}
