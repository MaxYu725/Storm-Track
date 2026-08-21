import { createBackfillRepository, previewImportPlan } from './backfill-repository.js';

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

async function readJsonWithLimit(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    const error = new Error(`request body exceeds ${limit} bytes`);
    error.status = 413;
    error.code = 'body-too-large';
    throw error;
  }
  if (!request.body) {
    const error = new Error('JSON request body is required');
    error.status = 400;
    error.code = 'missing-body';
    throw error;
  }

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        const error = new Error(`request body exceeds ${limit} bytes`);
        error.status = 413;
        error.code = 'body-too-large';
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    const error = new Error('request body must contain valid JSON');
    error.status = 400;
    error.code = 'invalid-json';
    throw error;
  }
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
  if (!secret) {
    const error = new Error('backfill import is disabled until BACKFILL_TOKEN is configured');
    error.status = 503;
    error.code = 'import-disabled';
    throw error;
  }
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || !(await constantTimeSecretEqual(match[1], secret))) {
    const error = new Error('valid bearer token is required');
    error.status = 401;
    error.code = 'unauthorized';
    throw error;
  }
}

async function route(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/health' && request.method === 'GET') {
    return json({
      ok: true,
      service: SERVICE,
      analysisDbBound: Boolean(env?.ANALYSIS_DB),
      importEnabled: typeof env?.BACKFILL_TOKEN === 'string' && env.BACKFILL_TOKEN.length > 0,
      productionStormWorkerModified: false
    });
  }

  if (url.pathname === '/api/backfill/plan') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    const body = await readJsonWithLimit(request);
    return json(previewImportPlan(body));
  }

  if (url.pathname === '/api/backfill/import') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, { status: 405, headers: { allow: 'POST' } });
    await requireBackfillAuthorization(request, env);
    if (!env?.ANALYSIS_DB) {
      const error = new Error('ANALYSIS_DB binding is not configured');
      error.status = 503;
      error.code = 'analysis-db-unavailable';
      throw error;
    }
    const body = await readJsonWithLimit(request);
    const repository = createBackfillRepository(env.ANALYSIS_DB);
    return json(await repository.importPlan(body));
  }

  return json({ ok: false, error: 'not-found' }, { status: 404 });
}

export async function handleRequest(request, env) {
  try {
    return await route(request, env);
  } catch (error) {
    return errorResponse(error);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

export { MAX_BODY_BYTES, constantTimeSecretEqual, readJsonWithLimit };
