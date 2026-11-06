import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 15_000;
const MAX_METADATA_BYTES = 1_000_000;
const MAX_SOURCE_BYTES = 25_000_000;
const ACCOUNT_PATTERN = /^[a-f0-9]{32}$/i;
const SCRIPT_PATTERN = /^[a-z0-9_][a-z0-9_-]{0,127}$/i;
const ID_PATTERN = /^[a-f0-9-]{36}$/i;

function validateTarget(accountId, scriptName) {
  if (!ACCOUNT_PATTERN.test(accountId || '')) throw new Error('Invalid Cloudflare account ID');
  if (!SCRIPT_PATTERN.test(scriptName || '')) throw new Error('Invalid exact Worker script name');
}
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function activeVersions(latest) {
  if (!latest || typeof latest.id !== 'string' || !Array.isArray(latest.versions)) {
    throw new Error('Missing authoritative deployment metadata');
  }
  const versions = latest.versions.map(v => ({
    versionId: v.version_id,
    percentage: v.percentage
  }));
  if (!versions.length || versions.length > 5 || versions.some(v =>
    !ID_PATTERN.test(v.versionId || '') ||
    typeof v.percentage !== 'number' || !(v.percentage > 0 && v.percentage <= 100)
  )) throw new Error('Deployment versions invalid or outside bounded review');
  if (Math.abs(versions.reduce((s, v) => s + v.percentage, 0) - 100) > 0.01) {
    throw new Error('Active deployment traffic percentage is not 100');
  }
  return versions;
}

async function collectProvenance({
  accountId, scriptName, token, fetchImpl = fetch, persist = persistEvidence
}) {
  validateTarget(accountId, scriptName);
  if (typeof token !== 'string' || !token.trim()) throw new Error('Read-only API token required');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl required');
  const base = API + '/accounts/' + accountId + '/workers/scripts/' + encodeURIComponent(scriptName);
  let requestCount = 0;
  async function get(path, maxBytes) {
    requestCount += 1;
    const res = await fetchImpl(base + path, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) throw new Error('Cloudflare read-only GET failed with HTTP ' + res.status);
    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error('Cloudflare response exceeds bounded size');
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('Cloudflare response exceeds bounded size');
    return { bytes, type: res.headers.get('content-type') || 'unknown' };
  }
  async function getJson(path) {
    const { bytes } = await get(path, MAX_METADATA_BYTES);
    let data;
    try { data = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('Cloudflare metadata response is not JSON'); }
    if (!data || data.success !== true || !data.result) {
      throw new Error('Cloudflare metadata request did not succeed');
    }
    return data.result;
  }
  const first = await getJson('/deployments?per_page=1');
  if (!Array.isArray(first.deployments) || !first.deployments.length) {
    throw new Error('No active Worker deployment returned');
  }
  const latest = first.deployments[0];
  const versions = activeVersions(latest);
  const versionMetadata = [];
  for (const v of versions) {
    const detail = await getJson('/versions/' + encodeURIComponent(v.versionId));
    if (detail.id !== v.versionId) throw new Error('Worker version ID mismatch');
    versionMetadata.push({
      versionId: v.versionId,
      percentage: v.percentage,
      scriptEtag: typeof detail.resources?.script?.etag === 'string'
        ? detail.resources.script.etag : null,
      versionNumber: Number.isSafeInteger(detail.number) ? detail.number : null
    });
  }
  const source = await get('/content/v2', MAX_SOURCE_BYTES);
  const last = await getJson('/deployments?per_page=1');
  if (!Array.isArray(last.deployments) || !last.deployments.length) {
    throw new Error('Deployment changed during provenance capture');
  }
  const latestAgain = last.deployments[0];
  if (latest.id !== latestAgain.id ||
    JSON.stringify(versions) !== JSON.stringify(activeVersions(latestAgain))) {
    throw new Error('Deployment changed during capture; discard export and retry');
  }
  const evidence = {
    contract: 'storm-web04b-worker-provenance/v1',
    recordedAt: new Date().toISOString(),
    accountIdSha256Prefix: digest(Buffer.from(accountId)).slice(0, 16),
    scriptName,
    deploymentId: latest.id,
    deploymentCreatedOn: latest.created_on || null,
    versions: versionMetadata,
    capturedScriptContent: {
      endpoint: '/content/v2',
      sha256: digest(source.bytes),
      bytes: source.bytes.length,
      contentType: source.type
    },
    deployedVersionSourceMatch: 'NOT_VERIFIED',
    releaseGate: 'BLOCKED_UNTIL_SOURCE_VERSION_MATCH_CONFIRMED',
    requests: requestCount,
    methods: ['GET']
  };
  const outputDirectory = await persist(source.bytes, evidence);
  return { ...evidence, localEvidenceDirectory: outputDirectory };
}

async function persistEvidence(sourceBytes, manifest) {
  // The OS temp directory, not the Git checkout, prevents accidental commits.
  const dir = await mkdtemp(join(tmpdir(), 'storm-web04b-private-'));
  await writeFile(join(dir, 'worker-content.private.bin'), sourceBytes, { mode: 0o600, flag: 'wx' });
  await writeFile(join(dir, 'provenance.private.json'), JSON.stringify(manifest, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' });
  return dir;
}
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--account-id' && args[i + 1]) options.accountId = args[++i];
    else if (args[i] === '--script-name' && args[i + 1]) options.scriptName = args[++i];
    else throw new Error('Usage: node scripts/audit-web04b-worker-provenance.mjs --account-id ID --script-name EXACT_NAME');
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await collectProvenance({
      ...parseArgs(process.argv.slice(2)),
      token: process.env.CLOUDFLARE_API_TOKEN
    });
    console.log(JSON.stringify(result, null, 2));
    console.log('PRIVATE SOURCE: do not commit or share until reviewed for secrets.');
    console.log('Version/source match remains UNVERIFIED. No deployment has occurred.');
  } catch (error) {
    console.error('WEB-04B-3 provenance capture blocked:', error.message);
    process.exitCode = 1;
  }
}

export { collectProvenance, parseArgs, activeVersions, validateTarget };
