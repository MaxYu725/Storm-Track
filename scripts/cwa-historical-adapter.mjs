import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ADAPTER_VERSION = 'cwa-historical-adapter/v1';
const CWA_HOST = 'rdc28.cwa.gov.tw';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isoMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : null;
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

export function htmlToText(html) {
  return decodeHtml(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s_()（）\-–—./]+/g, '');
}

export function parseCwaTyphoonDetailHtml(html, archiveUrl) {
  const text = htmlToText(html);
  const name = text.match(/名稱\s*([^\s(（]+)\s*[（(]\s*([^）)]+)\s*[）)]/);
  const typhoonId = text.match(/編號\s*(\d{6})/);
  const bulletinCount = text.match(/發布報數\s*(\d+)/);
  const warningBulletinSection = /颱風警報單/.test(text);
  const links = [];
  const seen = new Set();
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = hrefRe.exec(String(html || '')))) {
    try {
      const absolute = new URL(decodeHtml(match[1]), archiveUrl).toString();
      if (!seen.has(absolute) && /(warning|warn|typhoon|bulletin|\.pdf(?:$|[?#])|\.png(?:$|[?#])|\.jpe?g(?:$|[?#]))/i.test(absolute)) {
        seen.add(absolute);
        links.push(absolute);
      }
    } catch {
      // Ignore malformed links from unrelated page widgets.
    }
  }
  return {
    nameZh: name?.[1]?.trim() || null,
    nameEn: name?.[2]?.trim().toUpperCase() || null,
    archiveTyphoonId: typhoonId?.[1] || null,
    warningBulletinCount: bulletinCount ? Number(bulletinCount[1]) : null,
    warningBulletinSection,
    candidateLinks: links.slice(0, 50)
  };
}

export function validateHistoricalCaseManifest(manifest) {
  assert(manifest?.schemaVersion === 'historical-replay-case/v1', 'unsupported historical case schema');
  assert(typeof manifest.caseId === 'string' && manifest.caseId.length > 0, 'caseId is required');
  assert(manifest.retrospective === true, `${manifest.caseId}: retrospective must be true`);
  assert(manifest.truth?.authority === 'HKO', `${manifest.caseId}: current truth authority must be HKO`);
  assert(manifest.truth?.role === 'verification-only', `${manifest.caseId}: truth must remain verification-only`);
  assert(Array.isArray(manifest.truth?.signalLifecycle) && manifest.truth.signalLifecycle.length > 0, `${manifest.caseId}: signal lifecycle is required`);
  assert(manifest.safety?.truthMayNotBeUsedAsForecastInput === true, `${manifest.caseId}: truth/input separation guard missing`);
  assert(manifest.safety?.futureAdvisoryLeakageForbidden === true, `${manifest.caseId}: leakage guard missing`);
  assert(manifest.safety?.missingAgencyMayNotBeSubstituted === true, `${manifest.caseId}: agency independence guard missing`);
  assert(manifest.safety?.currentV1ModelFrozen === true, `${manifest.caseId}: frozen-v1 guard missing`);

  let previousEnd = null;
  for (const item of manifest.truth.signalLifecycle) {
    const issued = isoMs(item?.issuedAt);
    const ended = isoMs(item?.endedAt);
    assert(Number.isFinite(issued) && Number.isFinite(ended) && ended > issued, `${manifest.caseId}: invalid signal lifecycle timestamp`);
    assert(previousEnd == null || issued >= previousEnd, `${manifest.caseId}: signal lifecycle overlaps or moves backwards`);
    previousEnd = ended;
  }
  const cancelled = isoMs(manifest.truth.allSignalsCancelledAt);
  assert(Number.isFinite(cancelled) && cancelled >= previousEnd, `${manifest.caseId}: invalid all-signals-cancelled time`);

  const cwa = manifest.forecastSources?.CWA;
  assert(cwa?.role === 'forecast-input-candidate', `${manifest.caseId}: CWA forecast candidate missing`);
  assert(cwa?.asIssuedForecastExtraction === 'pending', `${manifest.caseId}: CWA extraction state must begin as pending`);
  const url = new URL(cwa.archiveUrl);
  assert(url.protocol === 'https:' && url.hostname === CWA_HOST, `${manifest.caseId}: CWA archive host is not allowed`);
  const queryId = url.searchParams.get('typhoon_id');
  assert(queryId === String(cwa.archiveTyphoonId), `${manifest.caseId}: CWA URL/id mismatch`);
  assert(String(manifest.identities?.CWA) === String(cwa.archiveTyphoonId), `${manifest.caseId}: CWA identity mismatch`);
  assert(Number.isInteger(Number(cwa.expectedWarningBulletinCount)) && Number(cwa.expectedWarningBulletinCount) > 0, `${manifest.caseId}: expected CWA warning bulletin count is required`);
  return manifest;
}

export async function fetchCwaArchiveIndex(manifest, options = {}) {
  validateHistoricalCaseManifest(manifest);
  const cwa = manifest.forecastSources.CWA;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15000));
  try {
    const response = await fetch(cwa.archiveUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Storm-Track historical replay source audit/1.0'
      }
    });
    assert(response.ok, `${manifest.caseId}: CWA archive returned HTTP ${response.status}`);
    const html = await response.text();
    const parsed = parseCwaTyphoonDetailHtml(html, cwa.archiveUrl);
    assert(parsed.archiveTyphoonId === String(cwa.archiveTyphoonId), `${manifest.caseId}: CWA archive typhoon id mismatch`);
    assert(normalizeName(parsed.nameEn) === normalizeName(manifest.storm.nameEn), `${manifest.caseId}: CWA English name mismatch`);
    assert(parsed.warningBulletinCount === Number(cwa.expectedWarningBulletinCount), `${manifest.caseId}: CWA bulletin count mismatch`);
    return {
      schemaVersion: ADAPTER_VERSION,
      caseId: manifest.caseId,
      fetchedAt: new Date().toISOString(),
      source: {
        agency: 'CWA',
        archiveUrl: cwa.archiveUrl,
        archiveTyphoonId: cwa.archiveTyphoonId,
        official: true
      },
      archive: parsed,
      readiness: {
        indexVerified: true,
        warningBulletinArchiveAdvertised: parsed.warningBulletinSection,
        staticCandidateLinkCount: parsed.candidateLinks.length,
        asIssuedForecastPointsExtracted: false,
        state: parsed.candidateLinks.length > 0
          ? 'candidate-bulletin-links-found'
          : (parsed.warningBulletinSection ? 'bulletin-links-dynamic-or-not-in-static-html' : 'warning-bulletin-section-not-visible')
      },
      semantics: {
        archiveIndexOnly: true,
        retrospective: true,
        truthUsedAsForecastInput: false,
        currentV1ModelModified: false
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

async function main() {
  const filePath = process.argv[2];
  assert(filePath, 'usage: node scripts/cwa-historical-adapter.mjs <historical-case.json>');
  const result = await fetchCwaArchiveIndex(readJson(filePath));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
