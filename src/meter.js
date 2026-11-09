/* ================= Mesures, pulsation et tempo =================
   Un morceau a une liste de mesures song.bars = [{ start, len, ts, pickup? }] (temps en noires)
   et une carte des tempos song.tempos = [{ beat, bpm }]. Fonctions pures, testables avec Node. */

const EPS = 1e-6;
export const barLen = ts => ts.num * 4 / ts.den;

/**
 * Construit la liste des mesures.
 * @param meters  changements de chiffrage [{ beat, ts }] (le premier au temps 0)
 * @param pickup  longueur de la levée (mesure incomplète du début), 0 si aucune
 * @param end     fin du morceau
 */
export function buildBars({ meters, pickup = 0, end }) {
  const ms = (meters && meters.length ? meters : [{ beat:0, ts:{ num:4, den:4 } }]).slice().sort((a, b) => a.beat - b.beat);
  const tsAt = t => { let m = ms[0]; for (const x of ms) if (x.beat <= t + EPS) m = x; return m.ts; };
  const bars = [];
  let t = 0;
  if (pickup > EPS && pickup < barLen(ms[0].ts) - EPS) { bars.push({ start:0, len:pickup, ts:ms[0].ts, pickup:true }); t = pickup; }
  for (let guard = 0; (t < end - EPS || !bars.length) && guard < 100000; guard++) {
    const ts = tsAt(t), len = barLen(ts);
    bars.push({ start:t, len, ts }); t += len;
  }
  return bars;
}

/** Première vraie mesure (après la levée). */
const firstFull = song => song.bars.find(b => !b.pickup) || song.bars[0];

/** Mesure qui contient le temps b (avant le début : mesures virtuelles du décompte ; après la fin : prolongées). */
export function barAt(song, b) {
  const bars = song.bars;
  if (b < bars[0].start - EPS) {
    const fb = firstFull(song), k = Math.floor((b - fb.start) / fb.len + EPS);
    return { index:bars.indexOf(fb) + k, start:fb.start + k * fb.len, len:fb.len, ts:fb.ts, virtual:true };
  }
  let lo = 0, hi = bars.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].start <= b + EPS) lo = m; else hi = m - 1; }
  const bar = bars[lo];
  if (b >= bar.start + bar.len - EPS && lo === bars.length - 1) {
    const k = Math.floor((b - bar.start) / bar.len + EPS);
    return { index:lo + k, start:bar.start + k * bar.len, len:bar.len, ts:bar.ts, virtual:k > 0 };
  }
  return { index:lo, ...bar };
}

/** Début « musical » de la mesure : pour une levée, là où la mesure complète aurait commencé. */
const anchorOf = bar => bar.pickup ? bar.start + bar.len - barLen(bar.ts) : bar.start;

export const isBarLine = (song, b) => { const bar = barAt(song, b); return !bar.pickup && Math.abs(b - bar.start) < EPS; };

/** Pulsation du métronome dans une mesure, en noires : croche en x/8, blanche en x/2, noire sinon. */
export const clickUnit = ts => 4 / ts.den;

/** Prochain clic du métronome à partir de x (inclus), aligné sur la pulsation de la mesure. */
export function nextTick(song, x) {
  const bar = barAt(song, x), u = clickUnit(bar.ts), a = anchorOf(bar);
  const t = a + Math.ceil((x - a) / u - EPS) * u;
  return t >= bar.start + bar.len - EPS ? barAt(song, bar.start + bar.len).start : Math.max(t, bar.start);
}

/** Clic suivant, strictement après t (à utiliser pour avancer : nextTick(t + ε) peut renvoyer t). */
export const tickAfter = (song, t) => nextTick(song, t + 1e-4);

/** Accent du clic : 2 = premier temps, 1 = début de groupe dans les mesures composées (6/8, 9/8, 12/8), 0 = autre. */
export function accentAt(song, b) {
  const bar = barAt(song, b), ts = bar.ts, inBar = b - anchorOf(bar);
  if (Math.abs(inBar) < EPS) return 2;
  if (ts.den === 8 && ts.num % 3 === 0 && ts.num > 3 && Math.abs(inBar / 1.5 - Math.round(inBar / 1.5)) < EPS) return 1;
  return 0;
}

/** Position de départ (négative) : une mesure de décompte (deux si elle est très courte), levée comprise. */
export function countInStart(song) {
  const fb = firstFull(song), n = fb.len < 2 ? 2 : 1;
  return fb.start - n * fb.len;
}

/** Tempo (noires par minute) au temps b. */
export function bpmAt(song, b) {
  const ts = song.tempos;
  if (!ts || !ts.length) return song.bpm;
  let bpm = ts[0].bpm;
  for (const t of ts) { if (t.beat <= b + EPS) bpm = t.bpm; else break; }
  return bpm;
}
