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
  key: 'FAST-TEST',
  displayName: '快速接近測試',
  nameTc: '快速接近測試',
  nameEn: 'FAST TEST',
  sources: {
    HKO: {
      agency: 'HKO',
      sourceId: 'HKO-FAST',
      bulletinTime: '2026-08-21T12:00:00Z',
      positions: [point('2026-08-21T12:00:00Z', 18.2, 121.8, 15, { kind: 'analysis' })],
      forecast: [
        point('2026-08-21T18:00:00Z', 19.4, 120.4, 18, { kind: 'forecast', baseTime: '2026-08-21T12:00:00Z', forecastHour: 6 }),
        point('2026-08-22T06:00:00Z', 21.0, 117.0, 27, { kind: 'forecast', baseTime: '2026-08-21T12:00:00Z', forecastHour: 18 }),
        point('2026-08-22T18:00:00Z', 22.0, 114.8, 34, { kind: 'forecast', baseTime: '2026-08-21T12:00:00Z', forecastHour: 30 })
      ]
    },
    CMA: {
      agency: 'CMA',
      sourceId: 'CMA-FAST',
      bulletinTime: '2026-08-21T12:00:00Z',
      positions: [point('2026-08-21T12:00:00Z', 18.3, 121.6, 15, { kind: 'analysis' })],
      forecast: [
        point('2026-08-21T18:00:00Z', 19.5, 120.2, 18, { kind: 'forecast', baseTime: '2026-08-21T12:00:00Z', forecastHour: 6 }),
        point('2026-08-22T00:00:00Z', 20.3, 118.7, 23, { kind: 'forecast', baseTime: '2026-08-21T12:00:00Z', forecastHour: 12 }),
        point('2026-08-22T06:00:00Z', 21.1, 116.8, 28, { kind: 'forecast', baseTime: '2026-08-21T12:00:00Z', forecastHour: 18 }),
        point('2026-08-22T12:00:00Z', 21.7, 115.4, 31, { kind: 'forecast', baseTime: '2026-08-21T12:00:00Z', forecastHour: 24 }),
        point('2026-08-22T18:00:00Z', 22.1, 114.6, 35, { kind: 'forecast', baseTime: '2026-08-21T12:00:00Z', forecastHour: 30 })
      ]
    }
  }
};

const result = ui.analyzeGroup(group, { generatedAt: '2026-08-21T12:00:00Z' });
assert.equal(result.available, true);
assert.equal(result.threatAssessment.semantics.fixedDayBucketsUsed, false);
assert.ok(result.threatAssessment.timeline.some(item => item.label === '+6h'));
assert.ok(result.threatAssessment.timeline.some(item => item.label === '+12h'));
assert.ok(result.threatAssessment.timeline.some(item => item.rapidEvolutionIndex > 0.3));
assert.ok(result.threatAssessment.timeline.every(item => item.leadHours >= 0));
assert.ok(result.basicForecast.signals.T8.riskIndex > 0.4);
assert.equal(result.shadowForecastV2?.schemaVersion, ui.SHADOW_V2_VERSION);
assert.equal(result.shadowForecastV2?.semantics?.shadowOnly, true);

const html = ui.renderGroupSummary(group, { generatedAt: '2026-08-21T12:00:00Z' });
assert.match(html, /香港影響/);
assert.match(html, /V1 frozen/);
assert.match(html, /V2 shadow/);
assert.match(html, /T1/);
assert.match(html, /T3/);
assert.match(html, /T8/);
assert.match(html, /部分機構預報在最近距離附近結束/);
assert.doesNotMatch(html, /最低距離接近預報尾端/);
assert.match(html, /同步影子版本/);
assert.match(html, /非香港天文台官方風球預測/);
assert.doesNotMatch(html, /D1|D2|D3|D4|D5/);

// If HKO official warning context is explicitly supplied, the UI must show it as an
// official current state rather than leaving only Storm Track's estimate visible.
{
  const officialHtml = ui.renderGroupSummary(group, {
    generatedAt: '2026-08-21T12:00:00Z',
    signalOptions: {
      hkoWarningContext: {
        currentSignal: 'T3',
        issuedAt: '2026-08-21T11:40:00Z',
        source: 'HKO-official-test'
      }
    }
  });
  assert.match(officialHtml, /HKO官方/);
  assert.match(officialHtml, /T3/);
  assert.match(officialHtml, /Storm Track 估算/);
}

console.log('frontend-hk-threat-ui tests: OK');
