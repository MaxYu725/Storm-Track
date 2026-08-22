import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCwaTyphoonDetailHtml,
  validateHistoricalCaseManifest
} from '../scripts/cwa-historical-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readCase = name => JSON.parse(fs.readFileSync(path.join(root, 'historical/cases', name), 'utf8'));

for (const file of ['2026-noul.json', '2025-ragasa.json']) {
  const manifest = validateHistoricalCaseManifest(readCase(file));
  assert.equal(manifest.truth.role, 'verification-only');
  assert.equal(manifest.forecastSources.CWA.role, 'forecast-input-candidate');
  assert.equal(manifest.safety.currentV1ModelFrozen, true);
  assert.equal(manifest.safety.truthMayNotBeUsedAsForecastInput, true);
  assert.ok(manifest.truth.signalLifecycle.some(item => /^T8/.test(item.signal)));
}

const sample = `
<html><body>
<table>
<tr><th>名稱</th><td>紅霞 (NOUL)</td></tr>
<tr><th>編號</th><td>202612</td></tr>
<tr><th>發布報數</th><td>12</td></tr>
</table>
<h5>颱風警報單</h5>
<a href="/TDB/public/warning/sample.pdf">warning</a>
</body></html>`;
const parsed = parseCwaTyphoonDetailHtml(sample, 'https://rdc28.cwa.gov.tw/TDB/public/typhoon_detail?typhoon_id=202612');
assert.equal(parsed.nameZh, '紅霞');
assert.equal(parsed.nameEn, 'NOUL');
assert.equal(parsed.archiveTyphoonId, '202612');
assert.equal(parsed.warningBulletinCount, 12);
assert.equal(parsed.warningBulletinSection, true);
assert.equal(parsed.candidateLinks.length, 1);

const noul = readCase('2026-noul.json');
assert.equal(noul.truth.highestSignal, 'T9');
assert.equal(noul.truth.signalLifecycle.find(item => item.signal === 'T8NW')?.issuedAt, '2026-07-25T14:10:00.000Z');

const ragasa = readCase('2025-ragasa.json');
assert.equal(ragasa.truth.highestSignal, 'T10');
assert.equal(ragasa.truth.signalLifecycle.find(item => item.signal === 'T8NW')?.issuedAt, '2025-09-23T06:20:00.000Z');
assert.equal(ragasa.truth.signalLifecycle.find(item => item.signal === 'T10')?.issuedAt, '2025-09-23T18:40:00.000Z');

console.log('historical case replay input tests: OK');
