'use strict';

const VERSION = '3.3.9';
const CACHE_PREFIX = 'storm-track-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './analysis/frontend-hk-threat-ui.js',
  './analysis/settings-panel-ui.js',
  './analysis/wind-field-overlay.js',
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
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (url.hostname === 'unpkg.com') {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  }
});

async function networkFirstNavigation(request) {
  try {
    // Do not let the browser HTTP cache pin an older index.html after a new PWA release.
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response?.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('./index.html', response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(request))
      || (await cache.match('./index.html'))
      || (await cache.match('./'))
      || new Response('Storm Track 暫時離線。', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
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
