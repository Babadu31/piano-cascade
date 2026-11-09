import { audio } from './audio.js';
import { $ } from './dom.js';
import { doSearch } from './search.js';
import { S } from './settings.js';
import { showTracks } from './tracks.js';
import { encodeWav, notesToRaw } from './transcribe.js';
import { toast } from './ui.js';

/* ================= Reconnaissance & transcription ================= */
const BP_RATE = 22050;
let bpLib = null, bpModel = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = src; sc.onload = res;
    sc.onerror = () => rej(new Error('module de transcription introuvable (' + src + ')'));
    document.head.appendChild(sc);
  });
}
async function getBasicPitch() {
  if (location.protocol === 'file:') throw new Error('ouvrez l\'appli avec PianoCascade.exe ou Lancer.bat (la transcription ne marche pas en double-cliquant sur index.html).');
  if (!bpLib) { await loadScript('vendor/basic-pitch/basic-pitch.js'); bpLib = window.BasicPitchLib; }
  if (!bpModel) bpModel = new bpLib.BasicPitch('vendor/basic-pitch/model.json');
  return bpModel;
}
const recSt = t => $('recStatus').textContent = t;
const recBar = f => $('recBar').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%';

/** Ramène n'importe quel son à 22 050 Hz mono (format attendu par le modèle). */
async function toModelPcm(abuf, maxSec = 90) {
  const dur = Math.min(abuf.duration, maxSec);
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(dur * BP_RATE)), BP_RATE);
  const src = off.createBufferSource(); src.buffer = abuf; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  let peak = 0; for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 0.003) throw new Error('le son est presque silencieux : rapprochez le micro ou montez le volume.');
  const g = 0.9 / peak; for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
  return pcm;
}

export async function transcribePcm(pcm, o = {}) {
  const model = await getBasicPitch();
  const frames = [], onsets = [], contours = [];
  await model.evaluateModel(pcm, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    p => { recSt(`Transcription des notes… ${Math.round(p * 100)} %`); recBar(0.1 + p * 0.85); });
  const L = bpLib;
  const ev = L.noteFramesToTime(L.addPitchBendsToNoteEvents(contours, L.outputToNotesPoly(frames, onsets, o.onset ?? 0.3, o.frame ?? 0.25, o.minLen ?? 6, o.infer ?? true)));
  return ev.map(n => ({ midi:n.pitchMidi, t:n.startTimeSeconds, d:n.durationSeconds, a:n.amplitude }))
           .filter(n => n.d >= 0.06 && n.midi >= 21 && n.midi <= 108);
}

/** Reconnaissance du titre (service AudD, facultatif : seulement avec une clé). */
async function identify(pcm) {
  const fd = new FormData();
  fd.append('api_token', S.auddToken.trim());
  fd.append('file', new Blob([encodeWav(pcm.subarray(0, BP_RATE * 15), BP_RATE)], { type:'audio/wav' }), 'extrait.wav');
  const r = await fetch('https://api.audd.io/', { method:'POST', body:fd });
  const j = await r.json();
  if (j.status !== 'success') throw new Error((j.error && j.error.error_message) || 'service indisponible');
  return j.result;   // null si inconnu
}

function showReco(result) {
  const box = $('recoResult'); box.innerHTML = '';
  if (!result) return;
  const d = document.createElement('div'); d.className = 'dev';
  const b = document.createElement('b'); b.textContent = '🎵 ' + result.title + (result.artist ? ' — ' + result.artist : '');
  d.appendChild(b);
  const btn = document.createElement('button'); btn.textContent = '🔎 Chercher une partition MIDI libre de ce titre';
  btn.style.marginLeft = '10px';
  btn.onclick = () => { $('reco').hidden = true; $('search').hidden = false; $('searchQ').value = result.title; doSearch(result.title); };
  d.appendChild(btn); box.appendChild(d);
}

let recBusy = false;
async function processAudio(abuf, label) {
  if (recBusy) return; recBusy = true;
  $('recStart').disabled = true;
  try {
    recSt('Préparation du son…'); recBar(0.05);
    const pcm = await toModelPcm(abuf);
    let title = label, idPromise = null;
    if (S.auddToken && S.auddToken.trim()) {
      idPromise = identify(pcm).catch(e => { console.warn(e); return { error:e.message }; });
    }
    recSt('Chargement du modèle de transcription…'); recBar(0.08);
    const evs = await transcribePcm(pcm);
    if (idPromise) {
      recSt('Recherche du titre…');
      const res = await idPromise;
      if (res && res.title) { title = res.title + (res.artist ? ' – ' + res.artist : ''); showReco(res); }
      else if (res && res.error) toast('Titre non trouvé : ' + res.error, true);
      else toast('Titre inconnu du service de reconnaissance.');
    }
    const { raw, assign } = notesToRaw(evs, title);
    recBar(1);
    recSt(`✔ ${evs.length} notes trouvées, tempo ≈ ${raw.bpm} BPM. Choisissez les mains puis Valider.`);
    showTracks(raw, assign, true, 'easy');
  } catch (e) {
    console.error(e); recSt('❌ ' + e.message); recBar(0);
  } finally { recBusy = false; $('recStart').disabled = false; }
}

const rec = { mr:null, stream:null, chunks:[], t0:0, timer:0 };
export async function startRecording() {
  try { audio.ensure(); } catch (e) { recSt('❌ ' + e.message); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
    recSt('❌ Enregistrement impossible dans ce navigateur : utilisez Chrome ou Edge, ou choisissez un fichier audio.'); return;
  }
  try {
    rec.stream = await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:true } });
  } catch (e) {
    recSt(e.name === 'NotAllowedError' ? '❌ Accès au micro refusé : autorisez-le dans la barre d\'adresse.' : '❌ Micro : ' + e.message); return;
  }
  rec.chunks = [];
  rec.mr = new MediaRecorder(rec.stream);
  rec.mr.ondataavailable = e => { if (e.data && e.data.size) rec.chunks.push(e.data); };
  rec.mr.onstop = async () => {
    clearInterval(rec.timer);
    rec.stream.getTracks().forEach(t => t.stop());
    $('recStart').hidden = false; $('recStop').hidden = true;
    try {
      const blob = new Blob(rec.chunks, { type:rec.mr.mimeType || 'audio/webm' });
      const abuf = await audio.ctx.decodeAudioData(await blob.arrayBuffer());
      await processAudio(abuf, 'Musique enregistrée ' + new Date().toLocaleTimeString().slice(0, 5));
    } catch (e) { console.error(e); recSt('❌ Enregistrement illisible : ' + e.message); }
  };
  rec.mr.start(250);
  rec.t0 = performance.now();
  $('recStart').hidden = true; $('recStop').hidden = false; recBar(0);
  rec.timer = setInterval(() => {
    const t = (performance.now() - rec.t0) / 1000;
    recSt(`🔴 J'écoute… ${t.toFixed(0)} s (arrêt automatique à 30 s)`); recBar(t / 30);
    if (t >= 30 && rec.mr.state === 'recording') rec.mr.stop();
  }, 200);
}
export function stopRecording() { if (rec.mr && rec.mr.state === 'recording') rec.mr.stop(); }
export async function processAudioFile(f) {
  try {
    audio.ensure();
    recSt('Lecture du fichier…');
    const abuf = await audio.ctx.decodeAudioData(await f.arrayBuffer());
    await processAudio(abuf, f.name.replace(/\.[^.]+$/, ''));
  } catch (e) { console.error(e); recSt('❌ Fichier audio illisible : ' + (e.message || e)); }
}
