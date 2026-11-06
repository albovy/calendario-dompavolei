// Genera el calendario de partidos de un club de voleibol gallego (todas sus categorías).
//
// Lee los partidos de las páginas de los grupos de la Federación Galega de Voleibol en los que juega el
// club (plataforma iSquad, las mismas que enseña volei.gal; se apuntan en config.json › federacion.grupos,
// ver federacion.js), se queda solo con los equipos del club y genera, en la carpeta de salida:
//
//   - <nombre>.ics   Calendario para Google Calendar, Outlook, iPhone o Android.
//   - <nombre>.html  Página con los partidos (lista, vista mensual y clasificaciones), imprimible.
//   - manifest.webmanifest, sw.js e iconos/  Para instalar la página como app en el móvil (solo si hay
//                    iconos junto a config.json: ver prepararApp).
//   - <nombre>.xlsx  Hoja de Excel con los partidos.
//   - equipos/*.ics  Un calendario por cada equipo del club (para entrenadores y familias).
//
// Solo incluye los partidos que publica la federación gallega: en ligas nacionales faltan los
// partidos contra equipos de fuera de Galicia. Es la traducción de calendario-voley.ps1, sin
// preguntas (para GitHub Actions):
//
//   node src/main.js [--club X] [--temporada 2026-27] [--desde aaaa-mm-dd] [--hasta aaaa-mm-dd]
//                    [--salida carpeta] [--nombre-base nombre] [--duracion-minutos N]
//                    [--historial ruta] [--sin-equipos] [--listar-clubs] [--config ruta]
//
//   --club              Club a usar en lugar del de config.json: el ID de iSquad (p. ej. 206572577),
//                       parte del nombre (p. ej. "pontevedra") o varios separados por comas. Por el
//                       nombre solo se encuentran los clubs que juegan con el de config.json, y de
//                       cualquier club solo salen sus partidos de los grupos de config.json.
//   --temporada         Temporada, p. ej. "2026-27": solo vale la temporada en curso (del 1 de agosto al
//                       31 de julio), que es la de por defecto; si aún no hay partidos del club en ella,
//                       antes de octubre se genera la anterior. La federación ya no deja descargar su
//                       agenda: las páginas de los grupos son las de la temporada en curso.
//   --desde, --hasta    Fechas (aaaa-mm-dd) dentro de la temporada en curso. Por defecto, 1/8 y 31/7.
//   --salida            Carpeta de los archivos. Por defecto, "calendario" en la carpeta actual.
//   --nombre-base       Nombre de los archivos (sin extensión). Por defecto, el club y la temporada.
//   --duracion-minutos  Duración de cada partido en el calendario (por defecto, la de config.json o 120).
//   --historial         Archivo de texto donde guardar la lista de partidos sin fecha de generación,
//                       para detectar cambios (lo usa la publicación automática en GitHub).
//   --sin-equipos       No genera los calendarios por equipo.
//   --listar-clubs      Muestra con su ID los clubs que juegan con el de config.json en sus grupos (y los
//                       del listado oficial de la federación) y termina.
//   --config            config.json a usar (o su carpeta); pabellones.json y resultados.json se guardan
//                       junto a él, y el escudo del club (escudo.png, para la página) se busca ahí.
//                       Por defecto, los de la carpeta actual.
//
// Si algo falla, escribe "  ERROR: ..." y termina con código 1. Un fallo del propio programa (TypeError...)
// deja además la pila en stderr; con la variable de entorno CALENDARIO_DETALLE=1, cualquier error
// (como -Verbose en el .ps1).

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { partidosDemo } from './demo.js';
import { PAUSA_MS, actualizarFederacion } from './federacion.js';
import { crearHistorial } from './historial.js';
import { crearHtml } from './html.js';
import { crearIcs } from './ics.js';
import { prepararInstagram } from './instagram.js';
import { buscarClubs, catalogoClubs, clubsFederacion, fechaCruda } from './isquad.js';
import { aplicarManuales, configEdicion, leerManuales } from './manuales.js';
import { conHora, convertirPartidos, equipos as equiposDelClub } from './partidos.js';
import { anadirResultados, clasificaciones } from './resultados.js';
import { anadirSalidas, configPedirBus, configSalidas, resolverPabellones, textoSalida } from './salidas.js';
import {
  ahoraMadrid, anioTemporada, aviso, comoLista, esObjeto, esperar, fechaCorta, fechaPared, fechaValida, fmt, leerJson,
  minusculas, ordenarUnicos, paso, prefijoComun, slug, soloDia, txt,
} from './util.js';
import { crearXlsx } from './xlsx.js';

const USO = 'node src/main.js [--club X] [--temporada 2026-27] [--desde aaaa-mm-dd] [--hasta aaaa-mm-dd] '
  + '[--salida carpeta] [--nombre-base nombre] [--duracion-minutos N] [--historial ruta] [--sin-equipos] '
  + '[--listar-clubs] [--config ruta]';

// --- Opciones y config.json ----------------------------------------------------------------------

