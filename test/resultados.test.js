// Pruebas de src/resultados.js sin red: lectura de las páginas de iSquad (recortes reales guardados en
// test/datos), emparejado con los partidos, qué se consulta y cuándo, y resultados.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leerArbol, leerClasificacion, leerGrupos, leerResultados, leerToken } from '../src/resultados.js';

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
