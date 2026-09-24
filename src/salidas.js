// Hora de salida (viaje en bus + calentamiento). Traducción de la parte "Hora de salida" de
// calendario-voley.ps1.
//
// Con "salidas" en config.json, cada partido con hora lleva también la hora de salida en bus desde el
// pabellón del club: salida = partido - calentamiento - viaje en bus. En casa, el evento empieza a la
// hora de calentamiento. El pabellón de cada partido se localiza con las coordenadas que publica la
// federación y el tiempo por carretera se calcula con OSRM (OpenStreetMap). Los resultados se guardan
// en pabellones.json para no repetir consultas.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AMBITO, peticion } from './isquad.js';
import { conHora } from './partidos.js';
import {
  aEntero, ahoraMadrid, aviso, clave, claveSinCaja, comoLista, compararTexto, esObjeto, esperar, fmt, formatDuracion,
  hora, leerJson, mayusculas, ordenarUnicos, repararTexto, sumarMinutos, txt, unaLinea,
} from './util.js';

const PALABRAS_GENERICAS = ['PISTA', 'PABELLON', 'PAVILLON', 'POLIDEPORTIVO', 'MUNICIPAL', 'CAMPO', 'CAMPO1', 'CENTRAL', 'ANEXO',
  'PM', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'DEL', 'LOS', 'LAS', 'LA', 'EL', 'O', 'A', 'OS', 'AS', 'E', 'Y'];

const OSRM = 'https://router.project-osrm.org';

// Como ConvertTo-Numero del .ps1: números de JSON tal cual y textos con punto o coma decimal
// ("42,34"); si no es un número, el valor por defecto.
export function aNumero(valor, defecto) {
  if (valor == null || txt(valor) === '') return defecto;
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  const texto = txt(valor).replace(/,/g, '.');
  // Como double.TryParse con NumberStyles.Float: espacios alrededor, signo, decimales y exponente.
  if (/^[\t-\r ]*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?[\t-\r ]*$/.test(texto)) return Number(texto.trim());
  return defecto;
}

export function configSalidas(cfg) {
  if (!cfg || !cfg.salidas) return null;
  const s = cfg.salidas;
  const lat = aNumero(s.latitud, null);
  const lon = aNumero(s.longitud, null);
  if (lat === null || lon === null) {
    aviso('config.json: faltan "latitud" y "longitud" del pabellón de salida; no se calculan las horas de salida.');
    return null;
  }
  const manual = new Map();
  if (esObjeto(s.tiempos_viaje_minutos)) {
    for (const [nombre, valor] of Object.entries(s.tiempos_viaje_minutos)) {
      const m = aNumero(valor, null);
      if (m !== null && m >= 0) manual.set(clave(nombre), aEntero(m));
      else aviso(`config.json: el tiempo de viaje de «${nombre}» no es un número de minutos; se ignora.`);
    }
  }
  return {
    origen: s.origen ? txt(s.origen) : 'el pabellón del club',
    lat,
    lon,
    calentamiento: aEntero(aNumero(s.calentamiento_minutos, 60)),
    factorBus: aNumero(s.factor_bus, 1.10),
    margen: aEntero(aNumero(s.margen_minutos, 0)),
    // El viaje se redondea hacia arriba y la salida hacia abajo (a cuartos de hora): siempre con margen.
    redondeoViaje: Math.max(1, aEntero(aNumero(s.redondeo_viaje_minutos, 15))),
    redondeo: Math.max(1, aEntero(aNumero(s.redondeo_salida_minutos, 15))),
    radioCasaKm: aNumero(s.radio_casa_km, 1),
    manual,
  };
}

export function configPedirBus(cfg, salidas) {
  // Datos para el botón "Pedir bus" de la página (correo ya redactado para la empresa de autobuses).
  if (!salidas || !cfg || !cfg.pedir_bus) return null;
  const b = cfg.pedir_bus;
  return {
    para: txt(b.para),
    cc: txt(b.cc),
    plazas: txt(b.plazas),
    firma: txt(b.firma),
    origen: salidas.origen,
    dirOrigen: txt(b.direccion_origen),
  };
}

export function distanciaKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Como [Math]::Round(x, decimales) de .NET: redondeo bancario (46,25 -> 46,2).
function redondear(x, decimales) {
  const potencia = 10 ** decimales;
  return aEntero(x * potencia) / potencia;
}

// --- Caché de pabellones (pabellones.json) -----------------------------------------------------

