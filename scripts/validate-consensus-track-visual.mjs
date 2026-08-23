import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const targetUrl = process.env.CONSENSUS_BETA_URL || 'http://127.0.0.1:4173/?beta=hk-signal';
const timeoutMs = Number(process.env.SETTLE_TIMEOUT_MS || 90000);
const screenshotPath = process.env.CONSENSUS_SCREENSHOT || '/tmp/consensus-track-beta.png';
const mobileScreenshotPath = process.env.CONSENSUS_MOBILE_SCREENSHOT || '/tmp/consensus-track-beta-mobile.png';
const storageKey = 'storm-track-consensus-track-beta-enabled-v1';

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

  await page.addInitScript(key => {
    try { localStorage.removeItem(key); } catch {}
  }, storageKey);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

  await page.waitForFunction(() => {
    const toggle = document.getElementById('toggle-consensus-track-beta');
    return Boolean(toggle && globalThis.StormConsensusTrackOverlay?.setEnabled && globalThis.StormTrackRuntime?.map);
  }, null, { timeout: timeoutMs });

  const defaultOff = await page.evaluate(key => {
    const toggle = document.getElementById('toggle-consensus-track-beta');
    const controller = globalThis.StormTrackRuntime?.consensusTrackController || null;
    return {
      toggleChecked: toggle?.checked === true,
      apiEnabled: globalThis.StormConsensusTrackOverlay?.getEnabled?.() === true,
      controllerPresent: Boolean(controller),
      hudPresent: Boolean(document.querySelector('.storm-consensus-track-hud')),
      storedValue: localStorage.getItem(key)
    };
  }, storageKey);

  if (defaultOff.toggleChecked || defaultOff.apiEnabled || defaultOff.controllerPresent || defaultOff.hudPresent) {
    throw new Error(`Consensus Track Beta did not default OFF: ${JSON.stringify(defaultOff)}`);
  }

  await page.waitForFunction(() => {
    const badges = ['hko', 'cma', 'jma', 'cwa'].map(code => document.getElementById(`badge-${code}`));
    const settled = badges.every(badge => badge && !badge.classList.contains('loading'));
    const progress = document.getElementById('top-progress-bar');
    return settled && (!progress || progress.classList.contains('hidden'));
  }, null, { timeout: timeoutMs });

  await page.evaluate(() => {
    const toggle = document.getElementById('toggle-consensus-track-beta');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.waitForFunction(() => {
    const controller = globalThis.StormTrackRuntime?.consensusTrackController;
    const state = controller?.getState?.();
    return state?.enabled === true && state.trackCount > 0 && state.pointCount > 0 && state.segmentCount > 0;
  }, null, { timeout: timeoutMs });

  const enabled = await page.evaluate(key => {
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
      toggleChecked: document.getElementById('toggle-consensus-track-beta')?.checked === true,
      apiEnabled: globalThis.StormConsensusTrackOverlay?.getEnabled?.() === true,
      storedValue: localStorage.getItem(key),
      state,
      hudVisible: Boolean(hud && getComputedStyle(hud).display !== 'none'),
      hudText: hud?.textContent?.replace(/\s+/g, ' ').trim() || null,
      paneInstalled: Boolean(pane),
      sourceStates
    };
  }, storageKey);

  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.evaluate(() => {
    const toggle = document.getElementById('toggle-consensus-track-beta');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await page.waitForFunction(() => {
    const toggle = document.getElementById('toggle-consensus-track-beta');
    return toggle?.checked === false
      && globalThis.StormConsensusTrackOverlay?.getEnabled?.() === false
      && !globalThis.StormTrackRuntime?.consensusTrackController
      && !document.querySelector('.storm-consensus-track-hud');
  }, null, { timeout: 15000 });

  const disabled = await page.evaluate(key => ({
    toggleChecked: document.getElementById('toggle-consensus-track-beta')?.checked === true,
    apiEnabled: globalThis.StormConsensusTrackOverlay?.getEnabled?.() === true,
    controllerPresent: Boolean(globalThis.StormTrackRuntime?.consensusTrackController),
    hudPresent: Boolean(document.querySelector('.storm-consensus-track-hud')),
    storedValue: localStorage.getItem(key)
  }), storageKey);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.metro-fab[aria-label*="設定"]').click();
  await page.waitForFunction(() => document.getElementById('storm-panel')?.classList.contains('open') === true);
  const betaSummary = page.locator('#settings-section-beta > summary');
  if (!(await page.locator('#settings-section-beta').getAttribute('open'))) await betaSummary.click();
  await page.locator('#toggle-consensus-track-beta').check({ force: true });

  await page.waitForFunction(() => {
    const state = globalThis.StormTrackRuntime?.consensusTrackController?.getState?.();
    return state?.trackCount > 0 && state.pointCount > 0;
  }, null, { timeout: 15000 });

  const mobile = await page.evaluate(() => {
    const panel = document.getElementById('storm-panel');
    const toggle = document.getElementById('toggle-consensus-track-beta');
    const panelRect = panel?.getBoundingClientRect?.();
    const toggleRect = toggle?.getBoundingClientRect?.();
    const state = globalThis.StormTrackRuntime?.consensusTrackController?.getState?.() || null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panelOpen: panel?.classList.contains('open') === true,
      panelRect: panelRect ? { left: panelRect.left, right: panelRect.right, width: panelRect.width } : null,
      toggleVisible: Boolean(toggleRect && toggleRect.width > 0 && toggleRect.height > 0),
      toggleChecked: toggle?.checked === true,
      trackCount: state?.trackCount || 0,
      pointCount: state?.pointCount || 0,
      hudPresent: Boolean(document.querySelector('.storm-consensus-track-hud'))
    };
  });

  await page.screenshot({ path: mobileScreenshotPath, fullPage: true });

  await page.locator('#toggle-consensus-track-beta').uncheck({ force: true });
  await page.waitForFunction(() => !globalThis.StormTrackRuntime?.consensusTrackController);

  process.stdout.write(`${JSON.stringify({
    defaultOff,
    enabled,
    disabled,
    mobile,
    semantics: {
      displayOnly: true,
      defaultOff: true,
      officialAgencyLayersModified: false,
      hkSignalInputsModified: false,
      probabilityCalibrated: false
    }
  }, null, 2)}\n`);
} finally {
  await browser.close();
}