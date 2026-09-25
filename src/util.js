// Utilidades comunes: textos de iSquad, claves, fechas "de pared" y mensajes de consola.
//
// Son traducciones directas de las funciones de calendario-voley.ps1 y reproducen también sus
// detalles de .NET (qué es un espacio, mayúsculas carácter a carácter, entidades HTML...), para
// que los archivos generados salgan idénticos.

import { createHash } from 'node:crypto';

// --- Constantes --------------------------------------------------------------------------------

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];

// Marca de orden de bytes (BOM) que pueden traer delante los textos de iSquad y los JSON.
export const BOM = String.fromCharCode(0xFEFF);

// Orden de las categorías (de menor a mayor edad).
const CATEGORIAS = [
  { clave: 'benjamin', patron: /BENJAM/i },
  { clave: 'alevin', patron: /ALEV/i },
  { clave: 'infantil', patron: /INFANTIL/i },
  { clave: 'cadete', patron: /CADETE/i },
  { clave: 'juvenil', patron: /JUVENIL|XUVENIL/i },
  { clave: 'junior', patron: /JUNIOR/i },
  { clave: 'senior', patron: /SENIOR|SUPERLIGA|DIVISION|NACIONAL|LIGA/i },
];

// Espacio tal como lo entiende .NET (\s y Trim): incluye U+0085 y no U+FEFF, al revés que JavaScript.
const ESPACIO = String.raw`[\t\n\v\f\r\x85\p{Z}]`;
const RE_ESPACIOS = new RegExp(`${ESPACIO}+`, 'gu');
const RE_BORDES = new RegExp(`^${ESPACIO}+|${ESPACIO}+$`, 'gu');
const RE_BLANCO = new RegExp(`^${ESPACIO}*$`, 'u');
const RE_BR = new RegExp(`<${ESPACIO}*/?${ESPACIO}*br${ESPACIO}*/?${ESPACIO}*>`, 'giu');

// Entidades con nombre que reconoce WebUtility.HtmlDecode de .NET (las 253 de HTML 4): "código-nombre".
const ENTIDADES = new Map(`
  34-quot 38-amp 39-apos 60-lt 62-gt 160-nbsp 161-iexcl 162-cent 163-pound 164-curren 165-yen
  166-brvbar 167-sect 168-uml 169-copy 170-ordf 171-laquo 172-not 173-shy 174-reg 175-macr 176-deg
  177-plusmn 178-sup2 179-sup3 180-acute 181-micro 182-para 183-middot 184-cedil 185-sup1 186-ordm
  187-raquo 188-frac14 189-frac12 190-frac34 191-iquest 192-Agrave 193-Aacute 194-Acirc 195-Atilde
  196-Auml 197-Aring 198-AElig 199-Ccedil 200-Egrave 201-Eacute 202-Ecirc 203-Euml 204-Igrave
  205-Iacute 206-Icirc 207-Iuml 208-ETH 209-Ntilde 210-Ograve 211-Oacute 212-Ocirc 213-Otilde
  214-Ouml 215-times 216-Oslash 217-Ugrave 218-Uacute 219-Ucirc 220-Uuml 221-Yacute 222-THORN
  223-szlig 224-agrave 225-aacute 226-acirc 227-atilde 228-auml 229-aring 230-aelig 231-ccedil
  232-egrave 233-eacute 234-ecirc 235-euml 236-igrave 237-iacute 238-icirc 239-iuml 240-eth
  241-ntilde 242-ograve 243-oacute 244-ocirc 245-otilde 246-ouml 247-divide 248-oslash 249-ugrave
  250-uacute 251-ucirc 252-uuml 253-yacute 254-thorn 255-yuml 338-OElig 339-oelig 352-Scaron
  353-scaron 376-Yuml 402-fnof 710-circ 732-tilde 913-Alpha 914-Beta 915-Gamma 916-Delta
  917-Epsilon 918-Zeta 919-Eta 920-Theta 921-Iota 922-Kappa 923-Lambda 924-Mu 925-Nu 926-Xi
  927-Omicron 928-Pi 929-Rho 931-Sigma 932-Tau 933-Upsilon 934-Phi 935-Chi 936-Psi 937-Omega
  945-alpha 946-beta 947-gamma 948-delta 949-epsilon 950-zeta 951-eta 952-theta 953-iota 954-kappa
  955-lambda 956-mu 957-nu 958-xi 959-omicron 960-pi 961-rho 962-sigmaf 963-sigma 964-tau
  965-upsilon 966-phi 967-chi 968-psi 969-omega 977-thetasym 978-upsih 982-piv 8194-ensp 8195-emsp
  8201-thinsp 8204-zwnj 8205-zwj 8206-lrm 8207-rlm 8211-ndash 8212-mdash 8216-lsquo 8217-rsquo
  8218-sbquo 8220-ldquo 8221-rdquo 8222-bdquo 8224-dagger 8225-Dagger 8226-bull 8230-hellip
  8240-permil 8242-prime 8243-Prime 8249-lsaquo 8250-rsaquo 8254-oline 8260-frasl 8364-euro
  8465-image 8472-weierp 8476-real 8482-trade 8501-alefsym 8592-larr 8593-uarr 8594-rarr 8595-darr
  8596-harr 8629-crarr 8656-lArr 8657-uArr 8658-rArr 8659-dArr 8660-hArr 8704-forall 8706-part
  8707-exist 8709-empty 8711-nabla 8712-isin 8713-notin 8715-ni 8719-prod 8721-sum 8722-minus
  8727-lowast 8730-radic 8733-prop 8734-infin 8736-ang 8743-and 8744-or 8745-cap 8746-cup 8747-int
  8756-there4 8764-sim 8773-cong 8776-asymp 8800-ne 8801-equiv 8804-le 8805-ge 8834-sub 8835-sup
  8836-nsub 8838-sube 8839-supe 8853-oplus 8855-otimes 8869-perp 8901-sdot 8968-lceil 8969-rceil
  8970-lfloor 8971-rfloor 9001-lang 9002-rang 9674-loz 9824-spades 9827-clubs 9829-hearts
  9830-diams
`.trim().split(/\s+/).map((e) => {
  const [codigo, nombre] = e.split('-');
  return [nombre, String.fromCharCode(Number(codigo))];
}));

