/* ================= Doigtés automatiques =================
   Doigts : 1 = pouce … 5 = auriculaire. Pour chaque main, on cherche le doigté de coût total minimal
   (programmation dynamique) avec des règles de pianiste :
   - chaque doigt a une position naturelle (pouce sur Do, puis Ré, Mi, Fa, Sol) ; s'en écarter coûte ;
   - passage du pouce permis (pouce sous 2/3/4 en montant, 2/3/4 par-dessus le pouce en descendant),
     autres croisements interdits ;
   - même doigt sur deux notes différentes : très mauvais ; pouce ou 5e doigt sur une touche noire : un peu moins bien.
   La main gauche est traitée en miroir. Un doigté donné par le fichier (n.finger) est respecté.
   Pur calcul : testable avec Node. */
import { isBlack } from './theory.js';

/** Position naturelle de chaque doigt, en demi-tons depuis le pouce :
    main droite pouce sur Do (Do Ré Mi Fa Sol), main gauche pouce sur Sol (Sol Fa Mi Ré Do). */
const POS = { R:[0, 2, 4, 5, 7], L:[0, 2, 3, 5, 7] };
let hand = 'R';
const nat = (f1, f2) => POS[hand][f2 - 1] - POS[hand][f1 - 1];

/** Coût du passage d'un doigt à l'autre (d = intervalle en demi-tons, déjà orienté pour la main). */
export function stepCost(d, f1, f2) {
  if (d === 0) return f1 === f2 ? 0 : 0.5;   // note répétée : même doigt idéal, changer reste possible
  if (Math.abs(d) > 12) return 3;            // saut de plus d'une octave : la main se déplace, tout doigt convient
  if (f1 === f2) return 12;                  // même doigt sur une autre note : à éviter (on écarte plutôt la main)
  const cross = (d > 0 && f2 < f1) || (d < 0 && f2 > f1);
  if (cross) {
    const a = Math.abs(d);
    const thumbUnder = d > 0 && f2 === 1 && f1 >= 2 && f1 <= 4;     // montée : le pouce passe dessous
    const overThumb = d < 0 && f1 === 1 && f2 >= 2 && f2 <= 4;      // descente : le doigt passe par-dessus
    if ((thumbUnder || overThumb) && a <= 5) {
      const other = thumbUnder ? f1 : f2;
      return 2 + (other === 3 ? 0 : other === 4 ? 0.9 : 1.2) + Math.max(0, a - 2) * 0.6;
    }
    return 20;
  }
  const dev = Math.abs(d - nat(f1, f2));
  return dev <= 1 ? dev * 0.4 : 0.4 + (dev - 1) * 1.1 + (Math.abs(d) > 10 ? 3 : 0);
}
const keyCost = (midi, f) => (isBlack(midi) && (f === 1 || f === 5)) ? 1.2 : 0;

/** Toutes les façons de doigter un accord (notes triées de la plus proche du pouce à la plus lointaine). */
function chordShapes(n) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === n) { out.push(acc.slice()); return; }
    for (let f = start; f <= 5; f++) { acc.push(f); rec(f + 1, acc); acc.pop(); }
  };
  rec(1, []);
  return out;
}
function shapeCost(pitches, shape) {
  let c = 0;
  for (let i = 1; i < pitches.length; i++) {
    const d = pitches[i] - pitches[i - 1], dev = Math.abs(d - nat(shape[i - 1], shape[i]));
    c += dev <= 2 ? dev * 0.3 : 0.6 + (dev - 2) * 1.5;
  }
  return c;
}

/**
 * Doigte les notes d'une main. notes : [{ midi, start, finger? }] (une seule main).
 * Écrit n.finger sur chaque note ; renvoie le coût total.
 */
export function fingerHand(notes, h) {
  hand = h === 'L' ? 'L' : 'R';
  const sign = hand === 'L' ? -1 : 1;
  // événements : notes simultanées regroupées, ordonnées du pouce vers le 5e doigt
  const evs = [];
  const sorted = [...notes].sort((a, b) => a.start - b.start || sign * (a.midi - b.midi));
  for (const n of sorted) {
    const last = evs[evs.length - 1];
    if (last && Math.abs(last.start - n.start) < 1e-6) { last.notes.push(n); last.end = Math.max(last.end, n.start + (n.dur || 1)); }
    else evs.push({ start:n.start, end:n.start + (n.dur || 1), notes:[n] });
  }
  if (!evs.length) return 0;
  // états possibles de chaque événement : doigté complet (+ coût propre)
  const states = evs.map(ev => {
    const k = Math.min(5, ev.notes.length), pitches = ev.notes.slice(0, k).map(n => sign * n.midi);
    let shapes = chordShapes(k).map(sh => ({ sh, cost:shapeCost(pitches, sh) + sh.reduce((a, f, i) => a + keyCost(ev.notes[i].midi, f), 0) }));
    const fixed = ev.notes.slice(0, k).map(n => n.finger || 0);
    if (fixed.some(Boolean)) {                                   // doigté imposé par la partition
      const ok = shapes.filter(s => fixed.every((f, i) => !f || s.sh[i] === f));
      if (ok.length) shapes = ok;
    }
    return shapes;
  });
  // programmation dynamique : la transition se fait entre les notes « de bord » (la plus haute en main droite)
  const edge = (ev, s) => { const i = ev.notes.length > 5 ? 4 : s.sh.length - 1; return { p:sign * ev.notes[i].midi, f:s.sh[i] }; };
  const low = (ev, s) => ({ p:sign * ev.notes[0].midi, f:s.sh[0] });
  let cost = states[0].map(s => s.cost);
  const back = [];
  for (let t = 1; t < evs.length; t++) {
    const nc = [], nb = [];
    for (let j = 0; j < states[t].length; j++) {
      let best = Infinity, arg = 0;
      for (let i = 0; i < states[t - 1].length; i++) {
        const a = states[t - 1][i], b = states[t][j];
        // accord → accord : on compare le bord haut et le bord bas, on garde le pire
        const e1 = edge(evs[t - 1], a), e2 = edge(evs[t], b), l1 = low(evs[t - 1], a), l2 = low(evs[t], b);
        const tc = Math.max(stepCost(e2.p - e1.p, e1.f, e2.f), evs[t].notes.length > 1 || evs[t - 1].notes.length > 1 ? stepCost(l2.p - l1.p, l1.f, l2.f) : 0);
        // un silence (dès le quart de soupir) laisse le temps de replacer la main
        const free = evs[t].start - evs[t - 1].end >= 0.24;
        const c = cost[i] + (free ? Math.min(tc, 1.5) : tc);
        if (c < best) { best = c; arg = i; }
      }
      nc.push(best + states[t][j].cost); nb.push(arg);
    }
    cost = nc; back.push(nb);
  }
  let j = cost.indexOf(Math.min(...cost));
  const total = cost[j];
  for (let t = evs.length - 1; t >= 0; t--) {
    const sh = states[t][j].sh;
    evs[t].notes.forEach((n, i) => { n.finger = sh[Math.min(i, sh.length - 1)]; });
    if (t > 0) j = back[t - 1][j];
  }
  return total;
}

/** Doigte tout le morceau (main droite et main gauche séparément). */
export function assignFingers(song) {
  for (const hand of ['R', 'L']) fingerHand(song.notes.filter(n => n.hand === hand), hand);
  song.fingered = true;
  return song;
}
