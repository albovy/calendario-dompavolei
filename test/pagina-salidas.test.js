// Pruebas de la página nueva «Salidas desde Os Remedios» (el <script> de plantilla-salidas.html),
// ejecutada con node:vm en el DOM simulado de test/apoyo/pagina-simulada.js. Lo que se comprueba es lo del
// diseño (docs/superpowers/specs/2026-09-25-rediseno-salidas-design.md): una fila por partido, la columna
// de la hora en cada caso, local o visitante siempre a la vista, «PRÓXIMA SALIDA» y los botones pequeños
// solo donde tocan, más lo que la página de siempre ya hacía (copiar, pedir bus, filtros guardados...).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abrirPagina as abrir, codigoDe, conCopiar, correosBus, datos, elemento, foco, partido, plantilla, pulsarCopiar,
  reglasCss, reglasSelector, selectorDiseno,
} from './apoyo/pagina-simulada.js';

const PLANTILLA = plantilla('plantilla-salidas.html');
const CODIGO = codigoDe(PLANTILLA);
const SAL = { origen: 'Os Remedios', cal: 60 };
const BUS = { para: 'bus@example.com', cc: '', plazas: '55', firma: '', origen: 'Os Remedios', dirOrigen: '', dur: 120 };
// La clave propia de la página nueva en localStorage (la de siempre es "calendario-voley:" + club).
const CLAVE = 'salidas-voley:DOMPAVOLEI';

function abrirPagina(d, opciones) { return abrir(CODIGO, d, opciones); }

// Con estos filtros guardados en el navegador (p. ej. { per: 'todo' } para ver también lo ya jugado).
function conFiltros(filtros) { return new Map([[CLAVE, JSON.stringify(filtros)]]); }

// Texto sin etiquetas ni entidades, con los espacios juntos.
function texto(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

// Filas de la lista: { i (índice en D.partidos), clases, html } en el orden en que salen.
function filas(html) {
  return html.split('<article ').slice(1).map((trozo) => {
    const fin = trozo.indexOf('</article>');
    const cuerpo = trozo.slice(0, fin);
    return { i: +/data-i="(\d+)"/.exec(cuerpo)[1], clases: /class="([^"]*)"/.exec(cuerpo)[1].split(' '), html: cuerpo };
  });
}
function fila(html, i) { return filas(html).find((f) => f.i === i); }
// La columna de la hora de una fila, como texto («Salida 07:15 partido 10:00»).
function columnaHora(f) { return texto(/<div class="hora">([\s\S]*?)<\/div>/.exec(f.html)[1]); }

// --- La plantilla ---------------------------------------------------------------------------------------

test('plantilla-salidas.html: el código de la página sin errores de sintaxis', () => {
  assert.doesNotThrow(() => new Function(CODIGO));
});

