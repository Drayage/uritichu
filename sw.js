'use strict';

const CACHE = 'uritichu-v6';

// Resolve precache paths relative to this SW's scope so the same
// sw.js works both at "/" (Express) and at "/uritichu/" (GitHub Pages).
const BASE = self.registration.scope; // e.g. "https://drayage.github.io/uritichu/"

const PRECACHE_PATHS = [
  '',
  'game',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon.png',
  'css/common.css',
  'css/lobby.css',
  'css/game.css',
  'js/lobby.js',
  'js/game-client.js',
  'js/room-manager.js',
  'js/host-runner.js',
  'js/replay.js',
  'js/audio.js',
  'js/firebase-app.js',
  'js/ai/aiPlayer.js',
  'js/ai/aiLead.js',
  'js/ai/aiFollow.js',
  'js/ai/aiExchange.js',
  'js/ai/aiTichu.js',
  'js/ai/aiUtils.js',
  'js/engine/gameState.js',
  'js/engine/cards.js',
  'js/engine/combinations.js',
  'js/engine/exchange.js',
  'js/engine/scoring.js',
];

const PRECACHE = PRECACHE_PATHS.map(p => BASE + p);

// Network hosts that must never be intercepted (Firebase, Google APIs)
const BYPASS_HOSTS = [
  'firebaseio.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'googleapis.com',
  'gstatic.com',
  'firebase.google.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(PRECACHE.map(url => c.add(url)))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always bypass Firebase / Google services
  if (BYPASS_HOSTS.some(h => url.includes(h))) return;

  // Only cache GET requests
  if (e.request.method !== 'GET') return;

  // App code (HTML / JS / CSS) → network-first so fixes always reach users.
  // Falls back to cache when offline. Icons/images/manifest stay cache-first.
  const isAppCode =
    e.request.mode === 'navigate' ||
    /\.(?:js|css|html)(?:\?.*)?$/.test(url);

  if (isAppCode) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() =>
        caches.match(e.request).then(cached =>
          cached || (e.request.mode === 'navigate' ? caches.match(BASE) : undefined)
        )
      )
    );
    return;
  }

  // Static assets (icons, images, manifest) → cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
