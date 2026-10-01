# Horas editables: salida del bus y calentamiento (2026-10-01)

## Qué y para quién

Los entrenadores y responsables (los que usan la web; las familias no suelen entrar) pueden cambiar desde la
propia web la **salida del bus** de un partido de fuera o el **calentamiento** de uno en casa. En 2 o 3
minutos sale en la página, en el mensaje de WhatsApp, en el correo de «Pedir bus» y en el .ics (los
calendarios suscritos lo ven cuando su aplicación lo vuelve a leer).

(Primera idea, descartada: un formulario de Google. Pedía crear una cuenta de Google y tardaba hasta una hora.)

## El calentamiento (regla nueva, para todas las salidas)

La hora del partido nunca cambia; lo que gana o pierde tiempo es el calentamiento:
`salida + viaje + calentamiento = partido`. Fuera, el calentamiento empieza al llegar (salida + viaje), con la
salida calculada o puesta a mano. La salida se sigue calculando igual (partido − 1 h − viaje, redondeada hacia
abajo a la hora o a la media), así que lo que se gana al redondear es calentamiento. Una salida a mano con la que
se llegaría a la hora del partido o después no vale (la página no deja guardarla y, si pasa después, p. ej. por
un cambio de pabellón, deja de valer). Sin viaje calculado, con la salida a mano no hay hora de calentamiento
(no se sabe cuándo se llega). En casa, 1 h antes del partido o la hora puesta a mano.

## Cómo se usa

1. Una vez, en «+ Calendario › Modo entrenador», cada entrenador escribe la **contraseña** (o pega la llave,
   un token de GitHub; ver «Llave y contraseña»); la página la comprueba con GitHub y la recuerda en su
   navegador. Sin llave no hay nada que editar.
2. En cada partido por jugar (no el 2.º del día) sale un botón pequeño **«Cambiar salida»** (fuera) o
   **«Cambiar calentamiento»** (en casa): abre en la fila un campo de hora con la actual, «Guardar», «Cancelar»
   y, si está puesta a mano, «Volver a la calculada». Debajo del campo, mientras se elige la hora, lo que queda
   de calentamiento («Llegada hacia las 09:15: 45 min de calentamiento»).
3. Al guardar, la página lanza `salida.yml` (workflow_dispatch con el partido, el tipo y la hora), que guarda
   el cambio en `salidas-manuales.json` (commit) y lanza la publicación. La fila dice «✓ Enviado: salida a las
   HH:MM. En 2 o 3 minutos estará en la web: recarga entonces para mandar el WhatsApp o pedir el bus con la
   hora nueva» («Enviado»: GitHub lo ha recibido, no que ya esté guardado). Hasta recargar, ese equipo ese día
   no ofrece WhatsApp ni «Pedir bus» (llevarían la hora vieja), y el editor se abre con la hora enviada (se
   puede deshacer).

## Reglas

- La hora, antes del partido (una de después, p. ej. 18:30 por 06:30 en un selector de 12 horas, haría un
  evento que acaba antes de empezar); la página y `manuales.js` lo comprueban.
- Varios cambios del mismo partido: vale el último (van en fila en `salida.yml`).
- Hora vacía («Volver a la calculada»): se quita el cambio. La misma hora otra vez no cambia el archivo (la
  página ni la manda).
- La hora a mano deja de valer (vuelve la calculada y la publicación lo avisa) si la federación cambia la fecha
  u hora del partido, si pasa a jugarse en casa o fuera (no casa con el tipo), a ser el 2.º del día o, fuera, si
  con esa salida se llegaría a la hora del partido o después.
- Puede ser cualquier hora (también :15 o :45); «en punto o y media» es para el cálculo automático.
- En la página, una hora puesta a mano lleva la marca «puesta a mano»; el detalle dice lo que dura el
  calentamiento.
