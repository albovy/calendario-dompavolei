# Rediseño «Salidas desde Os Remedios» · diseño

Fecha: 2026-09-25. Aprobado por el usuario sobre la maqueta v3 («Constrúyela pero no borres la anterior»).
Maqueta aprobada: `docs/superpowers/specs/2026-09-25-rediseno-salidas-maqueta.png` (claro a la izquierda,
oscuro a la derecha; HTML de referencia en `2026-09-25-rediseno-salidas-maqueta.html`).

## Qué se construye y qué no se toca

- Una página NUEVA, `salidas.html`, generada con los mismos datos que la actual (`D`, el JSON de
  `<script id="datos">`) desde una plantilla nueva, `src/plantilla-salidas.html`.
- La página actual (`src/plantilla.html` → `calendario.html` / `index.html`) NO cambia y sigue siendo la
  portada. El usuario decidirá más adelante cuál es la portada.
- **Selector de diseño arriba del todo en las dos páginas** (lo pidió el usuario para decidir cuál le
  convence): una franja fina encima de la cabecera con dos opciones, «Diseño antiguo | Diseño nuevo», con la
  de la página actual marcada (`aria-current="page"`). «Diseño antiguo» lleva a `index.html` (publicada) o
  al .html de siempre (en local); «Diseño nuevo» lleva a `salidas.html`. Mismo aspecto en las dos páginas
  (con los colores de cada una), 36-40 px de alto, que no tape nada y que no salga al imprimir.

## Condiciones del usuario (obligatorias)

1. **Una fila por partido.** Nunca se unen los dos partidos de un día en un «viaje». El 2.º partido va en
   su propia fila.
2. **La hora en texto normal y grande** (Barlow Condensed 700, ~30 px, cifras tabulares). Nada de
   tablillas, paletas ni rayas que crucen las cifras.
3. **Local o visitante siempre visible** en cada fila (píldora «LOCAL» rellena / «VISITANTE» con borde).
4. **Botones siempre a la vista** en las filas que los tienen: WhatsApp, Copiar y Pedir bus, **pequeños**
   (píldoras de ~32 px de alto, 14 px de letra, icono de 15 px), los tres en una línea bajo la fila, a
   todo el ancho de la fila.

## Sistema visual

Colores (tokens CSS; los dos modos, con `prefers-color-scheme`):

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--fondo` | `#ECEFF2` | `#131519` | fondo de la página y de la fila de chips; días pasados sin tarjeta |
| `--sup` | `#FFFFFF` | `#1C1F25` | barra superior, pestañas, filas |
| `--borde` | `#D5DAE1` | `#2C3139` | separadores |
| `--control` | `#7D8796` | `#6B7380` | borde de botones y chips sin elegir |
| `--tinta` | `#121B2E` | `#E8EAEE` | texto; botón WhatsApp y píldora LOCAL rellenos |
| `--tinta2` | `#4E5866` | `#A4ABB5` | texto secundario |
| `--marino-t` | `#1E335F` | `#A9BCE3` | rótulo «SALIDA» (marino del escudo) |
| `--agua` | `#0A7A70` | `#63D0C3` | «PRÓXIMA SALIDA», «Ganado», foco |
| `--agua-r` | `#5EC4B9` | `#5EC4B9` | barra de 4 px de la próxima salida y raya de la pestaña activa |
| `--ambar` | `#955300` | `#F0B65A` | lo que no es firme: hora/fecha por confirmar, provisional, salida sin calcular |
| `--elegido` / `--elegido-t` | `#121B2E` / `#FFFFFF` | `#E8EAEE` / `#131519` | chip, segmento elegidos |

- Sin colores de categoría, sin amarillo balón, sin azul pista. «Perdido» en `--tinta2`.
- Tipografía (Bunny Fonts, una petición): `barlow:400,500,600|barlow-condensed:500,600,700`.
  Barlow Condensed para rótulos, códigos, destinos, horas y botones; Barlow para el texto corrido.
