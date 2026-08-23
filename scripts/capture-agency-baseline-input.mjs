import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const CAPTURE_VERSION = 'storm-agency-baseline-capture/v0';
const DEFAULT_URL = 'https://maxyu725.github.io/Storm-Track/?beta=hk-signal';
const targetUrl = process.env.STORM_BETA_URL || DEFAULT_URL;
const settleTimeoutMs = Number(process.env.SETTLE_TIMEOUT_MS || 90000);

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

const executablePath = findChrome();
console.error(`AGENCY_BASELINE_CHROME=${executablePath}`);
console.error(`AGENCY_BASELINE_TARGET=${targetUrl}`);

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
  url.searchParams.set('agencyBaselineCapture', String(Date.now()));

  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: settleTimeoutMs });
  await page.waitForFunction(() => {
    const badges = ['hko', 'cma', 'jma', 'cwa'].map(code => document.getElementById(`badge-${code}`));
    const allPresent = badges.every(Boolean);
    const allSettled = allPresent && badges.every(badge => !badge.classList.contains('loading'));
    const progress = document.getElementById('top-progress-bar');
    return allSettled && (!progress || progress.classList.contains('hidden'));
  }, null, { timeout: settleTimeoutMs });
  await page.waitForTimeout(750);

  const result = await page.evaluate(captureVersion => {
    const stateNames = ['ok', 'empty', 'error', 'stale', 'loading'];
    const sourceStates = ['HKO', 'CMA', 'JMA', 'CWA'].map(agency => {
      const badge = document.getElementById(`badge-${agency.toLowerCase()}`);
      return {
        agency,
        state: stateNames.find(name => badge?.classList.contains(name)) || 'unknown'
      };
    });

    const visibleGroupKeys = [...document.querySelectorAll('#active-storms-container .panel-storm-card[data-storm-key]')]
      .map(card => String(card.dataset.stormKey || ''))
      .filter(Boolean)
      .sort();
    const visibleKeySet = new Set(visibleGroupKeys);
    const ui = globalThis.StormHkThreatUi;
    if (typeof ui?.readProspectiveObservations !== 'function') {
      throw new Error('Prospective observation API unavailable');
    }

    const point = value => value && typeof value === 'object' ? {
      kind: value.kind ?? null,
      time: value.time ?? null,
      baseTime: value.baseTime ?? null,
      forecastHour: value.forecastHour ?? null,
      lat: value.lat ?? null,
      lon: value.lon ?? null
    } : null;

    const observations = ui.readProspectiveObservations()
      .filter(item => visibleKeySet.has(String(item?.group?.key || '')));

    const groups = observations.map(observation => {
      const sources = {};
      const missingRawInputAgencies = [];
      for (const [agency, source] of Object.entries(observation?.sources || {}).sort(([a], [b]) => a.localeCompare(b))) {
        const raw = source?.rawInput;
        if (!raw || typeof raw !== 'object') {
          missingRawInputAgencies.push(agency);
          continue;
        }
        sources[agency] = {
          agency,
          sourceId: source?.sourceId ?? raw?.sourceId ?? null,
          bulletinTime: source?.bulletinTime ?? raw?.bulletinTime ?? null,
          positions: (Array.isArray(raw?.positions) ? raw.positions : []).map(point).filter(Boolean),
          forecast: (Array.isArray(raw?.forecast) ? raw.forecast : []).map(point).filter(Boolean)
        };
      }

      return {
        key: observation?.group?.key ?? null,
        displayName: observation?.group?.displayName ?? null,
        nameTc: observation?.group?.nameTc ?? null,
        nameEn: observation?.group?.nameEn ?? null,
        sourceAgencies: observation?.sourceAgencies || [],
        missingRawInputAgencies,
        sources
      };
    });

    return {
      schemaVersion: captureVersion,
      capturedAt: new Date().toISOString(),
      pageTitle: document.title,
      sourceStates,
      visibleGroupKeys,
      groupCount: groups.length,
      groups,
      semantics: {
        temporaryCaptureOnly: true,
        verificationTruthRead: false,
        forecastSkillEvaluated: false,
        productionDatabaseWritten: false
      }
    };
  }, CAPTURE_VERSION);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
