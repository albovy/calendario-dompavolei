# Mensaje para WhatsApp · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** botones «📋 Copiar» y «WhatsApp» en cada partido por jugar, con un mensaje para el grupo de
las familias (diseño: `docs/superpowers/specs/2026-09-25-mensaje-whatsapp-design.md`).

**Arquitectura:** el texto se prepara al generar la web, en `src/whatsapp.js` (función pura con pruebas);
`html.js` lo mete en los datos de cada partido (`wa`) y `plantilla.html` solo pone los botones.

**Tecnología:** Node ≥ 20 sin dependencias, `node:test`. Convenciones del repositorio: español, fechas
«de pared» (Date cuyos campos UTC son la hora de Galicia; se leen con `getUTC*`), sin dependencias.
Commits con `git -c user.name=albovy -c user.email=25620656+albovy@users.noreply.github.com commit` y la
línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Los archivos del repositorio usan CRLF en
la copia de trabajo: al editar con scripts, conservar el fin de línea.

---

### Tarea 1: `MESES` y `src/whatsapp.js`

**Archivos:** modificar `src/util.js` (junto a `DIAS`), crear `src/whatsapp.js` y `test/whatsapp.test.js`.

- [ ] **Paso 1: pruebas que fallan** (`test/whatsapp.test.js`):