// --- Consola -----------------------------------------------------------------------------------

export function paso(texto) { console.log(`  ${texto}`); }
export function aviso(texto) { console.log(`  ! ${texto}`); }

// --- Textos ------------------------------------------------------------------------------------

// Los parámetros [string] de PowerShell convierten $null en ''.
export function txt(valor) { return valor == null ? '' : String(valor); }

// Quita los espacios de los extremos como String.Trim() de .NET.
function recortar(texto) { return texto.replace(RE_BORDES, ''); }

// Como String.Trim(caracteres) de .NET: quita esos caracteres de los dos extremos.
function recortarCaracteres(texto, caracteres) {
  let ini = 0;
  let fin = texto.length;
  while (ini < fin && caracteres.includes(texto[ini])) ini++;
  while (fin > ini && caracteres.includes(texto[fin - 1])) fin--;
  return texto.slice(ini, fin);
}

// Mayúsculas y minúsculas carácter a carácter, como ToUpperInvariant/ToLowerInvariant de .NET:
// la longitud no cambia ("ß" sigue siendo "ß", no "SS").
function cambiarCaja(texto, aMayusculas) {
  let r = '';
  for (const c of txt(texto)) {
    const m = aMayusculas ? c.toUpperCase() : c.toLowerCase();
    r += m.length === c.length ? m : c;
  }
  return r;
}
export function mayusculas(texto) { return cambiarCaja(texto, true); }
export function minusculas(texto) { return cambiarCaja(texto, false); }

// Comparación sin distinguir mayúsculas (como -eq/-ne de PowerShell).
function igualSinCaja(a, b) { return mayusculas(a) === mayusculas(b); }

// Como WebUtility.HtmlDecode de .NET Framework: entidades con nombre de HTML 4 y numéricas
// (&#233; &#xE9;) entre 1 y FFFF. Las que no reconoce las deja tal cual.
function decodificarHtml(texto) {
  return texto.replace(/&([^;&]*);/g, (entidad, cuerpo) => {
    if (cuerpo.length > 1 && cuerpo[0] === '#') {
      const hexa = cuerpo[1] === 'x' || cuerpo[1] === 'X';
      // Como UInt32.TryParse: en decimal admite espacios alrededor y un "+"; en hexadecimal, nada más.
      const m = hexa ? /^([0-9a-f]+)$/i.exec(cuerpo.slice(2)) : /^[\t-\r ]*\+?([0-9]+)[\t-\r ]*$/.exec(cuerpo.slice(1));
      const codigo = m ? parseInt(m[1], hexa ? 16 : 10) : 0;
      return codigo >= 1 && codigo <= 0xFFFF ? String.fromCharCode(codigo) : entidad;
    }
    return ENTIDADES.get(cuerpo) ?? entidad;
  });
}

