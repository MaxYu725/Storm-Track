(function attachStormSettingsPanelUi(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormSettingsPanelUi = api;
  if (root?.document) api.autoInstall();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormSettingsPanelUi(root) {
  'use strict';

  const VERSION = 'settings-panel-ui/v1';
  const PANEL_ID = 'storm-panel';
  const BACKDROP_ID = 'storm-settings-backdrop';
  const BETA_BODY_ID = 'settings-beta-body';
  const LEGACY_WIND_ANCHOR_ID = 'settings-legacy-wind-anchor';
  const CONSENSUS_TOGGLE_ID = 'toggle-consensus-track-beta';
  const CONSENSUS_STORAGE_KEY = 'storm-track-consensus-track-beta-enabled-v1';
  const CONSENSUS_STATE_EVENT = 'stormtrack:consensus-track-state';
  const CONSENSUS_TOGGLE_EVENT = 'stormtrack:consensus-track-toggle';

  function betaEnabled() {
    try {
      return new URLSearchParams(root?.location?.search || '').get('beta') === 'hk-signal';
    } catch {
      return false;
    }
  }

  function consensusQueryRequested(search = root?.location?.search || '') {
    try {
      const requested = String(new URLSearchParams(search).get('consensusTrack') || '').toLowerCase();
      return ['1', 'true', 'on', 'yes'].includes(requested);
    } catch {
      return false;
    }
  }

  function consensusStoredEnabled(storage = root?.localStorage) {
    try {
      return storage?.getItem?.(CONSENSUS_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function consensusToggleEnabled(search = root?.location?.search || '', storedEnabled = consensusStoredEnabled()) {
    if (!betaEnabled()) return false;
    return consensusQueryRequested(search) || storedEnabled === true;
  }

  function persistConsensusToggle(enabled, storage = root?.localStorage) {
    try {
      storage?.setItem?.(CONSENSUS_STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // Optional Beta preference only.
    }
  }

  function ensureConsensusOverlayScript(document) {
    if (!document || !betaEnabled()) return null;
    if (document.querySelector('script[data-storm-consensus-track]')) return null;
    const script = document.createElement('script');
    script.src = './analysis/consensus-track-overlay.js';
    script.async = true;
    script.dataset.stormConsensusTrack = 'true';
    document.head.appendChild(script);
    return script;
  }

  function installStyles(document) {
    if (!document || document.getElementById('storm-settings-v2-styles')) return;
    const style = document.createElement('style');
    style.id = 'storm-settings-v2-styles';
    style.textContent = `
      #${BACKDROP_ID}{position:absolute;inset:0;z-index:1090;background:rgba(0,0,0,.48);opacity:0;pointer-events:none;transition:opacity .22s ease}
      #${BACKDROP_ID}.visible{opacity:1;pointer-events:auto}
      .storm-panel.storm-settings-v2{width:min(390px,92vw);padding:0;overflow:hidden;border-left:1px solid #383838;background:rgba(0,0,0,.97);box-shadow:-12px 0 30px rgba(0,0,0,.38)}
      .storm-settings-header{position:relative;z-index:4;display:flex;align-items:center;gap:12px;min-height:58px;padding:10px 12px 9px 14px;border-bottom:1px solid #303030;background:rgba(0,0,0,.98);flex:0 0 auto}
      .storm-settings-heading{min-width:0;flex:1}
      .storm-settings-title{color:#fff;font-size:1.05rem;font-weight:650;letter-spacing:.2px}
      .storm-settings-subtitle{margin-top:2px;color:#707070;font-size:.65rem;letter-spacing:.2px}
      .storm-settings-close{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;padding:0;border:1px solid #333;background:#080808;color:#ddd;font-size:1.7rem;font-weight:200;line-height:1;cursor:pointer}
      .storm-settings-close:hover,.storm-settings-close:focus-visible{border-color:#777;color:#fff;outline:none}
      .storm-settings-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 12px calc(16px + env(safe-area-inset-bottom,0px))}
      .settings-section{border-bottom:1px solid #292929}
      .settings-section:last-of-type{border-bottom:0}
      .settings-section>summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 2px;color:#1ba1e2;font-size:.86rem;font-weight:650;letter-spacing:.2px;cursor:pointer;list-style:none;user-select:none}
      .settings-section>summary::-webkit-details-marker{display:none}
      .settings-section>summary::after{content:'›';margin-left:4px;color:#666;font-size:1.25rem;font-weight:300;transform:rotate(90deg);transition:transform .16s ease,color .16s ease}
      .settings-section:not([open])>summary::after{transform:rotate(0deg)}
      .settings-section>summary:hover::after{color:#aaa}
      .settings-section-title{min-width:0;flex:1}
      .settings-section-meta{flex:0 0 auto;color:#777;font-size:.66rem;font-weight:400;font-variant-numeric:tabular-nums}
      .settings-section-body{padding:0 0 10px}
      .settings-subhead{margin:8px 1px 6px;color:#6f6f6f;font-size:.63rem;font-weight:600;letter-spacing:.6px;text-transform:uppercase}
      .settings-toggle-grid,.settings-legend-grid,.settings-intensity-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
      .settings-toggle-grid>.toggle-row{display:flex;align-items:center;min-width:0;min-height:42px;margin:0;padding:7px 8px;border:1px solid #292929;background:#0b0b0b;color:#d8d8d8;font-size:.75rem;font-weight:350;line-height:1.28}
      .settings-toggle-grid>.toggle-row:hover{border-color:#454545;background:#111}
      .settings-toggle-grid>.toggle-row input{flex:0 0 auto;width:18px;height:18px;margin:0 8px 0 0}
      .settings-label-text{min-width:0;overflow-wrap:anywhere}
      .settings-source-grid .source-indicator{flex:0 0 20px;width:20px;margin-left:6px}
      .settings-legend-grid>.legend-row,.settings-intensity-grid>.legend-row{display:flex;align-items:center;min-width:0;min-height:34px;margin:0;padding:5px 7px;border:1px solid #252525;background:#080808;color:#bdbdbd;font-size:.7rem;font-weight:350;line-height:1.2}
      .settings-legend-grid .legend-line{flex:0 0 24px;width:24px;margin-right:7px}
      .settings-intensity-grid .legend-color{flex:0 0 11px;width:11px;height:11px;margin-right:7px}
      .settings-full-row{grid-column:1/-1}
      .settings-density-row{min-height:42px;margin:7px 0 0;padding:6px 8px;border:1px solid #292929;background:#0b0b0b;font-size:.75rem}
      .settings-density-row .metro-select{min-width:112px;height:30px;font-size:.75rem}
      .settings-active-body .panel-storm-card{margin-bottom:7px;padding:10px 11px}
      .settings-active-body .panel-storm-card:last-child{margin-bottom:0}
      .settings-beta-section>summary .settings-section-title::after{content:'BETA';display:inline-block;margin-left:7px;padding:1px 4px;border:1px solid #1ba1e2;color:#73cdf7;font-size:.53rem;font-weight:700;letter-spacing:.5px;vertical-align:1px}
      .settings-beta-placeholder{padding:9px;border:1px dashed #303030;color:#666;font-size:.7rem;line-height:1.4}
      .settings-beta-controls{display:grid;gap:6px}
      .settings-beta-controls>.toggle-row{min-height:42px;margin:0;padding:8px;border:1px solid #292929;background:#0b0b0b;font-size:.78rem}
      .settings-beta-controls>.storm-wind-status{margin:0 2px 2px;font-size:.66rem}
      .settings-consensus-note{margin:-1px 2px 2px;color:#68767b;font-size:.64rem;line-height:1.4}
      .settings-system-body #engine-status{margin-top:0;padding-top:3px}
      .settings-system-body>.settings-version-note{margin-top:8px;color:#606060;font-size:.66rem;line-height:1.45}
      .settings-legacy-anchor{display:none!important}
      body.storm-settings-open .metro-fab{opacity:.45}
      @media(max-width:640px){
        .storm-panel.storm-settings-v2{width:min(92vw,360px)}
        .storm-settings-header{min-height:54px;padding-left:12px}
        .storm-settings-scroll{padding-left:10px;padding-right:10px}
        .settings-toggle-grid>.toggle-row{padding:7px 7px;font-size:.72rem}
        .settings-legend-grid>.legend-row,.settings-intensity-grid>.legend-row{font-size:.67rem}
      }
      @media(max-width:370px){
        .settings-toggle-grid{grid-template-columns:1fr}
        .settings-legend-grid,.settings-intensity-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
    `;
    document.head.appendChild(style);
  }

  function extractDirectBlocks(panel) {
    const blocks = [];
    const loose = [];
    let current = null;
    Array.from(panel.children).forEach(node => {
      if (node.classList?.contains('panel-close')) {
        loose.push(node);
        return;
      }
      if (node.classList?.contains('panel-title')) {
        current = { title: String(node.textContent || '').trim(), titleNode: node, nodes: [] };
        blocks.push(current);
        return;
      }
      if (current) current.nodes.push(node);
      else loose.push(node);
    });
    return { blocks, loose };
  }

  function findBlock(blocks, title) {
    return blocks.find(block => block.title === title) || null;
  }

  function createSection(document, { id, title, open = false, className = '' } = {}) {
    const details = document.createElement('details');
    details.className = `settings-section${className ? ` ${className}` : ''}`;
    details.id = id;
    details.open = Boolean(open);

    const summary = document.createElement('summary');
    const titleNode = document.createElement('span');
    titleNode.className = 'settings-section-title';
    titleNode.textContent = title;
    const meta = document.createElement('span');
    meta.className = 'settings-section-meta';
    summary.appendChild(titleNode);
    summary.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'settings-section-body';
    details.appendChild(summary);
    details.appendChild(body);
    return { details, body, meta };
  }

  function createGrid(document, className) {
    const grid = document.createElement('div');
    grid.className = className;
    return grid;
  }

  function controlNode(nodes, id) {
    return nodes.find(node => node.id === id || node.querySelector?.(`#${id}`)) || null;
  }

  function normalizeSourceLabel(label, text, title) {
    if (!label) return;
    const input = label.querySelector('input');
    const indicator = label.querySelector('.source-indicator');
    Array.from(label.childNodes).forEach(node => {
      if (node.nodeType === 3) node.remove();
      if (node.nodeType === 1 && node.classList?.contains('settings-label-text')) node.remove();
    });
    const span = label.ownerDocument.createElement('span');
    span.className = 'settings-label-text';
    span.textContent = text;
    label.insertBefore(span, indicator || null);
    if (input && label.firstElementChild !== input) label.insertBefore(input, label.firstChild);
    label.title = title || text;
  }

  function updateToggleMeta(section) {
    if (!section?.details || !section?.meta) return;
    const toggles = Array.from(section.details.querySelectorAll('input[type="checkbox"]'));
    if (!toggles.length) return;
    section.meta.textContent = `${toggles.filter(input => input.checked).length}/${toggles.length}`;
  }

  function activeStormCount(container) {
    return container ? container.querySelectorAll('[data-storm-key]').length : 0;
  }

  function closePanel(panel) {
    panel?.classList.remove('open');
  }

  function syncOpenState(panel, backdrop, document) {
    const open = panel.classList.contains('open');
    backdrop?.classList.toggle('visible', open);
    document.body?.classList.toggle('storm-settings-open', open);
    const fab = document.querySelector('.metro-fab[aria-label*="圖例"],.metro-fab[aria-label*="設定"]');
    fab?.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-hidden', String(!open));
  }

  function buildBackdrop(panel, document) {
    const parent = panel.parentElement;
    if (!parent) return null;
    let backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = BACKDROP_ID;
      backdrop.setAttribute('aria-hidden', 'true');
      parent.insertBefore(backdrop, panel);
    }
    backdrop.addEventListener('click', () => closePanel(panel));
    return backdrop;
  }

  function makeHeader(panel, document) {
    const header = document.createElement('header');
    header.className = 'storm-settings-header';
    const heading = document.createElement('div');
    heading.className = 'storm-settings-heading';
    heading.innerHTML = '<div class="storm-settings-title">設定</div><div class="storm-settings-subtitle">顯示、資料來源與地圖圖層</div>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'storm-settings-close';
    close.setAttribute('aria-label', '關閉設定');
    close.textContent = '×';
    close.addEventListener('click', () => closePanel(panel));
    header.appendChild(heading);
    header.appendChild(close);
    return header;
  }

  function appendNodes(parent, nodes) {
    (nodes || []).filter(Boolean).forEach(node => parent.appendChild(node));
  }

  function createConsensusToggle(document) {
    const label = document.createElement('label');
    label.className = 'toggle-row';
    label.title = 'App 計算的 HKO / CMA / JMA / CWA valid-time 對齊共識路徑；非官方預報';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = CONSENSUS_TOGGLE_ID;
    input.checked = consensusToggleEnabled();

    const text = document.createElement('span');
    text.className = 'settings-label-text';
    text.textContent = '共識路徑 Beta';
    label.appendChild(input);
    label.appendChild(text);
    return { label, input };
  }

  function adoptLateBetaControls(panel, betaBody, legacyAnchor) {
    if (!panel || !betaBody || !legacyAnchor) return false;
    const direct = Array.from(panel.children);
    const title = direct.find(node => node !== legacyAnchor
      && node.classList?.contains('panel-title')
      && String(node.textContent || '').trim() === '模式風場 Beta');
    if (!title) return false;

    let controls = betaBody.querySelector('.settings-beta-controls');
    if (!controls) {
      controls = betaBody.ownerDocument.createElement('div');
      controls.className = 'settings-beta-controls';
      betaBody.appendChild(controls);
    }

    let cursor = title.nextElementSibling;
    const nodes = [];
    while (cursor && cursor !== legacyAnchor && !cursor.classList?.contains('panel-title')) {
      const next = cursor.nextElementSibling;
      nodes.push(cursor);
      cursor = next;
    }
    title.remove();
    betaBody.querySelector('.settings-beta-placeholder')?.remove();
    appendNodes(controls, nodes);
    return true;
  }

  function install(document = root?.document) {
    if (!document) return null;
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return null;
    if (panel.dataset.settingsUiVersion === VERSION) return panel;

    installStyles(document);
    const snapshot = extractDirectBlocks(panel);
    const activeBlock = findBlock(snapshot.blocks, '活躍風暴');
    const sourceBlock = findBlock(snapshot.blocks, '資料來源');
    const layerBlock = findBlock(snapshot.blocks, '顯示圖層');
    const legendBlock = findBlock(snapshot.blocks, '來源圖例');
    const intensityBlock = findBlock(snapshot.blocks, '強度顏色');
    const existingBetaBlock = findBlock(snapshot.blocks, '模式風場 Beta');

    const engineStatus = document.getElementById('engine-status');
    const versionNote = engineStatus?.nextElementSibling || null;
    const originalClose = panel.querySelector(':scope > .panel-close');

    Array.from(panel.children).forEach(node => node.remove());
    panel.classList.add('storm-settings-v2');
    panel.dataset.settingsUiVersion = VERSION;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Storm Track 設定');

    const header = makeHeader(panel, document);
    const scroll = document.createElement('div');
    scroll.className = 'storm-settings-scroll';
    panel.appendChild(header);
    panel.appendChild(scroll);

    originalClose?.remove();

    const active = createSection(document, {
      id: 'settings-section-active', title: '活躍風暴', open: false
    });
    active.body.classList.add('settings-active-body');
    appendNodes(active.body, activeBlock?.nodes || []);
    scroll.appendChild(active.details);

    const sources = createSection(document, {
      id: 'settings-section-sources', title: '資料來源 / 路徑圖例', open: true
    });
    const sourceGrid = createGrid(document, 'settings-toggle-grid settings-source-grid');
    const sourceNodes = sourceBlock?.nodes || [];
    const sourceLabels = [
      ['toggle-source-hko', 'HKO 香港天文台', '香港天文台 HKO'],
      ['toggle-source-cma', 'CMA 中央氣象台', '中央氣象台 CMA'],
      ['toggle-source-jma', 'JMA 日本氣象廳', '日本氣象廳 JMA · 官方 XML'],
      ['toggle-source-cwa', 'CWA 中央氣象署', '台灣中央氣象署 CWA · 官方 API']
    ];
    sourceLabels.forEach(([id, text, title]) => {
      const node = controlNode(sourceNodes, id);
      normalizeSourceLabel(node, text, title);
      if (node) sourceGrid.appendChild(node);
    });
    sources.body.appendChild(sourceGrid);
    if (legendBlock?.nodes?.length) {
      const subhead = document.createElement('div');
      subhead.className = 'settings-subhead';
      subhead.textContent = '路徑線型';
      sources.body.appendChild(subhead);
      const legendGrid = createGrid(document, 'settings-legend-grid');
      appendNodes(legendGrid, legendBlock.nodes);
      sources.body.appendChild(legendGrid);
    }
    scroll.appendChild(sources.details);

    const layerNodes = layerBlock?.nodes || [];
    const layers = createSection(document, {
      id: 'settings-section-layers', title: '地圖圖層', open: true
    });
    const layerGrid = createGrid(document, 'settings-toggle-grid');
    ['toggle-past', 'toggle-forecast', 'toggle-points', 'toggle-labels'].forEach(id => {
      const node = controlNode(layerNodes, id);
      if (node) layerGrid.appendChild(node);
    });
    layers.body.appendChild(layerGrid);
    const density = controlNode(layerNodes, 'forecast-density');
    if (density) {
      density.classList.add('settings-density-row', 'settings-full-row');
      layers.body.appendChild(density);
    }
    scroll.appendChild(layers.details);

    let beta = null;
    let consensusToggle = null;
    if (betaEnabled()) {
      beta = createSection(document, {
        id: 'settings-section-beta', title: '實驗圖層', open: false, className: 'settings-beta-section'
      });
      beta.body.id = BETA_BODY_ID;
      const controls = document.createElement('div');
      controls.className = 'settings-beta-controls';
      consensusToggle = createConsensusToggle(document);
      controls.appendChild(consensusToggle.label);
      const note = document.createElement('div');
      note.className = 'settings-consensus-note';
      note.textContent = '≥2 機構 valid-time 對齊；顯示用途，不代表官方預報或校準信心。';
      controls.appendChild(note);
      if (existingBetaBlock?.nodes?.length) appendNodes(controls, existingBetaBlock.nodes);
      beta.body.appendChild(controls);
      scroll.appendChild(beta.details);
      ensureConsensusOverlayScript(document);
    }

    const aids = createSection(document, {
      id: 'settings-section-aids', title: '地圖輔助 / 進階', open: false
    });
    const aidGrid = createGrid(document, 'settings-toggle-grid');
    ['toggle-cwa-probability', 'toggle-wind-radii', 'toggle-forecast-spread', 'toggle-rings', 'toggle-grid'].forEach(id => {
      const node = controlNode(layerNodes, id);
      if (node) aidGrid.appendChild(node);
    });
    aids.body.appendChild(aidGrid);
    scroll.appendChild(aids.details);

    const intensity = createSection(document, {
      id: 'settings-section-intensity', title: '強度顏色', open: false
    });
    const intensityGrid = createGrid(document, 'settings-intensity-grid');
    const intensityNodes = (intensityBlock?.nodes || []).filter(node => node !== engineStatus && node !== versionNote);
    appendNodes(intensityGrid, intensityNodes.filter(node => node.classList?.contains('legend-row')));
    intensity.body.appendChild(intensityGrid);
    scroll.appendChild(intensity.details);

    const system = createSection(document, {
      id: 'settings-section-system', title: '系統狀態', open: false
    });
    system.body.classList.add('settings-system-body');
    if (engineStatus) system.body.appendChild(engineStatus);
    if (versionNote) {
      versionNote.classList.add('settings-version-note');
      system.body.appendChild(versionNote);
    }
    scroll.appendChild(system.details);

    snapshot.blocks
      .filter(block => !['活躍風暴', '資料來源', '顯示圖層', '來源圖例', '強度顏色', '模式風場 Beta'].includes(block.title))
      .forEach((block, index) => {
        const extra = createSection(document, {
          id: `settings-section-extra-${index}`, title: block.title || '其他', open: false
        });
        appendNodes(extra.body, block.nodes);
        scroll.appendChild(extra.details);
      });

    snapshot.loose.filter(node => node !== originalClose).forEach(node => {
      if (node?.isConnected) return;
      system.body.appendChild(node);
    });

    const legacyAnchor = document.createElement('div');
    legacyAnchor.id = LEGACY_WIND_ANCHOR_ID;
    legacyAnchor.className = 'panel-title settings-legacy-anchor';
    legacyAnchor.textContent = '強度顏色';
    legacyAnchor.setAttribute('aria-hidden', 'true');
    panel.appendChild(legacyAnchor);

    const backdrop = buildBackdrop(panel, document);
    syncOpenState(panel, backdrop, document);

    [sources, layers, beta, aids].filter(Boolean).forEach(updateToggleMeta);

    if (consensusToggle) {
      consensusToggle.input.addEventListener('change', () => {
        const enabled = consensusToggle.input.checked === true;
        persistConsensusToggle(enabled);
        if (typeof root?.StormConsensusTrackOverlay?.setEnabled === 'function') {
          root.StormConsensusTrackOverlay.setEnabled(enabled);
        } else {
          try {
            root?.dispatchEvent?.(new root.CustomEvent(CONSENSUS_TOGGLE_EVENT, { detail: { enabled } }));
          } catch {
            // The persisted preference will be applied when the overlay script finishes loading.
          }
        }
        updateToggleMeta(beta);
      });

      root?.addEventListener?.(CONSENSUS_STATE_EVENT, event => {
        if (typeof event?.detail?.enabled !== 'boolean') return;
        consensusToggle.input.checked = event.detail.enabled;
        updateToggleMeta(beta);
      });
    }

    const activeContainer = document.getElementById('active-storms-container');
    const updateActive = () => {
      const count = activeStormCount(activeContainer);
      active.meta.textContent = count ? `${count}` : '—';
    };
    updateActive();
    if (activeContainer && typeof MutationObserver !== 'undefined') {
      new MutationObserver(updateActive).observe(activeContainer, { childList: true, subtree: false });
    }

    scroll.addEventListener('change', event => {
      const details = event.target?.closest?.('.settings-section');
      if (!details) return;
      const section = [sources, layers, beta, aids].filter(Boolean).find(item => item.details === details);
      if (section) updateToggleMeta(section);
    });

    if (typeof MutationObserver !== 'undefined') {
      const panelObserver = new MutationObserver(mutations => {
        let shouldAdopt = false;
        mutations.forEach(mutation => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            syncOpenState(panel, backdrop, document);
          }
          if (mutation.type === 'childList') shouldAdopt = true;
        });
        if (shouldAdopt && beta && adoptLateBetaControls(panel, beta.body, legacyAnchor)) {
          updateToggleMeta(beta);
        }
      });
      panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'], childList: true });
    }

    return panel;
  }

  function autoInstall() {
    if (!root?.document) return null;
    const run = () => install(root.document);
    const installed = run();
    if (installed) return installed;
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      root.setTimeout?.(run, 0);
    }
    return null;
  }

  return Object.freeze({
    VERSION,
    PANEL_ID,
    BETA_BODY_ID,
    CONSENSUS_TOGGLE_ID,
    CONSENSUS_STORAGE_KEY,
    betaEnabled,
    consensusQueryRequested,
    consensusStoredEnabled,
    consensusToggleEnabled,
    ensureConsensusOverlayScript,
    install,
    autoInstall
  });
});