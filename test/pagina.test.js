// Pruebas de la página «Salidas desde Os Remedios» (el <script> de plantilla.html), ejecutada con node:vm
// en el DOM simulado de test/apoyo/pagina-simulada.js. Lo que se comprueba es lo del diseño
// (docs/superpowers/specs/2026-09-25-rediseno-salidas-design.md): una fila por partido, la columna de la
// hora en cada caso, local o visitante siempre a la vista, «PRÓXIMA SALIDA» y los botones pequeños solo
// donde tocan, más lo de siempre (copiar, pedir bus, filtros guardados...).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abrirPagina as abrir, codigoDe, conCopiar, correosBus, datos, elemento, foco, partido, plantilla, pulsarCopiar,
  reglasCss,
} from './apoyo/pagina-simulada.js';

const PLANTILLA = plantilla('plantilla.html');
const CODIGO = codigoDe(PLANTILLA);
const SAL = { origen: 'Os Remedios', cal: 60 };
const BUS = { para: 'bus@example.com', cc: '', plazas: '55', firma: '', origen: 'Os Remedios', dirOrigen: '', dur: 120 };
// La clave de los filtros en localStorage: "calendario-voley:" + club, la misma que usaba el diseño anterior.
const CLAVE = 'calendario-voley:DOMPAVOLEI';

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

test('plantilla.html: el código de la página sin errores de sintaxis', () => {
  assert.doesNotThrow(() => new Function(CODIGO));
});

