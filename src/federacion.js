// Partidos del club desde las páginas públicas de los grupos de la federación (competicion_completa.php).
//
// Desde el 06/11/2026 la federación da 403 a los programas en su agenda (json/partidos_equipos_consultas.php) y en
// todo lo que está bajo /json/. Las páginas de cada grupo, las mismas que enseña volei.gal, siguen abiertas y traen
// lo que daba la agenda de los partidos del club: equipos y su club (por el escudo), día y hora, pabellón con sus
// coordenadas y su dirección, estado y marcador. Los grupos se apuntan en config.json (federacion.grupos); las fases
// nuevas de esas competiciones se descubren solas (la página de un grupo lista los demás, con sus equipos): con cada
// descarga mientras el club tiene grupos sin terminar en ellas y, cuando ya los ha terminado todos, mirando una vez al
// día la página del último (gruposARepasar).
//
// Para no cargar su web: solo GET a competicion_completa.php y clasificacion.php, con el User-Agent del programa y
// nada más; al menos 1,5 s entre dos peticiones; sin reintentos si la federación dice que no (3xx o 4xx); los grupos
// terminados no se vuelven a pedir (salvo ese repaso diario) y la clasificación, solo cuando cambian los partidos del
// grupo. Nunca equipo.php (plantillas con menores), actas, previos ni nada bajo /json/. Todo se guarda en
// resultados.json.

import { existsSync, readFileSync } from 'node:fs';
import { peticion } from './isquad.js';
import {
  anotarGrupos, anotarResultados, guardarCacheResultados, horasDesde, leerClasificacion, leerGrupos, leerResultados,
  marca, pagina, repararNombre,
} from './resultados.js';
import { aviso, clave, comoLista, esObjeto, esperar, fmt, leerJson, paso, sumarDias, txt, unaLinea } from './util.js';

export const PAUSA_MS = 1500;            // como mínimo, entre el final de una petición y la siguiente
export const ESPERAS_GRUPOS = [15, 30];  // segundos antes de cada reintento si falla la red o la federación (5xx)
export const HORAS_COPIA = 48;           // si la federación falla, lo guardado vale hasta que tenga estas horas
// Si de un grupo solo cambia la hora de consulta, resultados.json se guarda solo si la guardada ya tiene estas horas:
// así no cambia (ni el workflow lo sube a GitHub) en cada ejecución, y la regla de las 48 horas, que lee la guardada,
// se adelanta como mucho eso.
export const HORAS_GUARDAR = 12;
// Fases nuevas de una competición en la que el club ya no tiene grupos sin terminar: se miran como mucho una vez cada
// HORAS_REPASO (como el repaso diario de antes) y hasta DIAS_REPASO días después de su último partido en ella.
export const HORAS_REPASO = 20;
export const DIAS_REPASO = 60;
// Se deja de pedir páginas a los 5 minutos: con lo que puede tardar la última (3 intentos de 45 s y las esperas,
// 3 minutos), todo cabe de sobra en los 15 minutos del workflow.
export const PLAZO_MS = 5 * 60 * 1000;

// --- config.json -----------------------------------------------------------------------------------------

const COMO_APUNTARLOS = 'Cada grupo se apunta con el id= y el id_competicion= de la dirección de su página en '
  + 'https://resultadosvoleibol.isquad.es (la de Resultados del grupo), por ejemplo: '
  + '"federacion": { "grupos": [ { "equipo": "DOMPAVOLEI SM1", "grupo": "3857", "competicion": "1516" } ] }.';

