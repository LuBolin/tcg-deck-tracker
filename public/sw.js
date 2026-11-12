// Offline support for the app shell. Decks and the collection live in IndexedDB, so with the
// shell cached the app opens without a connection; card lookups still need the network.
// Pages: network first (a new release is never hidden), cached copy when offline.
// Built assets have hashed names, so they are cached on first use and never change.
const CACHE = 'shell-v1';
// The app may live under a sub-path (GitHub Pages: /tcg-deck-tracker/); the worker's scope is that path.
const BASE = new URL(self.registration.scope).pathname;
const INDEX = `${BASE}index.html`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // card APIs and images go straight to the network

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(INDEX, copy));
          return res;
        })
        .catch(() => caches.match(INDEX)),
    );
    return;
  }

  const save = (res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  };
  // Hashed build files never change: cache first. Other files (icon, manifest) keep their name
  // across releases: network first, cache only as the offline fallback.
  event.respondWith(
    url.pathname.startsWith(`${BASE}assets/`)
      ? caches.match(req).then((hit) => hit || fetch(req).then(save))
      : fetch(req).then(save).catch(() => caches.match(req)),
  );
});
