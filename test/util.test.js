// Pruebas de src/util.js. Los valores esperados salen de ejecutar las funciones originales de
// calendario-voley.ps1 (PowerShell 5.1) con las mismas entradas.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as u from '../src/util.js';

// Caracteres invisibles, construidos con su código para que se vean en el código.
const NEL = String.fromCharCode(0x85);       // espacio para .NET, no para JavaScript
const BOM = String.fromCharCode(0xFEFF);     // espacio para JavaScript, no para .NET
const ZWNJ = String.fromCharCode(0x200C);    // &zwnj;
const REEMPLAZO = String.fromCharCode(0xFFFD);

// Comprueba una función con una tabla de [entrada, esperado].
function tabla(f, casos) {
  for (const [entrada, esperado] of casos) {
    assert.equal(f(entrada), esperado, `entrada: ${JSON.stringify(entrada)}`);
  }
}

// "aaaa-mm-dd HH:mm:ss" <-> Date de pared.
function pared(texto) {
  const [a, m, d, hh, mm, ss] = texto.split(/[- :]/).map(Number);
  return new Date(Date.UTC(a, m - 1, d, hh, mm, ss));
}
function textoPared(d) { return d.toISOString().slice(0, 19).replace('T', ' '); }

test('textoPlano', () => {
  tabla(u.textoPlano, [
    [null, ''],
    [undefined, ''],
    ['', ''],
    ['   ', ''],
    ['None', ''],
    ['none', ''],
    ['NONE', ''],
    ['Nonez', 'Nonez'],
    ['PM A PINGUELA<br>PM A PINGUELA - PISTA 1', 'PM A PINGUELA\nPM A PINGUELA - PISTA 1'],
    ['A <BR/> B', 'A\nB'],
    ['A< br / >B', 'A\nB'],
    ['A<Br >B', 'A\nB'],
    ['<b>Hola</b>   mundo', 'Hola mundo'],
    ['<span title="a>b">texto</span>', 'b">texto'],
    ['a\r\nb', 'a\nb'],
    ['línea1<br><br>línea2', 'línea1\nlínea2'],
    ['uno<br>\n<br>dos', 'uno\ndos'],
    ['  espacios \t múltiples  ', 'espacios múltiples'],
    [`a${NEL}b`, 'a b'],
    [`a${BOM}b`, `a${BOM}b`],
    [BOM, BOM],
  ]);
});

test('textoPlano: entidades HTML como WebUtility.HtmlDecode', () => {
  tabla(u.textoPlano, [
    ['x &amp; y &lt;z&gt; &quot;q&quot; &#39;s&#39; &apos;t&apos; &nbsp;fin', 'x & y <z> "q" \'s\' \'t\' fin'],
    ['&Aacute;LVAREZ &ntilde; &#233; &#xE9; &#XC1; &#x00e1;', 'ÁLVAREZ ñ é é Á á'],
    ['&hellip;&ndash;&euro;&rsquo;&Omega;&hearts;&thetasym;&zwnj;x', `…–€’Ω♥ϑ${ZWNJ}x`],
    ['&iexcl;&ordf;&yuml;&OElig;&fnof;&sigmaf;&trade;&hArr;&diams;', '¡ªÿŒƒς™⇔♦'],
    ['a&nbsp;b&ensp;c', 'a b c'],
    ['&nbsp;', ''],
    // Numéricas solo de 1 a FFFF; las demás (y las desconocidas o en mayúsculas) se quedan igual.
    ['&#0; &#65536; &#x1F600; &noexiste; &AMP; &amp', '&#0; &#65536; &#x1F600; &noexiste; &AMP; &amp'],
    ['&# 65; &#+66; &#-0; &#x 41; &#0x41; &#67 ;', 'A B &#-0; &#x 41; &#0x41; C'],
    ['&#; &;&&amp; a & b &#65&amp;', '&#; &;&& a & b &#65&'],
  ]);
});