// Grupos de config.json (federacion.grupos): [{ equipo, grupo, competicion }], con grupo y competicion como textos de
// cifras. «equipo» solo sale en los mensajes. Error claro si faltan, no son cifras o hay uno repetido.
export function gruposConfig(cfg) {
  const lista = cfg?.federacion?.grupos;
  if (!Array.isArray(lista) || !lista.length) {
    throw new Error('config.json no tiene los grupos de la federación (federacion.grupos). Desde el 06/11/2026 la federación '
      + 'no deja descargar su agenda y los partidos se leen de la página de cada grupo: apunta en config.json los grupos en '
      + `los que juegan los equipos del club. ${COMO_APUNTARLOS}`);
  }
  const grupos = [];
  lista.forEach((e, i) => {
    const donde = `grupo n.º ${i + 1} de federacion.grupos de config.json`;
    if (!esObjeto(e)) throw new Error(`El ${donde} tiene que ser así: { "equipo": ..., "grupo": ..., "competicion": ... }. ${COMO_APUNTARLOS}`);
    const equipo = unaLinea(e.equipo);
    for (const [campo, parte] of [['grupo', 'id='], ['competicion', 'id_competicion=']]) {
      if (!/^\d+$/.test(txt(e[campo]).trim())) {
        throw new Error(`En el ${donde}${equipo ? ` (${equipo})` : ''}, «${campo}» tiene que ser un número (el ${parte} de la `
          + `dirección de la página del grupo), no «${txt(e[campo])}».`);
      }
    }
    const grupo = txt(e.grupo).trim();
    if (grupos.some((g) => g.grupo === grupo)) throw new Error(`El grupo ${grupo} está repetido en federacion.grupos de config.json.`);
    grupos.push({ equipo, grupo, competicion: txt(e.competicion).trim() });
  });
  return grupos;
}

// --- De la página a las filas de la agenda -----------------------------------------------------------------

// La categoría como la mandaba la agenda, sacada del nombre de la competición (la página no la trae). Al final, las
// ligas nacionales sin edad en el nombre («1ª DIV. NACIONAL FEMENINA», «SUPERLIGA 2»), que son de mayores.
const CATEGORIAS = [
  [/\b(?:XUVENIL|JUVENIL)/, 'JUVENIL'], [/\bSENIOR/, 'SENIOR'], [/\bJUNIOR/, 'JUNIOR'], [/\bCADETE/, 'CADETE'],
  [/\bINFANTIL/, 'INFANTIL'], [/\bALEVIN/, 'ALEVIN'], [/\b(?:BENXAMIN|BENJAMIN)/, 'BENJAMIN'],
  [/\b(?:NACIONAL|SUPERLIGA|DIVISION)\b/, 'SENIOR'],
];

export function categoriaDe(competicion) {
  const k = clave(competicion);
  return CATEGORIAS.find(([patron]) => patron.test(k))?.[1] ?? '';
}

// Un partido de la página de un grupo (de leerResultados o guardado en resultados.json) como una fila de la agenda:
// las 10 propiedades que lee convertirPartidos y el id del partido. La página no dice si la fecha está confirmada:
// con hora, o ya jugado, se da por confirmada; sin hora va a las 00:00:00, sin confirmar, como en la agenda. Así se
// pierde el «horario provisional» (hora puesta pero sin confirmar), que la página no distingue. Un partido aplazado o
// suspendido puede seguir con la hora que tenía: sale sin ella («Fecha y hora por confirmar», en su día) hasta que la
// federación lo vuelva a poner Pendiente con la fecha nueva.
export function filaAgenda(fila, competicion) {
  const dia = txt(fila.dia);
  const estado = txt(fila.estado).trim();
  const aplazado = /^(?:aplazado|suspendido)$/i.test(estado);
  const hora = !aplazado && /^\d{2}:\d{2}$/.test(txt(fila.hora)) && fila.hora !== '00:00' ? fila.hora : '';
  const jugado = /^finalizado$/i.test(estado);
  return {
    id_club_local: txt(fila.clubLocal),
    id_club_visitante: txt(fila.clubVisitante),
    nombre_local: txt(fila.local),
    nombre_visitante: txt(fila.visitante),
    nombre_competicion: txt(competicion),
    campo: txt(fila.campo),
    categoria: categoriaDe(competicion),
    fecha: `${dia} ${hora ? `${hora}:00` : '00:00:00'}`,
    fecha_confirmada: hora || jugado ? '1' : '',
    fecha_calendario: dia,
    id_partido: txt(fila.id),
  };
}

