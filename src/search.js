import { $ } from './dom.js';
import { toggleListen } from './game.js';
import { loadBuffer } from './importer.js';
import { toast } from './ui.js';

// --- Recherche en ligne (Wikimedia Commons : fichiers MIDI libres) ---
export const servedLocally = location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
async function netFetch(url) {
  let firstErr;
  try { const r = await fetch(url); if (r.ok) return r; firstErr = new Error('le serveur a répondu ' + r.status); }
  catch (e) { firstErr = e; }
  if (servedLocally) {   // repli : passer par le petit serveur local (contourne les blocages CORS)
    try { const r = await fetch('/__proxy?url=' + encodeURIComponent(url)); if (r.ok) return r; } catch (e) { /* ignoré */ }
  }
  throw new Error(firstErr instanceof TypeError ? 'connexion impossible (êtes-vous connecté à internet ?)' : firstErr.message);
}
function cleanTitle(t) {
  return t.replace(/^(File|Fichier):/i, '').replace(/\.(midi?|kar)$/i, '').replace(/_/g, ' ').trim();
}
/** Liens de recherche ailleurs sur le web (l'utilisateur télécharge puis glisse le fichier dans l'appli). */
function webLinks(q) {
  const d = document.createElement('div'); d.className = 'dev';
  const t = document.createElement('div'); t.className = 'small'; t.style.marginBottom = '6px';
  t.textContent = 'Plus de choix (jeux vidéo, films, séries…) : ouvrez une recherche, téléchargez un fichier .mid ou MusicXML, puis glissez-le dans l\'appli (ou 📂 Importer). Choisissez ensuite « Piano facile » dans 🎚 Pistes.';
  d.appendChild(t);
  const links = [
    ['🎹 MuseScore (arrangements piano)', 'https://musescore.com/sheetmusic?instrument=2&text=' + encodeURIComponent(q)],
    ['🌐 Web : « ' + q + ' midi piano »', 'https://www.google.com/search?q=' + encodeURIComponent(q + ' midi piano')],
    ['🎼 Mutopia (classique libre)', 'https://www.mutopiaproject.org/cgibin/make-table.cgi?searchingfor=' + encodeURIComponent(q)],
  ];
  for (const [label, href] of links) {
    const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label;
    a.className = 'btn'; a.style.cssText = 'display:inline-block;margin:3px 6px 3px 0;text-decoration:none';
    d.appendChild(a);
  }
  return d;
}
const stripHtml = h => new DOMParser().parseFromString(h || '', 'text/html').body.textContent.trim();
let searchSeq = 0;
export async function doSearch(q) {
  q = q.trim(); if (!q) return;
  const seq = ++searchSeq;
  const msg = $('searchMsg'), box = $('searchRes');
  msg.textContent = 'Recherche…'; box.innerHTML = '';
  const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action:'query', format:'json', origin:'*', generator:'search', gsrnamespace:'6', gsrlimit:'50',
    gsrsearch: q + ' filemime:audio/midi', prop:'imageinfo', iiprop:'url|size|extmetadata',
    iiextmetadatafilter:'LicenseShortName|Artist' });
  try {
    const data = await (await netFetch(url)).json();
    if (seq !== searchSeq) return;
    const pages = Object.values((data.query && data.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    const items = pages.map(pg => ({ pg, ii:(pg.imageinfo || [])[0] })).filter(x => x.ii && x.ii.url);
    msg.textContent = items.length ? `${items.length} fichier(s) libre(s) pour « ${q} »` : `Aucun fichier MIDI libre pour « ${q} ». Essayez le compositeur (Bach, Chopin…), le titre en anglais, ou les liens ci-dessous.`;
    for (const { pg, ii } of items) {
      const meta = ii.extmetadata || {};
      const lic = meta.LicenseShortName ? stripHtml(meta.LicenseShortName.value) : '';
      const by = meta.Artist ? stripHtml(meta.Artist.value).slice(0, 60) : '';
      const row = document.createElement('div'); row.className = 'res';
      const info = document.createElement('div');
      const b = document.createElement('b'); b.textContent = cleanTitle(pg.title);
      const sm = document.createElement('small'); sm.textContent = [Math.max(1, Math.round((ii.size || 0) / 1024)) + ' Ko', lic, by].filter(Boolean).join(' · ');
      info.append(b, sm);
      const acts = document.createElement('div'); acts.className = 'acts';
      const listen = document.createElement('button'); listen.textContent = '🎧 Écouter';
      const open = document.createElement('button'); open.className = 'primary'; open.textContent = 'Ouvrir';
      const link = document.createElement('a'); link.href = ii.descriptionurl || 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(pg.title);
      link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'ⓘ'; link.title = 'Page du fichier (auteur, licence)';
      listen.onclick = () => openRemote(ii, pg.title, true);
      open.onclick = () => openRemote(ii, pg.title, false);
      acts.append(listen, ' ', open, ' ', link);
      row.append(info, acts); box.appendChild(row);
    }
    box.appendChild(webLinks(q));
  } catch (e) {
    if (seq !== searchSeq) return;
    console.error(e); msg.textContent = 'Recherche impossible : ' + e.message; box.appendChild(webLinks(q));
  }
}
async function openRemote(ii, title, thenListen) {
  if (ii.size > 3 * 1024 * 1024) { toast('Fichier trop gros pour être un morceau de piano.', true); return; }
  toast('Téléchargement…');
  try {
    const buf = await (await netFetch(ii.url)).arrayBuffer();
    const song = await loadBuffer(buf, cleanTitle(title), 'commons:' + title);
    if (song) {
      $('search').hidden = true;
      if (thenListen) toggleListen();
    } else $('search').hidden = true;     // la fenêtre « Pistes » s'est ouverte
  } catch (e) { console.error(e); toast('Ouverture impossible : ' + e.message, true); }
}
