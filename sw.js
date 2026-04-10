const CACHE = 'rps-clash-v1';
const PRECACHE = ['/', '/style.css', '/game.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

// Install: pre-cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

// Activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for static assets, network-only for socket.io/external
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept WebSocket upgrades, socket.io, or cross-origin requests
  if (
    e.request.method !== 'GET' ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/health') ||
    url.hostname !== self.location.hostname
  ) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Serve cache immediately, refresh in background
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);

      return cached || networkFetch;
    })
  );
});
