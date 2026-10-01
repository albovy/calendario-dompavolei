# Salida del bus editable (2026-10-01)

## Qué y para quién

Los entrenadores y responsables (los que usan la web; las familias no suelen entrar) pueden cambiar la hora de
salida del bus de un partido. El cambio lo ve todo el mundo: la página, el calendario (.ics) de quien esté
suscrito, el mensaje de WhatsApp y el correo de «Pedir bus».

## Cómo se usa

1. En cada partido con salida en bus (por jugar, que no sea el 2.º del día) hay un botón pequeño
   **«Cambiar salida»**, junto a WhatsApp / Copiar / Pedir bus.
2. Abre un formulario de Google con el partido ya rellenado. El entrenador escribe la hora nueva (`HH:MM`) y la
   clave del club, y lo envía.
3. En la siguiente actualización (cada hora, o a mano con «Run workflow») la salida nueva está en todas partes.
4. Para volver a la salida calculada: el mismo formulario con la hora vacía.

## Reglas

- Varios envíos del mismo partido: vale el último (el de más abajo en la hoja).
- Solo valen los envíos con la clave correcta (se filtra en la propia hoja; ver «Datos»).
- Si la federación cambia la fecha u hora del partido después del cambio, la salida a mano deja de valer (vuelve la
  calculada) y el generador lo avisa en la consola de la publicación.
- La hora a mano puede ser cualquiera (también :15 o :45); «en punto o y media» es solo para el cálculo automático.
- En la página, una salida puesta a mano lleva la marca «puesta a mano».
- El 2.º partido del día (que va en el mismo bus) sigue al 1.º: su «bus de HH:MM» es la salida a mano.

## Datos

- **Formulario de Google** (lo crea el usuario en su cuenta): tres preguntas de respuesta corta:
  «Partido» (lo rellena la página; no se toca), «Nueva hora de salida» (validación `HH:MM` o vacía) y «Clave».
- **Hoja de respuestas** del formulario. Una pestaña aparte, «Publicada», con
  `=QUERY('Respuestas de formulario 1'!A:D; "select A, B, C where D = '<CLAVE>'"; 1)`: solo los envíos con la clave
  buena y sin la columna de la clave. Solo esa pestaña se publica en la web como CSV (Archivo › Compartir ›
  Publicar en la web). La clave y los datos de quien responde nunca salen.
- **«Partido»** es un texto legible que también lee el generador:
  `id:<8 primeros caracteres del UID del partido> · 2026-10-03 11:30 · DOMPA INFANTIL 1 vs CV OLEIROS IFA`.
  El UID (partidos.js) no cambia aunque la federación cambie la fecha u hora; la fecha y hora del texto sirven
  para la regla de arriba.
- **config.json › salidas › manuales**: `{ "csv": "<URL de la pestaña publicada como CSV>",
  "formulario": "<URL del formulario con el enlace prerrellenado, terminada en entry.NNN=>" }`.
  Sin «manuales», todo como hasta ahora (ni botón ni lectura).
- **Caché `salidas-manuales.json`** junto a config.json: la última lectura buena. Si la hoja no se puede leer, se
  usa la caché (las salidas no cambian solas por un fallo de Google). El workflow la guarda con el resto.

## Generador (src)

- Módulo nuevo `src/manuales.js`: leer el CSV (fetch con tiempo límite, sin dependencias), entender las filas
  (id, fecha y hora del partido, hora nueva), quedarse con la última por id, guardar o leer la caché.
- `main.js`: después de `anadirSalidas`, aplicar las salidas a mano a los partidos (por id; solo si la fecha y
  hora coinciden y el partido tiene salida en bus). Pone `salida`, `inicio` y `salidaManual`.
- `html.js`: en los datos de cada partido, `sm: 1` si la salida es a mano e `id` (los 8 caracteres) para el
  enlace; en `D.sal`, la URL del formulario.
- `plantilla.html`: botón «Cambiar salida» (enlace al formulario con «Partido» rellenado; en otra pestaña) y la
  marca «puesta a mano».
- `.ics`, WhatsApp y «Pedir bus» ya usan `salida`/`inicio`: no cambian.

## Pruebas

- Unidad: CSV (comillas, comas, filas vacías, hora vacía = quitar, última gana), caché, aplicar (fecha cambiada,
  sin salida, 2.º partido).
- main: con un CSV simulado, la salida a mano llega a la página, al .ics y al WhatsApp; con la hoja caída, la caché.
- Página: botón con el enlace bien rellenado y marca «puesta a mano»; sin «manuales», nada.
- Workflow: guarda `salidas-manuales.json`.