- El 2.º partido del día sigue al 1.º: su «bus de HH:MM» es la salida a mano.
- Partidos de prueba (demo): el cambio solo se ve en la página, sin mandar nada, avisando de que no se guarda.

## Llave y contraseña

- Un **token de GitHub de grano fino** (uno solo) que crea el dueño del repositorio: solo el repositorio
  albovy/calendario-dompavolei y solo el permiso **Actions: lectura y escritura**. La página solo acepta los de
  grano fino (`github_pat_`): uno clásico suele abrir todos los repositorios.
- **Contraseña de los entrenadores** (para no repartir el token): el dueño, con el token puesto en «Modo
  entrenador», crea en «Contraseña para los entrenadores» la llave cifrada: AES-GCM con una clave de
  PBKDF2-SHA-256 (600 000 vueltas, sal al azar), `v1.<vueltas>.<sal>.<iv>.<cifrado>` en base64url. Va en
  `config.json › edicion › cifrada` → `D.edicion.cifrada`. El entrenador escribe la contraseña (da igual
  mayúsculas, espacios o guiones); la página la descifra en su navegador (con otra contraseña, AES-GCM falla),
  la comprueba con GitHub y la recuerda, con la `cifrada` de la que salió: si `cifrada` cambia o se quita, se
  olvida (la pegada tal cual, no). La contraseña: solo la de «Sugerir», 4 grupos de 4 letras y cifras al azar
  (~79 bits); una pensada, aunque sea larga, se adivina probando y el texto cifrado es público (también en el
  historial). «Sugerir» otra vez borra lo cifrado con la anterior. Para quitar el acceso de verdad: token nuevo
  en GitHub (el viejo, borrado), contraseña nueva y `cifrada` nueva.
- Si al guardar GitHub contesta 401 (token caducado o borrado), la página lo olvida y pide la contraseña (o una
  llave nueva) otra vez.
- Con él se pueden lanzar, parar, repetir, desactivar y borrar ejecuciones de las tareas del repositorio y poner
  cualquier hora a cualquier partido (con formato válido); no se puede tocar el código ni los archivos. Todo
  sale a nombre del dueño. Se revoca en GitHub y se crea otro.
- Se queda en el navegador de cada entrenador (localStorage, en `albovy.github.io`: ahí solo deben ir páginas
  propias). El token nunca va en la página publicada ni en el repositorio (solo cifrado). Claude nunca ve ni
  escribe el token ni la contraseña.

## Workflow (salida.yml, aparte de calendario.yml)

Primera idea: entradas en `calendario.yml`. Descartada: allí una ejecución nueva cancela la que siga en marcha
(`cancel-in-progress`, por las atascadas), así que un cambio que estuviera esperando máquina se perdería si
llegaba la ejecución de la hora u otro cambio.

- `salida.yml`: solo `workflow_dispatch`, con `partido` (obligatorio, texto
  `id:<8 caracteres del UID> · aaaa-mm-dd HH:MM · LOCAL vs VISITANTE`), `tipo` (`salida` o `calentamiento`) y
  `hora` (`HH:MM` o vacía). `concurrency` por partido sin cancelar la que está en marcha: los cambios de un
  partido van en fila (vale el último) y los de partidos distintos no se esperan. En Linux (no habla con la
  federación; arranca en segundos).
- Paso «Guardar la hora»: las entradas en variables de entorno (nunca `${{ }}` dentro del `run:`, para que no se
  pueda inyectar nada), y `RAMA` (la rama desde la que se lanzó: config.json › edicion › rama, «main»); hasta 5
  intentos de: fetch, reset a `origin/$RAMA`, `node src/manuales.js` (valida y actualiza `salidas-manuales.json`;
  con una entrada mala, o si el archivo no se puede leer, error y nada más; los mensajes no repiten lo que
  llega y el texto de los equipos no admite «::», «##[» ni caracteres de control, para que no se cuelen órdenes
  en el registro de Actions), commit y push. Si otro cambio se guardó a la vez, el push falla y el siguiente
  intento lo rehace encima.
