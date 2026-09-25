// Descarga de la plataforma iSquad de la Federación Galega de Voleibol (la "Agenda calendario" de
// https://volei.gal/competiciones/) y catálogo de clubs. Traducción de la parte "Descarga" y
// "Elegir club" de calendario-voley.ps1.

import {
  BOM, aviso, clave, comoLista, compararTexto, esObjeto, esperar, fmt, leerJson, ordenarUnicos, prefijoComun, txt,
  unaLinea,
} from './util.js';

export const URL_BASE = 'https://resultadosvoleibol.isquad.es';
export const URL_FUENTE = 'https://volei.gal/competiciones/';
export const AMBITO = '20';       // Federación Galega de Voleibol
export const SUPERFICIE = '1';    // voleibol en pista (no playa)

const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) calendario-voley/1.0';

// Texto del error de fetch: el motivo de verdad (DNS, conexión rechazada...) viene en "cause". Si el
// nombre tiene varias direcciones (IPv4 e IPv6) y fallan todas, la causa es un AggregateError sin
// texto: se usa el del primer intento.
function motivo(error) {
  if (error.name === 'TimeoutError') return 'la web no ha respondido a tiempo';
  const causa = error.cause;
  return causa?.message || causa?.errors?.[0]?.message || causa?.code || error.message;
}

// La web de la federación a veces no acepta conexiones desde los servidores de GitHub durante unos
// minutos (en septiembre de 2026 pasó varias veces en un día; al rato volvía a responder). Por eso se
// reintenta con esperas cada vez más largas, unos 3 minutos en total, antes de rendirse.
export const ESPERAS_SEGUNDOS = [15, 30, 60, 90];

// opciones: base (otra web de iSquad; por defecto la de resultados) y esperas (segundos entre
// intentos; por defecto ESPERAS_SEGUNDOS).
export async function peticion(ruta, datos, { base = URL_BASE, esperas = ESPERAS_SEGUNDOS } = {}) {
  const url = `${base}/${ruta}`;
  const intentos = esperas.length + 1;
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(url, {
        method: datos ? 'POST' : 'GET',
        body: datos ? new URLSearchParams(datos) : undefined,
        headers: { 'User-Agent': AGENTE },
        signal: AbortSignal.timeout(45000),
      });
      if (!r.ok) throw new Error(`respuesta ${r.status} ${r.statusText}`.trim());
      // Se decodifica a mano como UTF-8, sin fiarse de lo que diga la cabecera del servidor.
      let texto = Buffer.from(await r.arrayBuffer()).toString('utf8');
      while (texto.startsWith(BOM)) texto = texto.slice(1);
      return texto;
    } catch (e) {
      if (i === intentos) {
        throw new Error(`No se pudo descargar ${url}\n    (${motivo(e)})\n    Comprueba la conexión a Internet y vuelve a intentarlo.`);
      }
      const segundos = esperas[i - 1];
      aviso(`La web de la federación no responde; se vuelve a intentar en ${segundos} s (intento ${i + 1} de ${intentos})...`);
      await esperar(segundos * 1000);
    }
  }
}

export async function partidosApi(desde) {
  // Misma consulta que hace la "Agenda calendario": todos los partidos desde una fecha.
  const json = await peticion('json/partidos_equipos_consultas.php', {
    accion: 'obtener_partidos',
    id_ambito: AMBITO,
    fecha_actual: fmt(desde, 'yyyy-MM-dd'),
    consulta: '0',
    id_superficie: SUPERFICIE,
  });
  let obj;
  try {
    obj = leerJson(json);
  } catch {
    throw new Error('La web de la federación devolvió datos que no se entienden. Puede que haya cambiado; revisa si hay una versión nueva de esta herramienta.');
  }
  if (!esObjeto(obj) || !Object.hasOwn(obj, 'data') || obj.data === null) {
    throw new Error('La web de la federación devolvió una respuesta inesperada (falta la lista de partidos). Inténtalo más tarde.');
  }
  return comoLista(obj.data).filter((r) => esObjeto(r) && Object.hasOwn(r, 'id_club_local'));
}

