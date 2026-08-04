// Service Worker for Time Tracker PWA — iOS offline support
const CACHE_NAME = 'time-tracker-v2';
const urlsToCache = [
  './',
  'index.html',
  'app.js',
  'styles.css',
  'manifest.json',
  'manifest.webapp',
  'icons/icon.svg',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-72.png',
  'icons/icon-96.png',
  'icons/icon-128.png',
  'icons/icon-144.png',
  'icons/icon-152.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-256.png',
  'icons/icon-384.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

// Install event — cache all app assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

// Activate event — clean up old caches
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!cacheWhitelist.includes(cacheName)) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event — serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  // For navigation requests, try cache first, then network, then cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match('index.html');
      })
    );
    return;
  }

  // For other requests, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) return response;
        return fetch(event.request).then((fetchResponse) => {
          // Cache the new response for future offline use
          if (fetchResponse && fetchResponse.status === 200) {
            const responseClone = fetchResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return fetchResponse;
        });
      })
      .catch(() => {
        // If both cache and network fail, return the cached index.html
        return caches.match('index.html');
      })
  );
});