- Paso «Publicar la web»: `gh workflow run calendario.yml --ref "$RAMA"` con el token de la ejecución
  (`actions: write`). Un push con ese token no lanza workflows, pero un workflow_dispatch sí.

## Generador (src)

- `src/salidas.js` (`anadirSalidas`): fuera, `calentamiento = salida + viaje`.
- `src/manuales.js`: leer/escribir `salidas-manuales.json` ({ id: { partido, tipo, hora, texto, cambiado } };
  con BOM también; roto: al publicar, aviso; al guardar, error), validar un cambio, aplicarlo (o quitarlo) y
  aplicar las horas a mano a los partidos (fuera: salida, inicio y calentamiento al llegar; en casa:
  calentamiento e inicio; con `horaManual`), o avisar de las que ya no valen. Uso por consola desde el workflow
  (`PARTIDO`, `TIPO`, `HORA`).
- `main.js`: después de `anadirSalidas`, aplicar las horas a mano y avisar de las caducadas.
- `html.js`: en cada partido `id` (8 caracteres del UID) y `sm: 1` si la hora es a mano; `D.edicion`
  ({ repo, workflow, rama, cifrada? }) desde config.json › `edicion` (sin ella, no hay edición).
- `plantilla.html`: «Modo entrenador» (contraseña o llave, y crear la contraseña), botón, editor con la pista
  del calentamiento, llamada a la API de GitHub (`POST /repos/{repo}/actions/workflows/{workflow}/dispatches`),
  mensajes de error claros (llave mala o caducada, sin respuesta, hora después del partido o con la que se
  llegaría tarde), marca «puesta a mano», calentamiento con su duración. Las recargas automáticas esperan si el
  editor está a la vista o mandando.
- `.ics`, WhatsApp, Excel y «Pedir bus» usan `salida`, `inicio` y `calentamiento` (sin viaje calculado, el correo
  no da hora de llegada a la vuelta).

## Pruebas

- manuales.js: validación (formato del partido, tipo y hora; hora antes del partido; nada de «::» ni «##[» en
  el registro), último gana, misma hora sin cambios, quitar, archivo con BOM o roto, aplicar (salida más tarde o
  más temprano, llegar tarde, sin viaje, en casa, fecha cambiada, casa/fuera cambiado, 2.º partido, sin hora),
  consola.
- salidas.js: el calentamiento de fuera, al llegar.
- main: con `salidas-manuales.json`, salida de fuera y calentamiento en casa llegan a la página, al .ics y a
  WhatsApp; con la fecha cambiada, aviso.
- Página: sin llave no hay botón; con llave, el editor (fuera y en casa) y su pista; la petición a GitHub (URL,
  cabeceras, cuerpo); respuestas 204 / 401 / 403 / 404 / 422 / 500 / sin respuesta; hora vacía, la misma,
  después del partido o llegando tarde; tras «Enviado» (sin WhatsApp ni «Pedir bus» con la hora vieja, deshacer);
  llave clásica rechazada; 401 olvida la llave; marca «puesta a mano»; demo; recargas; la llave no sale en la
  página publicada. Contraseña: descifrar con la buena (con mayúsculas o sin guiones también; y comprobar con
  GitHub), la mala no manda nada, crear la llave cifrada (solo la de «Sugerir»; «Sugerir» otra vez la borra; lo
  creado se descifra con Node con la misma contraseña), olvidar la llave si `cifrada` cambia o se quita.
  Además, a mano en Edge: crear, publicar y entrar con la contraseña.
- Workflow: entradas, concurrencia por partido, sin `${{ }}` dentro de ningún `run:`, rama, reintentos desde lo
  último guardado, lanza la publicación. Además, a mano en un repositorio git de prueba: guardar, repetir,
  entrada con código inyectado (no se ejecuta), archivo roto (no se pisa) y dos cambios a la vez (quedan los dos).
