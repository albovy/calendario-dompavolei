// Pruebas de src/arte.js (los artes para Instagram) con un lienzo 2D de mentira que apunta lo que se dibuja: el
// dibujo de verdad se mira a mano en el navegador (docs/superpowers/specs/2026-10-07-instagram-design.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODIGO = readFileSync(new URL('../src/arte.js', import.meta.url), 'utf8');
function cargar() {
  const ventana = {};
  vm.runInNewContext(CODIGO, { window: ventana });
  return ventana.DompaArte;
}
const ARTE = cargar();
// Los objetos de arte.js vienen de otro contexto (vm): para compararlos, a JSON.
const plano = (x) => JSON.parse(JSON.stringify(x));
const ROSA = '#A61D58';

// Lo único que puede usar el dibujo (Canvas 2D básico, también en Safari antiguos).
const METODOS = new Set(['fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect',
  'fill', 'stroke', 'clip', 'save', 'restore', 'translate', 'rotate', 'setLineDash', 'fillText', 'measureText',
  'drawImage', 'createLinearGradient']);
const PROPIEDADES = new Set(['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'globalCompositeOperation',
  'imageSmoothingEnabled', 'imageSmoothingQuality']);

// Lienzo de mentira: mide el texto por el tamaño de la letra y apunta los textos con su color. Cualquier otra
// cosa (filter, roundRect, letterSpacing...) es un error.
function lienzo() {
  const estado = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px x', textAlign: 'left' };
  const textos = [], llamadas = [], imagenes = [];
  const metodos = {
    measureText: (t) => ({ width: String(t).length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(estado.font)[1]) * 0.5) }),
    fillText: (t, x, y) => textos.push({ t: String(t), color: estado.fillStyle, font: estado.font, x, y }),
    createLinearGradient: () => ({ addColorStop() {} }),
    drawImage: (img) => imagenes.push(img),
  };
  return {
    textos, llamadas, imagenes,
    ctx: new Proxy({}, {
      get(_, k) {
        if (PROPIEDADES.has(k)) return estado[k];
        if (!METODOS.has(k)) throw new Error(`no se puede usar ${String(k)}`);
        return (...a) => { llamadas.push(k); return metodos[k] ? metodos[k](...a) : undefined; };
      },
      set(_, k, v) {
        if (!PROPIEDADES.has(k)) throw new Error(`no se puede usar ${String(k)}`);
        estado[k] = v; return true;
      },
    }),
  };
}

const ESCUDO = { naturalWidth: 512, naturalHeight: 512, nombre: 'escudo' };
const DATOS = {
  victoria: {
    local: 'DOMPA CADETE', visitante: 'PESCADOR XAV SANXENXO', nuestro: 'local', sl: 3, sv: 0,
    sets: [[25, 17], [25, 13], [25, 23]], fecha: 'Domingo 27 de septiembre', categoria: 'CADETE F', competicion: 'TORNEO APERTURA CADETE F',
  },
  derrota: {
    local: 'SEI SAN NARCISO IF', visitante: 'DOMPA INFANTIL 1', nuestro: 'visitante', sl: 3, sv: 1,
    sets: [[25, 20], [18, 25], [25, 20], [25, 22]], fecha: 'Sábado 26 de septiembre', categoria: 'INFANTIL F', competicion: '',
  },
  proximo: {
    local: 'CV OLEIROS IFA', visitante: 'DOMPA INFANTIL 1', nuestro: 'visitante', diaSemana: 'Sábado', dia: '3', mes: 'octubre',
    hora: '11:30', pabellon: 'Valle Inclán', lugar: 'Oleiros', categoria: 'INFANTIL F',
  },
};
const dibujar = (arte, formato, datos = DATOS[arte], extra = {}) => {
  const l = lienzo();
  const r = ARTE.dibujar(l.ctx, { arte, formato, datos, escudo: ESCUDO, logos: [], ...extra });
  return Object.assign(l, { r });
};

test('arte: los tres artes en historia y publicación, solo con Canvas 2D básico', () => {
  assert.deepEqual(plano(ARTE.medidas('historia')), { W: 1080, H: 1920 });
  assert.deepEqual(plano(ARTE.medidas('publicacion')), { W: 1080, H: 1350 });
  for (const arte of ['victoria', 'derrota', 'proximo']) {
    for (const formato of ['historia', 'publicacion']) {
      const l = dibujar(arte, formato);
      assert.deepEqual(plano(l.r), { arte, formato });
      assert.ok(l.llamadas.length > 200, `${arte} ${formato}`);
      assert.ok(l.imagenes.includes(ESCUDO), `${arte} ${formato}: el escudo`);
    }
  }
});

