import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { previewImportPlan } from '../src/backfill-repository.js';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(workerRoot, '../..');

export const AI21_CORPUS_VERSION = 'ai21-prospective-forecast-corpus/v1';
export const SOURCE_DB = Object.freeze({ name: 'storm-track-db', uuid: 'eb0bf995-3ea7-4bf6-bbca-b425892c4d7e' });
export const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
export const MAX_STORMS = 16;
export const MAX_CUTOFFS_PER_STORM = 8;
export const DEFAULT_MINIMUM_AGENCIES = 2;
export const HK_REFERENCE = Object.freeze({ name: 'Hong Kong Observatory', lat: 22.3027, lon: 114.1772 });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sha256(value) {
  const text = typeof value === 'string' ? value : importer.stableStringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}
function stableClone(value) {
  return JSON.parse(importer.stableStringify(value));
}
function maxIso(values) {
  return values.filter(Boolean).slice().sort().at(-1) ?? null;
}
function safeCaseToken(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}
function parseIso(value, label) {
  const ms = Date.parse(value);
  assert(Number.isFinite(ms), `${label} must be a valid ISO timestamp`);
  return new Date(ms).toISOString();
}
function normalizeIdentity(storm) {
  const identity = storm?.identity && typeof storm.identity === 'object' ? storm.identity : {};
  const status = identity.status === 'reviewed' ? 'reviewed' : 'unreviewed';
  const internationalNumber = status === 'reviewed' && identity.internationalNumber != null
    ? String(identity.internationalNumber).trim() || null
    : null;
  return {
    status,
    internationalNumber,
    source: identity.source ? String(identity.source) : null,
    reviewedAt: status === 'reviewed' && identity.reviewedAt ? parseIso(identity.reviewedAt, 'identity.reviewedAt') : null
  };
}
function pointForSnapshot(point) {
  return {
    time: point.valid_at,
    kind: 'forecast',
    forecastHour: point.forecast_hour ?? null,
    lat: point.latitude,
    lon: point.longitude,
    pressureHpa: point.pressure_hpa ?? null,
    windMs: point.wind_ms ?? null,
    gustMs: point.gust_ms ?? null,
    windAveragingMinutes: point.wind_averaging_minutes ?? null,
    intensityCode: point.intensity_code ?? null,
    intensityLabel: point.intensity_label ?? null,
    probabilityRadiusKm: point.probability_radius_km ?? null,
    sourceOrder: point.source_order ?? null,
    advisoryId: point.advisory_id
  };
}
function validateSourceDatabase(sourceDatabase) {
  assert(sourceDatabase?.name === SOURCE_DB.name, `AI-21 source database must be ${SOURCE_DB.name}`);
  assert(sourceDatabase?.uuid === SOURCE_DB.uuid, `AI-21 source database UUID must be ${SOURCE_DB.uuid}`);
}
function validateStormEvidence(storm, minimumAgencies) {
  const stormKey = String(storm?.stormKey ?? '').trim();
  assert(stormKey, 'stormKey is required');
  const cutoffs = (Array.isArray(storm?.cutoffs) ? storm.cutoffs : []).map((value, index) => parseIso(value, `${stormKey}.cutoffs[${index}]`));
  assert(cutoffs.length > 0, `${stormKey} requires at least one cutoff`);
  assert(cutoffs.length <= MAX_CUTOFFS_PER_STORM, `${stormKey} exceeds ${MAX_CUTOFFS_PER_STORM} cutoffs`);
  assert(new Set(cutoffs).size === cutoffs.length, `${stormKey} cutoffs must be unique`);
  assert(cutoffs.every((value, index) => index === 0 || cutoffs[index - 1] < value), `${stormKey} cutoffs must be strictly increasing`);

  const advisories = Array.isArray(storm?.selectedAdvisories) ? storm.selectedAdvisories : [];
  const points = Array.isArray(storm?.forecastPoints) ? storm.forecastPoints : [];
  assert(advisories.length > 0, `${stormKey} requires selected advisories`);
  assert(points.length > 0, `${stormKey} requires forecast points`);

  const advisoryByCutoffAgency = new Map();
  for (const advisory of advisories) {
    assert(advisory?.storm_id === stormKey, `${stormKey} advisory ${advisory?.id ?? 'unknown'} belongs to another storm`);
    assert(AGENCIES.includes(advisory?.agency), `${stormKey} has unexpected agency ${advisory?.agency}`);
    const asOf = parseIso(advisory?.as_of, `${stormKey} advisory as_of`);
    assert(cutoffs.includes(asOf), `${stormKey} advisory cutoff ${asOf} is not declared`);
    const issuedAt = parseIso(advisory?.issued_at, `${stormKey} advisory issued_at`);
    assert(issuedAt <= asOf, `${stormKey} ${advisory.agency} advisory issued after cutoff ${asOf}`);
    assert(typeof advisory?.source_hash === 'string' && /^[0-9a-f]{64}$/i.test(advisory.source_hash), `${stormKey} advisory ${advisory?.id} has invalid source hash`);
    assert(typeof advisory?.source_url === 'string' && advisory.source_url.startsWith('https://'), `${stormKey} advisory ${advisory?.id} requires HTTPS source URL`);
    const key = `${asOf}|${advisory.agency}`;
    assert(!advisoryByCutoffAgency.has(key), `${stormKey} has multiple ${advisory.agency} advisories at ${asOf}`);
    advisoryByCutoffAgency.set(key, { ...advisory, as_of: asOf, issued_at: issuedAt });
  }

  const pointsByCutoffAgency = new Map();
  for (const point of points) {
    assert(point?.storm_id == null || point.storm_id === stormKey, `${stormKey} forecast point belongs to another storm`);
    assert(AGENCIES.includes(point?.agency), `${stormKey} forecast point has unexpected agency ${point?.agency}`);
    const asOf = parseIso(point?.as_of, `${stormKey} forecast point as_of`);
    const validAt = parseIso(point?.valid_at, `${stormKey} forecast point valid_at`);
    assert(cutoffs.includes(asOf), `${stormKey} forecast point cutoff ${asOf} is not declared`);
    assert(validAt > asOf, `${stormKey} forecast point must be strictly after cutoff ${asOf}`);
    const advisory = advisoryByCutoffAgency.get(`${asOf}|${point.agency}`);
    assert(advisory && advisory.id === point.advisory_id, `${stormKey} forecast point has no matching selected advisory at ${asOf}`);
    assert(advisory.issued_at < validAt, `${stormKey} forecast point valid time must be after advisory issue time`);
    const key = `${asOf}|${point.agency}`;
    const list = pointsByCutoffAgency.get(key) ?? [];
    list.push({ ...point, as_of: asOf, valid_at: validAt });
    pointsByCutoffAgency.set(key, list);
  }

  for (const cutoff of cutoffs) {
    const availableAgencies = AGENCIES.filter(agency => {
      const advisory = advisoryByCutoffAgency.get(`${cutoff}|${agency}`);
      const forecast = pointsByCutoffAgency.get(`${cutoff}|${agency}`) ?? [];
      return Boolean(advisory && forecast.length);
    });
    assert(availableAgencies.length >= minimumAgencies, `${stormKey} ${cutoff} has only ${availableAgencies.length} forecast agencies; minimum is ${minimumAgencies}`);
    for (const agency of availableAgencies) {
      const advisory = advisoryByCutoffAgency.get(`${cutoff}|${agency}`);
      assert((pointsByCutoffAgency.get(`${cutoff}|${agency}`) ?? []).some(point => point.advisory_id === advisory.id), `${stormKey} ${agency} ${cutoff} selected advisory contributes no future points`);
    }
  }

  return { stormKey, cutoffs, advisoryByCutoffAgency, pointsByCutoffAgency };
}