test('plantilla.html: tokens de color del diseño en claro y en oscuro, y las fuentes en una petición', () => {
  for (const t of ['--fondo: #ECEFF2', '--sup: #FFFFFF', '--tinta: #121B2E', '--agua: #0A7A70', '--agua-r: #5EC4B9', '--ambar: #955300',
    '--fondo: #131519', '--sup: #1C1F25', '--tinta: #E8EAEE', '--agua: #63D0C3', '--ambar: #F0B65A', '--marino-t: #A9BCE3']) {
    assert.ok(PLANTILLA.includes(t), t);
  }
  assert.match(PLANTILLA, /@media \(prefers-color-scheme: dark\)/);
  assert.equal(PLANTILLA.split('fonts.bunny.net/css?').length - 1, 1);
  assert.ok(PLANTILLA.includes('family=barlow:400,500,600|barlow-condensed:500,600,700'));
  // Sin el amarillo balón del diseño anterior.
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

test('plantilla.html: un color por categoría (como en el diseño anterior), en claro y en oscuro, que se ve sobre las filas', () => {
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

test('página: cada fila lleva a la izquierda la barra del color de su categoría; la próxima salida, además, un fondo aguamarina suave', () => {
  const partidos = [partido({ s: '07:15', vj: 105 }), partido({ f: '2026-09-27', cat: 'Cadete F', ck: 'cadete' })];
  const html = abrirPagina(datos(partidos, { sal: SAL })).contenido.innerHTML;
  assert.match(fila(html, 0).html, /^class="fila prox" data-cat="infantil"/);
  assert.match(fila(html, 1).html, /^class="fila" data-cat="cadete"/);
  const reglas = reglasCss(PLANTILLA).filter((r) => !r.impresion);
  assert.ok(reglas.some((r) => r.selector === '.fila' && /box-shadow: inset 4px 0 0 var\(--c\)/.test(r.cuerpo)), 'barra de categoría');
  assert.ok(reglas.some((r) => r.selector === '.fila.prox' && /background: color-mix\(in srgb, var\(--agua-r\)/.test(r.cuerpo)), 'fondo de la próxima');
});

// --- Un solo diseño ------------------------------------------------------------------------------------------

test('página: sin el selector «Diseño antiguo | Diseño nuevo» (queda un solo diseño); lo primero es la barra con el escudo', () => {
  const cuerpo = PLANTILLA.slice(PLANTILLA.indexOf('<body>') + '<body>'.length);
  assert.match(cuerpo, /^\s*<svg class="iconos" [^>]*>[\s\S]*?<\/svg>\s*<header class="barra">/);
  assert.doesNotMatch(PLANTILLA, /selector-diseno|opciones-diseno|diseno-(antiguo|nuevo)|Diseño (antiguo|nuevo)|salidas\.html/);
});

test('página: cada id que usa el código existe en la plantilla (en el navegador, uno que falte para la página entera)', () => {
  // El DOM simulado se inventa cualquier id que se le pida, así que las demás pruebas no lo cazarían (p. ej.
  // un $('diseno-antiguo').href olvidado al quitar el selector). Valen los del marcado y los que el propio
  // código pinta (id="mes-ant"...).
  const ids = new Set([...PLANTILLA.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const usados = [...new Set([...CODIGO.matchAll(/(?:\$|getElementById)\('([^']+)'\)/g)].map((m) => m[1]))];
  assert.ok(usados.length > 20, usados.join(', '));
  assert.deepEqual(usados.filter((id) => !ids.has(id)), []);
});

// --- Una fila por partido y la columna de la hora ----------------------------------------------------------

test('página: una fila por partido; el 2.º partido del día va en su propia fila', () => {
  const partidos = [
    partido({ s: '07:15', vj: 105, mun: 'MARÍN' }),
    partido({ h: '11:30', l: 'DOMPAVOLEI IF1', v: 'CV OLEIROS IFA', lo: true, vo: false, cond: 'local', ca: '', seg: true, sp: '07:15', mun: 'MARÍN' }),
  ];
  const html = abrirPagina(datos(partidos, { sal: SAL })).contenido.innerHTML;
  const lista = filas(html);
  assert.deepEqual(lista.map((f) => f.i), [0, 1]);
  assert.equal(columnaHora(lista[0]), 'Salida 07:15 partido 10:00');
  assert.equal(columnaHora(lista[1]), '2.º partido 11:30 bus de 07:15');
  assert.deepEqual(equipos(lista[1].html).map((e) => e.nombre), ['DOMPAVOLEI IF1', 'CV OLEIROS IFA']);
});

// Los dos equipos de una fila, en orden (local, visitante): [{ nombre, nuestro, tanteo }].
function equipos(htmlFila) {
  return [...htmlFila.matchAll(/<div class="eq (nuestro|rival)">([\s\S]*?)<\/div>/g)].map((m) => ({
    nombre: texto((/<span class="nom">([\s\S]*?)<\/span>/.exec(m[2]) || [])[1] || ''),
    nuestro: m[1] === 'nuestro',
    tanteo: (/<b class="tanteo">(\d+)<\/b>/.exec(m[2]) || [])[1] || '',
  }));
}

test('página: los dos equipos uno debajo del otro, primero el local; el nuestro en negrita con el punto de su color', () => {
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
  // Entre los dos, una línea «vs» en la misma columna que los nombres (los lectores de pantalla ya dicen «contra»).
  for (let i = 0; i < 3; i++) {
    assert.match(fila(html, i).html, /<\/div><div class="vs" aria-hidden="true"><span class="punto hueco"><\/span>vs<\/div><div class="eq /);
    assert.equal(fila(html, i).html.split('class="vs"').length, 2);
  }
});

test('página: el nombre de cada equipo, con la F o la M solo si hay los dos sexos y con número solo si hay varios de la categoría', () => {
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
  // Sin nombre corto (main.js no lo pone con varios clubs a la vez: no hay un nombre que valga para todos),
  // cada equipo tal como lo publica la federación. Sacar el club del propio nombre no vale: «… CADETE AZUL»
  // saldría «… CADETE CADETE».
  const varios = [
    ['DOMPAVOLEI IF1', 'Infantil F', 'infantil'], ['CV OURENSE IF', 'Infantil F', 'infantil'],
    ['EXCAVACIONES DARIO VOLEY RIVEIRA CADETE AZUL', 'Cadete F', 'cadete'], ['XUVENIL TEIS', 'Junior M', 'junior'],
  ];
  const dv = datos(varios.map(([n, cat, ck], i) => partido({ f: `2026-10-${String(i + 1).padStart(2, '0')}`, v: n, cat, ck })),
    { club: 'DOMPAVOLEI + CV OURENSE + CV RIVEIRA + XUVENIL', corto: '' });
  dv.equipos = varios.map(([n, cat, ck]) => ({ n, cat, ck, ics: '', np: 1 }));
  const hv = abrirPagina(dv).contenido.innerHTML;
  assert.deepEqual(varios.map((_, i) => equipos(fila(hv, i).html).find((e) => e.nuestro).nombre), varios.map(([n]) => n));
  // Con nombre corto, esos nombres raros también salen bien: el del club, la categoría y el número.
  const raros = [['CONGALSA VOLEY RIVEIRA CADETE FEM', 'Cadete F', 'cadete'], ['EXCAVACIONES DARIO VOLEY RIVEIRA CADETE AZUL', 'Cadete F', 'cadete']];
  const dr = datos(raros.map(([n, cat, ck], i) => partido({ f: `2026-10-${String(i + 1).padStart(2, '0')}`, v: n, cat, ck })), { corto: 'Riveira' });
  dr.equipos = raros.map(([n, cat, ck]) => ({ n, cat, ck, ics: '', np: 1 }));
  const hr = abrirPagina(dr).contenido.innerHTML;
  assert.deepEqual(raros.map((_, i) => equipos(fila(hr, i).html).find((e) => e.nuestro).nombre), ['RIVEIRA CADETE 1', 'RIVEIRA CADETE 2']);
});

test('página: debajo de los equipos, adónde se va (icono de ubicación) y la píldora local/visitante', () => {
  const partidos = [
    partido({ s: '07:15', vj: 105, mun: 'MARÍN', pab: 'PABELLÓN COLEGIO SAN NARCISO - PISTA 1' }),
    partido({ f: '2026-09-27', h: '12:00', ca: '11:00', casa: true, cond: 'local', l: 'DOMPAVOLEI IF1', v: 'CV RIVAL', lo: true, vo: false, pab: 'ANEXO OS REMEDIOS - PISTA 1' }),
    partido({ f: '2026-09-28', pab: '', mun: '' }),
  ];
  const html = abrirPagina(datos(partidos, { sal: SAL })).contenido.innerHTML;
  // El icono y el sitio son un enlace al pabellón en Google Maps (el mismo que el del detalle), en otra pestaña:
  // sin tener que abrir el detalle. El texto no cambia; para los lectores, qué pabellón abre.
  const mapa = (pab) => ('https://www.google.com/maps/search/?api=1&amp;query=' + encodeURIComponent(pab)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(fila(html, 0).html, new RegExp('<div class="dest"><a class="ir-mapa" href="' + mapa('PABELLÓN COLEGIO SAN NARCISO - PISTA 1, MARÍN') +
    '" target="_blank" rel="noopener" title="Ver PABELLÓN COLEGIO SAN NARCISO - PISTA 1 en Google Maps"><svg class="hacia" [^>]*aria-hidden="true"><use href="#i-lugar"/></svg>' +
    '<span class="sr-only">En </span><span class="lugar">MARÍN</span><span class="sr-only"> \\(ver PABELLÓN COLEGIO SAN NARCISO - PISTA 1 en Google Maps\\)</span></a>' +
    '<span class="cond visitante">Visitante</span></div>'));
  const enlaceDetalle = /<p class="dl"><svg[^>]*><use href="#i-lugar"\/><\/svg><span><a href="([^"]+)"/.exec(fila(html, 0).html)[1];
  assert.equal(/<a class="ir-mapa" href="([^"]+)"/.exec(fila(html, 0).html)[1], enlaceDetalle);
  // En casa: el nombre corto del pabellón, también con su mapa (sin municipio: «, Galicia»).
  assert.match(fila(html, 1).html, new RegExp('<a class="ir-mapa" href="' + mapa('ANEXO OS REMEDIOS - PISTA 1, Galicia') + '"[^>]*>[\\s\\S]*?<span class="lugar">ANEXO OS REMEDIOS</span>'));
  // Sin pabellón no hay adónde llevar: texto, como antes.
  assert.match(fila(html, 2).html, /<div class="dest"><svg class="hacia" [^>]*aria-hidden="true"><use href="#i-lugar"\/><\/svg><span class="sr-only">En <\/span><span class="lugar">Pabellón por confirmar<\/span><span class="cond visitante">Visitante<\/span><\/div>/);
  assert.ok(!fila(html, 2).html.includes('ir-mapa'));
  assert.match(PLANTILLA, /<symbol id="i-lugar"/);
});

test('página: el enlace al mapa de la fila se ve como enlace, es fácil de pulsar y no abre ni cierra el detalle', () => {
  const reglas = reglasCss(PLANTILLA).filter((r) => !r.impresion);
  const regla = (sel) => reglas.find((r) => r.selector === sel)?.cuerpo ?? '';
  assert.match(regla('.ir-mapa'), /min-height: 32px/);
  assert.match(regla('.ir-mapa .lugar'), /text-decoration: underline/);
  // Pulsarlo no toca el detalle (solo la flecha lo abre) ni se cancela: el navegador abre el mapa.
  const pagina = abrirPagina(datos([partido({ mun: 'MARÍN' })]));
  const panel = pagina.porId('det-0');
  panel.hidden = true;
  const enlace = elemento(pagina.doc, 'a');
  enlace.classList.add('ir-mapa');
  let cancelado = false;
  pagina.contenido.oyentes.click({ target: enlace, preventDefault() { cancelado = true; } });
  assert.equal(panel.hidden, true);
  assert.equal(cancelado, false);
});

test('página: la columna de la hora en cada caso de la tabla del diseño', () => {
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

test('página: sin horas de salida configuradas, «PARTIDO» y la hora del partido, sin avisos', () => {
  const html = abrirPagina(datos([partido(), partido({ h: '12:00', e: 'p' })])).contenido.innerHTML;
  assert.equal(columnaHora(fila(html, 0)), 'Partido 10:00');
  assert.equal(columnaHora(fila(html, 1)), 'Partido 12:00 provisional');
  assert.ok(!html.includes('salida sin calcular'));
});

// --- Columna derecha -----------------------------------------------------------------------------------

test('página: local o visitante siempre a la vista, también en lo ya jugado y sin hora', () => {
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

test('página: destino (municipio, o el pabellón en casa) y píldora local / visitante / derbi', () => {
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
  // Sin el «(ver … en Google Maps)» del enlace al mapa, que se prueba aparte.
  const destino = (i) => texto(/<div class="dest">([\s\S]*?)<\/div>/.exec(fila(html, i).html)[1]).replace(/ \(ver .* en Google Maps\)/, '');
  // «En» es el texto para lectores de pantalla que acompaña al icono de ubicación.
  assert.equal(destino(0), 'En MARÍN Visitante');
  assert.equal(destino(1), 'En ANEXO OS REMEDIOS Local');
  assert.equal(destino(2), 'En POLIDEPORTIVO TORRES COLOMER Visitante');
  assert.equal(destino(3), 'En Pabellón por confirmar Visitante');
  assert.equal(destino(4), 'En LUGO Derbi');
});

test('página: «PRÓXIMA SALIDA» solo en la primera salida en bus por jugar de las que se ven', () => {
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

test('página: sin horas de salida, «PRÓXIMO PARTIDO» en el primero por jugar (como el «Próximo» de siempre)', () => {
  const html = abrirPagina(datos([partido(), partido({ f: '2026-09-27' })])).contenido.innerHTML;
  assert.match(fila(html, 0).html, /<span class="proxm">Próximo partido<\/span>/);
  assert.ok(!fila(html, 1).html.includes('proxm'));
  assert.ok(!html.includes('Próxima salida'));
});

test('página: «Ganado»/«Perdido» desde el lado del club, pero los sets en el orden del marcador (el local primero)', () => {
  const partidos = [
    partido({ f: '2026-09-19', s: '07:30', r: { m: [0, 3], s: [[24, 26], [23, 25], [20, 25]] } }),
    partido({ f: '2026-09-20', l: 'DOMPAVOLEI IF1', v: 'CV RIVAL', lo: true, vo: false, cond: 'local', r: { m: [2, 3], s: [[25, 20], [20, 25], [25, 18], [22, 25], [10, 15]] } }),
  ];
  const html = abrirPagina(datos(partidos, { sal: SAL }), { almacen: conFiltros({ per: 'todo' }) }).contenido.innerHTML;
  // Como un marcador: los sets de cada equipo en su línea (local arriba) y, debajo, ganado o perdido con los sets.
  // Los puntos de cada set, también como en el marcador: primero los del local, aunque el nuestro sea el visitante.
  assert.deepEqual(equipos(fila(html, 0).html).map((e) => [e.nombre, e.tanteo]), [['CV RIVAL', '0'], ['DOMPAVOLEI IF1', '3']]);
  assert.deepEqual(equipos(fila(html, 1).html).map((e) => [e.nombre, e.tanteo]), [['DOMPAVOLEI IF1', '2'], ['CV RIVAL', '3']]);
  assert.match(fila(html, 0).html, /<div class="res gana">Ganado<small>24-26 · 23-25 · 20-25<\/small><\/div>/);
  assert.match(fila(html, 1).html, /<div class="res pierde">Perdido<small>25-20 · 20-25 · 25-18 · 22-25 · 10-15<\/small><\/div>/);
});

// --- Botones -------------------------------------------------------------------------------------------

test('página: WhatsApp, Copiar y Pedir bus solo donde tocan, en una línea bajo la fila', () => {
  const r = { m: [1, 3], s: [[20, 25], [25, 20], [18, 25], [22, 25]] };
  const partidos = [
    /* 0 */ partido({ f: '2026-09-25', h: '', e: 'h', r, wa: 'Mensaje de hoy' }),            // con resultado: no
    /* 1 */ partido({ s: '07:15', vj: 105, wa: 'Mensaje de mañana' }),                        // los tres
    /* 2 */ partido({ h: '11:30', ca: '', seg: true, sp: '07:15' }),                          // 2.º partido: ninguno
    /* 3 */ partido({ f: '2026-09-27', casa: true, v: 'DOMPAVOLEI CF1', wa: 'En casa' }),    // WhatsApp y Copiar, sin bus
    /* 4 */ partido({ f: '2026-09-19', s: '07:30', wa: 'Pasado' }),                           // ya jugado: ninguno
    /* 5 */ partido({ f: '2026-09-25', h: '', e: 'h', v: 'DOMPAVOLEI XF1', wa: 'Hoy, sin resultado' }), // hoy sin hora: por jugar
  ];
  const d = datos(partidos, { sal: SAL, bus: BUS });
  d.equipos.push({ n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 });
  d.equipos.push({ n: 'DOMPAVOLEI XF1', cat: 'Juvenil F', ck: 'juvenil', ics: '', np: 1 });
  const html = abrirPagina(d, { almacen: conFiltros({ per: 'todo' }) }).contenido.innerHTML;
  assert.deepEqual(conCopiar(html), [1, 3, 5]);
  const botones = (i) => {
    const acc = /<div class="acc">([\s\S]*?)<\/div>/.exec(fila(html, i).html);
    return acc ? [...acc[1].matchAll(/class="(boton-[^"]*)"/g)].map((m) => m[1]) : [];
  };
  assert.deepEqual(botones(1), ['boton-wa wa', 'boton-wa copiar', 'boton-bus']);
  assert.deepEqual(botones(3), ['boton-wa wa', 'boton-wa copiar']);
  assert.deepEqual(botones(5), ['boton-wa wa', 'boton-wa copiar']);   // sin hora pero sin resultado: aún por jugar
  assert.equal([...html.matchAll(/href="https:\/\/api\.whatsapp\.com\/send\?text=/g)].length, 3);
  for (const i of [0, 2, 4]) assert.deepEqual(botones(i), [], `partido ${i}`);
  // Sin configuración de bus, no hay «Pedir bus».
  const sinBus = abrirPagina(datos([partido({ s: '07:15', wa: 'x' })], { sal: SAL })).contenido.innerHTML;
  assert.ok(!sinBus.includes('boton-bus'));
  // Sin emojis en la página: iconos SVG.
  assert.ok(!/📋|✉|🚌/u.test(html));
  assert.match(html, /<svg[^>]*><use href="#i-msg"\/><\/svg>WhatsApp/);
});

test('página: el enlace «WhatsApp» va directo a api.whatsapp.com con el mensaje entero', () => {
  const mensaje = '🏐 *DOMPAVOLEI IF1* (Infantil F)\n📅 *Sábado 26 de septiembre*\n⏰ 🏟️ A & B #1 +2';
  const html = abrirPagina(datos([partido({ wa: mensaje })])).contenido.innerHTML;
  const enlaces = [...html.matchAll(/class="boton-wa wa" href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.equal(enlaces.length, 1);
  const prefijo = 'https://api.whatsapp.com/send?text=';
  assert.ok(enlaces[0].startsWith(prefijo), enlaces[0]);
  assert.equal(decodeURIComponent(enlaces[0].slice(prefijo.length)), mensaje);
  assert.ok(!html.includes('wa.me'));
});

test('página: «Copiar» sin navigator.clipboard copia con el método antiguo y el foco vuelve al botón', () => {
  const pagina = abrirPagina(datos([partido({ wa: 'Mensaje para las familias' })]));
  const boton = pulsarCopiar(pagina, 0, 'Copiar');
  assert.equal(pagina.copiado, 'Mensaje para las familias');
  assert.equal(boton.textContent, '✓ Copiado');
  assert.equal(pagina.estado.textContent, 'Mensaje copiado');
  assert.equal(foco(pagina), 'el botón');
});

test('página: «Copiar» cuando navigator.clipboard falla: método antiguo y el foco vuelve al botón', async () => {
  const portapapeles = { writeText() { return Promise.reject(new Error('sin permiso')); } };
  const pagina = abrirPagina(datos([partido({ wa: 'Mensaje para las familias' })]), { portapapeles, seguro: true });
  const boton = pulsarCopiar(pagina, 0, 'Copiar');
  await new Promise((fin) => { setImmediate(fin); });
  assert.equal(pagina.copiado, 'Mensaje para las familias');
  assert.equal(boton.textContent, '✓ Copiado');
  assert.equal(foco(pagina), 'el botón');
});

test('página: «Pedir bus»: el correo agrupa el viaje (vuelta tras el último partido, también en un derbi o con otras mayúsculas)', () => {
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
  assert.ok(mayusculas.includes('- Regreso: al terminar el último partido, hacia las 14:00; llegada aproximada a Os Remedios a las 15:45'),
    mayusculas.join('\n'));
});

test('página: abierta desde el ordenador (file://), con o sin la dirección publicada del .ics', () => {
  const d = (pub) => {
    const x = datos([partido(), partido({ f: '2026-09-27' })], { pub });
    x.equipos[0].ics = 'equipos/dompavolei-if1.ics';
    return x;
  };
  // Sin publicar: pinta la lista, el .ics de cada equipo como archivo y el aviso de volver a generar.
  let pagina = abrirPagina(d(null), { protocolo: 'file:' });
  assert.equal(filas(pagina.contenido.innerHTML).length, 2);
  assert.match(pagina.porId('lista-ics').innerHTML, /<a href="equipos\/dompavolei-if1\.ics">archivo \.ics<\/a>/);
  assert.match(pagina.porId('pie').textContent, /vuelve a generar el calendario antes de cada fin de semana/);
  // Con la dirección publicada (config.json › calendario_publicado): suscripción a la de internet.
  pagina = abrirPagina(d({ base: 'https://example.github.io/cal/', ics: 'calendario.ics' }), { protocolo: 'file:' });
  assert.equal(filas(pagina.contenido.innerHTML).length, 2);
  assert.equal(pagina.porId('enlace-suscribir').href, 'webcal://example.github.io/cal/calendario.ics');
  assert.match(pagina.porId('enlace-google').href, /^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2Fexample\.github\.io%2Fcal%2Fcalendario\.ics$/);
  assert.match(pagina.porId('lista-ics').innerHTML, /href="webcal:\/\/example\.github\.io\/cal\/equipos\/dompavolei-if1\.ics"/);
  assert.match(pagina.porId('pie').textContent, /vuelve a generar el calendario/);
});

// --- Detalle desplegable -------------------------------------------------------------------------------

test('página: la flecha de cada fila abre y cierra su detalle (pabellón, mapa, competición y viaje)', () => {
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

test('página: cabecera de cada día con su nota (hoy, mañana, fecha por confirmar, jugados)', () => {
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

test('página: pestañas ocultas sin clasificaciones y a la vista con ellas', () => {
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

test('página: escudo en la barra si hay, y el título de la sección con el origen de las salidas', () => {
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

test('página: chips con el código corto de cada equipo con partidos, y «Todos»', () => {
  const d = datos([partido(), partido({ v: 'DOMPAVOLEI CF1', f: '2026-09-27' })]);
  d.equipos = [
    { n: 'DOMPAVOLEI IF1', cat: 'Infantil F', ck: 'infantil', ics: '', np: 1 },
    { n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 },
    { n: 'DOMPAVOLEI SM1', cat: 'Senior M', ck: 'senior', ics: '', np: 0 },
  ];
  const chips = abrirPagina(d).porId('chips').innerHTML;
  assert.deepEqual([...chips.matchAll(/data-eq="([^"]*)"/g)].map((m) => m[1]), ['', 'DOMPAVOLEI IF1', 'DOMPAVOLEI CF1']);
  assert.deepEqual(texto(chips).split(' ').filter((x) => /^(Todos|IF1|CF1)$/.test(x)), ['Todos', 'IF1', 'CF1']);
  // Como en el diseño anterior: el punto del color de la categoría, el código y la categoría.
  assert.match(chips, /<button type="button" class="chip" data-cat="infantil" data-eq="DOMPAVOLEI IF1"[^>]*><span class="punto" aria-hidden="true"><\/span>IF1 <span class="cat-chip">Infantil F<\/span><\/button>/);
  assert.match(chips, /data-cat="cadete" data-eq="DOMPAVOLEI CF1"[^>]*><span class="punto" aria-hidden="true"><\/span>CF1 <span class="cat-chip">Cadete F<\/span>/);
});

test('página: los chips que no caben se desplazan dentro de su fila, sin mover la página de lado a 375 px', () => {
  // La fila de chips se desplaza en horizontal dentro de sí misma y está posicionada, para que nada de
  // dentro (p. ej. un .sr-only, que es absolute) se coloque respecto a la fila fija y alargue la página.
  const fila = reglasCss(PLANTILLA).filter((r) => !r.impresion && r.selector === '.chips');
  assert.ok(fila.some((r) => /overflow-x: auto/.test(r.cuerpo)), 'la fila de chips no se desplaza');
  assert.ok(fila.some((r) => /position: relative/.test(r.cuerpo)), 'la fila de chips no está posicionada');
});

test('página: la fila fija (chips y «Filtros») no tapa lo que tiene el foco: scroll-padding-top con su alto', () => {
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

test('página: los filtros se guardan con la clave del diseño anterior (nadie pierde sus equipos) y «Filtros» cuenta los cambiados', () => {
  const partidos = [partido()];
  // Lo que guardó el diseño anterior (mismo formato) se usa tal cual: equipos, lado, periodo, vista y pestaña.
  const dos = datos([partido(), partido({ f: '2026-09-27', v: 'DOMPAVOLEI CF1' })]);
  dos.equipos.push({ n: 'DOMPAVOLEI CF1', cat: 'Cadete F', ck: 'cadete', ics: '', np: 1 });
  let pagina = abrirPagina(dos, {
    almacen: new Map([['calendario-voley:DOMPAVOLEI', JSON.stringify({ eq: ['DOMPAVOLEI CF1'], cond: 'todos', per: 'proximos', vista: 'lista', seccion: 'calendario' })]]),
  });
  assert.deepEqual(filas(pagina.contenido.innerHTML).map((f) => f.i), [1]);
  assert.equal(pagina.porId('btn-filtros').textContent, 'Filtros');
  // La de las pruebas del diseño nuevo (salidas.html, unas horas en septiembre de 2026) ya no cuenta.
  pagina = abrirPagina(datos(partidos), { almacen: new Map([['salidas-voley:DOMPAVOLEI', JSON.stringify({ vista: 'mes' })]]) });
  assert.ok(!pagina.contenido.innerHTML.includes('rejilla'));
  pagina = abrirPagina(datos(partidos), { almacen: conFiltros({ vista: 'mes', per: 'todo', cond: 'visitante' }) });
  assert.match(pagina.contenido.innerHTML, /class="rejilla"/);
  assert.equal(pagina.porId('btn-filtros').textContent, 'Filtros · 1');   // en el Mes no hay periodo
  pagina = abrirPagina(datos(partidos), { almacen: conFiltros({ per: 'todo', cond: 'visitante' }) });
  assert.equal(pagina.porId('btn-filtros').textContent, 'Filtros · 2');
  // Al pulsar un filtro se guarda en esa clave, y en ninguna otra.
  const almacen = new Map();
  pagina = abrirPagina(datos(partidos), { almacen });
  const boton = elemento(pagina.doc, 'button');
  boton.dataset.cond = 'local';
  pagina.porId('panel-filtros').oyentes.click({ target: boton });
  assert.equal(JSON.parse(almacen.get(CLAVE)).cond, 'local');
  assert.deepEqual([...almacen.keys()], [CLAVE]);
});

test('página: #estado anuncia el recuento y los filtros', () => {
  const pagina = abrirPagina(datos([partido(), partido({ f: '2026-09-27' }), partido({ f: '2026-09-19' })]));
  assert.equal(pagina.estado.textContent, '2 partidos · Todos los equipos · próximos partidos');
  assert.equal(pagina.porId('filtro-imp').textContent, 'Todos los equipos · próximos partidos · actualizado el 25/09/2026 12:00');
});

test('página: vacíos con los mensajes de siempre y el botón para quitar filtros', () => {
  let html = abrirPagina(datos([])).contenido.innerHTML;
  assert.match(html, /Todavía no hay partidos publicados para esta temporada/);
  html = abrirPagina(datos([partido({ f: '2026-09-19' })])).contenido.innerHTML;
  assert.match(html, /No quedan partidos por jugar esta temporada\.[\s\S]*id="quitar"[^>]*>Ver toda la temporada</);
  html = abrirPagina(datos([partido()]), { almacen: conFiltros({ cond: 'local' }) }).contenido.innerHTML;
  assert.match(html, /No hay partidos con estos filtros\.[\s\S]*id="quitar"[^>]*>Ver todos los partidos</);
});

test('página: vista Mes con los códigos de los equipos (máx. 2 y «+N») y la hora de salida', () => {
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

// --- App instalable --------------------------------------------------------------------------------------

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36';
const TACTIL = ['(pointer: coarse)'];
const CLAVE_INSTALAR = CLAVE + ':instalar';

// El beforeinstallprompt de Chrome: apunta los prompt() y contesta userChoice con el resultado.
function eventoInstalar(resultado = 'accepted') {
  const ev = { prompts: 0, prompt() { ev.prompts++; return Promise.resolve(); } };
  ev.userChoice = Promise.resolve({ outcome: resultado });
  return ev;
}
const conApp = (campos = {}) => datos([partido()], { app: true, escudo: 'data:image/png;base64,AAAA', ...campos });
// (El botón «Instalar» trae la clase oculto en el marcado, que el DOM simulado no lee: solo cuenta con el aviso a la vista.)
const aviso = (p) => ({
  visto: !p.porId('instalar').hidden,
  pasos: texto(p.porId('inst-pasos').innerHTML),
  boton: !p.porId('instalar').hidden && !p.porId('inst-si').classList.contains('oculto'),
  panel: !p.porId('instalar-app').classList.contains('oculto'),
});
const esperar = () => new Promise((listo) => setImmediate(listo));

test('app: en Android (Chrome), aviso con «Instalar»; al pulsarlo, el diálogo del navegador, una sola vez', async () => {
  const ev = eventoInstalar('accepted');
  const almacen = new Map();
  const p = abrirPagina(conApp(), { ua: ANDROID, consultas: TACTIL, eventoInstalar: ev, almacen });
  assert.deepEqual(aviso(p), { visto: true, pasos: 'Se abre como una app, sin tener que buscar la web.', boton: true, panel: true });
  assert.match(p.porId('inst-icono').innerHTML, /<img src="data:image\/png;base64,AAAA" alt=""/);
  p.porId('inst-si').oyentes.click({});
  assert.equal(ev.prompts, 1);
  assert.equal(p.porId('instalar').hidden, true);
  await esperar();
  assert.equal(almacen.get(CLAVE_INSTALAR), 'instalada');
  p.porId('inst-si').oyentes.click({});   // el evento ya se usó: no se vuelve a pedir
  assert.equal(ev.prompts, 1);
  // Si dice que no, el aviso descansa 45 días.
  const no = eventoInstalar('dismissed');
  const almacen2 = new Map();
  const p2 = abrirPagina(conApp(), { ua: ANDROID, consultas: TACTIL, eventoInstalar: no, almacen: almacen2 });
  p2.porId('inst-si').oyentes.click({});
  await esperar();
  assert.ok(+almacen2.get(CLAVE_INSTALAR) > 0);
  assert.equal(p2.porId('instalar').hidden, true);
});

test('app: en el iPhone y en Samsung Internet, los pasos (no hay botón que instale)', () => {
  let p = abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5 });
  assert.deepEqual(aviso(p), {
    visto: true, boton: false, panel: true,
    pasos: 'Toca Compartir (en iOS 26, primero «…»), elige «Añadir a pantalla de inicio» y luego «Añadir».',
  });
  assert.match(p.porId('inst-pasos').innerHTML, /Compartir <svg [^>]*aria-hidden="true"/);
  p = abrirPagina(conApp(), { ua: IPHONE_CHROME, consultas: TACTIL, toques: 5 });
  assert.equal(aviso(p).pasos, 'Toca Compartir junto a la barra de direcciones, elige «Añadir a pantalla de inicio» y luego «Añadir».');
  // El iPad dice que es un Mac: se le reconoce por la pantalla táctil.
  p = abrirPagina(conApp(), { ua: IPAD, consultas: TACTIL, toques: 5 });
  assert.match(aviso(p).pasos, /^Toca Compartir \(en iOS 26/);
  p = abrirPagina(conApp(), { ua: IPAD, toques: 0 });   // un Mac de verdad: nada
  assert.deepEqual(aviso(p), { visto: false, pasos: '', boton: false, panel: false });
  p = abrirPagina(conApp(), { ua: SAMSUNG, consultas: TACTIL });
  assert.match(aviso(p).pasos, /icono de instalar de la barra de direcciones/);
  assert.equal(aviso(p).boton, false);
});

test('app: nada de avisos dentro de la app instalada, sin app, abierta desde el ordenador o sin forma de instalar', () => {
  const nada = { visto: false, pasos: '', boton: false, panel: false };
  for (const consulta of ['(display-mode: standalone)', '(display-mode: fullscreen)', '(display-mode: minimal-ui)']) {
    assert.deepEqual(aviso(abrirPagina(conApp(), { ua: ANDROID, consultas: [...TACTIL, consulta], eventoInstalar: eventoInstalar() })), nada, consulta);
  }
  assert.deepEqual(aviso(abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5, standalone: true })), nada);
  assert.deepEqual(aviso(abrirPagina(datos([partido()]), { ua: IPHONE, consultas: TACTIL, toques: 5 })), nada);   // sin app
  assert.deepEqual(aviso(abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5, protocolo: 'file:' })), nada);
  // Chrome en Android sin beforeinstallprompt (aún no deja, o ya está instalada), Firefox...: sin insistir.
  assert.deepEqual(aviso(abrirPagina(conApp(), { ua: ANDROID, consultas: TACTIL })), nada);
  // CSS: dentro de la app, el aviso y el botón del panel no se ven aunque el código fallara.
  assert.match(PLANTILLA, /@media \(display-mode: standalone\), \(display-mode: fullscreen\), \(display-mode: minimal-ui\) \{\s*\.instalar, #instalar-app \{ display: none !important; \}/);
});

test('app: en el ordenador, sin aviso; el botón «Instalar como app» del panel sí (si el navegador deja)', () => {
  const ev = eventoInstalar();
  const p = abrirPagina(conApp(), { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0', eventoInstalar: ev });
  assert.deepEqual(aviso(p), { visto: false, pasos: '', boton: false, panel: true });
  p.porId('instalar-app').oyentes.click({});
  assert.equal(ev.prompts, 1);
});

test('app: la × cierra el aviso 45 días; el botón del panel lo vuelve a enseñar; instalada, no vuelve', () => {
  const almacen = new Map();
  let p = abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5, almacen });
  p.porId('inst-cerrar').oyentes.click({});
  assert.equal(p.porId('instalar').hidden, true);
  const cerrado = +almacen.get(CLAVE_INSTALAR);
  assert.ok(Math.abs(cerrado - Date.now()) < 60000);
  p = abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5, almacen });
  assert.equal(aviso(p).visto, false);
  p.porId('instalar-app').oyentes.click({});   // pedido desde el panel: sí
  assert.equal(aviso(p).visto, true);
  almacen.set(CLAVE_INSTALAR, String(Date.now() - 46 * 864e5));
  assert.equal(aviso(abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5, almacen })).visto, true);
  almacen.set(CLAVE_INSTALAR, 'instalada');
  assert.equal(aviso(abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5, almacen })).visto, false);
});

test('app: si Chrome deja instalar más tarde, aparece el aviso; al instalarse (por donde sea), se va', () => {
  const almacen = new Map();
  const p = abrirPagina(conApp(), { ua: ANDROID, consultas: TACTIL, almacen });
  assert.equal(aviso(p).visto, false);
  p.ventana.eventoInstalar = eventoInstalar();   // lo recoge la cabecera
  p.ventana.oyentes.beforeinstallprompt({});
  assert.equal(aviso(p).visto, true);
  p.ventana.oyentes.appinstalled({});
  assert.deepEqual(aviso(p), { visto: false, pasos: 'Se abre como una app, sin tener que buscar la web.', boton: false, panel: false });
  assert.equal(almacen.get(CLAVE_INSTALAR), 'instalada');
});

const conRed = () => Promise.resolve({ ok: true });
const HEAD = { method: 'HEAD', cache: 'no-store' };

test('app: el service worker se registra al cargar (solo publicada, con app y si el navegador los tiene) y guarda las fuentes', async () => {
  const fuentes = ['https://fonts.bunny.net/css?family=barlow:400', 'https://fonts.bunny.net/barlow/files/barlow-latin-400-normal.woff2'];
  let p = abrirPagina(conApp(), { serviceWorker: true, recursos: [...fuentes, 'https://example.org/calendario/iconos/192.png'] });
  assert.deepEqual(p.registros, []);   // hasta el «load»
  p.ventana.oyentes.load({});
  assert.deepEqual(p.registros, [{ url: './sw.js', opciones: { scope: './', updateViaCache: 'none' } }]);
  // Las fuentes de esta primera visita (antes de haber service worker), para que las guarde.
  await esperar();
  assert.deepEqual(p.mensajesSw, [{ type: 'guardar-fuentes', urls: fuentes }]);
  for (const [d, op] of [[datos([partido()]), {}], [conApp(), { protocolo: 'file:' }]]) {
    p = abrirPagina(d, { serviceWorker: true, ...op });
    p.ventana.oyentes.load?.({});
    assert.deepEqual(p.registros, []);
  }
  p = abrirPagina(conApp());   // sin service workers: nada (y sin errores)
  assert.equal(p.ventana.oyentes.load, undefined);
});

test('app: la copia sin conexión avisa, con «Reintentar», y vuelve a la de la red en cuanto la web contesta', async () => {
  let p = abrirPagina(conApp(), { serviceWorker: true, copia: true, red: conRed });
  const avisoCopia = p.porId('aviso-copia');
  assert.equal(avisoCopia.hidden, false);
  assert.equal(p.porId('aviso-copia-texto').textContent, 'Sin conexión: esta es la copia guardada, con los datos del 25/09/2026 12:00.');
  p.porId('reintentar').oyentes.click({});
  assert.equal(p.recargas, 1);
  // Cada 30 s se pregunta a la web (HEAD, sin caché): si contesta, a la de la red.
  assert.equal(p.intervalos.size, 1);
  [...p.intervalos.values()][0]();
  await esperar();
  assert.deepEqual(p.peticiones, [{ url: 'https://example.org/calendario/', opciones: HEAD, corte: true }]);
  assert.equal(p.recargas, 2);
  // Al volver la red o a la app, igual.
  p.ventana.oyentes.online({});
  await esperar();
  p.doc.oyentes.visibilitychange({});
  await esperar();
  assert.equal(p.recargas, 4);
  // El service worker trajo una nueva: se recarga; trajo la misma: fuera el aviso y los reintentos.
  const sw = p.ventana.navigator.serviceWorker;
  sw.onmessage({ data: { type: 'sw-fresh', changed: true } });
  assert.equal(p.recargas, 5);
  sw.onmessage({ data: { type: 'sw-fresh', changed: false } });
  assert.equal(avisoCopia.hidden, true);
  assert.equal(p.intervalos.size, 0);
  // Sin red (o la web no contesta), nunca se cambia la copia por un error.
  p = abrirPagina(conApp(), { serviceWorker: true, copia: true });
  [...p.intervalos.values()][0]();
  p.ventana.oyentes.online({});
  p.doc.oyentes.visibilitychange({});
  await esperar();
  assert.equal(p.recargas, 0);
  p = abrirPagina(conApp(), { serviceWorker: true, copia: true, red: conRed, enLinea: false });
  [...p.intervalos.values()][0]();
  await esperar();
  assert.deepEqual(p.peticiones, []);
  // La página de la red: ni aviso, ni reintentos, ni recargas por eso.
  p = abrirPagina(conApp(), { serviceWorker: true, red: conRed });
  assert.notEqual(p.porId('aviso-copia').hidden, false);
  assert.equal(p.intervalos.size, 0);
  p.ventana.navigator.serviceWorker.onmessage({ data: { type: 'sw-fresh', changed: true } });
  p.ventana.oyentes.online?.({});
  await esperar();
  assert.equal(p.recargas, 0);
});

test('app: al volver a la página tras más de 30 minutos, se recarga si la web contesta (nunca por un error)', async () => {
  const prueba = async ({ minutos, visible = true, red = conRed, enLinea = true }) => {
    const p = abrirPagina(conApp(), { red, enLinea });
    const ahora = Date.now();
    p.ventana.Date.now = () => ahora + minutos * 60000;
    p.doc.visibilityState = visible ? 'visible' : 'hidden';
    p.doc.oyentes.visibilitychange({});
    await esperar();
    return { recargas: p.recargas, peticiones: p.peticiones.map((x) => x.opciones) };
  };
  assert.deepEqual(await prueba({ minutos: 10 }), { recargas: 0, peticiones: [] });
  assert.deepEqual(await prueba({ minutos: 31, visible: false }), { recargas: 0, peticiones: [] });
  assert.deepEqual(await prueba({ minutos: 31 }), { recargas: 1, peticiones: [HEAD] });
  assert.deepEqual(await prueba({ minutos: 31, red: () => Promise.reject(new TypeError('sin red')) }), { recargas: 0, peticiones: [HEAD] });
  assert.deepEqual(await prueba({ minutos: 31, red: () => Promise.resolve({ ok: false }) }), { recargas: 0, peticiones: [HEAD] });
  assert.deepEqual(await prueba({ minutos: 31, enLinea: false }), { recargas: 0, peticiones: [] });
  // Abierta desde el ordenador, no (no hay nada nuevo que traer).
  assert.equal(abrirPagina(conApp(), { protocolo: 'file:' }).doc.oyentes.visibilitychange, undefined);
});

test('app: la hoja de instalar va fija abajo (no mueve la página) y reserva su alto mientras se ve', () => {
  const regla = (sel) => reglasCss(PLANTILLA).find((r) => !r.impresion && r.selector === sel)?.cuerpo ?? '';
  assert.match(regla('.instalar'), /position: fixed; left: 0; right: 0; bottom: 0;/);
  assert.match(regla('.instalar'), /padding-bottom: env\(safe-area-inset-bottom\)/);
  const p = abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5, alturas: { instalar: 150 } });
  assert.equal(aviso(p).visto, true);
  assert.equal(p.doc.body.style.paddingBottom, '150px');
  assert.equal(p.doc.documentElement.style.scrollPaddingBottom, '158px');
  p.porId('inst-cerrar').oyentes.click({});
  assert.equal(p.doc.body.style.paddingBottom, '');
  assert.equal(p.doc.documentElement.style.scrollPaddingBottom, '');
  // Pedida desde el panel (tras cerrarla): vuelve, con el foco en su título para que se lea.
  p.porId('instalar-app').oyentes.click({});
  assert.equal(aviso(p).visto, true);
  assert.equal(p.doc.activeElement, p.porId('inst-titulo'));
  assert.equal(p.doc.body.style.paddingBottom, '150px');
  assert.match(PLANTILLA, /<p class="inst-titulo" id="inst-titulo" tabindex="-1">/);
});

test('app: la cabecera recoge el beforeinstallprompt antes que nada; el color de la barra del sistema; fuentes con CORS', () => {
  const cabecera = PLANTILLA.slice(0, PLANTILLA.indexOf('</head>'));
  assert.match(cabecera, /<script>[\s\S]*window\.addEventListener\('beforeinstallprompt', function \(e\) \{ e\.preventDefault\(\); window\.eventoInstalar = e; \}\);\s*<\/script>/);
  assert.match(cabecera, /<meta name="theme-color" content="#FFFFFF" media="\(prefers-color-scheme: light\)">\n<meta name="theme-color" content="#1C1F25" media="\(prefers-color-scheme: dark\)">/);
  // Los mismos colores que la barra de la página (--sup), en claro y en oscuro.
  assert.match(PLANTILLA, /--sup: #FFFFFF;/);
  assert.match(PLANTILLA, /--sup: #1C1F25;/);
  // La hoja de las fuentes con crossorigin: así el service worker la puede guardar para sin conexión.
  assert.match(cabecera, /<link rel="stylesheet" href="https:\/\/fonts\.bunny\.net\/css\?[^"]+" crossorigin>/);
  // Al imprimir, ni el aviso de instalar ni el de la copia.
  assert.ok(reglasCss(PLANTILLA).some((r) => r.impresion && /\.instalar, \.aviso-copia/.test(r.selector) && /display: none/.test(r.cuerpo)));
});

test('app: con la red muy lenta, las comprobaciones no se amontonan ni recargan cuando ya no hace falta', async () => {
  let contestar;
  const p = abrirPagina(conApp(), { serviceWorker: true, copia: true, red: () => new Promise((si) => { contestar = si; }) });
  const tic = [...p.intervalos.values()][0];
  tic(); tic(); p.ventana.oyentes.online({}); p.doc.oyentes.visibilitychange({});
  assert.equal(p.peticiones.length, 1);   // una sola a la vez
  // Mientras tanto, el service worker ya trajo la misma página: fuera el aviso. La comprobación que llega
  // después no recarga.
  p.ventana.navigator.serviceWorker.onmessage({ data: { type: 'sw-fresh', changed: false } });
  contestar({ ok: true });
  await esperar();
  assert.equal(p.recargas, 0);
});

test('app: al volver tras 30 minutos, si se toca la página antes de que la web conteste, no se recarga', async () => {
  let contestar;
  const p = abrirPagina(conApp(), { red: () => new Promise((si) => { contestar = si; }) });
  const ahora = Date.now();
  p.ventana.Date.now = () => ahora + 31 * 60000;
  p.doc.oyentes.visibilitychange({});
  assert.deepEqual(p.peticiones.map((x) => x.corte), [true]);
  p.ventana.Date.now = () => ahora + 31 * 60000 + 500;
  p.doc.oyentes.pointerdown({});   // abre un panel, despliega un partido...
  contestar({ ok: true });
  await esperar();
  assert.equal(p.recargas, 0);
});

test('app: si Chrome avisa tarde (a los ~30 s), la hoja no aparece de golpe: solo el botón del panel', () => {
  const p = abrirPagina(conApp(), { ua: ANDROID, consultas: TACTIL });
  const ahora = Date.now();
  p.ventana.Date.now = () => ahora + 30000;
  p.ventana.eventoInstalar = eventoInstalar();
  p.ventana.oyentes.beforeinstallprompt({});
  assert.deepEqual(aviso(p), { visto: false, pasos: '', boton: false, panel: true });
  // Pedida desde el panel, sí (y ahí el botón «Instalar» abre el diálogo de Chrome).
  p.porId('instalar-app').oyentes.click({});
  assert.equal(p.ventana.eventoInstalar, null);
});

test('app: al cerrar la hoja abierta desde el panel, el foco vuelve al botón del panel; la hoja va tras el panel en el DOM', () => {
  const almacen = new Map([[CLAVE_INSTALAR, String(Date.now())]]);   // cerrada hace poco
  const p = abrirPagina(conApp(), { ua: IPHONE, consultas: TACTIL, toques: 5, almacen });
  p.porId('instalar-app').oyentes.click({});
  assert.equal(p.doc.activeElement, p.porId('inst-titulo'));
  p.porId('inst-cerrar').oyentes.click({});
  assert.equal(p.porId('instalar').hidden, true);
  assert.equal(p.doc.activeElement, p.porId('instalar-app'));
  // Orden de lectura y de Tab: la hoja justo después del panel «+ Calendario».
  const i = PLANTILLA.indexOf('<section class="instalar"');
  assert.ok(i > PLANTILLA.indexOf('id="panel-cal"') && i < PLANTILLA.indexOf('<div class="pestanas"'));
});