- Escudo: `escudo.png` (96 px) del repositorio, incrustado como data URI en la página por `html.js`
  (`D.escudo`); sobre un cuadrado blanco redondeado de 40 px también en oscuro. Si no existe, solo el nombre.
- Foco visible: 3 px `--agua` con 2 px de separación. Iconos: SVG en línea con `currentColor` (sin emojis
  en la página; el mensaje de WhatsApp sí conserva sus emojis).

## Estructura (móvil, 375 px; en escritorio, centrado a 720 px)

```
[escudo] DOMPAVOLEI                [+ Calendario]     barra, 64 px (se va con el scroll)
         Temporada 2026/27
 Calendario   Clasificación                           pestañas (ocultas si no hay clasificaciones)
[Todos] [IF1] [CF1] [XF1] …                 Filtros   chips (fila fija arriba); scroll horizontal
                                                       sin barra visible
 SALIDAS DESDE OS REMEDIOS               [LISTA|MES]  (en Clasificación, no sale)
 SÁBADO 26 SEPT.                             mañana   cabecera del día + nota
 ┌───────────────────────────────────────────────┐
 │▌SALIDA        IF1  MARÍN                     › │  ▌ barra aguamarina solo en la próxima salida
 │ 07:15         PRÓXIMA SALIDA                    │
 │ partido 10:00 vs SEI SAN NARCISO IF             │
 │               Infantil F (VISITANTE)            │
 │ (WhatsApp) (Copiar) (Pedir bus)                 │
 └───────────────────────────────────────────────┘
```

- «+ Calendario» abre un panel (o `<dialog>`) con todo lo que hoy está en la cabecera: suscribirse (webcal
  en iPhone/Mac, Google con los pasos para Android, dirección para Outlook, ayuda para importar si la
  página no está publicada), Descargar .ics, Abrir en Excel e Imprimir.
- «Filtros» es un `<button aria-expanded>` que despliega debajo los grupos Periodo (Próximos / Toda la
  temporada) y Local o visitante (Todos / Local / Visitante). Si hay algún filtro distinto del normal, el
  botón lo indica («Filtros · 1»). En la vista Mes no hay periodo.
- Nota de la cabecera del día: «hoy», «mañana», «fecha por confirmar» (en ámbar, si el día no es firme) o
  «jugados» (días pasados). Los días pasados van sin tarjeta, sobre el fondo, como hoy.

## La fila de un partido

Columna izquierda (86 px): rótulo pequeño en mayúsculas + hora grande + línea debajo.

| Caso | Rótulo | Hora grande | Debajo |
|---|---|---|---|
| Fuera, con salida en bus (`p.s`) | SALIDA (marino) | salida | «partido HH:MM» |
| 2.º partido del día (`p.seg`) | 2.º PARTIDO (gris) | partido | «bus de HH:MM» (`p.sp`) o «en casa» |
| En casa (`p.casa`) | EN CASA (gris) | calentamiento | «partido HH:MM» |
| Sin horas de salida configuradas o salida sin calcular | PARTIDO | partido | «salida sin calcular» en ámbar si hay config |
| Hora por confirmar (`e='h'`) | EN CASA si es en casa, si no nada | «HORA POR CONFIRMAR» en ámbar (en lugar de la hora) | — |
| Fecha y hora por confirmar (`e='x'`) | — | «FECHA Y HORA POR CONFIRMAR» en ámbar | — |
| Provisional (`e='p'`) | como su caso | la hora | añade «provisional» en ámbar |
| Ya jugado | SALIÓ (si tuvo salida) o PARTIDO, en gris | la hora en gris | «partido HH:MM» |

Columna derecha:
1. Código del equipo del club (sin el prefijo común, «IF1») + destino en mayúsculas: el municipio
   (`p.mun`) o, si no hay, el pabellón. En un derbi, los dos códigos («CF1 · CF2»).
