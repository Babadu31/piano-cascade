/* ================= Dessin de la portée (grand-portée sol + fa) =================
   La mise en page musicale vient de notation.js ; ici on ne fait que dessiner. */
import { G, active } from './game.js';
import { cS, cvS, expectedSet, fit } from './render.js';
import { S } from './settings.js';
import { barAt } from './meter.js';
import { firstFrom, layoutScore } from './notation.js';
import { ACC, spName } from './theory.js';

const PAPER = '#f7f3e8', INK = '#2a2a33', LINE = '#55576a';
const C_DONE = '#1e9e57', C_MISS = '#d63447', C_OTHER = '#a3a3b2', C_NOW = '#2f6fe0';
const MUSIC_FONT = '"Segoe UI Symbol","Noto Music","Bravura","DejaVu Sans",serif';
/** Position (diatonique) des altérations de l'armure, dans l'ordre. */
const KEYSIG_D = {
  T:{ sharp:[38, 35, 39, 36, 33, 37, 34], flat:[34, 37, 33, 36, 32, 35, 31] },
  B:{ sharp:[24, 21, 25, 22, 19, 23, 20], flat:[20, 23, 19, 22, 18, 21, 17] },
};
const REF = { T:30, B:18 };              // position de la 1re ligne (Mi4 / Sol2)

function noteColor(n, exp) {
  if (n.res === 'perfect' || n.res === 'good') return C_DONE;
  if (n.res === 'miss') return C_MISS;
  if (!active(n)) return C_OTHER;
  if (exp.has(n.midi) && Math.abs(n.start - G.pos) < 1.01) return C_NOW;
  return INK;
}

/** Silences dessinés en formes simples (indépendant des polices installées). */
function drawRest(ctx, base, dots, x, st, sp, yLine) {
  const y3 = yLine(st, 3), y4 = yLine(st, 4);         // 3e et 4e lignes en partant du bas
  ctx.beginPath();
  if (base >= 4) ctx.fillRect(x - sp * 0.6, y4, sp * 1.2, sp * 0.5);                 // pause : sous la 4e ligne
  else if (base >= 2) ctx.fillRect(x - sp * 0.6, y3 - sp * 0.5, sp * 1.2, sp * 0.5); // demi-pause : sur la 3e ligne
  else if (base >= 1) {                                                               // soupir
    const t = y4 - sp * 0.4;
    ctx.lineWidth = sp * 0.28;
    ctx.moveTo(x - sp * 0.25, t); ctx.lineTo(x + sp * 0.3, t + sp * 0.8); ctx.lineTo(x - sp * 0.25, t + sp * 1.5);
    ctx.lineTo(x + sp * 0.3, t + sp * 2.2); ctx.quadraticCurveTo(x - sp * 0.5, t + sp * 2.0, x, t + sp * 3);
    ctx.stroke();
  } else {                                                                            // demi-soupir, quart de soupir…
    const n = base >= 0.5 ? 1 : base >= 0.25 ? 2 : 3;
    ctx.lineWidth = sp * 0.14;
    ctx.moveTo(x + sp * 0.4, y4 - sp * 0.2); ctx.lineTo(x - sp * 0.15, y3 + sp * 1.6 + (n - 1) * sp); ctx.stroke();
    for (let i = 0; i < n; i++) {
      const cy = y4 + i * sp;
      ctx.beginPath(); ctx.arc(x - sp * 0.25, cy, sp * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - sp * 0.25, cy + sp * 0.1); ctx.quadraticCurveTo(x + sp * 0.1, cy + sp * 0.25, x + sp * 0.4 - i * sp * 0.12, cy - sp * 0.2); ctx.stroke();
    }
  }
  if (dots) { ctx.beginPath(); ctx.arc(x + sp * 0.9, y3 - sp * 0.5, sp * 0.16, 0, Math.PI * 2); ctx.fill(); }
}

