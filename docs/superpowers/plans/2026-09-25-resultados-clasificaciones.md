# Resultados y clasificaciones · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** que la web y el calendario enseñen el resultado de los partidos jugados y la clasificación
del grupo de cada equipo de Dompavolei (temporada en curso).

**Arquitectura:** un módulo nuevo, `src/resultados.js`, lee las páginas de resultados de iSquad (árbol de
competiciones, página de un grupo, clasificación), decide qué grupos consultar y guarda todo en
`resultados.json`. `main.js` lo llama tras calcular las salidas; `ics.js` pone el marcador en el título;
`html.js` y `plantilla.html` enseñan el resultado en cada partido y una vista «Clasificación».

**Tecnología:** Node ≥ 20 sin dependencias, `node:test`. Diseño: `docs/superpowers/specs/2026-09-25-resultados-clasificaciones-design.md`.

Convenciones del repositorio: textos y comentarios en español, fechas «de pared» (Date cuyos campos UTC
son la hora de Galicia, leídas con `getUTC*`), avisos con `aviso()` y pasos con `paso()` de `src/util.js`.
Commits con `git -c user.name=albovy -c user.email=25620656+albovy@users.noreply.github.com commit` y la
línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Archivos

| Archivo | Qué |
|---|---|
| `test/datos/*.html` (nuevos) | Recortes reales de iSquad: lista de grupos + resultados de los grupos 4064, 3818 y 4056; clasificaciones 4064 y 3818. Solo equipos y marcadores. |
| `src/isquad.js` | `peticion(ruta, datos, { base, esperas })`: otra web de iSquad y menos reintentos. |
| `src/resultados.js` (nuevo) | Lectores de páginas, emparejado, decisiones, `resultados.json`, `actualizarResultados`, `anadirResultados`, `clasificaciones`. |
| `test/resultados.test.js` (nuevo) | Pruebas del módulo con los recortes y `fetch` simulado. |
| `src/ics.js` | Título y detalle con resultado. |
| `src/html.js` | `r` en cada partido y `clas` en los datos de la página. |
| `src/plantilla.html` | Resultado en las tarjetas, vista «Clasificación», tabla al filtrar por equipo. |
| `src/main.js` | Llama a los resultados; `rutasConfig` con `resultados.json`. |
| `.github/workflows/calendario.yml` | Sube `resultados.json`. |
| `README.md` | Explica resultados y clasificaciones. |

---

### Tarea 1: Recortes de iSquad para las pruebas

**Archivos:** crear `test/datos/grupo-4064.html`, `grupo-3818.html`, `grupo-4056.html`,
`clasificacion-4064.html`, `clasificacion-3818.html`.

- [ ] **Paso 1: descargar las páginas reales** (en la carpeta de trabajo, fuera del repositorio)

```bash
B='https://resultadosvoleibol.isquad.es'
Q='seleccion=0&id_ambito=6&id_territorial=20&id_superficie=1&iframe=0'
curl -sS --compressed -A Mozilla/5.0 "$B/competicion_completa.php?$Q&id=4064&id_competicion=1511" -o g4064.html
curl -sS --compressed -A Mozilla/5.0 "$B/competicion_completa.php?$Q&id=3818&id_competicion=1511" -o g3818.html
curl -sS --compressed -A Mozilla/5.0 "$B/competicion_completa.php?$Q&id=4056&id_competicion=1509" -o g4056.html
curl -sS --compressed -A Mozilla/5.0 "$B/clasificacion.php?$Q&id=4064&id_competicion=1511" -o c4064.html
curl -sS --compressed -A Mozilla/5.0 "$B/clasificacion.php?$Q&id=3818&id_competicion=1511" -o c3818.html
```

- [ ] **Paso 2: recortarlas** con este script (`recortar.mjs`, fuera del repositorio):

```js
// Recorta una página de iSquad a lo que leen las pruebas, sin <script> ni <svg>.
// Uso: node recortar.mjs <entrada.html> <salida.html> grupo|clasificacion
import { readFileSync, writeFileSync } from 'node:fs';
const [entrada, salida, tipo] = process.argv.slice(2);
const html = readFileSync(entrada, 'utf8');
let trozo;
if (tipo === 'grupo') {
  const i = html.indexOf('GRUPOS DE LA COMPETICI');
  const r = html.indexOf('RESULTADOS DE LA COMPETICI', i);
  trozo = html.slice(html.lastIndexOf('<h2', i), html.indexOf('</table>', r) + '</table>'.length);
} else {
  const i = html.search(/<table\b[^>]*class=["'][^"']*\bclasificacion\b/);
  trozo = html.slice(html.lastIndexOf('<h4', i), html.indexOf('</table>', i) + '</table>'.length);
}
trozo = trozo.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '')
  .replace(/[ \t]*\r?\n\s*/g, '\n').trim();
writeFileSync(salida, `${trozo}\n`, 'utf8');
```

```bash
for t in 4064 3818 4056; do node recortar.mjs g$t.html REPO/test/datos/grupo-$t.html grupo; done
for t in 4064 3818; do node recortar.mjs c$t.html REPO/test/datos/clasificacion-$t.html clasificacion; done
```

- [ ] **Paso 3: comprobar que no hay nombres de personas.** `grep -iE "jugador|entrenador|arbitro" test/datos/*`
  no debe encontrar nada (las palabras «Acta» y «Previo» solo salen en cabeceras de columna y en
  `onclick='mostrarActaFormal(90711)'`, sin datos).

- [ ] **Paso 4: commit**

```bash
git add test/datos
git commit -m "Recortes de la web de resultados para las pruebas"
```

### Tarea 2: `peticion` con otra web y otras esperas

**Archivos:** modificar `src/isquad.js:31-56`, `test/isquad.test.js`.

- [ ] **Paso 1: prueba que falla.** En `test/isquad.test.js`, `simular` acepta opciones:

```js
async function simular(t, responder, ruta = 'json/partidos_equipos_consultas.php', datos = { accion: 'x' }, opciones = undefined) {
```

y dentro `const promesa = peticion(ruta, datos, opciones);`. Nueva prueba al final:

```js
test('peticion: otra web de iSquad y otras esperas', async (t) => {
  const otra = await simular(t, () => new Response('[]'), 'json/api/call.php/x', { a: '1' }, { base: 'https://voleibol.isquad.es' });
  assert.equal(otra.llamadas[0].url, 'https://voleibol.isquad.es/json/api/call.php/x');
  const una = await simular(t, () => new Response('', { status: 503, statusText: 'Service Unavailable' }), 'json/x.php', null, { esperas: [] });
  assert.equal(una.llamadas.length, 1);
  assert.deepEqual(una.avisos, []);
  assert.match(una.error.message, /respuesta 503 Service Unavailable/);
  const dos = await simular(t, (n) => (n === 1 ? new Response('', { status: 503 }) : new Response('ok')), 'json/x.php', null, { esperas: [15] });
  assert.equal(dos.resultado, 'ok');
  assert.deepEqual(dos.avisos, ['  ! La web de la federación no responde; se vuelve a intentar en 15 s (intento 2 de 2)...']);
});
```

- [ ] **Paso 2:** `node --test test/isquad.test.js` → falla (la URL sigue siendo la de resultados).
- [ ] **Paso 3: implementar.** En `src/isquad.js`:

```js
// opciones: base (otra web de iSquad; por defecto la de resultados) y esperas (segundos entre
// intentos; por defecto ESPERAS_SEGUNDOS).
export async function peticion(ruta, datos, { base = URL_BASE, esperas = ESPERAS_SEGUNDOS } = {}) {
  const url = `${base}/${ruta}`;
  const intentos = esperas.length + 1;
```

y en el `catch`, `const segundos = esperas[i - 1];`.

- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5:** commit «peticion: otra web de iSquad y otras esperas».

### Tarea 3: Lectores de las páginas (`src/resultados.js`, parte 1)

**Archivos:** crear `src/resultados.js`, `test/resultados.test.js`.

- [ ] **Paso 1: pruebas que fallan** (`test/resultados.test.js`):

```js
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
```

(Los clubs y el orden de las filas salen de las páginas reales descargadas: si al recortar difieren,
se ajustan las pruebas a lo que diga la página, no al revés.)

