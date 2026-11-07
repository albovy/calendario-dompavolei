// Lectura de las páginas públicas de los grupos en la web de resultados de la federación (iSquad, las mismas
// que enseña volei.gal), y resultados y clasificaciones de los equipos del club.
//
// La página de un grupo trae la lista de grupos de la competición (con sus equipos) y los partidos del grupo:
// equipos y su club, día y hora, pabellón con su sitio, estado, marcador y sets; la de clasificación, la tabla.
// Las descarga federacion.js (solo los grupos del club; la clasificación, solo si cambian sus partidos) y todo
// se guarda en resultados.json, de donde salen también los partidos del calendario. Nunca se descargan actas,
// previos ni plantillas: solo nombres de equipos y marcadores (en los equipos hay menores).

import { writeFileSync } from 'node:fs';
import { URL_BASE } from './isquad.js';
import {
  clave, compararTexto, comoLista, fechaValida, fmt, pabellon, sha1, textoPlano, txt, unaLinea,
} from './util.js';

const TERRITORIAL = '20';        // Federación Galega de Voleibol
const AMBITO = '6';              // así la llaman las páginas de resultados (la agenda usa el 20)

// --- Lectura de las páginas de iSquad ------------------------------------------------------------

const RE_CLUB = /afiliacion_clubs\/(\d+)\//;

// Windows-1252 de 0x80 a 0x9F (los que no existen, como el propio carácter de control).
const CP1252 = String.fromCharCode(
  0x20AC, 0x81, 0x201A, 0x192, 0x201E, 0x2026, 0x2020, 0x2021, 0x2C6, 0x2030, 0x160, 0x2039, 0x152, 0x8D, 0x17D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x2DC, 0x2122, 0x161, 0x203A, 0x153, 0x9D, 0x17E, 0x178,
);
const SUSTITUTO = String.fromCharCode(0xFFFD);

// La lista de grupos trae a veces los nombres mal codificados ("EMEVÃ‰" por "EMEVÉ": UTF-8 leído como
// Windows-1252). Se recuperan los bytes y se leen como UTF-8; si no sale bien, se deja igual.
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