test('unaLinea', () => {
  tabla(u.unaLinea, [
    ['A<br>B<br/>C', 'A B C'],
    ['A\nB', 'A B'],
    [null, ''],
    ['  x  <br>  y  ', 'x y'],
  ]);
});

test('sinTildes', () => {
  tabla(u.sinTildes, [
    [null, ''],
    ['', ''],
    ['Pontevedra ÁÉÍÓÚ ñ Ñ ü ç', 'Pontevedra AEIOU n N u c'],
    ['ª º ﬁ ß', 'ª º ﬁ ß'],
    ['São João', 'Sao Joao'],
  ]);
});

test('mayusculas y minusculas: carácter a carácter, como .NET', () => {
  assert.equal(u.mayusculas('straße ǆ ŉ'), 'STRAßE Ǆ ŉ');
  assert.equal(u.minusculas('İSTANBUL Σ'), 'İstanbul σ');
  assert.equal(u.mayusculas(null), '');
});

test('clave', () => {
  tabla(u.clave, [
    [null, ''],
    ['', ''],
    ['Dompavolei Cadete F', 'DOMPAVOLEI CADETE F'],
    ['PAZO DOS DEPORTES - PISTA 2', 'PAZO DOS DEPORTES PISTA 2'],
    ['Straße', 'STRA E'],
    ['1ª DIV. NACIONAL', '1 DIV NACIONAL'],
    ['  ñandú--xx  ', 'NANDU XX'],
    ['ǆ œuvre', 'UVRE'],
    [`x${NEL}y`, 'X Y'],
    ['dos  espacios', 'DOS ESPACIOS'],
  ]);
});

test('slug', () => {
  tabla(u.slug, [
    [null, 'calendario'],
    ['', 'calendario'],
    ['---', 'calendario'],
    ['Dompavolei Cadete F', 'dompavolei-cadete-f'],
    ['CLUB VOLEIBOL ÑANDÚ', 'club-voleibol-nandu'],
    ['Straße 1', 'stra-e-1'],
    ['¡Hola!', 'hola'],
    // Máximo 60 caracteres, sin guion al final.
    ['a'.repeat(59) + ' b c', 'a'.repeat(59)],
    ['a'.repeat(58) + ' bcd', 'a'.repeat(58) + '-b'],
    ['x'.repeat(70), 'x'.repeat(60)],
  ]);
});

test('sha1', () => {
  tabla(u.sha1, [
    ['hola', '99800b85d3383e3a2fb45eb7d0066a4879a9dad0'],
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['ÑANDU|2026', '5a6a05ebd20af24e53f9c501008dd7fa4c23a3c7'],
    ['ab😀', '36fe0fb1c006df78d54f071b145ffdc3159127f7'],
  ]);
});

test('pabellon', () => {
  tabla(u.pabellon, [
    [null, ''],
    ['', ''],
    ['None', ''],
    ['PM A PINGUELA<br>PM A PINGUELA - PISTA 1', 'PM A PINGUELA - PISTA 1'],
    ['A<br>A<br>B', 'A - B'],
    ['PISTA A<br>pista a', 'PISTA A - pista a'],
    ['Pab X<br>PAB X - PISTA 1', 'PAB X - PISTA 1'],
    ['X - 1<br>Y', 'X - 1 - Y'],
    ['ABC<br>AB<br>A', 'ABC'],
    ['PAZO DOS DEPORTES<br>pazo dos deportes - pista 2<br>OTRO', 'pazo dos deportes - pista 2 - OTRO'],
  ]);
});

