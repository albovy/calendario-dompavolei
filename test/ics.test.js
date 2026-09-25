// Pruebas de src/ics.js (sin red). La cabecera y el plegado son los de New-Ics de calendario-voley.ps1;
// el título y el detalle de los eventos son más cortos que en el .ps1 (para que se lean bien en el móvil).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { crearIcs, lineaIcs, textoIcs } from '../src/ics.js';
import { fechaPared } from '../src/util.js';

// 24/09/2026 13:45:07 en Galicia = 11:45:07 UTC.
const GENERADO = { pared: new Date(Date.UTC(2026, 8, 24, 13, 45, 7)), utc: new Date(Date.UTC(2026, 8, 24, 11, 45, 7)) };

const SALIDAS = {
  origen: 'Os Remedios', lat: 42.4296, lon: -8.6446, calentamiento: 60, factorBus: 1.1, margen: 0,
  redondeoViaje: 15, redondeo: 15, radioCasaKm: 1, manual: new Map(),
};

function partido(cambios = {}) {
  const fecha = cambios.fecha ?? fechaPared(2026, 10, 3, 18, 30);
  return {
    fecha, temporada: 2026, estado: 'confirmada', local: 'DOMPAVOLEI CF1', visitante: 'CV VIGO',
    esLocal: true, esVisitante: false, condicion: 'local', nuestros: ['DOMPAVOLEI CF1'], rival: 'CV VIGO',
    competicion: 'LIGA GALEGA CADETE F', categoria: 'Cadete F', claveCategoria: 'cadete', ordenCategoria: 3,
    pabellon: 'PAVILLON DOS REMEDIOS', uid: 'aaaaaaaaaaaaaaaaaaaaaaaa@calendario-voley',
    inicio: fecha, salida: null, calentamiento: null, viajeMin: null, viajeFuente: '',
    enCasa: false, municipio: '', km: null, segundo: false, salidaPrimero: null,
    ...cambios,
  };
}

// Partido fuera con salida en bus, ya con los datos que rellena anadirSalidas.
function partidoFuera(cambios = {}) {
  return partido({
    fecha: fechaPared(2026, 10, 4, 12, 0), local: 'CLUB VOLEIBOL LALÍN', visitante: 'DOMPAVOLEI IF1',
    esLocal: false, esVisitante: true, condicion: 'visitante', nuestros: ['DOMPAVOLEI IF1'], rival: 'CLUB VOLEIBOL LALÍN',
    competicion: 'LIGA GALEGA INFANTIL F', categoria: 'Infantil F', claveCategoria: 'infantil', ordenCategoria: 2,
    pabellon: 'PAVILLÓN MUNICIPAL DE LALÍN - PISTA 1', uid: 'bbbbbbbbbbbbbbbbbbbbbbbb@calendario-voley',
    inicio: fechaPared(2026, 10, 4, 9, 45), salida: fechaPared(2026, 10, 4, 9, 45),
    calentamiento: fechaPared(2026, 10, 4, 11, 0), viajeMin: 75, viajeFuente: 'osrm', municipio: 'Lalín', km: 58.4,
    ...cambios,
  });
}

// Desplegado de RFC 5545: un CRLF seguido de un espacio continúa la línea anterior.
function lineas(ics) { return ics.replace(/\r\n /g, '').split('\r\n'); }
// Valores de una propiedad en los eventos (sin contar los de la zona horaria de la cabecera).
function propiedad(ics, nombre) {
  const todas = lineas(ics);
  return todas.slice(todas.indexOf('BEGIN:VEVENT'))
    .filter((l) => l.startsWith(`${nombre}:`) || l.startsWith(`${nombre};`));
}
// Las líneas de un evento tal como se escriben (plegadas).
function evento(ics, n = 0) {
  const fisicas = ics.split('\r\n');
  const ini = fisicas.map((l, i) => (l === 'BEGIN:VEVENT' ? i : -1)).filter((i) => i >= 0)[n];
  return fisicas.slice(ini, fisicas.indexOf('END:VEVENT', ini) + 1);
}

