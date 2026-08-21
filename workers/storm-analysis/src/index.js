import { createBackfillRepository, previewImportPlan } from './backfill-repository.js';
import { createModelRepository } from './model-repository.js';
import { createAnalysisOrchestrator } from './analysis-orchestrator.js';

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

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
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
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index % a.length] ^ b[index % b.length]);
  return difference === 0;
}

async function requireBackfillAuthorization(request, env) {
  const secret = typeof env?.BACKFILL_TOKEN === 'string' ? env.BACKFILL_TOKEN : '';
  if (!secret) throw httpError(503, 'import-disabled', 'backfill import is disabled until BACKFILL_TOKEN is configured');
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !(await constantTimeSecretEqual(match[1], secret))) throw httpError(401, 'unauthorized', 'valid bearer token is required');
}

function factories(dependencies = {}) {
  return {
    modelRepository: dependencies.createModelRepository || createModelRepository,
    orchestrator: dependencies.createAnalysisOrchestrator || createAnalysisOrchestrator
  };
}

async function route(request, env, dependencies) {
  const url = new URL(request.url);
  const factory = factories(dependencies);

  if (url.pathname === '/health' && request.method === 'GET') {
    return json({ ok: true, service: SERVICE, analysisDbBound: Boolean(env?.ANALYSIS_DB), importEnabled: typeof env?.BACKFILL_TOKEN === 'string' && env.BACKFILL_TOKEN.length > 0, deterministicAnalysisVersion: 'storm-analysis-orchestration/v1', workersAiEnabled: false, productionStormWorkerModified: false });
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

  if (url.pathname === '/api/analysis/run') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    const repository = factory.modelRepository(requireAnalysisDb(env));
    const orchestrator = factory.orchestrator({ modelRepository: repository });
    return json({ ok: true, analysis: await orchestrator.run(await readJsonWithLimit(request)) });
  }

  return json({ ok: false, error: 'not-found' }, { status: 404 });
}

export async function handleRequest(request, env, dependencies = {}) {
  try { return await route(request, env, dependencies); }
  catch (error) { return errorResponse(error); }
}

export default { async fetch(request, env) { return handleRequest(request, env); } };
export { MAX_BODY_BYTES, constantTimeSecretEqual, readJsonWithLimit };