// Filas (filaAgenda) de los partidos del club en todos los grupos de la caché: la temporada entera, también los
// grupos terminados (sin la ida, la vuelta del mismo cruce cambiaría de UID). Los partidos guardados antes de
// noviembre de 2026 no llevan el ID de los clubs: se pone el del club si el nombre es de uno de sus equipos.
export function filasDeCache(cache, ids) {
  const idClub = [...ids].map(txt).sort()[0] ?? '';
  const filas = [];
  for (const g of Object.values(cache.grupos)) {
    if (!esObjeto(g)) continue;
    const nuestros = new Set(comoLista(g.equipos ?? []).map(clave));
    const club = (nombre, id) => txt(id) || (nuestros.has(clave(nombre)) ? idClub : '');
    for (const p of comoLista(g.partidos ?? [])) {
      if (!esObjeto(p)) continue;
      filas.push(filaAgenda({ ...p, clubLocal: club(p.local, p.clubLocal), clubVisitante: club(p.visitante, p.clubVisitante) }, g.competicion));
    }
  }
  return filas;
}

// Pabellones de los partidos del club (el nombre, como pabellon()) -> { lat, lon, direccion }, sacados de las
// páginas. La dirección va tal cual (con «, ESPAÑA» y las tildes como las escribe la federación).
export function lugaresDeCache(cache) {
  const lugares = new Map();
  for (const g of Object.values(cache.grupos)) {
    for (const p of comoLista(g?.partidos ?? [])) {
      const l = p?.lugar;
      if (txt(p?.campo) && esObjeto(l) && Number.isFinite(l.lat) && Number.isFinite(l.lon) && !lugares.has(p.campo)) {
        lugares.set(p.campo, { lat: l.lat, lon: l.lon, direccion: txt(l.direccion) });
      }
    }
  }
  return lugares;
}

// --- Lectura de la página de un grupo ------------------------------------------------------------------------

// Opciones de un <select> de la página: [{ id, nombre, elegida }].
function opciones(html, id) {
  const select = new RegExp(`<select\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</select>`, 'i').exec(html);
  return [...(select?.[1] ?? '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(([, atributos, texto]) => ({
    id: /\bvalue=["']?([^"'\s>]*)/i.exec(atributos)?.[1] ?? '',
    nombre: repararNombre(unaLinea(texto)),
    elegida: /\bselected\b/i.test(atributos),
  }));
}

// Nombre de la competición: el título de la sección de resultados (el mismo que la opción elegida de
// <select id='competiciones'> y que el nombre que daba la agenda).
function nombreCompeticion(html) {
  const i = html.indexOf('RESULTADOS DE LA COMPETICI');
  const titulo = i < 0 ? null : /<h4\b[^>]*>([\s\S]*?)<\/h4>/i.exec(html.slice(i));
  return repararNombre(unaLinea(titulo?.[1] ?? '')) || opciones(html, 'competiciones').find((o) => o.elegida)?.nombre || '';
}

// Partidos de la página de un grupo. Si no tiene el formato de siempre, un Error con el motivo: así se nota en
// cuanto la federación la cambie, en vez de quedarse sin partidos. Sin ningún partido es lo normal en un grupo que aún
// no tiene calendario: vale si no hay partidos del club guardados que perder (vacio); si los había, no. Un partido sin
// fecha (uno aplazado, por ejemplo) tampoco para el grupo: se avisa y no sale en el calendario hasta que la tenga, como
// con la agenda; si no tiene fecha ninguno, la página ha cambiado.
function leerPagina(html, vacio) {
  const filas = leerResultados(html);
  let falta = '';
  if (filas === null) falta = 'no tiene la lista de partidos';
  else if (!filas.length && !vacio) falta = 'no tiene ningún partido';
  else if (filas.length && filas.every((f) => !f.dia)) falta = 'ningún partido tiene fecha';
  else if (!nombreCompeticion(html)) falta = 'no dice de qué competición es';
  if (!falta) return filas;
  const motivo = `la página no tiene el formato de siempre: ${falta}; puede que la federación la haya cambiado`;
  throw Object.assign(new Error(motivo), { motivo, formato: true });
}

