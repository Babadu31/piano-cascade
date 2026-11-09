import { COL, GOOD } from './constants.js';
import { $ } from './dom.js';
import { G, active, bps, pendingStart, startPos } from './game.js';
import { barAt, isBarLine, nextTick, tickAfter } from './meter.js';
import { firstFrom } from './notation.js';
import { input, kbOct, keyLabel, letterFor, mic } from './input.js';
import { S } from './settings.js';
import { isBlack, noteName, pcOf, spName } from './theory.js';

/* ================= Dessin ================= */
export const cvS = $('staff'), cvH = $('hw'), cS = cvS.getContext('2d'), cH = cvH.getContext('2d');
export function fit(cv, ctx) {
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w:r.width, h:r.height };
}
let geom = { key:'' };
export function resetGeom() { geom = { key:'' }; }
function keyGeom(w) {
  const { lo, hi } = G.song, k = lo + ':' + hi + ':' + w;
  if (geom.key === k) return geom;
  const whites = []; for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
  const ww = w / whites.length, pos = {};
  whites.forEach((m, i) => pos[m] = { x:i * ww, w:ww, black:false });
  for (let m = lo; m <= hi; m++) if (isBlack(m) && pos[m - 1]) pos[m] = { x:pos[m - 1].x + ww * 0.68, w:ww * 0.64, black:true };
  return geom = { key:k, ww, whites, pos };
}
function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function noteColor(n) {
  if (n.res === 'perfect') return COL.ok;
  if (n.res === 'good') return COL.good;
  if (n.res === 'miss') return COL.bad;
  return active(n) ? COL[n.hand] : COL.auto;
}
let expKey = '', expSet = new Set();
/** Notes à jouer maintenant (touches allumées en jaune). Calculé une fois par état (plusieurs appels par image). */
export function expectedSet() {
  if (!G.song) return new Set();
  const key = `${G.song.id}|${G.pos}|${G.ver}|${S.mode}|${G.listen}|${S.hands}`;
  if (key === expKey) return expSet;
  const set = new Set(), ns = G.notes;
  if (G.listen) {
    for (let i = firstFrom(ns, G.pos - G.song.maxDur - 1e-6); i < ns.length && ns[i].start <= G.pos; i++) if (G.pos < ns[i].start + ns[i].dur) set.add(ns[i].midi);
  } else if (S.mode === 'wait') {
    const g = pendingStart();
    if (g != null && G.pos >= g - 1.01) for (let i = G.cur; i < ns.length && ns[i].start <= g; i++) { const n = ns[i]; if (n.start === g && n.res == null && active(n)) set.add(n.midi); }
  } else {
    const b = bps();
    for (let i = G.cur; i < ns.length; i++) {
      const n = ns[i];
      if ((n.start - G.pos) / b > 0.15) break;
      if (n.res == null && active(n) && (G.pos - n.start) / b <= GOOD) set.add(n.midi);
    }
  }
  expKey = key; expSet = set;
  return set;
}
export function addFx(text, color, midi) { G.fx.push({ text, color, midi, t0:performance.now() }); if (G.fx.length > 12) G.fx.shift(); }

