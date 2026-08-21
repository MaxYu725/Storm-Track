import { createBackfillRepository, previewImportPlan } from './backfill-repository.js';
import { createCorpusLifecycleRepository, CORPUS_CAPTURE_VERSION } from './corpus-lifecycle-repository.js';
import { createModelRepository } from './model-repository.js';
import { createSignalRiskRepository, PROFILE_SCHEMA_VERSION } from './signal-risk-repository.js';
import { createAnalysisOrchestrator, ORCHESTRATION_VERSION } from './analysis-orchestrator.js';
import { createAnalysisCacheRepository, buildAnalysisCacheIdentity, CACHE_SCHEMA_VERSION } from './analysis-cache-repository.js';
import {
  previewPersistedSignalCalibrationTraining,
  runPersistedSignalCalibrationTraining,
  RUNNER_VERSION as SIGNAL_TRAINING_RUNNER_VERSION
} from './signal-training-runner.js';
import { createOutcomeCurationRepository, CURATION_VERSION as OUTCOME_CURATION_VERSION } from './outcome-curation-repository.js';
import { createSignalPromotionRepository, PROMOTION_VERSION as SIGNAL_PROMOTION_VERSION } from './signal-promotion-repository.js';

const SERVICE = 'storm-analysis';
const MAX_BODY_BYTES = 1024 * 1024;

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function errorResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || 'internal-error';
  const payload = { ok: false, error: code, message: status >= 500 ? 'Internal server error' : String(error?.message || code) };
  if (status < 500 && error?.details !== undefined) payload.details = error.details;
  if (status >= 500) console.error(JSON.stringify({ event: 'request-error', code, error: String(error), cause: String(error?.cause || '') }));
  return json(payload, { status });
}

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function requireAnalysisDb(env) {
  if (!env?.ANALYSIS_DB) throw httpError(503, 'analysis-db-unavailable', 'ANALYSIS_DB binding is not configured');
  return env.ANALYSIS_DB;
}

async function readJsonWithLimit(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw httpError(413, 'body-too-large', `request body exceeds ${limit} bytes`);
  if (!request.body) throw httpError(400, 'missing-body', 'JSON request body is required');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw httpError(413, 'body-too-large', `request body exceeds ${limit} bytes`);
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw httpError(400, 'invalid-json', 'request body must contain valid JSON'); }
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function constantTimeSecretEqual(left, right) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  if (typeof crypto.subtle.timingSafeEqual === 'function') return crypto.subtle.timingSafeEqual(a, b);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index % a.length] ^ b[index % b.length]);
  return difference === 0;
}

async function requireBearerAuthorization(request, secret, disabledCode, disabledMessage) {
  if (typeof secret !== 'string' || !secret) throw httpError(503, disabledCode, disabledMessage);
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !(await constantTimeSecretEqual(match[1], secret))) throw httpError(401, 'unauthorized', 'valid bearer token is required');
}

async function requireBackfillAuthorization(request, env) {
  return requireBearerAuthorization(
    request,
    env?.BACKFILL_TOKEN,
    'import-disabled',
    'backfill import is disabled until BACKFILL_TOKEN is configured'
  );
}

async function requireAnalysisAdminAuthorization(request, env) {
  return requireBearerAuthorization(
    request,
    env?.ANALYSIS_ADMIN_TOKEN,
    'analysis-admin-disabled',
    'analysis admin API is disabled until ANALYSIS_ADMIN_TOKEN is configured'
  );
}

function factories(dependencies = {}) {
  return {
    modelRepository: dependencies.createModelRepository || createModelRepository,
    signalRiskRepository: dependencies.createSignalRiskRepository || createSignalRiskRepository,
    orchestrator: dependencies.createAnalysisOrchestrator || createAnalysisOrchestrator,
    cacheRepository: dependencies.createAnalysisCacheRepository || createAnalysisCacheRepository,
    cacheIdentity: dependencies.buildAnalysisCacheIdentity || buildAnalysisCacheIdentity,
    corpusLifecycleRepository: dependencies.createCorpusLifecycleRepository || createCorpusLifecycleRepository,
    trainingPreview: dependencies.previewPersistedSignalCalibrationTraining || previewPersistedSignalCalibrationTraining,
    trainingRun: dependencies.runPersistedSignalCalibrationTraining || runPersistedSignalCalibrationTraining,
    outcomeCurationRepository: dependencies.createOutcomeCurationRepository || createOutcomeCurationRepository,
    signalPromotionRepository: dependencies.createSignalPromotionRepository || createSignalPromotionRepository
  };
}

