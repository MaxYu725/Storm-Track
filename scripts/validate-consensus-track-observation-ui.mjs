import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const targetUrl = process.env.CT_OBSERVATION_URL || 'http://127.0.0.1:4173/observation.html?limit=8';
const timeoutMs = Number(process.env.SETTLE_TIMEOUT_MS || 90000);

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => console.error(`PAGE_ERROR ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') console.error(`PAGE_CONSOLE_ERROR ${message.text()}`);
  });

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForFunction(() => {
    const section = document.getElementById('ctObservationSection');
    const content = document.getElementById('ctObservationContent');
    const rows = document.querySelectorAll('#ctOverviewBody tr');
    return Boolean(section && content && content.hidden === false && rows.length > 0);
  }, null, { timeout: timeoutMs });

  const initial = await page.evaluate(() => ({
    sectionTitle: document.querySelector('#ctObservationSection .section-head h2')?.textContent?.trim() || '',
    status: document.getElementById('ctStatus')?.textContent?.trim() || '',
    activeCount: Number(document.getElementById('ctActiveCount')?.textContent),
    full120Count: Number(document.getElementById('ct120Count')?.textContent),
    overviewRows: document.querySelectorAll('#ctOverviewBody tr').length,
    tabs: document.querySelectorAll('#ctStormTabs button').length,
    timelineRows: document.querySelectorAll('#ctTimelineBody tr').length,
    selectedCase: document.getElementById('ctSelectedCase')?.textContent?.trim() || '',
    headerText: document.querySelector('#ctObservationSection')?.textContent?.replace(/\s+/g, ' ').trim() || ''
  }));

  if (initial.sectionTitle !== 'Consensus Track Beta｜Prospective Observation') {
    throw new Error(`Unexpected CT observation title: ${initial.sectionTitle}`);
  }
  if (!Number.isFinite(initial.activeCount) || initial.activeCount < 1) {
    throw new Error(`Expected at least one active CT case: ${JSON.stringify(initial)}`);
  }
  if (initial.overviewRows !== initial.activeCount || initial.tabs !== initial.activeCount) {
    throw new Error(`CT overview/tabs did not match active cases: ${JSON.stringify(initial)}`);
  }
  if (initial.timelineRows < 1 || !initial.selectedCase) {
    throw new Error(`CT selected case timeline missing: ${JSON.stringify(initial)}`);
  }
  if (!initial.status.includes('不讀 truth、evaluator 或 skill')) {
    throw new Error(`Observation-only status wording missing: ${initial.status}`);
  }
  if (!initial.headerText.includes('+24h') || !initial.headerText.includes('+120h')) {
    throw new Error('Target lead diagnostics missing from CT observation section');
  }

  const rows = page.locator('#ctOverviewBody tr');
  if (await rows.count() > 1) {
    await rows.nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll('#ctTimelineBody tr').length > 0);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const section = document.getElementById('ctObservationSection');
    const rect = section?.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    return {
      left: rect?.left ?? null,
      right: rect?.right ?? null,
      viewport,
      selectedCase: document.getElementById('ctSelectedCase')?.textContent?.trim() || '',
      timelineRows: document.querySelectorAll('#ctTimelineBody tr').length
    };
  });
  if (mobile.left == null || mobile.right == null || mobile.left < -1 || mobile.right > mobile.viewport + 1) {
    throw new Error(`CT observation section exceeds mobile viewport: ${JSON.stringify(mobile)}`);
  }

  console.log(JSON.stringify({ targetUrl, initial, mobile }, null, 2));
} finally {
  await browser.close();
}