```js
// Pruebas de src/whatsapp.js: el mensaje para el grupo de WhatsApp de las familias.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensajesWhatsApp } from '../src/whatsapp.js';
import { fechaPared } from '../src/util.js';

const HOY = fechaPared(2026, 9, 25, 12, 0);
const PABELLONES = { 'PABELLÓN COLEGIO SAN NARCISO PISTA 1': { municipio: 'Marín', lat: 42.3905, lon: -8.7076 } };
const OPCIONES = {
  salidas: { origen: 'Os Remedios' }, pedirBus: { dirOrigen: 'Rúa Pardo de Cela, 2, Ourense' }, duracion: 120,
  pabellones: PABELLONES, hoy: HOY,
};

// Partido del IF1 como los de convertirPartidos + anadirSalidas (solo lo que usa whatsapp.js).
function partido(cambios = {}) {
  const fecha = cambios.fecha ?? fechaPared(2026, 9, 26, 10, 0);
  return {
    fecha, temporada: 2026, estado: 'confirmada', local: 'SEI SAN NARCISO IF', visitante: 'DOMPAVOLEI IF1',
    esLocal: false, esVisitante: true, condicion: 'visitante', nuestros: ['DOMPAVOLEI IF1'], rival: 'SEI SAN NARCISO IF',
    competicion: 'TORNEO APERTURA INFANTIL F', categoria: 'Infantil F', pabellon: 'PABELLÓN COLEGIO SAN NARCISO PISTA 1',
    inicio: fecha, salida: null, calentamiento: null, viajeMin: null, enCasa: false, municipio: 'Marín', segundo: false,
    ...cambios,
  };
}

test('mensajesWhatsApp: fuera, en bus y con dos partidos el mismo día: un mensaje, en el primero', () => {
  const primero = partido({ salida: fechaPared(2026, 9, 26, 7, 15), calentamiento: fechaPared(2026, 9, 26, 9, 0), viajeMin: 105 });
  const segundo = partido({
    fecha: fechaPared(2026, 9, 26, 11, 30), local: 'DOMPAVOLEI IF1', visitante: 'CV OLEIROS IFA', esLocal: true, esVisitante: false,
    condicion: 'local', rival: 'CV OLEIROS IFA', segundo: true,
  });
  const m = mensajesWhatsApp([segundo, primero], OPCIONES);
  assert.deepEqual([...m.keys()], [primero]);
  assert.equal(m.get(primero), [
    '🏐 *DOMPAVOLEI IF1* (Infantil F)',
    '📅 *Sábado 26 de septiembre*',
    '',
    '🚌 *Salida: 07:15* desde Os Remedios',
    '    (Rúa Pardo de Cela, 2, Ourense)',
    '🏟️ PABELLÓN COLEGIO SAN NARCISO PISTA 1 (Marín)',
    '    https://www.google.com/maps/search/?api=1&query=42.3905,-8.7076',
    '🔥 Calentamiento: 09:00',
    '🆚 10:00 contra SEI SAN NARCISO IF',
    '🆚 11:30 contra CV OLEIROS IFA',
    '🔙 Vuelta a Os Remedios hacia las 15:15 (aprox.)',
  ].join('\n'));
});

test('mensajesWhatsApp: vuelta redondeada al alza a 15 min; un partido en otro pabellón', () => {
  const a = partido({ salida: fechaPared(2026, 9, 26, 7, 15), calentamiento: fechaPared(2026, 9, 26, 9, 0), viajeMin: 100 });
  const b = partido({ fecha: fechaPared(2026, 9, 26, 12, 0), local: 'CV OLEIROS IFA', rival: 'CV OLEIROS IFA', pabellon: 'OTRO PABELLÓN' });
  const lineas = mensajesWhatsApp([a, b], OPCIONES).get(a).split('\n');
  assert.equal(lineas.at(-2), '🆚 12:00 contra CV OLEIROS IFA (en OTRO PABELLÓN)');
  // 12:00 + 120 min de partido + 100 de viaje = 15:40 -> 15:45.
  assert.equal(lineas.at(-1), '🔙 Vuelta a Os Remedios hacia las 15:45 (aprox.)');
});

test('mensajesWhatsApp: en casa, sin bus ni vuelta', () => {
  const casa = partido({
    fecha: fechaPared(2026, 10, 4, 11, 30), local: 'DOMPAVOLEI CF1', visitante: 'PESCADOR XAV SANXENXO', esLocal: true,
    esVisitante: false, condicion: 'local', nuestros: ['DOMPAVOLEI CF1'], rival: 'PESCADOR XAV SANXENXO', categoria: 'Cadete F',
    pabellon: 'ANEXO OS REMEDIOS PISTA 1', municipio: 'Ourense', enCasa: true, calentamiento: fechaPared(2026, 10, 4, 10, 30),
  });
  assert.equal(mensajesWhatsApp([casa], OPCIONES).get(casa), [
    '🏐 *DOMPAVOLEI CF1* (Cadete F)',
    '📅 *Domingo 4 de octubre*',
    '',
    '🏟️ ANEXO OS REMEDIOS PISTA 1 (en casa)',
    '    https://www.google.com/maps/search/?api=1&query=ANEXO%20OS%20REMEDIOS%20PISTA%201%2C%20Ourense',
    '🔥 Calentamiento: 10:30',
    '🆚 11:30 contra PESCADOR XAV SANXENXO',
  ].join('\n'));
});

test('mensajesWhatsApp: sin hora, hora provisional, fecha sin confirmar y partidos pasados', () => {
  const pasado = partido({ fecha: fechaPared(2026, 9, 19, 10, 0) });
  const deHoy = partido({ fecha: fechaPared(2026, 9, 25, 18, 0) });
  const sinHora = partido({ fecha: fechaPared(2026, 10, 3), estado: 'sinhora', pabellon: 'VALLE INCLAN', municipio: '' });
  const provisional = partido({
    fecha: fechaPared(2026, 10, 10, 12, 0), estado: 'provisional', pabellon: 'PAVILLÓN MUNICIPAL DE LALÍN - PISTA 1', municipio: 'Lalín',
  });
  const pendiente = partido({ fecha: fechaPared(2026, 10, 17), estado: 'pendiente' });
  const m = mensajesWhatsApp([pasado, deHoy, sinHora, provisional, pendiente], { ...OPCIONES, pabellones: null });
  assert.deepEqual([...m.keys()], [deHoy, sinHora, provisional]);
  assert.equal(m.get(sinHora), [
    '🏐 *DOMPAVOLEI IF1* (Infantil F)',
    '📅 *Sábado 3 de octubre*',
    '',
    '⏰ Hora por confirmar',
    '🏟️ VALLE INCLAN',
    '    https://www.google.com/maps/search/?api=1&query=VALLE%20INCLAN%2C%20Galicia',
    '🆚 Contra SEI SAN NARCISO IF (hora por confirmar)',
  ].join('\n'));
  // El municipio ya va en el nombre del pabellón: no se repite.
  assert.deepEqual(m.get(provisional).split('\n').slice(3), [
    '⚠️ Horario provisional: puede cambiar',
    '🏟️ PAVILLÓN MUNICIPAL DE LALÍN - PISTA 1',
    '    https://www.google.com/maps/search/?api=1&query=PAVILL%C3%93N%20MUNICIPAL%20DE%20LAL%C3%8DN%20-%20PISTA%201%2C%20Lal%C3%ADn',
    '🆚 12:00 contra SEI SAN NARCISO IF',
  ]);
});

test('mensajesWhatsApp: derbi, sin horas de salida configuradas y sin pabellón', () => {
  const derbi = partido({
    fecha: fechaPared(2026, 10, 4, 10, 0), local: 'DOMPAVOLEI CF1', visitante: 'DOMPAVOLEI CF2', esLocal: true, esVisitante: true,
    condicion: 'derbi', nuestros: ['DOMPAVOLEI CF1', 'DOMPAVOLEI CF2'], rival: '', categoria: 'Cadete F', pabellon: '', municipio: '',
  });
  assert.equal(mensajesWhatsApp([derbi], { hoy: HOY }).get(derbi), [
    '🏐 *DOMPAVOLEI CF1 y DOMPAVOLEI CF2* (Cadete F)',
    '📅 *Domingo 4 de octubre*',
    '',
    '🏟️ Pabellón por confirmar',
    '🆚 10:00 DOMPAVOLEI CF1 - DOMPAVOLEI CF2',
  ].join('\n'));
});
```

