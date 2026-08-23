(function attachConsensusTrackObservationUi(root) {
  'use strict';

  if (!root?.document || root.__stormConsensusObservationUiInstalled) return;
  root.__stormConsensusObservationUiInstalled = true;

  const RAW_BASE = 'https://raw.githubusercontent.com/MaxYu725/Storm-Track/data/consensus-track-prospective-observations/';
  const CAPTURE_LIMIT = Math.min(18, Math.max(8, Number(new URLSearchParams(root.location?.search || '').get('limit')) || 14));
  let board = null;
  let selectedCaseId = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function round(value) {
    const number = finite(value);
    return number == null ? '—' : String(Math.round(number));
  }

  function hkt(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date).replace(',', '');
  }

  function parseNdjson(text) {
    return text.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(line => JSON.parse(line));
  }

  async function fetchText(path) {
    const response = await fetch(`${RAW_BASE}${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  }

  async function fetchJson(path) {
    return JSON.parse(await fetchText(path));
  }

  async function mapLimit(items, limit, worker) {
    const output = new Array(items.length);
    let cursor = 0;
    async function run() {
      while (cursor < items.length) {
        const index = cursor++;
        try { output[index] = await worker(items[index]); }
        catch { output[index] = null; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return output.filter(Boolean);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(script => script.src.endsWith(src.replace('./', '/')) || script.getAttribute('src') === src);
      if (existing) {
        if (root.ConsensusTrackObservationBoard) resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', reject, { once: true });
        }
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => reject(new Error(`無法載入 ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  async function ensureCore() {
    if (root.ConsensusTrackObservationBoard) return;
    await loadScript('./analysis/consensus-track-observation-board.js');
    if (!root.ConsensusTrackObservationBoard) throw new Error('ConsensusTrackObservationBoard unavailable');
  }

  function injectSection() {
    if (document.getElementById('ctObservationSection')) return;
    const footer = document.querySelector('.footer');
    const section = document.createElement('section');
    section.id = 'ctObservationSection';
    section.className = 'section';
    section.innerHTML = `
      <div class="section-head">
        <h2>Consensus Track Beta｜Prospective Observation</h2>
        <div class="section-note">valid-time diagnostics only · 無 skill / truth / probability</div>
      </div>
      <div id="ctStatus" class="status">正在讀取 Consensus Track prospective captures…</div>
      <div id="ctObservationContent" hidden>
        <div class="summary-grid">
          <div class="metric"><div class="label">Active CT cases</div><div id="ctActiveCount" class="value">—</div><div class="sub">最近 48 小時內</div></div>
          <div class="metric"><div class="label">有 +120h 共識</div><div id="ct120Count" class="value">—</div><div class="sub">最新 capture 的 exact lead</div></div>
          <div class="metric"><div class="label">最新 CT capture</div><div id="ctLatestCapture" class="value">—</div><div class="sub">香港時間</div></div>
          <div class="metric"><div class="label">排除 ambiguous capture</div><div id="ctExcludedCount" class="value">—</div><div class="sub">同 case 同 capture 多 group</div></div>
        </div>

        <div class="section-head"><h2>CT 即時總表</h2><div class="section-note">Lead cell = agency count / spread；— = 該 exact lead 無共識點</div></div>
        <div class="table-wrap"><table>
          <thead><tr><th>風暴</th><th>Reference</th><th>連續支援</th><th>Points</th><th>+24h</th><th>+48h</th><th>+72h</th><th>+96h</th><th>+120h</th><th>來源</th></tr></thead>
          <tbody id="ctOverviewBody"></tbody>
        </table></div>

        <div class="section" style="margin-top:14px">
          <div class="section-head"><h2>單一 CT case</h2><div id="ctSelectedCase" class="section-note"></div></div>
          <div id="ctStormTabs" class="storm-tabs"></div>
          <div id="ctLatestGrid" class="latest-grid"></div>
        </div>

        <div class="section" style="margin-top:14px">
          <div class="section-head"><h2>CT Capture Timeline</h2><div class="section-note">路徑移動只比較兩輪皆存在的相同 valid time</div></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Capture</th><th>Reference</th><th>支援</th><th>Points</th><th>+24h</th><th>+48h</th><th>+72h</th><th>+96h</th><th>+120h</th><th>共同 valid time</th><th>平均移動</th><th>最大移動</th></tr></thead>
            <tbody id="ctTimelineBody"></tbody>
          </table></div>
        </div>
        <div id="ctExcludedNote" class="note"></div>
      </div>`;
    if (footer) footer.before(section);
    else document.querySelector('.wrap')?.appendChild(section);
  }

  const $ = id => document.getElementById(id);

  function leadCell(sample, includeTime = false) {
    if (!sample?.hasConsensus) return '—';
    const main = `${round(sample.agencyCount)} / ${round(sample.spreadKm)}km`;
    return includeTime ? `${main} · ${hkt(sample.validTime)}` : main;
  }

  function renderOverview() {
    $('ctOverviewBody').innerHTML = board.storms.map(storm => {
      const row = storm.latest;
      return `<tr data-case="${esc(storm.caseId)}">
        <td><span class="storm-name">${esc(storm.displayName)}</span><br><span style="color:#555;font-size:.62rem">${esc(storm.caseId)}</span></td>
        <td>${esc(hkt(row.referenceBaseTime))}</td>
        <td class="num">+${round(row.continuousConsensusThroughHours)}h</td>
        <td class="num">${round(row.consensusPointCount)}</td>
        ${[24,48,72,96,120].map(lead => `<td class="num" title="${esc(row.leadSamples[String(lead)]?.validTime || '')}">${esc(leadCell(row.leadSamples[String(lead)]))}</td>`).join('')}
        <td>${esc(row.sourceAgencies.join(' · '))}</td>
      </tr>`;
    }).join('');
    [...$('ctOverviewBody').querySelectorAll('tr')].forEach(row => row.addEventListener('click', () => {
      selectedCaseId = row.dataset.case;
      renderTabs();
      renderSelected();
    }));
  }

  function renderTabs() {
    $('ctStormTabs').innerHTML = board.storms.map(storm => `<button type="button" data-case="${esc(storm.caseId)}" class="${storm.caseId === selectedCaseId ? 'active' : ''}">${esc(storm.displayName)}<span class="small">支援 +${round(storm.latest.continuousConsensusThroughHours)}h · ${round(storm.latest.consensusPointCount)} points</span></button>`).join('');
    [...$('ctStormTabs').querySelectorAll('button')].forEach(button => button.addEventListener('click', () => {
      selectedCaseId = button.dataset.case;
      renderTabs();
      renderSelected();
    }));
  }

  function selectedStorm() {
    return board.storms.find(storm => storm.caseId === selectedCaseId) || board.storms[0] || null;
  }

  function renderSelected() {
    const storm = selectedStorm();
    if (!storm) {
      $('ctLatestGrid').innerHTML = '';
      $('ctTimelineBody').innerHTML = '';
      return;
    }
    $('ctSelectedCase').textContent = storm.caseId;
    const row = storm.latest;
    const movement = row.movement;
    $('ctLatestGrid').innerHTML = [
      ['Reference', hkt(row.referenceBaseTime), row.referenceMethod || '—'],
      ['連續支援', `+${round(row.continuousConsensusThroughHours)}h`, `configured ${round(row.configuredHorizonHours)}h`],
      ['Consensus points', round(row.consensusPointCount), `step ${round(row.stepHours)}h`],
      ['來源', String(row.sourceAgencies.length), row.sourceAgencies.join(' · ') || '—'],
      ['共同 valid time', movement ? String(movement.matchedValidTimeCount) : '—', movement ? `ref Δ ${round(movement.referenceShiftHours)}h` : '首次'],
      ['同 valid-time 移動', movement?.meanKm != null ? `${round(movement.meanKm)} km` : '—', movement?.maxKm != null ? `max ${round(movement.maxKm)} km` : '只在 exact common valid time 計']
    ].map(([key, value, sub]) => `<div class="latest-card"><div class="k">${esc(key)}</div><div class="v">${esc(value)}</div><div class="s">${esc(sub)}</div></div>`).join('');

    $('ctTimelineBody').innerHTML = [...storm.timeline].reverse().map(item => {
      const move = item.movement;
      return `<tr>
        <td>${esc(hkt(item.capturedAt))}</td>
        <td>${esc(hkt(item.referenceBaseTime))}</td>
        <td class="num">+${round(item.continuousConsensusThroughHours)}h</td>
        <td class="num">${round(item.consensusPointCount)}</td>
        ${[24,48,72,96,120].map(lead => `<td class="num" title="${esc(item.leadSamples[String(lead)]?.validTime || '')}">${esc(leadCell(item.leadSamples[String(lead)]))}</td>`).join('')}
        <td class="num">${move ? move.matchedValidTimeCount : '—'}</td>
        <td class="num">${move?.meanKm != null ? `${round(move.meanKm)}km` : '—'}</td>
        <td class="num">${move?.maxKm != null ? `${round(move.maxKm)}km` : '—'}</td>
      </tr>`;
    }).join('');
  }

  function renderAll() {
    $('ctActiveCount').textContent = board.summary.activeStormCount;
    $('ct120Count').textContent = board.summary.full120hStormCount;
    $('ctLatestCapture').textContent = hkt(board.prospective.latestCapturedAt);
    $('ctExcludedCount').textContent = board.prospective.excludedAmbiguousCaseCaptureCount;
    if (!board.storms.some(storm => storm.caseId === selectedCaseId)) selectedCaseId = board.storms[0]?.caseId || null;
    renderOverview();
    renderTabs();
    renderSelected();
    const excluded = board.prospective.excludedAmbiguousCaseCaptures;
    $('ctExcludedNote').textContent = excluded.length
      ? `診斷保護：已排除 ${excluded.length} 個 ambiguous same-case capture；raw prospective evidence 未被修改。`
      : '目前沒有 ambiguous CT same-case capture 被排除。';
  }

  async function loadBoard() {
    injectSection();
    await ensureCore();
    $('ctStatus').className = 'status';
    $('ctStatus').textContent = `正在讀取最近 ${CAPTURE_LIMIT} 個 CT prospective captures…`;
    const [indexText, caseIndexText] = await Promise.all([fetchText('index.ndjson'), fetchText('case-index.ndjson')]);
    const indexRows = parseNdjson(indexText)
      .filter(row => row.schemaVersion === 'storm-consensus-track-prospective/v1' || row.schemaVersion === 'storm-consensus-track-prospective/v2')
      .slice(-CAPTURE_LIMIT);
    const fingerprints = new Set(indexRows.map(row => row.captureFingerprint).filter(Boolean));
    const caseIndex = parseNdjson(caseIndexText).filter(row => fingerprints.has(row.captureFingerprint));
    const paths = indexRows.map(row => root.ConsensusTrackObservationBoard.observationPath(row.capturedAt, row.captureFingerprint)).filter(Boolean);
    const records = await mapLimit(paths, 4, fetchJson);
    board = root.ConsensusTrackObservationBoard.deriveObservationBoard({ records, caseIndex });
    renderAll();
    $('ctStatus').textContent = `已載入 ${records.length} 個 CT recorder files；最後更新 ${hkt(board.prospective.latestCapturedAt)} HKT。只讀 prospective consensus，不讀 truth、evaluator 或 skill。`;
    $('ctObservationContent').hidden = false;
  }

  function showError(error) {
    injectSection();
    const status = $('ctStatus');
    if (!status) return;
    status.className = 'status error';
    status.textContent = `CT observation 讀取失敗：${error?.message || error}`;
  }

  function init() {
    injectSection();
    const refresh = document.getElementById('refreshBtn');
    refresh?.addEventListener('click', () => loadBoard().catch(showError));
    loadBoard().catch(showError);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);
