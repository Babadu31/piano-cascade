import { audio } from './audio.js';
import { COL } from './constants.js';
import { $ } from './dom.js';
import { assignFingers } from './fingering.js';
import { G, onTempoChange, reset, setPlaying, startLoop, stopLoop, toggleListen } from './game.js';
import { barAt } from './meter.js';
import { handleFile } from './importer.js';
import { enableMic, enableMidi, input, mic, noteOff, noteOn, setKbOct } from './input.js';
import { songs } from './library.js';
import { processAudioFile, startRecording, stopRecording } from './reco.js';
import { cvH, resetGeom } from './render.js';
import { doSearch } from './search.js';
import { S, loadJSON, saveSettings } from './settings.js';
import { arrangePiano, buildFromTracks } from './song.js';
import { keyName, noteName, setNameKey } from './theory.js';
import { addAndSelect, readTracks, showTracks, trkRaw } from './tracks.js';

/* ================= Interface ================= */
let lastHud = '';
export function updateHud() {
  if (!G.st) return;
  const s = G.st, total = s.perfect + s.good + s.miss + s.wrong;
  $('score').textContent = s.score;
  $('comboV').textContent = s.combo + (s.combo >= 10 ? ` (×${Math.min(4, 1 + Math.floor(s.combo / 10))})` : '');
  $('acc').textContent = total ? Math.round((s.perfect + s.good) / total * 100) + ' %' : '—';
  if (G.song) {
    const best = loadJSON('pc_best_' + G.song.id + '_' + S.mode + '_' + S.hands);
    $('bestTxt').textContent = best ? `Record : ${best.score} (${Math.round(best.acc * 100)} %, tempo ${best.tempo} %)` : '';
  }
  const L = G.loop, lt = $('loopTxt');
  lt.hidden = !L;
  if (L) lt.textContent = `🔁 ${barLabel(L.fromBar)}–${barLabel(L.toBar).replace('m. ', '')} · ✔ ${L.streak} d'affilée · passage ${L.passes + 1}`;
}
/** Numéro de mesure affiché (la levée n'a pas de numéro). */
export function barLabel(i) {
  const pk = G.song && G.song.bars[0].pickup;
  return pk ? (i === 0 ? 'levée' : 'm. ' + i) : 'm. ' + (i + 1);
}
function fillLoopDialog() {
  const s = G.song, from = $('loopFrom'), to = $('loopTo'), tg = $('loopTarget');
  from.innerHTML = ''; to.innerHTML = ''; tg.innerHTML = '';
  s.bars.forEach((b, i) => { for (const sel of [from, to]) { const o = document.createElement('option'); o.value = i; o.textContent = barLabel(i).replace('m. ', ''); sel.appendChild(o); } });
  const cur = Math.max(0, Math.min(s.bars.length - 1, barAt(s, Math.max(0, G.pos)).index));
  from.value = G.loop ? G.loop.fromBar : cur; to.value = G.loop ? G.loop.toBar : Math.min(s.bars.length - 1, cur + 1);
  for (let t = 50; t <= 150; t += 10) { const o = document.createElement('option'); o.value = t; o.textContent = t + ' %'; tg.appendChild(o); }
  tg.value = G.loop ? G.loop.target : 100;
  $('loopStop').hidden = !G.loop;
}
export function updatePlayedHud() {
  let main = '—', sub = '';
  if (mic.on && mic.cur != null) {
    main = noteName(mic.cur);
    sub = `🎤 ${mic.freq.toFixed(1)} Hz · ${mic.cents >= 0 ? '+' : ''}${mic.cents} cents`;
  } else if (input.held.size) {
    main = [...input.held.keys()].sort((a, b) => a - b).map(m => noteName(m)).join(' ');
    sub = 'Clavier';
  } else if (input.last) {
    main = noteName(input.last.midi); sub = 'dernière note';
  } else sub = mic.on ? '🎤 en écoute…' : 'Activez le micro ou le MIDI';
  const key = main + '|' + sub;
  if (key !== lastHud) {
    lastHud = key;
    $('playedNote').textContent = main;
    $('playedNote').style.fontSize = main.length > 12 ? '22px' : '34px';
    $('playedSub').textContent = sub;
  }
  if (mic.on) {
    const toPct = v => Math.min(100, Math.sqrt(v / 0.3) * 100);
    $('micLvl').style.width = toPct(mic.level) + '%';
    $('micLvl').style.background = mic.level > S.micGate / 1000 ? COL.ok : '#5b6185';
    $('micGateMark').style.left = toPct(S.micGate / 1000) + '%';
  }
}
let toastTimer = 0;
export function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.className = '', err ? 6000 : 2500);
}
export function setStatus(msg) { $('inputStatus').textContent = msg; }

