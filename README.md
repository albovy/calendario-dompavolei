# Calendario de partidos de Dompavolei

Partidos de todos los equipos de **DOMPAVOLEI** (voleibol, Galicia), sacados de la
[agenda de la Federación Galega de Voleibol](https://volei.gal/competiciones/) y
actualizados automáticamente cada hora (de 8:00 a 23:00).

- **Página con los partidos:** https://albovy.github.io/calendario-dompavolei/
- **Calendario para suscribirse** (Google Calendar, iPhone, Outlook):
  `https://albovy.github.io/calendario-dompavolei/calendario.ics`
  (en la página hay un botón «Suscribirse» y los enlaces de cada equipo)

## Cómo funciona

`src/main.js` (Node.js 20 o posterior, sin dependencias) descarga los partidos publicados en
la federación, se queda con los del club indicado en `config.json` (ID 206572580) y genera la
página (plantilla `src/plantilla.html`, con el escudo del club, `escudo.png`, dentro), el `.ics`, un Excel y un `.ics` por equipo. La tarea `.github/workflows/calendario.yml`
lo ejecuta y publica el resultado en GitHub Pages. La carpeta `historial` guarda la lista de partidos cada vez que la federación cambia algo (su historial de cambios muestra qué cambió y cuándo).

Cada partido empieza en el calendario a la **hora de salida en bus desde Os Remedios** (partido − 1 h de calentamiento − viaje en bus: los km por carretera a 100 km/h, al alza; la salida, siempre a la hora en punto o a la media) o, en casa, a la hora de calentamiento. La hora del partido nunca se mueve: fuera, el calentamiento empieza al llegar (salida + viaje), así que lo que se gana al redondear la salida es calentamiento (y lo que se pierde si la salida es más tarde). Los partidos que aún no tienen hora ya salen «en casa» si se juegan en el pabellón del club. Los tiempos de viaje se guardan en `pabellones.json` y se pueden fijar a mano en `config.json`. Cada hora solo se descarga la temporada en curso; los partidos del club de la temporada anterior (para los equipos que aún no juegan y para agosto) se guardan una vez en `temporada-anterior.json`.

En los partidos ya jugados salen el **resultado** y los sets, y la pestaña **Clasificación** enseña la tabla
del grupo de cada equipo. Salen de la web de resultados de la federación (la misma que enseña volei.gal):
solo se consultan los grupos del club y solo cuando hace falta (un partido que acaba de jugarse, un repaso
diario), y se guardan en `resultados.json`. Nunca se descargan actas ni plantillas.

En los partidos por jugar, los botones **Copiar** y **WhatsApp** preparan un mensaje para el grupo de las
familias: día, salida y lugar, pabellón con mapa, calentamiento, partidos y vuelta aproximada.

### Instalar como app

La página se puede instalar en el móvil como una app: queda con el escudo en la pantalla de inicio (y en
el cajón de apps de Android) y se abre sin la barra del navegador. En el móvil sale un aviso bajo la barra,
que se puede cerrar; también está en **+ Calendario › Instalar como app**:

- **Android (Chrome):** botón **Instalar** del aviso, o menú ⋮ › «Instalar y crear acceso directo» › «Instalar».
- **iPhone (Safari):** Compartir (en iOS 26, primero «…») › «Añadir a pantalla de inicio» › «Añadir».
  La app del iPhone no comparte lo guardado con Safari: los equipos elegidos se eligen otra vez una vez.

Sin cobertura (en un pabellón, por ejemplo), la app enseña la última copia que vio, con un aviso
«Sin conexión» y la fecha de los datos; con cobertura siempre trae la página recién publicada, y al volver
a la app tras más de 30 minutos se pone al día sola.

Lo hacen `manifest.webmanifest`, los iconos (`iconos/`, junto a `config.json`; salen del escudo) y el
service worker `src/sw.js`, que `src/main.js` deja junto a la página si hay iconos. `sw.js` no debe cambiar
entre publicaciones ni de nombre. Para retirarlo (borrar `sw.js` no basta: los móviles se quedarían con el
que tienen), se cambia `src/sw.js` por este, que se borra a sí mismo y sus copias la siguiente vez que se abra
la página, y en `src/plantilla.html` se quita el `navigator.serviceWorker.register(...)`. Los iconos se quedan:
sin ellos no se publica `sw.js`.

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const prefijo = 'calendario' + new URL(self.registration.scope).pathname + ':';
  for (const n of await caches.keys()) if (n.startsWith(prefijo)) await caches.delete(n);
  await self.registration.unregister();
  for (const v of await self.clients.matchAll({ type: 'window' })) v.navigate(v.url);
})()));
```

### Cambiar la salida del bus o el calentamiento desde la página

Los entrenadores pueden cambiar desde la propia página la **salida del bus** de un partido de fuera o el
**calentamiento** de uno en casa, con la marca «puesta a mano». La hora del partido nunca cambia: lo que gana o
pierde tiempo es el calentamiento (fuera empieza al llegar: salida + viaje; mientras se elige la hora, la
página dice cuánto queda). En 2 o 3 minutos sale en la página, en el mensaje de WhatsApp y en el correo de
«Pedir bus»; los calendarios suscritos, cuando su aplicación los vuelve a leer.

1. **La llave** (una, la crea el dueño del repositorio): en GitHub, foto de perfil › **Settings** › **Developer
   settings** › **Personal access tokens** › **Fine-grained tokens** › **Generate new token**. Nombre (p. ej.
   «Salidas del bus»), caducidad (p. ej. hasta el final de la temporada), **Repository access: Only select
   repositories** › `calendario-dompavolei`, y en **Permissions** › **Repository permissions** › **Actions:
   Read and write** (nada más). Se copia (empieza por `github_pat_`) y se guarda en un sitio seguro.
2. **La contraseña de los entrenadores** (para no repartir la llave): el dueño abre **+ Calendario › Modo
   entrenador**, pega la llave y **Activar**; en **Contraseña para los entrenadores**, **Sugerir** y **Crear**
   (la contraseña tiene que ser la del botón, al azar: una pensada, aunque sea larga, se puede adivinar). La página da un texto: la llave cifrada con esa contraseña. Ese texto
   va en `config.json` › `edicion` › `cifrada` (no es secreto sin la contraseña: va en la página pública). La
   contraseña se pasa a los entrenadores por privado.
3. **Cada entrenador**, una vez: **+ Calendario › Modo entrenador**, escribe la contraseña y **Activar** (la
   página descifra la llave en su navegador, la comprueba con GitHub y la recuerda). La llave tal cual también
   vale. Si la llave caduca o se cambia, al guardar la página la olvida y pide la contraseña otra vez.
4. En cada partido por jugar sale **Cambiar salida** (fuera) o **Cambiar calentamiento** (en casa): se pone la
   hora (antes del partido) y **Guardar**. Si la hora está puesta a mano, **Volver a la calculada** la quita.
   «✓ Enviado» quiere decir que GitHub lo ha recibido; si a los pocos minutos no aparece en la web, mira la
   pestaña **Actions** › **Cambiar hora a mano**.

Lo guarda la tarea `.github/workflows/salida.yml` (la lanza la página con la llave) en
`salidas-manuales.json`, y lanza la publicación. Vale el último cambio de cada partido (los de un mismo partido
van en fila); la hora puede ser cualquiera antes del partido (no solo en punto o y media); el 2.º partido del
día va con el 1.º. Si la federación cambia después la fecha u hora del partido, o pasa a jugarse en casa o
fuera, o a ser el 2.º del día, la hora a mano deja de valer (vuelve la calculada y la publicación lo avisa en
su registro): se pone otra si hace falta. El historial de cambios de `salidas-manuales.json` dice qué se cambió
y cuándo.

Con la llave se pueden lanzar, parar, repetir, desactivar y borrar las ejecuciones de las tareas de este
repositorio (publicar y cambiar horas), y poner cualquier hora a cualquier partido; no se puede tocar el
código ni los archivos. Todo sale a nombre del dueño de la cuenta. Si la llave o la contraseña se filtran, o
un entrenador deja el club, se borra la llave en la misma página de GitHub (**Delete**), se crea otra y una
contraseña nueva (paso 2), y se cambia `cifrada`: cambiar solo la contraseña no basta, porque los navegadores
que ya entraron recuerdan la llave (aunque al cambiar `cifrada` olvidan la que sacaron de la anterior). La
contraseña es al azar (la da «Sugerir», ~79 bits): la llave cifrada es pública (también en el historial del
repositorio) y una pensada se podría adivinar probando con un ordenador, aunque cada prueba cueste 600 000
vueltas de PBKDF2. La llave se
guarda en el navegador de cada entrenador, para esta dirección (`albovy.github.io`): las otras páginas que se
publiquen en esa misma dirección podrían leerla, así que ahí solo deben ir páginas propias. Sin `edicion` en
`config.json`, la página no ofrece cambiar horas.

Para actualizar a mano: pestaña **Actions** › **Calendario Dompavolei** › **Run workflow**.

Para hacer cambios (desde la carpeta del repositorio, con [Node.js](https://nodejs.org/) instalado):

- **Probar:** `npm test` (no necesita conexión a internet).
- **Generar en local:** `node src/main.js` (deja los archivos en la carpeta `calendario`). Las
  opciones, como `--temporada 2025-26` o `--club`, están explicadas al principio de `src/main.js`.

`calendario-voley.ps1` es la versión anterior, en PowerShell: ya no se usa y se guarda solo como
referencia. `node test/paridad/comparar.mjs` compara lo que generan las dos versiones (necesita PowerShell y descarga de la federación; las opciones, como `--temporada 2025-26`, están explicadas al principio del archivo). Desde que el título y el detalle de los eventos del `.ics` se acortaron (septiembre de 2026), esa comparación marca diferencias en los `.ics`. De la página solo compara los datos (sin lo que el `.ps1` no tiene: nombre corto, escudo, resultados, clasificaciones y mensaje de WhatsApp): la plantilla es otra desde septiembre de 2026. El Excel debe salir igual, salvo el municipio de los partidos que aún no tienen hora: desde que también se sabe si esos son en casa (septiembre de 2026), la versión en JavaScript busca sus pabellones (y los guarda en `pabellones.json`) y el .ps1 no. Y desde octubre de 2026 el calentamiento de los partidos de fuera empieza al llegar (salida + viaje) y se pueden poner horas a mano: el calentamiento (en la página y en el Excel) ya no coincide con el del .ps1, que es siempre 1 h antes del partido, y la comparación de la página no lo mira.
