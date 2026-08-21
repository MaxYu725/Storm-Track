import assert from 'node:assert/strict';
import { buildLifecycleCapture, stableLifecycleSnapshotId } from '../workers/storm-analysis/scripts/ai22-build-lifecycle-capture.mjs';
import { SOURCE_DB } from '../workers/storm-analysis/scripts/ai21-build-forecast-corpus.mjs';
import { classifySnapshotAgainstExisting, validateLifecycleTransition, CORPUS_CAPTURE_VERSION } from '../workers/storm-analysis/src/corpus-lifecycle-repository.js';
import { handleRequest } from '../workers/storm-analysis/src/index.js';

const H64 = 'a'.repeat(64);

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

function makeStorm(cutoffs, agencies = ['HKO', 'CMA', 'JMA', 'CWA']) {
  const stormKey = 'WP-2026-16';
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
  return {
    stormKey,
    nameEn: 'WP16 lifecycle sample',
    nameTc: 'WP16 生命週期樣本',
    season: 2026,
    basin: 'WNP',
    lifecycle: { windowId: 'wp-2026-16-operational-202608', initialState: 'active' },
    identity: { status: 'unreviewed', internationalNumber: '18', source: 'storm-track-db/storms.international_number' },
    cutoffs,
    selectedAdvisories,
    forecastPoints
  };
}

function evidence(cutoffs, generatedAt = '2026-08-21T08:00:00.000Z', agencies) {
  return {
    sourceDatabase: SOURCE_DB,
    generatedAt,
    minimumAgencies: agencies?.length === 1 ? 1 : 2,
    storms: [makeStorm(cutoffs, agencies)]
  };
}

const first = buildLifecycleCapture(evidence([
  '2026-08-20T18:00:00.000Z',
  '2026-08-21T00:00:00.000Z'
]));
const second = buildLifecycleCapture(evidence([
  '2026-08-20T18:00:00.000Z',
  '2026-08-21T00:00:00.000Z',
  '2026-08-21T06:00:00.000Z'
], '2026-08-21T09:00:00.000Z'));

assert.equal(first.summary.stormCount, 1);
assert.equal(first.summary.snapshotCount, 2);
assert.equal(second.summary.snapshotCount, 3);
assert.notEqual(first.summary.runId, second.summary.runId, 'different evidence sets need different capture runs');
assert.equal(first.captureRequest.captures[0].windowId, second.captureRequest.captures[0].windowId, 'incremental runs must share the explicit window id');

const firstIds = first.plan.rows.filter(row => row.table === 'forecast_snapshots').map(row => row.primaryKey);
const secondIds = second.plan.rows.filter(row => row.table === 'forecast_snapshots').map(row => row.primaryKey);
assert.deepEqual(secondIds.slice(0, 2), firstIds, 'snapshot identity must not depend on run order or run id');
assert.equal(secondIds[2], stableLifecycleSnapshotId('WP-2026-16', '2026-08-21T06:00:00.000Z'));

const firstSnapshot = first.plan.storms[0].forecastCases[0].payload.snapshot;
assert.equal(firstSnapshot.storm.key, 'WP-2026-16');
assert.equal('internationalNumber' in firstSnapshot.storm, false, 'external identity must stay outside immutable forecast snapshots');
assert.equal(first.captureRequest.identityProposals.length, 1);
assert.equal(first.captureRequest.identityProposals[0].identityType, 'production-international-number');
assert.equal(first.captureRequest.identityProposals[0].identityValue, '18');
assert.equal(first.captureRequest.identityProposals[0].reviewStatus, 'unreviewed');
assert.equal(first.plan.tableCounts.truth_datasets ?? 0, 0);
assert.equal(first.plan.tableCounts.truth_points ?? 0, 0);
assert.equal(first.plan.tableCounts.signal_outcomes ?? 0, 0);
assert.equal(first.planPreview.writesPerformed, false);

const deterministicReplay = buildLifecycleCapture(structuredClone(evidence([
  '2026-08-20T18:00:00.000Z',
  '2026-08-21T00:00:00.000Z'
])));
assert.equal(deterministicReplay.evidenceSha256, first.evidenceSha256);
assert.equal(deterministicReplay.planSha256, first.planSha256);
assert.deepEqual(deterministicReplay.captureRequest, first.captureRequest);

const oneAgency = buildLifecycleCapture(evidence(['2026-08-21T00:00:00.000Z'], '2026-08-21T08:00:00.000Z', ['JMA']));
assert.equal(oneAgency.summary.snapshotCount, 1, 'AI-22 must not introduce a new multi-storm/sample-count gate');

const missingWindow = evidence(['2026-08-21T00:00:00.000Z']);
delete missingWindow.storms[0].lifecycle;
assert.throws(() => buildLifecycleCapture(missingWindow), /lifecycle\.windowId is required/);