export function textoPlano(html) {
  // Quita las etiquetas HTML que iSquad mete en los campos; cada <br> pasa a ser un salto de línea.
  const texto = txt(html);
  if (RE_BLANCO.test(texto) || texto.toLowerCase() === 'none') return '';
  const t = decodificarHtml(texto.replace(RE_BR, '\n').replace(/<[^>]*>/g, ' '));
  return t.split('\n')
    .map((l) => recortar(l.replace(RE_ESPACIOS, ' ')))
    .filter((l) => l)
    .join('\n');
}

export function unaLinea(html) { return textoPlano(html).replace(/\n/g, ' '); }

export function sinTildes(texto) {
  const t = txt(texto);
  if (!t) return '';
  return t.normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
}

export function clave(texto) {
  return mayusculas(sinTildes(texto)).replace(/[^A-Z0-9]+/g, ' ').trim();
}

export function slug(texto) {
  let s = recortarCaracteres(minusculas(sinTildes(texto)).replace(/[^a-z0-9]+/g, '-'), '-');
  if (s.length > 60) s = recortarCaracteres(s.slice(0, 60), '-');
  return s || 'calendario';
}

export function sha1(texto) {
  return createHash('sha1').update(txt(texto), 'utf8').digest('hex');
}

export function pabellon(campo) {
  // "PM A PINGUELA<br>PM A PINGUELA - PISTA 1" -> "PM A PINGUELA - PISTA 1"
  const lineas = [];
  for (const l of textoPlano(campo).split('\n')) {
    if (l && !lineas.includes(l)) lineas.push(l);
  }
  const utiles = lineas.filter((l) => !lineas.some((otra) =>
    !igualSinCaja(otra, l) && mayusculas(otra).startsWith(mayusculas(l))));
  return utiles.join(' - ');
}

// Letras y separadores de palabra según TextInfo.ToTitleCase de .NET.
const RE_LETRA = /\p{L}/u;
const RE_SEPARADOR = /[\p{Z}\p{Cc}\p{Cf}\p{P}\p{S}]/u;

// Como TextInfo.ToTitleCase de .NET sobre un texto ya en minúsculas: mayúscula en la primera letra
// de cada palabra. Cifras, marcas y apóstrofos no cortan la palabra ("u14" -> "U14"), los espacios
// y la puntuación sí ("xuvenil-cadete" -> "Xuvenil-Cadete"); una cifra delante no la empieza
// ("1a" -> "1A").
function tituloMinusculas(texto) {
  let r = '';
  let enPalabra = false;
  for (const c of texto) {
    if (enPalabra) {
      if (c !== "'" && RE_SEPARADOR.test(c)) enPalabra = false;
      r += c;
    } else if (RE_LETRA.test(c)) {
      r += mayusculas(c);
      enPalabra = true;
    } else {
      r += c;
    }
  }
  return r;
}

// Palabra completa, como \bpalabra\b en .NET (donde las letras con tilde también cuentan como letras).
function palabra(texto) {
  const w = String.raw`[\p{L}\p{Mn}\p{Nd}\p{Pc}]`;
  return new RegExp(`(?<!${w})${texto}(?!${w})`, 'giu');
}
const TILDES_CATEGORIA = [
  [palabra('Alevin'), 'Alevín'],
  [palabra('Benjamin'), 'Benjamín'],
  [palabra('Division'), 'División'],
];
const RE_TERMINA_EN_SEXO = new RegExp(`${ESPACIO}[FM]$`, 'iu');
const RE_SEXO_COMPETICION = new RegExp(
  `(?:^|${ESPACIO})(F|M|FEM\\.?|MASC\\.?|FEMENIN[OA]|MASCULIN[OA])${ESPACIO}*$`, 'iu');

