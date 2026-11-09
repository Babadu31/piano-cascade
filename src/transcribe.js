/** Tempo le plus probable (et décalage du premier temps) à partir des attaques. */
export function estimateTempo(times) {
  if (times.length < 4) return { bpm:90, t0:times[0] || 0 };
  let best = { score:-1, bpm:90, t0:0 };
  for (let bpm = 55; bpm <= 180; bpm += 0.5) {
    const per = 60 / bpm; let cs = 0, sn = 0;
    for (const t of times) { const ph = 2 * Math.PI * t / per; cs += Math.cos(ph); sn += Math.sin(ph); }
    const prior = Math.exp(-Math.pow(Math.log2(bpm / 100), 2) / (2 * 0.45 * 0.45));
    const score = Math.hypot(cs, sn) / times.length * prior;
    if (score > best.score) {
      let ph = Math.atan2(sn, cs); if (ph < 0) ph += 2 * Math.PI;
      best = { score, bpm, t0:ph / (2 * Math.PI) * per };
    }
  }
  return best;
}

function mkTrack(label, notes) {
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  let lo = 127, hi = 0, sum = 0;
  for (const n of notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); sum += n.midi; }
  return { label, notes, lo, hi, mean: notes.length ? sum / notes.length : 0 };
}

/** Transforme les notes entendues (en secondes) en morceau prêt à jouer : mélodie, basse, accompagnement. */
/**
 * Fusionne les « queues » : une note très courte de même hauteur, collée à la fin d'une note bien plus longue,
 * est la résonance de celle-ci (sons tenus : voix, flûte, cordes…), pas une nouvelle note.
 * Les vraies notes répétées rapides (toutes courtes) ne sont pas touchées.
 */
export function mergeTails(evs) {
  const out = [], byPitch = new Map();
  for (const n of [...evs].sort((a, b) => a.t - b.t)) {
    const prev = byPitch.get(n.midi);
    const gap = prev ? n.t - (prev.t + prev.d) : Infinity;
    if (prev && gap < 0.03 && n.d < 0.22 && prev.d > 2.5 * n.d) {           // queue collée : on prolonge
      prev.d = n.t + n.d - prev.t;
      continue;
    }
    if (prev && gap < 0.6 && n.d < 0.15 && prev.d > 4 * n.d && n.a < 0.7 * prev.a) continue;   // sursaut de résonance : ignoré
    const c = { ...n }; out.push(c); byPitch.set(n.midi, c);
  }
  return out;
}

export function notesToRaw(evs, title) {
  evs = mergeTails(evs);
  if (!evs.length) throw new Error('aucune note reconnue. Essayez plus près du son, ou un passage plus mélodique.');
  const amax = Math.max(...evs.map(n => n.a));
  evs = evs.filter(n => n.a >= amax * 0.18);
  const { bpm, t0 } = estimateTempo(evs.map(n => n.t));
  const per = 60 / bpm;
  const first = Math.floor((Math.min(...evs.map(n => n.t)) - t0) / per + 0.125);
  const q = x => Math.round(x * 4) / 4;
  const notes = evs.map(n => ({ midi:n.midi, start:Math.max(0, q((n.t - t0) / per - first)), dur:Math.max(0.25, q(n.d / per)), a:n.a }));
  // regroupe par attaque
  const groups = new Map();
  for (const n of notes) { const k = n.start; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const mel = [], bass = [], acc = [];
  let prev = null;
  for (const g of [...groups.keys()].sort((a, b) => a - b).map(k => groups.get(k))) {
    g.sort((a, b) => b.midi - a.midi);
    // mélodie = la note la plus aiguë parmi les plus fortes (évite les harmoniques faibles au-dessus)
    const amaxG = Math.max(...g.map(n => n.a));
    let top = g.find(n => n.a >= amaxG * 0.5);
    // une note d'accompagnement plus grave pendant que la mélodie tient sa note n'est pas la mélodie
    if (prev && prev.start + prev.dur > top.start + 1e-6 && top.midi < prev.midi - 4) top = null;
    if (top) { mel.push(top); prev = top; }
    const low = g[g.length - 1];
    if (g.length > 1 && low !== top && low.midi < 60) bass.push(low);
    for (const n of g) if (n !== top && !(n === low && bass.includes(low))) acc.push(n);
  }
  // notes de « mélodie » beaucoup trop graves par rapport au reste : vers l'accompagnement
  if (mel.length >= 4) {
    const med = mel.map(n => n.midi).sort((a, b) => a - b)[Math.floor(mel.length / 2)];
    for (let i = mel.length - 1; i >= 0; i--) if (mel[i].midi < med - 12) acc.push(...mel.splice(i, 1));
  }
  // mélodie : une note à la fois (coupe la note précédente)
  mel.sort((a, b) => a.start - b.start);
  for (let i = 0; i < mel.length - 1; i++) mel[i].dur = Math.max(0.25, Math.min(mel[i].dur, mel[i + 1].start - mel[i].start));
  const clean = arr => arr.map(({ midi, start, dur }) => ({ midi, start, dur }));
  const tracks = [mkTrack('Mélodie (notes du dessus)', clean(mel))];
  if (bass.length) tracks.push(mkTrack('Basse (notes du dessous)', clean(bass)));
  if (acc.length) tracks.push(mkTrack('Accompagnement (accords)', clean(acc)));
  const raw = { id:'transcription:' + title + ':' + Date.now(), title, bpm:Math.round(bpm), barBeats:4, ts:{ num:4, den:4 }, meters:[{ beat:0, ts:{ num:4, den:4 } }], tracks };
  const assign = tracks.map((t, i) => i === 0 ? 'R' : t.label.startsWith('Basse') ? 'L' : 'X');
  return { raw, assign };
}

export function encodeWav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 32767, true);
  return buf;
}