// --- resultados.json -----------------------------------------------------------------------------------------

function cacheVacia(anio, ids) {
  return { temporada: anio, clubs: [...ids].map(txt).sort(), competiciones: {}, grupos: {} };
}

// resultados.json: { cache } de la temporada anio y de estos clubs (vacía si no hay, es de otra o no se puede leer)
// y, si es de la temporada anterior, sus filas en «anterior» (para guardar temporada-anterior.json antes de que la
// caché nueva la sustituya).
function leerCopia(ruta, anio, ids) {
  const vacia = cacheVacia(anio, ids);
  let c = null;
  if (existsSync(ruta)) {
    try {
      c = leerJson(readFileSync(ruta, 'utf8'));
    } catch (e) {
      aviso(`resultados.json no se puede leer (${e.message}); se vuelven a descargar todos los grupos.`);
    }
  }
  const de = (anioCopia) => esObjeto(c) && c.temporada === anioCopia && esObjeto(c.competiciones) && esObjeto(c.grupos)
    && comoLista(c.clubs).map(txt).sort().join(',') === vacia.clubs.join(',');
  if (de(anio)) {
    // Un grupo sin el número de su competición no se puede pedir: se deja (si es del club, su página lo vuelve a apuntar).
    const grupos = Object.fromEntries(Object.entries(c.grupos).filter(([, g]) => esObjeto(g) && /^\d+$/.test(txt(g.id_competicion))));
    return { cache: { ...vacia, competiciones: c.competiciones, grupos }, anterior: [] };
  }
  return { cache: vacia, anterior: de(anio - 1) ? filasDeCache(c, ids) : [] };
}

// Grupo de config.json que aún no está en la caché (como los que apunta anotarGrupos).
function grupoNuevo(idCompeticion) {
  return {
    competicion: '', id_competicion: idCompeticion, nombre: '', equipos: [], consultado: '', terminado: false,
    firma: '', firma_clasificacion: '', partidos: [], clasificacion: null,
  };
}

// ¿Copia de antes de noviembre de 2026? Sus partidos no llevan pabellón (campo) ni el ID de los clubs.
function copiaVieja(g) {
  return comoLista(g.partidos ?? []).some((p) => !esObjeto(p) || !Object.hasOwn(p, 'campo'));
}

// Los grupos de las competiciones que ya no están en config.json (ni ellos mismos): se olvidan, con sus partidos. Así
// se quita un grupo apuntado por error o una competición entera; las fases que encontró el programa, con la suya.
function olvidarCompeticiones(cache, config) {
  const apuntadas = new Set(config.map((c) => c.competicion));
  const fuera = Object.keys(cache.grupos)
    .filter((t) => !config.some((c) => c.grupo === t) && !apuntadas.has(txt(cache.grupos[t].id_competicion)));
  for (const t of fuera) delete cache.grupos[t];
  for (const [nombre, c] of Object.entries(cache.competiciones)) if (!apuntadas.has(txt(c?.id))) delete cache.competiciones[nombre];
  if (fuera.length) {
    paso(`${fuera.length === 1 ? 'Se quita de resultados.json el grupo' : 'Se quitan de resultados.json los grupos'} ${fuera.join(', ')}: `
      + 'su competición ya no está en config.json.');
  }
}

// resultados.json sin la hora de consulta de los grupos: si solo cambia eso, no hace falta guardarlo (HORAS_GUARDAR).
function sinConsulta(cache) { return JSON.stringify(cache, (k, v) => (k === 'consultado' ? undefined : v)); }