// Día y hora de la celda Fecha: { dia: 'aaaa-mm-dd', hora: 'HH:mm' }. En noviembre de 2026 la federación
// pasó de «10:00 19/09/2026» a «07/11/2026 17:00»: se busca cada dato esté donde esté. «0:00» es que el
// partido aún no tiene hora; una fecha que no existe (31/02) se queda vacía, como si no hubiera.
function fechaDe(celda) {
  const texto = unaLinea(celda);
  const d = /(?:^|\s)(\d{1,2})\/(\d{1,2})\/(\d{4})(?=\s|$)/.exec(texto);
  if (!d || !fechaValida(Number(d[3]), Number(d[2]), Number(d[1]))) return { dia: '', hora: '' };
  const h = /(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/.exec(texto);
  const conHora = h && (Number(h[1]) > 0 || h[2] !== '00') && fechaValida(2000, 1, 1, Number(h[1]), Number(h[2]));
  return { dia: `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`, hora: conHora ? `${h[1].padStart(2, '0')}:${h[2]}` : '' };
}

// Pabellón de la celda Lugar: { campo, lugar }. campo es el nombre como lo deja pabellon() (el <span> del
// enlace; en el formato de septiembre, el texto del enlace al mapa). lugar = { lat, lon, direccion }: las
// coordenadas, del enlace al mapa (q=lat,lon), y la dirección, del 3.er dato de mostrarLugar([mapa, nombre,
// dirección]), tal cual. Sin pabellón la celda viene vacía: '' y null; sin coordenadas, lugar es null.
function lugarDe(celda) {
  const nombre = /<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(celda) ?? /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(celda);
  const campo = nombre ? pabellon(nombre[1]) : '';
  const q = /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(celda);
  const [lat, lon] = q ? [Number(q[1]), Number(q[2])] : [0, 0];
  if (!campo || (lat === 0 && lon === 0)) return { campo, lugar: null };
  let direccion = '';
  const datos = /mostrarLugar\(\.\.\.(\[[\s\S]*?\])\)/.exec(celda);
  // El onclick lleva un JSON con las comillas como &quot;: textoPlano las decodifica (dentro no hay etiquetas).
  try {
    direccion = datos ? txt(JSON.parse(textoPlano(datos[1]))?.[2]).trim() : '';
  } catch {
    direccion = '';
  }
  return { campo, lugar: { lat, lon, direccion } };
}

// Partidos del grupo (sección "RESULTADOS DE LA COMPETICIÓN"): [{ id, local, visitante, clubLocal,
// clubVisitante, dia: 'aaaa-mm-dd' o '', hora: 'HH:mm' o '', estado, marcador: [l, v] o null, sets: [[l, v], ...],
// campo, lugar: { lat, lon, direccion } o null }]. id es el data-id de la fila ('' en el formato de septiembre).
// null si la página no tiene la sección.
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
    const { dia, hora } = fechaDe(c[7]);
    const estado = unaLinea(c[9]);
    const { campo, lugar } = lugarDe(c[8]);
    filas.push({
      id: /^[^>]*\bdata-id=["']?(\d+)/i.exec(tr)?.[1] ?? '',
      local: nombres[0] ?? '',
      visitante: nombres[1] ?? '',
      clubLocal: clubDe(c[0], 'escudo-local-wrap'),
      clubVisitante: clubDe(c[0], 'escudo-visitante-wrap'),
      dia,
      hora,
      estado,
      // Los que aún no se han jugado salen como «0 - 0»: solo hay marcador si está Finalizado.
      marcador: /^finalizado$/i.test(estado) ? tanteo(c[1]) : null,
      sets: c.slice(2, 7).map(tanteo).filter((x) => x),
      campo,
      lugar,
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

// --- Caché y emparejado --------------------------------------------------------------------------

// Marcas de tiempo de resultados.json: "aaaa-mm-dd HH:mm", hora de Galicia.
export function marca(d) { return fmt(d, 'yyyy-MM-dd HH:mm'); }

function leerMarca(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(txt(texto));
  return m ? fechaValida(...m.slice(1).map(Number)) : null;
}

// Horas desde una marca (Infinity si no hay).
export function horasDesde(texto, ahora) {
  const d = leerMarca(texto);
  return d ? (ahora - d) / 3600000 : Infinity;
}

export function finalizado(fila) {
  return /^finalizado$/i.test(txt(fila?.estado).trim()) && Array.isArray(fila.marcador);
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

// Apunta los partidos del grupo (filas de leerResultados): los del club, con todo lo que trae la página (de
// ellos salen también las filas del calendario, ver federacion.js), si ya se ha jugado todo y una firma de
// todos (si cambia, cambia la clasificación). Un grupo sin partidos (aún sin calendario) no tiene firma: no hay
// clasificación que pedir.
export function anotarResultados(g, filas, esNuestro, ahora) {
  g.consultado = marca(ahora);
  g.terminado = filas.length > 0 && filas.every(finalizado);
  g.firma = filas.length
    ? sha1(filas.map((f) => [f.local, f.visitante, f.dia, f.estado, f.marcador ? f.marcador.join('-') : ''].join('|')).join('\n')).slice(0, 16)
    : '';
  g.partidos = filas
    .filter((f) => esNuestro(f.local, f.clubLocal) || esNuestro(f.visitante, f.clubVisitante))
    .map(({ id, local, visitante, clubLocal, clubVisitante, dia, hora, estado, marcador, sets, campo, lugar }) => ({
      id, local, visitante, clubLocal, clubVisitante, dia, hora, estado, marcador, sets, campo, lugar,
    }));
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

// --- resultados.json y direcciones -------------------------------------------------------------------

export function guardarCacheResultados(cache, ruta) {
  // Competiciones por orden alfabético (los grupos, por número): cambios fáciles de leer en Git.
  const competiciones = Object.fromEntries(Object.keys(cache.competiciones).sort(compararTexto)
    .map((k) => [k, cache.competiciones[k]]));
  writeFileSync(ruta, `${JSON.stringify({ ...cache, competiciones }, null, 1)}\n`, 'utf8');
}

// Dirección (sin la web) de la página de un grupo: archivo es competicion_completa.php o clasificacion.php.
export function pagina(archivo, torneo, competicion) {
  return `${archivo}?seleccion=0&id=${torneo}&id_ambito=${AMBITO}&id_territorial=${TERRITORIAL}`
    + `&id_superficie=1&iframe=0&id_competicion=${competicion}`;
}

// Dirección de la clasificación de un grupo en la web de la federación.
export function urlClasificacion(torneo, competicion) {
  return `${URL_BASE}/${pagina('clasificacion.php', torneo, competicion)}`;
}

// --- Para el calendario y la página ------------------------------------------------------------------

// p.resultado = { marcador: [local, visitante], sets: [[l, v], ...] } si su partido está "Finalizado" en
// la federación; si no, null. Solo los de la temporada de la caché.
export function anadirResultados(partidos, cache) {
  for (const p of partidos) {
    const e = p.temporada === cache.temporada ? buscarFila(p, cache.grupos) : null;
    p.resultado = e && finalizado(e.fila)
      ? { marcador: [...e.fila.marcador], sets: e.fila.sets.map((s) => [...s]) }
      : null;
  }
}

// ¿Es "a" mejor grupo actual que "b"? El del próximo partido más cercano; si ninguno tiene, el del
// último partido.
function mejorGrupo(a, b) {
  if (a.proximo && b.proximo) return a.proximo < b.proximo;
  if (a.proximo || b.proximo) return Boolean(a.proximo);
  return a.ultimo > b.ultimo;
}

// Clasificación del grupo actual de cada equipo del club (en el orden de equipos):
// [{ equipo, competicion, grupo, url, actualizado (Date de pared o null), filas: [{ ...fila, nuestro }] }].
// Los equipos sin clasificación no salen. hoy: Date de pared. Un grupo con todos sus partidos de antes de la
// temporada de la caché (en agosto, el de la temporada pasada, aún en config.json) no es el actual de nadie.
export function clasificaciones(equipos, cache, ids, hoy) {
  const dia = fmt(hoy, 'yyyy-MM-dd');
  const inicio = `${cache.temporada}-08-01`;
  const lista = [];
  for (const e of equipos) {
    const k = clave(e.nombre);
    let elegido = null;
    for (const [torneo, g] of Object.entries(cache.grupos)) {
      if (!Array.isArray(g.clasificacion) || !g.clasificacion.length) continue;
      if (!comoLista(g.equipos).some((n) => clave(n) === k)) continue;
      const suyos = comoLista(g.partidos).filter((f) => clave(f.local) === k || clave(f.visitante) === k);
      if (suyos.length && suyos.every((f) => txt(f.dia) < inicio)) continue;
      const proximo = suyos.filter((f) => !finalizado(f) && f.dia >= dia).map((f) => f.dia).sort()[0] ?? '';
      const ultimo = suyos.map((f) => f.dia).sort().pop() ?? '';
      const candidato = { torneo, g, proximo, ultimo };
      if (!elegido || mejorGrupo(candidato, elegido)) elegido = candidato;
    }
    if (!elegido) continue;
    const { torneo, g } = elegido;
    lista.push({
      equipo: e.nombre,
      competicion: g.competicion,
      grupo: g.nombre,
      url: urlClasificacion(torneo, g.id_competicion),
      actualizado: leerMarca(g.consultado),
      filas: g.clasificacion.map((f) => ({ ...f, nuestro: ids.has(txt(f.club)) || clave(f.equipo) === k })),
    });
  }
  return lista;
}
