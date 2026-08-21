import assert from 'node:assert/strict';
import { buildProspectiveForecastCorpus, SOURCE_DB } from '../workers/storm-analysis/scripts/ai21-build-forecast-corpus.mjs';

const H64 = 'a'.repeat(64);
const generatedAt = '2026-08-21T06:45:00.000Z';

function advisory(stormKey, agency, asOf, issuedAt, suffix) {
  return {
    id: `${stormKey}:${agency}:${suffix}`,
    storm_id: stormKey,
    agency,
    as_of: asOf,
    issued_at: issuedAt,
    fetched_at: asOf,
    source_code: agency,
    source_url: `https://example.test/${agency}/${suffix}`,
    source_hash: H64,
    raw_object_key: `raw/${stormKey}/${agency}/${suffix}`,
    parser_version: 'test/v1'
  };
}
function point(stormKey, agency, asOf, advisoryId, validAt, order, offset = 0) {
  return {
    storm_id: stormKey,
    agency,
    as_of: asOf,
    advisory_id: advisoryId,
    valid_at: validAt,
    forecast_hour: 12 + order * 12,
    latitude: 20 + offset + order * 0.2,
    longitude: 130 - offset - order * 0.3,
    pressure_hpa: 990 - order * 5,
    wind_ms: 25 + order,
    gust_ms: 35 + order,
    wind_averaging_minutes: 10,
    intensity_code: 'TS',
    intensity_label: 'Tropical Storm',
    probability_radius_km: null,
    source_order: order
  };
}
function makeStorm({ stormKey, nameEn, nameTc, identity, cutoffs, agencies }) {
  const selectedAdvisories = [];
  const forecastPoints = [];
  for (const [cutoffIndex, asOf] of cutoffs.entries()) {
    for (const [agencyIndex, agency] of agencies.entries()) {
      const issuedAt = new Date(Date.parse(asOf) - (agencyIndex + 1) * 30 * 60 * 1000).toISOString();
      const row = advisory(stormKey, agency, asOf, issuedAt, `${cutoffIndex}-${agencyIndex}`);
      selectedAdvisories.push(row);
      forecastPoints.push(
        point(stormKey, agency, asOf, row.id, new Date(Date.parse(asOf) + 12 * 3600_000).toISOString(), 0, agencyIndex),
        point(stormKey, agency, asOf, row.id, new Date(Date.parse(asOf) + 24 * 3600_000).toISOString(), 1, agencyIndex)
      );
    }
  }
  return { stormKey, nameEn, nameTc, season: 2026, basin: 'WNP', identity, cutoffs, selectedAdvisories, forecastPoints };
}

const evidence = {
  sourceDatabase: SOURCE_DB,
  generatedAt,
  minimumAgencies: 2,
  storms: [
    makeStorm({
      stormKey: 'WP-2026-16',
      nameEn: 'Sample A',
      nameTc: '樣本甲',
      identity: { status: 'unreviewed', internationalNumber: '2616', source: 'production-row-unreviewed' },
      cutoffs: ['2026-08-13T00:00:00.000Z', '2026-08-14T00:00:00.000Z'],
      agencies: ['HKO', 'CMA', 'JMA', 'CWA']
    }),
    makeStorm({
      stormKey: 'WP-2026-17',
      nameEn: 'Sample B',
      nameTc: '樣本乙',
      identity: { status: 'reviewed', internationalNumber: '2620', source: 'operator-reviewed', reviewedAt: generatedAt },
      cutoffs: ['2026-08-15T00:00:00.000Z', '2026-08-16T00:00:00.000Z'],
      agencies: ['JMA', 'CMA', 'CWA']
    })
  ]
};

const result = buildProspectiveForecastCorpus(evidence);
assert.equal(result.summary.stormCount, 2);
assert.equal(result.summary.snapshotCount, 4);
assert.equal(result.summary.tableCounts.backfill_runs, 1);
assert.equal(result.summary.tableCounts.historical_storms, 2);
assert.equal(result.summary.tableCounts.forecast_snapshots, 4);
assert.equal(result.summary.tableCounts.truth_datasets ?? 0, 0);
assert.equal(result.summary.tableCounts.truth_points ?? 0, 0);
assert.equal(result.summary.tableCounts.signal_outcomes ?? 0, 0);
assert.equal(result.summary.semantics.forecastOnly, true);
assert.equal(result.summary.semantics.truthFinalityIndependent, true);
assert.equal(result.summary.semantics.productionDatabaseWritten, false);
assert.equal(result.summary.semantics.analysisDatabaseWritten, false);
assert.equal(result.summary.semantics.verificationPerformed, false);
assert.equal(result.summary.semantics.trainingPerformed, false);
assert.equal(result.summary.semantics.promotionPerformed, false);
assert.ok(/^ai21_forecast_corpus_[0-9a-f]{16}$/.test(result.summary.runId));
assert.equal(result.preview.ok, true);
assert.equal(result.preview.dryRun, true);
assert.equal(result.preview.writesPerformed, false);
assert.equal(result.plan.storms.every(storm => storm.capability.mode === 'forecast-only'), true);
assert.equal(result.plan.storms.every(storm => storm.capability.eligibleForAgencySkill === false), true);

const firstInputStorm = result.input.storms.find(storm => storm.stormKey === 'WP-2026-16');
const secondInputStorm = result.input.storms.find(storm => storm.stormKey === 'WP-2026-17');
assert.equal('internationalNumber' in firstInputStorm.predictionCases[0].snapshot.storm, false, 'unreviewed international number must not enter canonical snapshot');
assert.equal(secondInputStorm.predictionCases[0].snapshot.storm.internationalNumber, '2620');
assert.equal(firstInputStorm.predictionCases[0].snapshot.sources.HKO.state, 'ok');
assert.equal(secondInputStorm.predictionCases[0].snapshot.sources.HKO.state, 'missing');
assert.equal(secondInputStorm.predictionCases[0].snapshot.sources.JMA.state, 'ok');

const replay = buildProspectiveForecastCorpus(structuredClone(evidence));
assert.equal(replay.evidenceSha256, result.evidenceSha256);
assert.equal(replay.planSha256, result.planSha256);
assert.deepEqual(replay.plan, result.plan);

const late = structuredClone(evidence);
late.storms[0].selectedAdvisories[0].issued_at = '2026-08-13T01:00:00.000Z';
assert.throws(() => buildProspectiveForecastCorpus(late), /issued after cutoff/);

const substitution = structuredClone(evidence);
substitution.storms[1].selectedAdvisories[0].agency = 'HKO';
assert.throws(() => buildProspectiveForecastCorpus(substitution), /no matching selected advisory|multiple HKO advisories|only .* forecast agencies/);

const oneAgency = {
  sourceDatabase: SOURCE_DB,
  generatedAt,
  minimumAgencies: 2,
  storms: [makeStorm({
    stormKey: 'WP-2026-X', nameEn: 'Sparse', nameTc: '稀疏', identity: { status: 'unreviewed' },
    cutoffs: ['2026-08-17T00:00:00.000Z'], agencies: ['JMA']
  })]
};
assert.throws(() => buildProspectiveForecastCorpus(oneAgency), /minimum is 2/);

const wrongDb = structuredClone(evidence);
wrongDb.sourceDatabase.uuid = '00000000-0000-0000-0000-000000000000';
assert.throws(() => buildProspectiveForecastCorpus(wrongDb), /source database UUID/);

console.log('storm-analysis AI-21 prospective corpus tests passed');