const planned = {
  primaryKey: 'snap-a',
  values: { storm_key: 'WP-2026-16', as_of: '2026-08-21T00:00:00.000Z', fingerprint: 'fp-a', payload_hash: 'payload-a' }
};
const existingExact = { snapshot_id: 'snap-a', storm_key: 'WP-2026-16', as_of: planned.values.as_of, fingerprint: 'fp-a', payload_hash: 'payload-a' };
assert.equal(classifySnapshotAgainstExisting(planned, existingExact, null).disposition, 'existing');
assert.equal(classifySnapshotAgainstExisting(planned, null, { ...existingExact, snapshot_id: 'legacy-id' }).canonicalSnapshotId, 'legacy-id');
assert.equal(classifySnapshotAgainstExisting(planned, null, null).disposition, 'appended');
assert.throws(() => classifySnapshotAgainstExisting(planned, { ...existingExact, fingerprint: 'changed' }, null), error => error?.code === 'snapshot-id-conflict');
assert.throws(() => classifySnapshotAgainstExisting(planned, null, { ...existingExact, snapshot_id: 'other', fingerprint: 'changed' }), error => error?.code === 'snapshot-cutoff-conflict');

assert.deepEqual(validateLifecycleTransition('active', 'quiescent'), { from: 'active', to: 'quiescent', noop: false });
assert.deepEqual(validateLifecycleTransition('quiescent', 'active'), { from: 'quiescent', to: 'active', noop: false });
assert.equal(validateLifecycleTransition('active', 'closed').to, 'frozen');
assert.throws(() => validateLifecycleTransition('frozen', 'active'), error => error?.code === 'invalid-lifecycle-transition');

const routeCalls = [];
const routeRepository = {
  async previewCapture(body) { routeCalls.push(['preview', body]); return { ok: true, dryRun: true, writesPerformed: false }; },
  async capture(body) { routeCalls.push(['capture', body]); return { ok: true, status: 'completed', writesPerformed: true }; },
  async transitionWindow(body) { routeCalls.push(['transition', body]); return { status: 'transitioned', windowId: body.windowId, state: body.toState }; },
  async recordIdentityBinding(body) { routeCalls.push(['bind', body]); return { status: 'recorded', bindingId: body.bindingId }; },
  async recordStormMerge(body) { routeCalls.push(['merge', body]); return { status: 'recorded', mergeId: body.mergeId }; }
};
const routeDependencies = { createCorpusLifecycleRepository: () => routeRepository };
const routeEnv = { ANALYSIS_DB: {}, BACKFILL_TOKEN: 'backfill-secret', ANALYSIS_ADMIN_TOKEN: 'admin-secret' };

const health = await handleRequest(new Request('https://example.test/health'), routeEnv, routeDependencies);
assert.equal(health.status, 200);
assert.equal((await health.json()).corpusLifecycleVersion, CORPUS_CAPTURE_VERSION);

const unauthPreview = await handleRequest(new Request('https://example.test/api/corpus/capture/preview', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ test: true })
}), routeEnv, routeDependencies);
assert.equal(unauthPreview.status, 401);

const previewRoute = await handleRequest(new Request('https://example.test/api/corpus/capture/preview', {
  method: 'POST', headers: { authorization: 'Bearer backfill-secret', 'content-type': 'application/json' }, body: JSON.stringify({ step: 'preview' })
}), routeEnv, routeDependencies);
assert.equal(previewRoute.status, 200);
assert.deepEqual(await previewRoute.json(), { ok: true, dryRun: true, writesPerformed: false });

const captureRoute = await handleRequest(new Request('https://example.test/api/corpus/capture', {
  method: 'POST', headers: { authorization: 'Bearer backfill-secret', 'content-type': 'application/json' }, body: JSON.stringify({ step: 'capture' })
}), routeEnv, routeDependencies);
assert.equal(captureRoute.status, 200);
assert.equal((await captureRoute.json()).status, 'completed');

for (const [path, body, callName] of [
  ['/api/admin/corpus/lifecycle/transition', { windowId: 'w', toState: 'quiescent' }, 'transition'],
  ['/api/admin/corpus/identity/bind', { bindingId: 'b' }, 'bind'],
  ['/api/admin/corpus/identity/merge', { mergeId: 'm' }, 'merge']
]) {
  const denied = await handleRequest(new Request(`https://example.test${path}`, {
    method: 'POST', headers: { authorization: 'Bearer backfill-secret', 'content-type': 'application/json' }, body: JSON.stringify(body)
  }), routeEnv, routeDependencies);
  assert.equal(denied.status, 401, `${path} must require analysis-admin authorization, not backfill authorization`);

  const allowed = await handleRequest(new Request(`https://example.test${path}`, {
    method: 'POST', headers: { authorization: 'Bearer admin-secret', 'content-type': 'application/json' }, body: JSON.stringify(body)
  }), routeEnv, routeDependencies);
  assert.equal(allowed.status, 200);
  assert.ok(routeCalls.some(([name]) => name === callName));
}

console.log('storm-analysis AI-22 corpus lifecycle tests passed');
