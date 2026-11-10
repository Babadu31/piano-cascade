import { accentAt, barAt, bpmAt, clickUnit as meterClickUnit, countInStart, nextTick, tickAfter } from './meter.js';
import { audio } from './audio.js';
import { COL, GOOD, HOLD_MIN_BEATS, HOLD_RATIO, PERFECT } from './constants.js';
import { $ } from './dom.js';
import { addFx } from './render.js';
import { S, loadJSON, saveJSON, saveSettings } from './settings.js';
import { recordSession } from './today.js';
import { pcOf } from './theory.js';
import { toast, updateHud } from './ui.js';

/* ================= État du jeu ================= */
export const G = { song:null, notes:[], pos:0, playing:false, finished:false, listen:false, lastT:0, waiting:false, waitSince:0,
            nextClick:0, nextAudio:0, st:null, fx:[], cur:0, ver:0 };
export const clock = () => audio.ctx ? audio.ctx.currentTime : performance.now() / 1000;
/** Temps (noires) par seconde à la position actuelle : tempo du morceau × réglage du tempo. */
export const bps = () => bpmAt(G.song, G.pos) * (S.tempo / 100) / 60;
export const active = n => S.hands === 'both' || n.hand === S.hands;
/** Position de départ (décompte compris). */
export const startPos = () => countInStart(G.song);
/** Pulsation du métronome à la position actuelle. */
export const clickUnit = () => meterClickUnit(barAt(G.song, G.pos).ts);

/** Curseur : toutes les notes avant G.cur sont jouées, ratées ou de l'autre main (avance seulement, remis à 0 par reset). */
function advanceCursor() {
  const ns = G.notes;
  while (G.cur < ns.length && (ns[G.cur].res != null || !active(ns[G.cur]))) G.cur++;
  return G.cur;
}
/** Début du prochain groupe de notes à jouer (null si tout est joué). */
export function pendingStart() {
  const i = advanceCursor();
  return i < G.notes.length ? G.notes[i].start : null;
}

export function reset() {
  audio.stopAll();
  G.notes.forEach(n => n.res = null);
  G.cur = 0; G.ver++;
  G.pos = startPos();
  G.playing = false; G.finished = false; G.waiting = false; G.listen = false;
  G.nextClick = nextTick(G.song, G.pos); G.nextAudio = 0;
  G.st = { perfect:0, good:0, miss:0, wrong:0, combo:0, maxCombo:0, score:0, holdOk:0, holdShort:0 };
  holding.clear(); G.notes.forEach(n => { n.hold = null; });
  G.errBars = new Map(); G.loop = null;
  G.fx = [];
  $('results').hidden = true;
  updatePlayBtn(); updateHud();
}

export function setPlaying(on) {
  if (!G.song) return;
  if (on) {
    try { audio.ensure(); } catch (e) { toast(e.message, true); return; }
    if (G.finished) reset();
    G.lastT = clock();
    G.playing = true;
  } else {
    G.playing = false;
    audio.stopAll();
    // ré-arme le métronome et la démo à partir de la position actuelle
    G.nextClick = nextTick(G.song, G.pos);
    G.nextAudio = G.notes.findIndex(n => n.start >= G.pos - 1e-9);
    if (G.nextAudio < 0) G.nextAudio = G.notes.length;
  }
  updatePlayBtn();
}
export function updatePlayBtn() {
  $('playBtn').textContent = G.playing ? '⏸ Pause' : '▶ Jouer';
  $('listenBtn').textContent = G.listen ? '⏹ Arrêter l\'écoute' : '🎧 Écouter';
  $('listenBtn').classList.toggle('on', G.listen);
}
export function toggleListen() {
  if (!G.song) return;
  if (G.listen) { reset(); return; }
  reset(); G.listen = true; setPlaying(true);
}

