import { $ } from './dom.js';
import { songs } from './library.js';
import { noteName } from './theory.js';
import { fillSongs, selectSong, toast } from './ui.js';

// --- Fenêtre « Pistes » ---
export let trkRaw = null;
export function showTracks(raw, assign, simple, arr) {
  trkRaw = raw;
  $('trkArr').value = arr || (raw.tracks.length > 2 ? 'easy' : 'none');
  const tb = $('trkTable'); tb.innerHTML = '';
  const opts = [['R', 'Main droite'], ['L', 'Main gauche'], ['S', 'Les deux (partage au Do du milieu)'], ['X', 'Ignorer']];
  raw.tracks.forEach((t, i) => {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); const b = document.createElement('b'); b.textContent = t.label; td1.appendChild(b);
    const td2 = document.createElement('td'); td2.className = 'muted small'; td2.textContent = `${t.notes.length} notes · ${noteName(t.lo)}–${noteName(t.hi)}`;
    const td3 = document.createElement('td'); const sel = document.createElement('select'); sel.dataset.i = i;
    for (const [v, l] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = l; sel.appendChild(o); }
    sel.value = assign[i]; td3.appendChild(sel);
    tr.append(td1, td2, td3); tb.appendChild(tr);
  });
  $('trkSimple').checked = !!simple;
  $('tracks').hidden = false;
}
export function readTracks() {
  return [...$('trkTable').querySelectorAll('select')].map(s => s.value);
}
export function addAndSelect(song) {
  const i = songs.findIndex(s => s.id === song.id); if (i >= 0) songs.splice(i, 1);
  songs.unshift(song); fillSongs(song.id); selectSong(song);
  const hands = new Set(song.notes.map(n => n.hand));
  toast(`« ${song.title} » : ${song.notes.length} notes, ${Math.round(song.bpm)} BPM` + (hands.size > 1 ? ', 2 mains' : '') + ' — 🎧 Écouter pour entendre l\'air');
  return song;
}
