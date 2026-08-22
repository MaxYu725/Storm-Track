'use strict';

const assert = require('node:assert/strict');
require('../analysis/storm-analysis-core.js');
require('../analysis/hk-impact-engine.js');
require('../analysis/hko-signal-risk-inputs.js');
require('../analysis/hk-threat-assessment.js');
require('../analysis/basic-hk-signal-forecast.js');
const ui = require('../analysis/frontend-hk-threat-ui.js');

const point = (time, lat, lon, maximumWind, extra = {}) => ({
  time, lat, lon, maximumWind, ...extra
});

const group = {
  key: 'RECORDER-TEST',
  displayName: 'Recorder Test',
  nameTc: '熱帶風暴',
  nameEn: 'Tropical Storm',
  sources: {
    HKO: {
      agency: 'HKO',
      sourceId: 'HKO-RECORDER',
      bulletinTime: '2026-08-22T00:00:00Z',
      nameTc: '熱帶風暴',
      nameEn: 'Tropical Storm',
      positions: [point('2026-08-22T00:00:00Z', 19.8, 119.8, 18, { kind: 'analysis' })],
      forecast: [
        point('2026-08-22T06:00:00Z', 20.6, 118.2, 20, { kind: 'forecast', baseTime: '2026-08-22T00:00:00Z', forecastHour: 6 }),
        point('2026-08-22T18:00:00Z', 21.5, 115.8, 25, { kind: 'forecast', baseTime: '2026-08-22T00:00:00Z', forecastHour: 18 }),
        point('2026-08-23T06:00:00Z', 21.7, 113.8, 27, { kind: 'forecast', baseTime: '2026-08-22T00:00:00Z', forecastHour: 30 })
      ]
    },
    CMA: {
      agency: 'CMA',
      sourceId: 'CMA-RECORDER',
      bulletinTime: '2026-08-22T00:00:00Z',
      nameTc: '熱帶風暴',
      nameEn: 'Tropical Storm',
      positions: [point('2026-08-22T00:00:00Z', 19.9, 119.6, 18, { kind: 'analysis' })],
      forecast: [
        point('2026-08-22T06:00:00Z', 20.7, 118.0, 20, { kind: 'forecast', baseTime: '2026-08-22T00:00:00Z', forecastHour: 6 }),
        point('2026-08-22T12:00:00Z', 21.2, 116.9, 23, { kind: 'forecast', baseTime: '2026-08-22T00:00:00Z', forecastHour: 12 }),
        point('2026-08-22T18:00:00Z', 21.6, 115.6, 25, { kind: 'forecast', baseTime: '2026-08-22T00:00:00Z', forecastHour: 18 }),
        point('2026-08-23T06:00:00Z', 21.8, 113.6, 28, { kind: 'forecast', baseTime: '2026-08-22T00:00:00Z', forecastHour: 30 })
      ]
    }
  }
};

assert.equal(typeof ui.readProspectiveObservations, 'function');
assert.deepEqual(ui.readProspectiveObservations(), []);

const html = ui.renderGroupSummary(group, { generatedAt: '2026-08-22T00:00:00Z' });
assert.match(html, /香港影響 Beta/);

const observations = ui.readProspectiveObservations();
assert.equal(observations.length, 1);
const observation = observations[0];
assert.equal(observation.schemaVersion, 'hk-beta-prospective-observation/v1');
assert.equal(observation.group.key, group.key);
assert.deepEqual(observation.sourceAgencies, ['CMA', 'HKO']);
assert.equal(observation.sources.HKO.sourceId, 'HKO-RECORDER');
assert.equal(observation.sources.HKO.positionCount, 1);
assert.equal(observation.sources.HKO.forecastCount, 3);
assert.equal(observation.sources.HKO.rawInput.forecast.length, 3);
assert.equal(observation.engineVersions.ui, ui.VERSION);
assert.equal(observation.engineVersions.snapshot, 'storm-analysis-snapshot/v1');
assert.equal(observation.engineVersions.impact, 'hk-impact/v1');
assert.equal(observation.engineVersions.signalInputs, 'hko-signal-risk-inputs/v1');
assert.equal(observation.analysis.available, true);
assert.ok(observation.analysis.basicForecast?.signals?.T1);
assert.ok(observation.analysis.threatAssessment?.summary);
assert.ok(Number.isFinite(Number(observation.analysis.threatAssessment?.analyzers?.agencyDisagreement?.confidence)));
assert.ok(Array.isArray(observation.analysis.threatAssessment?.timeline));
assert.equal(observation.analysis.generatedAt, '2026-08-22T00:00:00.000Z');

// Returned data must be a defensive clone so an observer cannot mutate the stored record.
observations[0].group.key = 'MUTATED';
assert.equal(ui.readProspectiveObservations()[0].group.key, 'RECORDER-TEST');

console.log('frontend beta prospective observation tests: OK');
