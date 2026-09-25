// Comprueba que la versión en JavaScript (src/) genera exactamente lo mismo que calendario-voley.ps1.
//
//   node test/paridad/comparar.mjs [--temporada 2025-26] [--desde aaaa-mm-dd] [--hasta aaaa-mm-dd]
//                                  [--club X] [--duracion-minutos N] [--sin-equipos] [--listar-clubs]
//                                  [--zonas UTC,America/New_York] [--pabellones repo|vacio|compartido]
//                                  [--carpeta dir] [--reutilizar-ps] [--solo-comparar] [--powershell exe]
//
// Copia calendario-voley.ps1, config.json y pabellones.json a carpetas temporales, ejecuta las dos
// versiones una detrás de otra (las dos descargan de verdad de la federación) y compara:
//
//   - la lista de archivos generados;
//   - cada .ics (el del club y los de equipos/), sin DTSTAMP, LAST-MODIFIED ni SEQUENCE y con la fecha
//     de "actualizados el" igualada: primero tal cual, con las líneas plegadas, y luego desplegadas;
//   - la página: sus datos embebidos como JSON, sin "generado" ni lo que el .ps1 no tiene (corto, clas,
//     escudo, app; r y wa en cada partido). La plantilla no: desde septiembre de 2026 es otro diseño;
//   - el Excel: cada parte XML, con la fecha del pie igualada (el ZIP en sí no: comprime distinto);
//   - historial.txt byte a byte, pabellones.json como datos y lo que se escribe por consola;
//   - que las marcas de tiempo (DTSTAMP, SEQUENCE, "actualizados el", "generado") son las de la hora
//     de la ejecución, en UTC o en hora de Galicia según corresponda.
//
// La versión en JavaScript se ejecuta además con otras zonas horarias (--zonas; por defecto UTC y
// America/New_York): el resultado tiene que ser el mismo sea cual sea la zona del equipo.
//
// Opciones:
//   --temporada, --desde, --hasta, --club, --duracion-minutos, --sin-equipos, --listar-clubs
//                    Se pasan a las dos versiones (al .ps1 como -Temporada, -Desde, -Hasta, -Club,
//                    -DuracionMinutos, -SinEquipos y -ListarClubs). Las dos usan siempre el nombre "calendario".
//   --zonas          Zonas horarias extra para la versión en JavaScript, separadas por comas ("" = ninguna).
//   --pabellones     pabellones.json de partida. "repo" (por defecto): el del repositorio en las dos.
//                    "vacio": ninguna tiene (las dos buscan todos los pabellones y rutas: muchas consultas).
//                    "compartido": JavaScript parte del que ha dejado PowerShell, así no repite las
//                    consultas de pabellones y rutas (útil con temporadas antiguas, que no están en caché).
//                    Las ejecuciones con otra zona horaria parten siempre del que ha dejado la primera
//                    de JavaScript, por lo mismo.
//   --carpeta        Dónde dejar las ejecuciones (por defecto, una carpeta nueva en la de temporales).
//   --reutilizar-ps  No vuelve a ejecutar PowerShell: usa la ejecución que ya hay en --carpeta y repite
//                    solo la de JavaScript (para probar un arreglo sin volver a descargarlo todo).
//   --solo-comparar  No ejecuta nada: vuelve a comparar las ejecuciones que ya hay en --carpeta.
//   --powershell     Ejecutable de PowerShell (por defecto powershell.exe en Windows y pwsh en el resto).
//
// Termina con código 0 si todo es igual y 1 si hay alguna diferencia. Necesita Node 20.15 o posterior
// (zlib.crc32) y PowerShell: Windows PowerShell 5.1 o pwsh 7 (--powershell pwsh, también en Linux).
//
// La referencia es pwsh 7, el que usa GitHub Actions. Windows PowerShell 5.1 ordena los empates de
// Sort-Object de otra manera (2 empatados salen al revés; 4, como 3,4,1,2), y eso se nota en tres sitios:
//   - pabellones de la federación con el mismo nombre: se admite (ver igualarEmpatesIdCampo);
//   - un equipo con los mismos partidos en dos categorías (Get-Equipos se queda con la primera tras
//     Sort-Object Count -Descending): con 5.1 puede salir con la otra categoría, en la página, en su
//     .ics y en el orden de los equipos;
//   - un pabellón escrito con distintas mayúsculas en dos partidos (Sort-Object -Unique se queda con uno):
//     con 5.1, la clave de "pabs" en los datos de la página puede ser la otra forma del nombre.
// Son FAIL de 5.1, no de src/ (src/ hace lo que pwsh 7 con listas cortas): compruébalo con
// --powershell pwsh antes de cambiar nada.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';
// Sin "import { crc32 }": en Node 20.0-20.14 no existe y el archivo no se podría ni cargar (también lo
// carga "npm test", porque está en test/).
import zlib from 'node:zlib';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOMBRE_BASE = 'calendario';
const MARCA_DATOS = '<script id="datos" type="application/json">';
const BOM = String.fromCharCode(0xFEFF);

