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

import { clave, comoLista, esObjeto, leerJson, txt, unaLinea } from './util.js';

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
