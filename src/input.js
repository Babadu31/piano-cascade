import { audio } from './audio.js';
import { COL } from './constants.js';
import { $ } from './dom.js';
import { G, judge, releaseHold, setPlaying } from './game.js';
import { yin } from './pitch.js';
import { S } from './settings.js';
import { noteName } from './theory.js';
import { setStatus, toast } from './ui.js';

/* ================= Entrées : MIDI, clavier d'ordinateur, micro ================= */
export const input = { held:new Map(), flash:new Map(), last:null };

export function noteOn(midi, src) {
  let color = COL.R;
  if (G.playing && !G.finished && G.song && !G.listen) {
    const ok = judge(midi, src);
    color = ok ? COL.ok : (G.pos >= G.notes[0].start - 1 ? COL.bad : COL.R);
  }
  if (src !== 'mic') input.held.set(midi, color);
  input.flash.set(midi, { color, until:performance.now() + 220 });
  input.last = { midi, src, color };
  window.dispatchEvent(new CustomEvent('pc-note', { detail:{ midi, src, ok: color === COL.ok } }));
}
export function noteOff(midi) { input.held.delete(midi); releaseHold(midi); }

// --- MIDI ---
export async function enableMidi() {
  if (!navigator.requestMIDIAccess) throw new Error('Web MIDI non disponible : utilisez Chrome ou Edge (ou Firefox récent).');
  const acc = await navigator.requestMIDIAccess();
  const attach = () => {
    const names = [];
    for (const inp of acc.inputs.values()) { inp.onmidimessage = onMidiMsg; names.push(inp.name); }
    $('midiBtn').classList.toggle('on', names.length > 0);
    setStatus(names.length ? 'MIDI : ' + names.join(', ') : 'MIDI activé – aucun clavier détecté');
    $('guideDevices').textContent = names.length ? '✅ Clavier détecté : ' + names.join(', ') + ' — appuyez sur une touche !' : '❌ Aucun clavier détecté pour l\'instant.';
    if (names.length && !midiNames.length) toast('🎹 Clavier détecté : ' + names.join(', '));
    midiNames = names;
  };
  attach();
  acc.onstatechange = attach;
  return midiNames;
}
let midiNames = [];
function onMidiMsg(e) {
  const [st, d1, d2] = e.data, cmd = st & 0xf0;
  if (cmd === 0x90 && d2 > 0) noteOn(d1, 'midi');
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff(d1);
}

// --- Clavier d'ordinateur (positions physiques : marche en AZERTY et QWERTY) ---
const KEYMAP = { KeyA:0, KeyW:1, KeyS:2, KeyE:3, KeyD:4, KeyF:5, KeyT:6, KeyG:7, KeyY:8, KeyH:9, KeyU:10, KeyJ:11,
                 KeyK:12, KeyO:13, KeyL:14, KeyP:15, Semicolon:16 };
export let kbOct = 4;
export const pressed = new Map(), voices = new Map();
// Lettres affichées sur les touches : disposition réelle du clavier si le navigateur la donne, sinon AZERTY/QWERTY
const AZERTY = { KeyA:'Q', KeyW:'Z', KeyS:'S', KeyE:'E', KeyD:'D', KeyF:'F', KeyT:'T', KeyG:'G', KeyY:'Y', KeyH:'H', KeyU:'U', KeyJ:'J',
                 KeyK:'K', KeyO:'O', KeyL:'L', KeyP:'P', Semicolon:'M', KeyZ:'W', KeyX:'X' };
