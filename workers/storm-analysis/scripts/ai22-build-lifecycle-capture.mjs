import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { buildProspectiveForecastCorpus, SOURCE_DB } from './ai21-build-forecast-corpus.mjs';
import { previewImportPlan } from '../src/backfill-repository.js';
import { CORPUS_CAPTURE_VERSION } from '../src/corpus-lifecycle-repository.js';

const require = createRequire(import.meta.url);
const importer = require('../../../analysis/historical-backfill-importer.js');

export const AI22_CAPTURE_VERSION = 'ai22-incremental-corpus-capture/v1';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  const text = typeof value === 'string' ? value : importer.stableStringify(value);
  return crypto.createHash('sha256').update(text).digest('hex');
}

function safeToken(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

function cutoffToken(value) {
  const iso = new Date(value).toISOString();
  return iso.replace(/[-:]/g, '').replace('.000', '').replace('T', 't').replace('Z', 'z').toLowerCase();
}

export function stableLifecycleSnapshotId(stormKey, asOf) {
  return `ai22_${safeToken(stormKey)}_${cutoffToken(asOf)}`;
}

function identityProposal(storm, generatedAt, evidenceSha256, index = 0) {
  const identity = storm?.identity && typeof storm.identity === 'object' ? storm.identity : {};
  const value = identity.internationalNumber == null ? '' : String(identity.internationalNumber).trim();
  if (!value) return null;
  const basis = {
    stormKey: String(storm.stormKey),
    identityType: String(identity.identityType || 'production-international-number'),
    identityValue: value,
    source: identity.source ? String(identity.source) : 'storm-track-db/storms.international_number',
    evidenceSha256,
    proposedAt: generatedAt,
    index
  };
  const fingerprint = sha256(basis);
  return {
    bindingId: `ai22_identity_${fingerprint.slice(0, 24)}`,
    stormKey: basis.stormKey,
    identityType: basis.identityType,
    identityValue: basis.identityValue,
    reviewStatus: 'unreviewed',
    source: basis.source,
    evidenceSha256,
    proposedAt: generatedAt,
    fingerprint
  };
}

function externalIdentityProposals(storm, generatedAt, evidenceSha256) {
  const list = Array.isArray(storm?.identity?.externalIdentities) ? storm.identity.externalIdentities : [];
  return list.map((item, index) => {
    const identityType = String(item?.type || '').trim();
    const identityValue = String(item?.value || '').trim();
    assert(identityType && identityValue, `${storm.stormKey}.identity.externalIdentities[${index}] requires type and value`);
    const basis = {
      stormKey: String(storm.stormKey), identityType, identityValue,
      source: item?.source ? String(item.source) : null,
      evidenceSha256, proposedAt: generatedAt, index: index + 1000
    };
    const fingerprint = sha256(basis);
    return {
      bindingId: `ai22_identity_${fingerprint.slice(0, 24)}`,
      stormKey: basis.stormKey, identityType, identityValue,
      reviewStatus: 'unreviewed', source: basis.source,
      evidenceSha256, proposedAt: generatedAt, fingerprint
    };
  });
}

export function buildLifecycleCapture(evidence, options = {}) {
  assert(evidence && typeof evidence === 'object' && !Array.isArray(evidence), 'AI-22 evidence object is required');
  assert(evidence?.sourceDatabase?.name === SOURCE_DB.name && evidence?.sourceDatabase?.uuid === SOURCE_DB.uuid, 'AI-22 source database identity must match the pinned production storm-track-db');
  const generatedAtMs = Date.parse(evidence.generatedAt);
  assert(Number.isFinite(generatedAtMs), 'generatedAt must be a valid timestamp');
  const generatedAt = new Date(generatedAtMs).toISOString();
  const storms = Array.isArray(evidence.storms) ? evidence.storms : [];
  assert(storms.length > 0, 'AI-22 requires at least one storm');

  const captures = storms.map((storm, index) => {
    const stormKey = String(storm?.stormKey || '').trim();
    assert(stormKey, `storms[${index}].stormKey is required`);
    const windowId = String(storm?.lifecycle?.windowId || '').trim();
    assert(windowId, `${stormKey}.lifecycle.windowId is required so incremental runs share an explicit capture window`);
    const requested = String(storm?.lifecycle?.initialState || 'active').toLowerCase();
    const initialState = requested === 'closed' ? 'frozen' : requested;
    assert(['active', 'quiescent', 'frozen'].includes(initialState), `${stormKey}.lifecycle.initialState must be active, quiescent or frozen`);
    return { windowId, stormKey, initialState };
  });
  assert(new Set(captures.map(item => item.windowId)).size === captures.length, 'AI-22 lifecycle window ids must be unique within a capture run');

  // Reuse AI-21's strict no-leakage/source-separation validator, but deliberately
  // strip external identity from the canonical snapshot. AI-22 stores identity
  // evidence separately and only reviewed admin decisions may become canonical.
  const baseEvidence = {
    ...evidence,
    generatedAt,
    storms: storms.map(storm => ({
      ...storm,
      identity: {
        status: 'unreviewed',
        source: storm?.identity?.source ?? null
      }
    }))
  };
  const base = buildProspectiveForecastCorpus(baseEvidence, {
    minimumAgencies: options.minimumAgencies ?? evidence.minimumAgencies
  });

  const evidenceEnvelope = {
    schemaVersion: AI22_CAPTURE_VERSION,
    sourceDatabase: SOURCE_DB,
    generatedAt,
    storms: storms.map(storm => ({
      stormKey: storm.stormKey,
      lifecycle: storm.lifecycle,
      identity: storm.identity ?? null,
      cutoffs: storm.cutoffs,
      selectedAdvisories: storm.selectedAdvisories,
      forecastPoints: storm.forecastPoints
    })),
    semantics: {
      activeStormMayAppend: true,
      stableSnapshotIdentityUsesStormAndCutoff: true,
      externalIdentityStoredSeparately: true,
      reviewedIdentityRequiredForCanonicalMapping: true,
      sourceAgenciesIndependent: true,
      missingAgencyNeverSubstituted: true,
      productionSourceReadOnly: true,
      truthRowsPlanned: 0,
      verificationRowsPlanned: 0,
      trainingRowsPlanned: 0,
      promotionRowsPlanned: 0
    }
  };
  const evidenceSha256 = sha256(evidenceEnvelope);

  const inputStorms = base.input.storms.map(storm => ({
    ...storm,
    predictionCases: storm.predictionCases.map(item => ({
      ...item,
      caseId: stableLifecycleSnapshotId(storm.stormKey, item.asOf),
      snapshot: {
        ...item.snapshot,
        storm: {
          key: storm.stormKey,
          nameEn: item.snapshot?.storm?.nameEn ?? null,
          nameTc: item.snapshot?.storm?.nameTc ?? null
        }
      }
    }))
  }));

  const runId = `ai22_capture_${evidenceSha256.slice(0, 16)}`;
  const plan = importer.buildImportPlan({
    source: `ai22-incremental-corpus/${SOURCE_DB.name}/${evidenceSha256}`,
    generatedAt,
    runId,
    storms: inputStorms
  });
  const planPreview = previewImportPlan(plan);
  const planSha256 = sha256(plan);
  const identityProposals = storms.flatMap((storm, index) => {
    const primary = identityProposal(storm, generatedAt, evidenceSha256, index);
    return [primary, ...externalIdentityProposals(storm, generatedAt, evidenceSha256)].filter(Boolean);
  });
  const captureFingerprint = sha256({ evidenceSha256, planSha256, runId, captures, identityProposals });

  const snapshotRows = plan.rows.filter(row => row.table === 'forecast_snapshots');
  assert(new Set(snapshotRows.map(row => row.primaryKey)).size === snapshotRows.length, 'AI-22 stable snapshot ids must be unique');
  assert(snapshotRows.every(row => row.primaryKey === stableLifecycleSnapshotId(row.values.storm_key, row.values.as_of)), 'AI-22 snapshot id must depend only on internal stormKey and cutoff');
  assert(plan.storms.every(storm => storm.capability.mode === 'forecast-only'), 'AI-22 capture plans must remain forecast-only');
  assert(plan.storms.every(storm => storm.capability.eligibleForAgencySkill === false), 'AI-22 capture plans must remain ineligible for agency-skill learning until truth exists');
  for (const table of ['truth_datasets', 'truth_points', 'signal_outcomes']) assert(!plan.tableCounts[table], `${table} must remain zero in AI-22 forecast capture`);

  const captureRequest = {
    schemaVersion: CORPUS_CAPTURE_VERSION,
    generatedAt,
    evidenceSha256,
    captureFingerprint,
    plan,
    captures,
    identityProposals
  };

  return {
    evidence: { ...evidenceEnvelope, evidenceSha256 },
    evidenceSha256,
    plan,
    planSha256,
    planPreview,
    captureRequest,
    summary: {
      schemaVersion: `${AI22_CAPTURE_VERSION}-summary`,
      runId,
      evidenceSha256,
      planSha256,
      captureFingerprint,
      stormCount: inputStorms.length,
      snapshotCount: snapshotRows.length,
      identityProposalCount: identityProposals.length,
      captureWindows: captures,
      tableCounts: plan.tableCounts,
      remoteWritesPerformed: false
    }
  };
}
