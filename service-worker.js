/**
 * service-worker.js
 * Caches the app shell so OMR Magic installs and opens offline.
 * Bump CACHE_NAME whenever any shell file changes to force an update.
 */

const CACHE_NAME = 'omr-magic-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './styles/core.css',
  './styles/glass.css',
  './styles/scanner.css',
  './scripts/app.js',
  './scripts/omr-scanner.js',
  './scripts/image-processing.js',
  './scripts/answer-key.js',
  './scripts/grading.js',
  './scripts/question-parser.js',
  './scripts/storage.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
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

// Cache-first for the app shell, network-first fallback for anything else
// (e.g. future API calls), so the app still works with no connection.
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