export function drawStaff() {
  const { w, h } = fit(cvS, cS), ctx = cS, song = G.song;
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
  if (!song) return;
  if (!song.layout) song.layout = layoutScore(song);
  const L = song.layout, key = song.key || { fifths:0 }, nAcc = Math.min(7, Math.abs(key.fifths));
  const sp = Math.max(6, Math.min(10, (h - 30) / 17));
  const tTop = (h - 14 * sp) / 2, bTop = tTop + 10 * sp;
  const top = { T:tTop, B:bTop }, bot = { T:tTop + 4 * sp, B:bTop + 4 * sp };
  const yOf = (st, d) => bot[st] - (d - REF[st]) * sp / 2;
  const yLine = (st, i) => bot[st] - (i - 1) * sp;          // i-ème ligne en partant du bas
  const keyX = 18 + sp * 3.6;                                   // armure : juste après la clé
  const left = keyX + nAcc * sp * 0.9 + sp * 2.6;
  const playX = Math.max(left + 60, Math.min(w * 0.25, 260 + nAcc * sp));
  const ppb = sp * 6.5 * (S.zoom / 100) * Math.max(1, 1 / Math.max(0.5, song.barBeats / 3));
  const xOf = b => playX + (b - G.pos) * ppb, pk = song.bars[0].pickup ? 0 : 1;
  const minB = G.pos - (playX - left) / ppb - 0.5, maxB = G.pos + (w - playX) / ppb;
  const exp = expectedSet(), hw = sp * 0.62;

  // lignes
  ctx.strokeStyle = LINE; ctx.lineWidth = 1;
  for (const st of ['T', 'B']) for (let i = 0; i < 5; i++) {
    const y = Math.round(top[st] + i * sp) + .5; ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(w, y); ctx.stroke();
  }
  // barres de mesure et numéros
  let prevTs = null;
  const last = song.bars[song.bars.length - 1], songEnd = last.start + last.len;
  for (let bar = barAt(song, Math.max(0, minB)); bar.start <= Math.min(maxB, songEnd + 1e-6); bar = barAt(song, bar.start + bar.len)) {
    const ts = bar.ts, changed = prevTs && (prevTs.num !== ts.num || prevTs.den !== ts.den);
    if (!prevTs && bar.index > 0) { const pb = barAt(song, bar.start - 1e-3); prevTs = pb.ts; }
    const tsChange = prevTs && (prevTs.num !== ts.num || prevTs.den !== ts.den) || changed;
    prevTs = ts;
    if (bar.start <= 1e-6) continue;                                // pas de barre au tout début
    const x = Math.round(xOf(bar.start) - sp * 0.9) + .5;
    if (x < left) continue;
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, tTop); ctx.lineTo(x, bot.B); ctx.stroke();
    if (bar.start >= songEnd - 1e-6) {                               // double barre finale
      ctx.fillStyle = LINE; ctx.fillRect(x + 3, tTop, sp * 0.45, bot.B - tTop);
      break;
    }
    ctx.fillStyle = '#8a8a99'; ctx.font = '10px sans-serif'; ctx.fillText(String(bar.index + pk), x + 3, tTop - 6);
    if (tsChange) {                                                  // changement de mesure : nouveau chiffrage, avant la barre
      ctx.fillStyle = INK; ctx.font = `700 ${sp * 1.6}px serif`; ctx.textAlign = 'center';
      for (const st of ['T', 'B']) { ctx.fillText(String(ts.num), x - sp * 1.2, top[st] + sp * 1.6); ctx.fillText(String(ts.den), x - sp * 1.2, top[st] + sp * 3.6); }
      ctx.textAlign = 'left';
    }
  }

  for (const st of ['T', 'B']) {
    const ev = L[st]; if (!ev.length) continue;
    const beams = new Map();
    for (let i = firstFrom(ev, minB - 4); i < ev.length && ev[i].start <= maxB + 1; i++) {
      const e = ev[i];
      if (e.kind === 'rest') {
        const x = e.whole ? xOf(e.start + e.v / 2) - sp : xOf(e.start);
        if (x < left - 5) continue;
        ctx.fillStyle = ctx.strokeStyle = '#6b6d80';
        drawRest(ctx, e.base, e.dots, x, st, sp, yLine);
        continue;
      }
      const x = xOf(e.start);
      if (x < left - 30) continue;
      const lo = e.heads[0], hi = e.heads[e.heads.length - 1];
      const col = noteColor(lo.n, exp);
      // lignes supplémentaires
      ctx.strokeStyle = LINE; ctx.lineWidth = 1;
      const ledger = d => { const y = Math.round(yOf(st, d)) + .5; ctx.beginPath(); ctx.moveTo(x - hw * 1.8, y); ctx.lineTo(x + hw * 1.8, y); ctx.stroke(); };
      const below = st === 'T' ? 28 : 16, above = st === 'T' ? 40 : 28;
      for (let d = below; d >= lo.d; d -= 2) ledger(d);
      for (let d = above; d <= hi.d; d += 2) ledger(d);
      // têtes, points, altérations, liaisons
      let accCol = 0, lastAccD = -99;
      for (let j = e.heads.length - 1; j >= 0; j--) {
        const hd = e.heads[j], y = yOf(st, hd.d), hx = x + hd.side * hw * 1.9, c = noteColor(hd.n, exp);
        ctx.fillStyle = ctx.strokeStyle = c; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(hx, y, hw, sp * 0.44, -0.35, 0, Math.PI * 2);
        if (e.base >= 2) ctx.stroke(); else ctx.fill();
        if (e.dots) { ctx.beginPath(); ctx.arc(x + hw * 2.2 + (hd.side > 0 ? hw * 1.9 : 0), y - (hd.d % 2 === 0 ? sp * 0.5 : 0), sp * 0.16, 0, Math.PI * 2); ctx.fill(); }
        if (hd.acc != null) {
          accCol = lastAccD - hd.d < 6 ? accCol + 1 : 0; lastAccD = hd.d;
          ctx.font = `${sp * 1.7}px ${MUSIC_FONT}`; ctx.textAlign = 'right';
          ctx.fillText(hd.acc === 0 ? '♮' : ACC[hd.acc], x - hw * 1.4 - accCol * sp * 1.05 + (hd.side < 0 ? -hw * 1.9 : 0), y + sp * 0.55);
          ctx.textAlign = 'left';
        }
        const nx = hd.piece.tieNext;
        if (nx) {                                                   // liaison de prolongation
          const x2 = xOf(nx.start), dir = e.stemUp ? 1 : -1;
          ctx.lineWidth = 1.3; ctx.beginPath();
          ctx.moveTo(hx + hw, y + dir * sp * 0.55);
          ctx.quadraticCurveTo((hx + x2) / 2, y + dir * sp * 1.4, x2 - hw, y + dir * sp * 0.55);
          ctx.stroke();
        }
      }
      // noms des notes : au-dessus de la clé de sol, au-dessous de la clé de fa ; un accord = une ligne « Si Ré Fa♯ »
      const named = e.heads.filter(hd => active(hd.n) && hd.piece.first);
      if (S.labels && named.length) {
        const txt = named.map(hd => spName(hd.n.sp, false)).join(' ');
        ctx.font = `${Math.round(sp * (named.length > 1 ? 0.9 : 1.05))}px sans-serif`; ctx.textAlign = 'center'; ctx.globalAlpha = 0.75;
        ctx.fillStyle = noteColor(named[0].n, exp);
        const ly = st === 'T' ? Math.max(10, Math.min(tTop - sp * 1.6, yOf(st, hi.d) - sp * 1.4))
                              : Math.min(h - 3, Math.max(bot.B + sp * 2.4, yOf(st, lo.d) + sp * 2));
        ctx.fillText(txt, x, ly);
        ctx.globalAlpha = 1; ctx.textAlign = 'left';
      }
      if (e.tuplet) { ctx.fillStyle = INK; ctx.font = `italic ${sp * 1.2}px serif`; ctx.textAlign = 'center'; ctx.fillText('3', x, e.stemUp ? yOf(st, hi.d) - sp * 4.2 : yOf(st, lo.d) + sp * 5); ctx.textAlign = 'left'; }
      // hampe et crochets
      if (e.base < 4) {
        const sx = e.stemUp ? x + hw - 0.6 : x - hw + 0.6;
        const yFar = e.stemUp ? yOf(st, lo.d) : yOf(st, hi.d), yNear = e.stemUp ? yOf(st, hi.d) : yOf(st, lo.d);
        const tip = yNear + (e.stemUp ? -1 : 1) * sp * 3.4;
        if (e.beam) {
          if (!beams.has(e.beam)) beams.set(e.beam, []);
          beams.get(e.beam).push({ sx, yFar, yNear, tip, up:e.stemUp, base:e.base, col });
        } else {
          ctx.strokeStyle = col; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(sx, yFar); ctx.lineTo(sx, tip); ctx.stroke();
          const flags = e.base <= 0.125 + 1e-6 ? 3 : e.base <= 0.25 + 1e-6 ? 2 : e.base <= 0.5 + 1e-6 ? 1 : 0;
          for (let f = 0; f < flags; f++) {
            const fy = tip + (e.stemUp ? 1 : -1) * f * sp * 0.8, s = e.stemUp ? 1 : -1;
            ctx.beginPath(); ctx.moveTo(sx, fy); ctx.quadraticCurveTo(sx + sp * 1.1, fy + s * sp, sx + sp * 0.8, fy + s * sp * 2); ctx.stroke();
          }
        }
      }
    }
    // ligatures : une barre épaisse par croche, deux par double croche
    for (const g of beams.values()) {
      if (g.length < 2) { const s = g[0]; ctx.strokeStyle = s.col; ctx.beginPath(); ctx.moveTo(s.sx, s.yFar); ctx.lineTo(s.sx, s.tip); ctx.stroke(); continue; }
      const up = g[0].up, a = g[0], z = g[g.length - 1], dx = z.sx - a.sx || 1;
      const slope = Math.max(-0.12, Math.min(0.12, (z.tip - a.tip) / dx));
      let y0 = a.tip;
      for (const s of g) {                                   // la ligature ne doit pas écraser les hampes
        const yb = y0 + slope * (s.sx - a.sx), need = s.yNear + (up ? -1 : 1) * sp * 2.6;
        if (up ? yb > need : yb < need) y0 += need - yb;
      }
      const yAt = sx => y0 + slope * (sx - a.sx), th = sp * 0.45, gap = sp * 0.75 * (up ? 1 : -1);
      ctx.lineWidth = 1.3;
      for (const s of g) { ctx.strokeStyle = s.col; ctx.beginPath(); ctx.moveTo(s.sx, s.yFar); ctx.lineTo(s.sx, yAt(s.sx)); ctx.stroke(); }
      ctx.fillStyle = INK;
      const bar = (x1, x2, off) => {
        ctx.beginPath(); ctx.moveTo(x1, yAt(x1) + off); ctx.lineTo(x2, yAt(x2) + off);
        ctx.lineTo(x2, yAt(x2) + off + (up ? th : -th)); ctx.lineTo(x1, yAt(x1) + off + (up ? th : -th)); ctx.closePath(); ctx.fill();
      };
      bar(a.sx, z.sx, 0);
      for (let lvl = 2; lvl <= 3; lvl++) {                   // 2e et 3e barres (doubles / triples croches)
        const lim = lvl === 2 ? 0.25 : 0.125;
        for (let i = 0; i < g.length; i++) {
          if (g[i].base > lim + 1e-6) continue;
          let j = i; while (j + 1 < g.length && g[j + 1].base <= lim + 1e-6) j++;
          if (j > i) bar(g[i].sx, g[j].sx, gap * (lvl - 1));
          else { const dir = i > 0 ? -1 : 1, x2 = g[i].sx + dir * sp * 1.1; bar(Math.min(g[i].sx, x2), Math.max(g[i].sx, x2), gap * (lvl - 1)); }
          i = j;
        }
      }
    }
  }

  // tête de lecture
  ctx.fillStyle = '#4f8cff22'; ctx.fillRect(playX - sp, tTop - sp * 2, sp * 2, bot.B - tTop + sp * 4);
  ctx.fillStyle = '#4f8cff'; ctx.fillRect(playX - 1, tTop - sp * 2, 2, bot.B - tTop + sp * 4);
  // début de ligne : accolade, clés, armure, chiffrage
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, left, h);
  ctx.strokeStyle = LINE; ctx.lineWidth = 1;
  for (const st of ['T', 'B']) for (let i = 0; i < 5; i++) { const y = Math.round(top[st] + i * sp) + .5; ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(left, y); ctx.stroke(); }
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(10, tTop); ctx.lineTo(10, bot.B); ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `${sp * 6.6}px ${MUSIC_FONT}`; ctx.fillText('𝄞', 13, tTop + sp * 4.6);
  ctx.font = `${sp * 3.6}px ${MUSIC_FONT}`; ctx.fillText('𝄢', 14, bTop + sp * 2.9);
  if (nAcc) {
    const kind = key.fifths > 0 ? 'sharp' : 'flat', glyph = key.fifths > 0 ? '♯' : '♭';
    ctx.font = `${sp * 1.7}px ${MUSIC_FONT}`; ctx.textAlign = 'center';
    for (const st of ['T', 'B']) for (let i = 0; i < nAcc; i++) ctx.fillText(glyph, keyX + i * sp * 0.9, yOf(st, KEYSIG_D[st][kind][i]) + sp * (kind === 'flat' ? 0.3 : 0.55));
  }
  const ts = song.bars[0].ts;
  ctx.font = `700 ${sp * 2}px serif`; ctx.textAlign = 'center';
  for (const st of ['T', 'B']) { ctx.fillText(String(ts.num), left - sp * 1.3, top[st] + sp * 1.75); ctx.fillText(String(ts.den), left - sp * 1.3, top[st] + sp * 3.8); }
  ctx.textAlign = 'left';
}
