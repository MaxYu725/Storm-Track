import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const RECORDER_VERSION = 'beta-prospective-recorder/v2';
const DEFAULT_URL = 'https://maxyu725.github.io/Storm-Track/?beta=hk-signal';
const targetUrl = process.env.STORM_BETA_URL || DEFAULT_URL;
const sourceCommit = process.env.SOURCE_COMMIT || null;
const settleTimeoutMs = Number(process.env.SETTLE_TIMEOUT_MS || 90000);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value)).digest('hex');
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('which', [command], { encoding: 'utf8' }).trim();
      if (found) return found;
    } catch {}
  }
  throw new Error('No system Chrome/Chromium executable found');
}

function finalizeObservation(input) {
  const observation = structuredClone(input);
  for (const source of Object.values(observation?.sources || {})) {
    const rawInput = source?.rawInput ?? null;
    source.inputSha256 = sha256(rawInput);
    delete source.rawInput;
  }
  return observation;
}

function fingerprintBasis(record) {
  return {
    sourceStates: record.sourceStates.map(item => ({
      agency: item.agency,
      state: item.state,
      message: item.message
    })),
    visibleGroupKeys: record.visibleGroupKeys,
    observations: record.observations.map(item => {
      const copy = structuredClone(item);
      delete copy.observedAt;
      return copy;
    })
  };
}

const executablePath = findChrome();
console.error(`RECORDER_CHROME=${executablePath}`);
console.error(`RECORDER_TARGET=${targetUrl}`);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => console.error(`PAGE_ERROR ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') console.error(`PAGE_CONSOLE_ERROR ${message.text()}`);
  });

  const url = new URL(targetUrl);
  url.searchParams.set('beta', 'hk-signal');
  url.searchParams.set('recorderRun', String(Date.now()));

  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: settleTimeoutMs });
  await page.waitForFunction(() => {
    const badges = ['hko', 'cma', 'jma', 'cwa'].map(code => document.getElementById(`badge-${code}`));
    const allPresent = badges.every(Boolean);
    const allSettled = allPresent && badges.every(badge => !badge.classList.contains('loading'));
    const progress = document.getElementById('top-progress-bar');
    return allSettled && (!progress || progress.classList.contains('hidden'));
  }, null, { timeout: settleTimeoutMs });

  // Let the final synchronous rebuild/render complete and avoid sampling mid-layout.
  await page.waitForTimeout(750);

  const pagePayload = await page.evaluate(() => {
    const stateNames = ['ok', 'empty', 'error', 'stale', 'loading'];
    const sourceStates = ['HKO', 'CMA', 'JMA', 'CWA'].map(agency => {
      const badge = document.getElementById(`badge-${agency.toLowerCase()}`);
      const state = stateNames.find(name => badge?.classList.contains(name)) || 'unknown';
      const title = String(badge?.title || '');
      return {
        agency,
        state,
        message: title.replace(/\s*·\s*最後檢查.*$/u, '').trim() || null
      };
    });
    const visibleGroupKeys = [...document.querySelectorAll('#active-storms-container .panel-storm-card[data-storm-key]')]
      .map(card => String(card.dataset.stormKey || ''))
      .filter(Boolean)
      .sort();
    const visibleKeySet = new Set(visibleGroupKeys);
    const ui = globalThis.StormHkThreatUi;
    const allObservations = typeof ui?.readProspectiveObservations === 'function'
      ? ui.readProspectiveObservations()
      : [];
    const observations = allObservations.filter(item => visibleKeySet.has(String(item?.group?.key || '')));
    const discardedStaleObservationKeys = allObservations
      .map(item => String(item?.group?.key || ''))
      .filter(key => key && !visibleKeySet.has(key))
      .sort();
    return {
      capturedAt: new Date().toISOString(),
      pageTitle: document.title,
      betaEnabled: ui?.isBetaEnabled?.() === true,
      prospectiveSchemaVersion: ui?.PROSPECTIVE_SCHEMA_VERSION ?? null,
      observationApiAvailable: typeof ui?.readProspectiveObservations === 'function',
      sourceStates,
      visibleGroupKeys,
      discardedStaleObservationKeys,
      observations
    };
  });

  if (!pagePayload.betaEnabled) throw new Error('HK signal Beta gate is not enabled');
  if (!pagePayload.observationApiAvailable) throw new Error('Prospective observation API is unavailable in the loaded frontend');
  if (pagePayload.prospectiveSchemaVersion !== 'hk-beta-prospective-observation/v1') {
    throw new Error(`Unexpected prospective schema: ${pagePayload.prospectiveSchemaVersion}`);
  }
  if (pagePayload.observations.length !== pagePayload.visibleGroupKeys.length) {
    throw new Error(`Final UI/observation mismatch: ${pagePayload.visibleGroupKeys.length} visible groups but ${pagePayload.observations.length} observations`);
  }

  const observations = pagePayload.observations.map(finalizeObservation);
  const record = {
    schemaVersion: RECORDER_VERSION,
    capturedAt: pagePayload.capturedAt,
    targetUrl: `${url.origin}${url.pathname}?beta=hk-signal`,
    sourceCommit,
    pageTitle: pagePayload.pageTitle,
    prospectiveSchemaVersion: pagePayload.prospectiveSchemaVersion,
    sourceStates: pagePayload.sourceStates,
    visibleGroupKeys: pagePayload.visibleGroupKeys,
    discardedStaleObservationKeys: pagePayload.discardedStaleObservationKeys,
    observationCount: observations.length,
    observations
  };
  record.captureFingerprint = sha256(fingerprintBasis(record));

  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
} finally {
  await browser.close();
}
