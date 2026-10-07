// Lo que necesita el botón «Instagram» del modo entrenador (ver plantilla.html y arte.js): arte.js junto a la
// página (la página lo carga solo al pulsar el botón) y los logos del patrocinador del club.
//
// config.json › instagram (opcional): { "patrocinadores": [{ "logo": "patrocinadores/<archivo>.png", "nombre": "…" }] }.
// Los logos (PNG, mejor con fondo transparente, o JPG; no WebP: los iPhone con iOS 13 o anterior no lo leen) van
// en la carpeta patrocinadores/ junto a config.json, con un nombre de archivo sin acentos ni espacios, y se
// copian junto a la página. Como mucho MAX_PATROCINADORES (más no se leen en la imagen). Sin patrocinador, el
// arte del próximo partido lleva «¡VAMOS, DOMPA!». "instagram": false quita el botón.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aviso, txt } from './util.js';

const ARTE = fileURLToPath(new URL('./arte.js', import.meta.url));
export const MAX_PATROCINADORES = 4;
// La carpeta, en minúsculas tal cual (GitHub Pages distingue mayúsculas); la extensión, como venga.
const RE_LOGO = /^patrocinadores\/[A-Za-z0-9_.-]+\.(?:[pP][nN][gG]|[jJ][pP][eE]?[gG])$/;

// Devuelve { patrocinadores: [{ logo, nombre }], v } (los logos que se han podido publicar; v: la versión de
// arte.js, para que cada página cargue el suyo y no uno guardado de antes) o null si está desactivado.
export function prepararInstagram({ cfg, carpetaConfig, carpetaSalida }) {
  const ig = cfg ? cfg.instagram : undefined;
  if (ig === false) return null;
  copyFileSync(ARTE, join(carpetaSalida, 'arte.js'));
  const v = createHash('sha1').update(readFileSync(ARTE)).digest('hex').slice(0, 8);
  const lista = ig && typeof ig === 'object' && Array.isArray(ig.patrocinadores) ? ig.patrocinadores : [];
  const patrocinadores = [];
  for (const p of lista) {
    const logo = p && typeof p === 'object' ? txt(p.logo).trim() : '';
    if (!RE_LOGO.test(logo) || logo.includes('..')) {
      aviso('config.json: cada patrocinador de "instagram" necesita "logo": "patrocinadores/<archivo>.png" (o .jpg), con un nombre de archivo de letras sin acentos, cifras, «-», «_» o «.» (sin espacios); se ignora uno.');
      continue;
    }
    const origen = join(carpetaConfig, logo);
    if (!existsSync(origen)) {
      aviso(`config.json: el logo ${logo} del patrocinador no está junto a config.json; se ignora.`);
      continue;
    }
    if (patrocinadores.length >= MAX_PATROCINADORES) {
      aviso(`config.json: como mucho ${MAX_PATROCINADORES} patrocinadores en la imagen (más no se leen); se ignora ${logo}.`);
      continue;
    }
    mkdirSync(join(carpetaSalida, 'patrocinadores'), { recursive: true });
    copyFileSync(origen, join(carpetaSalida, logo));
    patrocinadores.push({ logo, nombre: txt(p.nombre).trim() });
  }
  return { patrocinadores, v };
}
