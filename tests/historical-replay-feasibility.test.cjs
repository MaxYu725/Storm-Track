'use strict';

const assert = require('node:assert/strict');
const audit = require('../analysis/historical-replay-feasibility.js');

function advisory({ id, stormId, agency, issuedAt, lastValidAt, points = 3, hash = 'a'.repeat(64), url = 'https://example.test/source' }) {
  return {
    id,
    storm_id: stormId,
    agency,
    issued_at: issuedAt,
    fetched_at: issuedAt,
    source_hash: hash,
    source_url: url,
    raw_object_key: `raw/${id}`,
    forecast_point_count: points,
    last_forecast_valid_at: lastValidAt
  };
}

const storms = [
  {
    storm_key: 'WP-2026-08', name_en: 'HONGXIA', name_zh: '紅霞', international_number: '08',
    first_seen_at: '2026-06-20T00:00:00Z', last_seen_at: '2026-06-27T00:00:00Z', status: 'inactive',
    forecast_agency_count: 4, forecast_advisory_count: 12, forecast_point_count: 48
  },
  {
    storm_key: 'WP-2025-18', name_en: 'RAGASA', name_zh: '樺加沙', international_number: '18',
    first_seen_at: '2025-09-18T00:00:00Z', last_seen_at: '2025-09-25T00:00:00Z', status: 'inactive',
    forecast_agency_count: 3, forecast_advisory_count: 9, forecast_point_count: 36
  }
];

const advisories = [
  ...['HKO', 'CMA', 'JMA', 'CWA'].flatMap((agency, index) => [
    advisory({ id: `hx-${agency}-1`, stormId: 'WP-2026-08', agency, issuedAt: `2026-06-22T0${index}:00:00Z`, lastValidAt: '2026-06-25T12:00:00Z' }),
    advisory({ id: `hx-${agency}-2`, stormId: 'WP-2026-08', agency, issuedAt: `2026-06-23T0${index}:00:00Z`, lastValidAt: '2026-06-26T12:00:00Z' })
  ]),
  ...['CMA', 'JMA', 'CWA'].map((agency, index) => advisory({
    id: `rg-${agency}-1`, stormId: 'WP-2025-18', agency,
    issuedAt: `2025-09-20T0${index}:00:00Z`, lastValidAt: '2025-09-24T00:00:00Z'
  }))
];

const result = audit.auditHistoricalReplay({
  stormRows: storms,
  advisoryRows: advisories,
  targets: [
    { id: '2026-hongxia', year: 2026, aliases: ['紅霞', '红霞'] },
    { id: '2025-ragasa', year: 2025, aliases: ['樺加沙', '桦加沙', 'RAGASA'] }
  ],
  generatedAt: '2026-08-22T03:00:00Z'
});

assert.equal(result.schemaVersion, 'historical-replay-feasibility/v1');
assert.equal(result.matchedCount, 2);
assert.equal(result.source.productionDatabaseWritten, false);
assert.equal(result.semantics.calibrationOrTrainingPerformed, false);

const hongxia = result.cases.find(item => item.targetId === '2026-hongxia');
assert.equal(hongxia.storm.stormKey, 'WP-2026-08');
assert.equal(hongxia.cutoffCoverage.maxAgencyCount, 4);
assert.equal(hongxia.provenance.completeForWalkForward, true);
assert.equal(hongxia.replayCapability, 'multi-agency-replay-ready');
assert.equal(hongxia.windRadiiAuditRequired, true);

const ragasa = result.cases.find(item => item.targetId === '2025-ragasa');
assert.equal(ragasa.storm.stormKey, 'WP-2025-18');
assert.equal(ragasa.cutoffCoverage.maxAgencyCount, 3);
assert.equal(ragasa.replayCapability, 'multi-agency-replay-ready');

const missing = audit.auditHistoricalReplay({
  stormRows: storms,
  advisoryRows: advisories,
  targets: [{ id: 'missing', year: 2024, aliases: ['NONE'] }]
});
assert.equal(missing.cases[0].status, 'not-found');

const gap = audit.provenanceSummary([
  advisory({ id: 'bad', stormId: 'X', agency: 'JMA', issuedAt: '2026-01-01T00:00:00Z', lastValidAt: '2026-01-02T00:00:00Z', hash: '', url: '' })
]);
assert.equal(gap.completeForWalkForward, false);
assert.equal(gap.gaps.missingSourceHash, 1);
assert.equal(gap.gaps.missingSourceUrl, 1);

console.log('historical replay feasibility tests: OK');
