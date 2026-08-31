(function attachHkoSignalStatement(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkoSignalStatement = api;
  if (root?.document) api.autoInstall();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkoSignalStatement(root) {
  'use strict';

  const VERSION = 'hko-signal-statement/v1';
  const BASE_URL = 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php';
  const WARNING_INFO_URL = `${BASE_URL}?dataType=warningInfo&lang=tc`;
  const WARN_SUMMARY_URL = `${BASE_URL}?dataType=warnsum&lang=tc`;
  const CARD_ID = 'hko-signal-statement-card';
  const STYLE_ID = 'hko-signal-statement-styles';
  const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
  const VISIBILITY_REFRESH_MS = 2 * 60 * 1000;

  const SIGNAL_LABELS = Object.freeze({
    TC1: '一號戒備信號',
    TC3: '三號強風信號',
    TC8NE: '八號烈風或暴風信號',
    TC8SE: '八號烈風或暴風信號',
    TC8SW: '八號烈風或暴風信號',
    TC8NW: '八號烈風或暴風信號',
    TC9: '九號烈風或暴風風力增強信號',
    TC10: '十號颶風信號'
  });

  const state = {
    installed: false,
    loading: false,
    timer: null,
    lastRefreshMs: 0,
    latest: null
  };

  function cleanText(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function normalizeCode(value) {
    const code = cleanText(value).toUpperCase();
    return Object.prototype.hasOwnProperty.call(SIGNAL_LABELS, code) ? code : null;
  }

  function signalLabelFromCode(value) {
    const code = normalizeCode(value);
    return code ? SIGNAL_LABELS[code] : null;
  }

  function signalLabelFromText(value) {
    const text = cleanText(value);
    if (!text) return null;
    const patterns = [
      [/十號(?:颶風)?信號/, '十號颶風信號'],
      [/九號(?:烈風或暴風風力增強)?信號/, '九號烈風或暴風風力增強信號'],
      [/八號(?:東北|東南|西南|西北)?(?:烈風或暴風)?信號/, '八號烈風或暴風信號'],
      [/三號(?:強風)?信號/, '三號強風信號'],
      [/一號(?:戒備)?信號/, '一號戒備信號']
    ];
    for (const [pattern, label] of patterns) {
      if (pattern.test(text)) return label;
    }
    return null;
  }

  function splitSentences(value) {
    const text = cleanText(value);
    if (!text) return [];
    const chunks = text.match(/[^。！？!?]+[。！？!?]?/g) || [text];
    return chunks.map(cleanText).filter(Boolean);
  }

  function detailsArray(warningInfo) {
    if (Array.isArray(warningInfo?.details)) return warningInfo.details;
    return Array.isArray(warningInfo) ? warningInfo : [];
  }

  function currentSignalCode(warnsum, warningInfo) {
    const summary = warnsum && typeof warnsum === 'object' ? warnsum.WTCSGNL : null;
    const summaryCode = normalizeCode(summary?.code || summary?.subtype);
    if (summaryCode) return summaryCode;
    const detail = detailsArray(warningInfo)
      .filter(item => String(item?.warningStatementCode || '').toUpperCase() === 'WTCSGNL')
      .find(item => normalizeCode(item?.subtype));
    return normalizeCode(detail?.subtype);
  }

  function extractChangeTime(text) {
    const normalized = cleanText(text);
    const actionIndex = normalized.search(/(?:改發|改掛|發出|取消|取代)/);
    if (actionIndex < 0) return null;
    const before = normalized.slice(Math.max(0, actionIndex - 46), actionIndex);
    const anchored = before.match(/(?:將|會|預料|預計|考慮|可能|或會|擬)?(?:於|在)([^，,；;。]{1,34})$/);
    if (anchored) return cleanText(anchored[1]);
    const deadline = before.match(/([^，,；;。]{1,28}(?:或之前|前|左右|之間|期間))$/);
    return deadline ? cleanText(deadline[1]) : null;
  }

  function makeCandidate({ kind, certainty, priority, sentence, currentSignal, targetSignal, timeText, updateTime, sourceCode }) {
    return {
      schemaVersion: VERSION,
      kind,
      certainty,
      priority,
      currentSignal: currentSignal || null,
      targetSignal: targetSignal || null,
      timeText: timeText || null,
      updateTime: cleanText(updateTime) || null,
      sourceCode: sourceCode || null,
      sourceText: cleanText(sentence),
      summary: summarizeCandidate({ kind, currentSignal, targetSignal, timeText })
    };
  }

  function summarizeCandidate({ kind, currentSignal, targetSignal, timeText }) {
    if (kind === 'maintain_until') {
      return `${currentSignal || targetSignal || '現行熱帶氣旋警告信號'}至少維持至${timeText ? ` ${timeText}` : ''}`;
    }
    if (kind === 'change_at') {
      return `${targetSignal || '較高信號'}${timeText ? `：${timeText}` : ''}改發`;
    }
    if (kind === 'change_window') {
      return `${targetSignal || '較高信號'}改發時段${timeText ? `：${timeText}` : ''}`;
    }
    if (kind === 'change_deadline') {
      return `${targetSignal || '較高信號'}${timeText ? `：${timeText}` : ''}發出`;
    }
    if (kind === 'assessment') {
      return `${targetSignal || '較高信號'}：天文台將視情況評估是否需要改發`;
    }
    if (kind === 'unlikely_change') {
      return `${targetSignal || '較高信號'}：短期內改發機會不大`;
    }
    return '香港天文台已更新熱帶氣旋警告資訊';
  }

  function classifySentence(sentence, context = {}) {
    const text = cleanText(sentence);
    if (!text || !/(?:信號|改發|改掛|發出|風球)/.test(text)) return null;

    const currentSignal = context.currentSignal || null;
    const targetSignal = signalLabelFromText(text);
    const updateTime = context.updateTime || null;
    const sourceCode = context.sourceCode || null;

    const maintain = text.match(/(?:一號(?:戒備)?信號|三號(?:強風)?信號|八號(?:東北|東南|西南|西北)?(?:烈風或暴風)?信號|九號(?:烈風或暴風風力增強)?信號|十號(?:颶風)?信號|(?:現時|現行|目前)信號).{0,18}?(?:會|將|預料|預計)?(?:至少)?維持(?:生效)?(?:至|到)([^，,；;。]+)/);
    if (maintain) {
      const timeText = cleanText(maintain[1]);
      return makeCandidate({
        kind: 'maintain_until', certainty: 'explicit', priority: 380,
        sentence: text, currentSignal: targetSignal || currentSignal, targetSignal: null,
        timeText, updateTime, sourceCode
      });
    }

    const noUpgrade = /(?:改發|改掛).{0,18}(?:機會不大|機會較低|可能性不高|暫時無需|暫時不需要|未有需要|沒有需要|無需)/.test(text)
      || /(?:暫時無需|暫時不需要|未有需要|沒有需要|無需).{0,18}(?:改發|改掛)/.test(text);
    if (noUpgrade) {
      return makeCandidate({
        kind: 'unlikely_change', certainty: 'low-likelihood', priority: 230,
        sentence: text, currentSignal, targetSignal, timeText: extractChangeTime(text), updateTime, sourceCode
      });
    }

    const conditional = /(?:評估|考慮|視乎|取決於|端視).{0,34}(?:是否)?(?:需要)?(?:改發|改掛|發出)/.test(text)
      || /(?:改發|改掛|發出).{0,24}(?:視乎|取決於|評估|考慮|機會|可能性)/.test(text);
    if (conditional) {
      return makeCandidate({
        kind: 'assessment', certainty: 'conditional', priority: 250,
        sentence: text, currentSignal, targetSignal, timeText: extractChangeTime(text), updateTime, sourceCode
      });
    }

    const action = text.match(/(?:改發|改掛|發出)(?:第)?(?:一號|三號|八號|九號|十號)?[^，,；;。]{0,12}信號|(?:改發|改掛|發出)(?:一號|三號|八號|九號|十號)/);
    if (action) {
      const timeText = extractChangeTime(text);
      const explicit = /(?:將|會|預料|預計|定於|決定|公布|宣布)/.test(text) && !/(?:可能|考慮|評估|視乎)/.test(text);
      const deadline = Boolean(timeText && /(?:或之前|前)$/.test(timeText));
      const window = Boolean(timeText && /(?:至|到|之間|期間)/.test(timeText));
      const kind = deadline ? 'change_deadline' : (window ? 'change_window' : 'change_at');
      return makeCandidate({
        kind,
        certainty: explicit && timeText ? 'explicit' : 'conditional',
        priority: explicit && timeText ? (deadline ? 420 : (window ? 410 : 430)) : 300,
        sentence: text, currentSignal, targetSignal, timeText, updateTime, sourceCode
      });
    }

    return null;
  }

  function candidateKey(candidate) {
    return [candidate.kind, candidate.targetSignal, candidate.currentSignal, candidate.timeText, candidate.sourceText].join('|');
  }

  function extractStatements({ warningInfo, warnsum } = {}) {
    const currentCode = currentSignalCode(warnsum, warningInfo);
    const currentSignal = signalLabelFromCode(currentCode);
    const candidates = [];

    for (const item of detailsArray(warningInfo)) {
      const sourceCode = String(item?.warningStatementCode || '').toUpperCase();
      if (!['WTCSGNL', 'WTCPRE8'].includes(sourceCode)) continue;
      const detailSignal = signalLabelFromCode(item?.subtype) || currentSignal;
      const updateTime = cleanText(item?.updateTime) || null;
      const contents = Array.isArray(item?.contents) ? item.contents : [];
      for (const paragraph of contents) {
        for (const sentence of splitSentences(paragraph)) {
          const candidate = classifySentence(sentence, { currentSignal: detailSignal, updateTime, sourceCode });
          if (candidate) candidates.push(candidate);
        }
      }
    }

    const unique = [];
    const seen = new Set();
    candidates
      .sort((left, right) => right.priority - left.priority || String(right.updateTime || '').localeCompare(String(left.updateTime || '')))
      .forEach(candidate => {
        const key = candidateKey(candidate);
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(candidate);
        }
      });

    const primary = unique.find(candidate => ['maintain_until', 'change_at', 'change_window', 'change_deadline'].includes(candidate.kind))
      || unique[0]
      || null;
    const secondary = unique.find(candidate => candidate !== primary
      && ['assessment', 'unlikely_change', 'change_at', 'change_window', 'change_deadline', 'maintain_until'].includes(candidate.kind))
      || null;

    return {
      schemaVersion: VERSION,
      authority: 'Hong Kong Observatory Open Data API',
      currentSignalCode: currentCode,
      currentSignal,
      primary,
      secondary,
      candidates: unique
    };
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HKO HTTP ${response.status}`);
    return response.json();
  }

  async function fetchLatest() {
    const [warningInfo, warnsum] = await Promise.all([
      fetchJson(WARNING_INFO_URL),
      fetchJson(WARN_SUMMARY_URL)
    ]);
    return {
      ...extractStatements({ warningInfo, warnsum }),
      retrievedAt: new Date().toISOString()
    };
  }

  function formatUpdateTime(value) {
    const ms = Date.parse(value || '');
    if (!Number.isFinite(ms)) return '';
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date(ms));
  }

  function installStyles(document) {
    if (!document || document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CARD_ID}{position:absolute;z-index:770;top:46px;left:50%;width:min(520px,calc(100% - 104px));transform:translateX(-50%);padding:9px 11px;border:1px solid #474747;border-left:3px solid #fff;background:rgba(0,0,0,.90);box-shadow:0 5px 18px rgba(0,0,0,.34);color:#fff;pointer-events:auto;backdrop-filter:blur(6px)}
      #${CARD_ID}[hidden]{display:none!important}
      .hko-signal-head{display:flex;align-items:center;gap:8px;min-height:19px}
      .hko-signal-badge{flex:0 0 auto;color:#fff;font-size:.66rem;font-weight:700;letter-spacing:.35px}
      .hko-signal-time{margin-left:auto;color:#7f7f7f;font-size:.62rem;font-variant-numeric:tabular-nums}
      .hko-signal-primary{margin-top:4px;color:#fff;font-size:.80rem;font-weight:650;line-height:1.38}
      .hko-signal-secondary{margin-top:3px;color:#b9b9b9;font-size:.70rem;line-height:1.35}
      .hko-signal-source{margin-top:4px;color:#666;font-size:.58rem;line-height:1.25}
      @media(max-width:640px){#${CARD_ID}{top:44px;width:calc(100% - 20px);padding:8px 10px}.hko-signal-primary{font-size:.76rem}.hko-signal-secondary{font-size:.67rem}}
    `;
    document.head.appendChild(style);
  }

  function ensureCard(document) {
    let card = document.getElementById(CARD_ID);
    if (card) return card;
    const host = document.getElementById('map-container') || document.querySelector('.pivot-content-wrapper');
    if (!host) return null;
    card = document.createElement('section');
    card.id = CARD_ID;
    card.hidden = true;
    card.setAttribute('aria-live', 'polite');
    card.setAttribute('aria-label', '香港天文台官方熱帶氣旋信號資訊');
    host.appendChild(card);
    return card;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function render(data, document = root?.document) {
    if (!document) return;
    installStyles(document);
    const card = ensureCard(document);
    if (!card) return;

    const primary = data?.primary || null;
    if (!primary) {
      card.hidden = true;
      card.innerHTML = '';
      return;
    }

    const secondary = data?.secondary || null;
    const updated = formatUpdateTime(primary.updateTime || secondary?.updateTime || data?.retrievedAt);
    card.innerHTML = `
      <div class="hko-signal-head"><span class="hko-signal-badge">HKO 官方信號資訊</span>${updated ? `<span class="hko-signal-time">${escapeHtml(updated)} 更新</span>` : ''}</div>
      <div class="hko-signal-primary">${escapeHtml(primary.summary)}</div>
      ${secondary ? `<div class="hko-signal-secondary">${escapeHtml(secondary.summary)}</div>` : ''}
      <div class="hko-signal-source">資料：香港天文台 · 官方原意優先，模糊時間不轉為精確時刻</div>
    `;
    card.hidden = false;
  }

  async function refresh() {
    if (state.loading) return state.latest;
    state.loading = true;
    try {
      const latest = await fetchLatest();
      state.latest = latest;
      state.lastRefreshMs = Date.now();
      render(latest);
      root?.dispatchEvent?.(new CustomEvent('stormtrack:hko-signal-statement', { detail: latest }));
      return latest;
    } catch (error) {
      console.warn('HKO signal statement refresh failed', error);
      return state.latest;
    } finally {
      state.loading = false;
    }
  }

  function autoInstall() {
    if (state.installed || !root?.document) return;
    state.installed = true;
    installStyles(root.document);

    const boot = () => {
      ensureCard(root.document);
      refresh();
      state.timer = root.setInterval?.(refresh, REFRESH_INTERVAL_MS) || null;
    };

    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }

    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState !== 'visible') return;
      if (Date.now() - state.lastRefreshMs >= VISIBILITY_REFRESH_MS) refresh();
    });
  }

  return Object.freeze({
    VERSION,
    SIGNAL_LABELS,
    WARNING_INFO_URL,
    WARN_SUMMARY_URL,
    cleanText,
    normalizeCode,
    signalLabelFromCode,
    signalLabelFromText,
    splitSentences,
    currentSignalCode,
    classifySentence,
    extractStatements,
    fetchLatest,
    render,
    refresh,
    autoInstall
  });
});