/* ================= Théorie musicale =================
   Hauteurs (numéros MIDI), noms, tonalités, orthographe des notes (dièse ou bémol),
   position sur la portée. Aucune dépendance au navigateur : testable avec Node. */
import { S } from './settings.js';

const BLACK = new Set([1, 3, 6, 8, 10]);
export const pcOf = m => ((m % 12) + 12) % 12;
export const isBlack = m => BLACK.has(pcOf(m));

/** Lettres : 0 = Do/C … 6 = Si/B, et leur classe de hauteur naturelle. */
export const LETTERS = { fr:['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'], en:['C', 'D', 'E', 'F', 'G', 'A', 'B'] };
export const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
export const ACC = { '-2':'𝄫', '-1':'♭', '0':'', '1':'♯', '2':'𝄪' };
export const STEP = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
const STEP_LETTER = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };

/** Hauteur écrite → numéro MIDI. */
export const spToMidi = sp => 12 * (sp.oct + 1) + LETTER_PC[sp.letter] + sp.alt;
/** Position verticale sur la portée (une unité = une ligne ou un interligne). */
export const spDiat = sp => sp.oct * 7 + sp.letter;

/** « C#4 », « Bb3 », « E5 » → { midi, sp } (notation anglaise des morceaux intégrés). */
export function parseNote(s) {
  const r = /^([A-G])(##|#|bb|b)?(-?\d)$/.exec(s);
  if (!r) return null;
  const alt = { '#':1, '##':2, b:-1, bb:-2 }[r[2]] || 0;
  const sp = { letter:STEP_LETTER[r[1]], alt, oct:+r[3] };
  return { midi:spToMidi(sp), sp };
}
export function parsePitch(s) { const n = parseNote(s); return n ? n.midi : null; }

/* ---------- Tonalités ----------
   Une tonalité = { fifths, mode } : fifths = nombre de dièses (>0) ou de bémols (<0) à l'armure. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];   // Fa Do Sol Ré La Mi Si
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];    // Si Mi La Ré Sol Do Fa
/** Altération de chaque lettre à l'armure. */
export function keyAlts(fifths) {
  const a = [0, 0, 0, 0, 0, 0, 0];
  if (fifths > 0) for (let i = 0; i < Math.min(7, fifths); i++) a[SHARP_ORDER[i]] = 1;
  else for (let i = 0; i < Math.min(7, -fifths); i++) a[FLAT_ORDER[i]] = -1;
  return a;
}
const mod = (a, n) => ((a % n) + n) % n;
/** Tonique de la tonalité : { letter, alt, pc }. */
export function keyTonic(key) {
  const f = key.fifths;
  let letter = mod(4 * f, 7);
  if (key.mode === 'minor') letter = mod(letter + 5, 7);
  const pc = mod(7 * f + (key.mode === 'minor' ? 9 : 0), 12);
  return { letter, alt:mod(pc - LETTER_PC[letter] + 6, 12) - 6, pc };
}
export function keyName(key, notation = S.notation) {
  const t = keyTonic(key), L = LETTERS[notation === 'en' ? 'en' : 'fr'];
  const minor = key.mode === 'minor';
  return notation === 'en' ? `${L[t.letter]}${ACC[t.alt]} ${minor ? 'minor' : 'major'}` : `${L[t.letter]}${ACC[t.alt]} ${minor ? 'mineur' : 'majeur'}`;
}
export const C_MAJOR = Object.freeze({ fifths:0, mode:'major' });
const KEY_FIFTHS = { C:0, G:1, D:2, A:3, E:4, B:5, 'F#':6, 'C#':7, F:-1, Bb:-2, Eb:-3, Ab:-4, Db:-5, Gb:-6, Cb:-7 };
/** « D », « Bb », « F#m » (m = mineur) → { fifths, mode }. */
export function parseKey(s) {
  const r = /^([A-G](?:#|b)?)(m?)$/.exec(s || '');
  if (!r) throw new Error('tonalité inconnue : ' + s);
  const minor = r[2] === 'm', pc = STEP[r[1][0]] + (r[1][1] === '#' ? 1 : r[1][1] === 'b' ? -1 : 0);
  if (!minor) return { fifths:KEY_FIFTHS[r[1]], mode:'major' };
  const rel = Object.entries(KEY_FIFTHS).find(([k]) => mod(STEP[k[0]] + (k[1] === '#' ? 1 : k[1] === 'b' ? -1 : 0) - pc - 3, 12) === 0 && Math.abs(KEY_FIFTHS[k]) <= 7);
  return { fifths:rel[1], mode:'minor' };
}

/** Orthographe d'une hauteur dans une tonalité : { letter, alt, oct }. */
export function spell(midi, key = C_MAJOR) {
  const pc = pcOf(midi), alts = keyAlts(key.fifths);
  let letter = -1, alt = 0;
  for (let l = 0; l < 7; l++) if (mod(LETTER_PC[l] + alts[l], 12) === pc) { letter = l; alt = alts[l]; break; }
  if (letter < 0 && key.mode === 'minor') {               // sensible du mineur harmonique (Sol♯ en La mineur, Do♯ en Ré mineur)
    const t = keyTonic(key);
    if (pc === mod(t.pc - 1, 12)) { letter = mod(t.letter + 6, 7); alt = mod(pc - LETTER_PC[letter] + 6, 12) - 6; }
  }
  if (letter < 0) {
    const nat = LETTER_PC.indexOf(pc);
    if (nat >= 0) { letter = nat; alt = 0; }                 // touche blanche : bécarre
    else if (key.fifths > 0 || (key.fifths === 0 && pc !== 10)) { letter = LETTER_PC.indexOf(pc - 1); alt = 1; }
    else { letter = LETTER_PC.indexOf(mod(pc + 1, 12)); alt = -1; }
  }
  const oct = Math.round((midi - LETTER_PC[letter] - alt) / 12) - 1;
  return { letter, alt, oct };
}

/* ---------- Détection de tonalité ----------
   Profils de Temperley (Kostka-Payne) + poids léger sur la basse : 18/18 morceaux intégrés reconnus
   (Krumhansl-Kessler : 16/18). Voir tests/keys.test.js. */
const KK_MAJOR = [5, 2, 3.5, 2, 4.5, 4, 2, 4.5, 2, 3.5, 1.5, 4];
const KK_MINOR = [5, 2, 3.5, 4.5, 2, 4, 2, 4.5, 3.5, 2, 1.5, 4];
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];     // tonique (pc) → armure, le moins d'altérations
function corr(a, b) {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
}
/** Tonalité la plus probable d'une liste de notes { midi, dur }. */
export function detectKey(notes) {
  const h = new Array(12).fill(0);
  let total = 0;
  for (const n of notes) {
    const w = Math.min(4, n.dur || 1) * (n.midi < 55 ? 1.5 : 1);    // la basse porte l'harmonie
    h[pcOf(n.midi)] += w; total += w;
  }
  if (!total) return { ...C_MAJOR };
  let best = null;
  for (let t = 0; t < 12; t++) for (const [mode, prof] of [['major', KK_MAJOR], ['minor', KK_MINOR]]) {
    const rot = prof.map((_, i) => prof[mod(i - t, 12)]);
    const r = corr(h, rot) + (mode === 'major' ? 0.001 : 0);         // à égalité : majeur
    if (!best || r > best.r) best = { r, t, mode };
  }
  const fifths = best.mode === 'major' ? MAJOR_FIFTHS[best.t] : MAJOR_FIFTHS[mod(best.t + 3, 12)];
  return { fifths, mode:best.mode };
}

/* ---------- Noms affichés ---------- */
let nameKey = C_MAJOR;
/** Tonalité utilisée pour nommer les notes jouées (celle du morceau en cours). */
export function setNameKey(key) { nameKey = key || C_MAJOR; }
export function spName(sp, withOct = true, notation = S.notation) {
  const n = LETTERS[notation === 'en' ? 'en' : 'fr'][sp.letter] + ACC[sp.alt];
  return withOct ? n + sp.oct : n;
}
/** Nom d'une note jouée (orthographiée selon la tonalité du morceau), ex. « Si♭3 ». */
export function noteName(m, withOct = true) { return spName(spell(m, nameKey), withOct); }

/** Position sur la portée d'une hauteur (orthographe de Do majeur). */
export const diat = m => spDiat(spell(m));
