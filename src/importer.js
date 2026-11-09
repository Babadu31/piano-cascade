import { parseMidi } from './midi.js';
import { parseMusicXML, readMxl } from './musicxml.js';
import { buildFromTracks, defaultAssign, finalize } from './song.js';
import { addAndSelect, showTracks } from './tracks.js';
import { toast } from './ui.js';

/** Charge un fichier (MIDI, MusicXML ou .mxl) depuis son contenu. */
export async function loadBuffer(buf, name, id) {
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  const magic = String.fromCharCode(...head);
  if (magic === 'MThd') {
    const raw = parseMidi(buf, name); raw.id = id;
    const assign = defaultAssign(raw.tracks);
    if (raw.tracks.length > 2) { showTracks(raw, assign, false); return null; }
    return addAndSelect(buildFromTracks(raw, assign, false));
  }
  const xml = magic.startsWith('PK') ? await readMxl(buf) : new TextDecoder().decode(buf);
  const song = parseMusicXML(xml, name); song.id = id;
  return addAndSelect(finalize(song));
}
export async function importFile(f) {
  return loadBuffer(await f.arrayBuffer(), f.name.replace(/\.[^.]+$/, ''), 'import:' + f.name);
}
export async function handleFile(f) {
  try { await importFile(f); }
  catch (err) { console.error(err); toast('Import impossible : ' + err.message, true); }
}
