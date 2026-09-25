# Mensaje para el grupo de WhatsApp de las familias · diseño

Fecha: 2026-09-25. Aprobado por el usuario ("oki").

## Objetivo

En cada partido por jugar, dos botones para avisar a las familias por WhatsApp: **«📋 Copiar»**
(copia el mensaje) y **«WhatsApp»** (abre WhatsApp con el mensaje escrito; se elige el grupo).

## Qué partidos

- Un mensaje por **equipo y día**: si un equipo juega dos partidos el mismo día, los botones salen en
  el primero y el mensaje lleva los dos. En un derbi, el "equipo" son los dos del club.
- Solo partidos de hoy en adelante (los ya empezados no enseñan botones en la página).
- Los partidos con la **fecha sin confirmar** (estado "pendiente") no llevan mensaje.

## El texto (mensaje "completo")

```
🏐 *DOMPAVOLEI IF1* (Infantil F)
📅 *Sábado 26 de septiembre*

🚌 *Salida: 07:15* desde Os Remedios
    (Rúa Pardo de Cela, 2, Ourense)
🏟️ PABELLÓN COLEGIO SAN NARCISO PISTA 1 (Marín)
    https://www.google.com/maps/search/?api=1&query=42.39,-8.77
🔥 Calentamiento: 09:00
🆚 10:00 contra SEI SAN NARCISO IF
🆚 11:30 contra CV OLEIROS IFA
🔙 Vuelta a Os Remedios hacia las 15:15 (aprox.)
```

- **Salida** (solo si hay hora de salida): lugar de `config.json › salidas.origen` y, debajo, la
  dirección de `pedir_bus.direccion_origen` si la hay.
- **Pabellón**: con el municipio si su nombre no lo lleva; en casa, «(en casa)». Enlace al mapa con
  las coordenadas de `pabellones.json` si las hay; si no, búsqueda por nombre y municipio (como la
  página). Sin pabellón: «🏟️ Pabellón por confirmar».
- **Calentamiento**: el del primer partido con hora.
- **Partidos**: «🆚 HH:mm contra RIVAL»; sin hora, «🆚 Contra RIVAL (hora por confirmar)»; en un
  derbi, «LOCAL - VISITANTE»; si un partido es en otro pabellón, «(en PABELLÓN)».
- **Vuelta** (solo con salida en bus y tiempo de viaje): inicio del último partido + duración
  (`duracion_minutos`, 120) + viaje, redondeado al alza a 15 min: el mismo cálculo que el correo de
  «Pedir bus».
- Ningún partido con hora: «⏰ Hora por confirmar» en lugar de salida y calentamiento. Alguno con hora
  provisional: «⚠️ Horario provisional: puede cambiar».
- Los asteriscos son negrita en WhatsApp.

## Botones

- Junto a «Pedir bus», en una fila que se ajusta al ancho. No salen al imprimir ni en la vista Mes.
- «Copiar»: portapapeles (`navigator.clipboard`; si no se puede, el método antiguo con un
  `<textarea>`); el botón dice «✓ Copiado» 2 s y se anuncia a los lectores de pantalla.
- «WhatsApp»: enlace `https://wa.me/?text=…` en otra pestaña (en el móvil abre la aplicación).

## Piezas

- `src/whatsapp.js` (nuevo): `mensajesWhatsApp(partidos, { salidas, pedirBus, duracion, pabellones, hoy })`
  → `Map` partido → texto. Función pura, con pruebas en `test/whatsapp.test.js`.
- `src/util.js`: `MESES`.
- `src/html.js`: `wa` (texto o '') en cada partido de los datos de la página.
- `src/plantilla.html`: los dos botones y el copiado.
- `README.md`: una línea.
