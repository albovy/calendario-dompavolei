// DOM simulado mínimo para ejecutar con node:vm el código de la página (el último <script> de
// plantilla.html): solo lo que ese código usa al pintar la lista, al copiar el mensaje de WhatsApp y al
// abrir y cerrar paneles; más las reglas CSS de la plantilla. Lo usa test/pagina.test.js. (No tiene
// pruebas: node --test lo carga y no hace nada.) getElementById se inventa cualquier id que se le pida:
// que los que usa el código existan lo comprueba aparte test/pagina.test.js.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Una plantilla de src/, sin CR (como la lee html.js).
export function plantilla(nombre) {
  return readFileSync(new URL(`../../src/${nombre}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

// El código de la página: el último <script> de la plantilla.
export function codigoDe(texto) {
  return texto.slice(texto.lastIndexOf('<script>') + '<script>'.length, texto.lastIndexOf('</script>'));
}

// Hora del navegador (la local del equipo que ejecuta las pruebas): viernes 25/09/2026 a las 18:30.
export const AHORA = new Date(2026, 8, 25, 18, 30).getTime();

// Elemento simulado. closest() solo entiende un selector sencillo: una clase (".copiar"), un atributo
// ("[data-ir]") o una etiqueta ("button"), y solo mira el propio elemento.
export function elemento(doc, etiqueta = 'div') {
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
    hasAttribute(k) { return atributos.has(k); },
    removeAttribute(k) { atributos.delete(k); },
    hasAttribute(k) { return atributos.has(k); },
    addEventListener(tipo, fn) { el.oyentes[tipo] = fn; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest(sel) {
      if (sel.startsWith('.')) return clases.has(sel.slice(1)) ? el : null;
      if (sel.startsWith('[')) return atributos.has(sel.slice(1, -1)) ? el : null;
      return el.tagName === sel.toUpperCase() ? el : null;
    },
    focus() { doc.activeElement = el; },
    select() { doc.activeElement = el; },
    appendChild(hijo) { return hijo; },
    // Como en el navegador: si se quita el elemento que tiene el foco, el foco pasa a <body>.
    removeChild(hijo) { if (doc.activeElement === hijo) doc.activeElement = doc.body; return hijo; },
  };
  return el;
}

// Abre la página (su código) con estos datos. portapapeles: el navigator.clipboard (o nada); seguro:
// isSecureContext; almacen: un Map que hace de localStorage (sin él, localStorage está vacío y no guarda);
// protocolo: el de location ('https:', publicada; 'file:', abierta en el ordenador); alturas: el
// offsetHeight de algunos elementos por su id (p. ej. { fijos: 65 }), que el DOM simulado no calcula.
// Para la app instalable: ua (navigator.userAgent), consultas (media queries que se cumplen, p. ej.
// ['(pointer: coarse)']), standalone (navigator.standalone del iPhone), toques (navigator.maxTouchPoints),
// serviceWorker (si el navegador los tiene: se apuntan los register() en pagina.registros), copia (la
// página es la copia del service worker: data-sw-copia) y eventoInstalar (el beforeinstallprompt ya
// recogido por la cabecera). pagina.recargas cuenta los location.reload(). red(url, opciones): lo que
// contesta fetch() (por defecto, sin red), apuntado en pagina.peticiones; enLinea: navigator.onLine;
// recursos: las URL cargadas (performance); los setInterval quedan en pagina.intervalos (id -> función) y
// lo que la página manda al service worker, en pagina.mensajesSw.
export function abrirPagina(codigo, datos, {
  portapapeles, seguro = false, almacen = null, protocolo = 'https:', alturas = {},
  ua = 'Pruebas', consultas = [], standalone, toques = 0, serviceWorker = false, copia = false, eventoInstalar = null,
  red = () => Promise.reject(new TypeError('Failed to fetch')), enLinea = true, recursos = [],
} = {}) {
  const porId = new Map();
  const pagina = { copiado: null, recargas: 0, registros: [], peticiones: [], intervalos: new Map(), mensajesSw: [] };
  let siguienteIntervalo = 1;
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
  doc.documentElement = elemento(doc, 'html');
  if (copia) doc.documentElement.setAttribute('data-sw-copia', '');
  doc.body = elemento(doc, 'body');
  doc.visibilityState = 'visible';
  doc.oyentes = {};
  doc.addEventListener = (tipo, fn) => { doc.oyentes[tipo] = fn; };
  doc.activeElement = doc.body;
  doc.getElementById('datos').textContent = JSON.stringify(datos);
  for (const [id, alto] of Object.entries(alturas)) doc.getElementById(id).offsetHeight = alto;
  class Fecha extends Date {
    constructor(...args) { if (args.length) super(...args); else super(AHORA); }
  }
  const contexto = {
    document: doc, Date: Fecha, isSecureContext: seguro,
    navigator: {
      userAgent: ua, clipboard: portapapeles, standalone, maxTouchPoints: toques, onLine: enLinea,
      ...(serviceWorker ? { serviceWorker: {
        register(url, opciones) { pagina.registros.push({ url, opciones: { ...opciones } }); return Promise.resolve({}); },
        ready: Promise.resolve({ active: { postMessage: (m) => pagina.mensajesSw.push(JSON.parse(JSON.stringify(m))) } }),
        onmessage: null,
      } } : {}),
    },
    // (La señal de corte se apunta aparte: corte.)
    fetch: (url, opciones = {}) => {
      const { signal, ...resto } = opciones;
      pagina.peticiones.push({ url, opciones: resto, corte: Boolean(signal) });
      return red(url, opciones);
    },
    AbortController,
    performance: { getEntriesByType: (tipo) => (tipo === 'resource' ? recursos.map((name) => ({ name })) : []) },
    setInterval(fn) { const id = siguienteIntervalo++; pagina.intervalos.set(id, fn); return id; },
    clearInterval(id) { pagina.intervalos.delete(id); },
    location: {
      protocol: protocolo, host: 'example.org', pathname: '/calendario/', href: `${protocolo}//example.org/calendario/`,
      reload() { pagina.recargas++; },
    },
    matchMedia: (q) => ({ matches: consultas.includes(q) }),
    eventoInstalar,
    localStorage: almacen
      ? { getItem(k) { return almacen.has(k) ? almacen.get(k) : null; }, setItem(k, v) { almacen.set(k, String(v)); } }
      : { getItem() { return null; }, setItem() {} },
    // El aviso «✓ Copiado» se quitaría a los 2 s: en las pruebas no hace falta.
    setTimeout() { return 0; }, clearTimeout() {},
    print() {}, scrollTo() {}, getComputedStyle() { return {}; },
    // Los oyentes de la ventana (p. ej. "resize"), para lanzarlos desde las pruebas: oyentes[tipo](evento)
    // llama a todos los de ese tipo.
    oyentes: {},
    addEventListener(tipo, fn) {
      (listas[tipo] ||= []).push(fn);
      contexto.oyentes[tipo] = (ev) => listas[tipo].forEach((f) => f(ev));
    },
  };
  const listas = {};
  contexto.window = contexto;
  vm.createContext(contexto);
  vm.runInContext(codigo, contexto);
  return Object.assign(pagina, {
    doc, ventana: contexto, porId: (id) => doc.getElementById(id), contenido: doc.getElementById('contenido'),
    estado: doc.getElementById('estado'),
  });
}

