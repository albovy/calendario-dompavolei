// Pruebas de src/resultados.js sin red: lectura de las páginas de iSquad (recortes reales guardados en
// test/datos), emparejado con los partidos, qué se consulta y cuándo, y resultados.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  anotarGrupos, anotarResultados, buscarFila, competicionesSinNumero, esperaResultado, gruposAConsultar, leerArbol,
  leerClasificacion, leerGrupos, leerResultados, leerToken,
} from '../src/resultados.js';
import { fechaPared } from '../src/util.js';

const DOMPA = '206572580';
function pagina(nombre) { return readFileSync(new URL(`./datos/${nombre}`, import.meta.url), 'utf8'); }

test('leerToken: el código de acceso que llevan las páginas', () => {
  assert.equal(leerToken('<script>\n  token = "8c513fc98f8c16511d3876664456eef6"\n</script>'), '8c513fc98f8c16511d3876664456eef6');
  assert.equal(leerToken('<html>sin código</html>'), '');
});

test('leerArbol: número de cada competición y de sus grupos, por la clave del nombre', () => {
  const json = JSON.stringify([{ id: '387', nombre: 'TORNEO APERTURA 2026', competiciones: [
    { id: '1511', nombre: 'TORNEO APERTURA INFANTIL F', torneos: [{ id: '4064', grupo: 'GRUPO H' }, { id: '3818' }] },
    // Nombre mal codificado en la federación ("DIPUTACIÃ“N"): se repara.
    { id: '1600', nombre: `COPA DIPUTACI${String.fromCharCode(0xC3, 0x201C)}N`, torneos: [] },
  ] }]);
  const arbol = leerArbol(json);
  assert.deepEqual(arbol.get('TORNEO APERTURA INFANTIL F'), { id: '1511', torneos: ['4064', '3818'] });
  assert.deepEqual(arbol.get('COPA DIPUTACION'), { id: '1600', torneos: [] });
  assert.equal(leerArbol('[]').size, 0);
  assert.throws(() => leerArbol('<html>'));
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

test('leerResultados: partidos del grupo con marcador, sets, día y hora', () => {
  const filas = leerResultados(pagina('grupo-4056.html'));
  assert.equal(filas.length, 3);
  assert.deepEqual(filas[1], {
    local: 'CLUB VOLEIBOL SANTIAGO', visitante: 'DOMPAVOLEI CF1', clubLocal: '206572589', clubVisitante: DOMPA,
    dia: '2026-09-19', hora: '11:30', estado: 'Finalizado', marcador: [3, 2],
    sets: [[25, 16], [23, 25], [24, 26], [27, 25], [15, 8]],
  });
  assert.deepEqual(filas[2].sets, [[25, 8], [25, 20], [19, 25], [25, 4]]);
  // Por jugar: sin marcador ni sets; "0:00" es que aún no tiene hora.
  const pendientes = leerResultados(pagina('grupo-3818.html'));
  assert.equal(pendientes.length, 6);
  assert.deepEqual(pendientes[0], {
    local: 'SEI SAN NARCISO IF', visitante: 'DOMPAVOLEI IF1', clubLocal: '206572677', clubVisitante: DOMPA,
    dia: '2026-09-26', hora: '10:00', estado: 'Pendiente', marcador: null, sets: [],
  });
  assert.deepEqual([pendientes[3].dia, pendientes[3].hora], ['2026-10-03', '']);
  assert.equal(leerResultados('<html>otra cosa</html>'), null);
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
  assert.deepEqual(g.partidos[0], {
    local: 'EMEVÉ COLEXIO SAN LORENZO IF', visitante: 'DOMPAVOLEI IF1', dia: '2026-09-19', hora: '10:00',
    estado: 'Finalizado', marcador: [0, 3], sets: [[24, 26], [23, 25], [20, 25]],
  });
  assert.match(g.firma, /^[0-9a-f]{16}$/);
  assert.deepEqual([cache.grupos['3818'].terminado, cache.grupos['3818'].partidos.length], [false, 4]);
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

test('esperaResultado: desde 2 h después del partido (sin hora, desde el día siguiente) y durante 14 días', () => {
  const p = partido(fechaPared(2026, 9, 26, 11, 30), 'DOMPAVOLEI IF1', 'CV OLEIROS IFA');
  assert.equal(esperaResultado(p, fechaPared(2026, 9, 26, 13, 29)), false);
  assert.equal(esperaResultado(p, fechaPared(2026, 9, 26, 13, 30)), true);
  assert.equal(esperaResultado(p, fechaPared(2026, 10, 10, 23, 59)), true);
  assert.equal(esperaResultado(p, fechaPared(2026, 10, 11, 0, 0)), false);
  const sinHora = partido(fechaPared(2026, 10, 3), 'CV OLEIROS IFA', 'DOMPAVOLEI IF1', { estado: 'sinhora' });
  assert.equal(esperaResultado(sinHora, fechaPared(2026, 10, 3, 23, 59)), false);
  assert.equal(esperaResultado(sinHora, fechaPared(2026, 10, 4, 0, 0)), true);
});

test('competicionesSinNumero: las que no se conocen y, las que no estaban en el árbol, un día después', () => {
  const cache = { temporada: 2026, clubs: [DOMPA], grupos: {}, competiciones: {
    'NO ESTA': { id: '', torneos: [], revisado: '2026-09-26 00:30' }, [APERTURA]: { id: '1511', torneos: [], revisado: '' },
  } };
  const f = fechaPared(2026, 10, 3, 10, 0);
  const ps = [partido(f, 'DOMPAVOLEI IF1', 'X', { competicion: 'NO ESTA' }), partido(f, 'DOMPAVOLEI IF1', 'X', { competicion: 'NUEVA' }), partido(f, 'DOMPAVOLEI IF1', 'X')];
  assert.deepEqual(competicionesSinNumero(cache, ps, fechaPared(2026, 9, 26, 10, 0)), ['NUEVA']);
  assert.deepEqual(competicionesSinNumero(cache, ps, fechaPared(2026, 9, 26, 20, 30)), ['NO ESTA', 'NUEVA']);
});

test('gruposAConsultar: lo pendiente de resultado, el repaso diario y los grupos nuevos', () => {
  const cache = cacheDePrueba();
  const jugado = partido(fechaPared(2026, 9, 19, 10, 0), 'EMEVÉ COLEXIO SAN LORENZO IF', 'DOMPAVOLEI IF1');
  const hoy = partido(fechaPared(2026, 9, 26, 11, 30), 'DOMPAVOLEI IF1', 'CV OLEIROS IFA');
  const plan = (ps, ahora) => {
    const r = gruposAConsultar(cache, ps, ahora);
    return { descubrir: [...r.descubrir], grupos: [...r.grupos] };
  };
  // Recién consultado y nada pendiente: nada.
  assert.deepEqual(plan([jugado, hoy], fechaPared(2026, 9, 26, 10, 0)), { descubrir: [], grupos: [] });
  // A las 13:30 el partido de las 11:30 ya tendría que tener resultado: su grupo.
  assert.deepEqual(plan([jugado, hoy], fechaPared(2026, 9, 26, 13, 30)), { descubrir: [], grupos: ['3818'] });
  // 20 h después, repaso de los grupos sin terminar (el 4064 ya terminó).
  assert.deepEqual(plan([jugado], fechaPared(2026, 9, 26, 20, 30)), { descubrir: [], grupos: ['3818'] });
  // Un partido que no está en ningún grupo conocido: se mira la lista de grupos, como mucho cada 20 h.
  const nuevo = partido(fechaPared(2026, 10, 17, 10, 0), 'DOMPAVOLEI IF1', 'OTRO EQUIPO');
  assert.deepEqual(plan([nuevo], fechaPared(2026, 9, 26, 10, 0)), { descubrir: [], grupos: [] });
  assert.deepEqual(plan([nuevo], fechaPared(2026, 9, 26, 20, 30)).descubrir, [APERTURA]);
  // Grupo nunca consultado: se consulta ya.
  cache.grupos['3818'].consultado = '';
  assert.deepEqual(plan([jugado], fechaPared(2026, 9, 26, 10, 0)).grupos, ['3818']);
});
