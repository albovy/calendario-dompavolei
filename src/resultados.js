// Resultados y clasificaciones de los equipos del club en la temporada en curso.
//
// La "Agenda calendario" no trae resultados ni grupos. Se sacan de las páginas de resultados de iSquad,
// las mismas que enseña volei.gal: el árbol de competiciones da el número de cada competición y de sus
// grupos ("torneos"); la página de un grupo trae la lista de grupos de la competición (con sus equipos)
// y los partidos del grupo con el marcador y los sets; la de clasificación, la tabla.
//
// Para no cargar la web de la federación solo se consultan los grupos en los que juega el club y solo
// cuando hace falta (gruposAConsultar); todo se guarda en resultados.json. Nunca se descargan actas,
// previos ni plantillas: solo nombres de equipos y marcadores (en los equipos hay menores).

import { conHora } from './partidos.js';
import {
  clave, comoLista, esObjeto, fechaValida, fmt, leerJson, sha1, soloDia, sumarDias, sumarMinutos, txt, unaLinea,
} from './util.js';

const HORAS_REPASO = 20;    // cada cuánto se repasan un grupo sin terminar y la lista de grupos
const DIAS_ESPERA = 14;     // días que se insiste cada hora en un resultado que no llega

// --- Lectura de las páginas de iSquad ------------------------------------------------------------

const RE_CLUB = /afiliacion_clubs\/(\d+)\//;

// Windows-1252 de 0x80 a 0x9F (los que no existen, como el propio carácter de control).
const CP1252 = String.fromCharCode(
  0x20AC, 0x81, 0x201A, 0x192, 0x201E, 0x2026, 0x2020, 0x2021, 0x2C6, 0x2030, 0x160, 0x2039, 0x152, 0x8D, 0x17D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x2DC, 0x2122, 0x161, 0x203A, 0x153, 0x9D, 0x17E, 0x178,
);
const SUSTITUTO = String.fromCharCode(0xFFFD);

// La lista de grupos y el árbol traen a veces los nombres mal codificados ("EMEVÃ‰" por "EMEVÉ": UTF-8
// leído como Windows-1252). Se recuperan los bytes y se leen como UTF-8; si no sale bien, se deja igual.
export function repararNombre(texto) {
  const t = txt(texto);
  if (!/[ÃÂ]/.test(t)) return t;
  const bytes = [];
  for (const c of t) {
    const i = CP1252.indexOf(c);
    const n = i >= 0 ? 0x80 + i : c.codePointAt(0);
    if (n > 0xFF) return t;
    bytes.push(n);
  }
  const r = Buffer.from(bytes).toString('utf8');
  return r.includes(SUSTITUTO) ? t : r;
}

