import { handleRequest, readJsonWithLimit, requireAnalysisAdminAuthorization } from './index-base.js';
import {
  createTruthAugmentationRepository,
  TRUTH_AUGMENTATION_REPOSITORY_VERSION
} from './truth-augmentation-repository.js';

function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

function httpError(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function errorResponse(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || 'internal-error';
  const payload = {
    ok: false,
    error: code,
    message: status >= 500 ? 'Internal server error' : String(error?.message || code)
  };
  if (status < 500 && error?.details !== undefined) payload.details = error.details;
  if (status >= 500) console.error(JSON.stringify({ event: 'ai23-request-error', code, error: String(error), cause: String(error?.cause || '') }));
  return json(payload, { status });
}

function requireAnalysisDb(env) {
  if (!env?.ANALYSIS_DB) throw httpError(503, 'analysis-db-unavailable', 'ANALYSIS_DB binding is not configured');
  return env.ANALYSIS_DB;
}

async function routeAi23(request, env, dependencies = {}) {
  const url = new URL(request.url);

  if (url.pathname === '/health' && request.method === 'GET') {
    const base = await handleRequest(request, env, dependencies);
    if (!base.ok) return base;
    const body = await base.json();
    return json({ ...body, truthAugmentationVersion: TRUTH_AUGMENTATION_REPOSITORY_VERSION });
  }

  const truthPreview = url.pathname === '/api/admin/truth/augmentation/preview';
  const truthImport = url.pathname === '/api/admin/truth/augmentation/import';
  if (truthPreview || truthImport) {
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    }
    await requireAnalysisAdminAuthorization(request, env);
    const body = await readJsonWithLimit(request);
    const factory = dependencies.createTruthAugmentationRepository || createTruthAugmentationRepository;
    const repository = factory(requireAnalysisDb(env), dependencies.truthAugmentationDependencies || {});
    if (truthPreview) return json({ ok: true, preview: await repository.preview(body) });
    return json({ ok: true, augmentation: await repository.import(body) });
  }

  return handleRequest(request, env, dependencies);
}

export async function handleAi23Request(request, env, dependencies = {}) {
  try {
    return await routeAi23(request, env, dependencies);
  } catch (error) {
    return errorResponse(error);
  }
}

export default {
  async fetch(request, env) {
    return handleAi23Request(request, env);
  }
};

export { TRUTH_AUGMENTATION_REPOSITORY_VERSION };