- [ ] **Paso 2:** `node --test test/whatsapp.test.js` → falla (no existe el módulo).
- [ ] **Paso 3: implementar.** En `src/util.js`, tras `DIAS_CORTOS`:

```js
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre',
  'octubre', 'noviembre', 'diciembre'];
```

`src/whatsapp.js`:

```js
// Mensaje para el grupo de WhatsApp de las familias: día, salida del bus y desde dónde, pabellón (con
// enlace al mapa), calentamiento, partidos del día y vuelta aproximada. Uno por equipo y día; va en el
// primer partido del día de ese equipo, que es donde la página pone los botones «Copiar» y «WhatsApp».

import { conHora } from './partidos.js';
import { DIAS, MESES, clave, claveSinCaja, fmt, hora, soloDia, sumarMinutos, txt } from './util.js';

const SANGRIA = '    ';
const CUARTO_DE_HORA = 15 * 60000;

function mayuscula(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

// "Sábado 26 de septiembre".
function diaLargo(d) { return mayuscula(`${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`); }

// Pabellón con su municipio, si el nombre no lo lleva ya; en casa, "(en casa)".
function lugar(p) {
  if (p.enCasa) return `${p.pabellon} (en casa)`;
  if (!p.municipio || ` ${clave(p.pabellon)} `.includes(` ${clave(p.municipio)} `)) return p.pabellon;
  return `${p.pabellon} (${p.municipio})`;
}

// Enlace al mapa: con las coordenadas de pabellones.json si las hay; si no, buscando el nombre y el
// municipio, como el enlace del pabellón en la página.
function enlaceMapa(p, pabellones) {
  const k = pabellones ? claveSinCaja(pabellones, p.pabellon) : '';
  const e = k && Object.hasOwn(pabellones, k) ? pabellones[k] : null;
  const consulta = e && e.lat != null && e.lon != null
    ? `${Number(e.lat)},${Number(e.lon)}`
    : encodeURIComponent(`${p.pabellon}, ${p.municipio || 'Galicia'}`);
  return `https://www.google.com/maps/search/?api=1&query=${consulta}`;
}

function lineaPartido(x, derbi, pabellon) {
  const cruce = derbi ? `${x.local} - ${x.visitante}` : `contra ${x.rival}`;
  const donde = x.pabellon && x.pabellon !== pabellon ? ` (en ${x.pabellon})` : '';
  return conHora(x) ? `🆚 ${fmt(x.fecha, 'HH:mm')} ${cruce}${donde}` : `🆚 ${mayuscula(cruce)} (hora por confirmar)${donde}`;
}