export function leerOpciones(args) {
  let valores;
  try {
    ({ values: valores } = parseArgs({
      args,
      options: {
        club: { type: 'string' },
        temporada: { type: 'string' },
        desde: { type: 'string' },
        hasta: { type: 'string' },
        salida: { type: 'string' },
        'nombre-base': { type: 'string' },
        'duracion-minutos': { type: 'string' },
        historial: { type: 'string' },
        'sin-equipos': { type: 'boolean' },
        'listar-clubs': { type: 'boolean' },
        config: { type: 'string' },
      },
    }));
  } catch (e) {
    // Los mensajes de parseArgs vienen en inglés: se añade cómo se usa.
    throw new Error(`Opciones no válidas (${e.message})\n    Uso: ${USO}`);
  }
  let duracionMinutos = 0;
  const duracion = valores['duracion-minutos'];
  if (duracion !== undefined) {
    duracionMinutos = Number(duracion);
    if (!duracion.trim() || !Number.isInteger(duracionMinutos) || duracionMinutos < 0 || duracionMinutos > 600) {
      throw new Error(`--duracion-minutos tiene que ser un número entero de 0 a 600 (no «${duracion}»).`);
    }
  }
  return {
    club: valores.club ?? '',
    temporada: valores.temporada ?? '',
    desde: valores.desde ?? '',
    hasta: valores.hasta ?? '',
    salida: valores.salida ?? '',
    nombreBase: valores['nombre-base'] ?? '',
    duracionMinutos,
    historial: valores.historial ?? '',
    sinEquipos: Boolean(valores['sin-equipos']),
    listarClubs: Boolean(valores['listar-clubs']),
    config: valores.config ?? '',
  };
}

// config.json, pabellones.json, temporada-anterior.json, resultados.json y escudo.png van juntos: en la
// carpeta actual o en la de --config.
export function rutasConfig(ruta) {
  let config = resolve('config.json');
  if (ruta) {
    config = existsSync(ruta) && statSync(ruta).isDirectory() ? join(resolve(ruta), 'config.json') : resolve(ruta);
  }
  return {
    config,
    pabellones: join(dirname(config), 'pabellones.json'),
    temporadaAnterior: join(dirname(config), 'temporada-anterior.json'),
    resultados: join(dirname(config), 'resultados.json'),
    manuales: join(dirname(config), 'salidas-manuales.json'),
    escudo: join(dirname(config), 'escudo.png'),
    iconos: join(dirname(config), 'iconos'),
  };
}

// --- App instalable -------------------------------------------------------------------------------------

// Los iconos de la app, en la carpeta iconos/ junto a config.json: [archivo, tamaño, uso]. 192 y 512 son
// imprescindibles (sin ellos no se instala); los «maskable» los recorta Android a su forma (el escudo, en el
// círculo central del 80 %). apple-touch-icon.png (180 x 180) es el de la pantalla de inicio del iPhone.
const ICONOS_APP = [
  ['192.png', '192x192', 'any'], ['512.png', '512x512', 'any'],
  ['maskable-192.png', '192x192', 'maskable'], ['maskable-512.png', '512x512', 'maskable'],
];
const ICONO_IPHONE = 'apple-touch-icon.png';
const SERVICE_WORKER = fileURLToPath(new URL('./sw.js', import.meta.url));

// El nombre bajo el icono (hasta 12 letras, para que no se corte): el del club con mayúscula inicial
// («DOMPAVOLEI» -> «Dompavolei»), o el nombre corto, o «Calendario».
export function nombreApp(nombreClub, nombreCorto) {
  const bonito = (t) => txt(t).trim().toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
  return [bonito(nombreClub), bonito(nombreCorto)].find((n) => n && n.length <= 12) ?? 'Calendario';
}

// Si hay iconos junto a config.json, deja junto a la página lo que hace falta para instalarla como app:
// manifest.webmanifest, los iconos (iconos/) y el service worker (sw.js, siempre el mismo: que no cambie
// entre publicaciones). Devuelve { nombre, appleIcono } para crearHtml, o null si no hay iconos.
export function prepararApp({ carpetaIconos, carpetaSalida, nombreClub, nombreCorto, urlPublicada }) {
  if (!ICONOS_APP.slice(0, 2).every(([f]) => existsSync(join(carpetaIconos, f)))) return null;
  const presentes = [...ICONOS_APP.map(([f]) => f), ICONO_IPHONE].filter((f) => existsSync(join(carpetaIconos, f)));
  mkdirSync(join(carpetaSalida, 'iconos'), { recursive: true });
  for (const f of presentes) copyFileSync(join(carpetaIconos, f), join(carpetaSalida, 'iconos', f));
  const nombre = nombreApp(nombreClub, nombreCorto);
  // id: la carpeta de la web (p. ej. /calendario-dompavolei/), para que no se confunda con otra app del
  // mismo dominio; sin dirección publicada se deja sin id (el navegador usa start_url).
  let id = null;
  try {
    const u = new URL(txt(urlPublicada));
    if (/^https?:$/.test(u.protocol)) id = u.pathname.replace(/[^/]*$/, '');
  } catch { /* sin dirección publicada */ }
  const bonitoClub = txt(nombreClub).trim().toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
  const manifiesto = {
    ...(id ? { id } : {}),
    name: `Calendario ${bonitoClub || nombre}`,
    short_name: nombre,
    description: `Partidos, salidas, resultados y clasificaciones de ${txt(nombreClub)}.`,
    lang: 'es', dir: 'ltr', start_url: './', scope: './', display: 'standalone',
    background_color: '#FFFFFF', theme_color: '#FFFFFF',
    icons: ICONOS_APP.filter(([f]) => presentes.includes(f))
      .map(([f, sizes, purpose]) => ({ src: `iconos/${f}`, sizes, type: 'image/png', purpose })),
  };
  writeFileSync(join(carpetaSalida, 'manifest.webmanifest'), `${JSON.stringify(manifiesto, null, 2)}\n`, 'utf8');
  copyFileSync(SERVICE_WORKER, join(carpetaSalida, 'sw.js'));
  return { nombre, appleIcono: presentes.includes(ICONO_IPHONE) };
}

