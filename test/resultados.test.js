// Pruebas de src/resultados.js sin red: lectura de las páginas de iSquad (recortes reales guardados en
// test/datos), emparejado con los partidos y clasificaciones. La descarga es de federacion.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  anadirResultados, anotarGrupos, anotarResultados, buscarFila, clasificaciones, leerClasificacion, leerGrupos,
  leerResultados, repararNombre,
} from '../src/resultados.js';
import { fechaPared } from '../src/util.js';

const DOMPA = '206572580';
function pagina(nombre) { return readFileSync(new URL(`./datos/${nombre}`, import.meta.url), 'utf8'); }

test('resultados.js ya no descarga nada: ni el árbol de competiciones (bajo /json/, con código de acceso) ni páginas de grupo', async () => {
  const modulo = await import('../src/resultados.js');
  for (const nombre of ['actualizarResultados', 'leerToken', 'leerArbol', 'competicionesSinNumero', 'gruposAConsultar', 'URL_ARBOL',
    'leerCacheResultados']) {
    assert.equal(modulo[nombre], undefined, nombre);
  }
  const fuente = readFileSync(new URL('../src/resultados.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fuente, /\bpeticion\b|\bfetch\b|json\/api|token/);
});

test('repararNombre: UTF-8 leído como Windows-1252 («EMEVÃ‰»); si no sale bien, se deja igual', () => {
  assert.equal(repararNombre(`EMEV${String.fromCharCode(0xC3, 0x2030)}`), 'EMEVÉ');
  assert.equal(repararNombre(`COPA DIPUTACI${String.fromCharCode(0xC3, 0x201C)}N`), 'COPA DIPUTACIÓN');
  assert.equal(repararNombre('ÃRBOL ROTO Ã'), 'ÃRBOL ROTO Ã');
  assert.equal(repararNombre('DOMPAVOLEI'), 'DOMPAVOLEI');
});

test('leerGrupos: grupos de la competición con sus equipos y su club (por el escudo)', () => {
  const grupos = leerGrupos(pagina('grupo-4064.html'));
  assert.equal(grupos.length, 15);
  const h = grupos.find((g) => g.torneo === '4064');
  assert.equal(h.nombre, 'PRIMERA FASE - GRUPO H');
  assert.deepEqual(h.equipos, [
    { nombre: 'CLUB VOLEIBOL PONTEVEDRA IF2', club: '206572577' },
    { nombre: 'DOMPAVOLEI IF1', club: DOMPA },
    { nombre: 'EMEVÉ COLEXIO SAN LORENZO IF', club: '206572578' },   // venía como "EMEVÃ‰"
  ]);
  assert.deepEqual(grupos.filter((g) => g.equipos.some((e) => e.club === DOMPA)).map((g) => g.torneo), ['4064', '3818']);
  assert.equal(leerGrupos('<html>otra cosa</html>'), null);
});

test('leerResultados: partidos del grupo con marcador, sets, día y hora (formato de septiembre: la hora delante)', () => {
  const filas = leerResultados(pagina('grupo-4056.html'));
  assert.equal(filas.length, 3);
  // Antes no había data-id ni mostrarLugar: el pabellón es el texto del enlace al mapa, sin dirección.
  assert.deepEqual(filas[1], {
    id: '', local: 'CLUB VOLEIBOL SANTIAGO', visitante: 'DOMPAVOLEI CF1', clubLocal: '206572589', clubVisitante: DOMPA,
    dia: '2026-09-19', hora: '11:30', estado: 'Finalizado', marcador: [3, 2],
    sets: [[25, 16], [23, 25], [24, 26], [27, 25], [15, 8]],
    campo: 'CARBALLO CALERO - PISTA CENTRAL', lugar: { lat: 43.2172814, lon: -8.696862, direccion: '' },
  });
  assert.deepEqual(filas[2].sets, [[25, 8], [25, 20], [19, 25], [25, 4]]);
  // Por jugar: sin marcador ni sets; "0:00" es que aún no tiene hora.
  const pendientes = leerResultados(pagina('grupo-3818.html'));
  assert.equal(pendientes.length, 6);
  assert.deepEqual(pendientes[0], {
    id: '', local: 'SEI SAN NARCISO IF', visitante: 'DOMPAVOLEI IF1', clubLocal: '206572677', clubVisitante: DOMPA,
    dia: '2026-09-26', hora: '10:00', estado: 'Pendiente', marcador: null, sets: [],
    campo: 'PABELLÓN COLEGIO SAN NARCISO - PISTA 1', lugar: { lat: 42.3889453, lon: -8.7078004, direccion: '' },
  });
  assert.deepEqual([pendientes[3].dia, pendientes[3].hora], ['2026-10-03', '']);
  assert.equal(leerResultados('<html>otra cosa</html>'), null);
});

// Recorte de la página del grupo 3941 (2ªDIV. XUVENIL FEMENINA) del 06/11/2026, con el formato nuevo.
const LIGA_XF = 'grupo-3941-2026-11.html';

test('leerResultados: formato de noviembre de 2026 (fecha delante, data-id, pabellón con coordenadas y dirección)', () => {
  const filas = leerResultados(pagina(LIGA_XF));
  assert.deepEqual(filas.map((f) => f.id), ['98186', '98188', '98193', '98199', '98202', '98209', '98247']);
  // Finalizado: marcador y los cinco sets; el pabellón, del <span>, y su sitio, de mostrarLugar.
  assert.deepEqual(filas[0], {
    id: '98186', local: 'COLEGIO LICEO LA PAZ', visitante: 'CLUB VOLEIBOL SANTIAGO', clubLocal: '206572593',
    clubVisitante: '206572589', dia: '2026-10-25', hora: '11:30', estado: 'Finalizado', marcador: [3, 2],
    sets: [[25, 19], [10, 25], [22, 25], [25, 17], [16, 14]], campo: 'LICEO LA PAZ - PISTA 2',
    lugar: { lat: 43.3417503, lon: -8.4018856, direccion: 'RúA SEBASTIáN MARTíNEZ RISCO, 12, 15009 A CORUñA, ESPAñA, 15009' },
  });
  // Pabellón con <br>: las dos líneas, como pabellon() (igual que el 2.º dato de mostrarLugar).
  assert.equal(filas[2].campo, 'ANEXO PM OS REMEDIOS - ANEXO OS REMEDIOS - PISTA 2');
  assert.deepEqual(filas[2].lugar, { lat: 42.3442759, lon: -7.871394800000001, direccion: 'RúA PARDO DE CELA, 2, 32002 OURENSE, ESPAñA, 32003' });
  // Por jugar con hora: la página pone «0 - 0», pero todavía no hay marcador.
  assert.deepEqual(filas[3], {
    id: '98199', local: 'XAV CAMBADOS AZUL', visitante: 'DOMPAVOLEI XF1', clubLocal: '206572588', clubVisitante: DOMPA,
    dia: '2026-11-08', hora: '11:30', estado: 'Pendiente', marcador: null, sets: [], campo: 'RAMON CABANILLAS - PISTA 2',
    lugar: { lat: 42.5196857, lon: -8.810736499999999, direccion: 'AV. ROSALíA DE CASTRO, 18, 36630 CAMBADOS, PONTEVEDRA, ESPAñA, 36630' },
  });
  // «0:00»: el día, sin hora.
  assert.deepEqual([filas[4].dia, filas[4].hora, filas[4].marcador, filas[4].campo], ['2026-11-14', '', null, 'A CARBALLEIRA']);
  // Sin pabellón: la celda viene vacía.
  assert.deepEqual([filas[6].local, filas[6].visitante, filas[6].dia, filas[6].hora, filas[6].campo, filas[6].lugar],
    ['CV CIUDAD DE A CORUÑA JF B', 'DOMPAVOLEI XF1', '2027-02-13', '', '', null]);
});

test('leerResultados: la fecha en los dos órdenes; una fecha que no existe se queda vacía', () => {
  const fila = (fecha) => `RESULTADOS DE LA COMPETICIÓN<table><tr class="partido" data-id="1"><td><div class="equipos-col">`
    + `<div class="nombres-equipos"><a>A</a> - <a>B</a></div></div></td>${'<td></td>'.repeat(6)}<td>${fecha}</td>`
    + '<td class="col-lugar"></td><td>Pendiente</td><td></td><td></td></tr></table>';
  const leer = (fecha) => { const [f] = leerResultados(fila(fecha)); return [f.dia, f.hora]; };
  assert.deepEqual(leer("<div class='negrita'>07/11/2026 </div>\n<div>17:00</div>"), ['2026-11-07', '17:00']);
  assert.deepEqual(leer("<div >9:30</div><div class='negrita'>07/11/2026 </div>"), ['2026-11-07', '09:30']);
  assert.deepEqual(leer("<div class='negrita'>07/11/2026 </div><div>0:00</div>"), ['2026-11-07', '']);
  assert.deepEqual(leer("<div class='negrita'>07/11/2026 </div>"), ['2026-11-07', '']);
  assert.deepEqual(leer("<div class='negrita'>31/02/2027 </div><div>10:00</div>"), ['', '']);
  assert.deepEqual(leer(''), ['', '']);
});

test('leerGrupos y leerClasificacion: también con las páginas de noviembre de 2026', () => {
  const [grupo, ...otros] = leerGrupos(pagina(LIGA_XF));
  assert.equal(otros.length, 0);   // los grupos de la segunda fase aún no tienen equipos
  assert.deepEqual([grupo.torneo, grupo.nombre, grupo.equipos.length], ['3941', 'PRIMERA FASE - LIGA REGULAR', 10]);
  assert.deepEqual(grupo.equipos.filter((e) => e.club === DOMPA), [{ nombre: 'DOMPAVOLEI XF1', club: DOMPA }]);
  const tabla = leerClasificacion(pagina('clasificacion-3857-2026-11.html'));
  assert.equal(tabla.length, 10);
  assert.deepEqual(tabla[0], { pos: 1, equipo: 'CLUB VOLEIBOL SANTIAGO', club: '206572589', pt: 8, pj: 3, pg: 3, pp: 0, sf: 9, sc: 2 });
  assert.deepEqual(tabla[8], { pos: 9, equipo: 'DOMPAVOLEI SM1', club: DOMPA, pt: 0, pj: 3, pg: 0, pp: 3, sf: 2, sc: 9 });
});

test('leerClasificacion: la tabla del grupo; sin clasificación, null', () => {
  assert.deepEqual(leerClasificacion(pagina('clasificacion-4064.html')), [
    { pos: 1, equipo: 'DOMPAVOLEI IF1', club: DOMPA, pt: 6, pj: 2, pg: 2, pp: 0, sf: 6, sc: 0 },
    { pos: 2, equipo: 'EMEVÉ COLEXIO SAN LORENZO IF', club: '206572578', pt: 3, pj: 2, pg: 1, pp: 1, sf: 3, sc: 4 },
    { pos: 3, equipo: 'CLUB VOLEIBOL PONTEVEDRA IF2', club: '206572577', pt: 0, pj: 2, pg: 0, pp: 2, sf: 1, sc: 6 },
  ]);
  assert.equal(leerClasificacion(pagina('clasificacion-3818.html')).length, 3);
  assert.equal(leerClasificacion("<h2 style='text-align: center;'>Clasificación NO DISPONIBLE PARA ESTA COMPETICIÓN</h2>"), null);
  assert.equal(leerClasificacion('<html>otra cosa</html>'), null);
});

const APERTURA = 'TORNEO APERTURA INFANTIL F';
const AHORA = fechaPared(2026, 9, 26, 0, 30);

// Partido de la agenda (como los de convertirPartidos, con lo que usa resultados.js).
function partido(fecha, local, visitante, cambios = {}) {
  const esL = local.startsWith('DOMPAVOLEI');
  const esV = visitante.startsWith('DOMPAVOLEI');
  return {
    fecha, temporada: 2026, estado: 'confirmada', local, visitante, esLocal: esL, esVisitante: esV,
    condicion: esL && esV ? 'derbi' : esL ? 'local' : 'visitante',
    nuestros: [esL ? local : '', esV ? visitante : ''].filter((n) => n),
    rival: esL && !esV ? visitante : esV && !esL ? local : '', competicion: APERTURA, ...cambios,
  };
}

// Caché con los grupos 4064 (primera fase, terminada) y 3818 (segunda fase, por jugar) consultados a las 0:30 del 26/09.
function cacheDePrueba() {
  const cache = { temporada: 2026, clubs: [DOMPA], competiciones: { [APERTURA]: { id: '1511', torneos: ['4064', '3818'], revisado: '2026-09-26 00:30' } }, grupos: {} };
  const esNuestro = (_nombre, club) => club === DOMPA;
  anotarGrupos(cache, APERTURA, '1511', leerGrupos(pagina('grupo-4064.html')), esNuestro);
  anotarResultados(cache.grupos['4064'], leerResultados(pagina('grupo-4064.html')), esNuestro, AHORA);
  anotarResultados(cache.grupos['3818'], leerResultados(pagina('grupo-3818.html')), esNuestro, AHORA);
  return cache;
}

test('anotarGrupos y anotarResultados: solo los grupos y los partidos del club', () => {
  const cache = cacheDePrueba();
  assert.deepEqual(Object.keys(cache.grupos), ['3818', '4064']);
  const g = cache.grupos['4064'];
  assert.deepEqual([g.competicion, g.id_competicion, g.nombre, g.equipos], [APERTURA, '1511', 'PRIMERA FASE - GRUPO H', ['DOMPAVOLEI IF1']]);
  assert.deepEqual([g.consultado, g.terminado, g.partidos.length], ['2026-09-26 00:30', true, 2]);
  // Cada partido con todo lo que trae la página (también lo que hace falta para el calendario).
  assert.deepEqual(g.partidos[0], {
    id: '', local: 'EMEVÉ COLEXIO SAN LORENZO IF', visitante: 'DOMPAVOLEI IF1', clubLocal: '206572578', clubVisitante: DOMPA,
    dia: '2026-09-19', hora: '10:00', estado: 'Finalizado', marcador: [0, 3], sets: [[24, 26], [23, 25], [20, 25]],
    campo: 'POLIDEPORTIVO DE LOS INSTITUTOS, PISTA 2', lugar: { lat: 43.0065845, lon: -7.557476400000001, direccion: '' },
  });
  assert.match(g.firma, /^[0-9a-f]{16}$/);
  assert.deepEqual([cache.grupos['3818'].terminado, cache.grupos['3818'].partidos.length], [false, 4]);
  // Un grupo que aún no tiene partidos (sin calendario): ni terminado ni firma (no hay clasificación que pedir).
  const vacio = { firma: 'x', partidos: [{ local: 'A' }] };
  anotarResultados(vacio, [], () => true, AHORA);
  assert.deepEqual([vacio.consultado, vacio.terminado, vacio.firma, vacio.partidos], ['2026-09-26 00:30', false, '', []]);
});

test('buscarFila: mismo local, visitante y día; si cambió el día, el cruce si solo hay uno', () => {
  const cache = cacheDePrueba();
  const ida = partido(fechaPared(2026, 9, 19, 10, 0), 'EMEVÉ COLEXIO SAN LORENZO IF', 'DOMPAVOLEI IF1');
  assert.equal(buscarFila(ida, cache.grupos).torneo, '4064');
  assert.deepEqual(buscarFila(ida, cache.grupos).fila.marcador, [0, 3]);
  const movido = partido(fechaPared(2026, 9, 20, 12, 0), 'EMEVÉ COLEXIO SAN LORENZO IF', 'DOMPAVOLEI IF1');
  assert.equal(buscarFila(movido, cache.grupos).fila.dia, '2026-09-19');
  // SAN NARCISO - IF1 se juega dos veces (26/09 y 03/10): cada una por su día; otro día, ninguna.
  const d26 = partido(fechaPared(2026, 9, 26, 10, 0), 'SEI SAN NARCISO IF', 'DOMPAVOLEI IF1');
  const d03 = partido(fechaPared(2026, 10, 3), 'SEI SAN NARCISO IF', 'DOMPAVOLEI IF1', { estado: 'sinhora' });
  assert.equal(buscarFila(d26, cache.grupos).fila.dia, '2026-09-26');
  assert.equal(buscarFila(d03, cache.grupos).fila.dia, '2026-10-03');
  assert.equal(buscarFila(partido(fechaPared(2026, 10, 10), 'SEI SAN NARCISO IF', 'DOMPAVOLEI IF1'), cache.grupos), null);
  assert.equal(buscarFila({ ...ida, competicion: 'OTRA' }, cache.grupos), null);
  assert.equal(buscarFila(partido(fechaPared(2026, 9, 19, 10, 0), 'DOMPAVOLEI IF1', 'EMEVÉ COLEXIO SAN LORENZO IF'), cache.grupos), null);
});

const IDS = new Set([DOMPA]);
// Partidos del IF1 en el Apertura (19/09 primera fase; 26/09 segunda fase).
const PARTIDOS = [
  partido(fechaPared(2026, 9, 19, 10, 0), 'EMEVÉ COLEXIO SAN LORENZO IF', 'DOMPAVOLEI IF1'),
  partido(fechaPared(2026, 9, 26, 11, 30), 'DOMPAVOLEI IF1', 'CV OLEIROS IFA'),
];

test('anadirResultados: marcador y sets de los partidos finalizados; el resto, null', () => {
  const cache = cacheDePrueba();
  const [ida, hoy] = PARTIDOS.map((p) => ({ ...p }));
  const anterior = { ...PARTIDOS[0], temporada: 2025 };
  anadirResultados([ida, hoy, anterior], cache);
  assert.deepEqual(ida.resultado, { marcador: [0, 3], sets: [[24, 26], [23, 25], [20, 25]] });
  assert.equal(hoy.resultado, null);
  assert.equal(anterior.resultado, null);
});

test('clasificaciones: la del grupo del próximo partido del equipo o, si no le quedan, la del último', () => {
  const cache = cacheDePrueba();
  cache.grupos['4064'].clasificacion = leerClasificacion(pagina('clasificacion-4064.html'));
  cache.grupos['3818'].clasificacion = leerClasificacion(pagina('clasificacion-3818.html'));
  const equipos = [{ nombre: 'DOMPAVOLEI IF1' }, { nombre: 'DOMPAVOLEI CF1' }];
  const lista = clasificaciones(equipos, cache, IDS, fechaPared(2026, 9, 25, 12, 0));
  assert.equal(lista.length, 1);   // el CF1 no tiene grupos en la caché
  const [if1] = lista;
  assert.deepEqual([if1.equipo, if1.competicion, if1.grupo], ['DOMPAVOLEI IF1', APERTURA, 'SEGUNDA FASE - GRUPO 1']);
  assert.equal(if1.url, 'https://resultadosvoleibol.isquad.es/clasificacion.php?seleccion=0&id=3818&id_ambito=6&id_territorial=20&id_superficie=1&iframe=0&id_competicion=1511');
  assert.equal(if1.actualizado.getTime(), AHORA.getTime());
  assert.deepEqual(if1.filas.filter((f) => f.nuestro).map((f) => f.equipo), ['DOMPAVOLEI IF1']);
  // Sin partidos por jugar en ningún grupo: la del último jugado.
  cache.grupos['3818'].equipos = [];
  assert.equal(clasificaciones(equipos, cache, IDS, fechaPared(2026, 9, 25, 12, 0))[0].grupo, 'PRIMERA FASE - GRUPO H');
});

test('clasificaciones: con la fecha de las páginas de noviembre de 2026, la de la liga (por jugar) y no la del Apertura', () => {
  const esNuestro = (_nombre, club) => club === DOMPA;
  const tabla = [{ pos: 1, equipo: 'DOMPAVOLEI XF1', club: DOMPA, pt: 3, pj: 1, pg: 1, pp: 0, sf: 3, sc: 0 }];
  const cache = { temporada: 2026, clubs: [DOMPA], competiciones: {}, grupos: {
    // El Apertura, ya terminado (su último partido, el 04/10).
    3788: {
      competicion: 'TORNEO APERTURA XUVENIL F', id_competicion: '1507', nombre: 'SEGUNDA FASE - GRUPO 3', equipos: ['DOMPAVOLEI XF1'],
      consultado: '2026-10-04 16:17', terminado: true, firma: 'x', firma_clasificacion: 'x', clasificacion: tabla,
      partidos: [{ local: 'DOMPAVOLEI XF1', visitante: 'RIVAL', dia: '2026-10-04', hora: '10:00', estado: 'Finalizado', marcador: [3, 0], sets: [] }],
    },
  } };
  const ahora = fechaPared(2026, 11, 6, 20, 0);
  anotarGrupos(cache, '2ªDIV. XUVENIL FEMENINA', '1537', leerGrupos(pagina(LIGA_XF)), esNuestro);
  anotarResultados(cache.grupos['3941'], leerResultados(pagina(LIGA_XF)), esNuestro, ahora);
  cache.grupos['3941'].clasificacion = leerClasificacion(pagina('clasificacion-3857-2026-11.html'));
  const [xf1] = clasificaciones([{ nombre: 'DOMPAVOLEI XF1' }], cache, IDS, ahora);
  assert.deepEqual([xf1.competicion, xf1.grupo], ['2ªDIV. XUVENIL FEMENINA', 'PRIMERA FASE - LIGA REGULAR']);
});

test('clasificaciones: un grupo de la temporada pasada (en agosto, aún en config.json) no es el actual de nadie', () => {
  const tabla = [{ pos: 1, equipo: 'DOMPAVOLEI IF1', club: DOMPA, pt: 3, pj: 1, pg: 1, pp: 0, sf: 3, sc: 0 }];
  const grupo = (dias, clasificacion) => ({
    competicion: APERTURA, id_competicion: '1511', nombre: 'G', equipos: ['DOMPAVOLEI IF1'], consultado: '2027-09-20 10:00', terminado: false,
    firma: 'x', firma_clasificacion: 'x', clasificacion,
    partidos: dias.map((dia) => ({ local: 'DOMPAVOLEI IF1', visitante: 'RIVAL', dia, hora: '10:00', estado: 'Finalizado', marcador: [3, 0], sets: [] })),
  });
  // La caché de la temporada 2027/28 con el grupo de la 2026/27 (todo jugado antes del 1/08/2027) y el nuevo, aún sin tabla.
  const cache = { temporada: 2027, clubs: [DOMPA], competiciones: {}, grupos: { 1001: grupo(['2027-03-06'], tabla), 2001: grupo(['2027-09-25'], null) } };
  assert.deepEqual(clasificaciones([{ nombre: 'DOMPAVOLEI IF1' }], cache, IDS, fechaPared(2027, 9, 20, 10, 0)), []);
});
