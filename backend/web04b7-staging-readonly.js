/*
 * WEB-04B-7D REVIEW-ONLY staging entry. Do not deploy without separate
 * owner authorization, verified disposable D1 UUID and private config.
 * This module does not export scheduled(), and never exposes collector,
 * proxy, probe or admin routes. This is a traffic/handler guard, NOT
 * proof that DB is bound to a nonproduction Cloudflare instance.
 */
import productionCandidate from './worker.js';

const STAGING_MODE = 'storm-web04b7d-synthetic-readonly';
const REQUIRED_BINDINGS = ['DB', 'STAGING_REVIEW_MODE'];
const HISTORY_PATH = /^\/api\/history\/storms\/[^/]+\/advisories$/;

function stageReady(env) {
  if (!env || typeof env !== 'object') return false;
  const keys = Object.keys(env).sort();
  if (keys.join(',') !== REQUIRED_BINDINGS.slice().sort().join(',')) return false;
  return env.STAGING_REVIEW_MODE === STAGING_MODE &&
    typeof env.DB?.prepare === 'function';
}
function response(code, error) {
  return new Response(JSON.stringify({ok: false, error}), {
    status: code, headers: {'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'}
  });
}
export default {
  async fetch(request, env, ctx) {
    // Deny every unverified binding configuration before reading D1.
    if (!stageReady(env)) return response(503, 'Staging isolation is not verified');
    if (request.method !== 'GET') return response(405, 'Read-only staging endpoint');
    let path;
    try { path = new URL(request.url).pathname; }
    catch { return response(400, 'Invalid request URL'); }
    if (path === '/__staging__/health') {
      return new Response(JSON.stringify({ok: true, stage: 'synthetic-readonly'}),
        {headers: {'content-type': 'application/json; charset=utf-8',
          'cache-control':'no-store'}});
    }
    if (!HISTORY_PATH.test(path)) return response(404, 'Route not enabled in staging');
    // The reviewed candidate's advisory GET path issues SELECT only.
    // No other candidate route (including admin/proxies) is reachable.
    return productionCandidate.fetch(request, env, ctx);
  }
};