// Como las propiedades de ConvertFrom-Json, los nombres de config.json no distinguen mayúsculas
// ("Salidas", "ID"...): se pasan a minúsculas. Los de dentro de tiempos_viaje_minutos son nombres de
// pabellón (salen en los avisos) y se quedan como están. Dos nombres iguales salvo en las mayúsculas
// son un error, también en ConvertFrom-Json.
function nombresEnMinusculas(valor, sonPabellones = false) {
  if (Array.isArray(valor)) return valor.map((x) => nombresEnMinusculas(x));
  if (!esObjeto(valor)) return valor;
  const vistos = new Map();
  const entradas = Object.entries(valor).map(([nombre, x]) => {
    const minuscula = minusculas(nombre);
    if (vistos.has(minuscula)) throw new Error(`los nombres «${vistos.get(minuscula)}» y «${nombre}» están repetidos`);
    vistos.set(minuscula, nombre);
    return [sonPabellones ? nombre : minuscula, nombresEnMinusculas(x, minuscula === 'tiempos_viaje_minutos')];
  });
  // fromEntries: así también vale un nombre como "__proto__".
  return Object.fromEntries(entradas);
}

export function leerConfig(ruta) {
  if (!existsSync(ruta)) return null;
  try {
    return nombresEnMinusculas(leerJson(readFileSync(ruta, 'utf8')));
  } catch (e) {
    aviso(`config.json no se puede leer (${e.message}); se ignora.`);
    return null;
  }
}

// Como [int]::TryParse: un entero con signo opcional y espacios alrededor.
function leerEntero(valor) {
  const m = /^[\t-\r ]*([+-]?\d+)[\t-\r ]*$/.exec(txt(valor));
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) && Math.abs(n) <= 2147483647 ? n : null;
}

export function duracionConfig(cfg) {
  const n = leerEntero(cfg?.duracion_minutos);
  if (n !== null && n > 0 && n <= 600) return n;
  if (cfg?.duracion_minutos) aviso('duracion_minutos de config.json no es un número válido; se usan 120 minutos.');
  return 120;
}

// --- Temporada y fechas ------------------------------------------------------------------------

// Como TryParseExact con 'yyyy-MM-dd', 'dd/MM/yyyy' o 'd/M/yyyy'. Devuelve un Date de pared.
export function fechaParametro(valor, nombre) {
  const t = valor.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const europea = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  let fecha = null;
  if (iso) fecha = fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  else if (europea) fecha = fechaValida(Number(europea[3]), Number(europea[2]), Number(europea[1]));
  if (fecha) return fecha;
  throw new Error(`Fecha «${nombre}» no válida: «${valor}». Usa el formato aaaa-mm-dd.`);
}

export function nuevoRango(anio) {
  return {
    anio,
    inicio: fechaPared(anio, 8, 1),
    fin: fechaPared(anio + 1, 7, 31),
    etiqueta: `${anio}/${String((anio + 1) % 100).padStart(2, '0')}`,
    parcial: false,
    explicito: false,
  };
}

// Temporada y fechas pedidas (--temporada, --desde, --hasta). hoy: Date de pared.
export function rangoTemporada(opciones, hoy) {
  const { temporada, desde, hasta } = opciones;
  const dDesde = desde ? fechaParametro(desde, 'Desde') : null;
  const dHasta = hasta ? fechaParametro(hasta, 'Hasta') : null;
  let anio;
  if (temporada) {
    const m = /^\s*(\d{4})\s*(?:[-/]\s*(\d{2}|\d{4}))?\s*$/.exec(temporada);
    if (!m) throw new Error(`Temporada no válida: «${temporada}». Usa el formato 2026-27.`);
    anio = Number(m[1]);
    if (m[2] && Number(m[2]) % 100 !== (anio + 1) % 100) {
      throw new Error(`Temporada no válida: «${temporada}». El segundo año tiene que ser el siguiente (p. ej. 2026-27).`);
    }
    if (anio < 2000 || anio > 2100) throw new Error(`Temporada no válida: «${temporada}».`);
  } else if (dDesde) {
    anio = anioTemporada(dDesde);
  } else if (dHasta) {
    anio = anioTemporada(dHasta);
  } else {
    anio = anioTemporada(hoy);
  }

  const rango = nuevoRango(anio);
  rango.explicito = Boolean(temporada || desde || hasta);
  const { inicio: temporadaIni, fin: temporadaFin } = rango;
  if (dDesde) { rango.inicio = dDesde; rango.parcial = true; }
  if (dHasta) { rango.fin = dHasta; rango.parcial = true; }
  if (rango.inicio < temporadaIni || rango.fin > temporadaFin) {
    throw new Error(`Las fechas tienen que estar dentro de la temporada ${rango.etiqueta} `
      + `(del ${fmt(temporadaIni, 'dd/MM/yyyy')} al ${fmt(temporadaFin, 'dd/MM/yyyy')}).`);
  }
  if (rango.fin < rango.inicio) {
    throw new Error(`La fecha final (${fmt(rango.fin, 'dd/MM/yyyy')}) es anterior a la inicial (${fmt(rango.inicio, 'dd/MM/yyyy')}).`);
  }
  return rango;
}