// Mensaje de los partidos de un equipo en un día (ordenados por hora).
function mensaje(grupo, { salidas, pedirBus, duracion, pabellones }) {
  const p = grupo[0];
  const conHoras = grupo.filter(conHora);
  // El primer partido con hora manda para la salida, el calentamiento y el pabellón.
  const guia = conHoras[0] ?? p;
  const origen = salidas ? txt(salidas.origen) : '';
  const l = [`🏐 *${p.nuestros.join(' y ')}* (${txt(p.categoria)})`, `📅 *${diaLargo(p.fecha)}*`, ''];
  if (!conHoras.length) l.push('⏰ Hora por confirmar');
  else if (conHoras.some((x) => x.estado === 'provisional')) l.push('⚠️ Horario provisional: puede cambiar');
  if (guia.salida) {
    l.push(`🚌 *Salida: ${hora(guia.salida)}* desde ${origen}`);
    if (pedirBus?.dirOrigen) l.push(`${SANGRIA}(${pedirBus.dirOrigen})`);
  }
  if (guia.pabellon) l.push(`🏟️ ${lugar(guia)}`, `${SANGRIA}${enlaceMapa(guia, pabellones)}`);
  else l.push('🏟️ Pabellón por confirmar');
  if (guia.calentamiento) l.push(`🔥 Calentamiento: ${hora(guia.calentamiento)}`);
  for (const x of grupo) l.push(lineaPartido(x, p.condicion === 'derbi', guia.pabellon));
  // Vuelta: como en el correo de "Pedir bus", fin del último partido + viaje, al alza a 15 min.
  if (guia.salida && guia.viajeMin != null) {
    const llegada = sumarMinutos(conHoras[conHoras.length - 1].fecha, duracion + guia.viajeMin);
    const redondeada = new Date(Math.ceil(llegada.getTime() / CUARTO_DE_HORA) * CUARTO_DE_HORA);
    l.push(`🔙 Vuelta a ${origen} hacia las ${hora(redondeada)} (aprox.)`);
  }
  return l.join('\n');
}