- [ ] **Paso 2:** `node --test test/resultados.test.js` → falla (no existe el módulo).
- [ ] **Paso 3: implementar** `src/resultados.js` (primera parte):

```js
// Resultados y clasificaciones de los equipos del club en la temporada en curso.
//
// La "Agenda calendario" no trae resultados ni grupos. Se sacan de las páginas de resultados de iSquad,
// las mismas que enseña volei.gal: el árbol de competiciones da el número de cada competición y de sus
// grupos ("torneos"); la página de un grupo trae la lista de grupos de la competición (con sus equipos)
// y los partidos del grupo con el marcador y los sets; la de clasificación, la tabla.
//
// Para no cargar la web de la federación solo se consultan los grupos en los que juega el club y solo
// cuando hace falta (gruposAConsultar); todo se guarda en resultados.json. Nunca se descargan actas,
// previos ni plantillas: solo nombres de equipos y marcadores (en los equipos hay menores).

import { clave, comoLista, esObjeto, leerJson, txt, unaLinea } from './util.js';

// --- Lectura de las páginas de iSquad ------------------------------------------------------------

const RE_CLUB = /afiliacion_clubs\/(\d+)\//;

// Windows-1252 de 0x80 a 0x9F (los que no existen, como el propio carácter de control).
const CP1252 = String.fromCharCode(
  0x20AC, 0x81, 0x201A, 0x192, 0x201E, 0x2026, 0x2020, 0x2021, 0x2C6, 0x2030, 0x160, 0x2039, 0x152, 0x8D, 0x17D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x2DC, 0x2122, 0x161, 0x203A, 0x153, 0x9D, 0x17E, 0x178,
);
const SUSTITUTO = String.fromCharCode(0xFFFD);

// La lista de grupos y el árbol traen a veces los nombres mal codificados ("EMEVÃ‰" por "EMEVÉ": UTF-8
// leído como Windows-1252). Se recuperan los bytes y se leen como UTF-8; si no sale bien, se deja igual.
export function repararNombre(texto) {
  const t = txt(texto);
  if (!/[ÃÂ]/.test(t)) return t;
  const bytes = [];
  for (const c of t) {
    const i = CP1252.indexOf(c);
    const n = i >= 0 ? 0x80 + i : c.codePointAt(0);
    if (n > 0xFF) return t;
    bytes.push(n);
  }
  const r = Buffer.from(bytes).toString('utf8');
  return r.includes(SUSTITUTO) ? t : r;
}

// Código de acceso que llevan dentro las páginas de iSquad (token = "…"); '' si no está.
export function leerToken(html) {
  const m = /\btoken\s*=\s*["']([0-9a-f]{16,})["']/i.exec(txt(html));
  return m ? m[1] : '';
}

// Árbol de competiciones (JSON): clave del nombre -> { id, torneos: [números de sus grupos] }.
export function leerArbol(json) {
  const mapa = new Map();
  for (const campeonato of comoLista(leerJson(json) ?? [])) {
    for (const c of comoLista(campeonato?.competiciones ?? [])) {
      if (!esObjeto(c) || !c.id) continue;
      const torneos = comoLista(c.torneos ?? []).map((t) => txt(t?.id)).filter((id) => id);
      mapa.set(clave(repararNombre(c.nombre)), { id: txt(c.id), torneos });
    }
  }
  return mapa;
}

// Trozo de la página desde "marca" hasta "hasta" (o el final); null si no está la marca.
function desde(html, marca, hasta) {
  const i = html.indexOf(marca);
  if (i < 0) return null;
  const j = hasta ? html.indexOf(hasta, i) : -1;
  return html.slice(i, j < 0 ? undefined : j);
}

// Celdas de una fila de tabla, cada una con su <td> completo.
function celdas(fila) { return fila.split(/<td\b/i).slice(1).map((c) => `<td${c}`); }

// Lista de grupos de la competición (sección "GRUPOS DE LA COMPETICIÓN" de la página de un grupo):
// [{ torneo, nombre, equipos: [{ nombre, club }] }]. null si la página no la tiene.
export function leerGrupos(html) {
  const s = desde(txt(html), 'GRUPOS DE LA COMPETICI', 'RESULTADOS DE LA COMPETICI');
  if (s === null) return null;
  const grupos = [];
  for (const bloque of s.split(/<h4\b/i).slice(1)) {
    const fin = bloque.indexOf('</h4>');
    if (fin < 0) continue;
    const equipos = new Map();
    let torneo = '';
    const enlaces = bloque.slice(fin).matchAll(/<a\b[^>]*href=["']equipo\.php\?[^"']*?\bid_equipo=(\d+)&(?:amp;)?id=(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi);
    for (const [, equipo, id, dentro] of enlaces) {
      torneo = id;
      const e = equipos.get(equipo) ?? { nombre: '', club: '' };
      const club = RE_CLUB.exec(dentro);
      if (club) e.club = club[1];
      const nombre = repararNombre(unaLinea(dentro));
      if (nombre) e.nombre = nombre;
      equipos.set(equipo, e);
    }
    if (!torneo) continue;
    grupos.push({
      torneo,
      nombre: repararNombre(unaLinea(`<h4${bloque.slice(0, fin)}`)),
      equipos: [...equipos.values()].filter((e) => e.nombre),
    });
  }
  return grupos;
}

// "25 - 18" de una celda de marcador o de set: [25, 18]; null si está vacía.
function tanteo(celda) {
  const m = /<span\b[^>]*>([^<]*)<\/span>\s*-\s*<span\b[^>]*>([^<]*)<\/span>/i.exec(txt(celda));
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  return /^\d+$/.test(a) && /^\d+$/.test(b) ? [Number(a), Number(b)] : null;
}

// Club de un equipo en la celda de los equipos, por su escudo ('' si no tiene).
function clubDe(celda, clase) {
  const a = new RegExp(`${clase}[\\s\\S]*?<\\/a>`, 'i').exec(celda);
  return a ? (RE_CLUB.exec(a[0])?.[1] ?? '') : '';
}

// Partidos del grupo (sección "RESULTADOS DE LA COMPETICIÓN"): [{ local, visitante, clubLocal,
// clubVisitante, dia: 'aaaa-mm-dd', hora: 'HH:mm' o '', estado, marcador: [l, v] o null,
// sets: [[l, v], ...] }]. null si la página no la tiene.
export function leerResultados(html) {
  const s = desde(txt(html), 'RESULTADOS DE LA COMPETICI');
  if (s === null) return null;
  const filas = [];
  for (const tr of s.split(/<tr\b/i).slice(1)) {
    if (!tr.includes('equipos-col')) continue;
    const c = celdas(tr);
    if (c.length < 10) continue;
    const nombres = [...c[0].slice(c[0].indexOf('nombres-equipos')).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => repararNombre(unaLinea(m[1])));
    const f = /(\d{1,2}):(\d{2})\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(unaLinea(c[7]));
    // "0:00" es que el partido aún no tiene hora.
    const hora = f && (Number(f[1]) > 0 || f[2] !== '00') ? `${f[1].padStart(2, '0')}:${f[2]}` : '';
    filas.push({
      local: nombres[0] ?? '',
      visitante: nombres[1] ?? '',
      clubLocal: clubDe(c[0], 'escudo-local-wrap'),
      clubVisitante: clubDe(c[0], 'escudo-visitante-wrap'),
      dia: f ? `${f[5]}-${f[4]}-${f[3]}` : '',
      hora,
      estado: unaLinea(c[9]),
      marcador: tanteo(c[1]),
      sets: c.slice(2, 7).map(tanteo).filter((x) => x),
    });
  }
  return filas;
}

// Clasificación del grupo: [{ pos, equipo, club, pt, pj, pg, pp, sf, sc }]; null si la competición no
// tiene ("Clasificación NO DISPONIBLE") o la página no trae la tabla.
export function leerClasificacion(html) {
  const h = txt(html);
  if (/Clasificaci(?:ó|o|&oacute;)n NO DISPONIBLE/i.test(h)) return null;
  const t = /<table\b[^>]*class=["'][^"']*\bclasificacion\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i.exec(h);
  if (!t) return null;
  const i = t[1].search(/<tbody\b/i);
  const numero = (celda) => Number(/-?\d+/.exec(unaLinea(celda))?.[0] ?? 0);
  const filas = [];
  for (const tr of (i < 0 ? t[1] : t[1].slice(i)).split(/<tr\b/i).slice(1)) {
    const c = celdas(tr);
    if (c.length < 9) continue;
    const exportado = /data-export=["']([^"']*)["']/i.exec(c[1]);
    filas.push({
      pos: numero(c[0]),
      equipo: repararNombre(unaLinea(exportado ? exportado[1] : c[1])),
      club: RE_CLUB.exec(c[1])?.[1] ?? '',
      pt: numero(c[3]),
      pj: numero(c[4]),
      pg: numero(c[5]),
      pp: numero(c[6]),
      sf: numero(c[7]),
      sc: numero(c[8]),
    });
  }
  return filas;
}
```

