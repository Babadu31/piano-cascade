/* Piano Cascade — fonctionnement hors ligne.
   Page : réseau d'abord (pour recevoir les mises à jour), sinon copie locale.
   Autres fichiers de l'appli : copie locale d'abord. */
const CACHE = 'piano-cascade-v3';
const CORE = ['./', './index.html', './manifest.webmanifest', './icone-192.png', './icone-512.png', './icone-maskable.png'];
const LAZY = [
  './vendor/piano/A0.ogg', './vendor/piano/C1.ogg', './vendor/piano/Ds1.ogg', './vendor/piano/Fs1.ogg', './vendor/piano/A1.ogg', './vendor/piano/C2.ogg', './vendor/piano/Ds2.ogg', './vendor/piano/Fs2.ogg', './vendor/piano/A2.ogg', './vendor/piano/C3.ogg', './vendor/piano/Ds3.ogg', './vendor/piano/Fs3.ogg', './vendor/piano/A3.ogg', './vendor/piano/C4.ogg', './vendor/piano/Ds4.ogg', './vendor/piano/Fs4.ogg', './vendor/piano/A4.ogg', './vendor/piano/C5.ogg', './vendor/piano/Ds5.ogg', './vendor/piano/Fs5.ogg', './vendor/piano/A5.ogg', './vendor/piano/C6.ogg', './vendor/piano/Ds6.ogg', './vendor/piano/Fs6.ogg', './vendor/piano/A6.ogg', './vendor/piano/C7.ogg', './vendor/piano/Ds7.ogg', './vendor/piano/Fs7.ogg', './vendor/piano/A7.ogg', './vendor/piano/C8.ogg',
  './vendor/basic-pitch/basic-pitch.js', './vendor/basic-pitch/model.json', './vendor/basic-pitch/group1-shard1of1.bin'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    await Promise.all(LAZY.map(u => c.add(u).catch(() => null)));   // facultatif : le module de transcription
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate' || req.url.endsWith('/index.html') || req.url.endsWith('/');
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    if (isPage) {
      try {
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      } catch (err) {
        return (await c.match(req)) || (await c.match('./index.html')) || Response.error();
      }
    }
    const hit = await c.match(req);
    if (hit) return hit;
    const r = await fetch(req);
    if (r.ok) c.put(req, r.clone());
    return r;
  })());
});