test('plantilla-salidas.html: tokens de color del diseño en claro y en oscuro, y las fuentes en una petición', () => {
  for (const t of ['--fondo: #ECEFF2', '--sup: #FFFFFF', '--tinta: #121B2E', '--agua: #0A7A70', '--agua-r: #5EC4B9', '--ambar: #955300',
    '--fondo: #131519', '--sup: #1C1F25', '--tinta: #E8EAEE', '--agua: #63D0C3', '--ambar: #F0B65A', '--marino-t: #A9BCE3']) {
    assert.ok(PLANTILLA.includes(t), t);
  }
  assert.match(PLANTILLA, /@media \(prefers-color-scheme: dark\)/);
  assert.equal(PLANTILLA.split('fonts.bunny.net/css?').length - 1, 1);
  assert.ok(PLANTILLA.includes('family=barlow:400,500,600|barlow-condensed:500,600,700'));
  // Sin el amarillo balón de la página de siempre.
  assert.doesNotMatch(PLANTILLA, /--balon|#FFC915/);
});

// Contraste WCAG entre dos colores "#rrggbb" (1 a 21).
function contraste(a, b) {
  const luz = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

test('plantilla-salidas.html: un color por categoría (como en la página de siempre), en claro y en oscuro, que se ve sobre las filas', () => {
  const oscuro = PLANTILLA.indexOf('@media (prefers-color-scheme: dark)');
  const tokens = (css) => Object.fromEntries([...css.matchAll(/--(c-[a-z]+|sup):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
  const claro = tokens(PLANTILLA.slice(0, oscuro));
  const noche = tokens(PLANTILLA.slice(oscuro, PLANTILLA.indexOf('}', PLANTILLA.indexOf('}', oscuro) + 1)));
  const cats = ['benjamin', 'alevin', 'infantil', 'cadete', 'juvenil', 'junior', 'senior', 'otra'];
  for (const [modo, t] of [['claro', claro], ['oscuro', noche]]) {
    for (const c of cats) {
      const color = t[`c-${c}`];
      assert.ok(color, `falta --c-${c} en ${modo}`);
      // La barra y el punto son elementos gráficos: WCAG 1.4.11 pide 3:1 con lo que tienen al lado.
      assert.ok(contraste(color, t.sup) >= 3, `--c-${c} ${color} sobre ${t.sup} (${modo}): ${contraste(color, t.sup).toFixed(2)}`);
    }
    // Ninguna categoría se confunde con el aguamarina (lo nuestro / lo próximo) ni con el ámbar (por confirmar).
    assert.ok(!Object.values(t).some((v) => ['#5EC4B9', '#0A7A70', '#63D0C3', '#955300', '#F0B65A'].includes(v.toUpperCase())), modo);
  }
  for (const c of cats) assert.match(PLANTILLA, new RegExp(`\\[data-cat="${c}"\\] \\{ --c: var\\(--c-${c}\\); \\}`));
});

test('salidas: cada fila lleva a la izquierda la barra del color de su categoría; la próxima salida, además, un fondo aguamarina suave', () => {
  const partidos = [partido({ s: '07:15', vj: 105 }), partido({ f: '2026-09-27', cat: 'Cadete F', ck: 'cadete' })];
  const html = abrirPagina(datos(partidos, { sal: SAL })).contenido.innerHTML;
  assert.match(fila(html, 0).html, /^class="fila prox" data-cat="infantil"/);
  assert.match(fila(html, 1).html, /^class="fila" data-cat="cadete"/);
  const reglas = reglasCss(PLANTILLA).filter((r) => !r.impresion);
  assert.ok(reglas.some((r) => r.selector === '.fila' && /box-shadow: inset 4px 0 0 var\(--c\)/.test(r.cuerpo)), 'barra de categoría');
  assert.ok(reglas.some((r) => r.selector === '.fila.prox' && /background: color-mix\(in srgb, var\(--agua-r\)/.test(r.cuerpo)), 'fondo de la próxima');
});

// --- Selector «Diseño antiguo | Diseño nuevo» -----------------------------------------------------------

test('salidas: selector «Diseño antiguo | Diseño nuevo» arriba del todo, con esta página marcada', () => {
  const s = selectorDiseno(PLANTILLA);
  assert.ok(s, 'falta la franja del selector');
  // Lo primero del <body>: encima de la barra con el escudo.
  assert.equal(PLANTILLA.slice(PLANTILLA.indexOf('<body>') + '<body>'.length, s.inicio).trim(), '');
  assert.ok(s.inicio < PLANTILLA.indexOf('<header class="barra">'));
  assert.match(s.nav, /^<nav class="selector-diseno" aria-label="Diseño de la página">/);
  assert.deepEqual(s.enlaces, [
    { texto: 'Diseño antiguo', id: 'diseno-antiguo', href: 'index.html', actual: false },
    { texto: 'Diseño nuevo', id: 'diseno-nuevo', href: 'salidas.html', actual: true },
  ]);
});

test('salidas: el selector es el mismo en las dos páginas; solo cambia cuál está marcado', () => {
  const antigua = selectorDiseno(plantilla('plantilla.html'));
  assert.ok(antigua, 'falta la franja del selector en plantilla.html');
  // Cada página con su contenedor de siempre (.envoltura en la antigua, .ancho en la nueva).
  const igualar = (s) => s.nav.replace(/ aria-current="page"/g, '').replace('<div class="ancho">', '<div class="envoltura">');
  assert.equal(igualar(selectorDiseno(PLANTILLA)), igualar(antigua));
  // La misma forma (alto, letra, bordes, márgenes) en las dos; solo cambian los colores de cada página.
  const forma = (texto) => reglasSelector(texto).filter((r) => !r.impresion).map((r) => ({
    selector: r.selector.replace(/\.ancho\b/g, '.envoltura'),
    cuerpo: r.cuerpo.replace(/var\(--[\w-]+\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi, 'COLOR'),
  }));
  assert.ok(forma(PLANTILLA).length > 0);
  assert.deepEqual(forma(PLANTILLA), forma(plantilla('plantilla.html')));
});

test('salidas: «Diseño antiguo» lleva a index.html en la web y, en el ordenador, al .html de siempre (el nombre del .ics)', () => {
  const d = datos([partido()], { ics: 'calendario-dompavolei-2026-27.ics' });
  assert.equal(abrirPagina(d).porId('diseno-antiguo').href, 'index.html');
  assert.equal(abrirPagina(d, { protocolo: 'file:' }).porId('diseno-antiguo').href, 'calendario-dompavolei-2026-27.html');
});

test('salidas: «Diseño nuevo» es salidas.html en la web y, en el ordenador, la de su misma base (<nombre>-salidas.html)', () => {
  // En el ordenador, cada página nueva va con el nombre de la suya: dos temporadas o dos clubs en la misma
  // carpeta, o --nombre-base salidas, no se pisan.
  const d = datos([partido()], { ics: 'calendario-dompavolei-2025-26.ics' });
  assert.equal(abrirPagina(d).porId('diseno-nuevo').href, 'salidas.html');
  assert.equal(abrirPagina(d, { protocolo: 'file:' }).porId('diseno-nuevo').href, 'calendario-dompavolei-2025-26-salidas.html');
  const s = datos([partido()], { ics: 'salidas.ics' });
  assert.equal(abrirPagina(s, { protocolo: 'file:' }).porId('diseno-antiguo').href, 'salidas.html');
  assert.equal(abrirPagina(s, { protocolo: 'file:' }).porId('diseno-nuevo').href, 'salidas-salidas.html');
});

test('salidas: la franja del selector mide 36-40 px, se va con el scroll (no tapa nada) y no sale al imprimir', () => {
  const reglas = reglasSelector(PLANTILLA);
  const pantalla = reglas.filter((r) => !r.impresion);
  const altos = pantalla.flatMap((r) => [...r.cuerpo.matchAll(/min-height: (\d+)px/g)].map((m) => +m[1]));
  assert.ok(altos.some((a) => a >= 36 && a <= 40), `alto de la franja: ${altos.join(', ')}`);
  for (const r of pantalla) assert.doesNotMatch(r.cuerpo, /position: *(sticky|fixed)/, r.selector);
  assert.ok(reglas.some((r) => r.impresion && /(^|,)\s*\.selector-diseno\s*(,|$)/.test(r.selector) && /display: none/.test(r.cuerpo)),
    'la franja sale al imprimir');
});

// --- Una fila por partido y la columna de la hora ----------------------------------------------------------

test('salidas: una fila por partido; el 2.º partido del día va en su propia fila', () => {
  const partidos = [
    partido({ s: '07:15', vj: 105, mun: 'MARÍN' }),
    partido({ h: '11:30', l: 'DOMPAVOLEI IF1', v: 'CV OLEIROS IFA', lo: true, vo: false, cond: 'local', ca: '', seg: true, sp: '07:15', mun: 'MARÍN' }),
  ];
  const html = abrirPagina(datos(partidos, { sal: SAL })).contenido.innerHTML;
  const lista = filas(html);
  assert.deepEqual(lista.map((f) => f.i), [0, 1]);
  assert.equal(columnaHora(lista[0]), 'Salida 07:15 partido 10:00');
  assert.equal(columnaHora(lista[1]), '2.º partido 11:30 bus de 07:15');
  assert.deepEqual(equipos(lista[1].html).map((e) => e.nombre), ['DOMPAVOLEI INFANTIL', 'CV OLEIROS IFA']);
});

// Los dos equipos de una fila, en orden (local, visitante): [{ nombre, nuestro, tanteo }].
function equipos(htmlFila) {
  return [...htmlFila.matchAll(/<div class="eq (nuestro|rival)">([\s\S]*?)<\/div>/g)].map((m) => ({
    nombre: texto((/<span class="nom">([\s\S]*?)<\/span>/.exec(m[2]) || [])[1] || ''),
    nuestro: m[1] === 'nuestro',
    tanteo: (/<b class="tanteo">(\d+)<\/b>/.exec(m[2]) || [])[1] || '',
  }));
}

test('salidas: los dos equipos uno debajo del otro, primero el local; el nuestro en negrita con el punto de su color', () => {
  const partidos = [
    partido({ l: 'SEI SAN NARCISO IF', v: 'DOMPAVOLEI IF1', lo: false, vo: true, cond: 'visitante' }),
    partido({ f: '2026-09-27', l: 'DOMPAVOLEI IF1', v: 'CV OLEIROS IFA', lo: true, vo: false, cond: 'local' }),
    partido({ f: '2026-09-28', l: 'DOMPAVOLEI CF1', v: 'DOMPAVOLEI IF1', lo: true, vo: true, cond: 'derbi' }),
  ];
  const d = datos(partidos, { sal: SAL, corto: 'Dompa' });
  d.equipos.push({ n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 });
  const html = abrirPagina(d).contenido.innerHTML;
  const nombres = (i) => equipos(fila(html, i).html).map((e) => (e.nuestro ? `*${e.nombre}*` : e.nombre));
  assert.deepEqual(nombres(0), ['SEI SAN NARCISO IF', '*DOMPA INFANTIL*']);   // de visitante: en segundo lugar
  assert.deepEqual(nombres(1), ['*DOMPA INFANTIL*', 'CV OLEIROS IFA']);
  assert.deepEqual(nombres(2), ['*DOMPA CADETE*', '*DOMPA INFANTIL*']);
  // El nuestro lleva el punto de su color; el rival, un hueco del mismo ancho para que los nombres queden en columna.
  assert.match(fila(html, 0).html, /<div class="eq rival"><span class="punto hueco" aria-hidden="true"><\/span><span class="nom">SEI SAN NARCISO IF<\/span><\/div>/);
  assert.match(fila(html, 0).html, /<div class="eq nuestro"><span class="punto" aria-hidden="true"><\/span><span class="sr-only">contra <\/span><span class="nom">DOMPA INFANTIL<\/span><\/div>/);
});

test('salidas: el nombre de cada equipo, con la F o la M solo si hay los dos sexos y con número solo si hay varios de la categoría', () => {
  const equiposClub = [
    ['DOMPAVOLEI IF1', 'Infantil F', 'infantil'], ['DOMPAVOLEI IF2', 'Infantil F', 'infantil'], ['DOMPAVOLEI CF1', 'Cadete F', 'cadete'],
    ['DOMPAVOLEI XF1', 'Juvenil F', 'juvenil'], ['DOMPAVOLEI SF1', 'Senior F', 'senior'], ['DOMPAVOLEI SM1', 'Senior M', 'senior'],
    ['DOMPAVOLEI SM2', 'Senior M', 'senior'], ['DOMPA LAGOAS', 'Cadete F', 'cadete'],
  ];
  const partidos = equiposClub.map(([n, cat, ck], i) => partido({ f: `2026-10-${String(i + 1).padStart(2, '0')}`, v: n, cat, ck }));
  const d = datos(partidos, { sal: SAL, corto: 'Dompa' });
  d.equipos = equiposClub.map(([n, cat, ck]) => ({ n, cat, ck, ics: '', np: 1 }));
  const html = abrirPagina(d).contenido.innerHTML;
  const nuestro = (i) => equipos(fila(html, i).html).find((e) => e.nuestro).nombre;
  assert.deepEqual(equiposClub.map((_, i) => nuestro(i)), [
    'DOMPA INFANTIL 1', 'DOMPA INFANTIL 2', 'DOMPA CADETE', 'DOMPA JUVENIL', 'DOMPA SENIOR F', 'DOMPA SENIOR M 1', 'DOMPA SENIOR M 2',
    'DOMPA LAGOAS',   // no sigue el patrón de código (IF1, CF2…): tal cual
  ]);
  // Sin nombre corto en config.json, el del club.
  const sinCorto = abrirPagina(datos([partido({ v: 'DOMPAVOLEI IF1' })])).contenido.innerHTML;
  assert.equal(equipos(fila(sinCorto, 0).html).find((e) => e.nuestro).nombre, 'DOMPAVOLEI INFANTIL');
});

test('salidas: debajo de los equipos, adónde se va (icono de ubicación) y la píldora local/visitante', () => {
  const html = abrirPagina(datos([partido({ s: '07:15', vj: 105, mun: 'MARÍN' })], { sal: SAL })).contenido.innerHTML;
  assert.match(html, /<div class="dest"><svg class="hacia" [^>]*aria-hidden="true"><use href="#i-lugar"\/><\/svg><span class="sr-only">En <\/span><span class="lugar">MARÍN<\/span><span class="cond visitante">Visitante<\/span><\/div>/);
  assert.match(PLANTILLA, /<symbol id="i-lugar"/);
});

test('salidas: la columna de la hora en cada caso de la tabla del diseño', () => {
  const r = { m: [0, 3], s: [[24, 26], [23, 25], [20, 25]] };
  const partidos = [
    /* 0 */ partido({ f: '2026-09-19', s: '07:30', vj: 90, r }),                          // jugado, con salida
    /* 1 */ partido({ f: '2026-09-19', h: '11:30', ca: '', seg: true, sp: '07:30', r }),  // jugado, 2.º partido
    /* 2 */ partido({ s: '07:15', vj: 105 }),                                             // salida en bus
    /* 3 */ partido({ f: '2026-09-27', h: '12:00', ca: '11:00', casa: true, pab: 'ANEXO OS REMEDIOS - PISTA 1' }), // en casa
    /* 4 */ partido({ f: '2026-09-28' }),                                                 // salida sin calcular
    /* 5 */ partido({ f: '2026-10-03', h: '', e: 'h', ca: '' }),                          // hora por confirmar
    /* 6 */ partido({ f: '2026-10-03', h: '', e: 'h', ca: '', casa: true, v: 'DOMPAVOLEI CF1' }), // ídem, en casa
    /* 7 */ partido({ f: '2026-10-04', h: '', e: 'x', ca: '' }),                          // fecha y hora por confirmar
    /* 8 */ partido({ f: '2026-10-10', e: 'p', s: '06:45', vj: 120 }),                    // provisional
    /* 9 */ partido({ f: '2026-10-11', h: '12:00', ca: '', seg: true, sp: '', casa: true }), // 2.º partido en casa
  ];
  const html = abrirPagina(datos(partidos, { sal: SAL }), { almacen: conFiltros({ per: 'todo' }) }).contenido.innerHTML;
  const hora = (i) => columnaHora(fila(html, i));
  assert.equal(hora(0), 'Salió 07:30 partido 10:00');
  assert.equal(hora(1), 'Partido 11:30');
  assert.equal(hora(2), 'Salida 07:15 partido 10:00');
  assert.equal(hora(3), 'En casa 11:00 partido 12:00');
  assert.equal(hora(4), 'Partido 10:00 salida sin calcular');
  assert.equal(hora(5), 'Hora por confirmar');
  assert.equal(hora(6), 'En casa Hora por confirmar');
  assert.equal(hora(7), 'Fecha y hora por confirmar');
  assert.equal(hora(8), 'Salida 06:45 partido 10:00 provisional');
  assert.equal(hora(9), '2.º partido 12:00 en casa');
  // La hora en texto normal y grande (sin tablillas); «SALIDA» en marino, el resto de rótulos en gris; lo que
  // no es firme, en ámbar; lo ya jugado, en gris.
  assert.match(fila(html, 2).html, /<span class="etq">Salida<\/span><span class="h">07:15<\/span>/);
  assert.match(fila(html, 3).html, /<span class="etq gris">En casa<\/span>/);
  assert.match(fila(html, 0).html, /<span class="etq gris">Salió<\/span><span class="h gris">07:30<\/span>/);
  assert.match(fila(html, 4).html, /<span class="ph amb">salida sin calcular<\/span>/);
  assert.match(fila(html, 5).html, /<span class="pend">Hora por confirmar<\/span>/);
  assert.match(fila(html, 8).html, /<span class="ph amb">provisional<\/span>/);
  // Lo jugado va sin tarjeta (sobre el fondo).
  assert.ok(fila(html, 0).clases.includes('jugada'));
  assert.ok(!fila(html, 2).clases.includes('jugada'));
});

test('salidas: sin horas de salida configuradas, «PARTIDO» y la hora del partido, sin avisos', () => {
  const html = abrirPagina(datos([partido(), partido({ h: '12:00', e: 'p' })])).contenido.innerHTML;
  assert.equal(columnaHora(fila(html, 0)), 'Partido 10:00');
  assert.equal(columnaHora(fila(html, 1)), 'Partido 12:00 provisional');
  assert.ok(!html.includes('salida sin calcular'));
});

// --- Columna derecha -----------------------------------------------------------------------------------

test('salidas: local o visitante siempre a la vista, también en lo ya jugado y sin hora', () => {
  const r = { m: [3, 1], s: [[25, 20], [20, 25], [25, 18], [25, 22]] };
  const partidos = [
    partido({ f: '2026-09-19', l: 'DOMPAVOLEI IF1', v: 'CV RIVAL', lo: true, vo: false, cond: 'local', r }),
    partido({ s: '07:15' }),
    partido({ f: '2026-10-04', h: '', e: 'x', l: 'DOMPAVOLEI CF1', v: 'DOMPAVOLEI IF1', lo: true, vo: true, cond: 'derbi' }),
  ];
  const d = datos(partidos, { sal: SAL });
  d.equipos.push({ n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 });
  const html = abrirPagina(d, { almacen: conFiltros({ per: 'todo' }) }).contenido.innerHTML;
  assert.match(fila(html, 0).html, /<span class="cond local">Local<\/span>/);
  assert.match(fila(html, 1).html, /<span class="cond visitante">Visitante<\/span>/);
  assert.match(fila(html, 2).html, /<span class="cond derbi">Derbi<\/span>/);
  for (const f of filas(html)) assert.match(f.html, /<span class="cond (local|visitante|derbi)">/);
});

test('salidas: destino (municipio, o el pabellón en casa) y píldora local / visitante / derbi', () => {
  const partidos = [
    partido({ s: '07:15', mun: 'MARÍN', pab: 'PABELLÓN COLEGIO SAN NARCISO - PISTA 1' }),
    partido({ f: '2026-09-27', casa: true, mun: 'OURENSE', pab: 'ANEXO OS REMEDIOS - PISTA 1', l: 'DOMPAVOLEI IF1', v: 'XUVENIL TEIS B', lo: true, vo: false, cond: 'local' }),
    partido({ f: '2026-09-28', mun: '', pab: 'POLIDEPORTIVO TORRES COLOMER PISTA 1' }),
    partido({ f: '2026-09-29', pab: '', mun: '' }),
    partido({ f: '2026-09-30', l: 'DOMPAVOLEI CF1', v: 'DOMPAVOLEI IF1', lo: true, vo: true, cond: 'derbi', mun: 'LUGO' }),
  ];
  const d = datos(partidos, { sal: SAL });
  d.equipos.push({ n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 });
  const html = abrirPagina(d).contenido.innerHTML;
  const destino = (i) => texto(/<div class="dest">([\s\S]*?)<\/div>/.exec(fila(html, i).html)[1]);
  // «En» es el texto para lectores de pantalla que acompaña al icono de ubicación.
  assert.equal(destino(0), 'En MARÍN Visitante');
  assert.equal(destino(1), 'En ANEXO OS REMEDIOS Local');
  assert.equal(destino(2), 'En POLIDEPORTIVO TORRES COLOMER Visitante');
  assert.equal(destino(3), 'En Pabellón por confirmar Visitante');
  assert.equal(destino(4), 'En LUGO Derbi');
});

test('salidas: «PRÓXIMA SALIDA» solo en la primera salida en bus por jugar de las que se ven', () => {
  const r = { m: [0, 3], s: [[24, 26], [23, 25], [20, 25]] };
  const partidos = [
    /* 0 */ partido({ f: '2026-09-19', s: '07:30', r }),                  // ya jugado
    /* 1 */ partido({ h: '09:00', ca: '08:00', casa: true, v: 'DOMPAVOLEI CF1' }), // en casa, antes: no es una salida
    /* 2 */ partido({ s: '07:15', vj: 105 }),                             // la próxima salida
    /* 3 */ partido({ h: '11:30', ca: '', seg: true, sp: '07:15' }),
    /* 4 */ partido({ f: '2026-09-27', s: '08:15', v: 'DOMPAVOLEI CF1' }),
  ];
  const d = datos(partidos, { sal: SAL });
  d.equipos.push({ n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 2 });
  let html = abrirPagina(d, { almacen: conFiltros({ per: 'todo' }) }).contenido.innerHTML;
  assert.equal(html.split('Próxima salida').length - 1, 1);
  assert.match(fila(html, 2).html, /<span class="proxm">Próxima salida<\/span>/);
  assert.deepEqual(filas(html).filter((f) => f.clases.includes('prox')).map((f) => f.i), [2]);
  // Con solo CF1 elegido, la primera salida que se ve es la del domingo.
  html = abrirPagina(d, { almacen: conFiltros({ per: 'todo', eq: ['DOMPAVOLEI CF1'] }) }).contenido.innerHTML;
  assert.deepEqual(filas(html).map((f) => f.i), [1, 4]);
  assert.deepEqual(filas(html).filter((f) => f.clases.includes('prox')).map((f) => f.i), [4]);
});

test('salidas: sin horas de salida, «PRÓXIMO PARTIDO» en el primero por jugar (como el «Próximo» de siempre)', () => {
  const html = abrirPagina(datos([partido(), partido({ f: '2026-09-27' })])).contenido.innerHTML;
  assert.match(fila(html, 0).html, /<span class="proxm">Próximo partido<\/span>/);
  assert.ok(!fila(html, 1).html.includes('proxm'));
  assert.ok(!html.includes('Próxima salida'));
});

test('salidas: resultado desde el lado del club («Ganado 3-0» con los sets dados la vuelta de visitante)', () => {
  const partidos = [
    partido({ f: '2026-09-19', s: '07:30', r: { m: [0, 3], s: [[24, 26], [23, 25], [20, 25]] } }),
    partido({ f: '2026-09-20', l: 'DOMPAVOLEI IF1', v: 'CV RIVAL', lo: true, vo: false, cond: 'local', r: { m: [2, 3], s: [[25, 20], [20, 25], [25, 18], [22, 25], [10, 15]] } }),
  ];
  const html = abrirPagina(datos(partidos, { sal: SAL }), { almacen: conFiltros({ per: 'todo' }) }).contenido.innerHTML;
  // Como un marcador: los sets de cada equipo en su línea (local arriba) y, debajo, ganado o perdido con los sets.
  assert.deepEqual(equipos(fila(html, 0).html).map((e) => [e.nombre, e.tanteo]), [['CV RIVAL', '0'], ['DOMPAVOLEI INFANTIL', '3']]);
  assert.deepEqual(equipos(fila(html, 1).html).map((e) => [e.nombre, e.tanteo]), [['DOMPAVOLEI INFANTIL', '2'], ['CV RIVAL', '3']]);
  assert.match(fila(html, 0).html, /<div class="res gana">Ganado<small>26-24 · 25-23 · 25-20<\/small><\/div>/);
  assert.match(fila(html, 1).html, /<div class="res pierde">Perdido<small>25-20 · 20-25 · 25-18 · 22-25 · 10-15<\/small><\/div>/);
});

// --- Botones -------------------------------------------------------------------------------------------

test('salidas: WhatsApp, Copiar y Pedir bus solo donde tocan, en una línea bajo la fila', () => {
  const r = { m: [1, 3], s: [[20, 25], [25, 20], [18, 25], [22, 25]] };
  const partidos = [
    /* 0 */ partido({ f: '2026-09-25', h: '', e: 'h', r, wa: 'Mensaje de hoy' }),            // con resultado: no
    /* 1 */ partido({ s: '07:15', vj: 105, wa: 'Mensaje de mañana' }),                        // los tres
    /* 2 */ partido({ h: '11:30', ca: '', seg: true, sp: '07:15' }),                          // 2.º partido: ninguno
    /* 3 */ partido({ f: '2026-09-27', casa: true, v: 'DOMPAVOLEI CF1', wa: 'En casa' }),    // WhatsApp y Copiar, sin bus
    /* 4 */ partido({ f: '2026-09-19', s: '07:30', wa: 'Pasado' }),                           // ya jugado: ninguno
  ];
  const d = datos(partidos, { sal: SAL, bus: BUS });
  d.equipos.push({ n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 });
  const html = abrirPagina(d, { almacen: conFiltros({ per: 'todo' }) }).contenido.innerHTML;
  assert.deepEqual(conCopiar(html), [1, 3]);
  const botones = (i) => {
    const acc = /<div class="acc">([\s\S]*?)<\/div>/.exec(fila(html, i).html);
    return acc ? [...acc[1].matchAll(/class="(boton-[^"]*)"/g)].map((m) => m[1]) : [];
  };
  assert.deepEqual(botones(1), ['boton-wa wa', 'boton-wa copiar', 'boton-bus']);
  assert.deepEqual(botones(3), ['boton-wa wa', 'boton-wa copiar']);
  for (const i of [0, 2, 4]) assert.deepEqual(botones(i), [], `partido ${i}`);
  // Sin configuración de bus, no hay «Pedir bus».
  const sinBus = abrirPagina(datos([partido({ s: '07:15', wa: 'x' })], { sal: SAL })).contenido.innerHTML;
  assert.ok(!sinBus.includes('boton-bus'));
  // Sin emojis en la página: iconos SVG.
  assert.ok(!/📋|✉|🚌/u.test(html));
  assert.match(html, /<svg[^>]*><use href="#i-msg"\/><\/svg>WhatsApp/);
});

test('salidas: el enlace «WhatsApp» va directo a api.whatsapp.com con el mensaje entero', () => {
  const mensaje = '🏐 *DOMPAVOLEI IF1* (Infantil F)\n📅 *Sábado 26 de septiembre*\n⏰ 🏟️ A & B #1 +2';
  const html = abrirPagina(datos([partido({ wa: mensaje })])).contenido.innerHTML;
  const enlaces = [...html.matchAll(/class="boton-wa wa" href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.equal(enlaces.length, 1);
  const prefijo = 'https://api.whatsapp.com/send?text=';
  assert.ok(enlaces[0].startsWith(prefijo), enlaces[0]);
  assert.equal(decodeURIComponent(enlaces[0].slice(prefijo.length)), mensaje);
  assert.ok(!html.includes('wa.me'));
});

test('salidas: «Copiar» sin navigator.clipboard copia con el método antiguo y el foco vuelve al botón', () => {
  const pagina = abrirPagina(datos([partido({ wa: 'Mensaje para las familias' })]));
  const boton = pulsarCopiar(pagina, 0, 'Copiar');
  assert.equal(pagina.copiado, 'Mensaje para las familias');
  assert.equal(boton.textContent, '✓ Copiado');
  assert.equal(pagina.estado.textContent, 'Mensaje copiado');
  assert.equal(foco(pagina), 'el botón');
});

test('salidas: «Copiar» cuando navigator.clipboard falla: método antiguo y el foco vuelve al botón', async () => {
  const portapapeles = { writeText() { return Promise.reject(new Error('sin permiso')); } };
  const pagina = abrirPagina(datos([partido({ wa: 'Mensaje para las familias' })]), { portapapeles, seguro: true });
  const boton = pulsarCopiar(pagina, 0, 'Copiar');
  await new Promise((fin) => { setImmediate(fin); });
  assert.equal(pagina.copiado, 'Mensaje para las familias');
  assert.equal(boton.textContent, '✓ Copiado');
  assert.equal(foco(pagina), 'el botón');
});

test('salidas: «Pedir bus» con el mismo correo que la página de siempre (vuelta tras el último partido)', () => {
  const partidos = [
    partido({ l: 'DOMPAVOLEI IF1', v: 'DOMPAVOLEI IF2', lo: true, vo: true, cond: 'derbi', s: '07:15', vj: 105 }),
    partido({ h: '12:00', l: 'DOMPAVOLEI IF2', v: 'DOMPAVOLEI IF1', lo: true, vo: true, cond: 'derbi', ca: '', seg: true, sp: '07:15' }),
    partido({ f: '2026-10-03', s: '07:15', vj: 105 }),
    partido({ f: '2026-10-03', h: '12:00', l: 'Dompavolei IF1', v: 'CV OTRO', lo: true, vo: false, cond: 'local', ca: '', seg: true, sp: '07:15' }),
  ];
  const correos = correosBus(abrirPagina(datos(partidos, { sal: SAL, bus: BUS })).contenido.innerHTML);
  assert.equal(correos.length, 2);
  const [derbi, mayusculas] = correos;
  assert.ok(derbi.includes('- Partidos: 10:00 contra otro equipo del club; 12:00 contra otro equipo del club'), derbi.join('\n'));
  assert.ok(derbi.includes('- Regreso: al terminar el último partido, hacia las 14:00; llegada aproximada a Os Remedios a las 15:45'),
    derbi.join('\n'));
  assert.ok(mayusculas.includes('- Partidos: 10:00 contra CV RIVAL; 12:00 contra CV OTRO'), mayusculas.join('\n'));
});

// --- Detalle desplegable -------------------------------------------------------------------------------

test('salidas: la flecha de cada fila abre y cierra su detalle (pabellón, mapa, competición y viaje)', () => {
  const partidos = [
    partido({ s: '07:15', vj: 105, mun: 'MARÍN', pab: 'PABELLÓN COLEGIO SAN NARCISO - PISTA 1' }),
    partido({ h: '11:30', ca: '', seg: true, sp: '07:15', mun: 'MARÍN', pab: 'PABELLÓN COLEGIO SAN NARCISO - PISTA 1' }),
  ];
  const pabs = { 'PABELLÓN COLEGIO SAN NARCISO - PISTA 1': { dir: 'CHAN DO MONTE, 27, 36900 MARÍN', mun: 'MARÍN' } };
  const pagina = abrirPagina(datos(partidos, { sal: SAL, pabs }));
  const html = pagina.contenido.innerHTML;
  const f0 = fila(html, 0).html;
  assert.match(f0, /<button type="button" class="chev" aria-expanded="false" aria-controls="det-0"/);
  const det = /<div class="det" id="det-0" hidden>([\s\S]*?)<\/div>/.exec(f0);
  assert.ok(det, f0);
  const t = texto(det[1]);
  assert.ok(t.includes('PABELLÓN COLEGIO SAN NARCISO - PISTA 1'), t);
  assert.ok(t.includes('CHAN DO MONTE, 27, 36900 MARÍN'), t);
  assert.ok(t.includes('LIGA INFANTIL F'), t);
  // Cada dato del detalle en su línea, con su icono: pabellón, competición, viaje en bus y calentamiento.
  const linea = (icono, textoLinea) => new RegExp(`<p class="dl"><svg[^>]*><use href="#${icono}"/></svg><span>${textoLinea}`);
  assert.match(det[1], linea('i-lugar', '<a href="https://www\\.google\\.com/maps/search/\\?api=1&amp;query='));
  assert.match(det[1], linea('i-copa', 'LIGA INFANTIL F'));
  assert.match(det[1], linea('i-bus', '1 h 45 min en bus hasta Marín</span>'));
  assert.match(det[1], linea('i-calor', 'Calentamiento 09:00</span>'));
  assert.match(fila(html, 1).html, linea('i-bus', 'Se va con el partido anterior \\(salida 07:15\\)</span>'));
  // Pulsar la flecha: se abre; otra vez: se cierra.
  const flecha = elemento(pagina.doc, 'button');
  flecha.classList.add('chev');
  flecha.setAttribute('aria-controls', 'det-0');
  flecha.setAttribute('aria-expanded', 'false');
  const panel = pagina.porId('det-0');
  panel.hidden = true;
  pagina.contenido.oyentes.click({ target: flecha });
  assert.equal(flecha.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.hidden, false);
  pagina.contenido.oyentes.click({ target: flecha });
  assert.equal(flecha.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.hidden, true);
});

// --- Días --------------------------------------------------------------------------------------------

test('salidas: cabecera de cada día con su nota (hoy, mañana, fecha por confirmar, jugados)', () => {
  const partidos = [
    partido({ f: '2026-09-19' }),
    partido({ f: '2026-09-25', h: '20:00' }),
    partido({ f: '2026-09-26' }),
    partido({ f: '2026-10-04', h: '', e: 'x' }),
    partido({ f: '2026-10-10' }),
  ];
  const html = abrirPagina(datos(partidos), { almacen: conFiltros({ per: 'todo' }) }).contenido.innerHTML;
  const cabeceras = [...html.matchAll(/<h3 class="dia-cab" tabindex="-1">([\s\S]*?)<\/h3>/g)].map((m) => texto(m[1]));
  assert.deepEqual(cabeceras, [
    'Sábado 19 sept. jugados', 'Viernes 25 sept. hoy', 'Sábado 26 sept. mañana', 'Domingo 4 oct. fecha por confirmar', 'Sábado 10 oct.',
  ]);
  assert.match(html, /<span class="nota amb">fecha por confirmar<\/span>/);
  assert.match(html, /<section class="dia pasado" id="d-2026-09-19">/);
  assert.match(html, /<section class="dia" id="d-2026-09-26">/);
});

// --- Cabecera, pestañas, filtros y estado ------------------------------------------------------------------

test('salidas: pestañas ocultas sin clasificaciones y a la vista con ellas', () => {
  let pagina = abrirPagina(datos([partido()]));
  assert.ok(pagina.porId('pestanas').classList.contains('oculto'));
  const clas = [{ eq: 'DOMPAVOLEI IF1', comp: 'LIGA', g: 'GRUPO 1', url: 'https://example.org/c', act: '25/09 11:16',
    filas: [{ p: 1, n: 'DOMPAVOLEI IF1', pt: 3, pj: 1, pg: 1, pp: 0, sf: 3, sc: 0, o: true }] }];
  pagina = abrirPagina(datos([partido()], { clas }), { almacen: conFiltros({ seccion: 'clas' }) });
  assert.ok(!pagina.porId('pestanas').classList.contains('oculto'));
  // En Clasificación: las tablas, con nuestra fila marcada; sin «Salidas desde…» ni Lista/Mes ni Filtros.
  assert.match(pagina.contenido.innerHTML, /<tr class="nuestro">/);
  assert.match(pagina.contenido.innerHTML, /Comprobada el 25\/09 11:16 · <a href="https:\/\/example\.org\/c"/);
  assert.ok(pagina.porId('cab-seccion').classList.contains('oculto'));
  assert.ok(pagina.porId('btn-filtros').classList.contains('oculto'));
});

test('salidas: escudo en la barra si hay, y el título de la sección con el origen de las salidas', () => {
  let pagina = abrirPagina(datos([partido()], { sal: SAL, escudo: 'data:image/png;base64,AAAA' }));
  assert.match(pagina.porId('escudo').innerHTML, /<img src="data:image\/png;base64,AAAA" alt="" width="36" height="36">/);
  assert.ok(!pagina.porId('escudo').classList.contains('oculto'));
  assert.equal(pagina.porId('club').textContent, 'DOMPAVOLEI');
  assert.equal(pagina.porId('temporada').textContent, 'Temporada 2026/27');
  assert.equal(pagina.porId('titulo-seccion').textContent, 'Salidas desde Os Remedios');
  pagina = abrirPagina(datos([partido()], { escudo: '' }));
  assert.ok(pagina.porId('escudo').classList.contains('oculto'));
  assert.equal(pagina.porId('titulo-seccion').textContent, 'Partidos');
});

test('salidas: chips con el código corto de cada equipo con partidos, y «Todos»', () => {
  const d = datos([partido(), partido({ v: 'DOMPAVOLEI CF1', f: '2026-09-27' })]);
  d.equipos = [
    { n: 'DOMPAVOLEI IF1', cat: 'Infantil F', ck: 'infantil', ics: '', np: 1 },
    { n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 },
    { n: 'DOMPAVOLEI SM1', cat: 'Senior M', ck: 'senior', ics: '', np: 0 },
  ];
  const chips = abrirPagina(d).porId('chips').innerHTML;
  assert.deepEqual([...chips.matchAll(/data-eq="([^"]*)"/g)].map((m) => m[1]), ['', 'DOMPAVOLEI IF1', 'DOMPAVOLEI CF1']);
  assert.deepEqual(texto(chips).split(' ').filter((x) => /^(Todos|IF1|CF1)$/.test(x)), ['Todos', 'IF1', 'CF1']);
  // Como en la página de siempre: el punto del color de la categoría, el código y la categoría.
  assert.match(chips, /<button type="button" class="chip" data-cat="infantil" data-eq="DOMPAVOLEI IF1"[^>]*><span class="punto" aria-hidden="true"><\/span>IF1 <span class="cat-chip">Infantil F<\/span><\/button>/);
  assert.match(chips, /data-cat="cadete" data-eq="DOMPAVOLEI CF1"[^>]*><span class="punto" aria-hidden="true"><\/span>CF1 <span class="cat-chip">Cadete F<\/span>/);
});

test('salidas: los chips que no caben se desplazan dentro de su fila, sin mover la página de lado a 375 px', () => {
  // La fila de chips se desplaza en horizontal dentro de sí misma y está posicionada, para que nada de
  // dentro (p. ej. un .sr-only, que es absolute) se coloque respecto a la fila fija y alargue la página.
  const fila = reglasCss(PLANTILLA).filter((r) => !r.impresion && r.selector === '.chips');
  assert.ok(fila.some((r) => /overflow-x: auto/.test(r.cuerpo)), 'la fila de chips no se desplaza');
  assert.ok(fila.some((r) => /position: relative/.test(r.cuerpo)), 'la fila de chips no está posicionada');
});

test('salidas: la fila fija (chips y «Filtros») no tapa lo que tiene el foco: scroll-padding-top con su alto', () => {
  // Con Tab o Mayús+Tab, el navegador lleva lo enfocado al borde de arriba, justo debajo de la fila fija
  // (WCAG 2.2, 2.4.11). Se reserva su alto (más 8 px) en el desplazamiento de la página, y se recalcula
  // cuando cambia.
  const pagina = abrirPagina(datos([partido()]), { alturas: { fijos: 65 } });
  const raiz = pagina.doc.documentElement;
  const fijos = pagina.porId('fijos');
  assert.equal(raiz.style.scrollPaddingTop, '73px');
  // Al abrir «Filtros», la fila crece.
  fijos.offsetHeight = 140;
  pagina.porId('btn-filtros').oyentes.click();
  assert.equal(raiz.style.scrollPaddingTop, '148px');
  // Al pasar a Clasificación (sin «Filtros») y al volver.
  fijos.offsetHeight = 66;
  const boton = elemento(pagina.doc, 'button');
  boton.dataset.seccion = 'clas';
  pagina.porId('pestanas').oyentes.click({ target: boton });
  assert.equal(raiz.style.scrollPaddingTop, '74px');
  // Al cambiar el ancho de la ventana (girar el móvil): en un navegador sin ResizeObserver, con "resize".
  fijos.offsetHeight = 110;
  pagina.ventana.oyentes.resize();
  assert.equal(raiz.style.scrollPaddingTop, '118px');
});

test('salidas: los filtros se guardan con una clave propia (no la de la página de siempre) y «Filtros» cuenta los cambiados', () => {
  const partidos = [partido()];
  // La clave de la página de siempre no cuenta.
  let pagina = abrirPagina(datos(partidos), { almacen: new Map([['calendario-voley:DOMPAVOLEI', JSON.stringify({ vista: 'mes' })]]) });
  assert.ok(!pagina.contenido.innerHTML.includes('rejilla'));
  assert.equal(pagina.porId('btn-filtros').textContent, 'Filtros');
  // La propia sí.
  pagina = abrirPagina(datos(partidos), { almacen: conFiltros({ vista: 'mes', per: 'todo', cond: 'visitante' }) });
  assert.match(pagina.contenido.innerHTML, /class="rejilla"/);
  assert.equal(pagina.porId('btn-filtros').textContent, 'Filtros · 1');   // en el Mes no hay periodo
  pagina = abrirPagina(datos(partidos), { almacen: conFiltros({ per: 'todo', cond: 'visitante' }) });
  assert.equal(pagina.porId('btn-filtros').textContent, 'Filtros · 2');
  // Al pulsar un filtro se guarda en la clave propia.
  const almacen = new Map();
  pagina = abrirPagina(datos(partidos), { almacen });
  const boton = elemento(pagina.doc, 'button');
  boton.dataset.cond = 'local';
  pagina.porId('panel-filtros').oyentes.click({ target: boton });
  assert.equal(JSON.parse(almacen.get(CLAVE)).cond, 'local');
  assert.equal(almacen.has('calendario-voley:DOMPAVOLEI'), false);
});

test('salidas: #estado anuncia el recuento y los filtros', () => {
  const pagina = abrirPagina(datos([partido(), partido({ f: '2026-09-27' }), partido({ f: '2026-09-19' })]));
  assert.equal(pagina.estado.textContent, '2 partidos · Todos los equipos · próximos partidos');
  assert.equal(pagina.porId('filtro-imp').textContent, 'Todos los equipos · próximos partidos · actualizado el 25/09/2026 12:00');
});

test('salidas: vacíos con los mensajes de siempre y el botón para quitar filtros', () => {
  let html = abrirPagina(datos([])).contenido.innerHTML;
  assert.match(html, /Todavía no hay partidos publicados para esta temporada/);
  html = abrirPagina(datos([partido({ f: '2026-09-19' })])).contenido.innerHTML;
  assert.match(html, /No quedan partidos por jugar esta temporada\.[\s\S]*id="quitar"[^>]*>Ver toda la temporada</);
  html = abrirPagina(datos([partido()]), { almacen: conFiltros({ cond: 'local' }) }).contenido.innerHTML;
  assert.match(html, /No hay partidos con estos filtros\.[\s\S]*id="quitar"[^>]*>Ver todos los partidos</);
});

test('salidas: vista Mes con los códigos de los equipos (máx. 2 y «+N») y la hora de salida', () => {
  const partidos = [
    partido({ s: '07:15' }),
    partido({ h: '11:30', ca: '', seg: true, sp: '07:15' }),
    partido({ h: '11:30', v: 'DOMPAVOLEI CF1', s: '09:30' }),
    partido({ h: '12:00', v: 'DOMPAVOLEI XF1', casa: true }),
  ];
  const d = datos(partidos, { sal: SAL });
  d.equipos.push({ n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 }, { n: 'DOMPAVOLEI XF1', cat: 'Juvenil F', ck: 'juvenil', ics: '', np: 1 });
  const html = abrirPagina(d, { almacen: conFiltros({ vista: 'mes' }) }).contenido.innerHTML;
  const celda = /<div class="celda[^"]*" data-ir="2026-09-26"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  assert.ok(celda, html);
  assert.equal(texto(celda[1]), '26 IF1 07:15 CF1 09:30 +1');
  assert.match(html, /aria-label="26 de septiembre: 4 partidos"/);
  assert.match(html, /<div class="celda hoy">/);
});
