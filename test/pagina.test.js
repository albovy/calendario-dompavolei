// Pruebas del código de la página (el <script> de plantilla.html), ejecutado con node:vm en el DOM
// simulado mínimo de test/apoyo/pagina-simulada.js: solo lo que el código usa al pintar la lista y al copiar
// el mensaje de WhatsApp. Más el selector «Diseño antiguo | Diseño nuevo» de arriba del todo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abrirPagina as abrir, codigoDe, conCopiar, correosBus, datos, foco, partido, plantilla, pulsarCopiar, reglasSelector,
  selectorDiseno,
} from './apoyo/pagina-simulada.js';

const PLANTILLA = plantilla('plantilla.html');
const CODIGO = codigoDe(PLANTILLA);

// Abre la página de siempre con estos datos (opciones: las de abrirPagina).
function abrirPagina(d, opciones) { return abrir(CODIGO, d, opciones); }

// --- Selector «Diseño antiguo | Diseño nuevo» (para comparar con salidas.html) ---------------------------

test('página: selector «Diseño antiguo | Diseño nuevo» arriba del todo, con esta página marcada', () => {
  const s = selectorDiseno(PLANTILLA);
  assert.ok(s, 'falta la franja del selector');
  // Lo primero del <body>: encima de la cabecera.
  assert.equal(PLANTILLA.slice(PLANTILLA.indexOf('<body>') + '<body>'.length, s.inicio).trim(), '');
  assert.ok(s.inicio < PLANTILLA.indexOf('<header class="cabecera">'));
  assert.match(s.nav, /^<nav class="selector-diseno" aria-label="Diseño de la página">/);
  assert.deepEqual(s.enlaces, [
    { texto: 'Diseño antiguo', id: 'diseno-antiguo', href: 'index.html', actual: true },
    { texto: 'Diseño nuevo', id: 'diseno-nuevo', href: 'salidas.html', actual: false },
  ]);
});

test('página: «Diseño antiguo» lleva a index.html en la web y, en el ordenador, al .html de siempre (el nombre del .ics)', () => {
  const d = datos([partido()], { ics: 'calendario-dompavolei-2026-27.ics' });
  assert.equal(abrirPagina(d).porId('diseno-antiguo').href, 'index.html');
  assert.equal(abrirPagina(d, { protocolo: 'file:' }).porId('diseno-antiguo').href, 'calendario-dompavolei-2026-27.html');
});

test('página: la franja del selector mide 36-40 px, se va con el scroll (no tapa nada) y no sale al imprimir', () => {
  const reglas = reglasSelector(PLANTILLA);
  const pantalla = reglas.filter((r) => !r.impresion);
  const altos = pantalla.flatMap((r) => [...r.cuerpo.matchAll(/min-height: (\d+)px/g)].map((m) => +m[1]));
  assert.ok(altos.some((a) => a >= 36 && a <= 40), `alto de la franja: ${altos.join(', ')}`);
  for (const r of pantalla) assert.doesNotMatch(r.cuerpo, /position: *(sticky|fixed)/, r.selector);
  assert.ok(reglas.some((r) => r.impresion && /(^|,)\s*\.selector-diseno\s*(,|$)/.test(r.selector) && /display: none/.test(r.cuerpo)),
    'la franja sale al imprimir');
});

test('página: botones de WhatsApp solo en los partidos por jugar sin resultado', () => {
  // Marcador local-visitante: el club juega de visitante (CV RIVAL 1 - 3 DOMPAVOLEI IF1).
  const r = { m: [1, 3], s: [[20, 25], [25, 20], [18, 25], [22, 25]] };
  const partidos = [
    // Hoy, sin hora y con el resultado ya recogido: no se sabe si «ya se jugó» por la hora, pero sí por el resultado.
    partido({ f: '2026-09-25', h: '', e: 'h', r, wa: 'Mensaje de hoy' }),
    partido({ f: '2026-09-25', h: '', e: 'h', v: 'DOMPAVOLEI XF1', wa: 'Mensaje de hoy, sin resultado' }),
    partido({ wa: 'Mensaje de mañana' }),
  ];
  const html = abrirPagina(datos(partidos)).contenido.innerHTML;
  assert.match(html, /Ganado 3-1/);
  assert.deepEqual(conCopiar(html), [1, 2]);
  assert.equal(html.split('https://api.whatsapp.com/send?text=').length - 1, 2);
});