test('infoCategoria', () => {
  const casos = [
    ['PRIMERA DIVISION NACIONAL', '1ª DIV. NACIONAL FEMENINA', 'Primera División Nacional F', 'senior', 6],
    ['SUPERLIGA 2', 'SUPERLIGA 2 MASCULINA', 'Superliga 2 M', 'senior', 6],
    ['CADETE', 'TORNEO APERTURA CADETE F', 'Cadete F', 'cadete', 3],
    ['ALEVIN', 'LIGA ALEVIN MIXTO', 'Alevín', 'alevin', 1],
    ['BENJAMIN', 'XOGADE BENJAMIN', 'Benjamín', 'benjamin', 0],
    ['', 'LIGA X', 'Sin Categoría', 'senior', 6],
    [null, null, 'Sin Categoría', 'otra', 99],
    ['XUVENIL-CADETE', 'COPA FEM.', 'Xuvenil-Cadete F', 'cadete', 3],
    ['INFANTIL', 'LIGA INFANTIL MASC', 'Infantil M', 'infantil', 2],
    ['INFANTIL F', 'LIGA INFANTIL F', 'Infantil F', 'infantil', 2],
    ['1a división', 'liga m', '1A División M', 'senior', 6],
    ['JUNIOR', 'CAMPEONATO GALLEGO JUNIOR FEMENINO', 'Junior F', 'junior', 5],
    ['SENIOR', 'LIGA SENIOR M ', 'Senior M', 'senior', 6],
    ['Cadete <br> femenino', 'Cto. &amp; Liga F', 'Cadete Femenino F', 'cadete', 3],
    ['ALEVÍN', 'X', 'Alevín', 'alevin', 1],
    ['SEGUNDA DIVISIÓN', 'SEGUNDA DIVISIÓN NACIONAL MASCULINO', 'Segunda División M', 'senior', 6],
    ['SUB-14', 'COPA', 'Sub-14', 'otra', 99],
    ['u14 fem', 'x', 'U14 Fem', 'otra', 99],
    ["o'donnell", 'y', "O'donnell", 'otra', 99],
    ['DIVISIONAL', 'z', 'Divisional', 'senior', 6],
    ['ALEVINÑA', 'z', 'Alevinña', 'alevin', 1],
    ['2ª DIVISION', 'LIGA 2ª DIVISION FEMENINA', '2ª División F', 'senior', 6],
    ['JUVENIL', 'COPA MASC', 'Juvenil M', 'juvenil', 4],
    ['OTRA COSA', 'TORNEO', 'Otra Cosa', 'otra', 99],
    ['CADETE M', 'CADETE F', 'Cadete M', 'cadete', 3],
    ['BENJAMÍN', 'TORNEO Fem.', 'Benjamín F', 'benjamin', 0],
  ];
  for (const [categoria, competicion, nombre, clave, orden] of casos) {
    assert.deepEqual(u.infoCategoria(categoria, competicion), { nombre, clave, orden }, `${categoria} / ${competicion}`);
  }
});

test('prefijoComun', () => {
  tabla(u.prefijoComun, [
    [['DOMPAVOLEI IF1', 'DOMPAVOLEI CF1'], 'DOMPAVOLEI'],
    [['Dompavolei IF1', 'DOMPAVOLEI CF1'], 'Dompavolei'],
    [['DOMPAVOLEI IF1', 'DOMPAVOLEI CF1', 'DOMPAVOLEI SM'], 'DOMPAVOLEI'],
    [['A B', 'A C'], ''],
    [['DOMPAVOLEI'], ''],
    [[], ''],
    [null, ''],
    [['X', '', null], ''],
    [['CLUB - A1', 'CLUB - B2'], 'CLUB'],
    [['ABC DEF', 'XYZ'], ''],
    [['S.D. OURENSE A', 'S.D. OURENSE B'], 'S.D. OURENSE'],
    [['ABCD', 'ABCE'], ''],
    [['CV VIGO A', 'CV VIGO A'], 'CV VIGO'],
    [['ÑANDÚ A', 'ñandú B'], 'ÑANDÚ'],
    [new Set(['DOMPAVOLEI IF1', 'DOMPAVOLEI CF1']), 'DOMPAVOLEI'],
  ]);
});