export function schedule(now) {
  if (!audio.ctx) return;
  const b = bps();
  let horizon = G.pos + 0.12 * b;                     // 120 ms d'avance
  if (S.mode === 'wait' && !G.listen) { const g = pendingStart(); if (g != null) horizon = Math.min(horizon, g); }
  while (G.nextClick <= horizon) {
    const t = now + (G.nextClick - G.pos) / b;
    if (S.metroOn && t >= now - 0.03) audio.click(Math.max(t, now), accentAt(G.song, G.nextClick));
    G.nextClick = tickAfter(G.song, G.nextClick);
  }
  while (G.nextAudio < G.notes.length && G.notes[G.nextAudio].start <= horizon) {
    const n = G.notes[G.nextAudio++];
    const t = now + (n.start - G.pos) / b;
    if (t < now - 0.05) continue;
    const auto = !active(n);
    // nuance : vélocité du fichier MIDI si elle existe ; l'autre main un peu plus douce
    const vel = (n.vel ? 0.15 + 0.35 * n.vel / 127 : 0.4) * (auto ? 0.8 : 1);
    if (G.listen || (auto && S.autoOther) || (!auto && S.demo)) audio.note(n.midi, Math.max(t, now), n.dur / b, vel);
  }
}

export function markMisses() {
  const b = bps(), ns = G.notes;
  let missed = 0;
  for (let i = advanceCursor(); i < ns.length; i++) {
    const n = ns[i];
    if (n.start > G.pos) break;
    if (n.res == null && active(n) && (G.pos - n.start) / b > GOOD) {
      n.res = 'miss'; G.st.miss++; G.st.combo = 0; G.ver++; countErr(n.start);
      if (++missed <= 6) addFx('Raté', COL.bad, n.midi);
    }
  }
  if (missed) updateHud();          // une seule mise à jour de l'affichage, même si beaucoup de notes sont ratées d'un coup
}

function hit(n, rating, silent) {
  n.res = rating; G.ver++;
  G.st[rating]++; G.st.combo++;
  G.st.maxCombo = Math.max(G.st.maxCombo, G.st.combo);
  const mult = Math.min(4, 1 + Math.floor(G.st.combo / 10));
  G.st.score += (rating === 'perfect' ? 100 : 50) * mult;
  if (!silent) addFx(rating === 'perfect' ? 'Parfait !' : 'Bien', rating === 'perfect' ? COL.ok : COL.good, n.midi);
}

/* ---------- Mesures difficiles ---------- */
function countErr(beat) {
  if (!G.song || beat < 0) return;
  const i = barAt(G.song, beat).index;
  G.errBars.set(i, (G.errBars.get(i) || 0) + 1);
}
/** Les mesures où l'on s'est le plus trompé : [{ index, errors }] (index dans song.bars), au plus `max`. */
export function hardestBars(max = 3) {
  return [...(G.errBars || new Map())].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, max).map(([index, errors]) => ({ index, errors }));
}

/* ---------- Travail par passage : boucle de mesures ----------
   G.loop = { from, to (temps), fromBar, toBar (index), auto, target (%), passes, streak, snap } */
