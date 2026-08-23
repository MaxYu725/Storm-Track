'use strict';

const assert = require('node:assert/strict');
const core = require('../analysis/storm-analysis-core.js');
const overlay = require('../analysis/consensus-track-overlay.js');

function point(time, lat, lon, extra = {}) {
  return { kind: 'forecast', time, lat, lon, ...extra };
}

function source(agency, baseTime, latOffset = 0, lonOffset = 0) {
  return {
    agency,
    sourceId: `${agency}-visual-sample`,
    bulletinTime: baseTime,
    positions: [{ kind: 'analysis', time: baseTime, lat: 18 + latOffset, lon: 121 + lonOffset }],
    forecast: [
      point('2026-08-20T06:00:00Z', 18.5 + latOffset, 120.5 + lonOffset, { baseTime }),
      point('2026-08-20T12:00:00Z', 19 + latOffset, 120 + lonOffset, { baseTime })
    ]
  };
}

function observation() {
  const base = '2026-08-20T00:00:00Z';
  const sources = {
    HKO: source('HKO', base, 0, 0),
    CMA: source('CMA', base, 0.2, 0.2),
    JMA: source('JMA', base, -0.2, -0.2)
  };
  return {
    observedAt: '2026-08-20T00:10:00Z',
    group: { key: 'VISUAL', displayName: 'Visual Storm' },
    sources: Object.fromEntries(Object.entries(sources).map(([agency, rawInput]) => [agency, {
      agency,
      sourceId: rawInput.sourceId,
      bulletinTime: rawInput.bulletinTime,
      positionCount: rawInput.positions.length,
      forecastCount: rawInput.forecast.length,
      current: rawInput.positions.at(-1),
      forecastEnd: rawInput.forecast.at(-1),
      rawInput
    }]))
  };
}

(function testExplicitVisualBetaGateAndStoredOptIn() {
  assert.equal(overlay.STORAGE_KEY, 'storm-track-consensus-track-beta-enabled-v1');
  assert.equal(overlay.betaEnabled('?beta=hk-signal'), true);
  assert.equal(overlay.betaEnabled('?consensusTrack=1'), false);
  assert.equal(overlay.isEnabled('?beta=hk-signal&consensusTrack=1', false), true);
  assert.equal(overlay.isEnabled('?beta=hk-signal&consensusTrack=true', false), true);
  assert.equal(overlay.isEnabled('?beta=hk-signal', false), false, 'normal Beta must default off');
  assert.equal(overlay.isEnabled('?beta=hk-signal', true), true, 'stored opt-in should enable');
  assert.equal(overlay.isEnabled('?consensusTrack=1', true), false, 'HK Signal Beta gate remains mandatory');

  const memory = new Map();
  const storage = {
    getItem: key => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, value)
  };
  assert.equal(overlay.readStoredEnabled(storage), false);
  overlay.writeStoredEnabled(true, storage);
  assert.equal(overlay.readStoredEnabled(storage), true);
  overlay.writeStoredEnabled(false, storage);
  assert.equal(overlay.readStoredEnabled(storage), false);
})();

(function testBuildRenderableTrackUsesConsensusOnly() {
  const tracks = overlay.buildRenderableTracks([observation()], core, {
    trackOptions: {
      consensusTrackStartLeadHours: 0,
      consensusTrackEndLeadHours: 12,
      consensusTrackStepHours: 6
    }
  });

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].key, 'VISUAL');
  assert.equal(tracks[0].points.length, 3);
  assert.equal(tracks[0].segments.length, 1);
  assert.equal(tracks[0].segments[0].length, 3);
  assert.equal(tracks[0].points.every(item => item.agencyCount === 3), true);
  assert.equal(tracks[0].supportedThroughHours, 12);
  assert.equal(JSON.stringify(tracks).includes('rawInput'), false);
})();

(function testGapsSplitPolylineSegments() {
  const points = [
    { leadHours: 0, validTime: '2026-08-20T00:00:00Z', agencyCount: 2, agencies: ['HKO','CMA'], entries: [], consensus: { lat: 18, lon: 121 } },
    { leadHours: 6, validTime: '2026-08-20T06:00:00Z', agencyCount: 2, agencies: ['HKO','CMA'], entries: [], consensus: { lat: 18.5, lon: 120.5 } },
    { leadHours: 12, validTime: '2026-08-20T12:00:00Z', agencyCount: 1, agencies: ['HKO'], entries: [], consensus: null },
    { leadHours: 18, validTime: '2026-08-20T18:00:00Z', agencyCount: 2, agencies: ['JMA','CWA'], entries: [], consensus: { lat: 19.5, lon: 119.5 } },
    { leadHours: 24, validTime: '2026-08-21T00:00:00Z', agencyCount: 2, agencies: ['JMA','CWA'], entries: [], consensus: { lat: 20, lon: 119 } }
  ];
  const segments = overlay.splitConsensusSegments(points);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map(segment => segment.map(item => item.leadHours)), [[0, 6], [18, 24]]);
})();

(function testSingleAgencyObservationIsNotRendered() {
  const item = observation();
  item.sources = { HKO: item.sources.HKO };
  const tracks = overlay.buildRenderableTracks([item], core);
  assert.deepEqual(tracks, []);
})();

console.log('consensus-track-overlay tests: OK');