export let keyLabel = code => {
  const fr = /^fr/i.test(navigator.language || '');
  return fr ? AZERTY[code] : (code === 'Semicolon' ? ';' : code.replace('Key', ''));
};
if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
  navigator.keyboard.getLayoutMap().then(map => {
    keyLabel = code => { const v = map.get(code); return v ? v.toUpperCase() : (AZERTY[code] || code); };
  }).catch(() => {});
}
const KEY_OF_OFF = Object.fromEntries(Object.entries(KEYMAP).map(([c, o]) => [o, c]));
/** Lettre du clavier d'ordinateur pour une note (ou null si hors de l'octave active). */
export function letterFor(midi) {
  const off = midi - 12 * (kbOct + 1);
  return off >= 0 && KEY_OF_OFF[off] ? keyLabel(KEY_OF_OFF[off]) : null;
}
export function setKbOct(o, quiet) {
  o = Math.max(1, Math.min(7, o));
  if (o === kbOct) return;
  kbOct = o;
  if (!quiet) toast(`Clavier d'ordinateur : ${keyLabel('KeyA')} = ${noteName(12 * (kbOct + 1))}`);
}
/** Place l'octave du clavier d'ordinateur pour que les notes données soient jouables. */
export function kbFit(midis) {
  if (!midis.length) return;
  const hi = Math.max(...midis), lo = Math.min(...midis.filter(m => m >= hi - 16)), base = 12 * (kbOct + 1);   // trop large : on garde le haut (mélodie)
  if (lo >= base && hi <= base + 16) return;
  setKbOct(Math.floor(lo / 12) - 1, true);
}
window.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target.tagName;
  if (tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox')) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) setPlaying(!G.playing); return; }
  if (e.repeat) { if (KEYMAP[e.code] != null) e.preventDefault(); return; }
  if (e.code === 'KeyZ') { setKbOct(kbOct - 1); return; }
  if (e.code === 'KeyX') { setKbOct(kbOct + 1); return; }
  const off = KEYMAP[e.code];
  if (off == null) return;
  e.preventDefault();
  const m = 12 * (kbOct + 1) + off;
  try { audio.ensure(); voices.set(e.code, audio.note(m, audio.ctx.currentTime, Infinity, 0.45)); } catch (err) { /* pas de son */ }
  pressed.set(e.code, m);
  input.lastKeys = performance.now();
  noteOn(m, 'keys');
});
window.addEventListener('keyup', e => {
  const m = pressed.get(e.code);
  if (m != null) { pressed.delete(e.code); noteOff(m); audio.release(voices.get(e.code)); voices.delete(e.code); }
});
window.addEventListener('blur', () => { pressed.clear(); input.held.clear(); for (const v of voices.values()) audio.release(v); voices.clear(); });

// --- Micro : détection de hauteur (algorithme YIN) ---
export const mic = { on:false, an:null, buf:null, yb:null, hist:[], cand:null, candN:0, last:null, pending:false, pendingAt:0,
              cur:null, freq:0, cents:0, level:0, color:COL.R };


export async function enableMic() {
  audio.ensure();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    throw new Error('Micro indisponible : lancez l\'appli avec Lancer.bat (adresse http://localhost) dans Chrome, Edge ou Firefox.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false } });
  const src = audio.ctx.createMediaStreamSource(stream);
  const an = audio.ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0;
  src.connect(an);
  Object.assign(mic, { on:true, an, buf:new Float32Array(an.fftSize), yb:new Float32Array(an.fftSize), stream });
  $('micBtn').classList.add('on'); $('meter').hidden = false;
  setStatus('Micro actif – jouez une note pour tester');
}

export function micTick(now) {
  if (!mic.on) return;
  mic.an.getFloatTimeDomainData(mic.buf);
  let s = 0; for (let i = 0; i < mic.buf.length; i++) s += mic.buf[i] * mic.buf[i];
  const rms = Math.sqrt(s / mic.buf.length);
  mic.level = rms;
  const h = mic.hist; h.push(rms); if (h.length > 8) h.shift();
  if (rms < S.micGate / 1000) { mic.cur = null; mic.last = null; mic.cand = null; mic.candN = 0; mic.pending = false; return; }
  const inClick = S.metroOn && audio.inClick(now);
  if (!inClick && h.length >= 5) {                       // attaque = brusque hausse du volume
    const older = Math.min(...h.slice(0, h.length - 2));
    if (rms > older * 1.8) { mic.pending = true; mic.pendingAt = now; mic.candN = 0; }
  }
  if (mic.pending && now - mic.pendingAt > 0.25) mic.pending = false;
  const r = yin(mic.buf, audio.ctx.sampleRate, mic.yb);
  if (!r) return;
  const mf = 69 + 12 * Math.log2(r.freq / (S.a4 || 440)), m = Math.round(mf);   // La de référence réglable
  if (m < 21 || m > 108) return;
  mic.freq = r.freq; mic.cents = Math.round((mf - m) * 100);
  if (m === mic.cand) mic.candN++; else { mic.cand = m; mic.candN = 1; }
  const needed = mic.pending ? 2 : 3;                    // stabilité requise (≈ 35–50 ms)
  if (mic.candN >= needed) {
    mic.cur = m;
    if (m !== mic.last || mic.pending) {
      mic.last = m; mic.pending = false;
      noteOn(m, 'mic');
      mic.color = input.last ? input.last.color : COL.R;
    }
  }
}

export const getKbOct = () => kbOct;
