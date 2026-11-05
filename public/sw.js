// Service worker for the installed web app (PWA).
// - Pages (HTML) and config.js: always revalidated with the server, so an installed app never runs a stale
//   page that points at build files which no longer exist (that showed an unstyled page after updates).
// - Hashed build files (play/build/*): immutable, cache-first; models, sounds, icons: cache-first.
// - Offline: falls back to whatever is cached.
const CACHE = 'asrar-v11'; // bump whenever files with fixed names (models/, sfx/) change

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

const cacheFirst = req => caches.open(CACHE).then(async c => {
  const hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r;
});

const networkFirst = req => fetch(req, { cache: 'no-cache' })
  .then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; })
  .catch(() => caches.match(req));

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname.endsWith('supabase.co') || /\/packs\//.test(u.pathname)) return;
  if (/\/play\/build\//.test(u.pathname) || /\/(models|sfx|icons)\//.test(u.pathname)) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(req));
});
