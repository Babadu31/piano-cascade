/* ================= Mise en page de la partition =================
   Transforme les notes d'un morceau (début, durée en temps) en écriture musicale :
   accords sur une hampe, silences, notes coupées aux barres de mesure avec liaisons,
   valeurs écrivables (pointées), ligatures des croches par temps, altérations par mesure.
   Pur calcul (pas de dessin) : testable avec Node. */
import { barAt, barLen } from './meter.js';
import { keyAlts, spDiat, spell } from './theory.js';

const EPS = 1e-6;
/** Grille d'écriture : 1/24 de temps (contient la double croche 6/24 et la croche de triolet 8/24). */
const GRID = 24;
/** Valeurs de notes écrivables, en temps (noire = 1). */
const VALUES = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125];
const TRIPLETS = [4 / 3, 2 / 3, 1 / 3, 1 / 6];
/** Ligne du milieu de chaque portée (position diatonique) : Si4 en clé de sol, Ré3 en clé de fa. */
const MIDDLE = { T:34, B:22 };

/** Portée d'une note : main droite en clé de sol, main gauche en clé de fa (sauf notes très éloignées). */
export const staffOf = n => n.hand === 'R' ? (n.midi >= 53 ? 'T' : 'B') : (n.midi <= 67 ? 'B' : 'T');

/** Découpe une durée en valeurs écrivables (la plus longue d'abord). */
export function splitValue(len) {
  const out = [];
  let rest = len;
  for (let guard = 0; rest > 0.0625 - EPS && guard < 16; guard++) {
    const trip = TRIPLETS.find(v => Math.abs(rest - v) < 0.02);
    if (trip && !VALUES.some(v => Math.abs(rest - v) < EPS)) { out.push({ v:trip, tuplet:3 }); break; }
    const v = VALUES.find(x => x <= rest + EPS) || 0.125;
    out.push({ v }); rest -= v;
  }
  return out;
}
const dotsOf = v => (Math.abs(v - 3) < EPS || Math.abs(v - 1.5) < EPS || Math.abs(v - 0.75) < EPS || Math.abs(v - 0.375) < EPS) ? 1
  : Math.abs(v - 0.1875) < EPS ? 1 : 0;
/** Valeur de base (sans le point) : 4 ronde, 2 blanche, 1 noire, 0.5 croche… */
const baseOf = (v, tuplet) => tuplet ? v * 1.5 : dotsOf(v) ? v / 1.5 : v;

/** Groupe de ligature : un temps (noire), ou une noire pointée dans les mesures composées (6/8, 9/8, 12/8, 3/8). */
export const beamUnit = ts => (ts.den === 8 && ts.num % 3 === 0) ? 1.5 : ts.den === 2 ? 2 : 1;

/**
 * Calcule la partition d'un morceau.
 * @returns {{ T: Event[], B: Event[], keyAlts: number[] }}
 *   Event = { kind:'chord'|'rest', start, v, base, dots, tuplet, staff, heads:[{ n, d, acc, side, tieNext }],
 *             stemUp, beam, bar, whole }
 */