// Mensajes de los partidos de hoy en adelante (hoy: Date de pared): Map partido -> texto, solo en el
// primer partido del día de cada equipo. Los partidos con la fecha sin confirmar no llevan mensaje.
// salidas: el de configSalidas o null; pedirBus: el de configPedirBus o null; duracion: minutos de un
// partido; pabellones: la caché de resolverPabellones o null.
export function mensajesWhatsApp(partidos, { salidas = null, pedirBus = null, duracion = 120, pabellones = null, hoy }) {
  const desde = soloDia(hoy).getTime();
  const grupos = new Map();
  for (const p of [...partidos].sort((a, b) => a.fecha - b.fecha)) {
    if (p.estado === 'pendiente' || soloDia(p.fecha).getTime() < desde) continue;
    const k = `${fmt(p.fecha, 'yyyy-MM-dd')}|${p.nuestros.join('|')}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(p);
  }
  const opciones = { salidas, pedirBus, duracion, pabellones };
  return new Map([...grupos.values()].map((g) => [g[0], mensaje(g, opciones)]));
}
```

- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5:** commit «Mensaje para el grupo de WhatsApp de las familias».

### Tarea 2: el mensaje en los datos de la página (`src/html.js`)

- [ ] **Paso 1: pruebas.** En `test/html.test.js`:
  - En «crearHtml: mismos datos…», las claves de `d.partidos[0]` terminan en `'mun', 'r', 'wa'`; el
    `assert.deepEqual(d.partidos, [...])` pasa a comparar `d.partidos.map(({ wa, ...resto }) => resto)` y
    se añade `assert.deepEqual(d.partidos.map((x) => Boolean(x.wa)), [true, false, true, false, true]);`
    (p1 abre el día 3/10 y p2 va en su mensaje; p4 tiene la fecha sin confirmar).
  - En «los valores que faltan…», `Object.keys(d.partidos[0]).length` pasa a 21.
  - Nueva prueba:

```js
test('crearHtml: mensaje de WhatsApp en el primer partido del día de cada equipo', () => {
  const salidas = { ...SALIDAS, origen: 'Os Remedios' };
  const p1 = partido({ salida: fechaPared(2026, 10, 3, 15, 0), calentamiento: fechaPared(2026, 10, 3, 16, 30), viajeMin: 30 });
  const p2 = partido({ fecha: fechaPared(2026, 10, 3, 19, 0), segundo: true });
  const d = datosDe(crearHtml(opciones({ partidos: [p1, p2], salidas, duracion: 90 })));
  assert.equal(d.partidos[1].wa, '');
  const lineas = d.partidos[0].wa.split('\n');
  assert.equal(lineas[0], '🏐 *DOMPAVOLEI IF1* (Infantil F)');
  assert.equal(lineas[3], '🚌 *Salida: 15:00* desde Os Remedios');
  // 19:00 + 90 min + 30 de viaje = 21:00.
  assert.equal(lineas.at(-1), '🔙 Vuelta a Os Remedios hacia las 21:00 (aprox.)');
});
```

- [ ] **Paso 2:** `node --test test/html.test.js` → fallan.
- [ ] **Paso 3: implementar** en `src/html.js`: `import { mensajesWhatsApp } from './whatsapp.js';`; en
  `crearHtml`, antes de `const datos`:

```js
  // Mensaje para el grupo de WhatsApp de las familias (en el primer partido del día de cada equipo).
  const mensajes = mensajesWhatsApp(partidos, { salidas, pedirBus, duracion: aEntero(duracion) || 120, pabellones, hoy: pared });
```

  y en cada partido, tras `r: …`: `wa: mensajes.get(p) ?? '',`.
- [ ] **Paso 4:** `npm test` → todo pasa.
- [ ] **Paso 5:** commit «Página: el mensaje de WhatsApp en los datos de cada partido».

### Tarea 3: los botones (`src/plantilla.html`)

- [ ] **Paso 1: estilos**, tras `.boton-bus:hover {…}`:

```css
.acciones-partido { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 9px; }
.acciones-partido .boton-bus { margin-top: 0; }
.boton-wa {
  display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 14px; border-radius: 999px;
  border: 1.5px solid var(--borde); background: var(--superficie); color: var(--tinta); text-decoration: none; cursor: pointer;
  font: 700 .88rem/1 var(--cond); letter-spacing: .06em; text-transform: uppercase;
}
.boton-wa:hover { border-color: var(--tinta-2); }
.boton-wa.wa { border-color: #25D366; }
```

  y en `@media print` se oculta también `.acciones-partido`.
- [ ] **Paso 2: botones**, tras `enlaceBus`:

```js
  // Botones para el grupo de WhatsApp de las familias: copiar el mensaje o abrir WhatsApp con él.
  function botonesWhatsApp(p) {
    if (!p.wa || yaJugado(p)) return '';
    return '<button type="button" class="boton-wa copiar" data-i="' + D.partidos.indexOf(p) + '">📋 Copiar</button>' +
      '<a class="boton-wa wa" href="' + esc('https://wa.me/?text=' + encodeURIComponent(p.wa)) + '" target="_blank" rel="noopener">WhatsApp</a>';
  }
  // Copia al portapapeles; si el navegador no deja (página sin https o antigua), con un <textarea>.
  function copiar(texto, boton) {
    var antes = boton.getAttribute('data-texto') || boton.textContent;
    boton.setAttribute('data-texto', antes);
    function hecho(ok) {
      boton.textContent = ok ? '✓ Copiado' : 'No se pudo copiar';
      $('estado').textContent = ok ? 'Mensaje copiado' : 'No se pudo copiar el mensaje';
      clearTimeout(boton.espera);
      boton.espera = setTimeout(function () { boton.textContent = antes; }, 2000);
    }
    function aMano() {
      var t = document.createElement('textarea');
      t.value = texto;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(t);
      hecho(ok);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(texto).then(function () { hecho(true); }, aMano);
    else aMano();
  }
```

- [ ] **Paso 3:** en `tarjeta`, `enlaceBus(p)` pasa a
  `(enlaceBus(p) || botonesWhatsApp(p) ? '<div class="acciones-partido">' + enlaceBus(p) + botonesWhatsApp(p) + '</div>' : '')`
  (mejor: guardar ambos en variables antes de montar el HTML).
- [ ] **Paso 4:** en el `click` de `main`, antes de lo demás:

```js
    var cp = ev.target.closest('.copiar');
    if (cp) { copiar(D.partidos[+cp.getAttribute('data-i')].wa, cp); return; }
```

- [ ] **Paso 5:** `npm test` (incluye la prueba de sintaxis de la plantilla) → todo pasa.
- [ ] **Paso 6:** commit «Página: botones Copiar y WhatsApp en los partidos por jugar».

### Tarea 4: README y prueba real

- [ ] **Paso 1:** en `README.md`, tras el párrafo de resultados: «En los partidos por jugar, los botones
  **Copiar** y **WhatsApp** preparan un mensaje para el grupo de las familias: día, salida y lugar,
  pabellón con mapa, calentamiento, partidos y vuelta aproximada.»
- [ ] **Paso 2:** generar con datos reales **sin tocar las cachés del repositorio**: copiar `config.json`,
  `pabellones.json`, `temporada-anterior.json` y `resultados.json` a una carpeta temporal y ejecutar
  `node src/main.js --config <tmp> --salida <tmp>/web --nombre-base calendario`; revisar los mensajes (`"wa":`)
  del HTML generado.
- [ ] **Paso 3:** commit «README: mensaje para WhatsApp».
