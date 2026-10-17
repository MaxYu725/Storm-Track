'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');

assert.match(source, /const VERSION = '3\.3\.15';/);
assert.match(source, /'\.\/analysis\/hk-signal-forecast-v2\.js'/);
assert.match(source, /'\.\/analysis\/frontend-hk-threat-ui\.js'/);
assert.match(source, /'\.\/analysis\/hko-signal-statement\.js'/);
assert.match(source, /'\.\/analysis\/settings-panel-ui\.js'/);
assert.match(source, /'\.\/analysis\/consensus-track-overlay\.js'/);
assert.match(source, /'\.\/analysis\/archive-pagination\.js'/);
assert.match(source, /if \(url\.pathname\.endsWith\('\.js'\)\) \{\s*event\.respondWith\(networkFirstStatic\(request, SHELL_CACHE\)\);/s);
assert.match(source, /async function networkFirstStatic\(request, cacheName\)/);
assert.match(source, /fetch\(new Request\(request, \{ cache: 'no-store' \}\)\)/);
assert.match(source, /return \(await cache\.match\(request\)\) \|\| Response\.error\(\);/);


assert.match(source, /await cache\.put\(request, response\.clone\(\)\)/);
assert.match(source, /cache\.match\(request, \{ ignoreSearch: true \}\)/);
assert.doesNotMatch(source, /cache\.put\('\.\/index\.html', response\.clone\(\)\)/);

async function validateOfflineNavigation() {
  const vm = require('node:vm');
  const origin = 'https://maxyu725.github.io';
  const cached = new Map();
  let online = true;
  const keyOf = (request, ignoreSearch = false) => {
    const url = new URL(typeof request === 'string' ? request : request.url, origin);
    return ignoreSearch ? url.origin + url.pathname : url.href;
  };
  class MockRequest {
    constructor(input, options = {}) {
      this.url = keyOf(input);
      this.mode = options.mode || input.mode || 'navigate';
      this.method = 'GET';
    }
  }
  class MockResponse {
    constructor(body, options = {}) {
      this.body = body;
      this.status = options.status || 200;
      this.ok = this.status >= 200 && this.status < 300;
    }
    clone() { return new MockResponse(this.body, { status: this.status }); }
  }
  const cache = {
    async put(request, response) {
      cached.set(keyOf(request), response);
    },
    async match(request, options = {}) {
      if (!options.ignoreSearch) return cached.get(keyOf(request)) || undefined;
      const target = keyOf(request, true);
      for (const [key, response] of cached) {
        if (keyOf(key, true) === target) return response;
      }
      return undefined;
    }
  };
  const context = {
    self: { location: { origin }, addEventListener() {} },
    caches: { async open() { return cache; } },
    Request: MockRequest,
    Response: MockResponse,
    URL,
    fetch: async request => {
      if (!online) throw new Error('offline');
      const pathname = new URL(request.url).pathname;
      return new MockResponse(pathname.endsWith('/observation.html') ? 'OBSERVATION'
        : pathname.endsWith('/consensus.html') ? 'CONSENSUS' : 'HOME');
    }
  };
  cached.set(origin + '/Storm-Track/', new MockResponse('HOME'));
  cached.set(origin + '/Storm-Track/index.html', new MockResponse('HOME'));
  vm.runInNewContext(source, context);

  const observationUrl = origin + '/Storm-Track/observation.html';
  const first = await context.networkFirstNavigation(new MockRequest(observationUrl));
  assert.equal(first.body, 'OBSERVATION');
  assert.equal(cached.get(origin + '/Storm-Track/index.html').body, 'HOME',
    'visiting observation.html must not overwrite the homepage cache');

  online = false;
  const offlineHome = await context.networkFirstNavigation(new MockRequest(origin + '/Storm-Track/index.html?beta=hk-signal'));
  assert.equal(offlineHome.body, 'HOME', 'homepage mode queries use their own pathname');
  const offlineObservation = await context.networkFirstNavigation(new MockRequest(observationUrl));
  assert.equal(offlineObservation.body, 'OBSERVATION', 'secondary pages recover their own cached shell');
  const offlineConsensus = await context.networkFirstNavigation(new MockRequest(origin + '/Storm-Track/consensus.html'));
  assert.equal(offlineConsensus.status, 503, 'uncached secondary pages must not fallback to unrelated home HTML');
}

validateOfflineNavigation().then(
  () => console.log('service worker navigation cache regression: OK'),
  error => { console.error(error); process.exitCode = 1; }
);

console.log('service-worker cache policy tests: OK');