test('arte: lo que dice cada uno (titular, equipos, marcador, sets, fecha, lema, día y hora)', () => {
  const t = (l) => l.textos.map((x) => x.t).join('');
  const v = t(dibujar('victoria', 'historia'));
  for (const s of ['VICTORIA', 'DOMPA CADETE', 'PESCADOR XAV', 'SANXENXO', '3', '0', '25', '17', 'DOMINGO 27 DE SEPTIEMBRE', 'TORNEO APERTURA CADETE F', 'LOCAL', 'VISITANTE']) {
    assert.ok(v.includes(s.replace(/ /g, '')) || v.includes(s), s);
  }
  const d = t(dibujar('derrota', 'publicacion'));
  assert.ok(d.includes('SEGUIMOS') && d.includes('¡A por la siguiente!') && d.includes('DOMPAVOLEI · OURENSE'));
  const p = t(dibujar('proximo', 'historia'));
  for (const s of ['PRÓXIMO PARTIDO', 'CV OLEIROS IFA', 'DOMPA INFANTIL 1', 'VS', 'SÁBADO', '3', 'OCTUBRE', 'HORA', '11:30', 'Valle Inclán', ' · Oleiros', '¡VAMOS, DOMPA!']) {
    assert.ok(p.includes(s.replace(/ /g, '')) || p.includes(s), s);
  }
  // El rival lleva sus iniciales.
  assert.ok(t(dibujar('derrota', 'historia')).includes('SN'));
});

test('arte: el rosa es el color del equipo (nuestro nombre y nuestro marcador), el rival en negro', () => {
  const l = dibujar('victoria', 'historia');
  const color = (texto) => l.textos.filter((x) => x.t === texto).map((x) => x.color);
  assert.deepEqual(color('DOMPA CADETE'), [ROSA]);
  assert.ok(color('PESCADOR XAV').every((c) => c === '#121B2E'));
  assert.ok(color('3').includes(ROSA));   // nuestro marcador
  assert.equal(ARTE.colores.rosa, ROSA);
  // En la derrota, «SEGUIMOS» también en rosa.
  assert.deepEqual(dibujar('derrota', 'historia').textos.filter((x) => x.t === 'SEGUIMOS').map((x) => x.color), [ROSA]);
});

test('arte: casos límite: 5 sets, nombres muy largos, partido sin pabellón, con logos del patrocinador', () => {
  const cinco = { ...DATOS.victoria, sl: 3, sv: 2, sets: [[25, 27], [24, 26], [25, 23], [27, 25], [15, 13]] };
  for (const f of ['historia', 'publicacion']) {
    dibujar('victoria', f, cinco);
    dibujar('derrota', f, { ...DATOS.derrota, local: 'SOCIEDAD DEPORTIVA SAN NARCISO DE COMPOSTELA SUPERLARGUÍSIMO' });
    const sinPab = dibujar('proximo', f, { ...DATOS.proximo, pabellon: '', lugar: '' });
    assert.ok(sinPab.textos.some((x) => x.t === 'Pabellón por confirmar'));
    const logo = { naturalWidth: 300, naturalHeight: 100 };
    const conLogo = dibujar('proximo', f, DATOS.proximo, { logos: [logo] });
    assert.ok(conLogo.imagenes.includes(logo), f);
    assert.ok(!conLogo.textos.some((x) => x.t.includes('VAMOS')), f);
  }
});

test('arte: con datos que faltan o que no casan, error con la lista (y el lienzo en blanco, nunca a medias)', () => {
  assert.deepEqual(plano(ARTE.validar('victoria', DATOS.victoria)), []);
  assert.deepEqual(plano(ARTE.validar('otro', {})), ['arte desconocido']);
  assert.deepEqual(plano(ARTE.validar('proximo', { ...DATOS.proximo, hora: '' })), ['falta hora']);
  assert.deepEqual(plano(ARTE.validar('victoria', DATOS.derrota)), ['el marcador no es de victoria']);
  assert.deepEqual(plano(ARTE.validar('derrota', { ...DATOS.derrota, sets: [] })), ['faltan los sets']);
  const l = lienzo();
  assert.throws(() => ARTE.dibujar(l.ctx, { arte: 'proximo', formato: 'historia', datos: { ...DATOS.proximo, dia: '' } }),
    (e) => /No se puede hacer el arte/.test(e.message) && e.errores[0] === 'falta dia');
  assert.deepEqual(l.llamadas, ['fillRect']);   // solo el papel en blanco
});