2. «PRÓXIMA SALIDA» en aguamarina, solo en el primer partido por jugar con salida en bus que se ve con los
   filtros actuales (misma lógica que el «Próximo» de ahora).
3. «vs RIVAL» (en un derbi, «vs CF2»).
4. Categoría («Infantil F») + píldora LOCAL / VISITANTE / DERBI.
5. Si ya se jugó: «Ganado 3-0» (aguamarina) o «Perdido 2-3» (`--tinta2`) + sets desde nuestro lado.

Botones (fila de ancho completo, bajo todo lo anterior): los mismos que hoy y con las mismas reglas:
WhatsApp y Copiar solo en el primer partido del día del equipo con mensaje (`p.wa`, sin resultado y sin
jugar); Pedir bus solo si hay salida (`p.s`), configuración de bus (`D.bus`) y no se ha jugado. Se
mantienen las clases `boton-wa copiar` con `data-i`, `boton-wa wa` (enlace a
`https://api.whatsapp.com/send?text=…`) y `boton-bus` (mailto), y el copiado con su alternativa
(`<textarea>`) y el aviso «✓ Copiado».

Detalle (la flecha › de la fila, `<button aria-expanded>`; panel con `hidden`): pabellón con enlace al mapa
y su dirección (`D.pabs`), competición, calentamiento y viaje («1 h 45 min en bus hasta Marín ·
calentamiento 09:00») o «Se va con el partido anterior (salida 07:15)» en el 2.º partido. Al imprimir,
todos los detalles salen abiertos y los botones no salen.

## Resto de vistas

- **Mes:** la rejilla actual con los nuevos colores; en cada celda, los códigos de los equipos (máx. 2 y
  «+N»), con la hora de salida si la hay; hoy con anillo aguamarina. Tocar un día lleva a la lista.
- **Clasificación:** las tablas actuales con los nuevos colores; nuestra fila con barra `--agua-r`, tinte
  suave y negrita. «Comprobada el … · Ver en la federación».
- **Pie:** calendarios .ics por equipo y fuente de los datos.
- **Vacíos:** los mismos mensajes y el botón para quitar filtros.

## Datos

- «En casa» también sin hora: `salidas.js` marca `enCasa` por el pabellón (radio de 1 km o tiempo
  manual 0) aunque el partido no tenga hora todavía, para que los del Anexo de Os Remedios digan «EN CASA».
  Afecta igual a la web de siempre, al .ics y al mensaje de WhatsApp (que ya no se genera para fechas sin
  confirmar).
- `html.js`: `D.escudo` (data URI de `escudo.png` o `''`) y una función que genera la página nueva con la
  plantilla nueva; `main.js` escribe `salidas.html` junto a `calendario.html`; el workflow la publica.

## Comportamiento que se conserva (de la página actual)

Estado en `localStorage` (equipos, periodo, lado, vista, pestaña) con try/catch; `#estado` aria-live con el
recuento; saltar desde el Mes a un día con el foco en su cabecera; «Pedir bus» con la vuelta calculada;
mensaje de WhatsApp; suscripción según el dispositivo; impresión con la línea del filtro; pestañas ocultas
si no hay clasificaciones; accesible con teclado y lector de pantalla; 375 px sin scroll horizontal.

## Pruebas

- La plantilla nueva: sin errores de sintaxis y con un solo `__TITULO__` y `__DATOS__`.
- Ejecución del script de la página nueva en un DOM simulado (como `test/pagina.test.js`): una fila por
  partido (el 2.º partido en su fila), botones solo donde tocan, píldora local/visitante, rótulos de la
  columna de la hora en cada caso de la tabla, «PRÓXIMA SALIDA» en el sitio correcto, resultados.
- `salidas.test.js`: en casa por el pabellón aunque no haya hora.
- `main.test.js`: se generan `calendario.html` y `salidas.html`.
