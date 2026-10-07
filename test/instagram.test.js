// Pruebas de src/instagram.js: lo que necesita el botón «Instagram» del modo entrenador junto a la página
// (arte.js y los logos del patrocinador) y los datos que lleva la página.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PATROCINADORES, prepararInstagram } from '../src/instagram.js';

const ARTE = readFileSync(new URL('../src/arte.js', import.meta.url));
const V = createHash('sha1').update(ARTE).digest('hex').slice(0, 8);

function carpetas() {
  const dir = mkdtempSync(join(tmpdir(), 'insta-'));
  const config = join(dir, 'config');
  const salida = join(dir, 'web');
  mkdirSync(join(config, 'patrocinadores'), { recursive: true });
  mkdirSync(salida, { recursive: true });
  return { dir, config, salida };
}

test('instagram: arte.js junto a la página, con su versión (para no cargar uno guardado de antes); sin patrocinador, la lista vacía', () => {
  const c = carpetas();
  try {
    assert.deepEqual(prepararInstagram({ cfg: {}, carpetaConfig: c.config, carpetaSalida: c.salida }), { patrocinadores: [], v: V });
    assert.deepEqual(readFileSync(join(c.salida, 'arte.js')), ARTE);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('instagram: los logos del patrocinador (config.json › instagram › patrocinadores) se publican con la página', (t) => {
  const c = carpetas();
  const avisos = [];
  t.mock.method(console, 'log', (x) => avisos.push(x));
  try {
    for (const f of ['panaderia.png', 'bar.JPG', 'tienda.webp']) writeFileSync(join(c.config, 'patrocinadores', f), f);
    const cfg = {
      instagram: {
        patrocinadores: [
          { logo: 'patrocinadores/panaderia.png', nombre: 'Panadería Pérez' },
          { logo: 'patrocinadores/bar.JPG', nombre: ' Bar ' },
          { logo: 'patrocinadores/no-esta.png', nombre: 'Falta' },
          { logo: '../config.json', nombre: 'Fuera' },
          { logo: 'patrocinadores/script.js', nombre: 'No es imagen' },
          { logo: 'patrocinadores/tienda.webp', nombre: 'WebP (no en iPhone antiguos)' },
          { logo: 'PATROCINADORES/panaderia.png', nombre: 'Carpeta en mayúsculas (GitHub Pages distingue)' },
          { logo: 'patrocinadores/panadería.png', nombre: 'Con acento' },
          'texto',
        ],
      },
    };
    assert.deepEqual(prepararInstagram({ cfg, carpetaConfig: c.config, carpetaSalida: c.salida }), {
      patrocinadores: [{ logo: 'patrocinadores/panaderia.png', nombre: 'Panadería Pérez' }, { logo: 'patrocinadores/bar.JPG', nombre: 'Bar' }], v: V,
    });
    assert.equal(readFileSync(join(c.salida, 'patrocinadores', 'panaderia.png'), 'utf8'), 'panaderia.png');
    assert.equal(avisos.length, 7);
    assert.match(avisos[0], /no-esta\.png.*no está/);
    assert.match(avisos[1], /patrocinadores\/<archivo>\.png.*sin acentos.*sin espacios/);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('instagram: como mucho 4 patrocinadores (más no se leen en la imagen)', (t) => {
  const c = carpetas();
  const avisos = [];
  t.mock.method(console, 'log', (x) => avisos.push(x));
  try {
    const lista = [];
    for (let i = 1; i <= 6; i++) {
      writeFileSync(join(c.config, 'patrocinadores', `p${i}.png`), 'x');
      lista.push({ logo: `patrocinadores/p${i}.png`, nombre: `P${i}` });
    }
    const r = prepararInstagram({ cfg: { instagram: { patrocinadores: lista } }, carpetaConfig: c.config, carpetaSalida: c.salida });
    assert.equal(MAX_PATROCINADORES, 4);
    assert.deepEqual(r.patrocinadores.map((p) => p.nombre), ['P1', 'P2', 'P3', 'P4']);
    assert.equal(avisos.length, 2);
    assert.match(avisos[0], /como mucho 4 patrocinadores/);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});

test('instagram: con "instagram": false, nada (ni arte.js)', () => {
  const c = carpetas();
  try {
    assert.equal(prepararInstagram({ cfg: { instagram: false }, carpetaConfig: c.config, carpetaSalida: c.salida }), null);
    assert.equal(existsSync(join(c.salida, 'arte.js')), false);
  } finally {
    rmSync(c.dir, { recursive: true, force: true });
  }
});