// Desde el 06/11/2026 la federación no deja descargar su agenda: los partidos salen de las páginas de los grupos
// de config.json, que son los de la temporada en curso. Otra temporada (--temporada, --desde, --hasta) no se
// puede generar. hoy: Date de pared.
function soloTemporadaEnCurso(rango, hoy) {
  const actual = anioTemporada(hoy);
  if (rango.anio === actual) return;
  throw new Error(`La temporada ${rango.etiqueta} no se puede generar: la federación ya no deja descargar su agenda y los `
    + `partidos salen de las páginas de los grupos de la temporada en curso (${nuevoRango(actual).etiqueta}). --temporada, `
    + '--desde y --hasta solo valen dentro de ella.');
}

// --- Clubs -------------------------------------------------------------------------------------

export function mostrarCatalogo(lista, temporada) {
  console.log('');
  console.log(`   Nº  ${'Club'.padEnd(34)} ${'Partidos'.padEnd(9)} ${'ID'.padEnd(10)} Nombre oficial`);
  lista.forEach((c, i) => {
    const n = c.partidos > 0 ? String(c.partidos) : '-';
    console.log(`  ${String(i + 1).padStart(3)}  ${c.nombre.padEnd(34)} ${n.padStart(8)}  ${c.id.padEnd(10)} ${c.oficial}`);
  });
  console.log(`  (Partidos = partidos de la temporada ${temporada} en los grupos de config.json en los que juega su club)`);
  console.log('');
}

// Los clubs de config.json: [{ id, nombre[, corto] }] (sin ID no cuentan).
function clubsConfig(cfg) {
  return comoLista(cfg?.clubs ?? [])
    .filter((c) => c?.id)
    .map((c) => ({
      id: txt(c.id), nombre: c.nombre ? txt(c.nombre) : `Club ${c.id}`,
      ...(txt(c.nombre_corto).trim() ? { corto: txt(c.nombre_corto).trim() } : {}),
    }));
}

// Los trozos de --club (separados por comas o puntos y coma) y si uno es un ID de club de iSquad.
function trozosClub(textoClub) { return txt(textoClub).split(/[,;]/).map((t) => t.trim()).filter((t) => t); }
function esIdClub(trozo) { return /^\d{5,}$/.test(trozo); }

function mismosClubs(a, b) { return a.size === b.size && [...a].every((id) => b.has(id)); }

// Devuelve los clubs ({ id, nombre[, corto] }) a usar: los de --club o, si no, los de config.json. En --club, un ID
// vale tal cual y un nombre se busca entre los clubs de «filas» (las de los grupos de config.json: la federación ya
// no deja descargar su agenda, que tenía todos los de Galicia). Un ID que sale en filas lleva el nombre de sus equipos.
export function resolverClubs(textoClub, filas, cfg) {
  if (textoClub) {
    const catalogo = catalogoClubs(filas, filas);
    const elegidos = [];
    for (const t of trozosClub(textoClub)) {
      if (esIdClub(t)) {
        elegidos.push(catalogo.find((c) => c.id === t) ?? { id: t, nombre: `Club ${t}` });
        continue;
      }
      const encontrados = buscarClubs(catalogo, t);
      if (encontrados.length === 0) {
        throw new Error(`Ningún club ni equipo de los grupos de config.json coincide con «${t}». Usa --listar-clubs para ver `
          + 'los clubs que salen en ellos, o indica el ID del club.');
      }
      if (encontrados.length > 1) {
        const nombres = encontrados.map((c) => `    ${c.id}  ${c.nombre}`).join('\n');
        throw new Error(`Hay varios clubs que coinciden con «${t}»; indica el ID:\n${nombres}`);
      }
      elegidos.push(encontrados[0]);
    }
    // Como Sort-Object Id -Unique: ordenados por ID y sin repetir.
    return ordenarUnicos(elegidos, (c) => c.id);
  }

  const lista = clubsConfig(cfg);
  if (lista.length) return lista;
  throw new Error('No hay ningún club configurado en config.json. Indica el club con --club y su ID.');
}

// --- Temporada anterior ------------------------------------------------------------------------
//
// De la temporada anterior solo hacen falta los partidos del club: para que cada equipo tenga su
// calendario aunque todavía no juegue y para no quedarse vacío en agosto. Ya no cambian, así que se
// guardan una sola vez en temporada-anterior.json, al cambiar de temporada: son los que tenía
// resultados.json (la federación ya no deja descargar su agenda, y las páginas de los grupos de
// config.json son las de la temporada en curso).

const CAMPOS_GUARDADOS = ['id_club_local', 'id_club_visitante', 'nombre_local', 'nombre_visitante', 'nombre_competicion',
  'campo', 'categoria', 'fecha', 'fecha_confirmada', 'fecha_calendario'];