- [ ] **Paso 4:** `node --test test/resultados.test.js` → pasa; `npm test` → todo pasa.
- [ ] **Paso 5:** commit «Leer resultados y clasificaciones de la web de la federación».

### Tarea 4: Emparejado y qué consultar (`src/resultados.js`, parte 2)

**Archivos:** `src/resultados.js`, `test/resultados.test.js`.

- [ ] **Paso 1: pruebas que fallan.** Añadir a los imports de la prueba `anotarGrupos, anotarResultados,
  buscarFila, competicionesSinNumero, esperaResultado, gruposAConsultar` y `import { fechaPared } from '../src/util.js';`:

```js
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
```

- [ ] **Paso 2:** `node --test test/resultados.test.js` → fallan las nuevas.
- [ ] **Paso 3: implementar** (añadir a `src/resultados.js`; los imports de `util.js` pasan a ser
  `clave, comoLista, esObjeto, fechaValida, fmt, leerJson, sha1, soloDia, sumarDias, sumarMinutos, txt, unaLinea`,
  y `import { conHora } from './partidos.js';`):

```js
const HORAS_REPASO = 20;    // cada cuánto se repasan un grupo sin terminar y la lista de grupos
const DIAS_ESPERA = 14;     // días que se insiste cada hora en un resultado que no llega

// --- Emparejado y qué consultar ------------------------------------------------------------------

// Marcas de tiempo de resultados.json: "aaaa-mm-dd HH:mm", hora de Galicia.
function marca(d) { return fmt(d, 'yyyy-MM-dd HH:mm'); }

function leerMarca(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(txt(texto));
  return m ? fechaValida(...m.slice(1).map(Number)) : null;
}

// Horas desde una marca (Infinity si no hay).
function horasDesde(texto, ahora) {
  const d = leerMarca(texto);
  return d ? (ahora - d) / 3600000 : Infinity;
}

export function finalizado(fila) {
  return /^finalizado$/i.test(txt(fila?.estado).trim()) && Array.isArray(fila.marcador);
}

// Grupos de la caché de una competición: [[torneo, grupo], ...].
function gruposDe(cache, competicion) {
  const k = clave(competicion);
  return Object.entries(cache.grupos).filter(([, g]) => clave(g.competicion) === k);
}

// Apunta los grupos en los que juega el club (lista de leerGrupos). esNuestro(nombre, club).
export function anotarGrupos(cache, competicion, idCompeticion, lista, esNuestro) {
  for (const gr of lista) {
    const nuestros = gr.equipos.filter((e) => esNuestro(e.nombre, e.club)).map((e) => e.nombre).sort();
    if (!nuestros.length) continue;
    cache.grupos[gr.torneo] ??= {
      competicion, id_competicion: idCompeticion, nombre: '', equipos: [], consultado: '', terminado: false,
      firma: '', firma_clasificacion: '', partidos: [], clasificacion: null,
    };
    cache.grupos[gr.torneo].nombre = gr.nombre;
    cache.grupos[gr.torneo].equipos = nuestros;
  }
}

// Apunta los partidos del grupo (filas de leerResultados): los del club, si ya se ha jugado todo y una
// firma de todos (si cambia, cambia la clasificación).
export function anotarResultados(g, filas, esNuestro, ahora) {
  g.consultado = marca(ahora);
  g.terminado = filas.length > 0 && filas.every(finalizado);
  g.firma = sha1(filas.map((f) => [f.local, f.visitante, f.dia, f.estado, f.marcador ? f.marcador.join('-') : ''].join('|')).join('\n')).slice(0, 16);
  g.partidos = filas
    .filter((f) => esNuestro(f.local, f.clubLocal) || esNuestro(f.visitante, f.clubVisitante))
    .map(({ local, visitante, dia, hora, estado, marcador, sets }) => ({ local, visitante, dia, hora, estado, marcador, sets }));
}

// Fila de la federación de un partido de la agenda: mismo local, mismo visitante y mismo día en un grupo
// de su competición; si la federación le cambió el día, el mismo cruce si solo hay uno.
// Devuelve { torneo, fila } o null.
export function buscarFila(p, grupos) {
  const comp = clave(p.competicion);
  const local = clave(p.local);
  const visitante = clave(p.visitante);
  const dia = fmt(p.fecha, 'yyyy-MM-dd');
  const mismoDia = [];
  const cruce = [];
  for (const [torneo, g] of Object.entries(grupos)) {
    if (clave(g.competicion) !== comp) continue;
    for (const fila of comoLista(g.partidos ?? [])) {
      if (clave(fila.local) !== local || clave(fila.visitante) !== visitante) continue;
      (fila.dia === dia ? mismoDia : cruce).push({ torneo, fila });
    }
  }
  if (mismoDia.length) return mismoDia[0];
  return cruce.length === 1 ? cruce[0] : null;
}

// ¿Tendría que tener ya resultado? Empezó hace más de 2 horas (sin hora: desde el día siguiente) y
// hace como mucho 14 días.
export function esperaResultado(p, ahora) {
  const fin = conHora(p) ? sumarMinutos(p.fecha, 120) : sumarDias(soloDia(p.fecha), 1);
  return fin <= ahora && sumarDias(soloDia(p.fecha), DIAS_ESPERA + 1) > ahora;
}

// Competiciones de los partidos que aún no tienen número (o que no estaban en el árbol hace un día).
export function competicionesSinNumero(cache, partidos, ahora) {
  return [...new Set(partidos.map((p) => p.competicion))].filter((nombre) => {
    const c = cache.competiciones[nombre];
    return !c || (!c.id && horasDesde(c.revisado, ahora) >= HORAS_REPASO);
  });
}

// Qué hay que consultar: { descubrir: competiciones cuya lista de grupos hay que mirar, grupos: torneos }.
export function gruposAConsultar(cache, partidos, ahora) {
  const descubrir = new Set();
  const grupos = new Set();
  for (const p of partidos) {
    const c = cache.competiciones[p.competicion];
    if (!c?.id) continue;
    const e = buscarFila(p, cache.grupos);
    // Partido que no está en ningún grupo conocido (p. ej. empieza la segunda fase): se mira la lista
    // de grupos de su competición, como mucho una vez cada 20 horas.
    if (!e && horasDesde(c.revisado, ahora) >= HORAS_REPASO) descubrir.add(p.competicion);
    if (esperaResultado(p, ahora) && !(e && finalizado(e.fila))) {
      if (e) grupos.add(e.torneo);
      else for (const [t, g] of gruposDe(cache, p.competicion)) if (!g.terminado) grupos.add(t);
    }
  }
  // Grupos nunca consultados y repaso diario de los que tienen partidos por jugar (la clasificación
  // también cambia con los partidos de los rivales).
  const competiciones = new Set(partidos.map((p) => clave(p.competicion)));
  for (const [t, g] of Object.entries(cache.grupos)) {
    if (!competiciones.has(clave(g.competicion))) continue;
    if (!g.consultado || (!g.terminado && horasDesde(g.consultado, ahora) >= HORAS_REPASO)) grupos.add(t);
  }
  return { descubrir, grupos };
}
```

- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5:** commit «Emparejar resultados con los partidos y decidir qué consultar».

### Tarea 5: `resultados.json` y `actualizarResultados` (parte 3)

**Archivos:** `src/resultados.js`, `test/resultados.test.js`.

- [ ] **Paso 1: pruebas que fallan.** Imports nuevos en la prueba: `existsSync, mkdtempSync, rmSync, writeFileSync`
  de `node:fs`, `tmpdir` de `node:os`, `join` de `node:path`, y `actualizarResultados, leerCacheResultados`.

