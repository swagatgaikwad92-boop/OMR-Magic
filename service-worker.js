/**
 * service-worker.js
 * Caches the app shell so OMR Magic installs and opens offline.
 * Bump CACHE_NAME whenever any shell file changes to force an update.
 *
 * IMPORTANT: index.html is self-contained (CSS/JS inlined) precisely so
 * that this file only has to reliably cache ONE thing to make the app
 * installable and offline-capable. Every entry below is cached
 * individually and failures are logged rather than aborting the whole
 * install — a single missing optional file (e.g. an icon that didn't
 * make it into the deploy) must never leave the service worker
 * uninstalled, because an active service worker is one of the browser's
 * install-prompt requirements.
 */

const CACHE_NAME = 'omr-magic-v2';
const APP_SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('SW: could not cache', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for the app shell, network-first fallback for anything else,
// so the app still works with no connection after the first successful load.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