export function infoCategoria(categoria, competicion) {
  let base = unaLinea(categoria);
  const comp = unaLinea(competicion);
  const claveTexto = clave(`${base} ${comp}`);
  const i = CATEGORIAS.findIndex((c) => c.patron.test(claveTexto));
  if (!base) base = 'Sin categoría';
  let nombre = tituloMinusculas(minusculas(base));
  for (const [re, conTilde] of TILDES_CATEGORIA) nombre = nombre.replace(re, conTilde);
  // El sexo va al final del nombre de la competición: "TORNEO APERTURA CADETE F", "... NACIONAL FEMENINA".
  const sexo = RE_SEXO_COMPETICION.exec(comp);
  if (!RE_TERMINA_EN_SEXO.test(nombre) && sexo) {
    nombre = `${nombre} ${mayusculas(sexo[1][0])}`;
  }
  return {
    nombre,
    clave: i >= 0 ? CATEGORIAS[i].clave : 'otra',
    orden: i >= 0 ? i : 99,
  };
}

export function prefijoComun(nombres) {
  // "DOMPAVOLEI IF1", "DOMPAVOLEI CF1" -> "DOMPAVOLEI" (palabras completas, al menos 3 letras).
  const lista = (typeof nombres === 'string' ? [nombres] : [...(nombres ?? [])]).filter((n) => n).map(String);
  if (lista.length < 2) return '';
  let prefijo = lista[0];
  for (const n of lista) {
    let i = 0;
    while (i < prefijo.length && i < n.length && igualSinCaja(prefijo[i], n[i])) i++;
    prefijo = prefijo.slice(0, i);
  }
  const corte = prefijo.lastIndexOf(' ');
  if (corte < 0) return '';
  prefijo = recortarCaracteres(prefijo.slice(0, corte), ' -.,');
  return prefijo.length < 3 ? '' : prefijo;
}

// Como la conversión [int] de PowerShell: redondeo bancario (2,5 -> 2; 3,5 -> 4).
export function aEntero(valor) {
  const n = Number(valor ?? 0);
  let r = Math.round(n);
  if (Math.abs(n % 1) === 0.5 && r % 2 !== 0) r -= 1;
  return r + 0;   // sin -0
}

export function formatDuracion(minutos) {
  const total = aEntero(minutos);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function repararTexto(texto) {
  // iSquad guarda algunas direcciones con las tildes mal codificadas ("RÃºA" en vez de "RÚA").
  // Se recuperan los bytes originales (Latin-1; lo que no cabe queda como "?") y se leen como UTF-8.
  // Como en el .ps1, la comprobación no distingue mayúsculas: también entra con "ã" o "â".
  const t = txt(texto);
  if (!/[ÃÂ]/i.test(t)) return t;
  const bytes = Buffer.alloc(t.length);
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    bytes[i] = c <= 0xFF ? c : 0x3F;
  }
  return bytes.toString('utf8');
}

// --- Fechas ------------------------------------------------------------------------------------
//
// Las horas de los partidos son hora de Galicia. Para no depender de la zona horaria del servidor,
// una fecha es un Date "de pared": los campos UTC guardan la hora local de Galicia y se leen
// siempre con getUTC*.

export function fechaPared(anio, mes, dia, hh = 0, mm = 0) {
  return new Date(Date.UTC(anio, mes - 1, dia, hh, mm));
}

// Como al leer una fecha con DateTime.TryParseExact: el Date de pared si esa fecha y hora existen
// (no el 31 de abril, ni el mes 13, ni las 24:00); si no, null.
export function fechaValida(anio, mes, dia, hh = 0, mm = 0, ss = 0) {
  if (anio < 1 || anio > 9999 || hh > 23 || mm > 59 || ss > 59) return null;
  const d = new Date(Date.UTC(2000, mes - 1, dia, hh, mm, ss));
  d.setUTCFullYear(anio);   // Date.UTC tomaría los años 0-99 como 1900-1999
  // Una fecha que no existe se "desborda" a otro mes.
  return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d : null;
}

const RELOJ_MADRID = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

// Hora actual de Galicia (como Date de pared).
export function ahoraMadrid(instante = new Date()) {
  const p = {};
  for (const { type, value } of RELOJ_MADRID.formatToParts(instante)) p[type] = Number(value);
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second,
    instante.getUTCMilliseconds()));
}

