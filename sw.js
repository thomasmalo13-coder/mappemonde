const CACHE = 'mappemonde-v2-1';
const ASSETS = ['./', 'index.html', 'styles.css?v=1', 'manifest.webmanifest',
  'js/app.js?v=1', 'js/store.js', 'js/map.js', 'js/vendor.js', 'js/countries.js', 'js/icons.js', 'js/confetti.js', 'js/parse.js', 'js/badges.js', 'js/poster.js',
  'data/world-lite.json', 'data/world-50m.json',
  'fonts/instrument-serif-latin-400-italic.woff2', 'fonts/instrument-serif-latin-ext-400-italic.woff2', 'fonts/instrument-serif-latin-400-normal.woff2',
  'fonts/figtree-latin-wght-normal.woff2', 'fonts/figtree-latin-ext-wght-normal.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// network-first, cache fallback (offline)
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4500);
      const res = await fetch(req, {cache: 'no-cache', signal: ctrl.signal}); clearTimeout(t);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req) || await cache.match(req, {ignoreSearch: true});
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
      return new Response('', {status: 504});
    }
  })());
});