// Opciones que se pasan a las dos versiones: nombre en src/main.js y parámetro del .ps1.
const OPCIONES_COMUNES = [
  ['temporada', '-Temporada'], ['desde', '-Desde'], ['hasta', '-Hasta'], ['club', '-Club'],
  ['duracion-minutos', '-DuracionMinutos'],
];
const INTERRUPTORES_COMUNES = [['sin-equipos', '-SinEquipos'], ['listar-clubs', '-ListarClubs']];

// Mensajes que cambian a propósito en la versión en JavaScript (opciones con otro nombre): se
// traducen en la salida de PowerShell antes de comparar.
const MENSAJES_CAMBIADOS = [
  ['Ejecuta sin -SinPreguntar o indica -Club.', 'Indica el club con --club.'],
  ['-ListarClubs', '--listar-clubs'],
];

// --- Ejecuciones -------------------------------------------------------------------------------

function copiarScriptPs(destino) {
  // Con fin de línea LF, como lo saca Git en GitHub Actions: la plantilla de la página es un
  // here-string y con CRLF (Windows con autocrlf) la página también saldría con CRLF.
  const texto = readFileSync(join(REPO, 'calendario-voley.ps1'));
  writeFileSync(join(destino, 'calendario-voley.ps1'), texto.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

// Carpeta limpia con config.json y, si se indica, el pabellones.json de partida. De este se guarda
// una copia (pabellones-inicial.json, vacía si no hay) para saber después si se ha reescrito.
function prepararCarpeta(carpeta, pabellones) {
  rmSync(carpeta, { recursive: true, force: true });
  mkdirSync(carpeta, { recursive: true });
  copyFileSync(join(REPO, 'config.json'), join(carpeta, 'config.json'));
  if (pabellones) {
    copyFileSync(pabellones, join(carpeta, 'pabellones.json'));
    copyFileSync(pabellones, join(carpeta, 'pabellones-inicial.json'));
  } else {
    writeFileSync(join(carpeta, 'pabellones-inicial.json'), '');
  }
}

function leerSiExiste(ruta) { return existsSync(ruta) ? readFileSync(ruta) : null; }

// ConvertTo-Json de Windows PowerShell guarda pabellones.json con BOM.
function sinBom(texto) { return texto.startsWith(BOM) ? texto.slice(1) : texto; }

// JSON.parse que no interrumpe la comparación: devuelve { valor } o { error }.
function analizarJson(texto, que) {
  try {
    return { valor: JSON.parse(sinBom(texto)) };
  } catch (e) {
    return { error: `${que}: JSON no válido (${e.message})` };
  }
}

// Texto entre comillas simples para -Command. PowerShell también toma como comilla simple ‘ ’ ‚ ‛: se
// doblan igual que ' (si no, --club "O’Grove" rompería la orden).
function comillasPs(texto) { return `'${texto.replace(/['‘’‚‛]/g, '$&$&')}'`; }

function ejecutar(programa, args, carpeta, env = process.env) {
  const inicio = Date.now();
  const r = spawnSync(programa, args, {
    cwd: carpeta, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60 * 1000, windowsHide: true,
  });
  if (r.error) throw new Error(`No se pudo ejecutar ${programa}: ${r.error.message}`);
  const ejecucion = {
    carpeta,
    salida: join(carpeta, 'salida'),
    // Carpeta de salida tal como sale en la consola ("Archivos generados en: ...").
    salidaImpresa: join(carpeta, 'salida'),
    codigo: r.status,
    consola: r.stdout.replace(/\r\n/g, '\n'),
    errores: r.stderr.replace(/\r\n/g, '\n'),
    inicio,
    fin: Date.now(),
  };
  writeFileSync(join(carpeta, 'ejecucion.json'), JSON.stringify(ejecucion, null, 2));
  return ejecucion;
}

function ejecutarPs(carpeta, powershell, comunes) {
  copiarScriptPs(carpeta);
  const salida = join(carpeta, 'salida');
  // Como -File, pero antes se pide la consola en UTF-8: con -File, Windows PowerShell escribe en la
  // página de códigos de la consola (850) y se pierden letras (–, €, emojis...).
  let orden = `& ${comillasPs(join(carpeta, 'calendario-voley.ps1'))} -SinPreguntar -Salida ${comillasPs(salida)}`
    + ` -NombreBase ${NOMBRE_BASE} -Historial ${comillasPs(join(salida, 'historial.txt'))}`;
  for (const [nombre, parametro] of OPCIONES_COMUNES) {
    if (comunes[nombre]) orden += ` ${parametro} ${comillasPs(comunes[nombre])}`;
  }
  for (const [nombre, parametro] of INTERRUPTORES_COMUNES) {
    if (comunes[nombre]) orden += ` ${parametro}`;
  }
  // pwsh 7 puede colorear Write-Host con secuencias ANSI: se piden en texto plano ($PSStyle no existe en 5.1).
  orden = '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false); '
    + `if ($PSStyle) { $PSStyle.OutputRendering = 'PlainText' }; ${orden}; exit $LASTEXITCODE`;
  // El .ps1 usa la hora local: en Linux (pwsh) hay que darle la de Galicia, como hace la tarea de GitHub.
  const env = { ...process.env, TZ: 'Europe/Madrid' };
  return ejecutar(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', orden], carpeta, env);
}

function entornoJs(zona) {
  const env = { ...process.env };
  if (zona) env.TZ = zona;
  return env;
}

// Zona horaria que ve Node con ese entorno (para comprobar que TZ se aplica de verdad).
function zonaEfectiva(zona) {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(Intl.DateTimeFormat().resolvedOptions().timeZone)'],
    { env: entornoJs(zona), encoding: 'utf8' });
  return r.stdout;
}

function ejecutarJs(carpeta, comunes, zona) {
  const salida = join(carpeta, 'salida');
  const args = [join(REPO, 'src', 'main.js'), '--config', join(carpeta, 'config.json'), '--salida', salida,
    '--nombre-base', NOMBRE_BASE, '--historial', join(salida, 'historial.txt')];
  for (const [nombre] of OPCIONES_COMUNES) {
    if (comunes[nombre]) args.push(`--${nombre}`, comunes[nombre]);
  }
  for (const [nombre] of INTERRUPTORES_COMUNES) {
    if (comunes[nombre]) args.push(`--${nombre}`);
  }
  return ejecutar(process.execPath, args, carpeta, entornoJs(zona));
}

function leerEjecucion(carpeta) {
  const archivo = join(carpeta, 'ejecucion.json');
  if (!existsSync(archivo)) throw new Error(`No hay ninguna ejecución guardada en ${carpeta}.`);
  // La carpeta puede haberse copiado o movido desde entonces.
  const guardada = JSON.parse(readFileSync(archivo, 'utf8'));
  return { salidaImpresa: guardada.salida, ...guardada, carpeta, salida: join(carpeta, 'salida') };
}

// --- Utilidades de comparación -----------------------------------------------------------------

function archivosDe(carpeta) {
  if (!existsSync(carpeta)) return [];
  return readdirSync(carpeta, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(carpeta, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

function recortar(texto, largo = 160) {
  const t = JSON.stringify(texto ?? '(no hay)');
  return t.length > largo ? `${t.slice(0, largo)}…` : t;
}

// Primera línea distinta de dos textos, para el informe.
function diferenciaLineas(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const i = la.findIndex((l, k) => l !== lb[k]);
  const n = i === -1 ? la.length : i;
  return `línea ${n + 1} distinta\n      ps1: ${recortar(la[n])}\n      js : ${recortar(lb[n])}`;
}

// Primer carácter distinto de dos textos de una sola línea (XML), con un poco de contexto.
function diferenciaTexto(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const desde = Math.max(0, i - 50);
  return `distinto a partir del carácter ${i}\n      ps1: ${recortar(a.slice(desde, i + 80))}`
    + `\n      js : ${recortar(b.slice(desde, i + 80))}`;
}

// Primera diferencia entre dos valores de JSON (sin tener en cuenta el orden de las claves).
function diferenciaJson(a, b, ruta) {
  if (isDeepStrictEqual(a, b)) return null;
  const objeto = (x) => x !== null && typeof x === 'object';
  if (!objeto(a) || !objeto(b) || Array.isArray(a) !== Array.isArray(b)) {
    return `${ruta}: ps1 ${recortar(a, 120)} / js ${recortar(b, 120)}`;
  }
  if (Array.isArray(a) && a.length !== b.length) return `${ruta}: ${a.length} elementos en ps1 y ${b.length} en js`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const dentro = Array.isArray(a) ? `${ruta}[${k}]` : `${ruta}.${k}`;
    if (!Object.hasOwn(a, k)) return `${dentro}: solo está en js`;
    if (!Object.hasOwn(b, k)) return `${dentro}: solo está en ps1`;
    const d = diferenciaJson(a[k], b[k], dentro);
    if (d) return d;
  }
  return null;
}

// Cuando la federación tiene varios pabellones con el mismo nombre (uno por pista, con la misma
// dirección y coordenadas), Find-Campos los ordena con Sort-Object y quedan empatados. src/ conserva
// el orden de la federación en los empates, como PowerShell 7 (el de GitHub) con listas cortas;
// Windows PowerShell 5.1 no, y puede quedarse con otra pista del mismo pabellón. Solo cambia
// id_campo, que no sale en ningún archivo: se admite si todo lo demás de la entrada es igual (y se
// dice en el informe).
function igualarEmpatesIdCampo(cachePs, cacheJs) {
  const empates = [];
  for (const [nombre, entradaPs] of Object.entries(cachePs)) {
    const entradaJs = Object.hasOwn(cacheJs, nombre) ? cacheJs[nombre] : null;
    if (!entradaPs || !entradaJs || entradaPs.id_campo === entradaJs.id_campo) continue;
    const { id_campo: idPs, ...restoPs } = entradaPs;
    const { id_campo: idJs, ...restoJs } = entradaJs;
    if (!isDeepStrictEqual(restoPs, restoJs)) continue;
    empates.push(`«${nombre}» ${idPs} en ps1 y ${idJs} en js`);
    entradaJs.id_campo = idPs;
  }
  return empates;
}

// --- Marcas de tiempo --------------------------------------------------------------------------

const RELOJ_MADRID = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',
});

// Hora de Galicia de un instante, como "aaaaMMddHHmm" (para comparar con los textos de la salida).
function minutoMadrid(ms) {
  const p = Object.fromEntries(RELOJ_MADRID.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
}

// "dd/MM/yyyy HH:mm" -> "aaaaMMddHHmm"
function minutoTexto(texto) {
  const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d)$/.exec(texto);
  return m ? `${m[3]}${m[2]}${m[1]}${m[4]}${m[5]}` : null;
}

// "actualizados el dd/MM/yyyy HH:mm" puede quedar partido por un pliegue de línea del .ics ("\r\n "):
// se busca admitiendo un pliegue entre cualquier par de caracteres.
const ATOMOS_ACTUALIZADO = [...'actualizados el '].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .concat([...'dd/dd/dddd dd:dd'].map((c) => (c === 'd' ? '\\d' : c)));
const RE_ACTUALIZADO = new RegExp(ATOMOS_ACTUALIZADO.join('(?:\\r\\n )?'), 'g');
const RE_GENERADO_XLSX = /generado el \d\d\/\d\d\/\d{4} \d\d:\d\d/g;
const RE_MARCA_ICS = /^(DTSTAMP|LAST-MODIFIED|SEQUENCE):.*$/;

function igualarActualizado(texto) { return texto.replace(RE_ACTUALIZADO, (m) => m.replace(/\d/g, '#')); }

function sinMarcasIcs(texto) {
  return texto.split('\r\n').filter((l) => !RE_MARCA_ICS.test(l)).join('\r\n');
}

// Comprueba que las marcas de tiempo de una ejecución son las de la hora en que se hizo.
function comprobarMarcas(ejecucion, icsArchivos, datosHtml, hoja) {
  const problemas = [];
  const desdeMin = minutoMadrid(ejecucion.inicio);
  const hastaMin = minutoMadrid(ejecucion.fin);
  const sellos = new Set();
  const secuencias = new Set();
  const actualizados = new Set();
  for (const texto of icsArchivos) {
    for (const l of texto.split('\r\n')) {
      if (l.startsWith('DTSTAMP:') || l.startsWith('LAST-MODIFIED:')) sellos.add(l.slice(l.indexOf(':') + 1));
      if (l.startsWith('SEQUENCE:')) secuencias.add(l.slice(9));
    }
    for (const m of texto.replace(/\r\n /g, '').matchAll(RE_ACTUALIZADO)) actualizados.add(m[0].slice(-16));
  }
  if (sellos.size > 1) problemas.push(`DTSTAMP/LAST-MODIFIED distintos: ${[...sellos].join(', ')}`);
  for (const s of sellos) {
    const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(s);
    const ms = m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
    // DTSTAMP va en segundos enteros: se admite un segundo antes del inicio.
    if (!(ms >= ejecucion.inicio - 1000 && ms <= ejecucion.fin)) problemas.push(`DTSTAMP ${s} fuera de la hora de la ejecución (UTC)`);
    for (const q of secuencias) {
      if (String(Math.floor(ms / 60000)) !== q) problemas.push(`SEQUENCE ${q} no corresponde a DTSTAMP ${s}`);
    }
  }
  const generados = [...actualizados];
  if (datosHtml) generados.push(datosHtml.generado);
  const pie = hoja?.match(RE_GENERADO_XLSX);
  if (pie) generados.push(...pie.map((t) => t.slice(-16)));
  if (new Set(generados).size > 1) problemas.push(`"actualizados el"/"generado" distintos: ${[...new Set(generados)].join(', ')}`);
  for (const g of new Set(generados)) {
    const t = minutoTexto(g);
    if (!t || t < desdeMin || t > hastaMin) problemas.push(`"${g}" no es la hora de Galicia de la ejecución`);
  }
  return problemas;
}

// --- Excel -------------------------------------------------------------------------------------

// Partes de un ZIP (leídas del directorio central), descomprimidas y con su CRC comprobado.
function leerZip(datos) {
  let fin = datos.length - 22;
  while (fin >= 0 && datos.readUInt32LE(fin) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error('no es un archivo ZIP');
  const total = datos.readUInt16LE(fin + 10);
  let pos = datos.readUInt32LE(fin + 16);
  const partes = [];
  for (let i = 0; i < total; i++) {
    if (datos.readUInt32LE(pos) !== 0x02014b50) throw new Error('directorio central del ZIP dañado');
    const metodo = datos.readUInt16LE(pos + 10);
    const crc = datos.readUInt32LE(pos + 16);
    const comprimido = datos.readUInt32LE(pos + 20);
    const largoNombre = datos.readUInt16LE(pos + 28);
    const largoExtra = datos.readUInt16LE(pos + 30);
    const largoComentario = datos.readUInt16LE(pos + 32);
    const local = datos.readUInt32LE(pos + 42);
    const nombre = datos.toString('utf8', pos + 46, pos + 46 + largoNombre);
    const inicio = local + 30 + datos.readUInt16LE(local + 26) + datos.readUInt16LE(local + 28);
    const bruto = datos.subarray(inicio, inicio + comprimido);
    const contenido = metodo === 8 ? zlib.inflateRawSync(bruto) : Buffer.from(bruto);
    if (zlib.crc32(contenido) !== crc) throw new Error(`CRC incorrecto en ${nombre}`);
    partes.push({ nombre, contenido });
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return partes;
}

// --- Comparación de una ejecución de JavaScript con la de PowerShell ----------------------------

function compararEjecuciones(ps, js) {
  const resultados = [];
  const anotar = (artefacto, fallo, nota = '') => resultados.push({ artefacto, fallo, nota });
  const leerTexto = (ej, archivo) => readFileSync(join(ej.salida, archivo), 'utf8');

  // Lista de archivos
  const archivosPs = archivosDe(ps.salida);
  const archivosJs = archivosDe(js.salida);
  const soloPs = archivosPs.filter((f) => !archivosJs.includes(f));
  const soloJs = archivosJs.filter((f) => !archivosPs.includes(f));
  anotar('archivos generados', soloPs.length || soloJs.length
    ? `solo en ps1: ${soloPs.join(', ') || '-'}; solo en js: ${soloJs.join(', ') || '-'}` : null,
  `${archivosPs.length} archivos`);
  const comunes = archivosPs.filter((f) => archivosJs.includes(f));

  // Consola y código de salida
  const traducir = (texto) => MENSAJES_CAMBIADOS.reduce((t, [de, a]) => t.split(de).join(a), texto);
  const consolaPs = traducir(ps.consola.split(ps.salidaImpresa).join('<salida>'));
  const consolaJs = js.consola.split(js.salidaImpresa).join('<salida>');
  let falloConsola = null;
  if (ps.codigo !== js.codigo) falloConsola = `código de salida ${ps.codigo} en ps1 y ${js.codigo} en js`;
  else if (consolaPs !== consolaJs) falloConsola = diferenciaLineas(consolaPs, consolaJs);
  else if (ps.errores.trim() !== js.errores.trim()) falloConsola = `errores distintos: ${diferenciaLineas(ps.errores, js.errores)}`;
  const proximos = consolaJs.split('\n').filter((l) => /^ {2}(lun|mar|mié|jue|vie|sáb|dom) \d\d\/\d\d /.test(l)).length;
  anotar('consola (resumen y próximos partidos)', falloConsola, `${proximos} próximos partidos`);

  // Calendarios .ics
  const ics = comunes.filter((f) => f.endsWith('.ics'));
  for (const f of ics) {
    const bytesPs = readFileSync(join(ps.salida, f));
    const bytesJs = readFileSync(join(js.salida, f));
    const a = bytesPs.toString('utf8');
    const b = bytesJs.toString('utf8');
    let fallo = null;
    if (!Buffer.from(b, 'utf8').equals(bytesJs) || b.startsWith(BOM) !== a.startsWith(BOM)) {
      fallo = 'codificación distinta (UTF-8 sin BOM)';
    } else {
      const plegadoPs = igualarActualizado(sinMarcasIcs(a));
      const plegadoJs = igualarActualizado(sinMarcasIcs(b));
      const desplegar = (t) => t.replace(/\r\n /g, '');
      const lineas = (t) => t.replace(/\r\n/g, '\n');
      if (desplegar(plegadoPs) !== desplegar(plegadoJs)) {
        fallo = `contenido: ${diferenciaLineas(lineas(desplegar(plegadoPs)), lineas(desplegar(plegadoJs)))}`;
      } else if (plegadoPs !== plegadoJs) {
        fallo = `plegado de líneas: ${diferenciaLineas(lineas(plegadoPs), lineas(plegadoJs))}`;
      }
    }
    anotar(f, fallo, `${(a.match(/^BEGIN:VEVENT/gm) ?? []).length} partidos`);
  }

  // Página
  let datosPs = null;
  let datosJs = null;
  const html = `${NOMBRE_BASE}.html`;
  const partir = (texto) => {
    const i = texto.indexOf(MARCA_DATOS);
    const j = texto.indexOf('</script>', i);
    if (i < 0 || j < 0) return null;
    const desde = i + MARCA_DATOS.length;
    return { plantilla: texto.slice(0, desde) + texto.slice(j), json: texto.slice(desde, j) };
  };
  const paginaPs = comunes.includes(html) ? partir(leerTexto(ps, html)) : null;
  const paginaJs = comunes.includes(html) ? partir(leerTexto(js, html)) : null;
  if (comunes.includes(html) && (!paginaPs || !paginaJs)) {
    anotar(html, `sin los datos embebidos en ${paginaPs ? 'js' : 'ps1'}`);
  } else if (paginaPs && paginaJs) {
    const a = analizarJson(paginaPs.json, 'ps1');
    const b = analizarJson(paginaJs.json, 'js');
    if (a.error || b.error) {
      anotar(`${html} (datos)`, a.error ?? b.error);
    } else {
      datosPs = a.valor;
      datosJs = b.valor;
      const sinGenerado = ({ generado, ...resto }) => resto;
      // Lo que solo tiene la versión en JavaScript no se compara (datosJs sigue entero para comprobarMarcas).
      const comunConPs = ({ generado, corto, clas, escudo, app, ...resto }) => ({
        ...resto, partidos: resto.partidos?.map(({ r, wa, ...p }) => p),
      });
      const d = diferenciaJson(sinGenerado(datosPs), comunConPs(datosJs), 'datos');
      const mismoOrden = JSON.stringify(sinGenerado(datosPs)) === JSON.stringify(comunConPs(datosJs));
      anotar(`${html} (datos)`, d, `${datosPs.partidos?.length} partidos, ${datosPs.equipos?.length} equipos`
        + (d || mismoOrden ? '' : '; mismo contenido con las claves en otro orden'));
    }
  }

  // Excel
  let hojaPs = null;
  let hojaJs = null;
  const xlsx = `${NOMBRE_BASE}.xlsx`;
  if (comunes.includes(xlsx)) {
    let partesPs;
    let partesJs;
    try {
      partesPs = leerZip(readFileSync(join(ps.salida, xlsx)));
      partesJs = leerZip(readFileSync(join(js.salida, xlsx)));
    } catch (e) {
      anotar(xlsx, `no se puede leer: ${e.message}`);
    }
    if (partesPs && partesJs) {
      const nombres = (partes) => partes.map((p) => p.nombre).join(', ');
      anotar(`${xlsx} (partes)`, nombres(partesPs) === nombres(partesJs) ? null
        : `ps1: ${nombres(partesPs)}\n      js : ${nombres(partesJs)}`, `${partesPs.length} partes`);
      for (const parte of partesPs) {
        const otra = partesJs.find((p) => p.nombre === parte.nombre);
        if (!otra) continue;
        const a = parte.contenido.toString('utf8');
        const b = otra.contenido.toString('utf8');
        if (parte.nombre === 'xl/worksheets/sheet1.xml') { hojaPs = a; hojaJs = b; }
        const igualar = (t) => t.replace(RE_GENERADO_XLSX, 'generado el ##/##/#### ##:##');
        anotar(`${xlsx}: ${parte.nombre}`, igualar(a) === igualar(b) ? null : diferenciaTexto(igualar(a), igualar(b)));
      }
    }
  }

  // Historial
  if (comunes.includes('historial.txt')) {
    const a = readFileSync(join(ps.salida, 'historial.txt'));
    const b = readFileSync(join(js.salida, 'historial.txt'));
    anotar('historial.txt', a.equals(b) ? null : diferenciaLineas(a.toString('utf8'), b.toString('utf8')),
      `${a.toString('utf8').split('\n').length - 3} partidos`);
  }

  // pabellones.json: mismos datos (el formato del archivo cambia: ConvertTo-Json frente a JSON.stringify).
  const cachePs = leerSiExiste(join(ps.carpeta, 'pabellones.json'));
  const cacheJs = leerSiExiste(join(js.carpeta, 'pabellones.json'));
  if (cachePs || cacheJs) {
    let fallo = null;
    let nota = '';
    const a = cachePs && analizarJson(cachePs.toString('utf8'), 'ps1');
    const b = cacheJs && analizarJson(cacheJs.toString('utf8'), 'js');
    if (!a || !b) {
      fallo = `solo existe en ${a ? 'ps1' : 'js'}`;
    } else if (a.error || b.error) {
      fallo = a.error ?? b.error;
    } else {
      const empates = igualarEmpatesIdCampo(a.valor, b.valor);
      fallo = diferenciaJson(a.valor, b.valor, 'pabellones');
      const inicialPs = readFileSync(join(ps.carpeta, 'pabellones-inicial.json'));
      const inicialJs = readFileSync(join(js.carpeta, 'pabellones-inicial.json'));
      const cambioPs = !inicialPs.equals(cachePs);
      const cambioJs = !inicialJs.equals(cacheJs);
      const estado = (cambio) => (cambio ? 'lo ha actualizado' : 'no lo ha cambiado');
      nota = `${Object.keys(a.valor).length} pabellones; ps1 ${estado(cambioPs)}, js ${estado(cambioJs)}`;
      if (empates.length) {
        nota += '; id_campo distinto, con todo lo demás igual (empate entre pabellones de la federación con el'
          + ` mismo nombre): ${empates.join('; ')}`;
      }
      // Si partían del mismo archivo, los dos tienen que haberlo reescrito (o no) a la vez. Si js
      // partía del que ya había dejado otra ejecución, no tiene nada que añadir.
      if (!fallo && inicialPs.equals(inicialJs) && cambioPs !== cambioJs) fallo = `solo ${cambioPs ? 'ps1' : 'js'} lo ha reescrito`;
      if (!fallo && !inicialPs.equals(inicialJs) && cambioJs) fallo = 'js lo ha reescrito aunque partía de uno ya al día';
    }
    anotar('pabellones.json (datos)', fallo, nota);
  }

  // Marcas de tiempo de las dos ejecuciones
  const icsDe = (ej) => ics.map((f) => readFileSync(join(ej.salida, f), 'utf8'));
  const marcasPs = comprobarMarcas(ps, icsDe(ps), datosPs, hojaPs);
  const marcasJs = comprobarMarcas(js, icsDe(js), datosJs, hojaJs);
  const marcas = [...marcasPs.map((m) => `ps1: ${m}`), ...marcasJs.map((m) => `js: ${m}`)];
  anotar('marcas de tiempo (UTC y hora de Galicia)', marcas.length ? marcas.join('\n      ') : null);

  return resultados;
}

// --- Programa principal ------------------------------------------------------------------------

function leerOpciones(args) {
  const opcionesComunes = Object.fromEntries([
    ...OPCIONES_COMUNES.map(([nombre]) => [nombre, { type: 'string' }]),
    ...INTERRUPTORES_COMUNES.map(([nombre]) => [nombre, { type: 'boolean' }]),
  ]);
  const { values } = parseArgs({
    args,
    options: {
      ...opcionesComunes,
      zonas: { type: 'string', default: 'UTC,America/New_York' },
      pabellones: { type: 'string', default: 'repo' },
      carpeta: { type: 'string', default: '' },
      'reutilizar-ps': { type: 'boolean', default: false },
      'solo-comparar': { type: 'boolean', default: false },
      powershell: { type: 'string', default: process.platform === 'win32' ? 'powershell.exe' : 'pwsh' },
    },
  });
  if (!['repo', 'vacio', 'compartido'].includes(values.pabellones)) {
    throw new Error(`--pabellones tiene que ser repo, vacio o compartido (no «${values.pabellones}»).`);
  }
  for (const opcion of ['reutilizar-ps', 'solo-comparar']) {
    if (values[opcion] && !values.carpeta) throw new Error(`--${opcion} necesita --carpeta con una ejecución anterior.`);
  }
  const sello = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return {
    comunes: Object.fromEntries(Object.keys(opcionesComunes).filter((k) => values[k]).map((k) => [k, values[k]])),
    zonas: values.zonas.split(',').map((z) => z.trim()).filter(Boolean),
    pabellones: values.pabellones,
    carpeta: resolve(values.carpeta || join(tmpdir(), 'paridad-calendario', sello)),
    reutilizarPs: values['reutilizar-ps'],
    soloComparar: values['solo-comparar'],
    powershell: values.powershell,
  };
}

function segundos(ej) { return `${((ej.fin - ej.inicio) / 1000).toFixed(1)} s`; }

function principal(args) {
  if (typeof zlib.crc32 !== 'function') throw new Error('Hace falta Node 20.15 o posterior (zlib.crc32).');
  const opciones = leerOpciones(args);
  const { carpeta, comunes } = opciones;
  const pedidas = Object.entries(comunes).map(([k, v]) => (v === true ? `--${k}` : `--${k} ${v}`)).join(' ');
  console.log(`Paridad de src/ con calendario-voley.ps1${pedidas ? ` (${pedidas})` : ''}`);
  console.log(`  Carpeta: ${carpeta}`);
  mkdirSync(carpeta, { recursive: true });

  // pabellones.json de partida (se guarda una copia: con --reutilizar-ps se parte de la misma)
  const delRepo = join(carpeta, 'pabellones-repo.json');
  if (!opciones.reutilizarPs && !opciones.soloComparar) copyFileSync(join(REPO, 'pabellones.json'), delRepo);
  const dePartida = opciones.pabellones === 'vacio' ? null : delRepo;

  // PowerShell
  const carpetaPs = join(carpeta, 'ps');
  let ps;
  if (opciones.reutilizarPs || opciones.soloComparar) {
    ps = leerEjecucion(carpetaPs);
    console.log(`  PowerShell: se reutiliza la ejecución anterior (código ${ps.codigo}).`);
  } else {
    prepararCarpeta(carpetaPs, dePartida);
    console.log(`  Ejecutando calendario-voley.ps1 con ${opciones.powershell}...`);
    ps = ejecutarPs(carpetaPs, opciones.powershell, comunes);
    console.log(`    código ${ps.codigo}, ${segundos(ps)}`);
  }

  // JavaScript: primero con la zona horaria del equipo y luego con las de --zonas. Las de otra zona
  // parten del pabellones.json que ha dejado la primera, para no repetir consultas.
  const cachePs = join(carpetaPs, 'pabellones.json');
  let partida = opciones.pabellones === 'compartido' && existsSync(cachePs) ? cachePs : dePartida;
  const ejecuciones = [];
  let fallos = 0;
  for (const zona of [null, ...opciones.zonas]) {
    const carpetaJs = join(carpeta, zona ? `js-${zona.replace(/[^A-Za-z0-9]+/g, '_')}` : 'js');
    const titulo = zona ? `JavaScript con TZ=${zona}` : 'JavaScript';
    let js;
    if (opciones.soloComparar) {
      js = leerEjecucion(carpetaJs);
    } else {
      const efectiva = zonaEfectiva(zona);
      if (zona && efectiva !== zona) {
        console.log(`  FAIL  Node no aplica TZ=${zona} (ve la zona «${efectiva}»): no se prueba esa zona.`);
        fallos++;
        continue;
      }
      prepararCarpeta(carpetaJs, partida);
      console.log(`  Ejecutando src/main.js (zona horaria ${efectiva})...`);
      js = ejecutarJs(carpetaJs, comunes, zona);
      console.log(`    código ${js.codigo}, ${segundos(js)}`);
    }
    ejecuciones.push({ titulo, js });
    if (!zona && existsSync(join(carpetaJs, 'pabellones.json'))) partida = join(carpetaJs, 'pabellones.json');
  }

  // Informe
  for (const { titulo, js } of ejecuciones) {
    console.log('');
    console.log(`== ${titulo} frente a PowerShell ==`);
    for (const r of compararEjecuciones(ps, js)) {
      if (r.fallo) fallos++;
      console.log(`  ${r.fallo ? 'FAIL' : 'PASS'}  ${r.artefacto}${r.nota ? ` (${r.nota})` : ''}`);
      if (r.fallo) console.log(`      ${r.fallo}`);
    }
  }
  if (ps.codigo !== 0) console.log(`\n  PowerShell ha terminado con error:\n${ps.consola}${ps.errores}`);
  console.log('');
  console.log(fallos ? `RESULTADO: FAIL (${fallos} diferencias)` : 'RESULTADO: PASS (todo igual)');
  return fallos ? 1 : 0;
}

// "node --test" también encuentra este archivo (está en test/): lo ejecuta aparte (con NODE_TEST_CONTEXT)
// o, con --test-isolation=none, en su propio proceso (con --test). Entonces no se compara nada, porque
// necesita PowerShell y descarga de la federación: solo se anota como prueba omitida.
const conPruebas = Boolean(process.env.NODE_TEST_CONTEXT) || process.execArgv.includes('--test');

// ¿Se ha llamado directamente ("node test/paridad/comparar.mjs")?
function esPrograma() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (conPruebas) {
  const { test } = await import('node:test');
  test('paridad con calendario-voley.ps1', { skip: 'se ejecuta aparte: node test/paridad/comparar.mjs' }, () => {});
} else if (esPrograma()) {
  try {
    process.exitCode = principal(process.argv.slice(2));
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    process.exitCode = 2;
  }
}