// Grupos de la caché por competición (su id_competicion): Map id -> [[torneo, grupo], ...].
function porCompeticion(cache) {
  const mapa = new Map();
  for (const [t, g] of Object.entries(cache.grupos)) {
    const k = txt(g.id_competicion);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push([t, g]);
  }
  return mapa;
}

// Último día con partido del club en un grupo ('' si no tiene ninguno).
function ultimoDia(g) { return comoLista(g.partidos ?? []).map((p) => txt(p?.dia)).sort().pop() ?? ''; }

// La federación pone los equipos de la fase siguiente cuando acaba la anterior, y los grupos terminados no se vuelven a
// pedir: en una competición en la que el club ya no tiene grupos sin terminar, la fase nueva no se vería. Por eso, como
// mucho una vez cada HORAS_REPASO (revisado de la competición) y hasta DIAS_REPASO días después de su último partido
// en ella, se vuelve a pedir la página de su último grupo: su lista de grupos trae la fase nueva (y, de paso, las
// correcciones de la federación). No hace falta en las que tienen un grupo por completar: su página vale igual.
function gruposARepasar(cache, ahora, completar) {
  const desde = fmt(sumarDias(ahora, -DIAS_REPASO), 'yyyy-MM-dd');
  const repasar = [];
  for (const grupos of porCompeticion(cache).values()) {
    if (grupos.some(([t, g]) => !g.terminado || completar.includes(t))) continue;
    const [t, g] = grupos.reduce((a, b) => (ultimoDia(b[1]) > ultimoDia(a[1]) ? b : a));
    if (ultimoDia(g) >= desde && horasDesde(cache.competiciones[g.competicion]?.revisado, ahora) >= HORAS_REPASO) repasar.push(t);
  }
  return repasar;
}

// Para el error de las 48 horas: los grupos que no están en config.json (fases que encontró el programa) no se pueden
// quitar desde allí.
function comoQuitarlas(fases) {
  if (!fases.length) return '';
  const uno = fases.length === 1;
  return `\n    ${uno ? 'El grupo' : 'Los grupos'} ${fases.join(', ')} no ${uno ? 'está' : 'están'} en config.json: `
    + `${uno ? 'es una fase que salió' : 'son fases que salieron'} en la página de su competición. Si la federación ya no `
    + `${uno ? 'lo tiene, bórralo' : 'los tiene, bórralos'} de resultados.json.`;
}

// --- Actualización -------------------------------------------------------------------------------------------

