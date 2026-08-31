'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'sw.js'), 'utf8');

assert.match(source, /const VERSION = '3\.3\.11';/);
assert.match(source, /'\.\/analysis\/hko-signal-statement\.js'/);
assert.match(source, /'\.\/analysis\/settings-panel-ui\.js'/);
assert.match(source, /'\.\/analysis\/consensus-track-overlay\.js'/);
assert.match(source, /if \(url\.pathname\.endsWith\('\.js'\)\) \{\s*event\.respondWith\(networkFirstStatic\(request, SHELL_CACHE\)\);/s);
assert.match(source, /async function networkFirstStatic\(request, cacheName\)/);
assert.match(source, /fetch\(new Request\(request, \{ cache: 'no-store' \}\)\)/);
assert.match(source, /return \(await cache\.match\(request\)\) \|\| Response\.error\(\);/);

console.log('service-worker cache policy tests: OK');
