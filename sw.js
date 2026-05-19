/**
 * PCM Service Worker — v20
 * Patel Capital Markets · Engineering Creative Finance
 *
 * Strategy:
 *   - INSTALL: pre-cache the shell (index.html, offline.html, manifest)
 *   - ACTIVATE: claim all clients, purge old caches
 *   - FETCH: network-first for navigation (fast live updates);
 *            stale-while-revalidate for static assets;
 *            fallback to offline.html when navigation fails offline.
 */

const CACHE_NAME  = 'pcm-v20';
const SHELL_URLS  = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest',
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(SHELL_URLS);
    }).then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API routes: always network, no cache
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache fresh navigation responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match('/offline.html').then(cached =>
            cached || caches.match('/index.html')
          )
        )
    );
    return;
  }

  // Static assets (fonts, icons, scripts): stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => null);

      return cached || fetchPromise;
    })
  );
});