```js
const IDS = new Set([DOMPA]);
const TOKEN = '8c513fc98f8c16511d3876664456eef6';
// Partidos del IF1 en el Apertura (19/09 primera fase; 26/09 y 03/10 segunda fase).
const PARTIDOS = [
  partido(fechaPared(2026, 9, 19, 10, 0), 'EMEVÉ COLEXIO SAN LORENZO IF', 'DOMPAVOLEI IF1'),
  partido(fechaPared(2026, 9, 19, 11, 30), 'DOMPAVOLEI IF1', 'CLUB VOLEIBOL PONTEVEDRA IF2'),
  partido(fechaPared(2026, 9, 26, 10, 0), 'SEI SAN NARCISO IF', 'DOMPAVOLEI IF1'),
  partido(fechaPared(2026, 9, 26, 11, 30), 'DOMPAVOLEI IF1', 'CV OLEIROS IFA'),
  partido(fechaPared(2026, 10, 3), 'CV OLEIROS IFA', 'DOMPAVOLEI IF1', { estado: 'sinhora' }),
  partido(fechaPared(2026, 10, 3), 'SEI SAN NARCISO IF', 'DOMPAVOLEI IF1', { estado: 'sinhora' }),
];
const PAGINAS = {
  portada: `<script>token = "${TOKEN}";</script>`,
  arbol: JSON.stringify([{ id: '387', nombre: 'TORNEO APERTURA 2026', competiciones: [{ id: '1511', nombre: APERTURA, torneos: [{ id: '4064' }, { id: '3818' }] }] }]),
  'grupo 4064': pagina('grupo-4064.html'),
  'grupo 3818': pagina('grupo-3818.html'),
  'clasificacion 4064': pagina('clasificacion-4064.html'),
  'clasificacion 3818': pagina('clasificacion-3818.html'),
};

// fetch que responde como iSquad con PAGINAS (o con "cambios") y apunta qué se pide.
function federacion(pedidas, cambios = {}) {
  return async (url, opciones = {}) => {
    const u = new URL(String(url));
    const id = u.searchParams.get('id');
    let nombre = u.href;
    if (u.pathname.endsWith('/tree')) {
      nombre = 'arbol';
      assert.equal(u.searchParams.get('token'), TOKEN);
      assert.equal(new URLSearchParams(String(opciones.body)).get('id_temporada'), '2627');
    } else if (u.pathname.endsWith('/competicion.php')) nombre = 'portada';
    else if (u.pathname.endsWith('/competicion_completa.php')) nombre = `grupo ${id}`;
    else if (u.pathname.endsWith('/clasificacion.php')) nombre = `clasificacion ${id}`;
    pedidas.push(nombre);
    const texto = Object.hasOwn(cambios, nombre) ? cambios[nombre] : PAGINAS[nombre];
    if (texto instanceof Error) throw texto;
    if (texto === undefined) return new Response('', { status: 404, statusText: 'Not Found' });
    return new Response(texto);
  };
}

// Ejecuta actualizarResultados con la federación simulada; devuelve { cache, pedidas, avisos }.
async function actualizar(t, ruta, ahora, cambios = {}) {
  const pedidas = [];
  const avisos = [];
  const consola = t.mock.method(console, 'log', (texto) => avisos.push(texto));
  const original = globalThis.fetch;
  globalThis.fetch = federacion(pedidas, cambios);
  try {
    const cache = await actualizarResultados({ partidos: PARTIDOS, ids: IDS, ruta, anio: 2026, ahora, esperas: [] });
    return { cache, pedidas, avisos };
  } finally {
    globalThis.fetch = original;
    consola.mock.restore();
  }
}

function carpeta() { return mkdtempSync(join(tmpdir(), 'resultados-')); }

test('actualizarResultados: la primera vez busca la competición, sus grupos, resultados y clasificaciones', async (t) => {
  const dir = carpeta();
  try {
    const ruta = join(dir, 'resultados.json');
    const { cache, pedidas, avisos } = await actualizar(t, ruta, AHORA);
    assert.deepEqual(pedidas, ['portada', 'arbol', 'grupo 4064', 'grupo 3818', 'clasificacion 4064', 'clasificacion 3818']);
    assert.deepEqual(avisos, []);
    assert.deepEqual(cache.competiciones[APERTURA], { id: '1511', torneos: ['4064', '3818'], revisado: '2026-09-26 00:30' });
    assert.deepEqual(Object.keys(cache.grupos), ['3818', '4064']);
    assert.equal(cache.grupos['4064'].clasificacion[0].equipo, 'DOMPAVOLEI IF1');
    assert.equal(cache.grupos['3818'].clasificacion.length, 3);
    assert.deepEqual(JSON.parse(readFileSync(ruta, 'utf8')), JSON.parse(JSON.stringify(cache)));

    // Una hora después no hay nada pendiente: no se pide nada y el archivo no cambia.
    const guardado = readFileSync(ruta, 'utf8');
    const otra = await actualizar(t, ruta, fechaPared(2026, 9, 26, 1, 30));
    assert.deepEqual(otra.pedidas, []);
    assert.equal(readFileSync(ruta, 'utf8'), guardado);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('actualizarResultados: lo recién jugado se mira cada hora; la clasificación, solo si cambian los partidos', async (t) => {
  const dir = carpeta();
  try {
    const ruta = join(dir, 'resultados.json');
    await actualizar(t, ruta, AHORA);
    // 26/09 a las 14:00: los partidos de las 10:00 y las 11:30 ya tendrían que tener resultado.
    assert.deepEqual((await actualizar(t, ruta, fechaPared(2026, 9, 26, 14, 0))).pedidas, ['grupo 3818']);
    // A las 15:00 siguen sin resultado, pero otro partido del grupo ha cambiado: grupo y clasificación.
    const cambiado = { 'grupo 3818': pagina('grupo-3818.html').replace('Pendiente', 'Aplazado') };
    assert.deepEqual((await actualizar(t, ruta, fechaPared(2026, 9, 26, 15, 0), cambiado)).pedidas, ['grupo 3818', 'clasificacion 3818']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('actualizarResultados: si la federación no responde, avisa y sigue con lo que había', async (t) => {
  const dir = carpeta();
  try {
    const ruta = join(dir, 'resultados.json');
    const { cache, pedidas, avisos } = await actualizar(t, ruta, AHORA, { portada: new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') }) });
    assert.deepEqual(pedidas, ['portada']);
    assert.deepEqual(cache.grupos, {});
    assert.equal(existsSync(ruta), false);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /^ {2}! No se pudieron actualizar los resultados \(No se pudo descargar https:\/\/resultadosvoleibol\.isquad\.es\/competicion\.php\?.*\); se usan los que había\.$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('actualizarResultados: una competición que no está en la web de resultados se vuelve a mirar al día siguiente', async (t) => {
  const dir = carpeta();
  try {
    const ruta = join(dir, 'resultados.json');
    const vacio = { arbol: '[]' };
    const primera = await actualizar(t, ruta, AHORA, vacio);
    assert.deepEqual(primera.pedidas, ['portada', 'arbol']);
    assert.deepEqual(primera.avisos, [`  ! La competición «${APERTURA}» no está en la web de resultados de la federación; se vuelve a mirar mañana.`]);
    assert.deepEqual((await actualizar(t, ruta, fechaPared(2026, 9, 26, 12, 0), vacio)).pedidas, []);
    assert.deepEqual((await actualizar(t, ruta, fechaPared(2026, 9, 26, 20, 30))).pedidas.slice(0, 3), ['portada', 'arbol', 'grupo 4064']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leerCacheResultados: de otra temporada, de otros clubs o ilegible, se empieza de cero', (t) => {
  const dir = carpeta();
  try {
    const ruta = join(dir, 'resultados.json');
    const vacia = { temporada: 2026, clubs: [DOMPA], competiciones: {}, grupos: {} };
    assert.deepEqual(leerCacheResultados(ruta, 2026, IDS), vacia);
    writeFileSync(ruta, JSON.stringify({ ...vacia, temporada: 2025, grupos: { 1: {} } }));
    assert.deepEqual(leerCacheResultados(ruta, 2026, IDS), vacia);
    writeFileSync(ruta, JSON.stringify({ ...vacia, clubs: ['1'], grupos: { 1: {} } }));
    assert.deepEqual(leerCacheResultados(ruta, 2026, IDS), vacia);
    writeFileSync(ruta, '{');
    const consola = t.mock.method(console, 'log', () => {});
    assert.deepEqual(leerCacheResultados(ruta, 2026, IDS), vacia);
    assert.match(consola.mock.calls[0].arguments[0], /resultados\.json no se puede leer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Paso 2:** `node --test test/resultados.test.js` → fallan las nuevas.
- [ ] **Paso 3: implementar.** Imports de `src/resultados.js`: añadir `existsSync, readFileSync, writeFileSync`
  de `node:fs`, `URL_BASE, peticion` de `./isquad.js` y `aviso, compararTexto` de `./util.js`. Código:

```js
// El árbol de competiciones está en la otra web de iSquad.
export const URL_ARBOL = 'https://voleibol.isquad.es';
const TERRITORIAL = '20';        // Federación Galega de Voleibol
const AMBITO = '6';              // así la llaman las páginas de resultados (la agenda usa el 20)
const ESPERAS_RESULTADOS = [15]; // un solo reintento: los resultados no son imprescindibles

