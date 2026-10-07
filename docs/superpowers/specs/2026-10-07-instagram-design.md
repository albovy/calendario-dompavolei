# Artes para Instagram desde el modo entrenador (2026-10-07)

## Qué

En «Modo entrenador», un botón **Instagram** en los partidos crea al momento, en el propio móvil, la imagen
para subir a Instagram: **victoria**, **derrota** o **próximo partido** (con el patrocinador del club). Se elige
**historia** (1080×1920) o **publicación** (1080×1350); sale en pequeño con **«Publicar en Instagram»** (el menú de
compartir del móvil: se elige Instagram, que se abre con la imagen y espera a que se confirme allí; nada se
publica solo) y **«Descargar»**, por si se quiere retocar. En el ordenador, solo «Descargar».

(2026-10-07: el usuario no quiere publicación automática directa por la API de Meta: «que te abre la app y se
queda a la espera que confirme, o descargar por si quieres hacer algún cambio».)

Historia de la idea (2026-09-27): se pensó para todos (familias incluidas); el 2026-10-07 el usuario pidió
ponerlo en el sitio de los entrenadores («así pueden hacer esa publicación automática»).

## Estilo (aprobado el 2026-10-07)

«Editorial limpio» (modelo 2 de los tres de 2026-09-27) con el **rosa como color del equipo**: papel blanco,
Barlow / Barlow Condensed, líneas de pista finas. Rosa frambuesa `#A61D58` en todo lo «nuestro» (fila del
equipo, nombre, marcador y puntos de cada set; bloque «VICTORIA», «SEGUIMOS», red, «VS», ficha de día y hora),
rosa medio `#E27BA8` (franja diagonal y confeti), rosa claro `#F9D6E5` / `#F7C6DB` sobre fondo rosa; títulos y
texto en negro tinta `#121B2E`. El rival, con un monograma de sus iniciales. Nada de fotos ni nombres de
jugadoras (son menores): solo nombres de equipo, el escudo y los datos del partido.

## Dónde sale el botón

Solo con la llave puesta (modo entrenador), y:
- **Partidos con resultado** → victoria o derrota, según el marcador desde nuestro lado.
- **Partidos por jugar con día y hora confirmados** (no los de hora provisional; el 2.º del día también, cada
  partido tiene su arte) → próximo partido.
- Nunca en los **derbis** (con o sin resultado): ganamos y perdemos a la vez, y en el próximo partido uno de los
  nuestros saldría como rival.
- Los partidos de prueba (demo) también, para enseñarlo.

Al pulsarlo, en la fila: «Historia», «Publicación» y «Cancelar». Al elegir, «Preparando…» (con «Cancelar»; si en 20 s
no está, «Sin conexión (o va muy lenta)»), y luego la imagen en pequeño con «Publicar en Instagram» (solo en el
móvil: el menú de compartir del ordenador no trae Instagram), «Descargar» y «Cerrar». Son dos pasos porque el
iPhone solo deja abrir el menú de compartir justo después de un toque. Un panel a la vez (el de Instagram o el
editor de la hora); «Quitar la llave» lo cierra; las recargas automáticas esperan si está a la vista.

## Datos del arte

- Equipos: local y visitante en su orden; el nuestro como en la página («DOMPA INFANTIL 1»), el rival tal cual.
- Resultado: marcador y sets (local primero), fecha larga («Domingo 27 de septiembre»), categoría
  («INFANTIL F») y competición.
- Próximo: día de la semana, día, mes, hora, pabellón (sin «PISTA n», como nombre propio pero con sus siglas:
  «Anexo PM Os Remedios») y municipio.
- Patrocinador: `config.json › instagram › patrocinadores`: `[{ "logo": "patrocinadores/<archivo>.png",
  "nombre": "…" }]` (PNG, mejor con fondo transparente, o JPG; no WebP, que iOS 13 no lee; nombre de archivo sin
  acentos ni espacios; como mucho 4), en la carpeta `patrocinadores/` junto a config.json; `src/instagram.js` lo
  publica junto a la página. Sin patrocinador, en su lugar «¡VAMOS, DOMPA!». Si un logo no carga, la imagen sale
  sin él y la página lo avisa.

## Cómo se hace

- `src/arte.js`: el dibujo (Canvas 2D: rellenos, trazos, arcos, degradados, texto y drawImage; sin filtros ni
  `letterSpacing` ni `roundRect`, para Safari antiguos). API: `DompaArte.dibujar(ctx, { arte, formato, datos,
  escudo, logos })` y `DompaArte.validar(arte, datos)`. Lo publica junto a la página `src/instagram.js` (desde
  main.js, si hay `edicion`), con su versión (`D.insta.v`, un trozo del sha1) para que cada página cargue el suyo
  (`arte.js?v=…`), y la página lo carga solo al pulsar el botón por primera vez (las familias no lo descargan).
- La página: `datosArte(p)` saca los datos del partido; carga `arte.js`, las fuentes (Barlow, ya en la página: si
  `document.fonts.load` no encuentra ninguna, no se hace con otras) y el escudo (`iconos/512.png`; si no, el de la
  página); dibuja en un `<canvas>`; `toBlob` → `File` y la vista en pequeño; «Publicar en Instagram» →
  `navigator.share({ files })` (con un toque nuevo, por el iPhone); «Descargar» → `<a download>`. Nombre del archivo:
  `dompa-<arte>-<aaaa-mm-dd>-<historia|publicacion>.png`.
- Errores claros en la fila: sin conexión (no carga `arte.js`), fuentes que no cargan (se avisa y no se publica
  con fuentes del sistema), compartir cancelado (nada).

## Pruebas

- arte.js con un contexto 2D de mentira (apunta las llamadas): los tres artes en los dos formatos sin errores,
  5 sets, nombres muy largos, con y sin patrocinador; `validar` con datos que faltan; el rosa del equipo en la
  fila nuestra; nada que no sea Canvas 2D básico.
- Página: el botón solo en modo entrenador y en los partidos que tocan (resultado no derbi; por jugar con día y
  hora confirmados); los datos del arte (`datosArte`) de victoria, derrota y próximo; elegir formato; compartir
  con `navigator.share` (archivo PNG con su nombre) o descargar; errores.
- main: `arte.js` y los logos del patrocinador junto a la página, y `D.insta` con los patrocinadores.
- A mano en Edge: las imágenes de verdad (como las maquetas) y el flujo de compartir/descargar.
