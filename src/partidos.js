// Partidos del club: de las filas de iSquad a objetos limpios, equipos del club y textos del estado
// de la fecha. Traducción de la parte "Partidos" de calendario-voley.ps1.

import { fechaCruda } from './isquad.js';
import {
  anioTemporada, aviso, clave, claveSinCaja, compararTexto, fechaValida, fmt, infoCategoria, pabellon, sha1, txt,
  unaLinea,
} from './util.js';

// Como DateTime.TryParseExact con 'yyyy-MM-dd HH:mm:ss' (conHora) o 'yyyy-MM-dd': el texto tiene que
// tener exactamente ese formato y ser una fecha que exista. Devuelve un Date de pared o null.
function leerFecha(texto, conHora) {
  const patron = conHora ? /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/ : /^(\d{4})-(\d{2})-(\d{2})$/;
  const m = patron.exec(texto);
  return m ? fechaValida(...m.slice(1).map(Number)) : null;
}

export function convertirPartidos(crudos, idsClub) {
  // Convierte los partidos del club (de todas las temporadas descargadas) a objetos limpios.
  const lista = [];
  let sinFecha = 0;
  const vistos = new Set();
  for (const r of crudos) {
    const esL = idsClub.has(txt(r.id_club_local));
    const esV = idsClub.has(txt(r.id_club_visitante));
    if (!(esL || esV)) continue;

    const fecha = leerFecha(txt(r.fecha), true) ?? leerFecha(fechaCruda(r), false);
    if (!fecha) { sinFecha++; continue; }

    // fecha_confirmada = "1": la federación ya publica el día (y la hora, si no es 00:00).
    // Sin confirmar, la web de la federación no enseña ni el día: es la jornada prevista.
    const tieneHora = fecha.getUTCHours() + fecha.getUTCMinutes() + fecha.getUTCSeconds() > 0;
    const confirmada = txt(r.fecha_confirmada) === '1';
    let estado;
    if (confirmada) estado = tieneHora ? 'confirmada' : 'sinhora';
    else estado = tieneHora ? 'provisional' : 'pendiente';

    const local = unaLinea(r.nombre_local);
    const visit = unaLinea(r.nombre_visitante);
    const comp = unaLinea(r.nombre_competicion);
    const pab = pabellon(r.campo);
    const cat = infoCategoria(r.categoria, r.nombre_competicion);

    // iSquad a veces repite exactamente el mismo partido.
    const claveRepetido = [fmt(fecha, 'yyyyMMddHHmm'), local, visit, comp, pab].join('|');
    if (vistos.has(claveRepetido)) continue;
    vistos.add(claveRepetido);

    const nuestros = [];
    if (esL) nuestros.push(local);
    if (esV) nuestros.push(visit);
    let condicion = 'visitante';
    if (esL && esV) condicion = 'derbi';
    else if (esL) condicion = 'local';
    let rival = '';
    if (condicion === 'local') rival = visit;
    else if (condicion === 'visitante') rival = local;

    lista.push({
      fecha,
      temporada: anioTemporada(fecha),
      estado,
      local,
      visitante: visit,
      esLocal: esL,
      esVisitante: esV,
      condicion,
      nuestros,
      rival,
      competicion: comp,
      categoria: cat.nombre,
      claveCategoria: cat.clave,
      ordenCategoria: cat.orden,
      pabellon: pab,
      uid: '',
      // Los rellena anadirSalidas si config.json tiene "salidas".
      inicio: fecha,
      salida: null,
      calentamiento: null,
      viajeMin: null,
      viajeFuente: '',
      enCasa: false,
      municipio: '',
      km: null,
      segundo: false,
      salidaPrimero: null,
    });
  }
  if (sinFecha > 0) aviso(`${sinFecha} partido(s) sin fecha no se han incluido.`);

  lista.sort((a, b) => a.fecha - b.fecha || a.ordenCategoria - b.ordenCategoria
    || compararTexto(a.local, b.local) || compararTexto(a.visitante, b.visitante));

  // UID estable: si la federación cambia la fecha u hora, el calendario actualiza el evento en vez de
  // duplicarlo. Se numera dentro de cada temporada (ida, vuelta...) sin depender de --desde/--hasta.
  const veces = new Map();
  for (const p of lista) {
    const k = clave(`${p.temporada}|${p.competicion}|${p.local}|${p.visitante}`);
    const n = (veces.get(k) ?? 0) + 1;
    veces.set(k, n);
    p.uid = `${sha1(`${k}|${n}`).slice(0, 24)}@calendario-voley`;
  }
  return lista;
}

// La categoría que más se repite en los partidos (si empatan, la que sale antes), como
// Group-Object | Sort-Object Count -Descending | Select-Object -First 1.
function partidoMuestra(partidos) {
  const cuenta = new Map();
  for (const p of partidos) cuenta.set(p.categoria, (cuenta.get(p.categoria) ?? 0) + 1);
  let top = null;
  for (const [categoria, n] of cuenta) {
    if (top === null || n > cuenta.get(top)) top = categoria;
  }
  return partidos.find((p) => p.categoria === top);
}

export function equipos(partidos, anteriores) {
  // Equipos del club con partidos en la temporada, más los de la temporada anterior que aún no
  // tienen: así su calendario (y su enlace) existe desde el principio.
  // Como el [ordered]@{} del .ps1, el nombre no distingue mayúsculas: "Dompa CF1" es el mismo equipo
  // que "DOMPA CF1" y se queda con el nombre que sale primero.
  const info = new Map();
  for (const [lista, actual] of [[partidos, true], [anteriores, false]]) {
    for (const p of lista) {
      for (const e of p.nuestros) {
        const nombre = claveSinCaja(info, e);
        if (!info.has(nombre)) info.set(nombre, { actuales: [], todos: [] });
        if (actual) info.get(nombre).actuales.push(p);
        info.get(nombre).todos.push(p);
      }
    }
  }
  const resultado = [...info].map(([nombre, { actuales, todos }]) => {
    const muestra = partidoMuestra(actuales.length ? actuales : todos);
    return {
      nombre,
      categoria: muestra.categoria,
      claveCategoria: muestra.claveCategoria,
      ordenCategoria: muestra.ordenCategoria,
      partidos: actuales,
      ics: '',
    };
  });
  return resultado.sort((a, b) => a.ordenCategoria - b.ordenCategoria
    || compararTexto(a.categoria, b.categoria) || compararTexto(a.nombre, b.nombre));
}

export function conHora(p) { return p.estado === 'confirmada' || p.estado === 'provisional'; }

export function formatHora(p) {
  switch (p.estado) {
    case 'confirmada': return fmt(p.fecha, 'HH:mm');
    case 'provisional': return `${fmt(p.fecha, 'HH:mm')} (provisional)`;
    case 'sinhora': return 'Por confirmar';
    default: return 'Fecha y hora por confirmar';
  }
}

export function sufijoEstado(p) {
  switch (p.estado) {
    case 'provisional': return ' (fecha y hora provisionales)';
    case 'sinhora': return ' (hora por confirmar)';
    case 'pendiente': return ' (fecha y hora por confirmar)';
    default: return '';
  }
}