// Partido como en los datos de la página (html.js).
export function partido(campos = {}) {
  return {
    f: '2026-09-26', h: '10:00', e: 'c', cat: 'Infantil F', ck: 'infantil', comp: 'LIGA INFANTIL F', l: 'CV RIVAL',
    v: 'DOMPAVOLEI IF1', lo: false, vo: true, pab: 'LEJOS', cond: 'visitante', s: '', ca: '09:00', vj: 0, casa: false,
    seg: false, sp: '', mun: '', r: null, wa: '', ...campos,
  };
}

export function datos(partidos, campos = {}) {
  return {
    club: 'DOMPAVOLEI', temporada: '2026/27', generado: '25/09/2026 12:00', ics: 'calendario.ics', xlsx: 'calendario.xlsx',
    pub: null, sal: null, bus: null, pabs: {},
    equipos: [{ n: 'DOMPAVOLEI IF1', cat: 'Infantil F', ck: 'infantil', ics: '', np: partidos.length }],
    partidos, clas: [], ...campos,
  };
}

// Índices (en D.partidos) de los partidos con el botón «Copiar».
export function conCopiar(html) { return [...html.matchAll(/class="boton-wa copiar" data-i="(\d+)"/g)].map((m) => +m[1]); }

// Pulsa el botón «Copiar» del partido i, con el foco puesto en él (como al llegar con el teclado).
export function pulsarCopiar(pagina, i, texto = '📋 Copiar') {
  const boton = elemento(pagina.doc, 'button');
  boton.classList.add('boton-wa');
  boton.classList.add('copiar');
  boton.setAttribute('data-i', i);
  boton.textContent = texto;
  boton.focus();
  pagina.contenido.oyentes.click({ target: boton });
  pagina.boton = boton;
  return boton;
}

// Dónde está el foco del teclado después de pulsar «Copiar».
export function foco(pagina) {
  const el = pagina.doc.activeElement;
  return el === pagina.boton ? 'el botón' : `<${el.tagName.toLowerCase()}>`;
}

// Las reglas CSS de una plantilla (su <style>), sin comentarios: { selector, cuerpo, impresion } (impresion:
// si está dentro de @media print).
export function reglasCss(texto) {
  const estilo = texto.slice(texto.indexOf('<style>'), texto.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
  const impresion = estilo.indexOf('@media print {');
  return [...estilo.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selector: m[1].trim(), cuerpo: m[2].trim(), impresion: impresion >= 0 && m.index > impresion }));
}

// Cuerpo de los correos de «Pedir bus» de la página.
export function correosBus(html) {
  return [...html.matchAll(/class="boton-bus" href="([^"]*)"/g)].map((m) => {
    const url = m[1].replace(/&amp;/g, '&');
    const cuerpo = url.slice(url.indexOf('?') + 1).split('&').find((q) => q.startsWith('body='));
    return decodeURIComponent(cuerpo.slice('body='.length)).split('\r\n');
  });
}