async function runAnalysisWithCache(body, db, factory) {
  const modelRepository = factory.modelRepository(db);
  const signalRiskRepository = factory.signalRiskRepository(db);
  const model = await modelRepository.getChampion();
  let signalCalibrationProfile = null;
  let signalCalibrationReadError = false;
  try {
    signalCalibrationProfile = await signalRiskRepository.getChampion();
  } catch (error) {
    signalCalibrationReadError = true;
    console.error(JSON.stringify({ event: 'signal-calibration-profile-read-failed', error: String(error) }));
  }

  const identity = await factory.cacheIdentity(body, model, ORCHESTRATION_VERSION, signalCalibrationProfile);
  const cache = factory.cacheRepository(db);
  let cacheReadError = false;
  if (!signalCalibrationReadError) {
    try {
      const hit = await cache.get(identity.cacheKey);
      if (hit) {
        return {
          analysis: hit.result,
          cache: {
            status: 'hit', cacheKey: identity.cacheKey, advisoryFingerprint: identity.advisoryFingerprint,
            modelVersion: model.modelVersion, signalProfileId: signalCalibrationProfile?.profileId ?? null,
            createdAt: hit.createdAt ?? null
          }
        };
      }
    } catch (error) {
      cacheReadError = true;
      console.error(JSON.stringify({ event: 'analysis-cache-read-failed', cacheKey: identity.cacheKey, error: String(error) }));
    }
  }

  const orchestrator = factory.orchestrator({ modelRepository, signalRiskRepository });
  const analysis = await orchestrator.run(body, { model, signalCalibrationProfile, signalCalibrationReadError });
  let status = signalCalibrationReadError ? 'bypass-signal-profile-read-error' : (cacheReadError ? 'bypass-read-error' : 'miss');
  if (!signalCalibrationReadError) {
    try {
      await cache.put(identity, analysis);
      status = cacheReadError ? 'bypass-read-error-stored' : 'miss-stored';
    } catch (error) {
      status = cacheReadError ? 'bypass-read-and-write-error' : 'miss-store-failed';
      console.error(JSON.stringify({ event: 'analysis-cache-write-failed', cacheKey: identity.cacheKey, error: String(error) }));
    }
  }
  return {
    analysis,
    cache: {
      status, cacheKey: identity.cacheKey, advisoryFingerprint: identity.advisoryFingerprint,
      modelVersion: model.modelVersion, signalProfileId: signalCalibrationProfile?.profileId ?? null, createdAt: null
    }
  };
}

