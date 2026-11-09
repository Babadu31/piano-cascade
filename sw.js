/* Piano Cascade — fonctionnement hors ligne.
   Page : réseau d'abord (pour recevoir les mises à jour), sinon copie locale.
   Autres fichiers de l'appli : copie locale d'abord. */
const CACHE = 'piano-cascade-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icone-192.png', './icone-512.png', './icone-maskable.png'];
const LAZY = ['./vendor/basic-pitch/basic-pitch.js', './vendor/basic-pitch/model.json', './vendor/basic-pitch/group1-shard1of1.bin'];

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
