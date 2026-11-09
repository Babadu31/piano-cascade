import { G } from './game.js';
import { S } from './settings.js';
import { pcOf } from './theory.js';

/* ================= Audio : métronome + petit piano ================= */
export const audio = {
  ctx:null, metroBus:null, synthBus:null, noise:null, live:new Set(), clicks:[],
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio non disponible dans ce navigateur.');
    const c = this.ctx = new AC({ latencyHint:'interactive' });
    const comp = c.createDynamicsCompressor(); comp.connect(c.destination);
    this.metroBus = c.createGain(); this.metroBus.connect(comp);
    this.synthBus = c.createGain(); this.synthBus.connect(comp);
    this.noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.06), c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    this.setVolumes();
    G.lastT = c.currentTime;
    this.loadPiano();
  },
  setVolumes() {
    if (!this.ctx) return;
    this.metroBus.gain.value = (S.metroVol / 100) * 0.9;
    this.synthBus.gain.value = (S.pianoVol / 100) * 0.8;
  },
  track(srcs, g) {
    const o = { srcs, g }; this.live.add(o);
    srcs[0].onended = () => this.live.delete(o);
  },
  /** Clic du métronome. level : 2 = premier temps, 1 = temps secondaire, 0 = autre. */
  click(t, level) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = [2200, 2800, 3400][level] || 2200; bp.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime([1.1, 1.4, 1.8][level] || 1.1, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(bp).connect(g).connect(this.metroBus);
    src.start(t); src.stop(t + 0.06);
    this.track([src], g);
    this.clicks.push(t);
  },
  inClick(now) {   // vrai si un clic du métronome est en train d'être capté par le micro
    while (this.clicks.length && this.clicks[0] < now - 0.2) this.clicks.shift();
    return this.clicks.some(t => now >= t - 0.01 && now <= t + 0.09);
  },
  samples:new Map(), pianoLoading:null, pianoOk:false,
  loadPiano() {
    if (this.pianoLoading || !this.ctx || location.protocol === 'file:') return this.pianoLoading;
    const L = { 9:'A', 0:'C', 3:'Ds', 6:'Fs' };
    const list = []; for (let m = 21; m <= 108; m += 3) list.push({ m, n:L[pcOf(m)] + (Math.floor(m / 12) - 1) });
    this.pianoLoading = Promise.all(list.map(async ({ m, n }) => {
      const r = await fetch('vendor/piano/' + n + '.ogg');
      if (!r.ok) throw new Error('son ' + n + ' introuvable');
      this.samples.set(m, await this.ctx.decodeAudioData(await r.arrayBuffer()));
    })).then(() => { this.pianoOk = true; }).catch(e => { console.warn('piano réaliste indisponible :', e); });
    return this.pianoLoading;
  },
  /** Joue une note. dur = Infinity : tenue jusqu'à release(). Renvoie la voix. */
  note(midi, t, dur, vel = 0.45) {
    if (S.sound !== 'synth' && this.pianoOk) {
      const c = this.ctx, base = Math.min(108, Math.max(21, 21 + 3 * Math.round((midi - 21) / 3)));
      const src = c.createBufferSource(); src.buffer = this.samples.get(base);
      src.playbackRate.value = Math.pow(2, (midi - base) / 12) * (S.a4 || 440) / 440;   // échantillons enregistrés à La 440
      const g = c.createGain(); src.connect(g).connect(this.synthBus);
      const v = vel * 1.5;
      g.gain.setValueAtTime(v, t);
      const voice = { srcs:[src], g };
      if (isFinite(dur)) {
        const end = t + Math.max(0.15, dur * 0.97);
        g.gain.setTargetAtTime(0, end, 0.12);           // étouffoir : la note s'éteint quand on la lâche
        src.start(t); src.stop(Math.min(end + 1.2, t + src.buffer.duration / src.playbackRate.value));
      } else src.start(t);
      this.track(voice.srcs, g);
      return voice;
    }
    const c = this.ctx, f = (S.a4 || 440) * Math.pow(2, (midi - 69) / 12);
    const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const g2 = c.createGain(); g2.gain.value = 0.25;
    const g = c.createGain();
    o1.connect(g); o2.connect(g2).connect(g); g.connect(this.synthBus);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.006);
    g.gain.setTargetAtTime(vel * 0.25, t + 0.006, 0.35);
    o1.start(t); o2.start(t);
    if (isFinite(dur)) {
      const end = t + Math.max(0.12, dur * 0.95);
      g.gain.setTargetAtTime(0, end, 0.07);
      o1.stop(end + 0.5); o2.stop(end + 0.5);
    }
    this.track([o1, o2], g);
    return { srcs:[o1, o2], g };
  },
  release(voice) {
    if (!voice || !this.ctx) return;
    const now = this.ctx.currentTime;
    try {
      voice.g.gain.cancelScheduledValues(now);
      voice.g.gain.setValueAtTime(voice.g.gain.value, now);
      voice.g.gain.setTargetAtTime(0, now, 0.1);
      voice.srcs.forEach(s => s.stop(now + 0.8));
    } catch (e) { /* déjà arrêtée */ }
  },
  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const o of this.live) {
      try {
        o.g.gain.cancelScheduledValues(now);
        o.g.gain.setValueAtTime(0, now + 0.02);
        o.srcs.forEach(s => s.stop(now + 0.03));
      } catch (e) { /* déjà arrêté */ }
    }
    this.clicks = this.clicks.filter(t => t <= now);
  },
};