export function layoutScore(song) {
  const key = song.key, alts = keyAlts(key ? key.fifths : 0);
  const lastBar = barAt(song, song.end - 1e-3), end = lastBar.start + lastBar.len;
  const barIdx = t => barAt(song, t).index;
  const out = { T:[], B:[], keyAlts:alts };
  const used = { T:false, B:false };

  // 1. morceaux de notes (coupés aux barres, en valeurs écrivables)
  const pieces = { T:[], B:[] };
  // Les fichiers joués « à la main » ont des positions imprécises (tick 479 au lieu de 480) :
  // pour l'écriture seulement, tout est arrondi au 1/24 de temps (doubles croches et triolets exacts).
  const q = x => Math.round(x * GRID) / GRID;
  for (const n of song.notes) {
    const sp = n.sp || spell(n.midi, key), d = spDiat(sp), st = staffOf(n);
    n.sp = sp; n.staff = st; used[st] = true;
    const s0 = q(n.start), end = Math.max(s0 + 1 / GRID, q(n.start + n.dur));
    let pos = s0, first = true, prev = null;
    for (let guard = 0; pos < end - EPS && guard < 1000; guard++) {
      const bar = barAt(song, pos), segEnd = Math.min(end, bar.start + bar.len);
      let at = pos;
      const vals = splitValue(segEnd - pos);
      if (!vals.length && first) vals.push({ v:0.125 });        // note très courte : au moins une triple croche
      for (const { v, tuplet } of vals) {
        const p = { n, d, sp, start:at, v, tuplet, first, tiePrev:prev };
        if (prev) prev.tieNext = p;
        pieces[st].push(p); prev = p; first = false; at += v;
      }
      pos = Math.max(segEnd, pos + 1 / GRID);                     // toujours avancer, même pour un reste minuscule
    }
  }

  for (const st of ['T', 'B']) {
    if (!used[st]) continue;
    // 2. altérations accidentelles : valables jusqu'à la fin de la mesure, sur la même ligne
    const firsts = pieces[st].filter(p => p.first).sort((a, b) => a.start - b.start || a.d - b.d);
    let bar = -1, state = new Map();
    for (const p of firsts) {
      const b = barIdx(p.start);
      if (b !== bar) { bar = b; state = new Map(); }
      const cur = state.has(p.d) ? state.get(p.d) : alts[p.sp.letter];
      p.acc = p.sp.alt !== cur ? p.sp.alt : null;     // null = rien à écrire ; 0 = bécarre
      state.set(p.d, p.sp.alt);
    }
    // 3. accords : mêmes début et valeur
    const groups = new Map();
    for (const p of pieces[st]) {
      const k = Math.round(p.start * 960) + ':' + Math.round(p.v * 960);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(p);
    }
    const events = [];
    for (const g of groups.values()) {
      g.sort((a, b) => a.d - b.d);
      const v = g[0].v, tuplet = g[0].tuplet;
      events.push({ kind:'chord', staff:st, start:g[0].start, v, tuplet, base:baseOf(v, tuplet), dots:tuplet ? 0 : dotsOf(v),
                    bar:barIdx(g[0].start), heads:g.map(p => ({ n:p.n, d:p.d, acc:p.acc, piece:p, side:0 })) });
    }
    events.sort((a, b) => a.start - b.start || a.v - b.v);
    // 4. silences là où rien ne sonne sur cette portée
    const rests = [];
    let cur = 0;
    const addRest = (from, to) => {
      for (let bar = barAt(song, from); bar.start < to - EPS; bar = barAt(song, bar.start + bar.len)) {
        const b0 = bar.start, b1 = b0 + bar.len, a = Math.max(from, b0), z = Math.min(to, b1);
        if (z - a < 0.125 - EPS) continue;
        if (!bar.pickup && Math.abs(a - b0) < EPS && Math.abs(z - b1) < EPS) {      // mesure entière : pause centrée
          rests.push({ kind:'rest', staff:st, start:a, v:bar.len, base:4, dots:0, whole:true, bar:bar.index });
          continue;
        }
        let pos = a;
        for (const { v } of splitValue(z - a)) {
          rests.push({ kind:'rest', staff:st, start:pos, v, base:baseOf(v), dots:dotsOf(v), bar:bar.index });
          pos += v;
        }
      }
    };
    for (const e of events) {
      if (e.start > cur + 0.125 - EPS) addRest(cur, e.start);
      cur = Math.max(cur, e.start + e.v);
    }
    if (end > cur + 0.125 - EPS) addRest(cur, end);
    // 5. hampes : vers le bas si la note la plus éloignée du milieu est au-dessus
    const mid = MIDDLE[st];
    for (const e of events) {
      const lo = e.heads[0].d, hi = e.heads[e.heads.length - 1].d;
      e.stemUp = (hi - mid) < (mid - lo) || (hi === lo && lo < mid);
      if (e.base >= 4) e.stemUp = false;
      // secondes dans un accord : têtes décalées de part et d'autre de la hampe
      for (let i = 1; i < e.heads.length; i++) {
        const h = e.heads[i], p = e.heads[i - 1];
        if (h.d - p.d === 1 && p.side === 0) h.side = e.stemUp ? 1 : 0, p.side = e.stemUp ? 0 : -1;
      }
    }
    // 6. ligatures : croches et plus courtes qui se suivent dans le même temps
    let group = [], beamId = 0;
    // position dans la mesure, comptée depuis son début « musical » (pour une levée : depuis la mesure complète)
    const inBar = t => { const b = barAt(song, t); return t - (b.pickup ? b.start + b.len - barLen(b.ts) : b.start); };
    const flush = () => {
      if (group.length >= 2) {
        const id = st + (beamId++);
        let lo = Infinity, hi = -Infinity;
        for (const e of group) { lo = Math.min(lo, e.heads[0].d); hi = Math.max(hi, e.heads[e.heads.length - 1].d); }
        const up = (hi - mid) < (mid - lo);
        for (const e of group) { e.beam = id; e.stemUp = up; }
      }
      group = [];
    };
    for (const e of events) {
      const beamable = e.base <= 0.5 + EPS && !e.tuplet;
      const last = group[group.length - 1];
      const unit = beamUnit(barAt(song, e.start).ts);
      const sameUnit = last && last.bar === e.bar && Math.floor(inBar(last.start) / unit + EPS) === Math.floor(inBar(e.start) / unit + EPS);
      if (!beamable || !last || !sameUnit || Math.abs(last.start + last.v - e.start) > EPS) flush();
      if (beamable) group.push(e);
    }
    flush();
    out[st] = [...events, ...rests].sort((a, b) => a.start - b.start || (a.kind === 'rest') - (b.kind === 'rest'));
  }
  return out;
}

/** Premier événement dont le début est ≥ t (recherche dichotomique). */
export function firstFrom(events, t) {
  let lo = 0, hi = events.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].start < t) lo = m + 1; else hi = m; }
  return lo;
}
