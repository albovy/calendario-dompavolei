// Artes para Instagram de la página (botón «Instagram» del modo entrenador): victoria, derrota y próximo
// partido, en historia (1080×1920) o publicación (1080×1350). Estilo «Editorial limpio» con el rosa del equipo
// (docs/superpowers/specs/2026-10-07-instagram-design.md). Se publica junto a la página y esta lo carga solo al
// pulsar el botón. Todo con Canvas 2D básico (rellenos, trazos, arcos, degradados lineales, texto, drawImage):
// sin filtros, ni letterSpacing, ni roundRect, para que salga igual en Safari antiguos.
//
//   DompaArte.dibujar(ctx, { arte, formato, datos, escudo, logos })  arte: victoria | derrota | proximo;
//     formato: historia | publicacion; escudo: imagen (o null); logos: imágenes del patrocinador (o []).
//     El lienzo tiene que medir DompaArte.medidas(formato). Si faltan datos, lanza un Error con .errores.
//   DompaArte.validar(arte, datos) → lista de errores (vacía si vale).
//
// datos de un resultado: { local, visitante, nuestro: 'local'|'visitante', sl, sv, sets: [[l, v], ...], fecha
// («Domingo 27 de septiembre»), categoria («CADETE F»), competicion }. De un próximo partido: { local, visitante,
// nuestro, diaSemana, dia, mes, hora, pabellon, lugar, categoria }. Nunca nombres de jugadoras: son menores.
(function (raiz) {
  'use strict';

  /* ---------- paleta: el rosa es el color del equipo ---------- */
  const C = {
    paper: '#FFFFFF', ink: '#121B2E', muted: '#5F687A', soft: '#8C94A3',
    lose: '#8C94A3',          // marcador / puntos perdedores (≈3:1 sobre blanco)
    faint: '#C4C9D2',         // solo guiones y filetes
    hair: 'rgba(18,27,46,0.13)',
    navy: '#1E335F',
    rosa: '#A61D58', rosaMedio: '#E27BA8', rosaClaro: '#F9D6E5', rosaSobreRosa: '#F7C6DB'
  };
  const ROSA_LINEA = 'rgba(166,29,88,0.42)';
  // Seña de «nuestro equipo», igual en las tres artes: fila rosada + barra + escudo + nombre en rosa
  const OURS = { color: C.rosa, tint: 'rgba(166,29,88,0.15)', tint0: 'rgba(166,29,88,0.02)' };
  const THEME = { acc: C.rosa, orn: ROSA_LINEA };
  const FAM = { c: '"Barlow Condensed", "Arial Narrow", sans-serif', t: '"Barlow", Arial, sans-serif' };
  const ARTES = ['victoria', 'derrota', 'proximo'];

  // Estado de un dibujo (uno a la vez)
  let ctx, W, H, STORY, ARTE, CREST;

  function medidas(formato) { return { W: 1080, H: formato === 'historia' ? 1920 : 1350 }; }

  /* ---------- utilidades de texto ---------- */
  function setFont(weight, size, fam) { ctx.font = `${weight} ${size}px ${FAM[fam]}`; }
  function tw(t) { return ctx.measureText(t).width; }
  // Espaciado entre letras a mano (ctx.letterSpacing no existe en todos los Safari)
  function spacedWidth(text, sp) {
    const ch = [...text]; return ch.reduce((a, c) => a + tw(c), 0) + sp * (ch.length - 1);
  }
  function spaced(text, x, y, sp, align = 'left') {
    const ch = [...text]; const total = spacedWidth(text, sp);
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    ctx.textAlign = 'left';
    for (const c of ch) { ctx.fillText(c, cx, y); cx += tw(c) + sp; }
    return total;
  }
  function text(t, x, y, align = 'left') { ctx.textAlign = align; ctx.fillText(t, x, y); ctx.textAlign = 'left'; }
  function fit(t, weight, fam, max, maxW, min = 12) {
    let s = max; setFont(weight, s, fam);
    while (tw(t) > maxW && s > min) { s -= 1; setFont(weight, s, fam); }
    return s;
  }
  function spacedFit(t, weight, fam, max, maxW, spR, min = 12) { // como fit(), con espaciado proporcional
    let s = max; setFont(weight, s, fam);
    while (spacedWidth(t, s * spR) > maxW && s > min) { s -= 1; setFont(weight, s, fam); }
    return s;
  }
  function wrap(t, maxW) {
    const words = t.split(' '); const lines = []; let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (!cur || tw(cand) <= maxW) cur = cand; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function ellipsize(t, maxW) {
    if (tw(t) <= maxW) return t;
    while (t.length > 1 && tw(t + '…') > maxW) t = t.slice(0, -1).trimEnd();
    return t + '…';
  }
  function hline(x0, x1, y, color, lw = 2) {
    ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  function rrect(x, y, w, h, r) { // roundRect a mano (compatibilidad)
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  /* ---------- piezas gráficas ---------- */
  function crest(x, y, size) {
    if (!CREST) return;
    // Con 'multiply' un fondo blanco (si el escudo lo trae) desaparece sobre el papel.
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(CREST, x, y, size, size); ctx.restore();
  }
  function medallion(x, y, size) { // disco de papel + doble filete: aísla el escudo de la franja
    const cx = x + size / 2, cy = y + size / 2, r = size * 0.56;
    ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(cx, cy, r + 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = THEME.acc; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = THEME.orn; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, r + 12, 0, Math.PI * 2); ctx.stroke();
  }
  // Monograma del rival: iniciales (primera y última palabra significativa) en un círculo perfilado
  const STOP = new Set(['CLUB', 'CV', 'C.V.', 'CD', 'C.D.', 'SD', 'S.D.', 'AD', 'A.D.', 'UD', 'CDV', 'SCD', 'VOLEIBOL',
    'VOLEI', 'VÓLEI', 'VOLEY', 'VÓLEY', 'SOCIEDAD', 'SOCIEDADE', 'DEPORTIVA', 'DEPORTIVO', 'ASOCIACIÓN',
    'ASOCIACION', 'AGRUPACIÓN', 'AGRUPACION', 'CLUBE', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'E', 'DO', 'DA', 'DOS', 'DAS']);
  const CAT = /^(IF|IM|IFA|IFB|IMA|IMB|CF|CM|JF|JM|XF|XM|AF|AM|SF|SM|BF|BM|ALEV[IÍ]N|INFANTIL|CADETE|JUVENIL|XUVENIL|S[EÉ]NIOR|FEM|MASC|[A-D]|\d+)$/;
  function initials(name) {
    const all = String(name).toUpperCase().split(/\s+/).filter(Boolean);
    const ws = all.filter(w => !STOP.has(w) && !CAT.test(w));
    const use = ws.length ? ws : all;
    if (!use.length) return '';
    const first = [...use[0]][0], last = use.length > 1 ? [...use[use.length - 1]][0] : '';
    return first + last;
  }
  function monogram(cx, cy, r, ini) {
    ctx.strokeStyle = C.soft; ctx.lineWidth = Math.max(2.5, r * 0.06);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (!ini) return;
    // Barlow (no condensada): la «O» es redonda y no se confunde con un cero
    const fs = fit(ini, 600, 't', Math.round(r * (ini.length > 1 ? 0.78 : 0.9)), r * 1.34);
    ctx.fillStyle = C.soft; text(ini, cx, cy + fs * 0.35, 'center');
  }
  function pin(cx, cy, r, color, hole) { // marcador de lugar
    ctx.fillStyle = color; ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 2.18);
    ctx.lineTo(cx, cy + r * 2.1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = hole; ctx.beginPath(); ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2); ctx.fill();
  }
  function frame(inset) { // línea de banda de la pista
    ctx.strokeStyle = THEME.orn; ctx.lineWidth = 2;
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  }
  function attackMarks(inset, y) { // prolongación discontinua de la línea de ataque
    for (let i = 0; i < 3; i++) {
      const a = inset - 10 - i * 22;
      if (a - 12 < 0) break;
      hline(a - 12, a, y, THEME.orn); hline(W - a, W - a + 12, y, THEME.orn);
    }
    hline(inset, inset + 26, y, THEME.orn); hline(W - inset - 26, W - inset, y, THEME.orn);
  }
  function net(x0, x1, y) { // red: cinta + malla + varillas
    const h = 26;
    ctx.save();
    ctx.strokeStyle = THEME.orn; ctx.lineWidth = 1.5;
    for (let x = x0; x <= x1 + 0.5; x += 13) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke(); }
    for (let yy = y + 13; yy <= y + h; yy += 13) hline(x0, x1, yy, THEME.orn, 1.5);
    ctx.fillStyle = THEME.acc; ctx.fillRect(x0, y - 3, x1 - x0, 6); // cinta superior
    for (const ax of [x0, x1]) { // varillas (antenas) a rayas
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 ? C.paper : THEME.acc;
        ctx.fillRect(ax - 3, y - 44 + i * 10, 6, 10);
      }
      ctx.strokeStyle = THEME.acc; ctx.lineWidth = 1.5; ctx.strokeRect(ax - 3, y - 44, 6, 60);
    }
    ctx.restore();
  }
  function vsBadge(cx, cy, r) {
    ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = THEME.acc; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    setFont(700, Math.round(r * 0.9), 'c'); ctx.fillStyle = C.paper;
    text('VS', cx, cy + r * 0.32, 'center');
  }
  // Franja diagonal sólida (eco de la franja del escudo) + dos líneas paralelas, recortada a una caja
  function band(o) {
    ctx.save(); ctx.beginPath(); ctx.rect(o.x0, o.yTop, o.x1 - o.x0, o.yEnd - o.yTop); ctx.clip();
    const xAt = y => o.cx + (y - o.cy) * o.slope;
    const quad = (off, w) => {
      ctx.beginPath();
      ctx.moveTo(xAt(o.yTop) + off - w / 2, o.yTop); ctx.lineTo(xAt(o.yTop) + off + w / 2, o.yTop);
      ctx.lineTo(xAt(o.yEnd) + off + w / 2, o.yEnd); ctx.lineTo(xAt(o.yEnd) + off - w / 2, o.yEnd);
      ctx.closePath(); ctx.fill();
    };
    ctx.fillStyle = C.rosaMedio; quad(0, o.bw);
    ctx.fillStyle = C.rosa; quad(o.bw / 2 + o.bw * 0.28, o.bw * 0.075); quad(o.bw / 2 + o.bw * 0.5, o.bw * 0.03);
    ctx.restore();
  }
  // Confeti geométrico: ['r', x, y, [w, h], grados, color] rectángulo · ['t', x, y, lado, grados, color] triángulo
  function confetti(list) {
    for (const [k, x, y, s, rot, col] of list) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot * Math.PI / 180); ctx.fillStyle = col;
      if (k === 'r') ctx.fillRect(-s[0] / 2, -s[1] / 2, s[0], s[1]);
      else { ctx.beginPath(); ctx.moveTo(0, -s * 0.58); ctx.lineTo(s / 2, s * 0.29); ctx.lineTo(-s / 2, s * 0.29); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
  }

  /* ---------- fila de equipo ---------- */
  function fitName(name, maxW, max, min, maxH, rs) {
    for (let s = max; s >= min; s -= 1) {
      setFont(700, s, 'c'); const lines = wrap(name, maxW);
      const bh = (lines.length - 1) * s * 0.96 + s * 0.70 + s * 0.30 + rs * 0.70;
      if (lines.length <= 2 && lines.every(l => tw(l) <= maxW) && bh <= maxH) return { s, lines };
    }
    // No cabe ni al mínimo: 2 líneas como máximo y puntos suspensivos (también una palabra muy larga)
    setFont(700, min, 'c'); let lines = wrap(name, maxW);
    if (lines.length > 2) lines = [lines[0], lines.slice(1).join(' ')];
    return { s: min, lines: lines.map(l => ellipsize(l, maxW)) };
  }
  function rowLayout(o) {
    let scoreW = 0;
    if (o.score != null) { setFont(700, o.scoreSize, 'c'); scoreW = tw(String(o.score)); }
    const areaL = o.x0 + 30, areaR = o.x1 - (scoreW ? scoreW + 50 : 0);
    const f = fitName(o.name, areaR - areaL - o.icon - 26, o.nameMax, o.nameMin, o.h - 18, o.roleSize);
    setFont(700, f.s, 'c'); const nameW = Math.max(...f.lines.map(l => tw(l)));
    setFont(600, o.roleSize, 'c'); const roleW = spacedWidth(o.role, o.roleSize * 0.2);
    return Object.assign(f, { areaL, groupW: o.icon + 26 + Math.max(nameW, roleW) });
  }
  /* barra + escudo (nuestro) o monograma (rival) + nombre + rol + marcador */
  function teamRow(o, lay, ix) {
    lay = lay || rowLayout(o); ix = ix == null ? lay.areaL : ix;
    const cy = o.top + o.h / 2;
    if (o.ours) { // fila rosada (degradado lineal) + barra
      const g = ctx.createLinearGradient(o.bandL, 0, W - o.bandL, 0);
      g.addColorStop(0, OURS.tint); g.addColorStop(1, OURS.tint0);
      ctx.fillStyle = g; ctx.fillRect(o.bandL, o.top, W - o.bandL * 2, o.h);
      ctx.fillStyle = OURS.color; ctx.fillRect(o.x0, o.top + o.h * 0.14, 8, o.h * 0.72);
    }
    if (o.score != null) {
      setFont(700, o.scoreSize, 'c');
      ctx.fillStyle = o.ours ? OURS.color : (o.won ? C.ink : C.lose);
      text(String(o.score), o.x1, cy + o.scoreSize * 0.35, 'right');
    }
    if (o.ours) crest(ix - o.icon * 0.04, cy - o.icon / 2, o.icon);
    else monogram(ix + o.icon / 2, cy, o.icon * 0.40, initials(o.name));
    const nx = ix + o.icon + 26, s = lay.s, lines = lay.lines;
    const lh = s * 0.96, cap = s * 0.70, rs = o.roleSize, rgap = s * 0.30;
    const blockH = (lines.length - 1) * lh + cap + rgap + rs * 0.70;
    const by = cy - blockH / 2 + cap;
    ctx.fillStyle = o.ours ? OURS.color : C.ink; setFont(700, s, 'c');
    lines.forEach((l, i) => text(l, nx, by + i * lh));
    setFont(600, rs, 'c'); ctx.fillStyle = C.soft;
    spaced(o.role, nx + 2, by + (lines.length - 1) * lh + rgap + rs * 0.70, rs * 0.2);
  }

  /* ---------- parciales: columnas SET n, puntos local–visitante ---------- */
  function drawSets(x0, x1, y, sets, oursLocal, baseNum, baseLab) {
    hline(x0, x1, y, C.hair, 2);
    const n = sets.length, colW = (x1 - x0) / n, dash = '–';
    // El tamaño se ajusta al ancho de columna (con 5 sets «25–27» tiene que caber en ~170 px)
    const widest = s => Math.max(...sets.map(([a, b]) => {
      setFont(700, s, 'c'); const w = tw(String(a)) + tw(String(b));
      setFont(500, s, 'c'); return w + tw(dash) + s * 0.16;
    }));
    let num = baseNum; const mw = widest(baseNum);
    if (mw > colW - 28) num = Math.floor(baseNum * (colW - 28) / mw);
    const lab = Math.max(16, Math.round(baseLab * Math.min(1, num / baseNum * 1.08)));
    const top = y + 26, baseY = top + baseLab + baseNum * 0.86; // base fija: el pie no se mueve
    sets.forEach(([a, b], i) => {
      const cx = x0 + colW * (i + 0.5);
      if (i > 0) { ctx.strokeStyle = C.hair; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0 + colW * i, top); ctx.lineTo(x0 + colW * i, top + baseLab + baseNum * 0.95); ctx.stroke(); }
      setFont(600, lab, 'c'); ctx.fillStyle = C.soft;
      spaced(`SET ${i + 1}`, cx, top + baseLab * 0.9, lab * 0.22, 'center');
      const colL = oursLocal ? OURS.color : C.ink, colV = oursLocal ? C.ink : OURS.color;
      const la = String(a), lb = String(b);
      setFont(700, num, 'c'); const wa = tw(la), wb = tw(lb);
      setFont(500, num, 'c'); const wd = tw(dash) + num * 0.16;
      let x = cx - (wa + wd + wb) / 2;
      setFont(700, num, 'c'); ctx.fillStyle = a > b ? colL : C.lose; text(la, x, baseY); x += wa;
      setFont(500, num, 'c'); ctx.fillStyle = C.faint; text(dash, x + num * 0.08, baseY); x += wd;
      setFont(700, num, 'c'); ctx.fillStyle = b > a ? colV : C.lose; text(lb, x, baseY);
    });
    return baseY;
  }

  function folio(y) {
    setFont(600, 24, 'c'); ctx.fillStyle = C.soft;
    const t = 'DOMPAVOLEI · OURENSE';
    const w = spacedWidth(t, 6);
    spaced(t, W / 2, y, 6, 'center');
    hline(W / 2 - w / 2 - 70, W / 2 - w / 2 - 22, y - 8, C.faint, 2);
    hline(W / 2 + w / 2 + 22, W / 2 + w / 2 + 70, y - 8, C.faint, 2);
  }
  // Pie de los resultados: fecha grande + competición (si existe) + lema (derrota)
  function resultFooter(d, y, maxW, win, sz) {
    let s = spacedFit(d.fecha.toUpperCase(), 700, 'c', sz.date, maxW, 0.065);
    ctx.fillStyle = C.ink; spaced(d.fecha.toUpperCase(), W / 2, y, s * 0.065, 'center');
    if (d.competicion) {
      y += sz.gap;
      const t = d.competicion.toUpperCase();
      s = spacedFit(t, 600, 'c', sz.comp, maxW, 0.14);
      ctx.fillStyle = C.muted; spaced(t, W / 2, y, s * 0.14, 'center');
    }
    if (!win) {
      y += sz.gap + 6;
      setFont(600, sz.lema, 't'); ctx.fillStyle = C.rosa; text('¡A por la siguiente!', W / 2, y, 'center');
    }
    return y;
  }

  /* ---------- composición: RESULTADO (victoria / derrota) ---------- */
  function drawResult(d) {
    const win = ARTE === 'victoria';
    const oursLocal = d.nuestro === 'local';
    const kicker = 'RESULTADO FINAL · ' + d.categoria;
    const L = STORY ? 60 : 64;             // línea de banda (publicación: fuera del recorte 3:4 de la cuadrícula)
    const X0 = STORY ? 110 : 108, X1 = W - X0;
    const cfg = STORY ? { icon: 118, nameMax: 70, nameMin: 36, scoreSize: 230, roleSize: 26 }
      : { icon: 104, nameMax: 62, nameMin: 34, scoreSize: 200, roleSize: 24 };
    const rowsAt = (top, h, g) => {
      const rows = [
        { name: d.local, role: 'LOCAL', ours: oursLocal, score: d.sl, won: d.sl > d.sv },
        { name: d.visitante, role: 'VISITANTE', ours: !oursLocal, score: d.sv, won: d.sv > d.sl }
      ];
      teamRow(Object.assign({ x0: X0, x1: X1, top, h, bandL: L }, cfg, rows[0]));
      const ny = top + h + g;
      net(L, W - L, ny - 12);
      teamRow(Object.assign({ x0: X0, x1: X1, top: ny + g, h, bandL: L }, cfg, rows[1]));
      return ny + g + h;
    };

    frame(L);
    if (STORY) {
      let rowsTop;
      if (win) {
        const cS = 236, cx = W / 2, cy = 408;
        band({ cx, cy, slope: 0.45, bw: 116, x0: L, x1: W - L, yTop: L, yEnd: 578 });
        confetti([
          ['r', 172, 322, [16, 42], 28, C.rosaMedio], ['t', 262, 440, 36, 15, C.navy], ['r', 196, 528, [14, 34], -40, C.rosa],
          ['r', 328, 292, [12, 30], -18, C.navy], ['t', 330, 540, 28, 190, C.rosaMedio], ['r', 120, 430, [10, 24], 70, C.rosa],
          ['t', 776, 298, 34, 40, C.rosaMedio], ['r', 872, 420, [16, 42], -30, C.navy], ['r', 950, 306, [12, 30], 62, C.rosa],
          ['r', 756, 540, [14, 36], 22, C.rosa], ['t', 918, 544, 30, -20, C.navy], ['r', 968, 470, [10, 22], 12, C.rosaMedio]
        ]);
        medallion(cx - cS / 2, cy - cS / 2, cS);
        crest(cx - cS / 2, cy - cS / 2, cS);
        // bloque sólido del titular, a sangre
        ctx.fillStyle = C.rosa; ctx.fillRect(0, 578, W, 296);
        ctx.fillStyle = C.rosaMedio; ctx.fillRect(0, 578, W, 8);
        const ks = spacedFit(kicker, 600, 'c', 32, X1 - X0, 0.25);
        ctx.fillStyle = C.rosaClaro; spaced(kicker, W / 2, 642, ks * 0.25, 'center');
        const hs = fit('VICTORIA', 700, 'c', 236, X1 - X0);
        ctx.fillStyle = C.paper; setFont(700, hs, 'c'); text('VICTORIA', W / 2, 838, 'center');
        rowsTop = 906;
      } else {
        crest(W / 2 - 125, 270, 250);
        const ks = spacedFit(kicker, 600, 'c', 34, X1 - X0, 0.24);
        ctx.fillStyle = THEME.acc; spaced(kicker, W / 2, 588, ks * 0.24, 'center');
        const hs = fit('SEGUIMOS', 700, 'c', 222, X1 - X0);
        ctx.fillStyle = THEME.acc; setFont(700, hs, 'c'); text('SEGUIMOS', W / 2, 588 + 32 + hs * 0.70, 'center');
        attackMarks(L, 700);
        rowsTop = 812;
      }
      const end = rowsAt(rowsTop, win ? 186 : 190, 28);
      attackMarks(L, end + 34);
      const base = drawSets(X0, X1, end + 34, d.sets, oursLocal, 70, 26);
      resultFooter(d, base + 70, X1 - X0, win, { date: 46, comp: 30, lema: 36, gap: 46 });
    } else {
      if (win) {
        const cS = 184, cx = X0 + 92, cy = 194, bx = 334, bTop = 152, bBot = 336;
        band({ cx, cy, slope: 0.4, bw: 90, x0: L, x1: W - L, yTop: L, yEnd: bBot });
        medallion(cx - cS / 2, cy - cS / 2, cS);
        crest(cx - cS / 2, cy - cS / 2, cS);
        // bloque sólido del titular, a sangre por la derecha, y su filete de base
        ctx.fillStyle = C.rosa; ctx.fillRect(bx, bTop, W - bx, bBot - bTop);
        ctx.fillRect(L, bBot - 3, bx - L, 3);
        const ks = spacedFit(kicker, 600, 'c', 28, X1 - bx - 24, 0.21);
        ctx.fillStyle = C.rosa; spaced(kicker, bx + 26, 128, ks * 0.21);
        const hs = fit('VICTORIA', 700, 'c', 176, X1 - bx - 120);
        setFont(700, hs, 'c'); ctx.fillStyle = C.paper;
        text('VICTORIA', bx + 22, bTop + (bBot - bTop + hs * 0.70) / 2);
        const tx = bx + 22 + tw('VICTORIA');
        confetti([
          ['r', tx + 42, 200, [12, 30], 24, C.rosaMedio], ['t', tx + 70, 262, 26, -18, C.paper], ['r', tx + 36, 300, [10, 24], -32, C.rosaClaro],
          ['t', 902, 96, 26, 30, C.rosaMedio], ['r', 952, 118, [10, 26], -28, C.navy], ['r', 996, 88, [9, 22], 50, C.rosa],
          ['t', 102, 300, 22, 200, C.navy], ['r', 318, 100, [9, 22], -20, C.rosaMedio]
        ]);
      } else {
        crest(X0 - 8, 88, 214);
        const xr = X0 + 244;
        const ks = spacedFit(kicker, 600, 'c', 28, X1 - xr, 0.21);
        ctx.fillStyle = THEME.acc; spaced(kicker, xr + 2, 140, ks * 0.21);
        const hs = fit('SEGUIMOS', 700, 'c', 178, X1 - xr);
        ctx.fillStyle = THEME.acc; setFont(700, hs, 'c'); text('SEGUIMOS', xr - 4, 140 + 26 + hs * 0.70);
        hline(X0, X1, 336, C.hair, 2);
      }
      const end = rowsAt(win ? 384 : 370, 200, 30);
      const base = drawSets(X0, X1, end + 36, d.sets, oursLocal, 74, 24);
      resultFooter(d, base + 88, X1 - X0, win, { date: 44, comp: 28, lema: 34, gap: 46 });
      folio(H - L - 34);
    }
  }

  /* ---------- composición: PRÓXIMO PARTIDO ---------- */
  function ticket(x, y, w, h, d, big) {
    const stubW = Math.round(w * 0.36);
    ctx.fillStyle = C.rosa; rrect(x, y, w, h, 26); ctx.fill();
    const g = ctx.createLinearGradient(x, y, x + w, y + h); // volumen
    g.addColorStop(0, 'rgba(110,8,52,0.55)'); g.addColorStop(1, 'rgba(110,8,52,0)');
    ctx.fillStyle = g; rrect(x, y, w, h, 26); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 2; rrect(x + 14, y + 14, w - 28, h - 28, 16); ctx.stroke();
    const px = x + stubW; // perforado del talón
    ctx.fillStyle = C.paper;
    ctx.beginPath(); ctx.arc(px, y, 22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px, y + h, 22, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.setLineDash([10, 10]); ctx.strokeStyle = 'rgba(255,255,255,0.38)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(px, y + 36); ctx.lineTo(px, y + h - 36); ctx.stroke(); ctx.restore();
    const cxs = x + stubW / 2, lab = Math.round(big * 0.2);
    const ds = big, msMax = Math.round(big * 0.3);
    const blockH = lab * 0.7 + 16 + ds * 0.72 + msMax * 1.18;
    const yLab = y + (h - blockH) / 2 + lab * 0.7;
    const yNum = yLab + 16 + ds * 0.72;
    const ms = fit(d.mes.toUpperCase(), 700, 'c', msMax, stubW - 70);
    const yMes = yNum + ms * 1.18;
    setFont(600, lab, 'c'); ctx.fillStyle = C.rosaSobreRosa; spaced(d.diaSemana.toUpperCase(), cxs, yLab, lab * 0.22, 'center');
    setFont(700, ds, 'c'); ctx.fillStyle = C.paper; text(String(d.dia), cxs, yNum, 'center');
    setFont(700, ms, 'c'); ctx.fillStyle = C.paper; spaced(d.mes.toUpperCase(), cxs, yMes, ms * 0.12, 'center');
    const cxt = px + (w - stubW) / 2;
    setFont(600, lab, 'c'); ctx.fillStyle = C.rosaSobreRosa; spaced('HORA', cxt, yLab, lab * 0.22, 'center');
    const span = yMes - (yNum - ds * 0.72);
    const hs = fit(d.hora, 700, 'c', Math.round(Math.min(span / 0.72, big * 1.22)), w - stubW - 100);
    ctx.fillStyle = C.paper; setFont(700, hs, 'c'); text(d.hora, cxt, yMes - (span - hs * 0.72) / 2, 'center');
  }
  /* Patrocinadores: el hueco sale de la proporción real del logo y todos reciben la misma área visual.
     o = { labSize, area, maxW, maxH, rowMaxW, noneSize } · la zona [top, bottom] está reservada */
  function sponsors(cx, top, bottom, list, o) {
    if (!list.length) { // sin patrocinador: grito de ánimo en su lugar
      const my = (top + bottom) / 2, fs = o.noneSize, t = '¡VAMOS, DOMPA!';
      setFont(700, fs, 'c'); ctx.fillStyle = C.rosa;
      const w = spaced(t, cx, my + fs * 0.35, fs * 0.05, 'center');
      hline(cx - w / 2 - 90, cx - w / 2 - 26, my, C.rosaMedio, 3); hline(cx + w / 2 + 26, cx + w / 2 + 90, my, C.rosaMedio, 3);
      return;
    }
    setFont(600, o.labSize, 'c'); ctx.fillStyle = C.soft;
    const lab = 'CON EL APOYO DE', ly = top + o.labSize * 0.75;
    const lw = spacedWidth(lab, o.labSize * 0.3);
    spaced(lab, cx, ly, o.labSize * 0.3, 'center');
    hline(cx - lw / 2 - 150, cx - lw / 2 - 24, ly - o.labSize * 0.32, C.faint, 2);
    hline(cx + lw / 2 + 24, cx + lw / 2 + 150, ly - o.labSize * 0.32, C.faint, 2);
    const aTop = ly + o.labSize * 0.9, aBot = bottom, maxH = Math.min(o.maxH, aBot - aTop);
    const n = list.length, A = o.area * (n === 1 ? 1 : n === 2 ? 0.58 : 0.42), gap = n > 1 ? 70 : 0;
    const boxes = list.map(it => {
      const r = it.img ? it.img.naturalWidth / it.img.naturalHeight : (it.ratio || 1);
      const w = Math.sqrt(A * r), h = Math.sqrt(A / r);
      const k = Math.min(1, o.maxW / w, maxH / h);
      return { it, w: w * k, h: h * k };
    });
    let total = boxes.reduce((s, b) => s + b.w, 0) + gap * (n - 1);
    if (total > o.rowMaxW) {
      const k = Math.max(0.05, (o.rowMaxW - gap * (n - 1)) / (total - gap * (n - 1)));
      boxes.forEach(b => { b.w *= k; b.h *= k; }); total = o.rowMaxW;
    }
    const my = (aTop + aBot) / 2; let x = cx - total / 2;
    boxes.forEach((b, i) => {
      if (i) { // separador fino entre logos
        ctx.strokeStyle = C.faint; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(x - gap / 2, my - 36); ctx.lineTo(x - gap / 2, my + 36); ctx.stroke();
      }
      drawLogo(b.it, x, my - b.h / 2, b.w, b.h); x += b.w + gap;
    });
  }
  function drawLogo(it, x, y, w, h) {
    if (it.img) { // logo real: ajustado sin recortar (contain), sin marco, y bien suavizado (suelen ser grandes)
      const r = it.img.naturalWidth / it.img.naturalHeight; let dw = w, dh = w / r;
      if (dh > h) { dh = h; dw = h * r; }
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(it.img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore(); return;
    }
    // hueco de muestra (solo en las maquetas: { ratio })
    ctx.fillStyle = '#F3F5F8'; rrect(x, y, w, h, 14); ctx.fill();
    ctx.save(); ctx.setLineDash([12, 9]); ctx.strokeStyle = '#AEB6C3'; ctx.lineWidth = 2.5;
    rrect(x, y, w, h, 14); ctx.stroke(); ctx.restore();
    ctx.fillStyle = C.muted;
    if (w / h >= 1.9) {
      const fs = fit('LOGO PATROCINADOR', 700, 'c', Math.round(h * 0.2), w - 60);
      spaced('LOGO PATROCINADOR', x + w / 2, y + h / 2 + fs * 0.35, fs * 0.12, 'center');
    } else {
      const fs = fit('PATROCINADOR', 700, 'c', Math.round(h * 0.13), w - 36);
      spaced('LOGO', x + w / 2, y + h / 2 - fs * 0.3, fs * 0.14, 'center');
      spaced('PATROCINADOR', x + w / 2, y + h / 2 + fs * 0.95, fs * 0.04, 'center');
    }
  }
  function drawProximo(d, logos) {
    const oursLocal = d.nuestro === 'local';
    const L = STORY ? 60 : 64;
    const X0 = STORY ? 110 : 108, X1 = W - X0;
    frame(L);
    const cfg = STORY ? { icon: 106, nameMax: 80, nameMin: 38, roleSize: 24 }
      : { icon: 92, nameMax: 64, nameMin: 34, roleSize: 22 };
    const rows = [
      { name: d.local, role: 'LOCAL', ours: oursLocal },
      { name: d.visitante, role: 'VISITANTE', ours: !oursLocal }
    ];
    // Enfrentamiento centrado: los dos grupos (icono + nombre) comparten el mismo borde izquierdo
    const teams = (top, h, g) => {
      const ny = top + h + g;
      const o1 = Object.assign({ x0: X0, x1: X1, top, h, bandL: L }, cfg, rows[0]);
      const o2 = Object.assign({ x0: X0, x1: X1, top: ny + g, h, bandL: L }, cfg, rows[1]);
      const l1 = rowLayout(o1), l2 = rowLayout(o2);
      const ix = Math.max(l1.areaL + 20, W / 2 - Math.max(l1.groupW, l2.groupW) / 2);
      teamRow(o1, l1, ix);
      net(L, W - L, ny - 12);
      vsBadge(W / 2, ny + 1, STORY ? 36 : 32);
      teamRow(o2, l2, ix);
      return ny + g + h;
    };
    const place = (y, size) => {
      const t1 = d.pabellon || 'Pabellón por confirmar', t2 = d.lugar ? ' · ' + d.lugar : '';
      const pr = size * 0.36, maxW = X1 - X0;
      setFont(600, size, 't'); let w1 = tw(t1); setFont(400, size, 't'); let w2 = tw(t2);
      let s1 = t1;
      if (pr * 2 + 18 + w1 + w2 > maxW) { setFont(600, size, 't'); s1 = ellipsize(t1, maxW - pr * 2 - 18 - w2); w1 = tw(s1); }
      const total = pr * 2 + 18 + w1 + w2;
      let x = W / 2 - total / 2;
      pin(x + pr, y - size * 0.5, pr, C.rosa, C.paper); x += pr * 2 + 18;
      setFont(600, size, 't'); ctx.fillStyle = C.ink; text(s1, x, y); x += w1;
      setFont(400, size, 't'); ctx.fillStyle = C.muted; text(t2, x, y);
    };
    const cat = d.categoria;
    if (STORY) {
      crest(W / 2 - 80, 262, 160);
      setFont(600, 32, 'c'); ctx.fillStyle = C.muted; spaced(cat, W / 2, 470, 10, 'center');
      const hs = fit('PRÓXIMO PARTIDO', 700, 'c', 104, X1 - X0);
      ctx.fillStyle = C.ink; setFont(700, hs, 'c'); text('PRÓXIMO PARTIDO', W / 2, 470 + 26 + hs * 0.72, 'center');
      const end = teams(606, 138, 36);
      ticket(X0, end + 32, X1 - X0, 244, d, 144);
      place(end + 32 + 244 + 58, 36);
      sponsors(W / 2, end + 32 + 244 + 94, 1612, logos,
        { labSize: 26, area: 75000, maxW: 600, maxH: 240, rowMaxW: X1 - X0, noneSize: 76 });
    } else {
      crest(X0 - 8, 84, 168);
      const xr = X0 + 212;
      setFont(600, 26, 'c'); ctx.fillStyle = C.muted; spaced(cat, xr + 2, 136, 8);
      const hs = fit('PRÓXIMO PARTIDO', 700, 'c', 100, X1 - xr);
      ctx.fillStyle = C.ink; setFont(700, hs, 'c'); text('PRÓXIMO PARTIDO', xr - 3, 136 + 26 + hs * 0.72);
      hline(X0, X1, 276, C.hair, 2);
      const end = teams(294, 124, 32);
      ticket(X0, end + 28, X1 - X0, 208, d, 110);
      place(end + 28 + 208 + 54, 32);
      sponsors(W / 2, end + 28 + 208 + 84, 1210, logos,
        { labSize: 22, area: 60000, maxW: 520, maxH: 210, rowMaxW: X1 - X0, noneSize: 62 });
      folio(H - L - 34);
    }
  }

  /* ---------- API ---------- */
  const lleno = (v) => v != null && String(v).trim() !== '';
  function validar(arte, d) {
    const e = [];
    if (!ARTES.includes(arte)) return ['arte desconocido'];
    if (!d || typeof d !== 'object') return ['sin datos'];
    for (const k of ['local', 'visitante', 'categoria']) if (!lleno(d[k])) e.push(`falta ${k}`);
    if (d.nuestro !== 'local' && d.nuestro !== 'visitante') e.push('falta nuestro (local o visitante)');
    if (arte === 'proximo') {
      for (const k of ['diaSemana', 'dia', 'mes', 'hora']) if (!lleno(d[k])) e.push(`falta ${k}`);
    } else {
      if (!Number.isInteger(d.sl) || !Number.isInteger(d.sv)) e.push('falta el marcador');
      if (!Array.isArray(d.sets) || !d.sets.length || !d.sets.every(s => Array.isArray(s) && s.length === 2)) e.push('faltan los sets');
      if (!lleno(d.fecha)) e.push('falta fecha');
      const nuestros = d.nuestro === 'local' ? d.sl : d.sv, suyos = d.nuestro === 'local' ? d.sv : d.sl;
      if (e.length === 0 && (arte === 'victoria') !== (nuestros > suyos)) e.push('el marcador no es de ' + arte);
    }
    return e;
  }
  function dibujar(lienzo, o) {
    const m = medidas(o.formato);
    ctx = lienzo; W = m.W; H = m.H; STORY = o.formato === 'historia'; ARTE = o.arte; CREST = o.escudo || null;
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
    const errores = validar(o.arte, o.datos);
    if (errores.length) {
      const err = new Error('No se puede hacer el arte: ' + errores.join(', '));
      err.errores = errores;
      throw err;
    }
    const logos = (o.logos || []).filter(Boolean).map(it => (it.img || it.ratio ? it : { img: it }));
    if (ARTE === 'proximo') drawProximo(o.datos, logos); else drawResult(o.datos);
    return { arte: ARTE, formato: o.formato };
  }
  raiz.DompaArte = { dibujar, validar, medidas, colores: C };
})(typeof window !== 'undefined' ? window : globalThis);
