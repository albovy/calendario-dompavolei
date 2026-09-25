# Resultados y clasificaciones · diseño

Fecha: 2026-09-25. Aprobado por el usuario ("me encaja").

## Objetivo

Añadir a la web y al calendario los **resultados** de los partidos ya jugados de los equipos de
Dompavolei y una **clasificación por equipo** (la del grupo en el que juega cada uno). Solo la
temporada en curso.

## Fuente de datos (iSquad, lo mismo que enseña volei.gal)

La "Agenda calendario" (`json/partidos_equipos_consultas.php`) no trae resultados ni grupos. Se
usan tres cosas más de `resultadosvoleibol.isquad.es` / `voleibol.isquad.es`:

1. **Árbol de competiciones**: `POST https://voleibol.isquad.es/json/api/call.php/resultados/campeonato/tree?token=…`
   con `ambitos=6&seleccion=0&id_superficie=1&id_temporada=2627`. Devuelve campeonatos →
   competiciones (`id`, `nombre`) → torneos (`id`, `nombre_fase`, `grupo`). El `nombre` de la
   competición coincide con `nombre_competicion` de la agenda (comprobado con todas las
   competiciones del club en 2025-26 y 2026-27). El `token` es público: va en el HTML de cualquier
   página de iSquad (`token = "…"`); sin él la llamada devuelve vacío.
2. **Página de un grupo**: `competicion_completa.php?seleccion=0&id=<torneo>&id_ambito=6&id_territorial=20&id_superficie=1&iframe=0&id_competicion=<competición>`.
   - Sección "GRUPOS DE LA COMPETICIÓN": todos los grupos de la competición (título "FASE - GRUPO")
     con sus equipos. Cada equipo lleva `equipo.php?…id_equipo=<equipo>&id=<torneo>` y el escudo
     `afiliacion_clubs/<id club>/…`: así se sabe en qué grupo(s) está cada equipo del club.
   - Sección "RESULTADOS DE LA COMPETICIÓN": los partidos del grupo `<torneo>` por jornadas, con
     equipos (y su club por el escudo), marcador, sets 1-5, hora y fecha reales, pabellón y estado
     ("Finalizado", …).
3. **Clasificación de un grupo**: `clasificacion.php?` con los mismos parámetros. Tabla con
   posición, equipo (y club por el escudo), PT, PJ, PG, PP, SF, SC (y PF, PC, G3, G2, P1, P0, que
   no se usan). Las copas eliminatorias pueden no tener ("Clasificación NO DISPONIBLE").

Cada página pesa ~0,8-1,3 MB sin comprimir (fetch pide gzip). Nunca se descargan actas, previos,
plantillas ni nada con nombres de personas (hay menores): solo equipos y marcadores.

## Cuándo se consulta (poca carga para la federación)

Todo queda guardado en `resultados.json` (en el repositorio, lo sube el bot igual que
`pabellones.json`). En cada ejecución:

- **Partido pendiente de resultado**: partido nuestro de la temporada en curso que empezó hace más
  de 2 h (sin hora: desde el día siguiente), jugado hace 14 días o menos, sin resultado guardado
  → se consulta su grupo en cada
  ejecución hasta que aparezca.
- **Repaso diario**: cada grupo nuestro que aún tenga partidos sin jugar se vuelve a consultar si su
  última consulta tiene más de 20 h (así la clasificación recoge los partidos de los rivales).
  Un grupo con todos sus partidos finalizados ya no se consulta más.
- La clasificación de un grupo solo se descarga cuando cambian sus resultados (o la primera vez).
- El árbol de competiciones (y el token) solo se pide si aparece una competición que no está en
  `resultados.json`. Los grupos de cada equipo se actualizan cada vez que se descarga la página de
  un grupo de esa competición; si un partido pendiente no casa con ningún grupo conocido (p. ej.
  empieza la segunda fase), se vuelve a mirar la lista de grupos de su competición.
- Si la federación falla, aviso y se sigue con lo guardado: el calendario se publica igual.
- `resultados.json` se reinicia al cambiar de temporada. Con `--temporada` (ejecución a mano de
  otra temporada) no se consulta ni se guarda nada.

## Emparejar resultados con nuestros partidos

Por equipo local + equipo visitante + día. Si la federación cambió el día, por el mismo cruce
(local y visitante en ese orden) dentro del grupo, si solo hay uno. Solo cuentan los partidos en
estado "Finalizado" con marcador. Aplazados o suspendidos: sin resultado.

## Qué se ve

- **Web, partidos jugados**: "Ganado 3-0 · 25-18 · 25-22 · 25-11" (verde) o "Perdido …" (rojo),
  siempre con nuestro marcador primero. En un derbi (dos equipos del club): "3-1" sin
  ganado/perdido.
- **Web, pestaña "Clasificación"**: una tabla por equipo con el grupo actual (el grupo en el que el equipo tiene el partido
  más reciente, jugado o por jugar). Columnas: #, Equipo, Pts, PJ, G, P, Sets (SF-SC). Nuestra fila
  resaltada. Debajo, la hora de la última actualización y un enlace a la clasificación en la
  federación. Al filtrar por un equipo, su tabla sale también encima de sus partidos.
- **Calendario (.ics, general y por equipo)**: cuando hay resultado, el título pasa de
  "🚌 IF1 vs PONTEVEDRA IF2 (11:30)" a "✅ IF1 3-0 PONTEVEDRA IF2" (o "❌ …" si se pierde;
  "🏐 CF1 3-1 CF2" en un derbi). El detalle pasa a ser los sets, el partido y la competición
  (las horas de salida ya no hacen falta).
- El Excel no cambia.

## Piezas

- `src/resultados.js` (nuevo): lectura del HTML de iSquad (funciones puras: grupos, resultados,
  clasificación, token), decisión de qué grupos consultar, emparejado con los partidos y
  lectura/escritura de `resultados.json`.
- `src/isquad.js`: reutiliza `peticion` (reintentos) para las páginas nuevas.
- `src/main.js`: llama a la actualización de resultados tras convertir los partidos.
- `src/ics.js`: título y detalle con resultado.
- `src/html.js` / `src/plantilla.html`: resultado en las tarjetas, pestaña "Clasificación" y tabla
  al filtrar por equipo.
- `.github/workflows/calendario.yml`: añade `resultados.json` al commit del historial.

## Pruebas (sin red)

Con trozos reales de las páginas guardados en `test/` (solo equipos y marcadores): lectura de
grupos, resultados (incluidos 5 sets, partido sin jugar y aplazado), clasificación y token;
decisión de qué consultar; emparejado (día cambiado, derbi, doble vuelta); título y detalle del
.ics; datos de la web.
