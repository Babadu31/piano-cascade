/* ================= Suivi des progrès et programme du jour =================
   Pur calcul (testable avec Node) ; l'enregistrement dans le navigateur est fait par ui.js.
   Séance = { t (ms), day 'AAAA-MM-JJ', id, title, mode, hands, tempo, acc (0..1), holds (0..1 ou null), score }
   Temps de pratique = { 'AAAA-MM-JJ': secondes } */

export const MAX_HISTORY = 1000;
/** Un morceau est « maîtrisé » joué en mode Rythme, à 100 % du tempo, avec au moins 90 % de précision. */
export const MASTERED_ACC = 0.9;

const pad = n => String(n).padStart(2, '0');
/** Jour local au format AAAA-MM-JJ. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOffset = (day, k) => { const [y, m, d] = day.split('-').map(Number); return dayKey(new Date(y, m - 1, d + k)); };
/** Nombre de jours entre deux dates AAAA-MM-JJ. */
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function addEntry(history, entry) {
  const h = [...history, entry];
  return h.length > MAX_HISTORY ? h.slice(h.length - MAX_HISTORY) : h;
}

/** Statistiques par morceau : { id: { title, sessions, bestAcc, bestTempo (≥ 90 % en Rythme), lastDay, series, mastered } } */
export function songStats(history) {
  const out = {};
  for (const e of [...history].sort((a, b) => a.t - b.t)) {
    const s = out[e.id] || (out[e.id] = { id:e.id, title:e.title, sessions:0, bestAcc:0, bestTempo:0, bestWaitAcc:0, lastDay:e.day, lastTempo:e.tempo, series:[] });
    s.sessions++; s.title = e.title; s.lastDay = e.day; s.lastTempo = e.tempo;
    s.bestAcc = Math.max(s.bestAcc, e.acc);
    if (e.mode === 'wait') s.bestWaitAcc = Math.max(s.bestWaitAcc, e.acc);
    if (e.mode === 'normal' && e.acc >= MASTERED_ACC) s.bestTempo = Math.max(s.bestTempo, e.tempo);
    s.series.push(Math.round(e.acc * 100));
    if (s.series.length > 20) s.series.shift();
  }
  for (const s of Object.values(out)) s.mastered = s.bestTempo >= 100;
  return out;
}

/** Jours de pratique d'affilée (au moins une minute), en comptant aujourd'hui ou, sinon, hier. */
export function streakDays(timeByDay, today = dayKey()) {
  const practiced = d => (timeByDay[d] || 0) >= 60;
  let day = practiced(today) ? today : dayOffset(today, -1), n = 0;
  while (practiced(day) && n < 3660) { n++; day = dayOffset(day, -1); }
  return n;
}
/** Minutes de pratique sur les 7 derniers jours (aujourd'hui compris). */
export function weekMinutes(timeByDay, today = dayKey()) {
  let s = 0;
  for (let k = 0; k < 7; k++) s += timeByDay[dayOffset(today, -k)] || 0;
  return Math.round(s / 60);
}

/**
 * Programme du jour : jusqu'à 4 propositions.
 * @param songs  morceaux [{ id, title, cat, level }] (ceux de la bibliothèque)
 * @returns [{ kind:'warmup'|'current'|'new'|'review', id, title, tempo, mode, hands, why, done }]
 */
export function dailyPlan(history, songs, today = dayKey()) {
  const stats = songStats(history), plan = [];
  const doneToday = id => history.some(e => e.day === today && e.id === id && e.acc >= 0.8);
  const seed = daysBetween('2026-01-01', today);
  // 1. échauffement : un exercice différent chaque jour
  const ex = songs.filter(s => s.cat === 'Exercices');
  if (ex.length) {
    const s = ex[((seed % ex.length) + ex.length) % ex.length];
    plan.push({ kind:'warmup', id:s.id, title:s.title, tempo:80, mode:'normal', hands:'both', why:'Échauffement des doigts (5 minutes)' });
  }
  // 2. le morceau en cours : joué ces 14 derniers jours, pas encore maîtrisé
  const pieces = songs.filter(s => s.cat !== 'Exercices');
  const inProgress = Object.values(stats)
    .filter(s => !s.mastered && pieces.some(p => p.id === s.id) && daysBetween(s.lastDay, today) <= 14)
    .sort((a, b) => b.lastDay.localeCompare(a.lastDay) || b.sessions - a.sessions);
  /** Étape suivante d'un morceau en cours : déchiffrer (Attente) → passer en Rythme → accélérer de 5 %. */
  const nextStep = s => {
    if (s.bestTempo > 0) {
      const tempo = Math.min(100, Math.max(50, s.bestTempo + 5));
      return { tempo, mode:'normal', why:`Un peu plus vite : ${tempo} % (dernier tempo réussi : ${s.bestTempo} %)` };
    }
    if (s.bestWaitAcc >= MASTERED_ACC) return { tempo:60, mode:'normal', why:'Déchiffré ! Passez en mode Rythme, tempo 60 %' };
    return { tempo:Math.min(100, Math.max(50, s.lastTempo || 60)), mode:'wait', why:'À déchiffrer en mode Attente jusqu\'à 90 % de précision' };
  };
  const pushCurrent = s => plan.push({ kind:'current', id:s.id, title:s.title, hands:'both', ...nextStep(s) });
  if (inProgress[0]) pushCurrent(inProgress[0]);
  // 3. un nouveau morceau, du niveau le plus simple pas encore joué
  const fresh = pieces.filter(s => !stats[s.id]).sort((a, b) => (a.level || 3) - (b.level || 3) || songs.indexOf(a) - songs.indexOf(b))[0];
  if (fresh && plan.length < 4) plan.push({ kind:'new', id:fresh.id, title:fresh.title, tempo:60, mode:'wait', hands:'R', why:'Nouveau morceau : d\'abord la main droite, en mode Attente' });
  // 4. révision : un morceau maîtrisé, le moins récemment joué (au moins 3 jours)
  const review = Object.values(stats).filter(s => s.mastered && daysBetween(s.lastDay, today) >= 3)
    .sort((a, b) => a.lastDay.localeCompare(b.lastDay))[0];
  if (review) plan.push({ kind:'review', id:review.id, title:review.title, tempo:100, mode:'normal', hands:'both', why:`Révision (dernière fois il y a ${daysBetween(review.lastDay, today)} jours)` });
  if (plan.length < 4 && inProgress[1]) pushCurrent(inProgress[1]);       // place libre : un 2e morceau en cours
  for (const it of plan) it.done = doneToday(it.id);
  return plan;
}