// --- resultados.json ------------------------------------------------------------------------------

function cacheVacia(anio, ids) {
  return { temporada: anio, clubs: [...ids].sort(), competiciones: {}, grupos: {} };
}

// resultados.json de la temporada anio y de estos clubs; si es de otra o no se puede leer, vacía.
export function leerCacheResultados(ruta, anio, ids) {
  if (existsSync(ruta)) {
    try {
      const c = leerJson(readFileSync(ruta, 'utf8'));
      if (c?.temporada === anio && comoLista(c.clubs).map(txt).sort().join(',') === [...ids].sort().join(',')
        && esObjeto(c.competiciones) && esObjeto(c.grupos)) {
        return { ...cacheVacia(anio, ids), competiciones: c.competiciones, grupos: c.grupos };
      }
    } catch (e) {
      aviso(`resultados.json no se puede leer (${e.message}); se vuelven a buscar los resultados.`);
    }
  }
  return cacheVacia(anio, ids);
}

function guardarCacheResultados(cache, ruta) {
  // Competiciones por orden alfabético (los grupos, por número): cambios fáciles de leer en Git.
  const competiciones = Object.fromEntries(Object.keys(cache.competiciones).sort(compararTexto)
    .map((k) => [k, cache.competiciones[k]]));
  writeFileSync(ruta, `${JSON.stringify({ ...cache, competiciones }, null, 1)}\n`, 'utf8');
}

// --- Descarga --------------------------------------------------------------------------------------

function pagina(archivo, torneo, competicion) {
  return `${archivo}?seleccion=0&id=${torneo}&id_ambito=${AMBITO}&id_territorial=${TERRITORIAL}`
    + `&id_superficie=1&iframe=0&id_competicion=${competicion}`;
}

// Dirección de la clasificación de un grupo en la web de la federación.
export function urlClasificacion(torneo, competicion) {
  return `${URL_BASE}/${pagina('clasificacion.php', torneo, competicion)}`;
}

// Árbol de competiciones de la temporada (hace falta el código de acceso de una página cualquiera).
async function arbolCompeticiones(anio, pedir) {
  const token = leerToken(await pedir(`competicion.php?seleccion=0&id_territorial=${TERRITORIAL}&id_ambito=${AMBITO}&id_superficie=1`));
  if (!token) throw new Error('la web de resultados ha cambiado: no se encuentra su código de acceso');
  const temporada = `${String(anio % 100).padStart(2, '0')}${String((anio + 1) % 100).padStart(2, '0')}`;
  const json = await pedir(`json/api/call.php/resultados/campeonato/tree?token=${token}`,
    { ambitos: AMBITO, seleccion: '0', id_superficie: '1', id_temporada: temporada }, URL_ARBOL);
  return leerArbol(json);
}