const CABECERA_ZONA = [
  'X-WR-TIMEZONE:Europe/Madrid',
  'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  'X-PUBLISHED-TTL:PT1H',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Madrid',
  'X-LIC-LOCATION:Europe/Madrid',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

describe('crearIcs', () => {
  test('calendario vacío: cabecera sin METHOD, zona horaria y nada más', () => {
    const ics = crearIcs([], 'Voleibol · DOMPAVOLEI JM1',
      'Partidos de DOMPAVOLEI JM1 (Juvenil M), temporada 2026/27. Fuente: Federación Galega de Voleibol.',
      120, GENERADO, SALIDAS);
    assert.equal(ics, [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//calendario-voley//Calendario de voleibol (volei.gal)//ES',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:Voleibol · DOMPAVOLEI JM1',
      'X-WR-CALDESC:Partidos de DOMPAVOLEI JM1 (Juvenil M)\\, temporada 2026/27. Fu',
      ' ente: Federación Galega de Voleibol.',
      ...CABECERA_ZONA,
      'END:VCALENDAR',
      '',
    ].join('\r\n'));
  });

  test('METHOD:PUBLISH solo cuando hay eventos, justo después de CALSCALE', () => {
    const fisicas = crearIcs([partido()], 'Voleibol', 'Desc', 120, GENERADO, null).split('\r\n');
    assert.deepEqual(fisicas.slice(3, 7), ['CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Voleibol', 'X-WR-CALDESC:Desc']);
    assert.deepEqual(fisicas.slice(7, 7 + CABECERA_ZONA.length), CABECERA_ZONA);
  });

  test('partido con hora (sin horas de salida): evento completo y corto', () => {
    const ics = crearIcs([partido()], 'Voleibol', 'Desc', 120, GENERADO, null, { prefijo: 'DOMPAVOLEI' });
    assert.deepEqual(evento(ics), [
      'BEGIN:VEVENT',
      'UID:aaaaaaaaaaaaaaaaaaaaaaaa@calendario-voley',
      'DTSTAMP:20260924T114507Z',
      'LAST-MODIFIED:20260924T114507Z',
      'SEQUENCE:29837505',
      'DTSTART;TZID=Europe/Madrid:20261003T183000',
      'DTEND;TZID=Europe/Madrid:20261003T203000',
      'TRANSP:OPAQUE',
      'SUMMARY:CF1 vs CV VIGO',
      'LOCATION:PAVILLON DOS REMEDIOS',
      'DESCRIPTION:DOMPAVOLEI CF1 - CV VIGO\\nLIGA GALEGA CADETE F',
      'CATEGORIES:Cadete F',
      'STATUS:CONFIRMED',
      'URL:https://volei.gal/competiciones/',
      'END:VEVENT',
    ]);
  });

  test('título: sin prefijo del club, el equipo va con su nombre completo', () => {
    const ics = crearIcs([partido()], 'Voleibol', 'Desc', 120, GENERADO, null);
    assert.deepEqual(propiedad(ics, 'SUMMARY'), ['SUMMARY:DOMPAVOLEI CF1 vs CV VIGO']);
    // Un prefijo que no es el principio del nombre (o no va seguido de espacio) no se quita.
    const otro = crearIcs([partido()], 'Voleibol', 'Desc', 120, GENERADO, null, { prefijo: 'DOMPA' });
    assert.deepEqual(propiedad(otro, 'SUMMARY'), ['SUMMARY:DOMPAVOLEI CF1 vs CV VIGO']);
  });

  test('DTSTAMP, LAST-MODIFIED y SEQUENCE salen de generado.utc', () => {
    const invierno = { pared: fechaPared(2026, 12, 15, 20, 5), utc: new Date(Date.UTC(2026, 11, 15, 19, 5, 59)) };
    const ics = crearIcs([partido()], 'Voleibol', 'Desc', 120, invierno, null);
    assert.deepEqual(propiedad(ics, 'DTSTAMP'), ['DTSTAMP:20261215T190559Z']);
    assert.deepEqual(propiedad(ics, 'LAST-MODIFIED'), ['LAST-MODIFIED:20261215T190559Z']);
    // Minutos desde 1970: crece en cada generación (una por hora).
    assert.deepEqual(propiedad(ics, 'SEQUENCE'), ['SEQUENCE:29956025']);
  });

  test('la duración cuenta desde la hora del partido', () => {
    const ics = crearIcs([partido()], 'Voleibol', 'Desc', 90, GENERADO, null);
    assert.deepEqual(propiedad(ics, 'DTEND'), ['DTEND;TZID=Europe/Madrid:20261003T200000']);
  });

  test('sin hora y pendiente: eventos de día completo, provisionales', () => {
    const sinHora = partido({ fecha: fechaPared(2026, 10, 31), estado: 'sinhora' });
    const pendiente = partido({ fecha: fechaPared(2026, 12, 31), estado: 'pendiente' });
    const ics = crearIcs([sinHora, pendiente], 'Voleibol', 'Desc', 120, GENERADO, SALIDAS, { prefijo: 'DOMPAVOLEI' });
    assert.deepEqual(propiedad(ics, 'DTSTART'), ['DTSTART;VALUE=DATE:20261031', 'DTSTART;VALUE=DATE:20261231']);
    assert.deepEqual(propiedad(ics, 'DTEND'), ['DTEND;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20270101']);
    assert.deepEqual(propiedad(ics, 'TRANSP'), ['TRANSP:TRANSPARENT', 'TRANSP:TRANSPARENT']);
    assert.deepEqual(propiedad(ics, 'STATUS'), ['STATUS:TENTATIVE', 'STATUS:TENTATIVE']);
    assert.deepEqual(propiedad(ics, 'SUMMARY'), [
      'SUMMARY:CF1 vs CV VIGO (sin hora)',
      'SUMMARY:CF1 vs CV VIGO (por confirmar)',
    ]);
    assert.deepEqual(propiedad(ics, 'DESCRIPTION'), [
      'DESCRIPTION:Hora por confirmar\\nDOMPAVOLEI CF1 - CV VIGO\\nLIGA GALEGA CADETE F',
      'DESCRIPTION:Fecha y hora por confirmar (día de la jornada prevista)\\nDOMPAVOLEI CF1 - CV VIGO\\nLIGA GALEGA CADETE F',
    ]);
  });

  test('hora provisional: título y descripción lo dicen', () => {
    const ics = crearIcs([partido({ estado: 'provisional' })], 'Voleibol', 'Desc', 120, GENERADO, null, { prefijo: 'DOMPAVOLEI' });
    assert.deepEqual(propiedad(ics, 'SUMMARY'), ['SUMMARY:CF1 vs CV VIGO (provisional)']);
    assert.deepEqual(propiedad(ics, 'DESCRIPTION'), ['DESCRIPTION:Hora provisional\\nDOMPAVOLEI CF1 - CV VIGO\\nLIGA GALEGA CADETE F']);
    assert.deepEqual(propiedad(ics, 'STATUS'), ['STATUS:TENTATIVE']);
  });

  test('derbi y pabellón sin confirmar', () => {
    const derbi = partido({
      visitante: 'DOMPAVOLEI CF2', esVisitante: true, condicion: 'derbi', rival: '',
      nuestros: ['DOMPAVOLEI CF1', 'DOMPAVOLEI CF2'], pabellon: '',
    });
    const ics = crearIcs([derbi], 'Voleibol', 'Desc', 120, GENERADO, null, { prefijo: 'DOMPAVOLEI' });
    assert.deepEqual(propiedad(ics, 'SUMMARY'), ['SUMMARY:CF1 vs CF2']);
    assert.deepEqual(propiedad(ics, 'DESCRIPTION'), ['DESCRIPTION:DOMPAVOLEI CF1 - DOMPAVOLEI CF2\\nLIGA GALEGA CADETE F']);
    assert.deepEqual(propiedad(ics, 'LOCATION'), []);
  });

  test('con salida en bus: 🚌, empieza a la hora de salida y lleva la hora del partido', () => {
    const ics = crearIcs([partidoFuera()], 'Voleibol', 'Desc', 120, GENERADO, SALIDAS, { prefijo: 'DOMPAVOLEI' });
    assert.deepEqual(evento(ics), [
      'BEGIN:VEVENT',
      'UID:bbbbbbbbbbbbbbbbbbbbbbbb@calendario-voley',
      'DTSTAMP:20260924T114507Z',
      'LAST-MODIFIED:20260924T114507Z',
      'SEQUENCE:29837505',
      'DTSTART;TZID=Europe/Madrid:20261004T094500',
      'DTEND;TZID=Europe/Madrid:20261004T140000',
      'TRANSP:OPAQUE',
      'SUMMARY:🚌 IF1 vs CLUB VOLEIBOL LALÍN (12:00)',
      'LOCATION:PAVILLÓN MUNICIPAL DE LALÍN - PISTA 1',
      'DESCRIPTION:Salida 09:45 desde Os Remedios · bus 1 h 15 min\\nCalentamiento',
      '  11:00 · partido 12:00\\nCLUB VOLEIBOL LALÍN - DOMPAVOLEI IF1\\nLIGA GALEG',
      ' A INFANTIL F',
      'CATEGORIES:Infantil F',
      'STATUS:CONFIRMED',
      'URL:https://volei.gal/competiciones/',
      'END:VEVENT',
    ]);
  });

  test('en casa: empieza a la hora de calentamiento, sin 🚌 y con la hora del partido en el título', () => {
    const casa = partido({
      inicio: fechaPared(2026, 10, 3, 17, 30), calentamiento: fechaPared(2026, 10, 3, 17, 30),
      enCasa: true, municipio: 'Pontevedra', km: 0.3,
    });
    const ics = crearIcs([casa], 'Voleibol', 'Desc', 120, GENERADO, SALIDAS, { prefijo: 'DOMPAVOLEI' });
    assert.deepEqual(propiedad(ics, 'DTSTART'), ['DTSTART;TZID=Europe/Madrid:20261003T173000']);
    assert.deepEqual(propiedad(ics, 'DTEND'), ['DTEND;TZID=Europe/Madrid:20261003T203000']);
    assert.deepEqual(propiedad(ics, 'SUMMARY'), ['SUMMARY:CF1 vs CV VIGO (18:30)']);
    assert.deepEqual(propiedad(ics, 'DESCRIPTION'), [
      'DESCRIPTION:En casa · calentamiento 17:30 · partido 18:30\\nDOMPAVOLEI CF1 - CV VIGO\\nLIGA GALEGA CADETE F',
    ]);
  });

  test('2º partido del día en el mismo pabellón: sin 🚌 y a la hora del partido', () => {
    const primero = partidoFuera();
    const segundo = partidoFuera({
      fecha: fechaPared(2026, 10, 4, 13, 30), inicio: fechaPared(2026, 10, 4, 13, 30), salida: null,
      calentamiento: fechaPared(2026, 10, 4, 12, 30), segundo: true, salidaPrimero: primero,
      uid: 'cccccccccccccccccccccccc@calendario-voley',
    });
    const ics = crearIcs([primero, segundo], 'Voleibol', 'Desc', 120, GENERADO, SALIDAS, { prefijo: 'DOMPAVOLEI' });
    assert.equal(propiedad(ics, 'SUMMARY')[1], 'SUMMARY:IF1 vs CLUB VOLEIBOL LALÍN');
    assert.equal(propiedad(ics, 'DTSTART')[1], 'DTSTART;TZID=Europe/Madrid:20261004T133000');
    assert.equal(propiedad(ics, 'DESCRIPTION')[1],
      'DESCRIPTION:2º partido del día: se va con el primero (salida 09:45)\\nCLUB VOLEIBOL LALÍN - DOMPAVOLEI IF1\\nLIGA GALEGA INFANTIL F');
  });

  test('LOCATION: se añade el municipio si no aparece como palabra en el nombre del pabellón', () => {
    const casos = [
      ['PAVILLON DOS REMEDIOS', 'Pontevedra', 'LOCATION:PAVILLON DOS REMEDIOS\\, Pontevedra'],
      ['PAVILLÓN MUNICIPAL DE LALÍN - PISTA 1', 'Lalín', 'LOCATION:PAVILLÓN MUNICIPAL DE LALÍN - PISTA 1'],
      ['PAZO DOS DEPORTES DE RIAZOR', 'A Coruña', 'LOCATION:PAZO DOS DEPORTES DE RIAZOR\\, A Coruña'],
      ['PAVILLÓN DE A CORUÑA', 'A Coruña', 'LOCATION:PAVILLÓN DE A CORUÑA'],
      ['PAVILLÓN VIGOBUS', 'Vigo', 'LOCATION:PAVILLÓN VIGOBUS\\, Vigo'],
      ['PABELLÓN OS REMEDIOS', '', 'LOCATION:PABELLÓN OS REMEDIOS'],
    ];
    for (const [pabellon, municipio, esperado] of casos) {
      const ics = crearIcs([partido({ pabellon, municipio })], 'Voleibol', 'Desc', 120, GENERADO, null);
      assert.deepEqual(propiedad(ics, 'LOCATION'), [esperado], `${pabellon} / ${municipio}`);
    }
  });

  test('todas las líneas terminan en CRLF y ninguna pasa de 75 octetos', () => {
    const largo = partido({
      local: 'A CORUÑA "VOLEI" & CIA; S.L., <B>',
      competicion: 'SEGUNDA DIVISIÓN NACIONAL \\ GRUPO B; FASE 1, XORNADA 7 🏐 ÑÁÉÍÓÚ ÇÜ àèìòù ñandú pingüino — «comillas» … fin',
    });
    const ics = crearIcs([largo, partidoFuera()], 'Voleibol · DOMPAVOLEI, CLUB', 'Descripción con ñ, 🏐 y 🚌', 120, GENERADO, null);
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.doesNotMatch(ics, /[^\r]\n|\r[^\n]/);
    for (const l of ics.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, l);
    assert.ok(lineas(ics).includes(
      'DESCRIPTION:A CORUÑA "VOLEI" & CIA\\; S.L.\\, <B> - CV VIGO\\n'
      + 'SEGUNDA DIVISIÓN NACIONAL \\\\ GRUPO B\\; FASE 1\\, '
      + 'XORNADA 7 🏐 ÑÁÉÍÓÚ ÇÜ àèìòù ñandú pingüino — «comillas» … fin'));
  });
});

describe('textoIcs', () => {
  test('escapa barra invertida, punto y coma, coma y saltos de línea', () => {
    assert.equal(textoIcs('a\\b;c,d\ne\r\nf'), 'a\\\\b\\;c\\,d\\ne\\nf');
    assert.equal(textoIcs(''), '');
    assert.equal(textoIcs(null), '');
  });
});

describe('lineaIcs', () => {
  // Parte los octetos por los CRLF y los decodifica en modo estricto: falla si un corte cae dentro
  // de una secuencia UTF-8.
  function fisicas(plegada) {
    const bytes = Buffer.from(plegada, 'utf8');
    const r = [];
    let ini = 0;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0x0D && bytes[i + 1] === 0x0A) { r.push(bytes.subarray(ini, i)); ini = i + 2; }
    }
    assert.equal(ini, bytes.length, 'termina en CRLF');
    const decodificador = new TextDecoder('utf-8', { fatal: true });
    return r.map((b) => ({ octetos: b.length, texto: decodificador.decode(b) }));
  }

  test('hasta 75 octetos no se pliega', () => {
    const l = 'x'.repeat(73) + 'ñ';   // 75 octetos
    assert.equal(lineaIcs(l), `${l}\r\n`);
  });

  test('ASCII: 75 octetos en la primera línea y 74 + espacio en las siguientes', () => {
    const l = 'a'.repeat(200);
    assert.deepEqual(fisicas(lineaIcs(l)).map((f) => f.octetos), [75, 75, 52]);
    assert.equal(lineaIcs(l).replace(/\r\n /g, ''), `${l}\r\n`);
  });

  test('nunca parte un carácter de varios octetos ni un emoji', () => {
    // Se prueba cada desfase posible para que el límite de 75 caiga en todas las posiciones.
    for (let desfase = 0; desfase < 8; desfase++) {
      const l = `DESCRIPTION:${'x'.repeat(desfase)}${'ñá€🏐🚌 '.repeat(30)}fin`;
      const plegada = lineaIcs(l);
      const partes = fisicas(plegada);
      assert.ok(partes.length > 1);
      partes.forEach((p, i) => {
        assert.ok(p.octetos <= 75, `línea de ${p.octetos} octetos`);
        assert.ok(p.texto.isWellFormed(), 'sin sustitutos sueltos');
        if (i > 0) assert.ok(p.texto.startsWith(' '));
      });
      assert.equal(partes.map((p, i) => (i ? p.texto.slice(1) : p.texto)).join(''), l);
    }
  });

  test('un carácter que no cabe pasa entero a la línea siguiente', () => {
    const l = `${'a'.repeat(74)}€b`;   // 74 + 3 octetos
    assert.equal(lineaIcs(l), `${'a'.repeat(74)}\r\n €b\r\n`);
    const e = `${'a'.repeat(73)}🏐b`;  // 73 + 4 octetos
    assert.equal(lineaIcs(e), `${'a'.repeat(73)}\r\n 🏐b\r\n`);
  });
});