// El atajo wa.me cambia los emojis por «�» al redirigir (comprobado el 25/09/2026: ?text=%F0%9F%8F%90
// sale como %EF%BF%BD en api.whatsapp.com); por eso el enlace va directo a api.whatsapp.com/send.
test('página: el enlace «WhatsApp» va directo a api.whatsapp.com con el mensaje entero, emojis incluidos', () => {
  const mensaje = '🏐 *DOMPAVOLEI IF1* (Infantil F)\n📅 *Sábado 26 de septiembre*\n⏰ 🏟️ A & B #1 +2';
  const html = abrirPagina(datos([partido({ wa: mensaje })])).contenido.innerHTML;
  const enlaces = [...html.matchAll(/class="boton-wa wa" href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  assert.equal(enlaces.length, 1);
  const prefijo = 'https://api.whatsapp.com/send?text=';
  assert.ok(enlaces[0].startsWith(prefijo), enlaces[0]);
  assert.equal(decodeURIComponent(enlaces[0].slice(prefijo.length)), mensaje);
  assert.ok(!html.includes('wa.me'));
});

test('página: «Copiar» sin navigator.clipboard (método antiguo): copia y el foco vuelve al botón', () => {
  const pagina = abrirPagina(datos([partido({ wa: 'Mensaje para las familias' })]));
  assert.deepEqual(conCopiar(pagina.contenido.innerHTML), [0]);
  const boton = pulsarCopiar(pagina, 0);
  assert.equal(pagina.copiado, 'Mensaje para las familias');
  assert.equal(boton.textContent, '✓ Copiado');
  assert.equal(pagina.estado.textContent, 'Mensaje copiado');
  // Quien usa el teclado o un lector de pantalla no pierde su sitio en la página.
  assert.equal(foco(pagina), 'el botón');
});

test('página: «Copiar» cuando navigator.clipboard falla: método antiguo y el foco vuelve al botón', async () => {
  const portapapeles = { writeText() { return Promise.reject(new Error('sin permiso')); } };
  const pagina = abrirPagina(datos([partido({ wa: 'Mensaje para las familias' })]), { portapapeles, seguro: true });
  const boton = pulsarCopiar(pagina, 0);
  await new Promise((fin) => { setImmediate(fin); });
  assert.equal(pagina.copiado, 'Mensaje para las familias');
  assert.equal(boton.textContent, '✓ Copiado');
  assert.equal(foco(pagina), 'el botón');
});

test('página: «Pedir bus» cuenta como el mismo equipo el de otro orden (derbi) y el de otras mayúsculas', () => {
  const bus = { para: 'bus@example.com', cc: '', plazas: '55', firma: '', origen: 'Os Remedios', dirOrigen: '', dur: 120 };
  const partidos = [
    // Derbi de ida y vuelta en el mismo pabellón: el de las 12:00 es el «2º partido» (anadirSalidas).
    partido({ l: 'DOMPAVOLEI IF1', v: 'DOMPAVOLEI IF2', lo: true, vo: true, cond: 'derbi', s: '07:15', vj: 105 }),
    partido({ h: '12:00', l: 'DOMPAVOLEI IF2', v: 'DOMPAVOLEI IF1', lo: true, vo: true, cond: 'derbi', ca: '', seg: true, sp: '07:15' }),
    // iSquad escribe el equipo con otras mayúsculas en el segundo partido.
    partido({ f: '2026-10-03', s: '07:15', vj: 105 }),
    partido({ f: '2026-10-03', h: '12:00', l: 'Dompavolei IF1', v: 'CV OTRO', lo: true, vo: false, cond: 'local', ca: '', seg: true, sp: '07:15' }),
  ];
  const correos = correosBus(abrirPagina(datos(partidos, { sal: { origen: 'Os Remedios', cal: 60 }, bus })).contenido.innerHTML);
  assert.equal(correos.length, 2);
  const [derbi, mayusculas] = correos;
  assert.ok(derbi.includes('- Partidos: 10:00 contra otro equipo del club; 12:00 contra otro equipo del club'), derbi.join('\n'));
  // Como el mensaje de WhatsApp: el bus espera al de las 12:00 (12:00 + 120 + 105 = 15:45).
  assert.ok(derbi.includes('- Regreso: al terminar el último partido, hacia las 14:00; llegada aproximada a Os Remedios a las 15:45'),
    derbi.join('\n'));
  assert.ok(mayusculas.includes('- Partidos: 10:00 contra CV RIVAL; 12:00 contra CV OTRO'), mayusculas.join('\n'));
  assert.ok(mayusculas.some((l) => l.endsWith('llegada aproximada a Os Remedios a las 15:45')), mayusculas.join('\n'));
});
