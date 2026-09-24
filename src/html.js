// Página HTML con los partidos (lista, vista mensual, filtros, imprimir). Es la traducción de New-Html
// de calendario-voley.ps1: la plantilla (plantilla.html) no cambia y los partidos van dentro, en JSON.

import { readFileSync } from 'node:fs';
import { conHora } from './partidos.js';
import { aEntero, claveSinCaja, fmt, hora, ordenarUnicos, txt } from './util.js';

// Copia exacta del here-string $Script:PlantillaHtml del .ps1, con __TITULO__ y __DATOS__.
// Sin CR: aunque Git la saque con CRLF en Windows, la página sale igual que en GitHub Actions.
const PLANTILLA = readFileSync(new URL('./plantilla.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const ESTADOS = new Map([['confirmada', 'c'], ['provisional', 'p'], ['sinhora', 'h'], ['pendiente', 'x']]);

// Dirección donde se publica el .ics (config.json > calendario_publicado): la página enlaza con esa
// carpeta para suscribirse. Como -match de PowerShell: sin distinguir mayúsculas, "." no incluye el
// salto de línea y "$" admite un salto de línea al final.
const RE_PUBLICADA = /^(https?:\/\/[^\n]+\/)([^/]+\.ics)(?=\n?$)/i;

// Barra invertida, construida por partes a propósito (ver más abajo).
const BARRA = String.fromCharCode(92);

// ConvertTo-Json de PowerShell 7 (Newtonsoft) también escapa NEL, LS y PS (U+0085, U+2028, U+2029).
const RE_SEPARADORES = new RegExp(`[${String.fromCharCode(0x85, 0x2028, 0x2029)}]`, 'g');

// Lo que WebUtility.HtmlEncode pone en lugar de un sustituto (surrogate) suelto: U+FFFD.
const CARACTER_SUSTITUTO = String.fromCharCode(0xFFFD);

const ENTIDADES = new Map([['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;'], ['&', '&amp;']]);

// Como WebUtility.HtmlEncode de .NET (el de PowerShell 7): < > " ' & con su entidad, los caracteres
// del 160 al 255 y los de fuera del plano básico (emojis) como "&#número;", y un sustituto suelto
// como U+FFFD.
export function codificarHtml(valor) {
  let r = '';
  for (const c of txt(valor)) {
    const codigo = c.codePointAt(0);
    if (ENTIDADES.has(c)) r += ENTIDADES.get(c);
    else if ((codigo >= 160 && codigo <= 255) || codigo > 0xFFFF) r += `&#${codigo};`;
    else if (codigo >= 0xD800 && codigo <= 0xDFFF) r += CARACTER_SUSTITUTO;
    else r += c;
  }
  return r;
}

function datosPabellones(partidos, pabellones) {
  // Dirección y municipio de cada pabellón (para el correo de "Pedir bus"). La caché no distingue
  // mayúsculas, como el @{} del .ps1 (claveSinCaja).
  if (!pabellones) return {};
  const entradas = [];
  for (const n of ordenarUnicos(partidos.map((p) => p.pabellon).filter((n) => n))) {
    const k = claveSinCaja(pabellones, n);
    const e = Object.hasOwn(pabellones, k) ? pabellones[k] : null;
    if (e && e.lat != null) entradas.push([n, { dir: txt(e.direccion), mun: txt(e.municipio) }]);
  }
  // fromEntries y no pabs[n] = ...: así también vale un pabellón que se llame "__proto__".
  return Object.fromEntries(entradas);
}

// generado: { pared, utc } (o directamente el Date de pared). salidas: el de configSalidas o null.
// pabellones: la caché de resolverPabellones o null. pedirBus: el de configPedirBus o null.
export function crearHtml({ partidos, equipos, nombreClub, temporada, ics, xlsx, generado, urlPublicada,
  salidas, pabellones, pedirBus, duracion }) {
  const pared = generado instanceof Date ? generado : generado.pared;
  const bus = pedirBus ? { ...pedirBus, dur: aEntero(duracion) } : null;
  const pub = RE_PUBLICADA.exec(txt(urlPublicada));
  const datos = {
    club: txt(nombreClub),
    temporada: txt(temporada),
    generado: fmt(pared, 'dd/MM/yyyy HH:mm'),
    ics: txt(ics),
    xlsx: txt(xlsx),
    pub: pub ? { base: pub[1], ics: pub[2] } : null,
    sal: salidas ? { origen: salidas.origen, cal: salidas.calentamiento } : null,
    bus,
    pabs: datosPabellones(partidos, pabellones),
    equipos: equipos.map((e) => ({
      n: e.nombre, cat: e.categoria, ck: e.claveCategoria, ics: e.ics, np: e.partidos.length,
    })),
    partidos: partidos.map((p) => ({
      f: fmt(p.fecha, 'yyyy-MM-dd'),
      h: conHora(p) ? fmt(p.fecha, 'HH:mm') : '',
      e: ESTADOS.get(p.estado),
      cat: p.categoria,
      ck: p.claveCategoria,
      comp: p.competicion,
      l: p.local,
      v: p.visitante,
      lo: Boolean(p.esLocal),
      vo: Boolean(p.esVisitante),
      pab: p.pabellon,
      cond: p.condicion,
      s: hora(p.salida),
      ca: p.segundo ? '' : hora(p.calentamiento),
      vj: p.viajeMin != null && !p.segundo ? aEntero(p.viajeMin) : 0,
      casa: Boolean(p.enCasa),
      seg: Boolean(p.segundo),
      sp: p.salidaPrimero ? hora(p.salidaPrimero.salida) : '',
      mun: txt(p.municipio),
    })),
  };
  // Como ConvertTo-Json: lo que falta sale como null (JSON.stringify quitaría la propiedad).
  let json = JSON.stringify(datos, (_clave, valor) => (valor === undefined ? null : valor));
  json = json.replace(RE_SEPARADORES, (c) => `${BARRA}u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  // Dentro de <script> no puede aparecer "</script>" ni "<!--": cada "<" se escribe con su escape JSON
  // (barra invertida + u003c). Se construye por partes a propósito para que ningún editor lo convierta en "<".
  json = json.split('<').join(`${BARRA}u003c`);
  if (json.includes('<')) throw new Error('Error interno: quedan "<" sin escapar en los datos de la página.');
  const titulo = codificarHtml(`Partidos · ${txt(nombreClub)} · ${txt(temporada)}`);
  // split/join y no replace(): con replace(), un "$&" o "$'" en los textos se interpretaría.
  return PLANTILLA.split('__TITULO__').join(titulo).split('__DATOS__').join(json);
}