// Una fila de la federación con solo lo que se usa; sin el escudo (<img>), que es lo que más ocupa.
function filaGuardada(r) {
  const fila = {};
  for (const k of CAMPOS_GUARDADOS) {
    const v = r[k];
    fila[k] = typeof v === 'string' ? v.replace(/<img\b[^>]*>/gi, '').replace(/\s+/g, ' ').trim() : (v ?? null);
  }
  return fila;
}

// Filas crudas de los partidos del club en la temporada anterior a la de "rango", sin red: las de
// temporada-anterior.json si es de esa temporada y de estos clubs; si no, las de «anterior» (las que tenía
// resultados.json cuando aún era de esa temporada, ver actualizarFederacion), que se guardan en
// temporada-anterior.json si guardar (false con otro club en --club: la copia es la del de config.json).
// Si no hay ninguna, aviso y se sigue sin ella.
export function temporadaAnterior({ rango, ids, ruta, guardar, anterior = [] }) {
  const anio = rango.anio - 1;
  const etiqueta = nuevoRango(anio).etiqueta;
  const clubs = [...ids].sort().join(',');
  if (existsSync(ruta)) {
    try {
      const copia = leerJson(readFileSync(ruta, 'utf8'));
      if (copia?.anio === anio && comoLista(copia.clubs).map(txt).sort().join(',') === clubs && Array.isArray(copia.partidos)) {
        return copia.partidos;
      }
    } catch (e) {
      aviso(`${basename(ruta)} no se puede leer (${e.message}); se ignora.`);
    }
  }

  const ini = fmt(fechaPared(anio, 8, 1), 'yyyy-MM-dd');
  const fin = fmt(fechaPared(anio + 1, 7, 31), 'yyyy-MM-dd');
  const partidos = anterior
    .filter((r) => {
      const f = fechaCruda(r);
      return f && f >= ini && f <= fin && (ids.has(txt(r.id_club_local)) || ids.has(txt(r.id_club_visitante)));
    })
    .map(filaGuardada);
  if (!partidos.length) {
    aviso(`No hay partidos guardados del club de la temporada ${etiqueta} (${basename(ruta)}): se sigue sin ella.`);
    return [];
  }
  if (guardar) {
    paso(`Se guardan los partidos de la temporada ${etiqueta} en ${basename(ruta)}.`);
    const copia = { temporada: etiqueta, anio, clubs: [...ids].sort(), partidos };
    writeFileSync(ruta, `${JSON.stringify(copia, null, 1)}\n`, 'utf8');
  }
  return partidos;
}

// --- Programa principal ------------------------------------------------------------------------

// Una línea de "Próximos partidos" del resumen: día, hora, salida, categoría y equipos.
function lineaProximo(p, salidas) {
  const hora = conHora(p) ? fmt(p.fecha, 'HH:mm') : '--:--';
  let sal = '';
  if (salidas) {
    const t = textoSalida(p);
    if (p.salida) sal = `salida ${t}`;
    else sal = p.enCasa ? 'en casa' : minusculas(t);
  }
  return `  ${fechaCorta(p.fecha).padEnd(10)} ${hora.padEnd(6)} ${sal.padEnd(13)} ${p.categoria.padEnd(12)} ${p.local} - ${p.visitante}`;
}

// ¿Es de la temporada de "rango" esta fila (como las de la agenda)?
function deLaTemporada(fila, rango) {
  const f = fechaCruda(fila);
  return Boolean(f) && f >= fmt(fechaPared(rango.anio, 8, 1), 'yyyy-MM-dd') && f <= fmt(fechaPared(rango.anio + 1, 7, 31), 'yyyy-MM-dd');
}

