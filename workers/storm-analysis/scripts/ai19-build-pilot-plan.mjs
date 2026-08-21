import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { previewImportPlan } from '../src/backfill-repository.js';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(workerRoot, '../..');

const CUTOFFS = Object.freeze([
  '2026-08-06T00:00:00.000Z',
  '2026-08-08T00:00:00.000Z',
  '2026-08-10T00:00:00.000Z',
  '2026-08-12T02:00:28.000Z'
]);
const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
const GENERATED_AT = '2026-08-21T05:37:06.707Z';
const SOURCE_DB = Object.freeze({ name: 'storm-track-db', uuid: 'eb0bf995-3ea7-4bf6-bbca-b425892c4d7e' });
const STORM = Object.freeze({ stormKey: 'WP-2026-15', internationalNumber: '15', nameEn: 'CHAN-HOM', nameTc: '昌鴻', season: 2026, basin: 'WNP' });
const HK_REFERENCE = Object.freeze({ name: 'Hong Kong Observatory', lat: 22.3027, lon: 114.1772 });

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) out[argv[i]?.replace(/^--/, '')] = argv[i + 1];
  return out;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function stableObject(value) { return JSON.parse(importer.stableStringify(value)); }
function writeStable(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(stableObject(value), null, 2)}\n`);
}
function maxIso(values) { return values.filter(Boolean).slice().sort().at(-1) ?? null; }
function pointForSnapshot(point) {
  return {
    time: point.valid_at,
    kind: 'forecast',
    forecastHour: point.forecast_hour,
    lat: point.latitude,
    lon: point.longitude,
    pressureHpa: point.pressure_hpa,
    windMs: point.wind_ms,
    gustMs: point.gust_ms,
    windAveragingMinutes: point.wind_averaging_minutes,
    intensityCode: point.intensity_code,
    intensityLabel: point.intensity_label,
    probabilityRadiusKm: point.probability_radius_km,
    sourceOrder: point.source_order,
    advisoryId: point.advisory_id
  };
}
function assert(condition, message) { if (!condition) throw new Error(message); }

const args = parseArgs(process.argv);
const advisoriesPath = args.advisories;
const pointsPath = args.points;
const outputDir = path.resolve(args.output ?? path.join(repoRoot, 'data/ai19'));
assert(advisoriesPath && pointsPath, '--advisories and --points are required');

const advisories = readJson(advisoriesPath);
const points = readJson(pointsPath);
assert(Array.isArray(advisories) && Array.isArray(points), 'evidence inputs must be arrays');
assert(advisories.length === 13, `expected 13 selected advisories, got ${advisories.length}`);
assert(points.length === 69, `expected 69 future-only forecast points, got ${points.length}`);
assert(new Set(advisories.map(item => item.as_of)).size === 4, 'expected exactly four cutoffs');
assert(CUTOFFS.every(cutoff => advisories.some(item => item.as_of === cutoff)), 'all pinned cutoffs must be represented');
assert(advisories.every(item => item.storm_id === STORM.stormKey), 'all advisories must belong to WP-2026-15');
assert(advisories.every(item => AGENCIES.includes(item.agency)), 'unexpected agency in advisory evidence');
assert(advisories.every(item => item.issued_at <= item.as_of), 'advisory issued after historical cutoff');
assert(points.every(item => item.valid_at > item.as_of), 'forecast evidence contains point at or before historical cutoff');
assert(points.every(item => advisories.some(advisory => advisory.id === item.advisory_id && advisory.as_of === item.as_of && advisory.agency === item.agency)), 'forecast point has no selected advisory');

const advisoryIds = new Set(advisories.map(item => item.id));
assert(advisoryIds.size === advisories.length, 'selected advisory IDs must be unique per evidence row');
for (const advisory of advisories) {
  assert(typeof advisory.source_hash === 'string' && /^[0-9a-f]{64}$/i.test(advisory.source_hash), `invalid source hash for ${advisory.id}`);
  assert(typeof advisory.source_url === 'string' && advisory.source_url.startsWith('https://'), `missing source URL for ${advisory.id}`);
  assert(points.some(point => point.advisory_id === advisory.id), `selected advisory ${advisory.id} must contribute a future point`);
}

const evidenceBase = {
  schemaVersion: 'ai19-forecast-evidence/v1',
  sourceDatabase: SOURCE_DB,
  storm: STORM,
  cutoffs: CUTOFFS,
  selectedAdvisories: advisories,
  forecastPoints: points,
  semantics: {
    productionSourceReadOnly: true,
    forecastOnly: true,
    finalizedTruthAvailable: false,
    truthRowsPlanned: 0,
    signalOutcomeRowsPlanned: 0,
    pointsStrictlyAfterCutoff: true,
    generatedByAi19ReadOnlyQueries: true
  }
};
const evidenceSha256 = sha256(importer.stableStringify(evidenceBase));
const evidence = { ...evidenceBase, evidenceSha256 };

const predictionCases = CUTOFFS.map((asOf, index) => {
  const selected = advisories.filter(item => item.as_of === asOf).sort((a, b) => a.agency.localeCompare(b.agency));
  const selectedIds = selected.map(item => item.id);
  const cutoffPoints = points.filter(item => item.as_of === asOf);
  const sources = {};
  for (const agency of AGENCIES) {
    const advisory = selected.find(item => item.agency === agency);
    if (!advisory) {
      sources[agency] = { state: 'missing', reason: 'no-future-forecast-bearing-advisory-at-cutoff' };
      continue;
    }
    const agencyPoints = cutoffPoints.filter(item => item.agency === agency && item.advisory_id === advisory.id)
      .sort((a, b) => a.valid_at.localeCompare(b.valid_at) || Number(a.source_order ?? 0) - Number(b.source_order ?? 0));
    assert(agencyPoints.length > 0, `${agency} ${asOf} must have future points`);
    sources[agency] = {
      state: 'ok',
      baseTime: advisory.issued_at,
      advisoryId: advisory.id,
      sourceCode: advisory.source_code,
      sourceUrl: advisory.source_url,
      sourceHash: advisory.source_hash,
      rawObjectKey: advisory.raw_object_key,
      parserVersion: advisory.parser_version,
      forecast: agencyPoints.map(pointForSnapshot)
    };
  }
  const snapshot = {
    schemaVersion: 'storm-analysis-snapshot/v1',
    generatedAt: asOf,
    storm: { key: STORM.stormKey, internationalNumber: STORM.internationalNumber, nameEn: STORM.nameEn, nameTc: STORM.nameTc },
    referencePoint: HK_REFERENCE,
    comparison: { referenceBaseTime: maxIso(selected.map(item => item.issued_at)) },
    sources
  };
  const cutoffEvidence = { asOf, selectedAdvisories: selected, forecastPoints: cutoffPoints };
  const cutoffHash = sha256(importer.stableStringify(cutoffEvidence));
  return {
    caseId: `ai19_chanhom_${String(index + 1).padStart(2, '0')}`,
    asOf,
    snapshot,
    sourceAvailability: Object.fromEntries(AGENCIES.map(agency => [agency, {
      state: sources[agency].state,
      advisoryId: sources[agency].advisoryId ?? null,
      issuedAt: sources[agency].baseTime ?? null
    }])),
    provenance: {
      type: 'storm-track-d1',
      dataRole: 'forecast',
      source: `storm-track-db/${STORM.stormKey}`,
      sourceUrl: null,
      archiveId: selectedIds.join(','),
      originalIssuedAt: maxIso(selected.map(item => item.issued_at)),
      archiveCapturedAt: maxIso(selected.map(item => item.fetched_at)),
      payloadHash: cutoffHash
    }
  };
});

const input = {
  source: `ai19-forecast-only-pilot/storm-track-db/${evidenceSha256}`,
  generatedAt: GENERATED_AT,
  runId: `ai19_chanhom_forecast_${evidenceSha256.slice(0, 16)}`,
  storms: [{
    stormKey: STORM.stormKey,
    nameTc: STORM.nameTc,
    nameEn: STORM.nameEn,
    season: STORM.season,
    basin: STORM.basin,
    predictionCases
  }]
};
const plan = importer.buildImportPlan(input);
const preview = previewImportPlan(plan);
const planSha256 = sha256(importer.stableStringify(plan));

assert(plan.rows.length === 6, `AI-19 pilot plan must contain exactly 6 rows, got ${plan.rows.length}`);
assert(plan.tableCounts.backfill_runs === 1, 'pilot requires one backfill run row');
assert(plan.tableCounts.historical_storms === 1, 'pilot requires one historical storm row');
assert(plan.tableCounts.forecast_snapshots === 4, 'pilot requires four forecast snapshots');
for (const table of ['truth_datasets', 'truth_points', 'signal_outcomes']) assert(!plan.tableCounts[table], `${table} must remain zero in forecast-only pilot`);
const stormRow = plan.rows.find(row => row.table === 'historical_storms');
assert(stormRow?.values.backfill_mode === 'forecast-only', 'historical storm must be forecast-only');
assert(stormRow?.values.agency_skill_eligible === 0, 'forecast-only pilot must not be agency-skill eligible');
const snapshotRows = plan.rows.filter(row => row.table === 'forecast_snapshots');
assert(snapshotRows.length === 4 && snapshotRows.every(row => row.values.eligible_for_walkforward === 1), 'all four forecast snapshots must have trusted historical provenance');
assert(preview.ok === true && preview.dryRun === true && preview.writesPerformed === false, 'local plan preview must be dry-run only');
assert(preview.rowCount === 6, 'local preview row count must equal 6');
assert(input.source.includes(evidenceSha256), 'run source must bind idempotency fingerprint to evidence SHA-256');

const summary = {
  schemaVersion: 'ai19-pilot-plan-summary/v1',
  storm: STORM,
  evidenceSha256,
  planSha256,
  runId: plan.runId,
  runSource: plan.source,
  generatedAt: plan.generatedAt,
  selectedAdvisoryCount: advisories.length,
  forecastPointCount: points.length,
  snapshotCount: 4,
  rowCount: plan.rows.length,
  tableCounts: preview.tableCounts,
  capability: plan.storms[0].capability,
  cutoffs: predictionCases.map(item => ({
    asOf: item.asOf,
    originalIssuedAt: item.provenance.originalIssuedAt,
    archiveCapturedAt: item.provenance.archiveCapturedAt,
    agencies: AGENCIES.filter(agency => item.snapshot.sources[agency].state === 'ok').map(agency => ({ agency, advisoryId: item.snapshot.sources[agency].advisoryId, points: item.snapshot.sources[agency].forecast.length }))
  })),
  semantics: {
    forecastOnly: true,
    truthFinalityGateHeld: true,
    agencySkillEligible: false,
    importExecuted: false,
    productionDatabaseWritten: false,
    analysisDatabaseWritten: false,
    idempotencyBoundToEvidenceSha256: true
  }
};

writeStable(path.join(outputDir, 'chan-hom-forecast-evidence.json'), evidence);
writeStable(path.join(outputDir, 'chan-hom-pilot-input.json'), input);
writeStable(path.join(outputDir, 'chan-hom-import-plan.json'), plan);
writeStable(path.join(outputDir, 'chan-hom-pilot-summary.json'), summary);

console.log(JSON.stringify({ ok: true, outputDir, ...summary }));
