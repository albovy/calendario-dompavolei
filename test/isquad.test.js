// Pruebas de peticion (src/isquad.js) sin red: fetch simulado, reintentos, errores HTTP y de conexión.
// El reloj va simulado: las esperas de 2 y 4 s entre intentos no se esperan de verdad.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peticion } from '../src/isquad.js';
import { BOM } from '../src/util.js';

const URL_PARTIDOS = 'https://resultadosvoleibol.isquad.es/json/partidos_equipos_consultas.php';
const AVISO_2 = '  ! La web de la federación no responde; reintentando (2 de 3)...';
const AVISO_3 = '  ! La web de la federación no responde; reintentando (3 de 3)...';

// Ejecuta peticion con fetch simulado (responder(n) da la respuesta a la llamada n o lanza el error) y
// el reloj simulado. Devuelve { resultado, error, avisos, llamadas }.
async function simular(t, responder, ruta = 'json/partidos_equipos_consultas.php', datos = { accion: 'x' }) {
  const llamadas = [];
  const avisos = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones });
    return responder(llamadas.length);
  };
  const consola = t.mock.method(console, 'log', (texto) => avisos.push(texto));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let terminado = false;
    const promesa = peticion(ruta, datos);
    promesa.then(() => { terminado = true; }, () => { terminado = true; });
    while (!terminado) {
      await new Promise((seguir) => { setImmediate(seguir); });
      t.mock.timers.tick(1000);
    }
    const [resultado, error] = await promesa.then((r) => [r, null], (e) => [null, e]);
    return { resultado, error, avisos, llamadas };
  } finally {
    t.mock.timers.reset();
    consola.mock.restore();
    globalThis.fetch = original;
  }
}

function mensajeError(motivo) {
  return `No se pudo descargar ${URL_PARTIDOS}\n    (${motivo})\n    Comprueba la conexión a Internet y vuelve a intentarlo.`;
}

test('peticion: POST con el formulario o GET, y sin los BOM del principio', async (t) => {
  const post = await simular(t, () => new Response(`${BOM}${BOM}{"data":[]}`), 'json/x.php', { accion: 'obtener', id: '7' });
  assert.equal(post.resultado, '{"data":[]}');
  assert.equal(post.llamadas.length, 1);
  const { url, opciones } = post.llamadas[0];
  assert.equal(url, 'https://resultadosvoleibol.isquad.es/json/x.php');
  assert.equal(opciones.method, 'POST');
  assert.equal(String(opciones.body), 'accion=obtener&id=7');
  assert.equal(opciones.headers['User-Agent'], 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) calendario-voley/1.0');
  assert.deepEqual(post.avisos, []);

  const get = await simular(t, () => new Response('<html>'), 'listado_clubs.php?id_territorial=20', null);
  assert.equal(get.resultado, '<html>');
  assert.deepEqual([get.llamadas[0].opciones.method, get.llamadas[0].opciones.body], ['GET', undefined]);
});

test('peticion: si falla, avisa y lo vuelve a intentar (3 veces en total)', async (t) => {
  const bien = await simular(t, (n) => (n === 1 ? new Response('', { status: 503 }) : new Response('{"data":[1]}')));
  assert.equal(bien.resultado, '{"data":[1]}');
  assert.equal(bien.llamadas.length, 2);
  assert.deepEqual(bien.avisos, [AVISO_2]);

  const mal = await simular(t, () => new Response('x', { status: 500, statusText: 'Internal Server Error' }));
  assert.equal(mal.llamadas.length, 3);
  assert.deepEqual(mal.avisos, [AVISO_2, AVISO_3]);
  assert.equal(mal.error.message, mensajeError('respuesta 500 Internal Server Error'));
});

test('peticion: el motivo del error nunca queda vacío', async (t) => {
  const motivo = async (error) => {
    const { error: e } = await simular(t, () => { throw error; });
    return e.message;
  };
  // DNS: el motivo viene en "cause".
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND resultadosvoleibol.isquad.es'), { code: 'ENOTFOUND' });
  assert.equal(await motivo(new TypeError('fetch failed', { cause: dns })),
    mensajeError('getaddrinfo ENOTFOUND resultadosvoleibol.isquad.es'));
  // Con IPv4 e IPv6 fallan todas las direcciones: la causa es un AggregateError sin texto.
  const todas = Object.assign(new AggregateError([new Error('connect ECONNREFUSED ::1:443'), new Error('connect ECONNREFUSED 127.0.0.1:443')], ''),
    { code: 'ECONNREFUSED' });
  assert.equal(await motivo(new TypeError('fetch failed', { cause: todas })), mensajeError('connect ECONNREFUSED ::1:443'));
  const soloCodigo = Object.assign(new AggregateError([], ''), { code: 'ECONNRESET' });
  assert.equal(await motivo(new TypeError('fetch failed', { cause: soloCodigo })), mensajeError('ECONNRESET'));
  // Tiempo agotado (AbortSignal.timeout).
  assert.equal(await motivo(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    mensajeError('la web no ha respondido a tiempo'));
});
