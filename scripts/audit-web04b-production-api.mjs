import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import cursorApi from '../analysis/archive-advisory-cursor.js';

const DEFAULT_ORIGIN = 'https://storm.max-yu.workers.dev';
const MAX_RESPONSE_CHARS = 2_000_000;
const TIMEOUT_MS = 10_000;
const LIMIT = 2;

function safeOrigin(input) {
  const url = new URL(String(input));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Audit base must be an HTTPS origin without credentials, paths or query');
  }
  return url.origin;
}

async function getJson(base, path, fetchImpl) {
  const url = new URL(path, base);
  const res = await fetchImpl(url.toString(), {
    method: 'GET', headers: {Accept: 'application/json'},
    redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) throw new Error('Read-only history API returned HTTP ' + res.status);
  const text = await res.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new Error('Read-only response exceeded bounded audit size');
  try { return JSON.parse(text); }
  catch { throw new Error('Read-only history API response is not JSON'); }
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

async function probeArchiveAdvisoryApi({base = DEFAULT_ORIGIN, stormId = null, fetchImpl = fetch} = {}) {
  const origin = safeOrigin(base);
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function');
  let chosenId = stormId;
  let reportedCount = null;
  if (!chosenId) {
    const listing = await getJson(origin, '/api/history/storms?limit=30&offset=0', fetchImpl);
    if (!Array.isArray(listing.storms)) throw new Error('Storm listing API lacks storms array');
    const candidates = listing.storms.filter(item => typeof item?.id === 'string' && item.id.trim())
      .sort((a, b) => Number(b.advisory_count || 0) - Number(a.advisory_count || 0));
    if (!candidates.length) {
      return {mode:'read-only',apiOrigin:origin,outcome:'no-storm-records',requests:1};
    }
    chosenId = candidates[0].id;
    reportedCount = Number.isFinite(Number(candidates[0].advisory_count))
      ? Number(candidates[0].advisory_count) : null;
  }
  if (typeof chosenId !== 'string' || !chosenId.trim()) throw new Error('A storm ID is required');
  const path = '/api/history/storms/' + encodeURIComponent(chosenId) + '/advisories';
  const firstData = await getJson(origin, path + '?paging=cursor&limit=' + LIMIT, fetchImpl);
  const first = cursorApi.appendAdvisoryPage([], firstData, {stormId:chosenId,limit:LIMIT});
  const summary = {
    mode:'read-only',
    apiOrigin:origin,
    stormIdSha256Prefix:fingerprint(chosenId),
    reportedCount,
    firstPageCount:first.advisories.length,
    contract:cursorApi.CONTRACT,
    cursorSupported:first.supported,
    requests: stormId ? 1 : 2,
    outcome:first.supported ? 'cursor-contract-first-page-verified' : 'legacy-no-cursor-contract'
  };
  if (!first.supported || !first.hasMore) return summary;

  const secondData = await getJson(origin,
    path + '?paging=cursor&limit=' + LIMIT + '&cursor=' + encodeURIComponent(first.nextCursor), fetchImpl);
  const second = cursorApi.appendAdvisoryPage(first.advisories, secondData, {
    stormId:chosenId,limit:LIMIT,cursor:first.nextCursor,seenCursors:first.seenCursors
  });
  summary.requests += 1;
  summary.secondPageCount = second.advisories.length - first.advisories.length;
  summary.distinctRecordsVerified = second.advisories.length;
  summary.hasFurtherPages = second.hasMore;
  summary.outcome = 'cursor-contract-two-pages-verified';
  return summary;
}

function parseArgs(argv) {
  const options = {};
  for (let i=0; i<argv.length; i+=1) {
    if (argv[i] === '--base' && argv[i+1]) options.base = argv[++i];
    else if (argv[i] === '--storm-id' && argv[i+1]) options.stormId = argv[++i];
    else throw new Error('Usage: node scripts/audit-web04b-production-api.mjs [--storm-id ID] [--base HTTPS_ORIGIN]');
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await probeArchiveAdvisoryApi(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({mode:'read-only',outcome:'audit-inconclusive',reason:error.message}));
    process.exitCode = 1;
  }
}

export {probeArchiveAdvisoryApi, parseArgs, safeOrigin};
