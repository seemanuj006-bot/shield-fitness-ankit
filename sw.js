/* Shield Fitness service worker: cache-first app shell. Bump VERSION on every deploy so users get the update prompt. */
const VERSION = 'shield-fitness-v1.0.0';
const ASSETS = [
 "./assets/icons/apple-touch-icon.png",
 "./assets/icons/favicon-48.png",
 "./assets/icons/icon-192.png",
 "./assets/icons/icon-512.png",
 "./assets/icons/icon-maskable-512.png",
 "./assets/icons/logo-96.png",
 "./index.html",
 "./manifest.webmanifest",
 "./src/app.js",
 "./src/db.js",
 "./src/planner.js",
 "./src/progression.js",
 "./src/router.js",
 "./src/scheduler.js",
 "./src/seed.js",
 "./src/session.js",
 "./src/store.js",
 "./src/styles/base.css",
 "./src/styles/glass.css",
 "./src/styles/screens.css",
 "./src/styles/tokens.css",
 "./src/timer.js",
 "./src/ui/components.js",
 "./src/ui/plan.js",
 "./src/ui/progress.js",
 "./src/ui/runner.js",
 "./src/ui/settings.js",
 "./src/ui/setup.js",
 "./src/ui/today.js",
 "./src/util.js",
 "./"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)));
  // No skipWaiting here: an open workout must never be swapped under the user. The page asks for it.
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shield-fitness-') && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