// Código de acceso que llevan dentro las páginas de iSquad (token = "…"); '' si no está.
export function leerToken(html) {
  const m = /\btoken\s*=\s*["']([0-9a-f]{16,})["']/i.exec(txt(html));
  return m ? m[1] : '';
}

// Árbol de competiciones (JSON): clave del nombre -> { id, torneos: [números de sus grupos] }.
export function leerArbol(json) {
  const mapa = new Map();
  for (const campeonato of comoLista(leerJson(json) ?? [])) {
    for (const c of comoLista(campeonato?.competiciones ?? [])) {
      if (!esObjeto(c) || !c.id) continue;
      const torneos = comoLista(c.torneos ?? []).map((t) => txt(t?.id)).filter((id) => id);
      mapa.set(clave(repararNombre(c.nombre)), { id: txt(c.id), torneos });
    }
  }
  return mapa;
}

// Trozo de la página desde "marca" hasta "hasta" (o el final); null si no está la marca.
function desde(html, marca, hasta) {
  const i = html.indexOf(marca);
  if (i < 0) return null;
  const j = hasta ? html.indexOf(hasta, i) : -1;
  return html.slice(i, j < 0 ? undefined : j);
}

// Celdas de una fila de tabla, cada una con su <td> completo.
function celdas(fila) { return fila.split(/<td\b/i).slice(1).map((c) => `<td${c}`); }

// Lista de grupos de la competición (sección "GRUPOS DE LA COMPETICIÓN" de la página de un grupo):
// [{ torneo, nombre, equipos: [{ nombre, club }] }]. null si la página no la tiene.
export function leerGrupos(html) {
  const s = desde(txt(html), 'GRUPOS DE LA COMPETICI', 'RESULTADOS DE LA COMPETICI');
  if (s === null) return null;
  const grupos = [];
  for (const bloque of s.split(/<h4\b/i).slice(1)) {
    const fin = bloque.indexOf('</h4>');
    if (fin < 0) continue;
    const equipos = new Map();
    let torneo = '';
    const enlaces = bloque.slice(fin).matchAll(/<a\b[^>]*href=["']equipo\.php\?[^"']*?\bid_equipo=(\d+)&(?:amp;)?id=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi);
    for (const [, equipo, id, dentro] of enlaces) {
      torneo = id;
      const e = equipos.get(equipo) ?? { nombre: '', club: '' };
      const club = RE_CLUB.exec(dentro);
      if (club) e.club = club[1];
      const nombre = repararNombre(unaLinea(dentro));
      if (nombre) e.nombre = nombre;
      equipos.set(equipo, e);
    }
    if (!torneo) continue;
    grupos.push({
      torneo,
      nombre: repararNombre(unaLinea(`<h4${bloque.slice(0, fin)}`)),
      equipos: [...equipos.values()].filter((e) => e.nombre),
    });
  }
  return grupos;
}

// "25 - 18" de una celda de marcador o de set: [25, 18]; null si está vacía.
function tanteo(celda) {
  const m = /<span\b[^>]*>([^<]*)<\/span>\s*-\s*<span\b[^>]*>([^<]*)<\/span>/i.exec(txt(celda));
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  return /^\d+$/.test(a) && /^\d+$/.test(b) ? [Number(a), Number(b)] : null;
}

// Club de un equipo en la celda de los equipos, por su escudo ('' si no tiene).
function clubDe(celda, clase) {
  const a = new RegExp(`${clase}[\\s\\S]*?<\\/a>`, 'i').exec(celda);
  return a ? (RE_CLUB.exec(a[0])?.[1] ?? '') : '';
}

// Partidos del grupo (sección "RESULTADOS DE LA COMPETICIÓN"): [{ local, visitante, clubLocal,
// clubVisitante, dia: 'aaaa-mm-dd', hora: 'HH:mm' o '', estado, marcador: [l, v] o null,
// sets: [[l, v], ...] }]. null si la página no la tiene.
export function leerResultados(html) {
  const s = desde(txt(html), 'RESULTADOS DE LA COMPETICI');
  if (s === null) return null;
  const filas = [];
  for (const tr of s.split(/<tr\b/i).slice(1)) {
    if (!tr.includes('equipos-col')) continue;
    const c = celdas(tr);
    if (c.length < 10) continue;
    const nombres = [...c[0].slice(c[0].indexOf('nombres-equipos')).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => repararNombre(unaLinea(m[1])));
    const f = /(\d{1,2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(unaLinea(c[7]));
    // "0:00" es que el partido aún no tiene hora.
    const hora = f && (Number(f[1]) > 0 || f[2] !== '00') ? `${f[1].padStart(2, '0')}:${f[2]}` : '';
    filas.push({
      local: nombres[0] ?? '',
      visitante: nombres[1] ?? '',
      clubLocal: clubDe(c[0], 'escudo-local-wrap'),
      clubVisitante: clubDe(c[0], 'escudo-visitante-wrap'),
      dia: f ? `${f[5]}-${f[4]}-${f[3]}` : '',
      hora,
      estado: unaLinea(c[9]),
      marcador: tanteo(c[1]),
      sets: c.slice(2, 7).map(tanteo).filter((x) => x),
    });
  }
  return filas;
}

// Clasificación del grupo: [{ pos, equipo, club, pt, pj, pg, pp, sf, sc }]; null si la competición no
// tiene ("Clasificación NO DISPONIBLE") o la página no trae la tabla.
export function leerClasificacion(html) {
  const h = txt(html);
  if (/Clasificaci(?:ó|o|&oacute;)n NO DISPONIBLE/i.test(h)) return null;
  const t = /<table\b[^>]*class=["'][^"']*\bclasificacion\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(h);
  if (!t) return null;
  const i = t[1].search(/<tbody\b/i);
  const numero = (celda) => Number(/-?\d+/.exec(unaLinea(celda))?.[0] ?? 0);
  const filas = [];
  for (const tr of (i < 0 ? t[1] : t[1].slice(i)).split(/<tr\b/i).slice(1)) {
    const c = celdas(tr);
    if (c.length < 9) continue;
    const exportado = /data-export=["']([^"']*)["']/i.exec(c[1]);
    filas.push({
      pos: numero(c[0]),
      equipo: repararNombre(unaLinea(exportado ? exportado[1] : c[1])),
      club: RE_CLUB.exec(c[1])?.[1] ?? '',
      pt: numero(c[3]),
      pj: numero(c[4]),
      pg: numero(c[5]),
      pp: numero(c[6]),
      sf: numero(c[7]),
      sc: numero(c[8]),
    });
  }
  return filas;
}

// --- Emparejado y qué consultar ------------------------------------------------------------------

// Marcas de tiempo de resultados.json: "aaaa-mm-dd HH:mm", hora de Galicia.
function marca(d) { return fmt(d, 'yyyy-MM-dd HH:mm'); }

function leerMarca(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(txt(texto));
  return m ? fechaValida(...m.slice(1).map(Number)) : null;
}

// Horas desde una marca (Infinity si no hay).
function horasDesde(texto, ahora) {
  const d = leerMarca(texto);
  return d ? (ahora - d) / 3600000 : Infinity;
}

export function finalizado(fila) {
  return /^finalizado$/i.test(txt(fila?.estado).trim()) && Array.isArray(fila.marcador);
}

// Grupos de la caché de una competición: [[torneo, grupo], ...].
function gruposDe(cache, competicion) {
  const k = clave(competicion);
  return Object.entries(cache.grupos).filter(([, g]) => clave(g.competicion) === k);
}

// Apunta los grupos en los que juega el club (lista de leerGrupos). esNuestro(nombre, club).
export function anotarGrupos(cache, competicion, idCompeticion, lista, esNuestro) {
  for (const gr of lista) {
    const nuestros = gr.equipos.filter((e) => esNuestro(e.nombre, e.club)).map((e) => e.nombre).sort();
    if (!nuestros.length) continue;
    cache.grupos[gr.torneo] ??= {
      competicion, id_competicion: idCompeticion, nombre: '', equipos: [], consultado: '', terminado: false,
      firma: '', firma_clasificacion: '', partidos: [], clasificacion: null,
    };
    cache.grupos[gr.torneo].nombre = gr.nombre;
    cache.grupos[gr.torneo].equipos = nuestros;
  }
}

// Apunta los partidos del grupo (filas de leerResultados): los del club, si ya se ha jugado todo y una
// firma de todos (si cambia, cambia la clasificación).
export function anotarResultados(g, filas, esNuestro, ahora) {
  g.consultado = marca(ahora);
  g.terminado = filas.length > 0 && filas.every(finalizado);
  g.firma = sha1(filas.map((f) => [f.local, f.visitante, f.dia, f.estado, f.marcador ? f.marcador.join('-') : ''].join('|')).join('\n')).slice(0, 16);
  g.partidos = filas
    .filter((f) => esNuestro(f.local, f.clubLocal) || esNuestro(f.visitante, f.clubVisitante))
    .map(({ local, visitante, dia, hora, estado, marcador, sets }) => ({ local, visitante, dia, hora, estado, marcador, sets }));
}

// Fila de la federación de un partido de la agenda: mismo local, mismo visitante y mismo día en un grupo
// de su competición; si la federación le cambió el día, el mismo cruce si solo hay uno.
// Devuelve { torneo, fila } o null.
export function buscarFila(p, grupos) {
  const comp = clave(p.competicion);
  const local = clave(p.local);
  const visitante = clave(p.visitante);
  const dia = fmt(p.fecha, 'yyyy-MM-dd');
  const mismoDia = [];
  const cruce = [];
  for (const [torneo, g] of Object.entries(grupos)) {
    if (clave(g.competicion) !== comp) continue;
    for (const fila of comoLista(g.partidos ?? [])) {
      if (clave(fila.local) !== local || clave(fila.visitante) !== visitante) continue;
      (fila.dia === dia ? mismoDia : cruce).push({ torneo, fila });
    }
  }
  if (mismoDia.length) return mismoDia[0];
  return cruce.length === 1 ? cruce[0] : null;
}

// ¿Tendría que tener ya resultado? Empezó hace más de 2 horas (sin hora: desde el día siguiente) y
// hace como mucho 14 días.
export function esperaResultado(p, ahora) {
  const fin = conHora(p) ? sumarMinutos(p.fecha, 120) : sumarDias(soloDia(p.fecha), 1);
  return fin <= ahora && sumarDias(soloDia(p.fecha), DIAS_ESPERA + 1) > ahora;
}

// Competiciones de los partidos que aún no tienen número (o que no estaban en el árbol hace un día).
export function competicionesSinNumero(cache, partidos, ahora) {
  return [...new Set(partidos.map((p) => p.competicion))].filter((nombre) => {
    const c = cache.competiciones[nombre];
    return !c || (!c.id && horasDesde(c.revisado, ahora) >= HORAS_REPASO);
  });
}

// Qué hay que consultar: { descubrir: competiciones cuya lista de grupos hay que mirar, grupos: torneos }.
export function gruposAConsultar(cache, partidos, ahora) {
  const descubrir = new Set();
  const grupos = new Set();
  for (const p of partidos) {
    const c = cache.competiciones[p.competicion];
    if (!c?.id) continue;
    const e = buscarFila(p, cache.grupos);
    // Partido que no está en ningún grupo conocido (p. ej. empieza la segunda fase): se mira la lista
    // de grupos de su competición, como mucho una vez cada 20 horas.
    if (!e && horasDesde(c.revisado, ahora) >= HORAS_REPASO) descubrir.add(p.competicion);
    if (esperaResultado(p, ahora) && !(e && finalizado(e.fila))) {
      if (e) grupos.add(e.torneo);
      else for (const [t, g] of gruposDe(cache, p.competicion)) if (!g.terminado) grupos.add(t);
    }
  }
  // Grupos nunca consultados y repaso diario de los que tienen partidos por jugar (la clasificación
  // también cambia con los partidos de los rivales).
  const competiciones = new Set(partidos.map((p) => clave(p.competicion)));
  for (const [t, g] of Object.entries(cache.grupos)) {
    if (!competiciones.has(clave(g.competicion))) continue;
    if (!g.consultado || (!g.terminado && horasDesde(g.consultado, ahora) >= HORAS_REPASO)) grupos.add(t);
  }
  return { descubrir, grupos };
}