export function fillSongs(selId) {
  const sel = $('songSel'); sel.innerHTML = '';
  const groups = new Map();
  for (const s of songs) {
    const cat = s.cat || 'Mes morceaux';
    if (!groups.has(cat)) { const g = document.createElement('optgroup'); g.label = cat; groups.set(cat, g); }
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.title; groups.get(cat).appendChild(o);
  }
  for (const cat of ['Mes morceaux', 'Exercices', 'Débutant', 'Fêtes', 'Classique']) if (groups.has(cat)) sel.appendChild(groups.get(cat));
  for (const g of groups.values()) if (!g.parentNode) sel.appendChild(g);
  sel.value = selId;
}
export function selectSong(song) {
  setPlaying(false);
  G.song = song; G.notes = song.notes; resetGeom();
  setNameKey(song.key);
  if (!song.fingered) assignFingers(song);          // doigtés calculés une fois (ceux de la partition sont gardés)
  $('tracksBtn').hidden = !song.raw;
  { const r = song.notes.filter(n => n.hand === 'R').map(n => n.midi).sort((a, b) => a - b);
    if (r.length) setKbOct(Math.floor(r[Math.floor(r.length * 0.2)] / 12) - 1, true); }
  reset(); updateTempoTxt();
  S.lastSong = song.id; saveSettings();
}
export function updateTempoTxt() {
  if (!G.song) return;
  const s = G.song, q = s.bpm * S.tempo / 100, ts = s.ts || { num:4, den:4 };
  // tempo exprimé dans l'unité de la mesure : croche en x/8, blanche en x/2, noire sinon
  const pulse = ts.den === 8 ? `♪ = ${Math.round(q * 2)}` : ts.den === 2 ? `𝅗𝅥 = ${Math.round(q / 2)}` : `♩ = ${Math.round(q)}`;
  $('tempoTxt').textContent = `${S.tempo} % · ${pulse}`;
  $('tempoTxt').title = `${keyName(s.key)} · mesure ${ts.num}/${ts.den}`;
  $('songInfo').textContent = `${keyName(s.key)} · ${ts.num}/${ts.den}`;
}