// Descarga los grupos que hacen falta y devuelve { cache, filas, lugares, anterior, fallo }:
//   cache     resultados.json al día ({ temporada, clubs, competiciones, grupos }); se guarda si cambia y guardar (si
//             solo cambia la hora de consulta, cada HORAS_GUARDAR).
//   filas     las de toda la temporada en formato agenda (filasDeCache), también las de los grupos terminados.
//   lugares   Map: pabellón -> { lat, lon, direccion } (lugaresDeCache).
//   anterior  si resultados.json era de la temporada anio - 1, sus filas en formato agenda; si no, [].
//   fallo     null o { que, motivo, estado } del fallo de la federación en esta ejecución: así main.js no le pide nada más.
// Los grupos de competiciones que ya no están en config.json se olvidan. Primero se piden las páginas: los grupos de
// config.json y los de la caché que no estén terminados (los de config.json primero, y las fases nuevas que salgan en
// sus páginas, en la misma ejecución); luego, una vez, los terminados guardados con el formato de antes de noviembre de
// 2026, para completarlos, y los de gruposARepasar. Al final, las clasificaciones de los grupos cuyos partidos han
// cambiado (o que fallaron la vez anterior).
// Si una página falla (la red o un 5xx tras los reintentos; un 3xx o 4xx; o no tiene el formato de siempre), no se
// pide nada más. Si es la de un grupo sin terminar y todos los grupos sin terminar se consultaron hace menos de 48
// horas, es un aviso y se sigue con lo guardado; si no, un Error, sin escribir nada. Si es otra (completar o repasar
// un grupo terminado, o una clasificación), solo un aviso: el calendario no depende de ellas.
// ahora: Date de pared. esperas, pausa y plazo se pueden cambiar en las pruebas.
export async function actualizarFederacion({
  cfg, ids, ruta, anio, ahora, guardar = true, esperas = ESPERAS_GRUPOS, pausa = PAUSA_MS, plazo = PLAZO_MS,
}) {
  const config = gruposConfig(cfg);
  const { cache, anterior } = leerCopia(ruta, anio, ids);
  const antes = sinConsulta(cache);
  const consultaAntes = new Map(Object.entries(cache.grupos).map(([t, g]) => [t, txt(g.consultado)]));
  olvidarCompeticiones(cache, config);
  for (const c of config) {
    cache.grupos[c.grupo] ??= grupoNuevo(c.competicion);
    cache.grupos[c.grupo].id_competicion = c.competicion;
  }
  // Los nombres de los equipos del club que ya se conocen valen si en alguna fila faltara el escudo.
  const conocidos = new Set(Object.values(cache.grupos).flatMap((g) => comoLista(g.equipos ?? [])).map(clave));
  const esNuestro = (nombre, club) => ids.has(txt(club)) || conocidos.has(clave(nombre));
  // «grupo 3941 (DOMPAVOLEI XF1)», para los mensajes: con el equipo de config.json o los del club en el grupo.
  const equipoConfig = new Map(config.map((c) => [c.grupo, c.equipo]));
  const nombreGrupo = (t) => {
    const equipo = equipoConfig.get(t) || comoLista(cache.grupos[t]?.equipos ?? []).join(', ');
    return `grupo ${t}${equipo ? ` (${equipo})` : ''}`;
  };

  // Colas: los grupos sin terminar, primero los de config.json; luego, los terminados que hay que completar y, al
  // final, los de las competiciones acabadas en las que hay que mirar si hay fases nuevas.
  const cola = [];
  const completar = [];
  const hechos = new Set();
  const poner = (t) => { if (!hechos.has(t) && !cola.includes(t)) cola.push(t); };
  for (const t of [...config.map((c) => c.grupo), ...Object.keys(cache.grupos)]) {
    const g = cache.grupos[t];
    if (!g.terminado) poner(t);
    else if (copiaVieja(g) && !completar.includes(t)) completar.push(t);
  }
  const repasar = gruposARepasar(cache, ahora, completar);
  const siguiente = () => {
    for (const [lista, clase] of [[cola, 'activo'], [completar, 'completar'], [repasar, 'repasar']]) {
      if (lista.length) return [lista.shift(), clase];
    }
    return [null, ''];
  };

  // Cada petición, al menos «pausa» ms después de que acabara la anterior; ninguna empieza pasado el plazo.
  const inicio = Date.now();
  let ultima = -Infinity;
  const pedir = async (archivo, t) => {
    const cuando = Math.max(Date.now(), ultima + pausa);
    if (cuando - inicio > plazo) {
      const motivo = 'la federación tarda demasiado: se deja para la próxima ejecución';
      throw Object.assign(new Error(motivo), { motivo });
    }
    if (cuando > Date.now()) await esperar(cuando - Date.now());
    try {
      return await peticion(pagina(archivo, t, cache.grupos[t].id_competicion), null, { esperas });
    } finally {
      ultima = Date.now();
    }
  };
  // Un paso que puede fallar por la federación: devuelve null si va bien y, si no, { que, motivo, estado, definitivo }
  // (definitivo: no existe, 404, o no tiene el formato de siempre; volver a pedirla no va a servir). Los errores del
  // propio programa (TypeError...) no se disfrazan de fallo de la federación.
  const intentar = async (que, accion) => {
    try {
      await accion();
      return null;
    } catch (e) {
      if (e.name !== 'Error') throw e;
      const estado = e.estado ?? 0;
      return { que, motivo: e.motivo ?? txt(e.message).split('\n')[0], estado, definitivo: estado === 404 || Boolean(e.formato) };
    }
  };

  let fallo = null;
  const bajados = [];
  while (!fallo) {
    const [t, clase] = siguiente();
    if (!t) break;
    if (hechos.has(t)) continue;
    hechos.add(t);
    const g = cache.grupos[t];
    let html = '';
    let filas = [];
    fallo = await intentar(`el ${nombreGrupo(t)}`, async () => {
      html = await pedir('competicion_completa.php', t);
      filas = leerPagina(html, !comoLista(g.partidos ?? []).length);
    });
    if (fallo) {
      Object.assign(fallo, { t, clase });
      break;
    }
    const competicion = nombreCompeticion(html);
    const lista = leerGrupos(html) ?? [];
    g.competicion = competicion;
    anotarGrupos(cache, competicion, g.id_competicion, lista, esNuestro);
    anotarResultados(g, filas, esNuestro, ahora);
    // Nombre y equipos del club: de la lista de grupos si sale en ella; si no, del <select> y de sus partidos (sin
    // ninguna de las dos cosas, una fase aún sin calendario, los que ya se sabían).
    const listado = lista.find((gr) => gr.torneo === t);
    g.nombre = listado?.nombre || opciones(html, 'torneos').find((o) => o.elegida)?.nombre || g.nombre;
    const delClub = [
      ...(listado?.equipos ?? []).filter((e) => esNuestro(e.nombre, e.club)).map((e) => e.nombre),
      ...g.partidos.flatMap((p) => [esNuestro(p.local, p.clubLocal) ? p.local : '', esNuestro(p.visitante, p.clubVisitante) ? p.visitante : '']),
    ];
    if (listado || g.partidos.length) g.equipos = [...new Set(delClub.filter((n) => n))].sort();
    for (const n of g.equipos) conocidos.add(clave(n));
    const torneos = opciones(html, 'torneos').map((o) => o.id).filter((id) => id);
    cache.competiciones[competicion] = {
      id: g.id_competicion, torneos: torneos.length ? torneos : lista.map((gr) => gr.torneo), revisado: txt(cache.competiciones[competicion]?.revisado),
    };
    // Fases nuevas en las que juega el club (anotarGrupos las acaba de apuntar): en esta misma ejecución.
    for (const [otro, go] of Object.entries(cache.grupos)) if (!go.consultado) poner(otro);
    if (!filas.length) aviso(`El ${nombreGrupo(t)} aún no tiene partidos en la federación: se vuelve a mirar en la próxima ejecución.`);
    const sinDia = g.partidos.filter((p) => !p.dia).length;
    if (sinDia) {
      const uno = sinDia === 1;
      aviso(`${uno ? 'Un partido' : `${sinDia} partidos`} del club en el ${nombreGrupo(t)} no ${uno ? 'tiene' : 'tienen'} fecha en la `
        + `federación: no ${uno ? 'sale' : 'salen'} en el calendario hasta que la ${uno ? 'tenga' : 'tengan'}.`);
    }
    bajados.push(t);
  }

  if (fallo?.clase === 'activo') {
    const viejos = Object.keys(cache.grupos)
      .filter((t) => !cache.grupos[t].terminado && horasDesde(cache.grupos[t].consultado, ahora) >= HORAS_COPIA);
    if (viejos.length) {
      throw new Error(`No se pudo actualizar ${fallo.que} desde la federación (${fallo.motivo}).\n    No hay una copia de `
        + `menos de ${HORAS_COPIA} horas de: ${viejos.map((t) => `el ${nombreGrupo(t)}`).join(', ')}. No se ha cambiado ningún archivo.`
        + comoQuitarlas(viejos.filter((t) => !equipoConfig.has(t) && consultaAntes.get(t))));
    }
    aviso(`No se pudo actualizar ${fallo.que} desde la federación (${fallo.motivo}). Hasta la próxima ejecución se usa lo `
      + `guardado, de hace menos de ${HORAS_COPIA} horas.`);
  } else if (fallo?.clase === 'completar') {
    // Si su página ya no existe o no se entiende, se queda como está, sin pabellón, y no se vuelve a pedir.
    const g = cache.grupos[fallo.t];
    if (fallo.definitivo) g.partidos = comoLista(g.partidos ?? []).filter(esObjeto).map((p) => ({ ...p, campo: txt(p.campo) }));
    aviso(`No se pudo completar ${fallo.que}, ya terminado, con la página de la federación (${fallo.motivo}): se usan sus `
      + `partidos guardados, sin pabellón${fallo.definitivo ? ', y no se vuelve a pedir' : ''}.`);
  } else if (fallo) {
    aviso(`No se pudo mirar en la página del ${nombreGrupo(fallo.t)} si hay fases nuevas de ${cache.grupos[fallo.t].competicion} `
      + `(${fallo.motivo}): se vuelve a mirar mañana.`);
  }

  // Al final, si no ha fallado ninguna página, las clasificaciones que falten: las de los grupos cuyos partidos han
  // cambiado, también las que fallaron otra vez (la final de un grupo que ya terminó, por ejemplo). Son lo de menos:
  // si falla una, se avisa, se enseña la guardada y no se pide nada más.
  if (!fallo) {
    for (const t of new Set([...bajados, ...Object.keys(cache.grupos)])) {
      const g = cache.grupos[t];
      if (g.firma_clasificacion === g.firma) continue;
      fallo = await intentar(`la clasificación del ${nombreGrupo(t)}`, async () => {
        g.clasificacion = leerClasificacion(await pedir('clasificacion.php', t));
        g.firma_clasificacion = g.firma;
      });
      if (!fallo) continue;
      // 404: el grupo no tiene página de clasificación; no se vuelve a pedir hasta que cambien sus partidos.
      if (fallo.estado === 404) g.firma_clasificacion = g.firma;
      aviso(`No se pudo actualizar ${fallo.que} desde la federación (${fallo.motivo}): se enseña la guardada y `
        + `${fallo.estado === 404 ? 'no se vuelve a pedir hasta que cambien sus partidos' : 'se vuelve a pedir en la próxima ejecución'}.`);
      break;
    }
  }

  // Competiciones en las que el club ya no tiene grupos sin terminar y de las que se ha pedido (o intentado pedir) una
  // página: su lista de grupos ya está mirada; la próxima vez, dentro de HORAS_REPASO (gruposARepasar).
  for (const grupos of porCompeticion(cache).values()) {
    const c = cache.competiciones[grupos[0][1].competicion];
    if (c && grupos.every(([, g]) => g.terminado) && grupos.some(([t]) => hechos.has(t))) c.revisado = marca(ahora);
  }
  for (const c of config) {
    const g = cache.grupos[c.grupo];
    // Sin firma, su página aún no tiene partidos (ya avisado): no es que el club no juegue en él.
    if (g.consultado && g.firma && !comoLista(g.partidos ?? []).length) {
      aviso(`En el ${nombreGrupo(c.grupo)} de config.json no hay ningún partido del club: revisa federacion.grupos en config.json.`);
    }
  }
  const cambia = sinConsulta(cache) !== antes || Object.entries(cache.grupos)
    .some(([t, g]) => g.consultado !== (consultaAntes.get(t) ?? '') && horasDesde(consultaAntes.get(t), ahora) >= HORAS_GUARDAR);
  if (guardar && cambia) {
    try {
      guardarCacheResultados(cache, ruta);
    } catch (e) {
      aviso(`No se pudo guardar resultados.json: ${e.message}`);
    }
  }
  return { cache, filas: filasDeCache(cache, ids), lugares: lugaresDeCache(cache), anterior, fallo };
}
