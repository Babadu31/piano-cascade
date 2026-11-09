import { barLen, buildBars } from './meter.js';
import { detectKey, pcOf, spell, spToMidi } from './theory.js';

export function finalize(song) {
  const notes = song.notes
    .filter(n => n.dur > 0 && n.midi >= 21 && n.midi <= 108 && isFinite(n.start))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
  if (!notes.length) throw new Error('aucune note jouable trouvée.');
  // chiffrage
  if (!song.ts || !(song.ts.num > 0 && song.ts.den > 0)) {
    const bb = song.barBeats > 0 && song.barBeats <= 16 ? song.barBeats : 4;
    song.ts = Number.isInteger(bb) ? { num:bb, den:4 } : { num:Math.round(bb * 2), den:8 };
  }
  // enlève les mesures vides du début
  let shift = 0;
  if (song.bars && song.bars.length) {
    let bars = song.bars;
    while (bars.length > 1 && bars[1].start <= notes[0].start + 1e-6) bars = bars.slice(1);
    shift = bars[0].start;
    song.bars = bars.map(x => ({ ...x, start:x.start - shift }));
  } else if (!song.pickup) {
    const bb = barLen(song.ts);
    shift = Math.floor(notes[0].start / bb + 1e-9) * bb;
  }
  // tempos (le dernier changement avant le début devient le tempo initial)
  const tin = (song.tempos && song.tempos.length ? song.tempos : [{ beat:0, bpm:song.bpm || 100 }])
    .map(t => ({ beat:t.beat - shift, bpm:Math.min(300, Math.max(20, t.bpm)) })).sort((a, b) => a.beat - b.beat);
  const tempos = [];
  for (const t of tin) {
    if (t.beat <= 1e-6) tempos[0] = { beat:0, bpm:t.bpm };
    else if (!tempos.length || Math.abs(tempos[tempos.length - 1].bpm - t.bpm) > 1e-6) tempos.push(t);
  }
  if (!tempos.length || tempos[0].beat > 0) tempos.unshift({ beat:0, bpm:tin[0].bpm });
  let lo = 127, hi = 0, end = 0;
  notes.forEach((n, i) => {
    n.start -= shift; n.id = i; n.res = null;
    lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); end = Math.max(end, n.start + n.dur);
  });
  // mesures : données par le fichier, ou construites à partir des changements de chiffrage
  if (!song.bars || !song.bars.length) {
    const meters = (song.meters && song.meters.length ? song.meters : [{ beat:0, ts:song.ts }])
      .map(m => ({ beat:Math.max(0, m.beat - shift), ts:m.ts }));
    song.bars = buildBars({ meters, pickup:song.pickup || 0, end });
  } else {
    for (let last = song.bars[song.bars.length - 1]; last.start + last.len < end - 1e-6; last = song.bars[song.bars.length - 1])
      song.bars.push({ start:last.start + last.len, len:barLen(last.ts), ts:last.ts });
  }
  // première mesure incomplète (fichier MusicXML) = levée
  const b0 = song.bars[0];
  if (song.bars.length > 1 && b0.len < barLen(b0.ts) - 1e-6) b0.pickup = true;
  const full = song.bars.find(x => !x.pickup) || song.bars[0];
  song.ts = full.ts; song.barBeats = barLen(full.ts);
  song.tempos = tempos; song.bpm = tempos[0].bpm;
  if (!song.key) song.key = detectKey(notes);
  for (const n of notes) if (!n.sp || spToMidi(n.sp) !== n.midi) n.sp = spell(n.midi, song.key);
  lo = Math.max(21, lo - 2); hi = Math.min(108, hi + 2);
  while (pcOf(lo) !== 0 && lo > 21) lo--;      // commence sur un Do
  while (pcOf(hi) !== 11 && hi < 108) hi++;    // finit sur un Si
  while (hi - lo < 35) {                       // au moins 3 octaves visibles
    if (lo - 12 >= 21 && (hi + 12 > 108 || (60 - lo) < (hi - 60))) lo -= 12;
    else if (hi + 12 <= 108) hi += 12; else break;
  }
  const maxDur = notes.reduce((a, n) => Math.max(a, n.dur), 0);
  Object.assign(song, { notes, lo, hi, end, maxDur });
  return song;
}
/** Choix automatique des mains : R = droite, L = gauche, S = partage au Do du milieu, X = ignorer. */
export function defaultAssign(tracks) {
  if (tracks.length === 1) return ['S'];
  if (tracks.length === 2) return tracks[0].mean >= tracks[1].mean ? ['R', 'L'] : ['L', 'R'];
  const maxN = Math.max(...tracks.map(t => t.notes.length));
  const cand = tracks.map((t, i) => i).filter(i => tracks[i].notes.length >= maxN * 0.1);
  const r = cand.reduce((a, i) => tracks[i].mean > tracks[a].mean ? i : a, cand[0]);
  const rest = cand.filter(i => i !== r);
  const l = rest.length ? rest.reduce((a, i) => tracks[i].mean < tracks[a].mean ? i : a, rest[0]) : -1;
  return tracks.map((t, i) => i === r ? 'R' : i === l ? 'L' : 'X');
}

