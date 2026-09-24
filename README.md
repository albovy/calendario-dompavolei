# Calendario de partidos de Dompavolei

Partidos de todos los equipos de **DOMPAVOLEI** (voleibol, Galicia), sacados de la
[agenda de la Federación Galega de Voleibol](https://volei.gal/competiciones/) y
actualizados automáticamente cada hora (de 8:00 a 23:00).

- **Página con los partidos:** https://albovy.github.io/calendario-dompavolei/
- **Calendario para suscribirse** (Google Calendar, iPhone, Outlook):
  `https://albovy.github.io/calendario-dompavolei/calendario.ics`
  (en la página hay un botón «Suscribirse» y los enlaces de cada equipo)

## Cómo funciona

`calendario-voley.ps1` descarga los partidos publicados en la federación, se queda con
los del club indicado en `config.json` (ID 206572580) y genera la página, el `.ics`,
un Excel y un `.ics` por equipo. La tarea `.github/workflows/calendario.yml` lo ejecuta
y publica el resultado en GitHub Pages. La carpeta `historial` guarda la lista de partidos cada vez que la federación cambia algo (su historial de cambios muestra qué cambió y cuándo).

Para actualizar a mano: pestaña **Actions** › **Calendario Dompavolei** › **Run workflow**.

El mismo script funciona en Windows con doble clic (`Generar calendario.bat`).
