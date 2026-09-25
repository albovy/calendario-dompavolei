// Mensaje para el grupo de WhatsApp de las familias: día, salida del bus y desde dónde, pabellón (con
// enlace al mapa), calentamiento, partidos del día y vuelta aproximada. Uno por equipo y día; va en el
// primer partido del día de ese equipo, que es donde la página pone los botones «Copiar» y «WhatsApp».

import { conHora } from './partidos.js';
import { DIAS, MESES, clave, claveSinCaja, compararTexto, fmt, hora, soloDia, sumarMinutos, txt } from './util.js';

const SANGRIA = '    ';
const CUARTO_DE_HORA = 15 * 60000;

function mayuscula(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

// "Sábado 26 de septiembre".
function diaLargo(d) { return mayuscula(`${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`); }

// Pabellón con su municipio, si el nombre no lo lleva ya; en casa, "(en casa)".
function lugar(p) {
  if (p.enCasa) return `${p.pabellon} (en casa)`;
  if (!p.municipio || ` ${clave(p.pabellon)} `.includes(` ${clave(p.municipio)} `)) return p.pabellon;
  return `${p.pabellon} (${p.municipio})`;
}

// Coordenada con 7 decimales como mucho (los que da el geocodificador): pabellones.json guarda algunas
// con ruido de coma flotante (-7.5242499999999994 -> -7.52425).
function coordenada(n) { return String(+Number(n).toFixed(7)); }

// Enlace al mapa: con las coordenadas de pabellones.json si las hay; si no, buscando el nombre y el
// municipio, como el enlace del pabellón en la página.
function enlaceMapa(p, pabellones) {
  const k = pabellones ? claveSinCaja(pabellones, p.pabellon) : '';
  const e = k && Object.hasOwn(pabellones, k) ? pabellones[k] : null;
  const consulta = e && e.lat != null && e.lon != null
    ? `${coordenada(e.lat)},${coordenada(e.lon)}`
    : encodeURIComponent(`${p.pabellon}, ${p.municipio || 'Galicia'}`);
  return `https://www.google.com/maps/search/?api=1&query=${consulta}`;
}

function lineaPartido(x, derbi, pabellon) {
  const cruce = derbi ? `${x.local} - ${x.visitante}` : `contra ${x.rival}`;
  const donde = x.pabellon && x.pabellon !== pabellon ? ` (en ${x.pabellon})` : '';
  return conHora(x) ? `🆚 ${fmt(x.fecha, 'HH:mm')} ${cruce}${donde}` : `🆚 ${mayuscula(cruce)} (hora por confirmar)${donde}`;
}

// Mensaje de los partidos de un equipo en un día (ordenados por hora).
function mensaje(grupo, { salidas, pedirBus, duracion, pabellones }) {
  const p = grupo[0];
  const conHoras = grupo.filter(conHora);
  // El primer partido con hora manda para la salida, el calentamiento y el pabellón.
  const guia = conHoras[0] ?? p;
  const origen = salidas ? txt(salidas.origen) : '';
  const l = [`🏐 *${p.nuestros.join(' y ')}* (${txt(p.categoria)})`, `📅 *${diaLargo(p.fecha)}*`, ''];
  if (!conHoras.length) l.push('⏰ Hora por confirmar');
  else if (conHoras.some((x) => x.estado === 'provisional')) l.push('⚠️ Horario provisional: puede cambiar');
  if (guia.salida) {
    l.push(`🚌 *Salida: ${hora(guia.salida)}* desde ${origen}`);
    if (pedirBus?.dirOrigen) l.push(`${SANGRIA}(${pedirBus.dirOrigen})`);
  }
  if (guia.pabellon) l.push(`🏟️ ${lugar(guia)}`, `${SANGRIA}${enlaceMapa(guia, pabellones)}`);
  else l.push('🏟️ Pabellón por confirmar');
  if (guia.calentamiento) l.push(`🔥 Calentamiento: ${hora(guia.calentamiento)}`);
  for (const x of grupo) l.push(lineaPartido(x, p.condicion === 'derbi', guia.pabellon));
  // Vuelta: el mismo cálculo que el correo de "Pedir bus": fin del último partido en el pabellón de la
  // salida + viaje, al alza a 15 min. Los partidos en otro pabellón no cuentan (tienen su propia salida).
  if (guia.salida && guia.viajeMin != null) {
    const ultimo = conHoras.filter((x) => x.pabellon === guia.pabellon).at(-1);
    const llegada = sumarMinutos(ultimo.fecha, duracion + guia.viajeMin);
    const redondeada = new Date(Math.ceil(llegada.getTime() / CUARTO_DE_HORA) * CUARTO_DE_HORA);
    l.push(`🔙 Vuelta a ${origen} hacia las ${hora(redondeada)} (aprox.)`);
  }
  return l.join('\n');
}

// Mensajes de los partidos de hoy en adelante (hoy: Date de pared): Map partido -> texto, solo en el
// primer partido del día de cada equipo. Los partidos con la fecha sin confirmar no llevan mensaje; si
// algún partido del día del equipo ya tiene resultado, el día ya empezó y tampoco.
// salidas: el de configSalidas o null; pedirBus: el de configPedirBus o null; duracion: minutos de un
// partido; pabellones: la caché de resolverPabellones o null.
export function mensajesWhatsApp(partidos, { salidas = null, pedirBus = null, duracion = 120, pabellones = null, hoy }) {
  const desde = soloDia(hoy).getTime();
  const grupos = new Map();
  for (const p of [...partidos].sort((a, b) => a.fecha - b.fecha)) {
    if (p.estado === 'pendiente' || soloDia(p.fecha).getTime() < desde) continue;
    // El equipo como en anadirSalidas: en un derbi, los dos en cualquier orden, y sin distinguir
    // mayúsculas (claveSinCaja): "Dompavolei IF1" es el mismo equipo que "DOMPAVOLEI IF1".
    const equipo = [...p.nuestros].sort(compararTexto).join('/');
    const k = claveSinCaja(grupos, `${fmt(p.fecha, 'yyyy-MM-dd')}|${equipo}`);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const opciones = { salidas, pedirBus, duracion, pabellones };
  const porJugar = [...grupos.values()].filter((g) => !g.some((x) => x.resultado));
  return new Map(porJugar.map((g) => [g[0], mensaje(g, opciones)]));
}
