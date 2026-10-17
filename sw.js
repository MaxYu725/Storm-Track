'use strict';

const VERSION = '3.3.15';
const CACHE_PREFIX = 'storm-track-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './analysis/hk-signal-forecast-v2.js',
  './analysis/frontend-hk-threat-ui.js',
  './analysis/hko-signal-statement.js',
  './analysis/settings-panel-ui.js',
  './analysis/wind-field-overlay.js',
  './analysis/consensus-track-overlay.js',
  './analysis/archive-pagination.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(APP_SHELL.map(url => cache.add(new Request(url, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const valid = new Set([SHELL_CACHE, STATIC_CACHE]);
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith(CACHE_PREFIX) && !valid.has(name))
        .map(name => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Keep storm data and map tiles live. The upstream Worker already applies its own cache policy.
  if (
    url.hostname === 'storm.max-yu.workers.dev' ||
    url.hostname.endsWith('basemaps.cartocdn.com') ||
    url.hostname.endsWith('tile.openstreetmap.org')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    // App JavaScript changes frequently during Beta work. A cache-first policy can pin an
    // old analysis/settings module indefinitely when sw.js itself did not change. Prefer
    // current network code while retaining the previous response for offline fallback.
    if (url.pathname.endsWith('.js')) {
      event.respondWith(networkFirstStatic(request, SHELL_CACHE));
    } else {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
    }
    return;
  }

  if (url.hostname === 'unpkg.com') {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

async function networkFirstNavigation(request) {
  try {
    // Navigation is always network-first; avoid stale browser HTTP cache.
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response?.ok && new URL(request.url).origin === self.location.origin) {
      const cache = await caches.open(SHELL_CACHE);
      // Cache the actual requested page, never overwrite index.html with observation/consensus HTML.
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    // Query parameters select frontend modes; the cached HTML belongs to the same pathname.
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Missing secondary pages must not silently become the Storm Track homepage.
    return new Response('Storm Track 暫時離線。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function networkFirstStatic(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response?.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response?.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if (response?.ok || response?.type === 'opaque') cache.put(request, response.clone()).catch(() => {});
    return response;
  }).catch(() => null);
  return cached || network || Response.error();
}