export function startLoop(fromBar, toBar, auto = true, target = 100) {
  const bars = G.song.bars, a = Math.max(0, Math.min(fromBar, toBar)), z = Math.min(bars.length - 1, Math.max(fromBar, toBar));
  reset();
  G.loop = { fromBar:a, toBar:z, from:bars[a].start, to:bars[z].start + bars[z].len, auto, target, passes:0, streak:0, best:0 };
  beginPass();
  setPlaying(true);
}
export function stopLoop() { G.loop = null; reset(); }
function beginPass() {
  const L = G.loop, ns = G.notes;
  audio.stopAll(); holding.clear();
  for (const n of ns) { n.res = (n.start < L.from - 1e-6 || n.start >= L.to - 1e-6) ? 'skip' : null; n.hold = null; }
  G.cur = 0; G.ver++; G.waiting = false; G.finished = false;
  const first = barAt(G.song, L.from), lead = first.len < 2 ? first.len * 2 : first.len;   // une mesure de décompte
  G.pos = L.from - lead;
  G.nextClick = nextTick(G.song, G.pos);
  G.nextAudio = ns.findIndex(n => n.start >= G.pos - 1e-9); if (G.nextAudio < 0) G.nextAudio = ns.length;
  L.snap = { miss:G.st.miss, wrong:G.st.wrong, hits:G.st.perfect + G.st.good };
}
/** Appelé à chaque image : fin du passage → bilan, accélération éventuelle, et on recommence. */
export function checkLoop() {
  const L = G.loop;
  if (!L || G.pos < L.to - 1e-6) return false;
  const errors = (G.st.miss - L.snap.miss) + (G.st.wrong - L.snap.wrong);
  const notes = G.notes.filter(n => n.res !== 'skip' && active(n)).length;
  const ok = errors === 0 && G.st.perfect + G.st.good - L.snap.hits >= notes;
  L.passes++; L.streak = ok ? L.streak + 1 : 0; L.best = Math.max(L.best, L.streak);
  let msg = ok ? 'Passage réussi !' : `${errors} erreur${errors > 1 ? 's' : ''} — on recommence`;
  if (ok && L.auto && S.tempo < L.target) {
    S.tempo = Math.min(L.target, S.tempo + 5); saveSettings();
    msg += ` Tempo ${S.tempo} %`;
    emitTempo();
  } else if (ok && L.auto && S.tempo >= L.target) msg += ' Objectif atteint 🎉';
  addFx(msg, ok ? COL.ok : COL.warn, G.notes.find(n => n.res !== 'skip')?.midi ?? 60);
  beginPass();
  updateHud();
  return true;
}
let tempoListener = () => {};
/** L'interface s'abonne pour afficher le nouveau tempo quand la boucle accélère. */
export function onTempoChange(fn) { tempoListener = fn; }
const emitTempo = () => tempoListener();

/* ---------- Tenue des notes (clavier MIDI, clavier d'ordinateur, écran tactile) ---------- */
const holding = new Map();          // touche enfoncée (midi) → note de la partition qu'elle a validée
function startHold(n, midi, src) {
  if (src === 'mic' || G.listen || n.dur < HOLD_MIN_BEATS - 1e-6) return;   // le micro ne sait pas quand on relâche
  holding.set(midi, n); n.hold = 'on';
}
function judgeHold(n, released) {
  if (n.hold !== 'on') return true;
  if (G.pos - n.start >= n.dur * HOLD_RATIO - 1e-6) {
    n.hold = 'ok'; G.st.holdOk++; G.st.score += 25 * Math.min(4, 1 + Math.floor(G.st.combo / 10)); G.ver++;
    return true;
  }
  if (released) { n.hold = 'short'; G.st.holdShort++; G.ver++; addFx('Tenez la note !', COL.warn, n.midi); updateHud(); return true; }
  return false;
}
/** Touche relâchée : la note était-elle tenue assez longtemps ? */
export function releaseHold(midi) {
  const n = holding.get(midi);
  if (!n) return;
  holding.delete(midi);
  judgeHold(n, true);
}
/** À chaque image : les notes tenues jusqu'au bout sont validées sans attendre le relâchement. */
export function tickHolds() {
  for (const [m, n] of holding) if (judgeHold(n, false)) holding.delete(m);
}

/** Évalue une note jouée. Renvoie true si elle correspond à la partition. */
export function judge(midi, src) {
  const b = bps();
  const pos = G.pos - (src === 'mic' ? S.micLatency / 1000 : 0) * b;
  const tol = src === 'mic' && S.octaveTol;
  const same = n => tol ? pcOf(n.midi) === pcOf(midi) : n.midi === midi;
  let best = null, rating = null;
  if (S.mode === 'wait') {
    const g = pendingStart();
    if (g != null && G.pos >= g - 1) {
      for (let i = G.cur; i < G.notes.length && G.notes[i].start <= g; i++) { const n = G.notes[i]; if (n.res == null && active(n) && n.start === g && same(n)) { best = n; break; } }
      if (best) rating = (!G.waiting || clock() - G.waitSince < 0.25) ? 'perfect' : 'good';
    }
  } else {
    let bd = Infinity;
    for (let i = advanceCursor(); i < G.notes.length; i++) {
      const n = G.notes[i];
      if ((n.start - pos) / b > GOOD) break;
      if (n.res != null || !active(n) || !same(n)) continue;
      const d = Math.abs(n.start - pos) / b;
      if (d <= GOOD && d < bd) { bd = d; best = n; }
    }
    if (best) rating = bd <= PERFECT ? 'perfect' : 'good';
  }
  if (!best) {
    if (G.pos >= G.notes[0].start - 1) { G.st.wrong++; G.st.combo = 0; countErr(G.pos); addFx('Fausse note', COL.bad, midi); }
    updateHud();
    return false;
  }
  hit(best, rating);
  startHold(best, midi, src);
  if (src === 'mic') {   // le micro n'entend qu'une note : il valide tout l'accord
    for (let i = G.cur; i < G.notes.length && G.notes[i].start <= best.start; i++) { const n = G.notes[i]; if (n !== best && n.res == null && active(n) && n.start === best.start) hit(n, rating, true); }
  }
  updateHud();
  return true;
}

