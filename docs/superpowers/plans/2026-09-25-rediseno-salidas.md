# Rediseño «Salidas desde Os Remedios» · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** una página nueva, `salidas.html`, con el diseño aprobado (maqueta v3), sin tocar la página
actual, que sigue siendo la portada. Diseño: `docs/superpowers/specs/2026-09-25-rediseno-salidas-design.md`
(léelo entero: la tabla de la columna de la hora y las 4 condiciones del usuario mandan). Maqueta:
`docs/superpowers/specs/2026-09-25-rediseno-salidas-maqueta.png` y `.html`.

**Arquitectura:** la plantilla nueva `src/plantilla-salidas.html` recibe el mismo JSON que la actual (más
`D.escudo`); `html.js` exporta `crearHtmlSalidas(opciones)` (o `crearHtml(opciones, { plantilla })`) que
reutiliza la misma construcción de datos; `main.js` escribe `salidas.html`; el workflow la publica.

**Tecnología:** Node ≥ 20 sin dependencias, `node:test`, HTML + CSS + JS vanilla en la plantilla (mismo
estilo que `src/plantilla.html`: ES5 dentro de una IIFE, `'use strict'`, funciones pequeñas con
comentarios en español). Convenciones: textos en español, fechas «de pared», CRLF en la copia de trabajo,
commits con `git -c user.name=albovy -c user.email=25620656+albovy@users.noreply.github.com commit` y
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nunca ejecutar `node src/main.js` dentro del
repositorio (reescribe cachés): para probar con datos reales, copiar `config.json`, `pabellones.json`,
`temporada-anterior.json` y `resultados.json` a una carpeta temporal y usar `--config <tmp>`.

> Nota: al ser una plantilla de interfaz de ~900 líneas, este plan fija el comportamiento, las pruebas y la
> maqueta de referencia en lugar de copiar el código entero; el código lo escribe quien ejecuta el plan
> siguiendo la maqueta al píxel razonable y el diseño.

---

### Tarea 1: «En casa» por el pabellón aunque no haya hora (`src/salidas.js`)

- [ ] Prueba que falla en `test/salidas.test.js`: un partido `sinhora` (y otro `pendiente`) en un pabellón
  a < 1 km del origen (o con tiempo manual 0) queda con `enCasa = true`, `salida = null`,
  `calentamiento = null`; uno sin hora lejos sigue con `enCasa = false`.
- [ ] En `anadirSalidas`, calcular `casa` (y `municipio`/`km`) para todos los partidos con pabellón, antes
  de saltar los que no tienen hora; salida y calentamiento solo con hora, como ahora.
- [ ] `npm test` pasa entero (revisar que las pruebas de ics/html/whatsapp siguen igual). Commit.

### Tarea 2: datos y generación de la página nueva (`src/html.js`, `src/main.js`, workflow)

- [ ] Pruebas que fallan: `crearHtmlSalidas` usa `src/plantilla-salidas.html` con el mismo JSON que
  `crearHtml` más `escudo` (data URI `data:image/png;base64,…` de `escudo.png` si existe, si no `''`);
  `main.test.js` comprueba que se escriben `calendario.html` y `salidas.html`.
- [ ] Implementar reutilizando la construcción de datos de `crearHtml` (sin duplicarla). La ruta del
  escudo: `escudo.png` junto a `config.json` (como `pabellones.json`), con una opción para las pruebas.
- [ ] `.github/workflows/calendario.yml`: nada que cambiar si `salidas.html` se escribe en `web/`
  (comprobarlo). README: una línea sobre la página nueva.
- [ ] Commit.

### Tarea 3: la plantilla nueva (`src/plantilla-salidas.html`)

- [ ] Pruebas que fallan en `test/pagina-salidas.test.js`, ejecutando el script de la plantilla en el DOM
  simulado (reutilizar/extraer el simulador de `test/pagina.test.js`): una fila por partido (el 2.º partido
  en su propia fila), rótulos de la columna de la hora para cada caso de la tabla del diseño (SALIDA,
  2.º PARTIDO, EN CASA, PARTIDO, HORA POR CONFIRMAR, FECHA Y HORA POR CONFIRMAR, provisional, SALIÓ), la
  píldora LOCAL/VISITANTE/DERBI en todas, «PRÓXIMA SALIDA» solo en la primera salida por jugar, botones
  (`boton-wa copiar` con `data-i`, `boton-wa wa` a api.whatsapp.com, `boton-bus`) solo donde tocan,
  «Ganado 3-0» desde nuestro lado, copiado con alternativa, pestañas ocultas sin clasificaciones. Más la prueba de sintaxis y de `__TITULO__`/`__DATOS__` únicos.
- [ ] Escribir la plantilla siguiendo la maqueta v3 y el diseño: barra con escudo y «+ Calendario» (panel
  con la suscripción, .ics, Excel, Imprimir y la ayuda actual), pestañas, chips (fila fija, sin barra de
  scroll), «Filtros» desplegable, «Salidas desde Os Remedios» + Lista/Mes, días, filas, detalle
  desplegable, vista Mes, Clasificación, pie, vacíos, impresión, modo oscuro, foco visible, 375 px sin
  scroll horizontal. Conservar la lógica de la página actual que aplique (copiar funciones como
  `enlaceBus`, `copiar`, `delClub`, `yaJugado`, suscripción, `irADia`, `anunciar`, estado en
  localStorage con su propia clave para no pisar la de la página actual).
- [ ] `npm test` pasa entero. Commit.

### Tarea 4: selector «Diseño antiguo | Diseño nuevo» arriba del todo en las dos páginas

- [ ] En las dos plantillas, una franja fina encima de la cabecera con dos enlaces: «Diseño antiguo» y
  «Diseño nuevo», con el de la página actual marcado (`aria-current="page"`, relleno). Destinos: antiguo →
  `index.html` si la página está publicada (http/https), si no el .html de siempre (`D.ics` cambiando
  `.ics` por `.html`); nuevo → `salidas.html`. En la antigua respeta sus colores; en la nueva, los
  suyos. 36-40 px de alto, sin scroll horizontal a 375 px, oculta al imprimir. Pruebas en los dos
  archivos de pruebas de página (enlaces y marcado). Commit.

### Tarea 5: comprobación visual

- [ ] Generar con datos reales en una carpeta temporal y capturar `salidas.html` a 375 px en claro y en
  oscuro con Edge sin ventana (marco con dos `<iframe>` de 375 px, porque Edge no baja de ~500 px de
  ventana): `"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --disable-gpu
  --hide-scrollbars --no-first-run --user-data-dir=<tmp> --force-device-scale-factor=1.5
  --window-size=798,2000 --virtual-time-budget=8000 --screenshot=<png> file:///<marco.html>`
  (ruta con `cygpath -m`). Para el oscuro, la página debe aceptar `?oscuro` solo en la maqueta: en la
  plantilla real, usar un marco que fuerce `color-scheme` o emular con
  `--blink-settings=preferredColorScheme=0` y comprobar que funciona. Comparar con la maqueta y corregir.
