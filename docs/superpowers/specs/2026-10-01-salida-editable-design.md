# Salida del bus editable (2026-10-01)

## Qué y para quién

Los entrenadores y responsables (los que usan la web; las familias no suelen entrar) pueden cambiar la hora de
salida del bus de un partido desde la propia web. El cambio lo ve todo el mundo en 1-2 minutos: la página, el
calendario (.ics) de quien esté suscrito, el mensaje de WhatsApp y el correo de «Pedir bus».

(Primera idea, descartada: un formulario de Google. Pedía crear una cuenta de Google y tardaba hasta una hora.)

## Cómo se usa

1. Una vez, en «+ Calendario › Modo entrenador», cada entrenador pega la **llave** (un token de GitHub; ver
   «Llave»). Queda guardada en su navegador. Sin llave no hay nada que editar.
2. En cada partido fuera de casa por jugar (no el 2.º del día) sale un botón pequeño **«Cambiar salida»**: abre en
   la fila un campo de hora con la salida actual, «Guardar», «Cancelar» y, si la salida está puesta a mano,
   «Volver a la calculada».
3. Al guardar, la página lanza el workflow de publicación (workflow_dispatch con el partido y la hora). El
   workflow guarda el cambio en `salidas-manuales.json` (commit) y vuelve a publicar. La fila dice «Guardado: la
   web se actualizará en 1-2 minutos».

## Reglas

- Varios cambios del mismo partido: vale el último.
- Hora vacía («Volver a la calculada»): se quita el cambio.
- Si la federación cambia la fecha u hora del partido después del cambio, la salida a mano deja de valer (vuelve la
  calculada) y el generador lo avisa en la consola de la publicación.
- La hora a mano puede ser cualquiera (también :15 o :45); «en punto o y media» es para el cálculo automático.
- En la página, una salida puesta a mano lleva la marca «puesta a mano».
- El 2.º partido del día sigue al 1.º: su «bus de HH:MM» es la salida a mano.

## Llave

- Un **token de GitHub de grano fino** que crea el dueño del repositorio: solo el repositorio
  albovy/calendario-dompavolei y solo el permiso **Actions: lectura y escritura** (lanzar workflows). No sirve
  para cambiar código ni archivos. Caduca cuando se elija (se renueva y se reparte otra vez).
- La pega cada entrenador en su navegador (localStorage). Nunca va en la página publicada ni en el repositorio.
  Claude nunca la escribe.
- Si se filtrara: como mucho se podrían lanzar publicaciones y cambiar salidas (con formato y partido válidos);
  GitHub registra cada ejecución. Se revoca en GitHub y se crea otra.

## Workflow (calendario.yml)

- `workflow_dispatch` con dos entradas opcionales: `partido` (texto
  `id:<8 caracteres del UID> · aaaa-mm-dd HH:MM · LOCAL vs VISITANTE`) y `salida` (`HH:MM` o vacía). cron-job.org
  lanza sin entradas: no cambia nada.
- Si hay `partido`, un paso **antes** de mirar la federación: `node src/manuales.js` (lee las entradas de variables
  de entorno, nunca metidas en el `run:`, para que no se pueda inyectar nada), valida, actualiza
  `salidas-manuales.json`, hace commit y push (con pull antes). Así el cambio queda guardado aunque esa máquina no
  llegue a la federación; lo aplicará la siguiente publicación.
- El paso final de guardar cachés incluye `salidas-manuales.json`.

## Generador (src)

- `src/manuales.js`: leer/escribir `salidas-manuales.json` ({ id: { partido: 'aaaa-mm-dd HH:MM', salida, cambiado } }),
  validar un cambio, aplicarlo (o quitarlo), y aplicar las salidas a mano a los partidos (por id y con la misma
  fecha y hora; si no, aviso). Uso por consola desde el workflow.
- `main.js`: después de `anadirSalidas`, aplicar las salidas a mano (pone `salida`, `inicio` y `salidaManual`).
- `html.js`: en cada partido `id` (8 caracteres del UID) y `sm: 1` si la salida es a mano; `D.edicion`
  ({ repo, workflow, rama }) desde config.json › `edicion` (sin ella, no hay edición).
- `plantilla.html`: «Modo entrenador» (llave), botón y editor en la fila, llamada a la API de GitHub
  (`POST /repos/{repo}/actions/workflows/{workflow}/dispatches`), mensajes de error claros (llave mala o caducada,
  sin conexión), marca «puesta a mano».
- `.ics`, WhatsApp, Excel y «Pedir bus» ya usan `salida`/`inicio`.

## Pruebas

- manuales.js: validación (formato del partido y de la hora), último gana, quitar, aplicar (fecha cambiada,
  2.º partido, en casa), consola.
- main: con `salidas-manuales.json`, la salida a mano llega a la página y al .ics; con la fecha cambiada, aviso.
- Página: sin llave no hay botón; con llave, el editor; la petición a GitHub (URL, cabeceras, cuerpo); respuestas
  204 / 401 / 403 / 404 / sin red; marca «puesta a mano»; la llave no sale en la página publicada.
- Workflow: entradas opcionales, el paso va antes de la sonda, sin `${{ inputs.* }}` dentro de ningún `run:`,
  guarda `salidas-manuales.json`.
