/* ================= Import de partitions ================= */
const GM_FAM = ['Piano', 'Percussion chromatique', 'Orgue', 'Guitare', 'Basse', 'Cordes', 'Ensemble', 'Cuivres', 'Anches',
  'Flûte', 'Synthé (mélodie)', 'Synthé (nappe)', 'Effets synthé', 'Instrument ethnique', 'Percussions', 'Effets'];
/** Lit un fichier MIDI. Renvoie les pistes (une par piste + canal), sans attribuer les mains. */
export function parseMidi(buf, name) {
  const b = new Uint8Array(buf); let p = 0;
  const need = n => { if (p + n > b.length) throw new Error('fichier MIDI tronqué.'); };
  const str = n => { need(n); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); p += n; return s; };
  const u32 = () => { need(4); const v = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { need(2); const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
  if (str(4) !== 'MThd') throw new Error("ce n'est pas un fichier MIDI.");
  const hlen = u32(); u16(); const ntr = u16(), div = u16(); p = 8 + hlen;
  if (div & 0x8000) throw new Error('MIDI au format SMPTE non géré.');
  if (!div) throw new Error('en-tête MIDI invalide.');
  let key = null; const tempoEv = [], tsEv = []; const groups = new Map(), programs = {};
  const td = new TextDecoder();
  for (let t = 0; t < ntr && p + 8 <= b.length; t++) {
    const id = str(4), len = u32(), end = Math.min(b.length, p + len);
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, run = 0, tname = ''; const open = new Map(), notes = [];
    const vlq = () => { let v = 0, c; do { if (p >= end) throw new Error('fichier MIDI corrompu.'); c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
    while (p < end) {
      tick += vlq();
      let st = b[p];
      if (st & 0x80) p++; else { if (!run) throw new Error('fichier MIDI corrompu (running status).'); st = run; }
      if (st === 0xFF) {
        const type = b[p++], l = vlq(), d = b.subarray(p, p + l); p += l;
        if (type === 0x51 && l >= 3) tempoEv.push({ beat:tick / div, bpm:60e6 / ((d[0] << 16) | (d[1] << 8) | d[2]) });
        else if (type === 0x58 && l >= 2 && d[0] > 0) tsEv.push({ beat:tick / div, ts:{ num:d[0], den:Math.pow(2, d[1]) } });
        else if (type === 0x59 && l >= 2 && !key) key = { fifths:Math.max(-7, Math.min(7, d[0] > 127 ? d[0] - 256 : d[0])), mode:d[1] ? 'minor' : 'major' };
        else if (type === 0x03 && !tname) tname = td.decode(d).replace(/\0/g, '').trim().slice(0, 40);
        else if (type === 0x2F) p = end;
        run = 0; continue;
      }
      if (st === 0xF0 || st === 0xF7) { p += vlq(); run = 0; continue; }
      if (st > 0xF0) continue;
      run = st;
      const cmd = st & 0xF0, ch = st & 0x0F;
      const d1 = b[p++], d2 = (cmd === 0xC0 || cmd === 0xD0) ? 0 : b[p++];
      if (ch === 9) continue;                                   // percussions
      if (cmd === 0xC0) { if (!(ch in programs)) programs[ch] = d1; continue; }
      const nk = ch * 128 + d1;
      if (cmd === 0x90 && d2 > 0) { if (!open.has(nk)) open.set(nk, []); open.get(nk).push([tick, d2]); }
      else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
        const s = open.get(nk);
        if (s && s.length) { const [t0, vel] = s.shift(); notes.push({ midi:d1, ch, vel, start:t0 / div, dur:Math.max(div / 16, tick - t0) / div }); }
      }
    }
    for (const [key, s] of open) for (const [t0, vel] of s) notes.push({ midi:key % 128, ch:Math.floor(key / 128), vel, start:t0 / div, dur:Math.max(div / 4, tick - t0) / div });
    for (const n of notes) {
      const k = t + ':' + n.ch;
      if (!groups.has(k)) groups.set(k, { name:tname, ch:n.ch, notes:[] });
      groups.get(k).notes.push({ midi:n.midi, vel:n.vel, start:n.start, dur:n.dur });
    }
    p = end;
  }
  const tracks = [...groups.values()].map(g => {
    const program = programs[g.ch] || 0;
    g.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
    let lo = 127, hi = 0, sum = 0;
    for (const n of g.notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); sum += n.midi; }
    return { label:(g.name || GM_FAM[Math.floor(program / 8)]) + ' · canal ' + (g.ch + 1), notes:g.notes, lo, hi, mean:sum / g.notes.length };
  });
  if (!tracks.length) throw new Error('aucune note dans ce fichier MIDI.');
  tempoEv.sort((a, b) => a.beat - b.beat); tsEv.sort((a, b) => a.beat - b.beat);
  const meters = tsEv.length ? tsEv : [{ beat:0, ts:{ num:4, den:4 } }];
  if (meters[0].beat > 0) meters.unshift({ beat:0, ts:{ num:4, den:4 } });
  const tempos = tempoEv.length ? tempoEv : [{ beat:0, bpm:120 }];
  const ts0 = meters[0].ts;
  return { title:name, bpm:tempos[0].bpm, barBeats:ts0.num * 4 / ts0.den, ts:ts0, meters, tempos, key, tracks };
}