// Descarga lo que haga falta y devuelve la caché (resultados.json) al día. Si la federación falla,
// avisa y devuelve lo que hubiera. partidos: los del club (de convertirPartidos); solo cuentan los de
// la temporada anio. ahora: Date de pared. guardar: false para no escribir resultados.json.
export async function actualizarResultados({ partidos, ids, ruta, anio, ahora, guardar = true, esperas = ESPERAS_RESULTADOS }) {
  const cache = leerCacheResultados(ruta, anio, ids);
  const propios = partidos.filter((p) => p.temporada === anio);
  if (!propios.length) return cache;
  const antes = JSON.stringify(cache);
  const nombres = new Set(propios.flatMap((p) => p.nuestros).map(clave));
  const esNuestro = (nombre, club) => ids.has(txt(club)) || nombres.has(clave(nombre));
  const pedir = (ruta2, datos = null, base = URL_BASE) => peticion(ruta2, datos, { base, esperas });
  try {
    const sinNumero = competicionesSinNumero(cache, propios, ahora);
    if (sinNumero.length) {
      const arbol = await arbolCompeticiones(anio, pedir);
      for (const nombre of sinNumero) {
        const e = arbol.get(clave(nombre));
        if (!e) aviso(`La competición «${nombre}» no está en la web de resultados de la federación; se vuelve a mirar mañana.`);
        cache.competiciones[nombre] = e ? { id: e.id, torneos: e.torneos, revisado: '' } : { id: '', torneos: [], revisado: marca(ahora) };
      }
    }
    const { descubrir, grupos } = gruposAConsultar(cache, propios, ahora);
    // Páginas de grupo que hay que descargar: [torneo, competición]. Para la lista de grupos vale una
    // cualquiera de la competición; mejor una del club.
    const cola = [];
    for (const nombre of descubrir) {
      const nuestros = gruposDe(cache, nombre).map(([t]) => t);
      const torneo = nuestros.find((t) => grupos.has(t)) ?? nuestros[0] ?? cache.competiciones[nombre].torneos[0];
      if (torneo) cola.push([torneo, nombre]);
    }
    for (const t of grupos) cola.push([t, cache.grupos[t].competicion]);
    const hechos = [];
    while (cola.length) {
      const [torneo, nombre] = cola.shift();
      if (hechos.includes(torneo)) continue;
      hechos.push(torneo);
      const c = cache.competiciones[nombre];
      const html = await pedir(pagina('competicion_completa.php', torneo, c.id));
      const lista = leerGrupos(html);
      const filas = leerResultados(html);
      if (!lista || !filas) throw new Error('la página de un grupo no tiene el formato de siempre');
      anotarGrupos(cache, nombre, c.id, lista, esNuestro);
      c.revisado = marca(ahora);
      if (cache.grupos[torneo]) anotarResultados(cache.grupos[torneo], filas, esNuestro, ahora);
      // Grupos del club que acaban de aparecer (p. ej. los de la segunda fase).
      for (const [t, g] of gruposDe(cache, nombre)) if (!g.consultado && !hechos.includes(t)) cola.push([t, nombre]);
    }
    // La clasificación solo cambia si cambian los partidos del grupo.
    for (const t of hechos) {
      const g = cache.grupos[t];
      if (!g || g.firma_clasificacion === g.firma) continue;
      g.clasificacion = leerClasificacion(await pedir(pagina('clasificacion.php', t, g.id_competicion)));
      g.firma_clasificacion = g.firma;
    }
  } catch (e) {
    aviso(`No se pudieron actualizar los resultados (${txt(e.message).split('\n')[0]}); se usan los que había.`);
  }
  if (guardar && JSON.stringify(cache) !== antes) {
    try {
      guardarCacheResultados(cache, ruta);
    } catch (e) {
      aviso(`No se pudo guardar resultados.json: ${e.message}`);
    }
  }
  return cache;
}
```

- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5:** commit «Consultar resultados y clasificaciones solo cuando hace falta (resultados.json)».

### Tarea 6: Resultado de cada partido y clasificación de cada equipo (parte 4)

**Archivos:** `src/resultados.js`, `test/resultados.test.js`.

- [ ] **Paso 1: pruebas que fallan** (imports: `anadirResultados, clasificaciones`):

```js
test('anadirResultados: marcador y sets de los partidos finalizados; el resto, null', () => {
  const cache = cacheDePrueba();
  const [ida, hoy] = [PARTIDOS[0], PARTIDOS[3]].map((p) => ({ ...p }));
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
```

- [ ] **Paso 2:** `node --test test/resultados.test.js` → fallan.
- [ ] **Paso 3: implementar:**

```js
// --- Para el calendario y la página ------------------------------------------------------------------

// p.resultado = { marcador: [local, visitante], sets: [[l, v], ...] } si su partido está "Finalizado" en
// la federación; si no, null. Solo los de la temporada de la caché.
export function anadirResultados(partidos, cache) {
  for (const p of partidos) {
    const e = p.temporada === cache.temporada ? buscarFila(p, cache.grupos) : null;
    p.resultado = e && finalizado(e.fila)
      ? { marcador: [...e.fila.marcador], sets: e.fila.sets.map((s) => [...s]) }
      : null;
  }
}

// ¿Es "a" mejor grupo actual que "b"? El del próximo partido más cercano; si ninguno tiene, el del
// último partido.
function mejorGrupo(a, b) {
  if (a.proximo && b.proximo) return a.proximo < b.proximo;
  if (a.proximo || b.proximo) return Boolean(a.proximo);
  return a.ultimo > b.ultimo;
}

// Clasificación del grupo actual de cada equipo del club (en el orden de equipos):
// [{ equipo, competicion, grupo, url, actualizado (Date de pared o null), filas: [{ ...fila, nuestro }] }].
// Los equipos sin clasificación no salen. hoy: Date de pared.
export function clasificaciones(equipos, cache, ids, hoy) {
  const dia = fmt(hoy, 'yyyy-MM-dd');
  const lista = [];
  for (const e of equipos) {
    const k = clave(e.nombre);
    let elegido = null;
    for (const [torneo, g] of Object.entries(cache.grupos)) {
      if (!Array.isArray(g.clasificacion) || !g.clasificacion.length) continue;
      if (!comoLista(g.equipos).some((n) => clave(n) === k)) continue;
      const suyos = comoLista(g.partidos).filter((f) => clave(f.local) === k || clave(f.visitante) === k);
      const proximo = suyos.filter((f) => !finalizado(f) && f.dia >= dia).map((f) => f.dia).sort()[0] ?? '';
      const ultimo = suyos.map((f) => f.dia).sort().pop() ?? '';
      const candidato = { torneo, g, proximo, ultimo };
      if (!elegido || mejorGrupo(candidato, elegido)) elegido = candidato;
    }
    if (!elegido) continue;
    const { torneo, g } = elegido;
    lista.push({
      equipo: e.nombre,
      competicion: g.competicion,
      grupo: g.nombre,
      url: urlClasificacion(torneo, g.id_competicion),
      actualizado: leerMarca(g.consultado),
      filas: g.clasificacion.map((f) => ({ ...f, nuestro: ids.has(txt(f.club)) || clave(f.equipo) === k })),
    });
  }
  return lista;
}
```

- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5:** commit «Resultado de cada partido y clasificación de cada equipo».

### Tarea 7: El `.ics` con el resultado

**Archivos:** `src/ics.js:56-80`, `test/ics.test.js`.

- [ ] **Paso 1: prueba que falla** (al final de `test/ics.test.js`):

```js
test('crearIcs: con resultado, el marcador en el título (el del club primero) y los sets en el detalle', () => {
  const opciones = { prefijo: 'DOMPAVOLEI' };
  const titulo = (p) => propiedad(crearIcs([p], 'Cal', 'Desc', 120, GENERADO, SALIDAS, opciones), 'SUMMARY')[0];
  const detalle = (p) => propiedad(crearIcs([p], 'Cal', 'Desc', 120, GENERADO, SALIDAS, opciones), 'DESCRIPTION')[0];
  const ganado = partidoFuera({ resultado: { marcador: [0, 3], sets: [[24, 26], [23, 25], [20, 25]] } });
  assert.equal(titulo(ganado), 'SUMMARY:✅ IF1 3-0 CLUB VOLEIBOL LALÍN');
  assert.equal(detalle(ganado), 'DESCRIPTION:Sets: 26-24 · 25-23 · 25-20\\nCLUB VOLEIBOL LALÍN - DOMPAVOLEI IF1\\nLIGA GALEGA INFANTIL F');
  const perdido = partido({ resultado: { marcador: [1, 3], sets: [[25, 20], [20, 25], [18, 25], [22, 25]] } });
  assert.equal(titulo(perdido), 'SUMMARY:❌ CF1 1-3 CV VIGO');
  const derbi = partido({
    visitante: 'DOMPAVOLEI CF2', esVisitante: true, condicion: 'derbi', nuestros: ['DOMPAVOLEI CF1', 'DOMPAVOLEI CF2'], rival: '',
    resultado: { marcador: [3, 1], sets: [] },
  });
  assert.equal(titulo(derbi), 'SUMMARY:🏐 CF1 3-1 CF2');
  assert.equal(detalle(derbi), 'DESCRIPTION:DOMPAVOLEI CF1 - DOMPAVOLEI CF2\\nLIGA GALEGA CADETE F');
});
```

- [ ] **Paso 2:** `node --test test/ics.test.js` → falla.
- [ ] **Paso 3: implementar** en `src/ics.js`:

```js
// Marcador (o set) del lado del club: en los partidos de visitante se da la vuelta.
function delClub(p, par) { return p.condicion === 'visitante' ? [par[1], par[0]] : par; }

// Con resultado: "✅ IF1 3-0 RIVAL" (o ❌), con el marcador del club primero; en un derbi, "🏐 CF1 3-1 CF2".
function tituloResultado(p, corto) {
  const [a, b] = delClub(p, p.resultado.marcador);
  if (p.condicion === 'derbi') return `🏐 ${corto(p.local)} ${a}-${b} ${corto(p.visitante)}`;
  return `${a > b ? '✅' : '❌'} ${corto(p.nuestros[0])} ${a}-${b} ${p.rival}`;
}
```

En `tituloEvento`, justo después de definir `corto`: `if (p.resultado) return tituloResultado(p, corto);`.
Al principio de `detalleEvento`:

```js
  if (p.resultado) {
    // Ya jugado: los sets, el partido y la competición (las horas de salida ya no hacen falta).
    const sets = p.resultado.sets.map((s) => delClub(p, s).join('-')).join(' · ');
    return [...(sets ? [`Sets: ${sets}`] : []), `${p.local} - ${p.visitante}`, p.competicion].join('\n');
  }
```

Y el comentario de `tituloEvento` añade: «Ya jugado, con el resultado (tituloResultado).»

- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5:** commit «Calendario: el resultado en el título de los partidos jugados».

### Tarea 8: Datos de la página (`src/html.js`)

**Archivos:** `src/html.js:1-3,59-111`, `test/html.test.js`.

- [ ] **Paso 1: pruebas que fallan.** En `test/html.test.js`:
  - Sustituir la prueba «plantilla.html es la copia exacta del here-string…» por:

```js
test('plantilla.html: un solo __TITULO__ y __DATOS__, y el código de la página sin errores de sintaxis', () => {
  assert.equal(veces(PLANTILLA, '__TITULO__'), 1);
  assert.equal(veces(PLANTILLA, '__DATOS__'), 1);
  const codigo = PLANTILLA.slice(PLANTILLA.lastIndexOf('<script>') + '<script>'.length, PLANTILLA.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new Function(codigo));
});
```

  (y quitar `RUTA_PS1` y `existsSync`, que ya no se usan).
  - En «crearHtml: mismos datos…»: `Object.keys(d)` termina en `'partidos', 'clas'`; las claves de
    `d.partidos[0]` terminan en `'mun', 'r'`; cada partido esperado lleva `r: null`; y `d.clas` es `[]`.
  - En «los valores que faltan…»: `Object.keys(d.partidos[0]).length` pasa a 20.
  - Nueva prueba:

```js
test('crearHtml: resultados de los partidos y clasificaciones', () => {
  const p = partido({ resultado: { marcador: [3, 1], sets: [[25, 20], [20, 25], [25, 18], [25, 22]] } });
  const clas = [{
    equipo: 'DOMPAVOLEI IF1', competicion: 'TORNEO APERTURA INFANTIL F', grupo: 'PRIMERA FASE - GRUPO H',
    url: 'https://resultadosvoleibol.isquad.es/clasificacion.php?id=4064', actualizado: fechaPared(2026, 9, 26, 0, 30),
    filas: [{ pos: 1, equipo: 'DOMPAVOLEI IF1', club: '206572580', pt: 6, pj: 2, pg: 2, pp: 0, sf: 6, sc: 0, nuestro: true }],
  }];
  const d = datosDe(crearHtml(opciones({ partidos: [p, partido()], clasificaciones: clas })));
  assert.deepEqual(d.partidos.map((x) => x.r), [{ m: [3, 1], s: [[25, 20], [20, 25], [25, 18], [25, 22]] }, null]);
  assert.deepEqual(d.clas, [{
    eq: 'DOMPAVOLEI IF1', comp: 'TORNEO APERTURA INFANTIL F', g: 'PRIMERA FASE - GRUPO H',
    url: 'https://resultadosvoleibol.isquad.es/clasificacion.php?id=4064', act: '26/09 00:30',
    filas: [{ p: 1, n: 'DOMPAVOLEI IF1', pt: 6, pj: 2, pg: 2, pp: 0, sf: 6, sc: 0, o: true }],
  }]);
});
```

- [ ] **Paso 2:** `node --test test/html.test.js` → fallan.
- [ ] **Paso 3: implementar** en `src/html.js`: el comentario de cabecera pasa a «Nació como traducción de
  New-Html de calendario-voley.ps1; desde septiembre de 2026 enseña también resultados y clasificaciones,
  que el .ps1 no tiene.» y el de `PLANTILLA` deja de decir que es copia exacta. `crearHtml` recibe
  `clasificaciones = []` y añade:

```js
      mun: txt(p.municipio),
      r: p.resultado ? { m: p.resultado.marcador, s: p.resultado.sets } : null,
    })),
    clas: clasificaciones.map((c) => ({
      eq: c.equipo,
      comp: c.competicion,
      g: c.grupo,
      url: c.url,
      act: c.actualizado ? fmt(c.actualizado, 'dd/MM HH:mm') : '',
      filas: c.filas.map((f) => ({ p: f.pos, n: f.equipo, pt: f.pt, pj: f.pj, pg: f.pg, pp: f.pp, sf: f.sf, sc: f.sc, o: Boolean(f.nuestro) })),
    })),
  };