export function fechaCruda(fila) {
  // Día del partido tal como viene de iSquad ("aaaa-mm-dd").
  let f = txt(fila.fecha_calendario);
  if (!f && fila.fecha) f = txt(fila.fecha).slice(0, 10);
  return f;
}

export async function clubsFederacion() {
  // Nombre oficial de cada club (el ID coincide con id_club_local / id_club_visitante).
  const clubs = new Map();
  try {
    const html = await peticion(`listado_clubs.php?id_territorial=${AMBITO}&id_superficie=${SUPERFICIE}`, null);
    const patron = /afiliacion_clubs\/(\d+)\/[^'"]*['"][^>]*?\balt\s*=\s*['"]([^'"]*)['"]/g;
    for (const m of html.matchAll(patron)) {
      const id = m[1];
      const nombre = unaLinea(m[2]);
      if (nombre && !clubs.has(id)) clubs.set(id, nombre);
    }
  } catch {
    aviso('No se pudo descargar el listado oficial de clubs; se usarán los nombres de los equipos.');
  }
  return clubs;
}

// ID de club de un lado del partido ('' si no hay).
function idClub(fila, lado) {
  const id = txt(fila[`id_club_${lado}`]);
  return id === 'None' ? '' : id;
}

export async function catalogoClubs(crudosTemporada, crudosTodos) {
  // Clubs que se pueden elegir: los del listado oficial más los que aparecen en los partidos.
  // Se puede buscar por el nombre del club o por el de cualquiera de sus equipos.
  const oficiales = await clubsFederacion();
  const cuenta = new Map();
  const equipos = new Map();
  for (const r of crudosTemporada) {
    for (const lado of ['local', 'visitante']) {
      const id = idClub(r, lado);
      if (id) cuenta.set(id, (cuenta.get(id) ?? 0) + 1);
    }
  }
  for (const r of crudosTodos) {
    for (const lado of ['local', 'visitante']) {
      const id = idClub(r, lado);
      if (!id) continue;
      if (!equipos.has(id)) equipos.set(id, new Set());
      equipos.get(id).add(txt(r[`nombre_${lado}`]));
    }
  }
  const ids = ordenarUnicos([...oficiales.keys(), ...equipos.keys()]);
  const catalogo = ids.map((id) => {
    const nombresEquipos = equipos.has(id)
      ? ordenarUnicos([...equipos.get(id)].map(unaLinea).filter((n) => n))
      : [];
    const oficial = oficiales.get(id) ?? '';
    // Muchos clubs juegan con otro nombre (p. ej. el CV San Martiño es "DOMPAVOLEI"): se usa el
    // principio común de los nombres de sus equipos, si lo hay.
    const nombre = prefijoComun(nombresEquipos) || oficial || nombresEquipos[0] || `Club ${id}`;
    return {
      id,
      nombre,
      oficial: oficial && clave(oficial) !== clave(nombre) ? oficial : '',
      partidos: cuenta.get(id) ?? 0,
      orden: clave(nombre),
      busqueda: [clave(nombre), clave(oficial), ...nombresEquipos.map(clave)],
    };
  });
  return catalogo.sort((a, b) => compararTexto(a.orden, b.orden));
}

export function buscarClubs(catalogo, texto) {
  const buscada = clave(texto);
  if (!buscada) return [];
  // clave() solo deja letras, cifras y espacios: no hay nada que escapar.
  const patrones = buscada.split(' ').map((palabra) => new RegExp(`\\b${palabra}`));
  // Todas las palabras buscadas tienen que estar en el nombre del club o en el de uno de sus equipos.
  return catalogo.filter((c) => c.busqueda.some((t) => patrones.every((p) => p.test(t))));
}
