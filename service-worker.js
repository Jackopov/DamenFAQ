/* ── Service Worker: Damen FAQ PWA ───────────────────────────────────────────
   Cache-first strategy for offline access on production halls (Faraday cage).
   On install: pre-cache all static assets.
   On fetch:   serve from cache, fall back to network, then cache the response.
   On activate: prune old caches when the SW version changes.
*/

const CACHE_NAME = 'damen-faq-v2';

/* All static assets that must work offline.
   api.json is fetched at runtime and also cached on first access. */
const PRECACHE_URLS = [
    './',
    './index.html',
    './admin.html',
    './contacts.html',
    './o-damen.html',
    './style.css',
    './app.js',
    './admin.js',
    './service-worker.js',
    './manifest.json',
    './contacts.json',
    './api.json',
    './images/Damen Marine logo.png'
];

/* ── Install ──────────────────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

/* ── Activate ─────────────────────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(
                names
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            )
        ).then(() => self.clients.claim())
    );
});

/* ── Fetch ────────────────────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
    /* Only handle GET requests */
    if (event.request.method !== 'GET') return;

    /* Skip cross-origin requests (e.g. analytics) */
    if (!event.request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request).then((response) => {
                /* Don't cache non-successful responses */
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                /* Clone — one copy for cache, one for the browser */
                const toCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, toCache);
                });

                return response;
            }).catch(() => {
                /* Offline fallback: if it's a navigation, serve the cached index */
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return new Response('Offline', { status: 503, statusText: 'Offline' });
            });
        })
    );
});
