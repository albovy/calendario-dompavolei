// Pruebas del código de la página (el <script> de plantilla.html), ejecutado con node:vm en un DOM
// simulado mínimo: solo lo que el código usa al pintar la lista y al copiar el mensaje de WhatsApp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Sin CR, como la lee html.js.
const PLANTILLA = readFileSync(new URL('../src/plantilla.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CODIGO = PLANTILLA.slice(PLANTILLA.lastIndexOf('<script>') + '<script>'.length, PLANTILLA.lastIndexOf('</script>'));

// Hora del navegador (la local del equipo que ejecuta las pruebas): viernes 25/09/2026 a las 18:30.
const AHORA = new Date(2026, 8, 25, 18, 30).getTime();

// Elemento simulado. closest() solo entiende selectores de una clase (".copiar").
function elemento(doc, etiqueta = 'div') {
  const clases = new Set();
  const atributos = new Map();
  const el = {
    tagName: etiqueta.toUpperCase(), textContent: '', innerHTML: '', value: '', href: '', style: {}, dataset: {}, oyentes: {},
    classList: {
      add(c) { clases.add(c); },
      remove(c) { clases.delete(c); },
      contains(c) { return clases.has(c); },
      toggle(c, si = !clases.has(c)) { if (si) clases.add(c); else clases.delete(c); return si; },
    },
    setAttribute(k, v) { atributos.set(k, String(v)); },
    getAttribute(k) { return atributos.has(k) ? atributos.get(k) : null; },
    addEventListener(tipo, fn) { el.oyentes[tipo] = fn; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest(sel) { return sel.startsWith('.') && clases.has(sel.slice(1)) ? el : null; },
    focus() { doc.activeElement = el; },
    select() { doc.activeElement = el; },
    appendChild(hijo) { return hijo; },
    // Como en el navegador: si se quita el elemento que tiene el foco, el foco pasa a <body>.
    removeChild(hijo) { if (doc.activeElement === hijo) doc.activeElement = doc.body; return hijo; },
  };
  return el;
}

// Abre la página con estos datos. portapapeles: el navigator.clipboard (o nada); seguro: isSecureContext.
function abrirPagina(datos, { portapapeles, seguro = false } = {}) {
  const porId = new Map();
  const pagina = { copiado: null };
  const doc = {
    getElementById(id) {
      if (!porId.has(id)) porId.set(id, elemento(doc));
      return porId.get(id);
    },
    querySelector() { return elemento(doc); },
    querySelectorAll() { return []; },
    createElement(etiqueta) { return elemento(doc, etiqueta); },
    // El método antiguo copia lo seleccionado: el <textarea> con el foco.
    execCommand(orden) {
      if (orden !== 'copy' || doc.activeElement.tagName !== 'TEXTAREA') return false;
      pagina.copiado = doc.activeElement.value;
      return true;
    },
  };
  doc.body = elemento(doc, 'body');
  doc.activeElement = doc.body;
  doc.getElementById('datos').textContent = JSON.stringify(datos);
  class Fecha extends Date {
    constructor(...args) { if (args.length) super(...args); else super(AHORA); }
  }
  const contexto = {
    document: doc, Date: Fecha, isSecureContext: seguro,
    navigator: { userAgent: 'Pruebas', clipboard: portapapeles },
    location: { protocol: 'https:', host: 'example.org', pathname: '/calendario/' },
    localStorage: { getItem() { return null; }, setItem() {} },
    // El aviso «✓ Copiado» se quitaría a los 2 s: en las pruebas no hace falta.
    setTimeout() { return 0; }, clearTimeout() {},
    print() {}, scrollTo() {}, getComputedStyle() { return {}; },
  };
  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(CODIGO, contexto);
  return Object.assign(pagina, { doc, contenido: doc.getElementById('contenido'), estado: doc.getElementById('estado') });
}

// Partido como en los datos de la página (crearHtml).
function partido(campos = {}) {
  return {
    f: '2026-09-26', h: '10:00', e: 'c', cat: 'Infantil F', ck: 'infantil', comp: 'LIGA INFANTIL F', l: 'CV RIVAL',
    v: 'DOMPAVOLEI IF1', lo: false, vo: true, pab: 'LEJOS', cond: 'visitante', s: '', ca: '09:00', vj: 0, casa: false,
    seg: false, sp: '', mun: '', r: null, wa: '', ...campos,
  };
}

function datos(partidos, campos = {}) {
  return {
    club: 'DOMPAVOLEI', temporada: '2026/27', generado: '25/09/2026 12:00', ics: 'calendario.ics', xlsx: 'calendario.xlsx',
    pub: null, sal: null, bus: null, pabs: {},
    equipos: [{ n: 'DOMPAVOLEI IF1', cat: 'Infantil F', ck: 'infantil', ics: '', np: partidos.length }],
    partidos, clas: [], ...campos,
  };
}

// Índices (en D.partidos) de los partidos con el botón «Copiar».
function conCopiar(html) { return [...html.matchAll(/class="boton-wa copiar" data-i="(\d+)"/g)].map((m) => +m[1]); }

// Pulsa el botón «Copiar» del partido i, con el foco puesto en él (como al llegar con el teclado).
function pulsarCopiar(pagina, i) {
  const boton = elemento(pagina.doc, 'button');
  boton.classList.add('boton-wa');
  boton.classList.add('copiar');
  boton.setAttribute('data-i', i);
  boton.textContent = '📋 Copiar';
  boton.focus();
  pagina.contenido.oyentes.click({ target: boton });
  pagina.boton = boton;
  return boton;
}

// Dónde está el foco del teclado después de pulsar «Copiar».
function foco(pagina) {
  const el = pagina.doc.activeElement;
  return el === pagina.boton ? 'el botón' : `<${el.tagName.toLowerCase()}>`;
}

// Cuerpo de los correos de «Pedir bus» de la página.
function correosBus(html) {
  return [...html.matchAll(/class="boton-bus" href="([^"]*)"/g)].map((m) => {
    const url = m[1].replace(/&amp;/g, '&');
    const cuerpo = url.slice(url.indexOf('?') + 1).split('&').find((q) => q.startsWith('body='));
    return decodeURIComponent(cuerpo.slice('body='.length)).split('\r\n');
  });
}

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