```

- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5:** commit «Página: datos de resultados y clasificaciones».

### Tarea 9: La página (`src/plantilla.html`)

**Archivos:** `src/plantilla.html`.

- [ ] **Paso 1: colores.** En `:root` añadir `--gana: #1E7B45; --pierde: #B3261E;` y en el modo oscuro
  `--gana: #5BCB86; --pierde: #F2877E;`.
- [ ] **Paso 2: estilos**, detrás de `.proximo-marca::before {…}`:

```css
.resultado { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin-top: 5px; font: 600 1rem/1.3 var(--cond); letter-spacing: .02em; }
.resultado b { font-weight: 700; font-variant-numeric: tabular-nums; }
.resultado.gana b { color: var(--gana); }
.resultado.pierde b { color: var(--pierde); }
.resultado .sets { color: var(--tinta-2); font-weight: 500; font-variant-numeric: tabular-nums; }

/* Clasificación */
.clas { --c: var(--c-otra); margin-top: 26px; }
.clas-titulo { margin: 0; padding-bottom: 6px; border-bottom: 2px solid var(--c); font: 700 1.5rem/1 var(--cond); letter-spacing: .03em; text-transform: uppercase; }
.clas-titulo span { margin-left: 6px; font-size: 1rem; font-weight: 500; letter-spacing: .06em; color: var(--tinta-2); }
.clas-grupo { margin: 6px 0 8px; font-size: .9rem; color: var(--tinta-2); }
.tabla-envoltura { overflow-x: auto; }
.tabla-clas { width: 100%; border-collapse: collapse; background: var(--superficie); font: 500 1rem/1.2 var(--cond); font-variant-numeric: tabular-nums; }
.tabla-clas th { padding: 8px 6px; border-bottom: 1px solid var(--borde); font: 700 .78rem/1 var(--cond); letter-spacing: .1em; text-transform: uppercase; color: var(--tinta-2); text-align: center; }
.tabla-clas td { padding: 8px 6px; border-bottom: 1px solid var(--borde); text-align: center; }
.tabla-clas th.eq, .tabla-clas td.eq { width: 100%; text-align: left; }
.tabla-clas td.eq { font-weight: 600; }
.tabla-clas td.pts { font-weight: 700; }
.tabla-clas tr.nuestro td { background: color-mix(in srgb, var(--c) 14%, var(--superficie)); font-weight: 700; }
.tabla-clas tr.nuestro td:first-child { box-shadow: inset 4px 0 0 var(--c); }
.clas-pie { margin: 6px 0 0; font-size: .85rem; color: var(--tinta-2); }
```

- [ ] **Paso 3: botones.** En el grupo «Vista»:
  `<button type="button" data-vista="lista">Lista</button><button type="button" data-vista="mes">Mes</button><button type="button" data-vista="clas" id="btn-clas">Clasificación</button>`;
  el grupo «Local o visitante» lleva `id="seg-cond"`.
- [ ] **Paso 4: estado.** `if (['lista', 'mes', 'clas'].indexOf(st.vista) < 0) st.vista = 'lista';` y justo
  después:

```js
  var tablas = D.clas || [];
  if (!tablas.length) { $('btn-clas').classList.add('oculto'); if (st.vista === 'clas') st.vista = 'lista'; }
```

  En `marcarSegmentos`: `$('seg-periodo').classList.toggle('oculto', st.vista !== 'lista');` y
  `$('seg-cond').classList.toggle('oculto', st.vista === 'clas');`.
- [ ] **Paso 5: resultado en las tarjetas**, delante de `function tarjeta`:

```js
  // Marcador del lado del club (en los partidos de visitante se da la vuelta; en un derbi, local-visitante).
  function delClub(p, par) { return p.vo && !p.lo ? [par[1], par[0]] : par; }
  function textoResultado(p) {
    var m = delClub(p, p.r.m);
    var sets = p.r.s.map(function (s) { return delClub(p, s).join('-'); }).join(' · ');
    var cls = p.cond === 'derbi' ? 'derbi' : m[0] > m[1] ? 'gana' : 'pierde';
    var txt = p.cond === 'derbi' ? 'Resultado' : m[0] > m[1] ? 'Ganado' : 'Perdido';
    return '<div class="resultado ' + cls + '"><b>' + txt + ' ' + m[0] + '-' + m[1] + '</b>' +
      (sets ? '<span class="sets">' + esc(sets) + '</span>' : '') + '</div>';
  }
```

  y en `tarjeta`, `textoViaje(p)` pasa a `(p.r ? textoResultado(p) : textoViaje(p))`.
- [ ] **Paso 6: clasificaciones**, delante de `function pintarLista`:

```js
  function tablaClas(c) {
    var e = D.equipos.filter(function (x) { return x.n === c.eq; })[0];
    var filas = c.filas.map(function (f) {
      return '<tr' + (f.o ? ' class="nuestro"' : '') + '><td>' + f.p + '</td><td class="eq">' + esc(f.n) + '</td><td class="pts">' + f.pt +
        '</td><td>' + f.pj + '</td><td>' + f.pg + '</td><td>' + f.pp + '</td><td>' + f.sf + '-' + f.sc + '</td></tr>';
    }).join('');
    return '<section class="clas" data-cat="' + esc(e ? e.ck : 'otra') + '"><h2 class="clas-titulo">' + esc(corto(c.eq)) +
      (e ? '<span>' + esc(e.cat) + '</span>' : '') + '</h2><p class="clas-grupo">' + esc(c.comp) + ' · ' + esc(c.g) + '</p>' +
      '<div class="tabla-envoltura"><table class="tabla-clas"><thead><tr><th scope="col">#</th><th scope="col" class="eq">Equipo</th>' +
      '<th scope="col" title="Puntos">Pts</th><th scope="col" title="Partidos jugados">PJ</th><th scope="col" title="Ganados">G</th>' +
      '<th scope="col" title="Perdidos">P</th><th scope="col">Sets</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
      '<p class="clas-pie">' + (c.act ? 'Comprobada el ' + esc(c.act) + ' · ' : '') + '<a href="' + esc(c.url) +
      '" target="_blank" rel="noopener">Ver en la federación</a></p></section>';
  }
  function clasVisibles() {
    return tablas.filter(function (c) { return !st.eq.length || st.eq.indexOf(c.eq) >= 0; });
  }
  function pintarClas() {
    var lista = clasVisibles();
    if (!lista.length) { main.innerHTML = vacio('Estos equipos aún no tienen clasificación.', 'Ver todos los equipos'); return 0; }
    main.innerHTML = lista.map(tablaClas).join('');
    return lista.length;
  }
```

