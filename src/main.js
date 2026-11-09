import { audio } from './audio.js';
import { $ } from './dom.js';
import { G, bps, clock, finish, judge, markMisses, pendingStart, reset, schedule, setPlaying, toggleListen } from './game.js';
import { importFile, loadBuffer } from './importer.js';
import { getKbOct, kbFit, letterFor, micTick, noteOff, noteOn, pressed, setKbOct } from './input.js';
import { BUILTIN, buildBuiltin, songs } from './library.js';
import { parseMidi } from './midi.js';
import { parseMusicXML, readMxl } from './musicxml.js';
import { yin } from './pitch.js';
import { processAudioFile, transcribePcm } from './reco.js';
import { drawHighway, expectedSet } from './render.js';
import { drawStaff } from './staff.js';
import { doSearch, servedLocally } from './search.js';
import { S, loadJSON, saveJSON } from './settings.js';
import { arrangePiano, buildFromTracks, defaultAssign, finalize } from './song.js';
import { estimateTempo, notesToRaw } from './transcribe.js';
import { bind, fillSongs, selectSong, updatePlayedHud } from './ui.js';

/** Temps de calcul moyen d'une image (ms), pour surveiller les performances. */
export const perf = { frameMs:0, worstMs:0 };
function frame() {
  const t0 = performance.now();
  try {
    const now = clock(), dt = Math.min(0.1, Math.max(0, now - G.lastT));
    G.lastT = now;
    if (G.playing && !G.finished && G.song) {
      let p = G.pos + dt * bps();
      if (S.mode === 'wait' && !G.listen) {
        const g = pendingStart();
        if (g != null && p >= g) { if (!G.waiting) { G.waiting = true; G.waitSince = now; } p = Math.max(G.pos, g); }
        else G.waiting = false;
      } else G.waiting = false;
      G.pos = p;
      schedule(now);
      if (S.mode !== 'wait' && !G.listen) markMisses();
      if (G.pos >= G.song.end + 1) finish();
    }
    micTick(now);
    if (S.kbFollow && G.song && !pressed.size) {
      const ex = [...expectedSet()];
      const rh = ex.filter(m => G.notes.some(n => n.midi === m && n.hand === 'R' && Math.abs(n.start - G.pos) < 2));
      kbFit(rh.length ? rh : ex);
    }
    drawStaff(); drawHighway(); updatePlayedHud();
  } catch (e) { console.error(e); }
  const ms = performance.now() - t0;
  perf.frameMs = perf.frameMs * 0.95 + ms * 0.05; perf.worstMs = Math.max(perf.worstMs, ms);
  requestAnimationFrame(frame);
}

songs.push(...BUILTIN.map(d => finalize(buildBuiltin(d))));
bind();
const startSong = songs.find(s => s.id === S.lastSong) || songs.find(s => s.id === 'clair');
fillSongs(startSong.id); selectSong(startSong);
if (!loadJSON('pc_seen_help')) { $('help').hidden = false; saveJSON('pc_seen_help', true); }
requestAnimationFrame(frame);

// Appli installable hors ligne (version en ligne https uniquement)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('service worker :', e));
}

// Signale au lanceur (PianoCascade.exe) que la fenêtre est ouverte ; il s'arrête tout seul quand on la ferme.
if (servedLocally) {
  const ping = () => fetch('/__ping', { cache:'no-store' }).catch(() => {});
  ping(); setInterval(ping, 5000);
  addEventListener('pagehide', () => { try { navigator.sendBeacon('/__bye'); } catch (e) { /* ignoré */ } });
}

// accès pour les tests / la console
window.PianoCascade = { perf, arrangePiano, letterFor, audio, setKbOct, get kbOct() { return getKbOct(); }, G, S, noteOn, noteOff, yin, parseMidi, parseMusicXML, readMxl, importFile, loadBuffer, finalize, songs, selectSong, setPlaying, reset, judge, toggleListen, doSearch, defaultAssign, buildFromTracks, notesToRaw, estimateTempo, processAudioFile, transcribePcm };