// Como ToString(patrón, InvariantCulture) de .NET, con los campos yyyy, MM, dd, HH, mm, ss y texto
// literal entre comillas simples ("yyyyMMdd'T'HHmmss"). Otra letra de formato es un error.
export function fmt(d, patron) {
  const dos = (n) => String(n).padStart(2, '0');
  const campos = {
    yyyy: String(d.getUTCFullYear()).padStart(4, '0'),
    MM: dos(d.getUTCMonth() + 1),
    dd: dos(d.getUTCDate()),
    HH: dos(d.getUTCHours()),
    mm: dos(d.getUTCMinutes()),
    ss: dos(d.getUTCSeconds()),
  };
  return patron.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|[dfFghHKmMstyz]/g, (trozo, literal) => {
    if (literal !== undefined) return literal;
    if (trozo in campos) return campos[trozo];
    throw new Error(`Formato de fecha no admitido: ${patron}`);
  });
}

// "HH:mm" de una hora; '' si no hay (salida o calentamiento sin calcular).
export function hora(d) { return d ? fmt(d, 'HH:mm') : ''; }

export function sumarMinutos(d, min) { return new Date(d.getTime() + min * 60000); }
export function sumarDias(d, n) { return new Date(d.getTime() + n * 86400000); }
export function soloDia(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }

// "sáb 03/10"
export function fechaCorta(d) { return `${DIAS_CORTOS[d.getUTCDay()]} ${fmt(d, 'dd/MM')}`; }

export function anioTemporada(d) {
  // La temporada va del 1 de agosto al 31 de julio: se nombra por el año en que empieza.
  return d.getUTCMonth() + 1 >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
}

// Espera ms milisegundos. Con el setTimeout global (y no el de node:timers/promises) para que las
// pruebas puedan adelantar el reloj (t.mock.timers) y no esperar de verdad los reintentos.
export function esperar(ms) { return new Promise((fin) => { setTimeout(fin, ms); }); }

// --- Listas y JSON -----------------------------------------------------------------------------

// Orden de Sort-Object en el PowerShell 7 de GitHub Actions (cultura invariante, es decir, el orden
// de ICU sin idioma) sin distinguir mayúsculas.
const ORDEN_TEXTO = new Intl.Collator('en', { sensitivity: 'accent' });

export function compararTexto(a, b) { return ORDEN_TEXTO.compare(txt(a), txt(b)); }

// Como Sort-Object -Unique: ordena y quita los repetidos (sin distinguir mayúsculas). por: el texto
// por el que se ordena cada elemento (como Sort-Object Id -Unique); por defecto, el propio elemento.
export function ordenarUnicos(lista, por = (x) => x) {
  const comparar = (a, b) => compararTexto(por(a), por(b));
  return [...lista].sort(comparar)
    .filter((x, i, ordenada) => i === 0 || comparar(ordenada[i - 1], x) !== 0);
}

// Las claves de @{} y [ordered]@{} de PowerShell no distinguen mayúsculas: "Lejos - Pista 1" encuentra
// la entrada "LEJOS - PISTA 1" y, al asignarla, esta conserva su nombre. Devuelve la clave ya guardada
// en coleccion (objeto o Map) que equivale a k (con la misma igualdad que ordenarUnicos), o k si no hay.
export function claveSinCaja(coleccion, k) {
  const esMapa = coleccion instanceof Map;
  if (esMapa ? coleccion.has(k) : Object.hasOwn(coleccion, k)) return k;
  for (const x of esMapa ? coleccion.keys() : Object.keys(coleccion)) {
    if (compararTexto(x, k) === 0) return x;
  }
  return k;
}

// Como @(...) o una tubería de PowerShell: un valor suelto (también $null) cuenta como lista de uno.
export function comoLista(valor) { return Array.isArray(valor) ? valor : [valor]; }

// Un objeto de JSON ({...}), no una lista, un texto ni null.
export function esObjeto(valor) { return valor !== null && typeof valor === 'object' && !Array.isArray(valor); }

// Como ConvertFrom-Json (sobre un archivo leído con Get-Content, que ya quita el BOM): un texto en
// blanco no es un error, es $null. Lanza error si no es JSON.
export function leerJson(texto) {
  let t = txt(texto);
  if (t.startsWith(BOM)) t = t.slice(1);
  return RE_BLANCO.test(t) ? null : JSON.parse(t);
}