test('crearIcs: con resultado, el marcador en el título (el del club primero) y los sets en el detalle', () => {
  const opciones = { prefijo: 'DOMPAVOLEI' };
  const titulo = (p) => propiedad(crearIcs([p], 'Cal', 'Desc', 120, GENERADO, SALIDAS, opciones), 'SUMMARY')[0];
  const detalle = (p) => propiedad(crearIcs([p], 'Cal', 'Desc', 120, GENERADO, SALIDAS, opciones), 'DESCRIPTION')[0];
  const ganado = partidoFuera({ resultado: { marcador: [0, 3], sets: [[24, 26], [23, 25], [20, 25]] } });
  assert.equal(titulo(ganado), 'SUMMARY:✅ IF1 3-0 CLUB VOLEIBOL LALÍN');
  assert.equal(detalle(ganado), 'DESCRIPTION:Sets: 26-24 · 25-23 · 25-20\\nCLUB VOLEIBOL LALÍN - DOMPAVOLEI IF1\\nLIGA GALEGA INFANTIL F');
  const perdido = partido({ resultado: { marcador: [1, 3], sets: [[25, 20], [20, 25], [18, 25], [22, 25]] } });
  assert.equal(titulo(perdido), 'SUMMARY:❌ CF1 1-3 CV VIGO');
  const derbi = partido({
    visitante: 'DOMPAVOLEI CF2', esVisitante: true, condicion: 'derbi', nuestros: ['DOMPAVOLEI CF1', 'DOMPAVOLEI CF2'], rival: '',
    resultado: { marcador: [3, 1], sets: [] },
  });
  assert.equal(titulo(derbi), 'SUMMARY:🏐 CF1 3-1 CF2');
  assert.equal(detalle(derbi), 'DESCRIPTION:DOMPAVOLEI CF1 - DOMPAVOLEI CF2\\nLIGA GALEGA CADETE F');
});