export function leerCachePabellones(ruta) {
  // Sin prototipo: un pabellón que se llamara "constructor" no choca con nada.
  const cache = Object.create(null);
  if (existsSync(ruta)) {
    try {
      const obj = leerJson(readFileSync(ruta, 'utf8'));
      if (esObjeto(obj)) Object.assign(cache, obj);
    } catch {
      aviso('pabellones.json no se puede leer; se volverán a calcular los viajes.');
    }
  }
  return cache;
}

export function guardarCachePabellones(cache, ruta) {
  // Por orden alfabético, para que los cambios del archivo en Git sean fáciles de leer.
  const ordenado = Object.fromEntries(Object.keys(cache).sort(compararTexto).map((k) => [k, cache[k]]));
  writeFileSync(ruta, JSON.stringify(ordenado, null, 4), 'utf8');
}

// --- Pabellones de la federación ----------------------------------------------------------------

export async function camposFederacion(desde) {
  // Lista de pabellones de la federación (id, nombre, municipio).
  const campos = [];
  try {
    const json = await peticion('json/pabellones_consultas.php', {
      accion: 'obtener_pabellones', id_ambito: AMBITO, fecha_actual: fmt(desde, 'yyyy-MM-dd'),
    });
    for (const c of comoLista(leerJson(json)?.data)) {
      if (!c || !c.id_campo) continue;
      const nombre = unaLinea(c.nombre);
      campos.push({ id: txt(c.id_campo), nombre, municipio: unaLinea(c.municipio), clave: clave(nombre) });
    }
  } catch {
    aviso('No se pudo descargar la lista de pabellones de la federación; algunas horas de salida quedarán sin calcular.');
  }
  return campos;
}

// Palabras que distinguen un pabellón (sin "PISTA", "PABELLÓN", números...).
function significativas(claveNombre) {
  return claveNombre.split(' ').filter((w) => w && !/^\d+$/.test(w) && !PALABRAS_GENERICAS.includes(w));
}

export function buscarCampos(nombre, campos) {
  // Pabellones de la federación que corresponden al nombre que aparece en el partido, del más probable al menos.
  const buscada = clave(nombre);
  if (!buscada) return [];
  const exactos = campos.filter((c) => c.clave === buscada);
  if (exactos.length) return exactos;
  const prefijos = campos
    .filter((c) => buscada.startsWith(`${c.clave} `) || c.clave.startsWith(`${buscada} `))
    .sort((a, b) => b.clave.length - a.clave.length);
  if (prefijos.length) return prefijos;
  // Por palabras significativas: comparten al menos el 60 % de las palabras.
  const mias = significativas(buscada);
  if (!mias.length) return [];
  const puntuados = [];
  for (const c of campos) {
    const suyas = significativas(c.clave);
    if (!suyas.length) continue;
    const comunes = mias.filter((w) => suyas.includes(w)).length;
    const p = comunes / Math.max(mias.length, suyas.length);
    if (p >= 0.6) puntuados.push({ campo: c, p });
  }
  return puntuados.sort((a, b) => b.p - a.p).map((x) => x.campo);
}

export function direccionCampo(direccion) {
  // iSquad guarda algunas direcciones con las tildes mal codificadas y todas acaban en ", ESPAÑA".
  return mayusculas(repararTexto(unaLinea(direccion))).replace(/,\s*ESPA(Ñ|N)A\s*$/i, '').trim();
}

export async function coordenadasCampo(id) {
  // Coordenadas y dirección de un pabellón según la ficha de la federación.
  try {
    const obj = leerJson(await peticion('json/pabellones_consultas.php', { accion: 'obtener_info_campo', id }));
    let filas = obj?.data;
    if (typeof filas === 'string') filas = leerJson(filas);
    for (const f of comoLista(filas)) {
      const lat = aNumero(f?.latitud, null);
      const lon = aNumero(f?.longitud, null);
      if (lat !== null && lon !== null && (lat !== 0 || lon !== 0)) {
        return { lat, lon, direccion: direccionCampo(f.direccion) };
      }
    }
  } catch {
    // Sin ficha: el pabellón queda sin coordenadas.
  }
  return null;
}

