import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCmaHistoricalSnapshots,
  parseNmcForecastPoint,
  parseNmcHistoryPoint,
  parseNmcJson,
  selectNmcStorm,
  validateHistoricalCaseManifest
} from '../scripts/cma-historical-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readCase = name => JSON.parse(fs.readFileSync(path.join(root, 'historical/cases', name), 'utf8'));

const noul = validateHistoricalCaseManifest(readCase('2026-noul.json'));
assert.equal(noul.truth.role, 'verification-only');
assert.equal(noul.forecastSources.CMA.role, 'forecast-input-primary');
assert.equal(noul.forecastSources.CWA.role, 'archive-metadata-only');
assert.equal(noul.safety.currentV1ModelFrozen, true);
assert.equal(noul.safety.truthMayNotBeUsedAsForecastInput, true);
assert.ok(noul.truth.signalLifecycle.some(item => /^T8/.test(item.signal)));

const ragasa = readCase('2025-ragasa.json');
assert.equal(ragasa.schemaVersion, 'historical-replay-case/v1');
assert.equal(ragasa.retrospective, true);
assert.equal(ragasa.truth.role, 'verification-only');
assert.equal(ragasa.forecastSources.CMA.role, 'forecast-input-unavailable');
assert.equal(ragasa.forecastSources.CMA.asIssuedForecastExtraction, 'unavailable-no-babj-history');
assert.match(ragasa.forecastSources.CMA.reason, /Do not add case-specific parser fallbacks/);
assert.equal(ragasa.safety.truthMayNotBeUsedAsForecastInput, true);
assert.equal(ragasa.safety.currentV1ModelFrozen, true);

const parsedJsonp = parseNmcJson('typhoon_jsons_list_2026(({"typhoonList":[[123,"NOUL","红霞","2612","2612",null,null,"stop"]]}))');
const resolved = selectNmcStorm(parsedJsonp, noul);
assert.equal(resolved.id, '123');
assert.equal(resolved.nameEn, 'NOUL');

const historyPoint = [1, '202607240000', 0, 'TS', 125.0, 18.0, 990, 25, 'W', 20, [['30KTS', 180, 120, 100, 160]], {}];
assert.deepEqual(parseNmcHistoryPoint(historyPoint).windRadii[0], {
  level: '30KTS', ne: 180, se: 120, sw: 100, nw: 160
});

const forecastPoint = [12, '202607240000', 123.0, 18.5, 985, 28, 'BABJ', 'STS'];
const parsedForecast = parseNmcForecastPoint(forecastPoint);
assert.equal(parsedForecast.baseTime, '2026-07-24T00:00:00Z');
assert.equal(parsedForecast.time, '2026-07-24T12:00:00.000Z');
assert.equal(parsedForecast.forecastHour, 12);

const detail = {
  typhoon: [123, 'NOUL', '红霞', 2612, 2612, null, null, 'stop', [
    [1, '202607240000', 0, 'TS', 125.0, 18.0, 990, 25, 'W', 20, [['30KTS', 180, 120, 100, 160]], {
      BABJ: [
        [12, '202607240000', 123.0, 18.5, 985, 28, 'BABJ', 'STS'],
        [24, '202607240000', 121.0, 19.0, 980, 30, 'BABJ', 'STS']
      ]
    }],
    [2, '202607240600', 0, 'STS', 124.0, 18.4, 985, 28, 'W', 20, [['30KTS', 200, 150, 120, 180]], {
      BABJ: [
        [12, '202607240600', 121.8, 19.0, 980, 30, 'BABJ', 'STS'],
        [24, '202607240600', 119.5, 19.8, 975, 33, 'BABJ', 'TY']
      ]
    }]
  ]]
};
const snapshots = buildCmaHistoricalSnapshots(detail, noul, resolved);
assert.equal(snapshots.length, 2);
assert.equal(snapshots[0].asOf, '2026-07-24T00:00:00.000Z');
assert.equal(snapshots[0].source.positions.length, 1);
assert.equal(snapshots[1].source.positions.length, 2);
assert.equal(snapshots[1].source.forecast[0].baseTime, '2026-07-24T06:00:00Z');
assert.ok(snapshots.every(snapshot => snapshot.source.forecast.every(point => Date.parse(point.baseTime) <= Date.parse(snapshot.asOf) + 1000)));
assert.ok(snapshots.every(snapshot => snapshot.source.forecast.every(point => Date.parse(point.time) > Date.parse(snapshot.asOf))));
assert.ok(snapshots.every(snapshot => snapshot.provenance.futureSourceLeakage === false));

assert.equal(noul.truth.highestSignal, 'T9');
assert.equal(noul.truth.signalLifecycle.find(item => item.signal === 'T8NW')?.issuedAt, '2026-07-25T14:10:00.000Z');
assert.equal(ragasa.truth.highestSignal, 'T10');
assert.equal(ragasa.truth.signalLifecycle.find(item => item.signal === 'T8NW')?.issuedAt, '2025-09-23T06:20:00.000Z');
assert.equal(ragasa.truth.signalLifecycle.find(item => item.signal === 'T10')?.issuedAt, '2025-09-23T18:40:00.000Z');

console.log('historical case replay input tests: OK');
