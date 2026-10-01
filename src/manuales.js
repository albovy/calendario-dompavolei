// Horas puestas a mano desde la web (botón «Cambiar salida» o «Cambiar calentamiento», con la llave de
// entrenador): la salida del bus de un partido de fuera o el calentamiento de uno en casa. La página lanza
// salida.yml con el partido, el tipo y la hora; salida.yml ejecuta este archivo, que guarda el cambio en
// salidas-manuales.json (junto a config.json), y la publicación lo aplica a los partidos.
//
//   PARTIDO='id:a1b2c3d4 · 2026-10-03 11:30 · LOCAL vs VISITANTE' TIPO=salida HORA='08:00' node src/manuales.js
//
// HORA vacía: vuelve la calculada. Las entradas llegan por variables de entorno (nunca dentro del «run:» del
// workflow) y se validan aquí: las puede mandar cualquiera que tenga la llave.
//
// salidas-manuales.json: { "<8 primeros caracteres del UID>": { partido: 'aaaa-mm-dd HH:MM', tipo: 'salida' o
// 'calentamiento', hora: 'HH:MM', texto: 'LOCAL vs VISITANTE', cambiado: <ISO> } }. La fecha y hora del
// partido y el tipo sirven para no aplicar una hora a mano si la federación lo ha cambiado después.
//
// La hora del partido nunca cambia: lo que gana o pierde tiempo es el calentamiento, que en los partidos de
// fuera empieza al llegar (salida + viaje; ver anadirSalidas en salidas.js).

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conHora } from './partidos.js';
import { aviso, fechaPared, fmt, formatDuracion, leerJson, sumarMinutos, txt } from './util.js';

const RE_PARTIDO = /^id:([0-9a-f]{8}) · (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}) · ([^\n\r]{1,200})$/;
// En el texto de los equipos (sale en el registro de GitHub Actions), nada que el registro pueda tomar por una
// orden («::» al empezar la línea, «##[» en cualquier sitio) ni caracteres de control o saltos de línea.
const RE_TEXTO_RARO = /::|##\[|[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const RE_HORA = /^([01]?\d|2[0-3]):([0-5]\d)$/;
// salida: la del bus (partidos de fuera); calentamiento: el de los partidos en casa.
const TIPOS = ['salida', 'calentamiento'];

// config.json › edicion: a dónde manda la página los cambios (el repositorio, el workflow que los guarda,
// salida.yml, y su rama) y, si la hay, la llave cifrada con la contraseña de los entrenadores («cifrada»: la
// crea la página, en «Modo entrenador › Contraseña para los entrenadores»; ver plantilla.html). Sin «edicion»,
// la página no ofrece cambiar horas.
const RE_CIFRADA = /^v1\.\d{4,7}\.[\w-]{22}\.[\w-]{16}\.[\w-]{40,600}$/;
export function configEdicion(cfg) {
  if (!cfg || cfg.edicion == null) return null;
  const e = typeof cfg.edicion === 'object' ? cfg.edicion : {};
  const repo = txt(e.repo);
  const workflow = e.workflow == null ? 'salida.yml' : txt(e.workflow);
  const rama = e.rama == null ? 'main' : txt(e.rama);
  if (/^[A-Za-z0-9-]+\/(?!\.\.?$)[\w.-]+$/.test(repo) && /^[\w-][\w.-]*\.ya?ml$/.test(workflow) && /^\w[\w./-]*$/.test(rama)) {
    const cifrada = txt(e.cifrada).trim();
    if (!cifrada) return { repo, workflow, rama };
    if (RE_CIFRADA.test(cifrada)) return { repo, workflow, rama, cifrada };
    aviso('config.json: "edicion" › "cifrada" no tiene la forma de una llave cifrada (la que da la página en «Modo entrenador»); se ignora.');
    return { repo, workflow, rama };
  }
  aviso('config.json: "edicion" necesita "repo" (dueño/repositorio) y, si se ponen, "workflow" (el archivo .yml) y "rama"; sin ella no se pueden cambiar horas desde la web.');
  return null;
}