export async function rutaCoche(lat1, lon1, lat2, lon2) {
  // Tiempo en coche por carretera (OSRM, servidor público de OpenStreetMap: una consulta por segundo como mucho).
  const url = `${OSRM}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
  try {
    await esperar(1100);
    const r = await fetch(url, { headers: { 'User-Agent': 'calendario-voley/1.0' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`respuesta ${r.status}`);
    const obj = leerJson(Buffer.from(await r.arrayBuffer()).toString('utf8'));
    const rutas = comoLista(obj?.routes ?? []);
    if (obj?.code === 'Ok' && rutas.length) {
      const ruta = rutas[0];
      return { km: redondear((ruta.distance ?? 0) / 1000, 1), minutos: Math.ceil((ruta.duration ?? 0) / 60), fuente: 'osrm' };
    }
  } catch {
    // Sin respuesta válida: se estima.
  }
  // Sin servicio de rutas: estimación a partir de la distancia en línea recta (se reintenta otro día).
  const km = distanciaKm(lat1, lon1, lat2, lon2) * 1.35;
  return { km: redondear(km, 1), minutos: Math.ceil(km / 70 * 60), fuente: 'estimado' };
}

// hoy: Date de pared con la fecha de hoy (la de la generación).
// Como en el .ps1 (un @{}), la caché no distingue mayúsculas: el pabellón "Lejos - Pista 1" usa la
// entrada "LEJOS - PISTA 1" (claveSinCaja), y si se actualiza, conserva su nombre.
export async function resolverPabellones(partidos, cfgSalidas, desdeCampos, rutaCache, hoy = ahoraMadrid()) {
  // Coordenadas y tiempo en coche desde el origen para cada pabellón de los partidos (con caché).
  const cfg = cfgSalidas;
  const cache = leerCachePabellones(rutaCache);
  const origen = `${cfg.lat},${cfg.lon}`;
  const hoyTxt = fmt(hoy, 'yyyy-MM-dd');
  let campos = null;
  let cambios = false;
  const nombres = ordenarUnicos(partidos.filter((p) => p.pabellon && conHora(p)).map((p) => p.pabellon));
  for (const n of nombres) {
    const k = claveSinCaja(cache, n);
    const e = cache[k];
    if (e && e.origen === origen && (e.fuente === 'osrm' || e.fecha === hoyTxt)) continue;   // al día (o ya reintentado hoy)
    let lat = null;
    let lon = null;
    let idCampo = '';
    let municipio = '';
    let direccion = '';
    if (e && e.lat != null) {
      lat = Number(e.lat);
      lon = Number(e.lon);
      idCampo = txt(e.id_campo);
      municipio = txt(e.municipio);
      direccion = txt(e.direccion);
    } else {
      campos ??= await camposFederacion(desdeCampos);
      for (const c of buscarCampos(n, campos)) {
        const coord = await coordenadasCampo(c.id);
        if (coord) {
          lat = coord.lat;
          lon = coord.lon;
          direccion = coord.direccion;
          idCampo = c.id;
          municipio = c.municipio;
          break;
        }
      }
    }
    if (lat === null) {
      cache[k] = { fuente: 'sin-datos', origen, fecha: hoyTxt };
    } else {
      const ruta = await rutaCoche(cfg.lat, cfg.lon, lat, lon);
      cache[k] = {
        id_campo: idCampo, municipio, direccion, lat, lon,
        km: ruta.km, minutos_coche: ruta.minutos, fuente: ruta.fuente, origen, fecha: hoyTxt,
      };
    }
    cambios = true;
  }
  // Pabellones guardados antes de que se apuntara la dirección: se completa una sola vez.
  for (const n of nombres) {
    const k = claveSinCaja(cache, n);
    const e = cache[k];
    if (!e || e.lat == null || !e.id_campo || Object.hasOwn(e, 'direccion')) continue;
    const info = await coordenadasCampo(txt(e.id_campo));
    const nuevo = { id_campo: txt(e.id_campo), municipio: txt(e.municipio), direccion: info ? info.direccion : '' };
    // Lo que falte sale como null, igual que en el .ps1 (JSON.stringify quitaría la propiedad).
    for (const campo of ['lat', 'lon', 'km', 'minutos_coche', 'fuente', 'origen', 'fecha']) nuevo[campo] = e[campo] ?? null;
    cache[k] = nuevo;
    cambios = true;
  }
  if (cambios) {
    try {
      guardarCachePabellones(cache, rutaCache);
    } catch (e) {
      aviso(`No se pudo guardar pabellones.json: ${e.message}`);
    }
  }
  return cache;
}

// --- Salida de cada partido ---------------------------------------------------------------------

// pabellones: la caché de resolverPabellones. Como en el .ps1 (dos @{}), ni el pabellón ni los equipos
// distinguen mayúsculas (claveSinCaja).
export function anadirSalidas(partidos, pabellones, cfgSalidas) {
  // Calcula calentamiento, viaje en bus y salida de cada partido con hora.
  const cfg = cfgSalidas;
  const primeros = new Map();
  for (const p of [...partidos].sort((a, b) => a.fecha - b.fecha)) {
    if (!conHora(p)) continue;
    const e = p.pabellon ? pabellones[claveSinCaja(pabellones, p.pabellon)] : null;
    let viaje = null;
    let casa = false;
    if (e && e.lat != null) {
      p.municipio = txt(e.municipio);
      p.km = e.km ?? null;
      if (distanciaKm(cfg.lat, cfg.lon, Number(e.lat), Number(e.lon)) <= cfg.radioCasaKm) {
        casa = true;
      } else if (e.minutos_coche != null) {
        viaje = Math.ceil(Number(e.minutos_coche) * cfg.factorBus / cfg.redondeoViaje) * cfg.redondeoViaje;
        p.viajeFuente = txt(e.fuente);
      }
    }
    // Un tiempo puesto a mano en config.json manda sobre el calculado (0 = en casa).
    const claveP = clave(p.pabellon);
    for (const [k, minutos] of cfg.manual) {
      if (claveP && k && claveP.includes(k)) {
        viaje = minutos;
        casa = viaje === 0;
        p.viajeFuente = 'manual';
        break;
      }
    }
    p.enCasa = casa;
    p.viajeMin = casa ? null : viaje;
    p.calentamiento = sumarMinutos(p.fecha, -cfg.calentamiento);

    // Concentraciones: si el mismo equipo ya juega antes ese día en el mismo pabellón, no hay otra salida.
    const nuestros = [...p.nuestros].sort(compararTexto).join('/');
    const grupo = claveSinCaja(primeros, `${fmt(p.fecha, 'yyyyMMdd')}|${nuestros}|${claveP}`);
    if (primeros.has(grupo)) {
      p.segundo = true;
      p.salidaPrimero = primeros.get(grupo);
      p.inicio = p.fecha;
      continue;
    }
    if (casa) {
      p.inicio = p.calentamiento;
    } else if (viaje !== null) {
      // Salida a la hora "redonda" anterior (a cuartos de hora con redondeo 15).
      let s = sumarMinutos(p.calentamiento, -(viaje + cfg.margen));
      const minutosDelDia = s.getUTCHours() * 60 + s.getUTCMinutes();
      s = new Date(s.getTime() - s.getUTCSeconds() * 1000);
      s = sumarMinutos(s, -(minutosDelDia % cfg.redondeo));
      p.salida = s;
      p.inicio = s;
    } else {
      p.inicio = p.calentamiento;
    }
    primeros.set(grupo, p);
  }
}

export function lineasSalida(p, cfgSalidas) {
  // Líneas del detalle del evento con la salida, el viaje, el calentamiento y el partido.
  if (!cfgSalidas) return [];
  if (!conHora(p)) return ['La hora de salida se calculará cuando la federación publique la hora del partido.'];
  if (p.segundo) {
    const ref = p.salidaPrimero;
    let texto = '2º partido del día en este pabellón: se va con el primero';
    if (ref && ref.salida) texto += ` (salida a las ${hora(ref.salida)})`;
    return [texto, `Partido: ${hora(p.fecha)}`];
  }
  const lineas = [];
  if (p.enCasa) {
    lineas.push(`En casa (${cfgSalidas.origen})`);
  } else if (p.salida) {
    lineas.push(`Salida en bus desde ${cfgSalidas.origen}: ${hora(p.salida)}`);
    const donde = [];
    if (p.municipio) donde.push(p.municipio);
    if (p.km != null) donde.push(`${Number(p.km).toFixed(0)} km`);
    lineas.push(`Viaje en bus: ${formatDuracion(p.viajeMin)}${p.viajeFuente === 'manual' ? '' : ' aprox.'}`
      + (donde.length ? ` (${donde.join(', ')})` : ''));
  } else {
    lineas.push('Tiempo de viaje sin calcular para este pabellón (se puede poner a mano en config.json).');
  }
  lineas.push(`Calentamiento: ${hora(p.calentamiento)}`);
  lineas.push(`Partido: ${hora(p.fecha)}${p.estado === 'provisional' ? ' (provisional)' : ''}`);
  return lineas;
}

export function textoSalida(p) {
  if (!conHora(p)) return '';
  if (p.segundo) return '2º partido';
  if (p.enCasa) return 'En casa';
  if (p.salida) return hora(p.salida);
  return 'Sin calcular';
}