test('aEntero: como [int] de PowerShell', () => {
  tabla(u.aEntero, [
    [2.5, 2], [3.5, 4], [-2.5, -2], [-3.5, -4], [0.5, 0], [1.5, 2], ['90', 90], [null, 0], [7, 7],
  ]);
  assert.ok(Object.is(u.aEntero(-0.4), 0));
});

test('formatDuracion', () => {
  tabla(u.formatDuracion, [
    [0, '0 min'],
    [5, '5 min'],
    [59, '59 min'],
    [60, '1 h'],
    [75, '1 h 15 min'],
    [120, '2 h'],
    [135, '2 h 15 min'],
    [600, '10 h'],
    [-30, '-1 h -30 min'],
    [-60, '-1 h'],
    [2.5, '2 min'],
    [3.5, '4 min'],
    [90.5, '1 h 30 min'],
  ]);
});

test('repararTexto', () => {
  tabla(u.repararTexto, [
    [null, ''],
    ['', ''],
    ['normal', 'normal'],
    ['RÃºA', 'RúA'],
    ['rÃºa', 'rúa'],
    ['Â¿', '¿'],
    ['Ã©Ã±', 'éñ'],
    // Igual que el .ps1: "ã" y "â" también activan la reparación y estropean el texto.
    ['São Paulo', `S${REEMPLAZO}o Paulo`],
    ['Ã', REEMPLAZO],
    ['âÂ', REEMPLAZO + REEMPLAZO],
  ]);
});