export function finish() {
  if (G.listen) { reset(); return; }
  G.finished = true; G.playing = false; updatePlayBtn();
  const s = G.st, total = s.perfect + s.good + s.miss + s.wrong;
  const acc = total ? (s.perfect + s.good) / total : 0;
  const stars = acc >= 0.95 ? 3 : acc >= 0.8 ? 2 : acc >= 0.6 ? 1 : 0;
  const key = 'pc_best_' + G.song.id + '_' + S.mode + '_' + S.hands;
  const prev = loadJSON(key);
  const isBest = !prev || s.score > prev.score;
  if (isBest) saveJSON(key, { score:s.score, acc, tempo:S.tempo });
  recordSession({ acc, holds:s.holdOk + s.holdShort ? s.holdOk / (s.holdOk + s.holdShort) : null, score:s.score });
  $('resTitle').textContent = isBest && prev ? 'Nouveau record ! 🎉' : 'Morceau terminé !';
  $('resStars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  const rows = [['Score', s.score], ['Précision', Math.round(acc * 100) + ' %'], ['Parfait', s.perfect], ['Bien', s.good],
    ['Ratées', s.miss], ['Fausses notes', s.wrong], ['Meilleure série', s.maxCombo], ['Tempo', S.tempo + ' %']];
  const holds = s.holdOk + s.holdShort;
  if (holds) rows.splice(2, 0, ['Notes longues bien tenues', `${s.holdOk} / ${holds} (${Math.round(s.holdOk / holds * 100)} %)`]);
  $('resTable').innerHTML = rows.map(([a, v]) => `<tr><td>${a}</td><td>${v}</td></tr>`).join('');
  $('resTip').textContent = acc >= 0.95 && S.tempo < 100 ? 'Excellent ! Essayez d\'augmenter le tempo de 10 %.'
    : acc >= 0.95 && S.mode === 'wait' ? 'Maîtrisé ! Passez en mode Rythme pour travailler la régularité.'
    : acc < 0.6 ? 'Courage : baissez le tempo ou travaillez une main à la fois.'
    : 'Bien joué ! Rejouez pour gagner en régularité.';
  // mesures où l'on s'est le plus trompé, avec un bouton pour les travailler en boucle
  const hard = hardestBars(3), box = $('resHard');
  box.hidden = !hard.length; box.innerHTML = '';
  if (hard.length) {
    const label = i => (G.song.bars[0].pickup ? (i === 0 ? 'la levée' : i) : i + 1);
    const t = document.createElement('div');
    t.textContent = 'Mesures à travailler : ' + hard.map(h => `${label(h.index)} (${h.errors} erreur${h.errors > 1 ? 's' : ''})`).join(', ');
    const b = document.createElement('button'); b.className = 'primary'; b.style.marginTop = '8px';
    const z = Math.min(G.song.bars.length - 1, hard[0].index + 1);
    b.textContent = `🔁 Travailler les mesures ${label(hard[0].index)}–${label(z)} en boucle`;
    b.onclick = () => { $('results').hidden = true; startLoop(hard[0].index, z, true, Math.max(S.tempo, 100)); };
    box.append(t, b);
  }
  $('results').hidden = false;
  updateHud();
}
