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
página, el `.ics`, un Excel y un `.ics` por equipo. La tarea `.github/workflows/calendario.yml`
lo ejecuta y publica el resultado en GitHub Pages. La carpeta `historial` guarda la lista de partidos cada vez que la federación cambia algo (su historial de cambios muestra qué cambió y cuándo).

Cada partido empieza en el calendario a la **hora de salida en bus desde Os Remedios** (partido − 1 h de calentamiento − viaje por carretera, siempre al alza) o, en casa, a la hora de calentamiento. Los tiempos de viaje se guardan en `pabellones.json` y se pueden fijar a mano en `config.json`. Cada hora solo se descarga la temporada en curso; los partidos del club de la temporada anterior (para los equipos que aún no juegan y para agosto) se guardan una vez en `temporada-anterior.json`.

En los partidos ya jugados salen el **resultado** y los sets, y la pestaña **Clasificación** enseña la tabla
del grupo de cada equipo. Salen de la web de resultados de la federación (la misma que enseña volei.gal):
solo se consultan los grupos del club y solo cuando hace falta (un partido que acaba de jugarse, un repaso
diario), y se guardan en `resultados.json`. Nunca se descargan actas ni plantillas.

Para actualizar a mano: pestaña **Actions** › **Calendario Dompavolei** › **Run workflow**.

Para hacer cambios (desde la carpeta del repositorio, con [Node.js](https://nodejs.org/) instalado):

- **Probar:** `npm test` (no necesita conexión a internet).
- **Generar en local:** `node src/main.js` (deja los archivos en la carpeta `calendario`). Las
  opciones, como `--temporada 2025-26` o `--club`, están explicadas al principio de `src/main.js`.

`calendario-voley.ps1` es la versión anterior, en PowerShell: ya no se usa y se guarda solo como
referencia. `node test/paridad/comparar.mjs` compara lo que generan las dos versiones (necesita PowerShell y descarga de la federación; las opciones, como `--temporada 2025-26`, están explicadas al principio del archivo). Desde que el título y el detalle de los eventos del `.ics` se acortaron (septiembre de 2026), esa comparación marca diferencias en los `.ics`, y desde que hay resultados y clasificaciones, también en la página; el Excel debe salir igual.