// El identificador corto de un partido: los 8 primeros caracteres de su UID (estable aunque cambie la fecha).
export function idPartido(p) { return txt(p.uid).slice(0, 8); }

// El texto que manda la web para un partido: id, fecha y hora, y los equipos.
export function textoPartido(p) {
  return `id:${idPartido(p)} · ${fmt(p.fecha, 'yyyy-MM-dd HH:mm')} · ${p.local} vs ${p.visitante}`;
}

// Lee y valida un cambio (lo que llega del workflow). Devuelve { id, partido, texto, tipo, hora }; hora '' es
// quitar. Lanza un Error con el motivo si no vale. Los mensajes de error no repiten lo que llega: así no sale en
// el registro de GitHub Actions (que podría tomarlo por una orden).
export function interpretarCambio(textoPartido, hora, tipo = 'salida') {
  const m = RE_PARTIDO.exec(txt(textoPartido).trim());
  if (!m || RE_TEXTO_RARO.test(m[7])) throw new Error('el partido no tiene el formato esperado (id:xxxxxxxx · aaaa-mm-dd HH:MM · LOCAL vs VISITANTE).');
  const [, id, a, mes, d, hh, mm, texto] = m;
  if (+mes < 1 || +mes > 12 || +d < 1 || +d > 31 || +hh > 23 || +mm > 59) throw new Error('el partido tiene una fecha u hora imposible.');
  const t = txt(tipo).trim();
  if (!TIPOS.includes(t)) throw new Error('el tipo no vale: tiene que ser «salida» o «calentamiento».');
  const s = txt(hora).trim();
  if (s && !RE_HORA.test(s)) throw new Error('la hora no vale: tiene que ser HH:MM (por ejemplo 08:30).');
  const [h, mi] = s ? s.split(':') : [];
  const normal = s ? `${h.padStart(2, '0')}:${mi}` : '';
  // Antes del partido: 18:30 por 06:30 (un selector de 12 horas) haría un evento que acaba antes de empezar.
  if (normal && normal >= `${hh}:${mm}`) throw new Error(`la hora ${normal} tiene que ser antes del partido (${hh}:${mm}).`);
  return { id, partido: `${a}-${mes}-${d} ${hh}:${mm}`, texto: texto.trim(), tipo: t, hora: normal };
}

// Aplica un cambio a los datos (sin tocar los de entrada): pone la hora o, si es '', la quita. La misma hora
// otra vez no cambia nada (ni la fecha del cambio): así el workflow no guarda un commit sin sentido.
export function aplicarCambio(datos, cambio, ahora = new Date()) {
  const nuevos = { ...datos };
  const antes = nuevos[cambio.id];
  if (!cambio.hora) delete nuevos[cambio.id];
  else if (!antes || ['partido', 'tipo', 'hora', 'texto'].some((k) => antes[k] !== cambio[k])) {
    nuevos[cambio.id] = { partido: cambio.partido, tipo: cambio.tipo, hora: cambio.hora, texto: cambio.texto, cambiado: ahora.toISOString() };
  }
  return nuevos;
}

// Sin archivo, {}. Uno que no se puede leer (p. ej. editado a mano y roto) o que no es un objeto: al publicar,
// aviso y {} (la publicación sigue); al guardar un cambio (estricto, el workflow), error: si no, el cambio nuevo
// pisaría el archivo y borraría todas las demás horas a mano. leerJson acepta el BOM (Windows).
export function leerManuales(ruta, { estricto = false } = {}) {
  if (!existsSync(ruta)) return {};
  let motivo;
  try {
    const datos = leerJson(readFileSync(ruta, 'utf8'));
    if (datos && typeof datos === 'object' && !Array.isArray(datos)) return datos;
    motivo = 'no es un objeto';
  } catch (e) {
    motivo = e.message;
  }
  if (estricto) throw new Error(`salidas-manuales.json no se puede leer (${motivo}): arréglalo (o bórralo) en el repositorio antes de guardar más horas.`);
  aviso(`salidas-manuales.json no se puede leer (${motivo}); no se aplican horas a mano.`);
  return {};
}

