/* ================= Fenêtre « Aujourd'hui » : programme du jour et progrès =================
   Enregistre les séances et le temps de pratique dans ce navigateur (localStorage) ;
   les calculs sont dans practice.js. */
import { $ } from './dom.js';
import { G, reset } from './game.js';
import { songs } from './library.js';
import { addEntry, dailyPlan, dayKey, songStats, streakDays, weekMinutes } from './practice.js';
import { S, loadJSON, saveJSON, saveSettings } from './settings.js';

const HKEY = 'pc_history', TKEY = 'pc_time';
export const loadHistory = () => loadJSON(HKEY) || [];
const loadTime = () => loadJSON(TKEY) || {};

/** Une séance terminée (appelé à la fin d'un morceau). */
export function recordSession({ acc, holds, score }) {
  const s = G.song;
  if (!s || G.listen) return;
  saveJSON(HKEY, addEntry(loadHistory(), { t:Date.now(), day:dayKey(), id:s.id, title:s.title, mode:S.mode, hands:S.hands,
    tempo:S.tempo, acc:Math.round(acc * 1000) / 1000, holds, score }));
}

/* temps de pratique : compté pendant qu'on joue (pas en écoute), enregistré toutes les 10 s */
let pending = 0;
export function addPracticeTime(dt) {
  pending += dt;
  if (pending < 10) return;
  const t = loadTime(), d = dayKey();
  t[d] = Math.round((t[d] || 0) + pending); pending = 0;
  for (const k of Object.keys(t)) if (k < dayKey(new Date(Date.now() - 400 * 86400000))) delete t[k];   // garde ~13 mois
  saveJSON(TKEY, t);
}

/** Petite courbe de précision (SVG), de la plus ancienne à la plus récente séance. */
function sparkline(series) {
  const w = 110, h = 26, n = series.length;
  if (n < 2) return `<span class="muted small">${n ? series[0] + ' %' : ''}</span>`;
  const pts = series.map((v, i) => `${(i / (n - 1) * (w - 4) + 2).toFixed(1)},${(h - 2 - v / 100 * (h - 4)).toFixed(1)}`).join(' ');
  const last = series[n - 1], col = last >= 90 ? '#2ecc71' : last >= 70 ? '#ffb648' : '#ff5468';
  return `<svg width="${w}" height="${h}" role="img" aria-label="Précision des dernières séances : ${series.join(', ')} %">
    <line x1="2" x2="${w - 2}" y1="${h - 2 - 0.9 * (h - 4)}" y2="${h - 2 - 0.9 * (h - 4)}" stroke="#ffffff22" stroke-dasharray="3 3"/>
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2"/></svg>`;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]);
const shortDate = d => { const [, m, j] = d.split('-'); return `${+j}/${+m}`; };

/** Remplit la fenêtre. `play(item)` lance une proposition du programme. */
export function renderToday(play) {
  const h = loadHistory(), t = loadTime(), today = dayKey(), streak = streakDays(t, today);
  const minToday = Math.round((t[today] || 0) / 60);
  $('todayStats').textContent = `${streak ? `🔥 ${streak} jour${streak > 1 ? 's' : ''} d'affilée · ` : ''}aujourd'hui : ${minToday} min · cette semaine : ${weekMinutes(t, today)} min · ${h.length} séance${h.length > 1 ? 's' : ''} en tout`;
  // programme
  const meta = songs.filter(s => s.cat).map(s => ({ id:s.id, title:s.title, cat:s.cat, level:s.level }));
  const plan = dailyPlan(h, meta, today), box = $('todayPlan');
  box.innerHTML = '';
  const icon = { warmup:'🤸', current:'🎯', new:'✨', review:'🔄' };
  for (const it of plan) {
    const row = document.createElement('div'); row.className = 'plan' + (it.done ? ' done' : '');
    const info = document.createElement('div');
    const b = document.createElement('b'); b.textContent = `${it.done ? '✔' : icon[it.kind]} ${it.title}`;
    const sm = document.createElement('small'); sm.textContent = `${it.why} · ${it.mode === 'wait' ? 'Attente' : 'Rythme'} · ${it.hands === 'R' ? 'main droite' : it.hands === 'L' ? 'main gauche' : '2 mains'} · ${it.tempo} %`;
    info.append(b, sm);
    const go = document.createElement('button'); go.className = it.done ? '' : 'primary'; go.textContent = it.done ? 'Rejouer' : '▶ Jouer';
    go.onclick = () => play(it);
    row.append(info, go); box.appendChild(row);
  }
  if (!plan.length) box.textContent = 'Rien à proposer pour l\'instant.';
  // progrès par morceau
  const st = Object.values(songStats(h)).sort((a, b) => b.lastDay.localeCompare(a.lastDay));
  $('progress').innerHTML = st.length ? `<table class="prog"><tr><th>Morceau</th><th>Séances</th><th>Meilleure précision</th><th>Tempo maîtrisé</th><th>Évolution</th><th>Dernière fois</th></tr>${
    st.map(s => `<tr><td>${s.mastered ? '🏆 ' : ''}${esc(s.title)}</td><td>${s.sessions}</td><td>${Math.round(s.bestAcc * 100)} %</td><td>${s.bestTempo ? s.bestTempo + ' %' : '—'}</td><td>${sparkline(s.series)}</td><td>${shortDate(s.lastDay)}</td></tr>`).join('')
  }</table>` : '<p class="muted">Jouez un morceau jusqu\'au bout : vos progrès apparaîtront ici.</p>';
}

export function bindToday(selectSongById) {
  const play = it => {
    selectSongById(it.id);
    S.mode = it.mode; S.hands = it.hands; S.tempo = it.tempo; saveSettings();
    $('mode').value = S.mode; $('hands').value = S.hands; $('tempo').value = S.tempo;
    reset();
    $('today').hidden = true;
  };
  $('todayBtn').addEventListener('click', e => { e.currentTarget.blur(); renderToday(play); $('today').hidden = false; });
  $('todayClose').addEventListener('click', () => $('today').hidden = true);
  $('historyClear').addEventListener('click', () => {
    if (!confirm('Effacer tout l\'historique et le temps de pratique enregistrés sur cet appareil ?')) return;
    saveJSON(HKEY, []); saveJSON(TKEY, {}); renderToday(play);
  });
}