export function bind() {
  const bindRange = (id, key, after, fmt) => {
    const el = $(id); el.value = S[key];
    const show = () => { if (fmt) $(id + 'Txt').textContent = fmt(S[key]); };
    show();
    el.addEventListener('input', () => { S[key] = +el.value; show(); saveSettings(); after && after(); });
  };
  const bindCheck = (id, key, after) => { const el = $(id); el.checked = !!S[key]; el.addEventListener('change', () => { S[key] = el.checked; saveSettings(); after && after(); }); };
  const bindSelect = (id, key, after) => { const el = $(id); el.value = S[key]; el.addEventListener('change', () => { S[key] = el.value; saveSettings(); el.blur(); after && after(); }); };
  bindRange('tempo', 'tempo', updateTempoTxt);
  bindRange('metroVol', 'metroVol', () => audio.setVolumes());
  bindRange('pianoVol', 'pianoVol', () => audio.setVolumes());
  bindRange('zoom', 'zoom');
  bindRange('micLatency', 'micLatency', null, v => v + ' ms');
  bindRange('micGate', 'micGate', null, v => String(v));
  bindRange('a4', 'a4', null, v => v + ' Hz');
  bindCheck('metroOn', 'metroOn'); bindCheck('labels', 'labels'); bindCheck('demo', 'demo');
  bindCheck('autoOther', 'autoOther'); bindCheck('octaveTol', 'octaveTol');
  bindSelect('mode', 'mode', () => { reset(); toast(S.mode === 'wait' ? 'Mode Attente : la partition vous attend.' : 'Mode Rythme : suivez le tempo !'); });
  bindSelect('hands', 'hands', reset);
  bindSelect('notation', 'notation');
  bindSelect('sound', 'sound', () => { try { audio.ensure(); } catch (e) { /* */ } });
  bindCheck('kbLabels', 'kbLabels'); bindCheck('kbFollow', 'kbFollow'); bindCheck('fingers', 'fingers');
  $('songSel').addEventListener('change', e => { const s = songs.find(x => x.id === e.target.value); if (s) selectSong(s); e.target.blur(); });
  $('playBtn').addEventListener('click', e => { setPlaying(!G.playing); e.currentTarget.blur(); });
  $('restartBtn').addEventListener('click', e => { reset(); e.currentTarget.blur(); });
  $('micBtn').addEventListener('click', async e => {
    e.currentTarget.blur();
    if (mic.on) { toast('Micro déjà actif'); return; }
    try { await enableMic(); } catch (err) { console.error(err); toast(err.name === 'NotAllowedError' ? 'Accès au micro refusé : autorisez-le dans la barre d\'adresse du navigateur.' : 'Micro : ' + err.message, true); }
  });
  const detectMidi = async () => {
    try { const names = await enableMidi(); if (!names.length) $('guide').hidden = false; }
    catch (err) {
      console.error(err); $('guide').hidden = false;
      const denied = err && (err.name === 'SecurityError' || err.name === 'NotAllowedError');
      $('guideDevices').textContent = '❌ ' + (denied ? 'Autorisation MIDI refusée : cliquez sur le cadenas à gauche de l\'adresse et autorisez les appareils MIDI.' : (err.message || String(err)));
    }
  };
  $('midiBtn').addEventListener('click', e => { e.currentTarget.blur(); detectMidi(); });
  $('guideDetect').addEventListener('click', detectMidi);
  $('guideClose').addEventListener('click', () => $('guide').hidden = true);
  $('guideLink').addEventListener('click', e => { e.preventDefault(); $('help').hidden = true; $('guide').hidden = false; });
  $('fileIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleFile(f); });
  let dragDepth = 0;
  addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('dropping'); } });
  addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
  addEventListener('dragover', e => e.preventDefault());
  addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dropping');
    const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) handleFile(f);
  });
  $('listenBtn').addEventListener('click', e => { e.currentTarget.blur(); toggleListen(); });
  $('searchBtn').addEventListener('click', () => { $('search').hidden = false; $('searchQ').focus(); });
  $('searchClose').addEventListener('click', () => $('search').hidden = true);
  $('searchForm').addEventListener('submit', e => { e.preventDefault(); doSearch($('searchQ').value); });
  $('tracksBtn').addEventListener('click', () => { if (G.song && G.song.raw) showTracks(G.song.raw, G.song.assign, G.song.simple, G.song.arr || 'none'); });
  const buildChosen = () => $('trkArr').value === 'none'
    ? buildFromTracks(trkRaw, readTracks(), $('trkSimple').checked)
    : arrangePiano(trkRaw, readTracks(), $('trkArr').value);
  $('trkListen').addEventListener('click', () => {
    try { const s = buildChosen(); setPlaying(false); G.song = s; G.notes = s.notes; resetGeom(); reset(); G.listen = true; setPlaying(true); }
    catch (err) { toast(err.message, true); }
  });
  $('trkOk').addEventListener('click', () => {
    try { addAndSelect(buildChosen()); $('tracks').hidden = true; } catch (err) { toast(err.message, true); }
  });
  $('trkCancel').addEventListener('click', () => { $('tracks').hidden = true; if (G.listen) reset(); if (G.song && !songs.includes(G.song)) selectSong(songs[0]); });
  // Boucle de travail
  $('loopBtn').addEventListener('click', e => { e.currentTarget.blur(); fillLoopDialog(); $('loopDlg').hidden = false; });
  $('loopClose').addEventListener('click', () => $('loopDlg').hidden = true);
  $('loopStart').addEventListener('click', () => {
    $('loopDlg').hidden = true;
    startLoop(+$('loopFrom').value, +$('loopTo').value, $('loopAuto').checked, +$('loopTarget').value);
    toast('Boucle lancée : jouez sans faute pour accélérer');
  });
  $('loopStop').addEventListener('click', () => { $('loopDlg').hidden = true; stopLoop(); toast('Boucle arrêtée'); });
  onTempoChange(() => { $('tempo').value = S.tempo; updateTempoTxt(); });
  // Reconnaissance
  $('recoBtn').addEventListener('click', e => { e.currentTarget.blur(); $('reco').hidden = false; });
  $('recoClose').addEventListener('click', () => { stopRecording(); $('reco').hidden = true; });
  $('recStart').addEventListener('click', startRecording);
  $('recStop').addEventListener('click', stopRecording);
  $('audioIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) processAudioFile(f); });
  const tok = $('auddToken'); tok.value = S.auddToken || '';
  tok.addEventListener('change', () => { S.auddToken = tok.value.trim(); saveSettings(); });
  // Menu sur petit écran
  $('menuBtn').addEventListener('click', e => { e.currentTarget.blur(); document.querySelector('header').classList.toggle('open'); });
  // Clavier tactile (tablette / téléphone / souris)
  const touches = new Map();
  const keyAt = (x, y) => {
    const k = G.kb; if (!k || y < k.y0) return null;
    const { kg } = k;
    if (y < k.y0 + k.kh * 0.62) for (const m in kg.pos) { const p = kg.pos[m]; if (p.black && x >= p.x && x <= p.x + p.w) return +m; }
    for (const m of kg.whites) { const p = kg.pos[m]; if (x >= p.x && x < p.x + p.w) return m; }
    return null;
  };
  cvH.addEventListener('pointerdown', e => {
    const r = cvH.getBoundingClientRect(), m = keyAt(e.clientX - r.left, e.clientY - r.top);
    if (m == null) return;
    e.preventDefault();
    try { cvH.setPointerCapture(e.pointerId); } catch (err) { /* ignoré */ }
    let v = null; try { audio.ensure(); v = audio.note(m, audio.ctx.currentTime, Infinity, 0.45); } catch (err) { /* pas de son */ }
    touches.set(e.pointerId, { m, v }); noteOn(m, 'touch');
  });
  const up = e => { const t = touches.get(e.pointerId); if (t) { touches.delete(e.pointerId); noteOff(t.m); audio.release(t.v); } };
  cvH.addEventListener('pointerup', up); cvH.addEventListener('pointercancel', up);
  // Installation comme application (Android / Chrome / Edge)
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', async () => {
    if (!installEvt) return;
    installEvt.prompt(); await installEvt.userChoice.catch(() => null);
    installEvt = null; $('installBtn').hidden = true;
  });
  addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast('Piano Cascade est installé ✔'); });
  // Échap ferme les fenêtres
  // fenêtres : focus sur le premier élément utile à l'ouverture, retour à l'élément précédent à la fermeture
  let lastFocus = null, outsideFocus = null;
  document.addEventListener('focusin', e => { if (!e.target.closest('.overlay')) outsideFocus = e.target; });
  for (const ov of document.querySelectorAll('.overlay')) {
    new MutationObserver(() => {
      if (!ov.hidden) {
        lastFocus = outsideFocus;
        const first = ov.querySelector('input:not([type=hidden]):not([hidden]), select, button:not([hidden])');
        if (first) setTimeout(() => first.focus(), 0);
      } else if (lastFocus && document.contains(lastFocus)) { lastFocus.focus(); lastFocus = null; }
    }).observe(ov, { attributes:true, attributeFilter:['hidden'] });
  }
  addEventListener('keydown', e => { if (e.key === 'Escape') for (const id of ['help', 'results', 'search', 'tracks', 'guide', 'reco', 'loopDlg', 'today']) if (!$(id).hidden) { $(id).hidden = true; if (id === 'tracks' && G.listen) reset(); } });
  $('helpBtn').addEventListener('click', () => $('help').hidden = false);
  $('helpClose').addEventListener('click', () => $('help').hidden = true);
  $('resAgain').addEventListener('click', () => { reset(); setPlaying(true); });
  $('resClose').addEventListener('click', () => $('results').hidden = true);
  document.addEventListener('click', e => { const d = $('opts'); if (d.open && !d.contains(e.target)) d.open = false; });
  // garde le menu Options entièrement dans la fenêtre, quelle que soit la place du bouton
  const placeOpts = () => {
    const d = $('opts'), menu = d.querySelector('.menu');
    if (!d.open) return;
    if (innerWidth <= 900) { menu.style.cssText = ''; return; }   // petit écran : géré par le CSS
    const r = d.querySelector('summary').getBoundingClientRect(), w = Math.min(360, innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
    menu.style.cssText = `position:fixed;left:${left}px;right:auto;top:${r.bottom + 6}px;width:${w}px;max-height:${Math.max(200, innerHeight - r.bottom - 16)}px;overflow:auto`;
  };
  $('opts').addEventListener('toggle', placeOpts);
  addEventListener('resize', placeOpts);
}