export async function principal(args, ahora = new Date()) {
  const opciones = leerOpciones(args);
  // "pared" (hora de Galicia) para los textos y la temporada; "utc" para las marcas del .ics.
  const generado = { pared: ahoraMadrid(ahora), utc: ahora };
  let rango = rangoTemporada(opciones, generado.pared);
  soloTemporadaEnCurso(rango, generado.pared);
  const rutas = rutasConfig(opciones.config);
  const cfg = leerConfig(rutas.config);

  console.log('');
  console.log(`  CALENDARIO DE VOLEIBOL · temporada ${rango.etiqueta}`);
  paso('Descargando los partidos de las páginas de los grupos de la federación...');
  // Los partidos salen de las páginas de los grupos de config.json, y de ellas se guardan solo los del club que se
  // pida (resultados.json es la copia de los del club de config.json). Un nombre de --club (y --listar-clubs) se busca
  // entre los clubs que juegan con el de config.json, así que antes hacen falta sus partidos: esa descarga no guarda
  // nada (las copias las pone al día la ejecución normal; así tampoco se pierde un cambio de temporada). Si en ella
  // falla la federación, no se le pide nada más en esta ejecución.
  const clubsCfg = clubsConfig(cfg);
  const idsCfg = new Set(clubsCfg.map((c) => c.id));
  const actualizar = (idsClubs, guardar) => actualizarFederacion({
    cfg, ids: idsClubs, ruta: rutas.resultados, anio: rango.anio, ahora: generado.pared, guardar,
  });

  if (opciones.listarClubs) {
    let filasCfg = [];
    let fallo = null;
    if (idsCfg.size) ({ filas: filasCfg, fallo } = await actualizar(idsCfg, false));
    let oficiales = new Map();
    if (fallo) {
      aviso('No se descarga el listado oficial de clubs: la federación ha fallado en esta ejecución.');
    } else {
      if (idsCfg.size) await esperar(PAUSA_MS);   // al menos 1,5 s entre dos peticiones a la federación
      oficiales = await clubsFederacion();
    }
    mostrarCatalogo(catalogoClubs(filasCfg.filter((r) => deLaTemporada(r, rango)), filasCfg, oficiales), rango.etiqueta);
    aviso('Solo salen los partidos y los equipos de los grupos de config.json (federacion.grupos) en los que juega su club: '
      + 'la federación ya no deja descargar su agenda. Los demás clubs, sin partidos, son los del listado oficial.');
    return;
  }

  const porNombre = trozosClub(opciones.club).some((t) => !esIdClub(t));
  let datos = null;
  if (porNombre) {
    if (!idsCfg.size) {
      throw new Error('No hay ningún club configurado en config.json: --club tiene que ser el ID del club (un número, p. ej. '
        + '206572580). Por el nombre solo se encuentran los clubs que juegan con el de config.json en sus grupos.');
    }
    datos = await actualizar(idsCfg, false);
  }
  let clubs = resolverClubs(opciones.club, datos?.filas ?? [], cfg);
  if (!clubs.length) throw new Error('No se ha elegido ningún club.');
  const ids = new Set(clubs.map((c) => txt(c.id)));
  // resultados.json y temporada-anterior.json son del club de config.json: con otro (--club), no se tocan.
  const guardar = mismosClubs(ids, idsCfg) || !idsCfg.size;
  if (!datos || !mismosClubs(ids, idsCfg)) {
    if (datos?.fallo) {
      throw new Error(`No se puede generar el calendario de ${clubs.map((c) => c.nombre).join(' + ')}: la federación ha fallado en `
        + `esta ejecución (${datos.fallo.motivo}) y de otro club no hay copia. Vuelve a intentarlo más tarde. No se ha cambiado ningún archivo.`);
    }
    if (datos) await esperar(PAUSA_MS);   // al menos 1,5 s entre dos peticiones a la federación
    datos = await actualizar(ids, guardar);
    // Con --club por ID, el nombre de cada club, el de sus equipos.
    if (opciones.club && !porNombre) clubs = resolverClubs(opciones.club, datos.filas, cfg);
  }
  const { cache, filas, lugares, anterior } = datos;
  const grupos = Object.keys(cache.grupos).length;
  paso(`${filas.filter((r) => deLaTemporada(r, rango)).length} partidos del club en ${grupos} ${grupos === 1 ? 'grupo' : 'grupos'} `
    + `de la federación (temporada ${rango.etiqueta}).`);
  const nombreClub = clubs.map((c) => c.nombre).join(' + ');
  // «DOMPA INFANTIL» en la página: el nombre corto de config.json o, si no hay, el del club. Con varios clubs
  // no hay uno que valga para todos: los equipos salen como los publica la federación.
  const nombreCorto = clubs.length === 1 ? txt(clubs[0].corto || clubs[0].nombre) : '';

  // Antes de cualquier error: si resultados.json acaba de pasar a la temporada nueva, la anterior se guarda ya.
  const anteriorCrudos = temporadaAnterior({ rango, ids, ruta: rutas.temporadaAnterior, guardar, anterior });
  // De las páginas, solo los de la temporada: en agosto, los grupos de config.json aún pueden ser los de la anterior,
  // cuyos partidos ya vienen de temporada-anterior.json (si la federación cambia un nombre, saldrían dos veces).
  const crudos = [...filas.filter((r) => deLaTemporada(r, rango)), ...anteriorCrudos];

  const idsConPartidos = new Set(crudos.flatMap((r) => [txt(r.id_club_local), txt(r.id_club_visitante)]));
  for (const c of clubs) {
    if (!idsConPartidos.has(txt(c.id))) {
      aviso(`El club con ID ${c.id} (${c.nombre}) no aparece en ningún partido de esta temporada ni de la anterior. Revisa el ID en config.json (--listar-clubs muestra los clubs).`);
    }
  }

  const duracion = opciones.duracionMinutos > 0 ? opciones.duracionMinutos : duracionConfig(cfg);
  const urlPublicada = cfg?.calendario_publicado ? txt(cfg.calendario_publicado) : '';

  const todos = convertirPartidos(crudos, ids);
  // Desde octubre la temporada ya está en marcha: un club sin ningún partido en ella es un fallo (los grupos de
  // config.json, la federación...) y no se publica nada, tampoco la temporada anterior en su lugar.
  if (!todos.some((p) => p.temporada === rango.anio) && generado.pared >= fechaPared(rango.anio, 10, 1)) {
    throw new Error(`${nombreClub} no tiene ningún partido de la temporada ${rango.etiqueta} en los grupos de config.json `
      + '(federacion.grupos). Revisa que estén los de esta temporada: hay que apuntarlos al empezar cada una (ver README). '
      + 'No se publica nada.');
  }
  let partidos = todos.filter((p) => soloDia(p.fecha) >= rango.inicio && soloDia(p.fecha) <= rango.fin);
  let anteriores = todos.filter((p) => p.temporada === rango.anio - 1);
  if (!rango.explicito && partidos.length === 0 && anteriores.length > 0) {
    aviso(`Todavía no hay partidos de ${nombreClub} publicados para la temporada ${rango.etiqueta}.`);
    rango = nuevoRango(rango.anio - 1);
    paso(`Mientras tanto se genera el calendario de la temporada ${rango.etiqueta}.`);
    partidos = anteriores;
    anteriores = [];
  }
  const equipos = equiposDelClub(partidos, anteriores);

  // Horas de salida (si config.json tiene "salidas")
  const salidas = configSalidas(cfg);
  let pabellones = null;
  if (salidas && partidos.length) {
    paso(`Calculando horas de salida desde ${salidas.origen}...`);
    // Los pabellones nuevos, con el sitio que dan las páginas de los grupos (lugares).
    pabellones = await resolverPabellones(partidos, salidas, rutas.pabellones, generado.pared, { lugares });
    anadirSalidas(partidos, pabellones, salidas);
    // Las horas puestas a mano desde la web (salidas-manuales.json, ver manuales.js) mandan sobre las calculadas.
    const manuales = aplicarManuales(partidos, leerManuales(rutas.manuales));
    if (manuales.aplicadas) {
      paso(`${manuales.aplicadas} ${manuales.aplicadas === 1 ? 'hora puesta' : 'horas puestas'} a mano (salidas-manuales.json).`);
    }
    for (const c of manuales.caducadas) {
      aviso(`Hora puesta a mano que ya no vale (${c}): vuelve la calculada. Se puede poner otra desde la web.`);
    }
    const sinCalcular = ordenarUnicos(partidos
      .filter((p) => conHora(p) && !p.enCasa && !p.segundo && p.viajeMin === null && !p.horaManual)
      .map((p) => p.pabellon || '(sin pabellón)'));
    if (sinCalcular.length) {
      aviso(`Sin tiempo de viaje para: ${sinCalcular.join('; ')}. Se puede poner a mano en config.json (salidas > tiempos_viaje_minutos).`);
    }
  }

  // Resultados y clasificaciones: de las mismas páginas, ya en resultados.json (cache), sin más descargas; no en agosto
  // mientras se enseña la temporada anterior.
  let tablas = [];
  if (rango.anio === cache.temporada && partidos.length) {
    anadirResultados(partidos, cache);
    tablas = clasificaciones(equipos, cache, ids, generado.pared);
  }

  // Partidos de prueba para enseñar la página (config.json › "demo": true): solo van a la página, que solo
  // los enseña con «?demo» en la dirección (ver demo.js).
  const demo = cfg?.demo === true ? partidosDemo({ partidos, equipos, pabellones, salidas, hoy: generado.pared }) : [];

  // Carpeta y nombres de archivo
  const carpetaSalida = resolve(opciones.salida || 'calendario');
  mkdirSync(carpetaSalida, { recursive: true });
  let base;
  if (opciones.nombreBase) {
    base = slug(opciones.nombreBase);
  } else {
    base = `calendario-${slug(clubs[0].nombre)}${clubs.length > 1 ? '-y-otros' : ''}-${rango.etiqueta.replace('/', '-')}`;
    if (rango.parcial) base += `-${fmt(rango.inicio, 'yyyyMMdd')}-${fmt(rango.fin, 'yyyyMMdd')}`;
  }
  const descripcion = `Partidos de ${nombreClub} (todas las categorías), temporada ${rango.etiqueta}. Fuente: Federación Galega de Voleibol.`;

  // Un .ics por equipo (también para los equipos que aún no tienen partidos publicados)
  const conEquipos = !opciones.sinEquipos && !rango.parcial && equipos.length > 0;
  // En los títulos del calendario los equipos van sin el nombre del club delante: "IF1 vs RIVAL".
  const opcionesIcs = { prefijo: prefijoComun(equipos.map((e) => e.nombre)) };

  if (conEquipos) {
    const carpetaEquipos = join(carpetaSalida, 'equipos');
    mkdirSync(carpetaEquipos, { recursive: true });
    const usados = new Set();
    for (const e of equipos) {
      let nombre = slug(e.nombre);
      if (usados.has(nombre)) nombre = `${nombre}-${slug(e.categoria)}`;
      usados.add(nombre);
      const contenido = crearIcs(e.partidos, `Voleibol · ${e.nombre}`,
        `Partidos de ${e.nombre} (${e.categoria}), temporada ${rango.etiqueta}. Fuente: Federación Galega de Voleibol.`,
        duracion, generado, salidas, opcionesIcs);
      writeFileSync(join(carpetaEquipos, `${nombre}.ics`), contenido, 'utf8');
      e.ics = `equipos/${nombre}.ics`;
    }
  }

  const archivoIcs = `${base}.ics`;
  const archivoXlsx = `${base}.xlsx`;
  const archivoHtml = `${base}.html`;
  writeFileSync(join(carpetaSalida, archivoIcs),
    crearIcs(partidos, `Voleibol · ${nombreClub}`, descripcion, duracion, generado, salidas, opcionesIcs), 'utf8');
  writeFileSync(join(carpetaSalida, archivoXlsx), crearXlsx(partidos, generado.pared, nombreClub, salidas));
  // Cambiar horas desde la web (modo entrenador): solo con horas de salida y config.json › edicion. Con él, el
  // botón «Instagram» (arte.js y los logos del patrocinador, junto a la página).
  const edicion = salidas ? configEdicion(cfg) : null;
  const insta = edicion ? prepararInstagram({ cfg, carpetaConfig: dirname(rutas.config), carpetaSalida }) : null;
  const opcionesHtml = {
    partidos: demo.length ? [...partidos, ...demo].sort((a, b) => a.fecha - b.fecha || a.ordenCategoria - b.ordenCategoria) : partidos,
    equipos, nombreClub, nombreCorto, temporada: rango.etiqueta, ics: archivoIcs, xlsx: archivoXlsx, generado,
    urlPublicada, salidas, pabellones, pedirBus: configPedirBus(cfg, salidas), duracion, clasificaciones: tablas,
    edicion, insta,
    rutaEscudo: rutas.escudo,
    app: prepararApp({ carpetaIconos: rutas.iconos, carpetaSalida, nombreClub, nombreCorto, urlPublicada }),
  };
  writeFileSync(join(carpetaSalida, archivoHtml), crearHtml(opcionesHtml), 'utf8');
  if (opciones.historial) {
    const rutaHistorial = resolve(opciones.historial);
    mkdirSync(dirname(rutaHistorial), { recursive: true });
    writeFileSync(rutaHistorial, crearHistorial(partidos, nombreClub, rango.etiqueta), 'utf8');
  }

  // Resumen en pantalla
  const hoy = soloDia(generado.pared);
  const proximos = partidos.filter((p) => p.fecha >= hoy);
  const conPartidos = equipos.filter((e) => e.partidos.length > 0).length;
  console.log('');
  console.log(`  ${nombreClub}`);
  if (!partidos.length) {
    if (rango.parcial) {
      aviso(`No hay partidos de este club entre el ${fmt(rango.inicio, 'dd/MM/yyyy')} y el ${fmt(rango.fin, 'dd/MM/yyyy')}.`);
    } else {
      aviso(`Todavía no hay partidos publicados de este club para la temporada ${rango.etiqueta}.`);
      paso('La federación los va publicando poco a poco: vuelve a ejecutarlo más adelante.');
    }
  } else {
    paso(`${partidos.length} partidos (${proximos.length} por jugar) de ${conPartidos} equipos.`);
    const conResultado = partidos.filter((p) => p.resultado).length;
    if (conResultado || tablas.length) paso(`${conResultado} resultado(s) y ${tablas.length} clasificación(es).`);
    const pendientes = proximos.filter((p) => p.estado !== 'confirmada').length;
    if (pendientes) paso(`${pendientes} partido(s) con la fecha o la hora aún sin confirmar.`);
    if (proximos.length) {
      console.log('');
      console.log('  Próximos partidos:');
      for (const p of proximos.slice(0, 12)) console.log(lineaProximo(p, salidas));
      if (proximos.length > 12) paso(`... y ${proximos.length - 12} más (míralos en la página HTML).`);
    }
  }
  const sinPartidos = equipos.filter((e) => e.partidos.length === 0);
  if (sinPartidos.length && conEquipos) {
    paso(`Equipos aún sin partidos publicados: ${sinPartidos.map((e) => e.nombre).join(', ')}.`);
  }

  console.log('');
  console.log(`  Archivos generados en: ${carpetaSalida}`);
  console.log(`    ${archivoHtml}  <- abrir en el navegador (lista, mes, imprimir)`);
  console.log(`    ${archivoIcs}   <- calendario para importar (copia fija)`);
  console.log(`    ${archivoXlsx}  <- Excel`);
  if (conEquipos) console.log(`    equipos${sep}  <- un calendario .ics por equipo (${equipos.length})`);
  if (insta) console.log(`    arte.js${insta.patrocinadores.length ? ` y patrocinadores${sep}` : ''}  <- artes para Instagram (modo entrenador)`);
  if (opcionesHtml.app) console.log(`    manifest.webmanifest, sw.js, iconos${sep}  <- para instalar la página como app en el móvil`);
  if (demo.length) paso(`${demo.length} partidos de prueba en la página (solo se ven con «?demo» en la dirección).`);
  if (urlPublicada) {
    console.log('');
    console.log(`  Calendario en internet (se actualiza solo): ${urlPublicada}`);
  }
}

// ¿Se ha llamado como programa ("node src/main.js")? Al importarlo desde las pruebas, no. Node también
// acepta "node src/main" (sin extensión): process.argv[1] se resuelve como lo hace él.
function esPrograma() {
  if (!process.argv[1]) return false;
  try {
    const ruta = createRequire(import.meta.url).resolve(resolve(process.argv[1]));
    return realpathSync(ruta) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

export function mostrarError(e) {
  console.log('');
  console.log(`  ERROR: ${e.message}`);
  // Los mensajes para el usuario son Error. Otro tipo (TypeError...) es un fallo del programa: se
  // deja la pila en stderr para quien lo arregle.
  if (e.name !== 'Error' || process.env.CALENDARIO_DETALLE) console.error(e.stack);
}

if (esPrograma()) {
  principal(process.argv.slice(2)).catch((e) => {
    mostrarError(e);
    process.exitCode = 1;
  });
}