export function drawHighway() {
  const { w, h } = fit(cvH, cH), ctx = cH;
  ctx.fillStyle = '#0b0e1a'; ctx.fillRect(0, 0, w, h);
  if (!G.song) return;
  const kg = keyGeom(w), kbH = Math.max(70, Math.min(150, h * 0.26)), hitY = h - kbH;
  const ppb = 170 * (S.zoom / 100) / bps(), vis = hitY / ppb, song = G.song, pk = song.bars[0].pickup ? 0 : 1;
  // couloirs des touches noires
  ctx.fillStyle = '#12162a';
  for (let m = G.song.lo; m <= G.song.hi; m++) { const k = kg.pos[m]; if (k && k.black) ctx.fillRect(k.x, 0, k.w, hitY); }
  ctx.strokeStyle = '#ffffff08'; ctx.lineWidth = 1;
  for (const m of kg.whites) { if (pcOf(m) === 0 || pcOf(m) === 5) { const x = Math.round(kg.pos[m].x) + .5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, hitY); ctx.stroke(); } }
  // temps et mesures
  for (let b = nextTick(song, G.pos); b <= G.pos + vis; b = tickAfter(song, b)) {
    const y = Math.round(hitY - (b - G.pos) * ppb) + .5, bar = isBarLine(song, b);
    ctx.strokeStyle = bar ? '#ffffff30' : '#ffffff0f'; ctx.lineWidth = bar ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    if (bar && b >= 0) { ctx.fillStyle = '#ffffff40'; ctx.font = '11px sans-serif'; ctx.fillText(String(barAt(song, b).index + pk), 4, y - 3); }
  }
  // notes qui tombent (blanches puis noires par-dessus)
  const i0 = firstFrom(G.notes, G.pos - song.maxDur - 0.5);     // les notes déjà passées ne sont pas parcourues
  for (const pass of [false, true]) {
    for (let i = i0; i < G.notes.length; i++) {
      const n = G.notes[i];
      if (n.start > G.pos + vis) break;
      const k = kg.pos[n.midi]; if (!k || k.black !== pass) continue;
      const yb = hitY - (n.start - G.pos) * ppb, yt = yb - n.dur * ppb;
      if (yt >= hitY) continue;
      const y1 = Math.min(yb, hitY), col = noteColor(n);
      ctx.globalAlpha = n.res === 'miss' ? 0.45 : active(n) ? 1 : 0.55;
      ctx.fillStyle = col; rrect(ctx, k.x + 2, yt + 1, k.w - 4, Math.max(3, y1 - yt - 2), 5); ctx.fill();
      if (n.res === 'perfect' || n.res === 'good') { ctx.shadowColor = col; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0; }
      ctx.globalAlpha = 1;
      if (S.labels && y1 - yt > 16 && k.w > 16) {
        ctx.fillStyle = '#0b0e1acc'; ctx.font = `600 ${Math.min(13, k.w * 0.42)}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(spName(n.sp, false), k.x + k.w / 2, y1 - 6);
        const L = S.kbLabels && active(n) && y1 - yt > 32 ? letterFor(n.midi) : null;   // touche d'ordinateur à presser
        if (L) { ctx.font = `700 ${Math.min(12, k.w * 0.4)}px sans-serif`; ctx.fillText('⌨' + L, k.x + k.w / 2, y1 - 21); }
        ctx.textAlign = 'left';
      }
    }
  }
  // ligne de frappe
  const grd = ctx.createLinearGradient(0, hitY - 10, 0, hitY);
  grd.addColorStop(0, '#4f8cff00'); grd.addColorStop(1, '#4f8cff66');
  ctx.fillStyle = grd; ctx.fillRect(0, hitY - 10, w, 10);
  ctx.fillStyle = G.waiting ? COL.L : '#8fb4ff'; ctx.fillRect(0, hitY - 2, w, 3);
  G.kb = { kg, y0:hitY, kh:kbH };
  drawKeys(ctx, kg, hitY, kbH);
  // décompte et messages
  ctx.textAlign = 'center';
  if (G.playing && G.pos < 0) {
    ctx.fillStyle = '#ffffffd0'; ctx.font = '700 72px sans-serif';
    let left = 0; for (let t = nextTick(song, G.pos); t < -1e-6 && left < 32; t = tickAfter(song, t)) left++;   // clics restants
    ctx.fillText(String(Math.max(1, left)), w / 2, hitY / 2);
  } else if (!G.playing && !G.finished) {
    ctx.fillStyle = '#ffffffb0'; ctx.font = '600 20px sans-serif';
    ctx.fillText(G.pos <= startPos() + 1e-6 ? 'Appuyez sur ▶ Jouer (ou Espace) pour commencer' : 'Pause', w / 2, hitY / 2);
  } else if (G.listen) {
    ctx.fillStyle = '#9be15d'; ctx.font = '600 20px sans-serif';
    ctx.fillText('🎧 Écoute : regardez les touches jaunes', w / 2, 40);
  } else if (G.waiting) {
    const ex = [...expectedSet()].sort((a, b) => a - b).map(m => noteName(m)).join(' + ');
    const lt = S.kbLabels ? [...expectedSet()].sort((a, b) => a - b).map(m => letterFor(m)).filter(Boolean) : [];
    if (ex) { ctx.fillStyle = '#ffd27a'; ctx.font = '600 22px sans-serif'; ctx.fillText('À vous : ' + ex + (lt.length ? '   ⌨ ' + lt.join(' + ') : ''), w / 2, Math.max(80, hitY * 0.25)); }
  }
  const now = performance.now();
  G.fx = G.fx.filter(f => now - f.t0 < 700);
  for (const f of G.fx) {
    const k = kg.pos[f.midi], a = (now - f.t0) / 700, x = k ? k.x + k.w / 2 : w / 2;
    ctx.globalAlpha = 1 - a; ctx.fillStyle = f.color; ctx.font = '700 17px sans-serif';
    ctx.fillText(f.text, Math.min(w - 50, Math.max(50, x)), hitY - 18 - a * 40);
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'left';
}

function drawKeys(ctx, kg, y0, kh) {
  const now = performance.now(), exp = expectedSet(), lit = new Map();
  for (const [m, c] of input.held) lit.set(m, c);
  for (const [m, f] of input.flash) { if (f.until > now) lit.set(m, f.color); else input.flash.delete(m); }
  if (mic.on && mic.cur != null) lit.set(mic.cur, mic.color);
  for (const m of kg.whites) {
    const k = kg.pos[m];
    ctx.fillStyle = lit.get(m) || (exp.has(m) ? '#ffe08a' : '#f3f4f8');
    rrect(ctx, k.x + 0.5, y0, k.w - 1, kh - 2, 4); ctx.fill();
    if (pcOf(m) === 0 || exp.has(m)) {
      ctx.fillStyle = exp.has(m) ? '#7a5600' : '#8a8ea3'; ctx.font = `${Math.min(12, k.w * 0.4)}px sans-serif`; ctx.textAlign = 'center';
      ctx.fillText(noteName(m, pcOf(m) === 0), k.x + k.w / 2, y0 + kh - 10); ctx.textAlign = 'left';
    }
  }
  for (let m = G.song.lo; m <= G.song.hi; m++) {
    const k = kg.pos[m]; if (!k || !k.black) continue;
    ctx.fillStyle = lit.get(m) || (exp.has(m) ? '#d6a22c' : '#1b1d28');
    rrect(ctx, k.x, y0 - 1, k.w, kh * 0.62, 3); ctx.fill();
  }
  // lettres du clavier d'ordinateur
  if (S.kbLabels) {
    const fs = Math.max(9, Math.min(14, kg.ww * 0.5));
    ctx.font = `700 ${fs}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let m = G.song.lo; m <= G.song.hi; m++) {
      const L = letterFor(m), k = kg.pos[m]; if (!L || !k) continue;
      const cx = k.x + k.w / 2, cy = k.black ? y0 + kh * 0.62 - fs : y0 + kh * 0.62 + fs * 0.4;
      const bw = Math.max(fs * 1.4, ctx.measureText(L).width + 6);
      ctx.fillStyle = exp.has(m) ? '#ff9f43' : (k.black ? '#3a4170' : '#dde3ff');
      rrect(ctx, cx - bw / 2, cy - fs * 0.75, bw, fs * 1.5, 4); ctx.fill();
      ctx.fillStyle = exp.has(m) ? '#1b1d28' : (k.black ? '#fff' : '#2a3060');
      ctx.fillText(L, cx, cy + 1);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const base = 12 * (kbOct + 1), kb0 = kg.pos[base] || kg.pos[base + 1];
    if (kb0) {
      const txt = `⌨ ${keyLabel('KeyZ')} ◀ octave ▶ ${keyLabel('KeyX')}`;
      ctx.font = '600 11px sans-serif';
      const tw = ctx.measureText(txt).width, tx = Math.max(4, Math.min(kb0.x, ctx.canvas.width - tw - 12));
      ctx.fillStyle = '#0b0e1ae0'; rrect(ctx, tx - 4, y0 - 22, tw + 8, 17, 5); ctx.fill();
      ctx.fillStyle = '#8fb4ff'; ctx.fillText(txt, tx, y0 - 9);
    }
  }
  ctx.fillStyle = '#00000055'; ctx.fillRect(0, y0, ctx.canvas.width, 3);
}
