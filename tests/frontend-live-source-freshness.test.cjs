'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist in index.html`);
  const open = html.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    else if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name} function`);
}

const context = {
  result: null,
  console: { warn() {} },
  LIVE_SOURCE_MAX_AGE_MS: 24 * 60 * 60 * 1000,
  LIVE_SOURCE_FUTURE_TOLERANCE_MS: 6 * 60 * 60 * 1000
};
vm.createContext(context);
vm.runInContext(`
${extractFunction('parseTimeMs')}
${extractFunction('isLiveTimestampFresh')}
${extractFunction('sourceReferenceTimeMs')}
${extractFunction('isLiveSourceFresh')}
${extractFunction('filterLiveAgencyStorms')}
result = { isLiveTimestampFresh, sourceReferenceTimeMs, isLiveSourceFresh, filterLiveAgencyStorms };
`, context);

const { isLiveTimestampFresh, filterLiveAgencyStorms } = context.result;
const now = Date.parse('2026-09-09T00:00:00Z');

assert.equal(isLiveTimestampFresh('2026-09-08T12:00:00Z', now), true, 'recent bulletin should remain live');
assert.equal(isLiveTimestampFresh('2026-09-07T23:59:59Z', now), false, 'bulletin older than 24h should leave live view');
assert.equal(isLiveTimestampFresh('2026-09-09T07:00:00Z', now), false, 'implausibly future-dated bulletin should not be treated as live');
assert.equal(isLiveTimestampFresh(null, now), false, 'missing freshness evidence should not keep a source live');

const storms = [
  {
    agency: 'JMA', sourceId: 'TC2621', nameEn: 'SAUDEL', bulletinTime: '2026-09-03T13:05:00Z',
    positions: [{ time: '2026-09-03T13:00:00Z' }], forecast: []
  },
  {
    agency: 'JMA', sourceId: 'TC2628', nameEn: 'KROVANH', bulletinTime: '2026-09-08T21:00:00Z',
    positions: [{ time: '2026-09-08T21:00:00Z' }], forecast: []
  },
  {
    agency: 'HKO', sourceId: 'fresh-forecast-base', bulletinTime: '2026-09-07T20:00:00Z',
    positions: [{ time: '2026-09-07T20:00:00Z' }], forecast: [{ baseTime: '2026-09-08T20:00:00Z' }]
  }
];

const filtered = filterLiveAgencyStorms('TEST', storms, now);
assert.deepEqual(filtered.map(item => item.sourceId), ['TC2628', 'fresh-forecast-base']);

assert.match(html, /const LIVE_SOURCE_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000;/);
assert.match(html, /const freshStorms = filterLiveAgencyStorms\(source, entry\.storms\);/);
assert.match(html, /agencyStorms\[source\] = filterLiveAgencyStorms\(source, Array\.isArray\(storms\) \? storms : \[\]\);/);
assert.match(extractFunction('parseJmaFeedCandidates'), /if \(updated && !isLiveTimestampFresh\(updated\)\) continue;/);

console.log('frontend live source freshness tests: OK');
