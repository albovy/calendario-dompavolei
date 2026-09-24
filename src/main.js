// Genera el calendario de partidos de un club de voleibol gallego (todas sus categorías).
//
// Descarga los partidos de la "Agenda calendario" de https://volei.gal/competiciones/ (plataforma
// iSquad de la Federación Galega de Voleibol), se queda solo con los equipos del club y genera, en la
// carpeta de salida:
//
//   - <nombre>.ics   Calendario para Google Calendar, Outlook, iPhone o Android.
//   - <nombre>.html  Página con los partidos (lista y vista mensual), imprimible.
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
//                       parte del nombre (p. ej. "pontevedra") o varios separados por comas.
//   --temporada         Temporada, p. ej. "2026-27". Por defecto, la temporada en curso (del 1 de
//                       agosto al 31 de julio); si aún no hay partidos del club en ella, la anterior.
//   --desde, --hasta    Fechas (aaaa-mm-dd) dentro de la temporada. Por defecto, 1/8 y 31/7.
//   --salida            Carpeta de los archivos. Por defecto, "calendario" en la carpeta actual.
//   --nombre-base       Nombre de los archivos (sin extensión). Por defecto, el club y la temporada.
//   --duracion-minutos  Duración de cada partido en el calendario (por defecto, la de config.json o 120).
//   --historial         Archivo de texto donde guardar la lista de partidos sin fecha de generación,
//                       para detectar cambios (lo usa la publicación automática en GitHub).
//   --sin-equipos       No genera los calendarios por equipo.
//   --listar-clubs      Muestra los clubs disponibles con su ID y termina.
//   --config            config.json a usar (o su carpeta); pabellones.json se guarda junto a él.
//                       Por defecto, los de la carpeta actual.
//
// Si algo falla, escribe "  ERROR: ..." y termina con código 1. Un fallo del propio programa (TypeError...)
// deja además la pila en stderr; con la variable de entorno CALENDARIO_DETALLE=1, cualquier error
// (como -Verbose en el .ps1).

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { crearHistorial } from './historial.js';
import { crearHtml } from './html.js';
import { crearIcs } from './ics.js';
import { buscarClubs, catalogoClubs, fechaCruda, partidosApi } from './isquad.js';
import { conHora, convertirPartidos, equipos as equiposDelClub } from './partidos.js';
import { anadirSalidas, configPedirBus, configSalidas, resolverPabellones, textoSalida } from './salidas.js';
import {
  ahoraMadrid, anioTemporada, aviso, comoLista, esObjeto, fechaCorta, fechaPared, fechaValida, fmt, leerJson,
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

// config.json, pabellones.json y temporada-anterior.json van juntos: en la carpeta actual o en la de --config.
export function rutasConfig(ruta) {
  let config = resolve('config.json');
  if (ruta) {
    config = existsSync(ruta) && statSync(ruta).isDirectory() ? join(resolve(ruta), 'config.json') : resolve(ruta);
  }
  return {
    config,
    pabellones: join(dirname(config), 'pabellones.json'),
    temporadaAnterior: join(dirname(config), 'temporada-anterior.json'),
  };
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

// --- Clubs -------------------------------------------------------------------------------------

export function mostrarCatalogo(lista, temporada) {
  console.log('');
  console.log(`   Nº  ${'Club'.padEnd(34)} ${'Partidos'.padEnd(9)} ${'ID'.padEnd(10)} Nombre oficial`);
  lista.forEach((c, i) => {
    const n = c.partidos > 0 ? String(c.partidos) : '-';
    console.log(`  ${String(i + 1).padStart(3)}  ${c.nombre.padEnd(34)} ${n.padStart(8)}  ${c.id.padEnd(10)} ${c.oficial}`);
  });
  console.log(`  (Partidos = partidos publicados en la temporada ${temporada})`);
  console.log('');
}

export async function resolverClubs(textoClub, crudosTemporada, crudosTodos, cfg) {
  // Devuelve los clubs ({ id, nombre }) a usar: los de --club o, si no, los de config.json.
  if (textoClub) {
    const catalogo = await catalogoClubs(crudosTemporada, crudosTodos);
    const elegidos = [];
    for (const trozo of textoClub.split(/[,;]/)) {
      const t = trozo.trim();
      if (!t) continue;
      if (/^\d{5,}$/.test(t)) {
        elegidos.push(catalogo.find((c) => c.id === t) ?? { id: t, nombre: `Club ${t}` });
        continue;
      }
      const encontrados = buscarClubs(catalogo, t);
      if (encontrados.length === 0) {
        throw new Error(`Ningún club ni equipo coincide con «${t}». Usa --listar-clubs para ver los disponibles.`);
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

  const lista = comoLista(cfg?.clubs ?? [])
    .filter((c) => c?.id)
    .map((c) => ({ id: txt(c.id), nombre: c.nombre ? txt(c.nombre) : `Club ${c.id}` }));
  if (lista.length) return lista;
  throw new Error('No hay ningún club configurado en config.json. Indica el club con --club.');
}

// --- Temporada anterior ------------------------------------------------------------------------
//
// De la temporada anterior solo hacen falta los partidos del club: para que cada equipo tenga su
// calendario aunque todavía no juegue y para no quedarse vacío en agosto. Ya no cambian, así que se
// descargan una sola vez y se guardan en temporada-anterior.json; cada hora solo se pide la temporada
// en curso (antes, la anterior era el 90 % de lo que se bajaba).

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

// Filas crudas de los partidos del club en la temporada anterior a la de "rango".
// guardar: false en las consultas de otra temporada (--temporada/--desde/--hasta), para no pisar la copia
// que usa la actualización de cada hora. descargar: se puede cambiar en las pruebas.
export async function temporadaAnterior({ rango, ids, ruta, guardar, descargar = partidosApi }) {
  const anio = rango.anio - 1;
  const clubs = [...ids].sort().join(',');
  if (existsSync(ruta)) {
    try {
      const copia = leerJson(readFileSync(ruta, 'utf8'));
      if (copia?.anio === anio && comoLista(copia.clubs).map(txt).sort().join(',') === clubs && Array.isArray(copia.partidos)) {
        return copia.partidos;
      }
    } catch (e) {
      aviso(`${basename(ruta)} no se puede leer (${e.message}); se vuelve a descargar.`);
    }
  }

  paso(`Descargando una sola vez la temporada ${nuevoRango(anio).etiqueta} (se guarda en ${basename(ruta)})...`);
  let crudos;
  try {
    crudos = await descargar(fechaPared(anio, 8, 1));
  } catch (e) {
    aviso(`No se pudo descargar la temporada anterior (${e.message}); se sigue sin ella.`);
    return [];
  }
  const ini = fmt(fechaPared(anio, 8, 1), 'yyyy-MM-dd');
  const fin = fmt(fechaPared(anio + 1, 7, 31), 'yyyy-MM-dd');
  const partidos = crudos
    .filter((r) => {
      const f = fechaCruda(r);
      return f && f >= ini && f <= fin && (ids.has(txt(r.id_club_local)) || ids.has(txt(r.id_club_visitante)));
    })
    .map(filaGuardada);
  if (guardar) {
    const copia = { temporada: nuevoRango(anio).etiqueta, anio, clubs: [...ids].sort(), partidos };
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

export async function principal(args, ahora = new Date()) {
  const opciones = leerOpciones(args);
  // "pared" (hora de Galicia) para los textos y la temporada; "utc" para las marcas del .ics.
  const generado = { pared: ahoraMadrid(ahora), utc: ahora };
  let rango = rangoTemporada(opciones, generado.pared);
  const rutas = rutasConfig(opciones.config);
  const cfg = leerConfig(rutas.config);

  console.log('');
  console.log(`  CALENDARIO DE VOLEIBOL · temporada ${rango.etiqueta}`);
  paso('Descargando partidos de volei.gal...');
  // Solo la temporada en curso; la anterior sale de temporada-anterior.json (más abajo).
  const actuales = await partidosApi(fechaPared(rango.anio, 8, 1));
  // Al empezar la temporada puede no haber nada publicado todavía; ya avanzada, 0 partidos en toda
  // Galicia es un fallo de la federación y no se toca nada.
  if (actuales.length === 0 && generado.pared >= fechaPared(rango.anio, 10, 1)) {
    throw new Error('La federación no ha devuelto ningún partido de esta temporada. Puede ser un fallo temporal de su web: inténtalo más tarde. No se ha cambiado ningún archivo.');
  }
  const iniTxt = fmt(fechaPared(rango.anio, 8, 1), 'yyyy-MM-dd');
  const finTxt = fmt(fechaPared(rango.anio + 1, 7, 31), 'yyyy-MM-dd');
  const deTemporada = actuales.filter((r) => {
    const f = fechaCruda(r);
    return f && f >= iniTxt && f <= finTxt;
  });
  paso(`${deTemporada.length} partidos publicados en Galicia en la temporada ${rango.etiqueta}.`);

  if (opciones.listarClubs) {
    mostrarCatalogo(await catalogoClubs(deTemporada, deTemporada), rango.etiqueta);
    return;
  }

  const clubs = await resolverClubs(opciones.club, deTemporada, deTemporada, cfg);
  if (!clubs.length) throw new Error('No se ha elegido ningún club.');
  const ids = new Set(clubs.map((c) => txt(c.id)));
  const nombreClub = clubs.map((c) => c.nombre).join(' + ');

  const anteriorCrudos = await temporadaAnterior({
    rango, ids, ruta: rutas.temporadaAnterior, guardar: !rango.explicito,
  });
  const crudos = [...deTemporada, ...anteriorCrudos];

  const idsConPartidos = new Set(crudos.flatMap((r) => [txt(r.id_club_local), txt(r.id_club_visitante)]));
  for (const c of clubs) {
    if (!idsConPartidos.has(txt(c.id))) {
      aviso(`El club con ID ${c.id} (${c.nombre}) no aparece en ningún partido de esta temporada ni de la anterior. Revisa el ID en config.json (--listar-clubs muestra los clubs).`);
    }
  }

  const duracion = opciones.duracionMinutos > 0 ? opciones.duracionMinutos : duracionConfig(cfg);
  const urlPublicada = cfg?.calendario_publicado ? txt(cfg.calendario_publicado) : '';

  const todos = convertirPartidos(crudos, ids);
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
    pabellones = await resolverPabellones(partidos, salidas, fechaPared(rango.anio - 1, 8, 1), rutas.pabellones,
      generado.pared);
    anadirSalidas(partidos, pabellones, salidas);
    const sinCalcular = ordenarUnicos(partidos
      .filter((p) => conHora(p) && !p.enCasa && !p.segundo && p.viajeMin === null)
      .map((p) => p.pabellon || '(sin pabellón)'));
    if (sinCalcular.length) {
      aviso(`Sin tiempo de viaje para: ${sinCalcular.join('; ')}. Se puede poner a mano en config.json (salidas > tiempos_viaje_minutos).`);
    }
  }

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
  const html = crearHtml({
    partidos, equipos, nombreClub, temporada: rango.etiqueta, ics: archivoIcs, xlsx: archivoXlsx, generado,
    urlPublicada, salidas, pabellones, pedirBus: configPedirBus(cfg, salidas), duracion,
  });
  writeFileSync(join(carpetaSalida, archivoHtml), html, 'utf8');
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
