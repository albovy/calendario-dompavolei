// Partidos de prueba para enseñar la página (config.json › "demo": true): dos partidos inventados, uno fuera y
// otro en casa, con todo lo de los de verdad (salida en bus, mapa, WhatsApp, pedir bus). Solo van a la página,
// y la página solo los enseña con «?demo» en la dirección: no llegan al .ics (a los calendarios de las
// familias), ni al Excel, ni al historial.

import { anadirSalidas } from './salidas.js';
import { anioTemporada, fechaPared, fmt, soloDia, sumarDias } from './util.js';

export const RIVAL_DEMO = 'EQUIPO DE PRUEBA';
export const COMPETICION_DEMO = 'PARTIDO DE PRUEBA';
const PABELLON_DEMO = 'PABELLÓN DE PRUEBA';

// partidos: los reales, ya con sus salidas (de ellos salen un pabellón de fuera con viaje calculado y el de
// casa); equipos: los del club (los dos primeros juegan los de prueba). El día: el primero desde mañana en que
// no juega ninguno de los dos, para que no se mezclen con los reales (mensaje de WhatsApp, 2.º partido).
export function partidosDemo({ partidos, equipos, pabellones = null, salidas = null, hoy }) {
  if (!equipos.length) return [];
  const [fuera, casa = fuera] = equipos;
  const suyos = new Set([fuera.nombre, casa.nombre]);
  const conPartido = new Set(partidos.filter((p) => p.nuestros.some((n) => suyos.has(n))).map((p) => fmt(p.fecha, 'yyyy-MM-dd')));
  let dia = sumarDias(soloDia(hoy), 1);
  while (conPartido.has(fmt(dia, 'yyyy-MM-dd'))) dia = sumarDias(dia, 1);
  const [a, m, d] = [dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate()];
  const pabFuera = partidos.find((p) => p.condicion === 'visitante' && p.viajeMin != null && !p.segundo)?.pabellon || PABELLON_DEMO;
  const pabCasa = partidos.find((p) => p.enCasa)?.pabellon || PABELLON_DEMO;
  const demo = [
    crear(fuera, 'visitante', fechaPared(a, m, d, 12, 0), pabFuera),
    crear(casa, 'local', fechaPared(a, m, d, 18, 0), pabCasa),
  ];
  if (salidas && pabellones) anadirSalidas(demo, pabellones, salidas);
  return demo;
}

// Un partido con la misma forma que los de convertirPartidos (partidos.js), marcado con demo.
function crear(equipo, condicion, fecha, pabellon) {
  const enCasa = condicion === 'local';
  return {
    fecha,
    temporada: anioTemporada(fecha),
    estado: 'confirmada',
    local: enCasa ? equipo.nombre : RIVAL_DEMO,
    visitante: enCasa ? RIVAL_DEMO : equipo.nombre,
    esLocal: enCasa,
    esVisitante: !enCasa,
    condicion,
    nuestros: [equipo.nombre],
    rival: RIVAL_DEMO,
    competicion: COMPETICION_DEMO,
    categoria: equipo.categoria,
    claveCategoria: equipo.claveCategoria,
    ordenCategoria: equipo.ordenCategoria,
    pabellon,
    uid: '',
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
    demo: true,
  };
}
