import { STEP, spToMidi } from './theory.js';

export async function readMxl(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('fichier .mxl invalide.');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const entries = {}, td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('archive .mxl corrompue.');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    entries[td.decode(u8.subarray(p + 46, p + 46 + nl))] = { method, csize, lho };
    p += 46 + nl + el + cl;
  }
  const read = async name => {
    const e = entries[name]; if (!e) throw new Error('fichier manquant dans le .mxl : ' + name);
    const start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
    const data = u8.subarray(start, start + e.csize);
    if (e.method === 0) return td.decode(data);
    if (e.method !== 8) throw new Error('compression .mxl non gérée.');
    if (typeof DecompressionStream === 'undefined') throw new Error('navigateur trop ancien pour lire .mxl (exportez en .musicxml).');
    return await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  let root = null;
  if (entries['META-INF/container.xml']) {
    const c = new DOMParser().parseFromString(await read('META-INF/container.xml'), 'application/xml');
    const rf = c.querySelector('rootfile'); if (rf) root = rf.getAttribute('full-path');
  }
  if (!root) root = Object.keys(entries).find(n => !n.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(n));
  if (!root) throw new Error('aucune partition dans le .mxl.');
  return read(root);
}

export function parseMusicXML(text, name) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML illisible.');
  const rootName = doc.documentElement.nodeName;
  if (rootName === 'score-timewise') throw new Error('format MusicXML « timewise » non géré.');
  if (rootName !== 'score-partwise') throw new Error("ce n'est pas une partition MusicXML.");
  const q = s => doc.querySelector(s);
  const title = ((q('work > work-title') || q('movement-title') || {}).textContent || name).trim() || name;
  const num = (el, sel) => { const x = el.querySelector(sel); return x ? parseFloat(x.textContent) || 0 : 0; };
  const parts = [...doc.querySelectorAll('score-partwise > part')];
  if (!parts.length) throw new Error('partition vide.');

  // 1. chaque partie, mesure par mesure (temps relatifs au début de la mesure, en noires)
  let key = null;
  const perPart = parts.map((part, pi) => {
    let div = 1, staves = 1;
    return [...part.querySelectorAll(':scope > measure')].map(meas => {
      const m = { notes:[], len:0, ts:null, tempo:[], repeatFwd:false, repeatBack:0, ending:null, endingStart:false, endingStop:false };
      let cur = 0, lastStart = 0;
      const reach = () => { m.len = Math.max(m.len, cur / div); };
      for (const el of meas.children) {
        switch (el.nodeName) {
          case 'attributes': {
            const d = el.querySelector('divisions'); if (d) div = parseFloat(d.textContent) || 1;
            const sv = el.querySelector('staves'); if (sv) staves = parseInt(sv.textContent) || 1;
            const t = el.querySelector('time');
            if (t) { const be = num(t, 'beats'), bt = num(t, 'beat-type'); if (be && bt) m.ts = { num:be, den:bt }; }
            const k = el.querySelector('key');
            if (k && !key && k.querySelector('fifths'))
              key = { fifths:Math.max(-7, Math.min(7, num(k, 'fifths'))), mode:((k.querySelector('mode') || {}).textContent || '').trim() === 'minor' ? 'minor' : 'major' };
            break;
          }
          case 'direction': case 'sound': {
            const snd = el.nodeName === 'sound' ? el : el.querySelector('sound[tempo]');
            if (snd && snd.getAttribute('tempo') && pi === 0) { const b = parseFloat(snd.getAttribute('tempo')); if (b > 0) m.tempo.push({ at:cur / div, bpm:b }); }
            break;
          }
          case 'barline': {
            const rep = el.querySelector('repeat'), end = el.querySelector('ending');
            if (rep && rep.getAttribute('direction') === 'forward') m.repeatFwd = true;
            if (rep && rep.getAttribute('direction') === 'backward') m.repeatBack = parseInt(rep.getAttribute('times')) || 2;
            if (end) {
              const type = end.getAttribute('type');
              if (type === 'start') { m.endingStart = true; m.ending = (end.getAttribute('number') || '1').split(/[,\s]+/).map(Number).filter(Boolean); }
              if (type === 'stop' || type === 'discontinue') m.endingStop = true;
            }
            break;
          }
          case 'backup': reach(); cur -= num(el, 'duration'); break;
          case 'forward': cur += num(el, 'duration'); reach(); break;
          case 'note': {
            if (el.querySelector(':scope > grace')) break;
            const d = num(el, ':scope > duration');
            const chord = !!el.querySelector(':scope > chord');
            const start = chord ? lastStart : cur;
            if (!chord) { lastStart = cur; cur += d; reach(); }
            if (el.querySelector(':scope > rest')) break;
            const pitch = el.querySelector(':scope > pitch'); if (!pitch) break;
            const step = (pitch.querySelector('step') || {}).textContent;
            if (!(step in STEP)) break;
            const sp = { letter:'CDEFGAB'.indexOf(step), alt:Math.round(num(pitch, 'alter')), oct:num(pitch, 'octave') };
            const staff = num(el, ':scope > staff') || 1;
            const ties = [...el.querySelectorAll(':scope > tie')].map(t => t.getAttribute('type'));
            const fg = el.querySelector(':scope > notations > technical > fingering');
            const finger = fg ? parseInt(fg.textContent) : 0;
            m.notes.push({ midi:spToMidi(sp), sp, start:start / div, dur:d / div, ties, finger:finger >= 1 && finger <= 5 ? finger : undefined,
                           hand:staves >= 2 ? (staff >= 2 ? 'L' : 'R') : (pi === 0 ? 'R' : 'L') });
            break;
          }
        }
      }
      return m;
    });
  });

  // 2. longueur et chiffrage de chaque mesure (toutes parties confondues)
  const nMeas = Math.max(...perPart.map(p => p.length));
  const meas = [];
  let ts = { num:4, den:4 };
  for (let i = 0; i < nMeas; i++) {
    const ms = perPart.map(p => p[i]).filter(Boolean), m0 = perPart[0][i] || ms[0];
    if (m0 && m0.ts) ts = m0.ts;
    const content = Math.max(...ms.map(m => m.len));
    meas.push({ ...m0, ts, len:content > 0 ? content : ts.num * 4 / ts.den });
  }
  // fins de 1re / 2e fois : chaque mesure garde les passages où elle est jouée
  let curEnding = null;
  for (const m of meas) {
    if (m.endingStart) curEnding = m.ending;
    m.inEnding = curEnding;
    if (m.endingStop) curEnding = null;
  }

  // 3. ordre de jeu : reprises et fins alternatives dépliées
  const order = [], count = new Map();
  let i = 0, repStart = 0, pass = 1;
  for (let guard = 0; i < meas.length && guard < meas.length * 8; guard++) {
    const m = meas[i];
    if (m.repeatFwd && !count.size) { repStart = i; }
    if (m.inEnding && !m.inEnding.includes(pass)) { i++; continue; }
    order.push(i);
    if (m.repeatBack) {
      const c = count.get(i) || 1;
      if (c < m.repeatBack) { count.set(i, c + 1); pass = c + 1; i = repStart; continue; }
      count.delete(i); pass = 1; repStart = i + 1;
    }
    i++;
  }

  // 4. déroulé : notes, mesures, tempos
  const notes = [], bars = [], tempos = [];
  const tieOpen = perPart.map(() => new Map());
  let offset = 0;
  for (const idx of order) {
    const m = meas[idx];
    bars.push({ start:offset, len:m.len, ts:m.ts });
    for (const t of m.tempo) tempos.push({ beat:offset + t.at, bpm:t.bpm });
    perPart.forEach((p, pi) => {
      const pm = p[idx]; if (!pm) return;
      for (const n of pm.notes) {
        const start = offset + n.start, k = n.midi + n.hand, open = tieOpen[pi];
        if (n.ties.includes('stop') && open.has(k)) {
          const prev = open.get(k); prev.dur = start + n.dur - prev.start;
          if (!n.ties.includes('start')) open.delete(k);
        } else if (n.dur > 0) {
          const nn = { midi:n.midi, sp:n.sp, start, dur:n.dur, hand:n.hand, finger:n.finger }; notes.push(nn);
          if (n.ties.includes('start')) open.set(k, nn);
        }
      }
    });
    offset += m.len;
  }
  const first = meas.length ? meas[0].ts : ts;
  return { title, bpm:tempos.length ? tempos[0].bpm : 100, ts:first, barBeats:first.num * 4 / first.den,
           key, notes, bars, tempos:tempos.length ? tempos : null, repeats:order.length !== meas.length };
}