// Ordenado por id y legible: así el historial de cambios del repositorio se lee bien.
export function guardarManuales(ruta, datos) {
  const ordenados = Object.fromEntries(Object.keys(datos).sort().map((k) => [k, datos[k]]));
  writeFileSync(ruta, `${JSON.stringify(ordenados, null, 2)}\n`, 'utf8');
}

// Pone las horas a mano en los partidos (después de anadirSalidas), si el partido sigue siendo el del cambio:
// la misma fecha y hora, fuera o en casa según el tipo, no el 2.º del día, con la hora antes del partido y, fuera,
// llegando antes del partido (si cambió de pabellón, el viaje puede ser otro). Las que no, «caducadas», con el
// motivo (main.js las avisa).
// - Salida (fuera): salida e inicio del evento; el calentamiento empieza al llegar (salida + viaje). Sin viaje
//   calculado no se sabe cuándo se llega: sin calentamiento (no se inventa uno que podría ser antes de salir).
// - Calentamiento (en casa): calentamiento e inicio del evento.
// El 2.º partido del día apunta al 1.º (salidaPrimero), así que sigue su salida sin más.
export function aplicarManuales(partidos, datos) {
  let aplicadas = 0;
  const caducadas = [];
  for (const p of partidos) {
    const id = idPartido(p);
    const d = id && Object.hasOwn(datos, id) ? datos[id] : null;
    if (!d || typeof d !== 'object') continue;
    const fecha = fmt(p.fecha, 'yyyy-MM-dd HH:mm');
    const hora = txt(d.hora);
    let motivo = '';
    if (!conHora(p) || fecha !== d.partido) motivo = `era el ${d.partido} y ahora ${conHora(p) ? `es el ${fecha}` : 'no tiene hora'}`;
    else if (p.segundo) motivo = 'ahora es el 2.º partido del día (va con el 1.º)';
    else if (d.tipo === 'salida' && p.enCasa) motivo = 'era una salida en bus y ahora se juega en casa';
    else if (d.tipo === 'calentamiento' && !p.enCasa) motivo = 'era un calentamiento en casa y ahora se juega fuera';
    else if (!TIPOS.includes(d.tipo) || !RE_HORA.test(hora) || hora >= fmt(p.fecha, 'HH:mm')) {
      motivo = `la hora (${hora}) no es antes del partido (${fmt(p.fecha, 'HH:mm')})`;
    }
    const [h, m] = hora.split(':').map(Number);
    const cuando = motivo ? null : fechaPared(p.fecha.getUTCFullYear(), p.fecha.getUTCMonth() + 1, p.fecha.getUTCDate(), h, m);
    const llegada = cuando && d.tipo === 'salida' && p.viajeMin != null ? sumarMinutos(cuando, p.viajeMin) : null;
    if (llegada && llegada >= p.fecha) {
      motivo = `con la salida a las ${hora} y ${formatDuracion(p.viajeMin)} de viaje se llegaría a las ${fmt(llegada, 'HH:mm')}, y el partido es a las ${fmt(p.fecha, 'HH:mm')}`;
    }
    if (motivo) {
      caducadas.push(`${d.texto}: ${motivo}`);
      continue;
    }
    if (d.tipo === 'salida') {
      p.salida = cuando;
      p.calentamiento = llegada;
    } else {
      p.calentamiento = cuando;
    }
    p.inicio = cuando;
    p.horaManual = true;
    aplicadas++;
  }
  return { aplicadas, caducadas };
}

// Por consola (el workflow).
function esPrograma() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (esPrograma()) {
  try {
    const cambio = interpretarCambio(process.env.PARTIDO, process.env.HORA, process.env.TIPO);
    const ruta = resolve(process.env.ARCHIVO || 'salidas-manuales.json');
    guardarManuales(ruta, aplicarCambio(leerManuales(ruta, { estricto: true }), cambio));
    console.log(`  Hora a mano: ${cambio.texto} (${cambio.partido}) → ${cambio.hora ? `${cambio.tipo} ${cambio.hora}` : 'vuelve a la calculada'}`);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    process.exitCode = 1;
  }
}