- [ ] **Paso 7: tabla encima de los partidos del equipo elegido.** En `pintarLista`, tras `var lista = filtrar(true);`:
  `var cabeza = st.eq.length ? clasVisibles().map(tablaClas).join('') : '';` y cada `main.innerHTML = …`
  de `pintarLista` pasa a `main.innerHTML = cabeza + …`.
- [ ] **Paso 8: pintar y anunciar.** `var n = st.vista === 'mes' ? pintarMes() : st.vista === 'clas' ? pintarClas() : pintarLista();`
  y en `anunciar`:

```js
    if (st.vista === 'lista') partes.push(st.per === 'proximos' ? 'próximos partidos' : 'toda la temporada');
    if (st.vista === 'clas') partes.push('clasificación');
    else if (st.cond !== 'todos') partes.push(st.cond === 'local' ? 'solo como local' : 'solo como visitante');
    $('estado').textContent = (st.vista === 'clas' ? plural(n, 'clasificación', 'clasificaciones') : plural(n, 'partido', 'partidos')) + ' · ' + partes.join(' · ');
```

- [ ] **Paso 9: pie.** Tras «Solo aparecen los partidos que publica la federación gallega.» añadir
  `(tablas.length ? ' Resultados y clasificaciones de la web de resultados de la federación, comprobados varias veces al día.' : '')`.
- [ ] **Paso 10:** `npm test` → todo pasa (la prueba de sintaxis de la plantilla incluida).
- [ ] **Paso 11:** commit «Página: resultado de cada partido y vista Clasificación».

### Tarea 10: Unirlo en `main.js`, publicación y README

**Archivos:** `src/main.js`, `test/main.test.js`, `.github/workflows/calendario.yml`, `README.md`.

- [ ] **Paso 1: prueba que falla** (al final de `test/main.test.js`):

```js
function paginaDatos(nombre) { return readFileSync(new URL(`./datos/${nombre}`, import.meta.url), 'utf8'); }

test('resultados: el .ics y la página llevan el marcador y la clasificación; se guarda resultados.json', async () => {
  const dir = carpetaConConfig();
  try {
    const salida = join(dir, 'salida');
    const filas = [
      fila('2026-09-19 10:00:00', 'EMEVÉ COLEXIO SAN LORENZO IF', 'DOMPAVOLEI IF1', '206572578', DOMPA),
      fila('2026-09-26 11:30:00', 'DOMPAVOLEI IF1', 'CV OLEIROS IFA', DOMPA, '206572590'),
    ];
    const arbol = JSON.stringify([{ id: '387', competiciones: [{ id: '1511', nombre: 'TORNEO APERTURA INFANTIL F', torneos: [{ id: '4064' }, { id: '3818' }] }] }]);
    const responder = (url, datos) => {
      if (datos.accion === 'obtener_partidos') return JSON.stringify({ data: filas });
      const u = new URL(url);
      const id = u.searchParams.get('id');
      if (u.pathname.endsWith('/competicion.php')) return '<script>token = "8c513fc98f8c16511d3876664456eef6";</script>';
      if (u.pathname.endsWith('/tree')) return arbol;
      if (u.pathname.endsWith('/competicion_completa.php')) return paginaDatos(`grupo-${id}.html`);
      if (u.pathname.endsWith('/clasificacion.php')) return paginaDatos(`clasificacion-${id}.html`);
      throw new Error(`no previsto: ${url}`);
    };
    const [, consola] = await enSilencio(() => conFetch(responder,
      () => principal(['--config', dir, '--salida', salida, '--nombre-base', 'cal'], new Date('2026-09-25T10:00:00Z'))));
    const ics = readFileSync(join(salida, 'cal.ics'), 'utf8').replace(/\r\n /g, '');
    assert.match(ics, /\r\nSUMMARY:✅ DOMPAVOLEI IF1 3-0 EMEVÉ COLEXIO SAN LORENZO IF\r\n/);
    assert.match(readFileSync(join(salida, 'cal.html'), 'utf8'), /"clas":\[\{"eq":"DOMPAVOLEI IF1","comp":"TORNEO APERTURA INFANTIL F","g":"SEGUNDA FASE - GRUPO 1"/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'resultados.json'), 'utf8')).temporada, 2026);
    assert.ok(consola.includes('  1 resultado(s) y 1 clasificación(es).'), consola.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Paso 2:** `node --test test/main.test.js` → falla.
- [ ] **Paso 3: implementar** en `src/main.js`:
  - `import { actualizarResultados, anadirResultados, clasificaciones } from './resultados.js';`
  - `rutasConfig` devuelve también `resultados: join(dirname(config), 'resultados.json')` (y el comentario
    de encima y el de `--config` mencionan resultados.json).
  - Tras el bloque de las horas de salida:

```js
  // Resultados y clasificaciones: solo de la temporada en curso (no con --temporada, --desde o --hasta,
  // ni en agosto mientras se enseña la anterior).
  let tablas = [];
  if (!rango.explicito && rango.anio === anioTemporada(generado.pared) && partidos.length) {
    paso('Buscando resultados y clasificaciones...');
    const cache = await actualizarResultados({ partidos, ids, ruta: rutas.resultados, anio: rango.anio, ahora: generado.pared });
    anadirResultados(partidos, cache);
    tablas = clasificaciones(equipos, cache, ids, generado.pared);
  }
```

  - `crearHtml({ …, duracion, clasificaciones: tablas })`.
  - En el resumen, tras la línea de «N partidos (M por jugar)…»:

```js
    const conResultado = partidos.filter((p) => p.resultado).length;
    if (conResultado || tablas.length) paso(`${conResultado} resultado(s) y ${tablas.length} clasificación(es).`);
```

- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5: publicación.** En `.github/workflows/calendario.yml`, en «Guardar historial de cambios», tras
  la línea de `temporada-anterior.json`: `[ -f resultados.json ] && git add resultados.json`, y el
  comentario del paso dice «(y los tiempos de viaje, la copia de la temporada anterior y los resultados)».
- [ ] **Paso 6: README.** Tras el párrafo de las horas de salida:

```markdown
En los partidos ya jugados salen el **resultado** y los sets, y la vista **Clasificación** enseña la tabla
del grupo de cada equipo. Salen de la web de resultados de la federación (la misma que enseña volei.gal):
solo se consultan los grupos del club y solo cuando hace falta (un partido que acaba de jugarse, un repaso
diario), y se guardan en `resultados.json`. Nunca se descargan actas ni plantillas.
```

  y la frase sobre `comparar.mjs` dice que marca diferencias en los `.ics` y en la página.
- [ ] **Paso 7:** commit «Resultados y clasificaciones en la web y el calendario».

### Tarea 11: Prueba de verdad y publicación

- [ ] **Paso 1:** generar con la federación de verdad desde el repositorio:
  `node src/main.js --salida ../prueba-web --nombre-base calendario` → sin avisos de resultados; en la
  consola, «N resultado(s) y M clasificación(es)».
- [ ] **Paso 2:** abrir `../prueba-web/calendario.html` en el navegador integrado: tarjetas del 19/09 con
  «Ganado 3-0 …» / «Perdido 2-3 …», vista «Clasificación», tabla al elegir un equipo; a 375 px de ancho
  y en modo oscuro.
- [ ] **Paso 3:** repetir el paso 1 y comprobar que no se descarga nada (nada pendiente).
- [ ] **Paso 4:** `git add resultados.json` (el estado inicial), commit, `git pull --rebase` y push; mirar la
  ejecución de GitHub Actions y la web publicada.