test('fechaPared y campos UTC', () => {
  const d = u.fechaPared(2026, 10, 3, 11, 30);
  assert.equal(d.toISOString(), '2026-10-03T11:30:00.000Z');
  assert.equal(u.fechaPared(2026, 8, 1).toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(d.getUTCDay(), 6);
});

test('fmt, fechaCorta, anioTemporada, DIAS y operaciones con fechas', () => {
  const patrones = ['yyyy-MM-dd', 'dd/MM/yyyy', 'dd/MM/yyyy HH:mm', 'HH:mm', 'yyyyMMdd', "yyyyMMdd'T'HHmmss",
    'dd/MM', 'yyyyMMddHHmm', "yyyyMMdd'T'HHmmss'Z'"];
  const casos = [
    ['2026-10-03 11:30:00', ['2026-10-03', '03/10/2026', '03/10/2026 11:30', '11:30', '20261003', '20261003T113000', '03/10', '202610031130', '20261003T113000Z'],
      'sáb 03/10', 2026, '2026-10-03 10:00:00', '2026-10-04 11:30:00', '2026-10-03 00:00:00', 'sábado'],
    ['2026-07-31 23:59:59', ['2026-07-31', '31/07/2026', '31/07/2026 23:59', '23:59', '20260731', '20260731T235959', '31/07', '202607312359', '20260731T235959Z'],
      'vie 31/07', 2025, '2026-07-31 22:29:59', '2026-08-01 23:59:59', '2026-07-31 00:00:00', 'viernes'],
    ['2026-08-01 00:00:00', ['2026-08-01', '01/08/2026', '01/08/2026 00:00', '00:00', '20260801', '20260801T000000', '01/08', '202608010000', '20260801T000000Z'],
      'sáb 01/08', 2026, '2026-07-31 22:30:00', '2026-08-02 00:00:00', '2026-08-01 00:00:00', 'sábado'],
    ['2027-01-15 07:05:09', ['2027-01-15', '15/01/2027', '15/01/2027 07:05', '07:05', '20270115', '20270115T070509', '15/01', '202701150705', '20270115T070509Z'],
      'vie 15/01', 2026, '2027-01-15 05:35:09', '2027-01-16 07:05:09', '2027-01-15 00:00:00', 'viernes'],
    ['2026-12-31 18:00:00', ['2026-12-31', '31/12/2026', '31/12/2026 18:00', '18:00', '20261231', '20261231T180000', '31/12', '202612311800', '20261231T180000Z'],
      'jue 31/12', 2026, '2026-12-31 16:30:00', '2027-01-01 18:00:00', '2026-12-31 00:00:00', 'jueves'],
    ['2028-02-29 12:00:00', ['2028-02-29', '29/02/2028', '29/02/2028 12:00', '12:00', '20280229', '20280229T120000', '29/02', '202802291200', '20280229T120000Z'],
      'mar 29/02', 2027, '2028-02-29 10:30:00', '2028-03-01 12:00:00', '2028-02-29 00:00:00', 'martes'],
    // Noche del cambio de hora: la hora de pared no salta.
    ['2026-03-29 02:30:00', ['2026-03-29', '29/03/2026', '29/03/2026 02:30', '02:30', '20260329', '20260329T023000', '29/03', '202603290230', '20260329T023000Z'],
      'dom 29/03', 2025, '2026-03-29 01:00:00', '2026-03-30 02:30:00', '2026-03-29 00:00:00', 'domingo'],
  ];
  for (const [texto, formatos, corta, anio, menos90, mas1dia, dia, diaSemana] of casos) {
    const d = pared(texto);
    patrones.forEach((p, i) => assert.equal(u.fmt(d, p), formatos[i], `${texto} ${p}`));
    assert.equal(u.fechaCorta(d), corta);
    assert.equal(u.anioTemporada(d), anio);
    assert.equal(textoPared(u.sumarMinutos(d, -90)), menos90);
    assert.equal(textoPared(u.sumarDias(d, 1)), mas1dia);
    assert.equal(textoPared(u.soloDia(d)), dia);
    assert.equal(u.DIAS[d.getUTCDay()], diaSemana);
  }
  assert.equal(u.DIAS_CORTOS[pared('2026-10-04 00:00:00').getUTCDay()], 'dom');
  assert.equal(u.hora(pared('2026-10-03 09:05:00')), '09:05');
  assert.equal(u.hora(null), '');
});

test('fmt: un patrón no admitido es un error', () => {
  const d = u.fechaPared(2026, 10, 3);
  assert.throws(() => u.fmt(d, 'd/M/yy'), /Formato de fecha no admitido/);
  assert.throws(() => u.fmt(d, 'yyyy-MM-dd hh:mm'), /Formato de fecha no admitido/);
  assert.equal(u.fmt(d, "'día' dd"), 'día 03');
});

test('ahoraMadrid: hora de Galicia (con horario de verano) sin depender de la zona del equipo', () => {
  const casos = [
    ['2026-01-15T12:00:00Z', '2026-01-15 13:00:00'],
    ['2026-07-15T12:00:00Z', '2026-07-15 14:00:00'],
    ['2026-03-29T00:59:00Z', '2026-03-29 01:59:00'],
    ['2026-03-29T01:00:00Z', '2026-03-29 03:00:00'],
    ['2026-10-25T00:59:00Z', '2026-10-25 02:59:00'],
    ['2026-10-25T01:00:00Z', '2026-10-25 02:00:00'],
    ['2026-12-31T23:30:00Z', '2027-01-01 00:30:00'],
    ['2026-08-01T22:15:42Z', '2026-08-02 00:15:42'],
  ];
  for (const [instante, esperado] of casos) {
    assert.equal(textoPared(u.ahoraMadrid(new Date(instante))), esperado, instante);
  }
  // Sin argumento: ahora mismo, una o dos horas por delante de UTC.
  const antes = Date.now();
  const diferencia = u.ahoraMadrid().getTime() - antes;
  assert.ok(Math.abs(diferencia - 3600000) < 60000 || Math.abs(diferencia - 7200000) < 60000, String(diferencia));
});

test('aviso y paso', (t) => {
  const log = t.mock.method(console, 'log', () => {});
  u.paso('Descargando partidos...');
  u.aviso('3 partido(s) sin fecha no se han incluido.');
  assert.deepEqual(log.mock.calls.map((c) => c.arguments), [
    ['  Descargando partidos...'],
    ['  ! 3 partido(s) sin fecha no se han incluido.'],
  ]);
});

test('compararTexto y ordenarUnicos: como Sort-Object (sin distinguir mayúsculas)', () => {
  assert.deepEqual(['b', 'Á', 'a', 'B', 'ñ', 'n', 'o'].sort(u.compararTexto), ['a', 'Á', 'b', 'B', 'n', 'ñ', 'o']);
  assert.deepEqual(u.ordenarUnicos(['PISTA 2', 'pista 1', 'PISTA 1', 'Pista 2']), ['pista 1', 'PISTA 2']);
  assert.deepEqual(u.ordenarUnicos([]), []);
  // Con clave, como Sort-Object Id -Unique: se queda el primero de cada clave.
  const clubs = [{ id: '20', n: 'a' }, { id: '10', n: 'b' }, { id: '20', n: 'c' }];
  assert.deepEqual(u.ordenarUnicos(clubs, (c) => c.id).map((c) => c.n), ['b', 'a']);
});

test('claveSinCaja: como las claves de @{} de PowerShell (sin distinguir mayúsculas)', () => {
  const cache = Object.assign(Object.create(null), { 'LEJOS - PISTA 1': 1, 'Ourense': 2 });
  assert.equal(u.claveSinCaja(cache, 'Lejos - Pista 1'), 'LEJOS - PISTA 1');
  assert.equal(u.claveSinCaja(cache, 'OURENSE'), 'Ourense');
  // Las tildes sí cuentan, y lo que no está se devuelve tal cual.
  assert.equal(u.claveSinCaja(cache, 'Ourénse'), 'Ourénse');
  assert.equal(u.claveSinCaja({}, 'x'), 'x');
  // También con Map.
  const equipos = new Map([['DOMPA CF1', 1]]);
  assert.equal(u.claveSinCaja(equipos, 'Dompa Cf1'), 'DOMPA CF1');
  assert.equal(u.claveSinCaja(equipos, 'DOMPA CF2'), 'DOMPA CF2');
});

test('comoLista, esObjeto y leerJson (como ConvertFrom-Json)', () => {
  assert.deepEqual(u.comoLista([1, 2]), [1, 2]);
  assert.deepEqual(u.comoLista(null), [null]);
  assert.deepEqual(u.comoLista({ a: 1 }), [{ a: 1 }]);
  assert.equal(u.esObjeto({}), true);
  assert.equal(u.esObjeto([]), false);
  assert.equal(u.esObjeto(null), false);
  assert.equal(u.esObjeto('x'), false);
  assert.equal(u.leerJson(''), null);
  assert.equal(u.leerJson('  \n'), null);
  assert.equal(u.leerJson(null), null);
  assert.deepEqual(u.leerJson(`${BOM}{"a":[1]}`), { a: [1] });
  assert.throws(() => u.leerJson('{ roto'));
});

test('fechaValida: solo fechas y horas que existen', () => {
  assert.equal(textoPared(u.fechaValida(2026, 10, 3, 11, 30, 15)), '2026-10-03 11:30:15');
  assert.equal(textoPared(u.fechaValida(2028, 2, 29)), '2028-02-29 00:00:00');
  for (const f of [[2026, 2, 29], [2026, 4, 31], [2026, 13, 1], [2026, 0, 1], [2026, 1, 0], [0, 1, 1], [2026, 1, 1, 24], [2026, 1, 1, 0, 60]]) {
    assert.equal(u.fechaValida(...f), null, JSON.stringify(f));
  }
  // Los años de dos cifras no se convierten en 19xx.
  assert.equal(u.fechaValida(26, 1, 1).getUTCFullYear(), 26);
});