export function buildFromTracks(raw, assign, simple) {
  let notes = [];
  const seen = new Set();
  raw.tracks.forEach((t, i) => {
    const a = assign[i]; if (a === 'X') return;
    for (const n of t.notes) {
      const hand = a === 'S' ? (n.midi >= 60 ? 'R' : 'L') : a;
      const k = hand + n.midi + ':' + Math.round(n.start * 96);
      if (seen.has(k)) continue;
      seen.add(k); notes.push({ midi:n.midi, sp:n.sp, vel:n.vel, start:n.start, dur:n.dur, hand });
    }
  });
  if (simple) {   // garde la note la plus aiguë (main droite) / la plus grave (main gauche) à chaque instant
    const best = new Map();
    for (const n of notes) {
      const k = n.hand + Math.round(n.start * 24), cur = best.get(k);
      if (!cur || (n.hand === 'R' ? n.midi > cur.midi : n.midi < cur.midi)) best.set(k, n);
    }
    notes = [...best.values()];
  }
  if (!notes.length) throw new Error('aucune piste choisie.');
  const song = finalize({ id:raw.id, title:raw.title, bpm:raw.bpm, barBeats:raw.barBeats, ts:raw.ts, key:raw.key, meters:raw.meters, tempos:raw.tempos, notes });
  Object.assign(song, { raw, assign:assign.slice(), simple:!!simple });
  return song;
}

/* --- Arrangement automatique pour piano ---
   Mélodie : la note la plus aiguë à chaque instant des pistes « main droite », ramenée autour du Do4–Mi5.
   Main gauche : accord le plus probable de chaque demi-mesure, calculé avec tous les instruments. */
const CHORDS = [];
for (let r = 0; r < 12; r++) { CHORDS.push({ r, q:'maj', pcs:[r, (r + 4) % 12, (r + 7) % 12] }); CHORDS.push({ r, q:'min', pcs:[r, (r + 3) % 12, (r + 7) % 12] }); }
export function arrangePiano(raw, assign, level) {
  const melSrc = [], all = [];
  raw.tracks.forEach((t, i) => {
    for (const n of t.notes) { all.push(n); if (assign[i] === 'R' || assign[i] === 'S') melSrc.push(n); }
  });
  if (!melSrc.length) throw new Error('choisissez au moins une piste « Main droite » pour la mélodie.');
  // mélodie monophonique (note du dessus)
  const byStart = new Map();
  for (const n of melSrc) { const k = Math.round(n.start * 8) / 8, c = byStart.get(k); if (!c || n.midi > c.midi) byStart.set(k, { midi:n.midi, start:k, dur:n.dur }); }
  const mel = [...byStart.values()].sort((a, b) => a.start - b.start);
  for (let i = 0; i < mel.length - 1; i++) mel[i].dur = Math.max(0.125, Math.min(mel[i].dur, mel[i + 1].start - mel[i].start));
  const med = mel.map(n => n.midi).sort((a, b) => a - b)[Math.floor(mel.length / 2)];
  const shift = med < 55 ? 12 * Math.ceil((55 - med) / 12) : med > 81 ? -12 * Math.ceil((med - 81) / 12) : 0;   // seulement si trop grave / trop aigu
  const notes = mel.map(n => ({ midi:Math.min(96, Math.max(55, n.midi + shift)), start:n.start, dur:n.dur, hand:'R' }));
  // harmonie par demi-mesure
  const end = Math.max(...all.map(n => n.start + n.dur));
  const meters = raw.meters && raw.meters.length ? raw.meters : [{ beat:0, ts:raw.ts || { num:raw.barBeats || 4, den:4 } }];
  // une harmonie par demi-mesure (par mesure si elle est impaire ou courte)
  const segs = [];
  for (const bar of buildBars({ meters, end })) {
    const half = bar.len >= 2 && bar.len % 2 === 0 ? 2 : 1;
    for (let k = 0; k < half; k++) segs.push([bar.start + k * bar.len / half, bar.len / half]);
  }
  let prev = null;
  for (const [t0, seg] of segs) {
    const t1 = t0 + seg, w = new Array(12).fill(0); let low = null;
    for (const n of all) {
      const ov = Math.min(t1, n.start + n.dur) - Math.max(t0, n.start);
      if (ov <= 0) continue;
      w[pcOf(n.midi)] += ov * (n.midi < 60 ? 1.5 : 1);
      if (!low || n.midi < low.midi) low = n;
    }
    if (w.every(x => x === 0)) { prev = null; continue; }
    let best = null, bs = -Infinity;
    for (const c of CHORDS) {
      let sc = c.pcs.reduce((a, pc) => a + w[pc], 0) - 0.4 * w.reduce((a, x, pc) => a + (c.pcs.includes(pc) ? 0 : x), 0);
      if (low && pcOf(low.midi) === c.r) sc += 0.5 * seg;
      if (prev && prev.r === c.r && prev.q === c.q) sc += 0.1 * seg;     // un peu de stabilité
      if (sc > bs) { bs = sc; best = c; }
    }
    prev = best;
    let root = 48 + best.r; if (root > 54) root -= 12;              // fondamentale entre Sol2 et Fa#3
    const last = notes.length && notes[notes.length - 1];
    if (last && last.hand === 'L' && last.root === root && last.q === best.q && last.start + last.dur >= t0 - 1e-6 && level === 'easy') { last.dur += seg; continue; }
    notes.push({ midi:root, start:t0, dur:seg, hand:'L', root, q:best.q });
    if (level === 'chords') {
      const third = root + (best.q === 'maj' ? 4 : 3), fifth = root + 7;
      notes.push({ midi:third, start:t0, dur:seg, hand:'L' });     // accord serré, facile sous la main
      notes.push({ midi:fifth, start:t0, dur:seg, hand:'L' });
    }
  }
  const song = finalize({ id:raw.id, title:raw.title + (level === 'chords' ? ' (piano)' : ' (piano facile)'), bpm:raw.bpm, barBeats:raw.barBeats, ts:raw.ts, key:raw.key, meters:raw.meters, tempos:raw.tempos,
                          notes:notes.map(({ midi, start, dur, hand }) => ({ midi, start, dur, hand })) });
  Object.assign(song, { raw, assign:assign.slice(), arr:level });
  return song;
}