async function route(request, env, dependencies) {
  const url = new URL(request.url);
  const factory = factories(dependencies);

  if (url.pathname === '/health' && request.method === 'GET') {
    return json({
      ok: true,
      service: SERVICE,
      analysisDbBound: Boolean(env?.ANALYSIS_DB),
      importEnabled: typeof env?.BACKFILL_TOKEN === 'string' && env.BACKFILL_TOKEN.length > 0,
      analysisAdminEnabled: typeof env?.ANALYSIS_ADMIN_TOKEN === 'string' && env.ANALYSIS_ADMIN_TOKEN.length > 0,
      deterministicAnalysisVersion: ORCHESTRATION_VERSION,
      analysisCacheVersion: CACHE_SCHEMA_VERSION,
      corpusLifecycleVersion: CORPUS_CAPTURE_VERSION,
      signalRiskCalibrationVersion: PROFILE_SCHEMA_VERSION,
      signalTrainingRunnerVersion: SIGNAL_TRAINING_RUNNER_VERSION,
      outcomeCurationVersion: OUTCOME_CURATION_VERSION,
      signalPromotionVersion: SIGNAL_PROMOTION_VERSION,
      workersAiEnabled: false,
      promotionApiEnabled: true,
      automaticPromotionEnabled: false,
      productionStormWorkerModified: false
    });
  }

  if (url.pathname === '/api/backfill/plan') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    return json(previewImportPlan(await readJsonWithLimit(request)));
  }

  if (url.pathname === '/api/backfill/import') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireBackfillAuthorization(request, env);
    const repository = createBackfillRepository(requireAnalysisDb(env));
    return json(await repository.importPlan(await readJsonWithLimit(request)));
  }

  if (url.pathname === '/api/corpus/capture/preview') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireBackfillAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.corpusLifecycleRepository(requireAnalysisDb(env));
    return json(await repository.previewCapture(body));
  }

  if (url.pathname === '/api/corpus/capture') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireBackfillAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.corpusLifecycleRepository(requireAnalysisDb(env));
    return json(await repository.capture(body));
  }

  if (url.pathname === '/api/admin/corpus/lifecycle/transition') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.corpusLifecycleRepository(requireAnalysisDb(env));
    return json({ ok: true, lifecycle: await repository.transitionWindow(body) });
  }

  if (url.pathname === '/api/admin/corpus/identity/bind') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.corpusLifecycleRepository(requireAnalysisDb(env));
    return json({ ok: true, identity: await repository.recordIdentityBinding(body) });
  }

  if (url.pathname === '/api/admin/corpus/identity/merge') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.corpusLifecycleRepository(requireAnalysisDb(env));
    return json({ ok: true, merge: await repository.recordStormMerge(body) });
  }

  if (url.pathname === '/api/admin/signal-training/preview') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    return json({ ok: true, preview: await factory.trainingPreview(requireAnalysisDb(env), body, dependencies.trainingDependencies || {}) });
  }

  if (url.pathname === '/api/admin/signal-training/run') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    return json({ ok: true, training: await factory.trainingRun(requireAnalysisDb(env), body, dependencies.trainingDependencies || {}) });
  }

  if (url.pathname === '/api/admin/signal-outcomes/curate') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.outcomeCurationRepository(requireAnalysisDb(env));
    return json({ ok: true, curation: await repository.curate(body) });
  }

  if (url.pathname === '/api/admin/signal-risk/promotion/preview') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.signalPromotionRepository(requireAnalysisDb(env));
    return json({ ok: true, preview: await repository.previewPromotion(body) });
  }

  if (url.pathname === '/api/admin/signal-risk/promote') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.signalPromotionRepository(requireAnalysisDb(env));
    return json({ ok: true, promotion: await repository.promote(body) });
  }

  if (url.pathname === '/api/admin/signal-risk/rollback/preview') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.signalPromotionRepository(requireAnalysisDb(env));
    return json({ ok: true, preview: await repository.previewRollback(body) });
  }

  if (url.pathname === '/api/admin/signal-risk/rollback') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const repository = factory.signalPromotionRepository(requireAnalysisDb(env));
    return json({ ok: true, rollback: await repository.rollback(body) });
  }

  if (url.pathname === '/api/models/champion') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'GET' } });
    const repository = factory.modelRepository(requireAnalysisDb(env));
    return json({ ok: true, model: await repository.getChampion(), readOnly: true });
  }

  if (url.pathname.startsWith('/api/models/')) {
    if (request.method !== 'GET') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'GET' } });
    const version = decodeURIComponent(url.pathname.slice('/api/models/'.length));
    if (!version) throw httpError(400, 'model-version-required', 'model version is required');
    const repository = factory.modelRepository(requireAnalysisDb(env));
    const model = await repository.getByVersion(version);
    if (!model) throw httpError(404, 'model-not-found', `model ${version} was not found`);
    return json({ ok: true, model, readOnly: true });
  }

  if (url.pathname === '/api/signal-risk/profiles/champion') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'GET' } });
    const repository = factory.signalRiskRepository(requireAnalysisDb(env));
    const profile = await repository.getChampion();
    return json({ ok: true, available: Boolean(profile), profile, readOnly: true });
  }

  if (url.pathname.startsWith('/api/signal-risk/profiles/')) {
    if (request.method !== 'GET') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'GET' } });
    const profileId = decodeURIComponent(url.pathname.slice('/api/signal-risk/profiles/'.length));
    if (!profileId) throw httpError(400, 'signal-profile-id-required', 'signal calibration profile id is required');
    const repository = factory.signalRiskRepository(requireAnalysisDb(env));
    const profile = await repository.getById(profileId);
    if (!profile) throw httpError(404, 'signal-profile-not-found', `signal calibration profile ${profileId} was not found`);
    return json({ ok: true, profile, readOnly: true });
  }

  if (url.pathname === '/api/analysis/run') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    const body = await readJsonWithLimit(request);
    const result = await runAnalysisWithCache(body, requireAnalysisDb(env), factory);
    return json({ ok: true, ...result });
  }

  return json({ ok: false, error: 'not-found' }, { status: 404 });
}

export async function handleRequest(request, env, dependencies = {}) {
  try { return await route(request, env, dependencies); }
  catch (error) { return errorResponse(error); }
}

export default { async fetch(request, env) { return handleRequest(request, env); } };
export {
  MAX_BODY_BYTES,
  constantTimeSecretEqual,
  readJsonWithLimit,
  runAnalysisWithCache,
  requireAnalysisAdminAuthorization
};