export function buildProspectiveForecastCorpus(evidence, options = {}) {
  validateSourceDatabase(evidence?.sourceDatabase);
  const generatedAt = parseIso(evidence?.generatedAt, 'generatedAt');
  const minimumAgencies = Math.max(1, Math.min(AGENCIES.length, Number(options.minimumAgencies ?? evidence?.minimumAgencies ?? DEFAULT_MINIMUM_AGENCIES)));
  const storms = Array.isArray(evidence?.storms) ? evidence.storms : [];
  assert(storms.length > 0, 'AI-21 requires at least one storm');
  assert(storms.length <= MAX_STORMS, `AI-21 supports at most ${MAX_STORMS} storms per corpus plan`);
  assert(new Set(storms.map(item => String(item?.stormKey ?? '').trim())).size === storms.length, 'AI-21 storm keys must be unique');

  const normalizedStormEvidence = [];
  const inputStorms = [];
  for (const storm of storms) {
    const validated = validateStormEvidence(storm, minimumAgencies);
    const identity = normalizeIdentity(storm);
    const predictionCases = validated.cutoffs.map((asOf, index) => {
      const sources = {};
      const selected = [];
      const cutoffPoints = [];
      for (const agency of AGENCIES) {
        const advisory = validated.advisoryByCutoffAgency.get(`${asOf}|${agency}`);
        const agencyPoints = (validated.pointsByCutoffAgency.get(`${asOf}|${agency}`) ?? [])
          .slice().sort((a, b) => a.valid_at.localeCompare(b.valid_at) || Number(a.source_order ?? 0) - Number(b.source_order ?? 0));
        if (!advisory || !agencyPoints.length) {
          sources[agency] = { state: 'missing', reason: 'no-future-forecast-bearing-advisory-at-cutoff' };
          continue;
        }
        selected.push(advisory);
        cutoffPoints.push(...agencyPoints);
        sources[agency] = {
          state: 'ok',
          baseTime: advisory.issued_at,
          advisoryId: advisory.id,
          sourceCode: advisory.source_code ?? null,
          sourceUrl: advisory.source_url,
          sourceHash: advisory.source_hash,
          rawObjectKey: advisory.raw_object_key ?? null,
          parserVersion: advisory.parser_version ?? null,
          forecast: agencyPoints.map(pointForSnapshot)
        };
      }
      const cutoffEvidence = { stormKey: validated.stormKey, asOf, selectedAdvisories: selected, forecastPoints: cutoffPoints };
      const cutoffHash = sha256(cutoffEvidence);
      const snapshotStorm = {
        key: validated.stormKey,
        nameEn: storm?.nameEn ?? null,
        nameTc: storm?.nameTc ?? null
      };
      if (identity.internationalNumber) snapshotStorm.internationalNumber = identity.internationalNumber;
      return {
        caseId: `ai21_${safeCaseToken(validated.stormKey)}_${String(index + 1).padStart(2, '0')}`,
        asOf,
        snapshot: {
          schemaVersion: 'storm-analysis-snapshot/v1',
          generatedAt: asOf,
          storm: snapshotStorm,
          referencePoint: HK_REFERENCE,
          comparison: { referenceBaseTime: maxIso(selected.map(item => item.issued_at)) },
          sources
        },
        sourceAvailability: Object.fromEntries(AGENCIES.map(agency => [agency, {
          state: sources[agency].state,
          advisoryId: sources[agency].advisoryId ?? null,
          issuedAt: sources[agency].baseTime ?? null
        }])),
        provenance: {
          type: 'storm-track-d1',
          dataRole: 'forecast',
          source: `${SOURCE_DB.name}/${validated.stormKey}`,
          sourceUrl: null,
          archiveId: selected.map(item => item.id).sort().join(','),
          originalIssuedAt: maxIso(selected.map(item => item.issued_at)),
          archiveCapturedAt: maxIso(selected.map(item => item.fetched_at)),
          payloadHash: cutoffHash
        }
      };
    });

    normalizedStormEvidence.push({
      stormKey: validated.stormKey,
      identity,
      cutoffs: validated.cutoffs,
      selectedAdvisories: storm.selectedAdvisories,
      forecastPoints: storm.forecastPoints
    });
    inputStorms.push({
      stormKey: validated.stormKey,
      nameTc: storm?.nameTc ?? null,
      nameEn: storm?.nameEn ?? null,
      season: Number(storm?.season ?? 2026),
      basin: storm?.basin ?? 'WNP',
      predictionCases
    });
  }

  const evidenceEnvelope = {
    schemaVersion: AI21_CORPUS_VERSION,
    sourceDatabase: SOURCE_DB,
    generatedAt,
    minimumAgencies,
    storms: normalizedStormEvidence,
    semantics: {
      productionSourceReadOnly: true,
      forecastOnly: true,
      explicitAgencySeparation: true,
      missingAgencyNotSubstituted: true,
      internationalNumberRequiresReviewedIdentity: true,
      finalizedTruthRequired: false,
      truthRowsPlanned: 0,
      signalOutcomeRowsPlanned: 0
    }
  };
  const evidenceSha256 = sha256(evidenceEnvelope);
  const runId = `ai21_forecast_corpus_${evidenceSha256.slice(0, 16)}`;
  const input = {
    source: `ai21-prospective-forecast-corpus/${SOURCE_DB.name}/${evidenceSha256}`,
    generatedAt,
    runId,
    storms: inputStorms
  };
  const plan = importer.buildImportPlan(input);
  const preview = previewImportPlan(plan);
  const planSha256 = sha256(plan);
  const expectedSnapshots = inputStorms.reduce((sum, storm) => sum + storm.predictionCases.length, 0);

  assert(plan.tableCounts.backfill_runs === 1, 'AI-21 corpus plan requires one backfill run');
  assert(plan.tableCounts.historical_storms === storms.length, 'AI-21 historical storm row count mismatch');
  assert(plan.tableCounts.forecast_snapshots === expectedSnapshots, 'AI-21 forecast snapshot row count mismatch');
  for (const table of ['truth_datasets', 'truth_points', 'signal_outcomes']) assert(!plan.tableCounts[table], `${table} must remain zero in AI-21 forecast corpus`);
  assert(plan.storms.every(storm => storm.capability.mode === 'forecast-only'), 'AI-21 storms must remain forecast-only');
  assert(plan.storms.every(storm => storm.capability.eligibleForAgencySkill === false), 'AI-21 forecast-only storms must not be agency-skill eligible');
  assert(plan.rows.filter(row => row.table === 'forecast_snapshots').every(row => row.values.eligible_for_walkforward === 1), 'AI-21 snapshots require trusted historical provenance');
  assert(preview.ok === true && preview.dryRun === true && preview.writesPerformed === false, 'AI-21 plan preview must remain no-write');

  return {
    evidence: { ...evidenceEnvelope, evidenceSha256 },
    evidenceSha256,
    input,
    plan,
    planSha256,
    preview,
    summary: {
      schemaVersion: `${AI21_CORPUS_VERSION}-summary`,
      runId,
      generatedAt,
      evidenceSha256,
      planSha256,
      stormCount: storms.length,
      snapshotCount: expectedSnapshots,
      selectedAdvisoryCount: storms.reduce((sum, storm) => sum + storm.selectedAdvisories.length, 0),
      forecastPointCount: storms.reduce((sum, storm) => sum + storm.forecastPoints.length, 0),
      tableCounts: preview.tableCounts,
      storms: inputStorms.map((storm, index) => ({
        stormKey: storm.stormKey,
        identity: normalizedStormEvidence[index].identity,
        snapshotCount: storm.predictionCases.length,
        cutoffs: storm.predictionCases.map(item => ({
          asOf: item.asOf,
          agencies: AGENCIES.filter(agency => item.snapshot.sources[agency].state === 'ok')
        }))
      })),
      semantics: {
        forecastOnly: true,
        truthFinalityIndependent: true,
        productionDatabaseWritten: false,
        analysisDatabaseWritten: false,
        verificationPerformed: false,
        trainingPerformed: false,
        promotionPerformed: false,
        reviewedIdentityRequiredForInternationalNumber: true
      }
    }
  };
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) out[argv[index]?.replace(/^--/, '')] = argv[index + 1];
  return out;
}
function writeStable(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(stableClone(value), null, 2)}\n`);
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  assert(args.evidence, 'usage: ai21-build-forecast-corpus.mjs --evidence <json> [--output <dir>]');
  const evidence = JSON.parse(fs.readFileSync(path.resolve(args.evidence), 'utf8'));
  const result = buildProspectiveForecastCorpus(evidence);
  if (args.output) {
    const output = path.resolve(args.output);
    writeStable(path.join(output, 'forecast-corpus-evidence.json'), result.evidence);
    writeStable(path.join(output, 'forecast-corpus-input.json'), result.input);
    writeStable(path.join(output, 'forecast-corpus-plan.json'), result.plan);
    writeStable(path.join(output, 'forecast-corpus-summary.json'), result.summary);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ...result.summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
