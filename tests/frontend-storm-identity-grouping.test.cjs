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
  assert.notEqual(open, -1, `${name} must have a function body`);
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

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const r = 6371.0088;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

const context = {
  result: null,
  parseTimeMs: value => Date.parse(value),
  haversineKm
};
vm.createContext(context);
vm.runInContext(`
${extractFunction('normalizeName')}
${extractFunction('isGenericStormName')}
${extractFunction('getGroupCurrent')}
${extractFunction('mergeStormSources')}
result = { normalizeName, isGenericStormName, mergeStormSources };
`, context);

const { isGenericStormName, mergeStormSources } = context.result;

for (const label of [
  'Tropical Storm',
  '熱帶風暴',
  'TC2622',
  '熱帶低氣壓 (TC2622)',
  'TD22W',
  'TS22W'
]) {
  assert.equal(isGenericStormName(label), true, `${label} should be treated as a generic/temporary identity`);
}
for (const label of ['PODUL', 'KAJIKI', '沙德爾']) {
  assert.equal(isGenericStormName(label), false, `${label} should remain a specific storm identity`);
}

function storm({ agency, sourceId, nameTc, nameEn, lat, lon, time }) {
  return {
    agency,
    sourceId,
    nameTc,
    nameEn,
    displayName: nameEn ? `${nameTc} (${nameEn})` : nameTc,
    positions: [{ lat, lon, time }],
    forecast: []
  };
}

const sameStorm = mergeStormSources([
  storm({ agency: 'HKO', sourceId: 'hko-current', nameTc: '熱帶風暴', nameEn: 'Tropical Storm', lat: 20.0, lon: 111.0, time: '2026-08-22T00:00:00Z' }),
  storm({ agency: 'CMA', sourceId: 'cma-named', nameTc: '劍魚', nameEn: 'KAJIKI', lat: 20.1, lon: 111.1, time: '2026-08-22T03:00:00Z' }),
  storm({ agency: 'CWA', sourceId: '2026-TC2622', nameTc: '熱帶低氣壓', nameEn: 'TC2622', lat: 20.2, lon: 111.1, time: '2026-08-22T06:00:00Z' })
]);
assert.equal(sameStorm.length, 1, 'generic HKO/CWA labels near the named agency track should form one storm group');
assert.deepEqual(Object.keys(sameStorm[0].sources).sort(), ['CMA', 'CWA', 'HKO']);

const distinctNamedStorms = mergeStormSources([
  storm({ agency: 'HKO', sourceId: 'named-a', nameTc: '沙德爾', nameEn: 'SAUDEL', lat: 20.0, lon: 111.0, time: '2026-08-22T00:00:00Z' }),
  storm({ agency: 'CMA', sourceId: 'named-b', nameTc: '劍魚', nameEn: 'KAJIKI', lat: 20.2, lon: 111.1, time: '2026-08-22T03:00:00Z' })
]);
assert.equal(distinctNamedStorms.length, 2, 'different specific storm names must not merge merely because tracks are close');

console.log('frontend storm identity grouping tests: OK');
