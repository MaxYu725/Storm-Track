import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const targetUrl = process.env.CONSENSUS_BETA_URL || 'http://127.0.0.1:4173/consensus.html';
const timeoutMs = Number(process.env.SETTLE_TIMEOUT_MS || 90000);
const screenshotPath = process.env.CONSENSUS_SCREENSHOT || '/tmp/consensus-track-beta.png';

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

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error(`PAGE_ERROR ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') console.error(`PAGE_CONSOLE_ERROR ${message.text()}`);
  });

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForFunction(() => {
    const frame = document.getElementById('storm-consensus-frame');
    return Boolean(frame?.contentWindow?.document?.getElementById('storm-map'));
  }, null, { timeout: timeoutMs });

  const child = page.frames().find(frame => frame.url().includes('beta=hk-signal') && frame.url().includes('consensusTrack=1'));
  if (!child) throw new Error('Storm Track Beta iframe not found');

  await child.waitForFunction(() => {
    const badges = ['hko', 'cma', 'jma', 'cwa'].map(code => document.getElementById(`badge-${code}`));
    const settled = badges.every(badge => badge && !badge.classList.contains('loading'));
    const progress = document.getElementById('top-progress-bar');
    return settled && (!progress || progress.classList.contains('hidden'));
  }, null, { timeout: timeoutMs });

  await child.waitForFunction(() => {
    const controller = globalThis.StormTrackRuntime?.consensusTrackController;
    const state = controller?.getState?.();
    return state?.enabled === true && state.trackCount > 0 && state.pointCount > 0 && state.segmentCount > 0;
  }, null, { timeout: timeoutMs });

  const result = await child.evaluate(() => {
    const controller = globalThis.StormTrackRuntime?.consensusTrackController;
    const state = controller?.getState?.() || null;
    const hud = document.querySelector('.storm-consensus-track-hud');
    const pane = globalThis.StormTrackRuntime?.map?.getPane?.('stormConsensusTrackPane');
    const sourceStates = ['HKO', 'CMA', 'JMA', 'CWA'].map(agency => {
      const badge = document.getElementById(`badge-${agency.toLowerCase()}`);
      return {
        agency,
        state: ['ok', 'empty', 'error', 'stale', 'loading'].find(name => badge?.classList.contains(name)) || 'unknown'
      };
    });
    return {
      state,
      hudVisible: Boolean(hud && getComputedStyle(hud).display !== 'none'),
      hudText: hud?.textContent?.replace(/\s+/g, ' ').trim() || null,
      paneInstalled: Boolean(pane),
      sourceStates,
      semantics: {
        displayOnly: true,
        officialAgencyLayersModified: false,
        hkSignalInputsModified: false,
        probabilityCalibrated: false
      }
    };
  });

  await page.screenshot({ path: screenshotPath, fullPage: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
