// Service worker de la página instalada como app (main.js lo copia como sw.js junto a la página).
//
// Solo hace dos cosas, para que la app se vea también sin cobertura (en un pabellón, por ejemplo):
//   - La página: primero la red, siempre (con cobertura se ve la recién publicada). Si no hay red, o no
//     contesta en 4 s, o devuelve un error, enseña la última copia buena, marcada con data-sw-copia en
//     <html> para que la página avise («Sin conexión»). Si la red contesta después, avisa a la página
//     (sw-fresh) para que se recargue si había cambios.
//   - Las fuentes (fonts.bunny.net): se guardan para que la copia sin conexión se vea con su letra.
// La primera copia se guarda nada más instalarse (la visita que lo instala no pasa por él: sin esto, quien
// abre la app una vez y la siguiente ya está sin cobertura no tendría nada), y las fuentes de esa primera
// visita, cuando la página se las pasa (mensaje guardar-fuentes).
// salidas.html (la redirección de la dirección antigua) lleva a la página sin ir a la red.
// Todo lo demás (.ics, .xlsx, equipos/, lo de otras webs) va como siempre, sin pasar por aquí.
//
// Que no cambie entre publicaciones (cada cambio instala un service worker nuevo) ni de nombre: la versión
// solo se sube si cambia lo que hace. Para retirarlo, ver README («Instalar como app»).

const VERSION = 1;
const ALCANCE = self.registration.scope;                        // https://albovy.github.io/calendario-dompavolei/
// albovy.github.io lo comparten todas las webs de GitHub Pages del usuario: las cachés llevan la ruta de esta.
const PREFIJO = 'calendario' + new URL(ALCANCE).pathname + ':';
const CACHE_PAGINA = PREFIJO + 'pagina-v' + VERSION;
const CACHE_FUENTES = PREFIJO + 'fuentes-v' + VERSION;
const CLAVE = ALCANCE;                                          // una sola copia: la página
const ESPERA_MS = 4000;                                         // hasta las cabeceras de la respuesta
const PAGINA = new Set(['', 'index.html', 'calendario.html']);  // se guarda y se sirve
const REDIRIGE = new Set(['salidas.html']);                     // lleva a la página (como su redirección)
const FUENTES = 'https://fonts.bunny.net/';
const MAX_FUENTES = 30;

// fetch con un corte: una petición colgada no se queda abierta (retendría la de la misma página que venga
// después, hasta que el navegador se canse).
function pedirCon(url, opciones, ms) {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ms);
  return fetch(url, { ...opciones, signal: corte.signal }).finally(() => clearTimeout(reloj));
}

// Al instalarse, la primera copia de la página (sin esperar más de 10 s ni impedir la instalación si falla).
self.addEventListener('install', (evento) => {
  self.skipWaiting();
  evento.waitUntil(pedirCon(ALCANCE, { cache: 'no-cache', redirect: 'manual' }, 10000)
    .then((r) => (buena(r) ? guardar(r) : null)).catch(() => null));
});

