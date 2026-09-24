// ZIP mínimo para el .xlsx, sin dependencias: por cada archivo, su cabecera local y los datos
// comprimidos con deflate; después, el directorio central y el registro final.
// Formato: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (sin ZIP64 ni cifrado).

import { deflateRawSync } from 'node:zlib';

const FIRMA_LOCAL = 0x04034B50;
const FIRMA_CENTRAL = 0x02014B50;
const FIRMA_FINAL = 0x06054B50;
const VERSION = 20;        // 2.0: la mínima que admite deflate
const DEFLATE = 8;
const NOMBRE_UTF8 = 0x0800; // bit 11: el nombre del archivo va en UTF-8

// Fecha de los archivos si no se indica otra: la mínima de MS-DOS (01/01/1980 00:00).
const FECHA_FIJA = new Date(Date.UTC(1980, 0, 1));

// Tabla del CRC-32 de ZIP (polinomio 0xEDB88320).
const TABLA_CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

export function crc32(datos) {
  let c = 0xFFFFFFFF;
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Fecha y hora de MS-DOS (hora local, con segundos pares) a partir de un Date de pared.
function fechaDos(d) {
  const anio = Math.min(Math.max(d.getUTCFullYear(), 1980), 2107);
  return {
    fecha: ((anio - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    hora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}

// Escribe los campos [bytes, valor] seguidos, en little-endian.
function campos(lista) {
  const buf = Buffer.alloc(lista.reduce((total, [bytes]) => total + bytes, 0));
  let pos = 0;
  for (const [bytes, valor] of lista) {
    if (bytes === 2) buf.writeUInt16LE(valor, pos);
    else buf.writeUInt32LE(valor, pos);
    pos += bytes;
  }
  return buf;
}

// entradas: [{ nombre, contenido }], en el orden en que se guardan. Un contenido de texto se guarda
// en UTF-8 sin BOM. fecha: Date de pared para la fecha de los archivos (opcional).
export function crearZip(entradas, fecha = FECHA_FIJA) {
  const dos = fechaDos(fecha);
  const partes = [];
  const directorio = [];
  let posicion = 0;
  for (const { nombre, contenido } of entradas) {
    const datos = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, 'utf8');
    const comprimidos = deflateRawSync(datos);
    const bytesNombre = Buffer.from(nombre, 'utf8');
    // Campos comunes a la cabecera local y a la del directorio central.
    const comunes = [
      [2, VERSION],
      [2, bytesNombre.length === nombre.length ? 0 : NOMBRE_UTF8],
      [2, DEFLATE],
      [2, dos.hora],
      [2, dos.fecha],
      [4, crc32(datos)],
      [4, comprimidos.length],
      [4, datos.length],
      [2, bytesNombre.length],
      [2, 0],               // campo extra: no hay
    ];
    const local = Buffer.concat([campos([[4, FIRMA_LOCAL], ...comunes]), bytesNombre]);
    directorio.push(campos([
      [4, FIRMA_CENTRAL],
      [2, VERSION],         // versión que lo creó (MS-DOS, 2.0)
      ...comunes,
      [2, 0],               // comentario: no hay
      [2, 0],               // disco donde empieza
      [2, 0],               // atributos internos
      [4, 0],               // atributos externos
      [4, posicion],        // dónde empieza su cabecera local
    ]), bytesNombre);
    partes.push(local, comprimidos);
    posicion += local.length + comprimidos.length;
  }
  const central = Buffer.concat(directorio);
  const final = campos([
    [4, FIRMA_FINAL],
    [2, 0],                 // número de este disco
    [2, 0],                 // disco donde empieza el directorio central
    [2, entradas.length],   // entradas en este disco
    [2, entradas.length],   // entradas en total
    [4, central.length],
    [4, posicion],          // dónde empieza el directorio central
    [2, 0],                 // comentario: no hay
  ]);
  return Buffer.concat([...partes, central, final]);
}