// La página pasa las fuentes que cargó antes de que el service worker existiera: se guardan las que falten.
self.addEventListener('message', (evento) => {
  const m = evento.data || {};
  if (m.type !== 'guardar-fuentes' || !Array.isArray(m.urls)) return;
  const urls = m.urls.filter((u) => typeof u === 'string' && u.startsWith(FUENTES)).slice(0, MAX_FUENTES);
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE_FUENTES);
    for (const url of urls) {
      try {
        if (await cache.match(url, { ignoreVary: true })) continue;
        const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (r.ok && r.type === 'cors') await cache.put(url, r);
      } catch (e) { /* sin red: ya se guardarán en la siguiente visita */ }
    }
  })());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    // Sin «navigation preload»: pediría la página a la caché HTTP (hasta 10 min de antigüedad).
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { /* no importa */ }
    }
    const nombres = await caches.keys();
    const actuales = [CACHE_PAGINA, CACHE_FUENTES];
    await Promise.all(nombres.filter((n) => n.startsWith(PREFIJO) && !actuales.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Solo se guarda una página buena: 200, de este sitio, sin redirecciones y HTML.
const buena = (r) => r.status === 200 && r.type === 'basic' && !r.redirected &&
  (r.headers.get('content-type') || '').includes('text/html');

// Guarda la página y dice si ha cambiado respecto a la copia anterior (ETag o Last-Modified de GitHub).
async function guardar(r) {
  const cache = await caches.open(CACHE_PAGINA);
  const antes = await cache.match(CLAVE);
  const cambiada = !antes || antes.headers.get('etag') !== r.headers.get('etag') ||
    antes.headers.get('last-modified') !== r.headers.get('last-modified');
  await cache.put(CLAVE, r);
  return cambiada;
}

// La copia guardada, marcada para que la página sepa que no es la de la red.
async function copia() {
  const r = await (await caches.open(CACHE_PAGINA)).match(CLAVE);
  if (!r) return null;
  const html = (await r.text()).replace(/<html\b/i, '<html data-sw-copia=""');
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Sin copia y sin red. Se vuelve a intentar sola (cada 30 s, al volver la red o a la app) y con un botón: en
// la app del iPhone no hay botón de recargar.
const SIN_CONEXION = '<!DOCTYPE html><html lang="es"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="30">' +
  '<title>Sin conexión</title><div style="font:17px/1.4 system-ui, sans-serif; padding:16px">' +
  '<p>Sin conexión. El calendario se abrirá en cuanto haya cobertura.</p>' +
  '<p><button type="button" onclick="location.reload()" style="font:inherit; padding:10px 18px">Reintentar</button></p></div>' +
  '<script>addEventListener("online", function () { location.reload(); });' +
  'document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") location.reload(); });</script></html>';
const sinConexion = () => new Response(SIN_CONEXION, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function avisar(cambiada) {
  const ventanas = await self.clients.matchAll({ type: 'window' });
  ventanas.forEach((v) => v.postMessage({ type: 'sw-fresh', changed: cambiada }));
}

// Fuentes: la hoja de estilos se sirve de la caché y se renueva por detrás; los archivos de letra, de la
// caché si están (no cambian). Solo respuestas CORS buenas (la hoja se pide con crossorigin).
async function fuente(evento) {
  const cache = await caches.open(CACHE_FUENTES);
  const guardada = await cache.match(evento.request, { ignoreVary: true });
  const deLaRed = () => fetch(evento.request).then((r) => {
    if (r.ok && (r.type === 'cors' || r.type === 'basic')) return cache.put(evento.request, r.clone()).then(() => r);
    return r;
  });
  if (!guardada) return deLaRed();
  if (/\/css\b/.test(new URL(evento.request.url).pathname)) evento.waitUntil(deLaRed().catch(() => null));
  return guardada;
}

self.addEventListener('fetch', (evento) => {
  const pet = evento.request;
  if (pet.method !== 'GET') return;
  if (pet.url.startsWith(FUENTES)) { evento.respondWith(fuente(evento)); return; }
  if (pet.mode !== 'navigate' || !pet.url.startsWith(ALCANCE)) return;
  const ruta = new URL(pet.url).pathname.slice(new URL(ALCANCE).pathname.length);
  if (REDIRIGE.has(ruta)) { evento.respondWith(Response.redirect(ALCANCE, 302)); return; }
  if (!PAGINA.has(ruta)) return;                                // .ics, .xlsx, equipos/...: como siempre

  let guardado = null;                                          // promesa de «¿ha cambiado?» al guardar
  let servidaCopia = false;
  // 'no-cache': siempre se pregunta a GitHub (con el ETag, un 304 cuesta poco), nunca la caché HTTP de
  // 10 minutos. 'manual': una redirección llega como opaqueredirect, que se entrega pero no se guarda.
  const red = pedirCon(pet.url, { cache: 'no-cache', redirect: 'manual' }, 30000).then((r) => {
    if (buena(r)) guardado = guardar(r.clone());               // clonar antes de que la página lea el cuerpo
    return r;
  });

  evento.respondWith((async () => {
    let reloj;
    const primero = await Promise.race([
      red.then((r) => ({ r }), () => ({ fallo: true })),
      new Promise((listo) => { reloj = setTimeout(listo, ESPERA_MS, { tarde: true }); }),
    ]);
    clearTimeout(reloj);
    const vale = (r) => r.ok || r.type === 'opaqueredirect';
    if (primero.r && vale(primero.r)) return primero.r;          // la de la red
    const c = await copia().catch(() => null);                  // sin red, tarde, 404 o 5xx
    if (c) { servidaCopia = true; return c; }
    // Sin copia: a esperar a la red; si falla o da un error, «Sin conexión», que se vuelve a intentar sola (la
    // página de error de la web se quedaría ahí aunque la web se arreglara).
    if (primero.tarde) return red.then((r) => (vale(r) ? r : sinConexion()), sinConexion);
    return sinConexion();
  })());

  // Hasta guardar la página de la red; si se enseñó la copia, se avisa a la página.
  evento.waitUntil(red.then(() => guardado, () => null)
    .then((cambiada) => { if (servidaCopia && cambiada !== null) return avisar(cambiada); })
    .catch(() => {}));
});
