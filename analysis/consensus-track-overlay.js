(function attachStormConsensusTrackOverlay(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormConsensusTrackOverlay = api;
  if (root?.document) api.autoInstall();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormConsensusTrackOverlay(root) {
  'use strict';

  const VERSION = 'consensus-track-overlay/v0';
  const MAP_READY_EVENT = 'stormtrack:map-ready';
  const STATE_EVENT = 'stormtrack:consensus-track-state';
  const TOGGLE_EVENT = 'stormtrack:consensus-track-toggle';
  const STORAGE_KEY = 'storm-track-consensus-track-beta-enabled-v1';
  const PANE_NAME = 'stormConsensusTrackPane';
  const PANE_Z_INDEX = 425;
  const POLL_INTERVAL_MS = 1500;
  const LINE_COLOR = '#7fe7ff';

  const finite = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  function betaEnabled(search) {
    try {
      return new URLSearchParams(search || '').get('beta') === 'hk-signal';
    } catch {
      return false;
    }
  }

  function queryRequested(search) {
    try {
      const requested = String(new URLSearchParams(search || '').get('consensusTrack') || '').toLowerCase();
      return ['1', 'true', 'on', 'yes'].includes(requested);
    } catch {
      return false;
    }
  }

  function readStoredEnabled(storage = root?.localStorage) {
    try {
      return storage?.getItem?.(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function writeStoredEnabled(enabled, storage = root?.localStorage) {
    try {
      storage?.setItem?.(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // Optional browser preference only.
    }
  }

  function isEnabled(search, storedEnabled = readStoredEnabled()) {
    if (!betaEnabled(search)) return false;
    if (queryRequested(search)) return true;
    return storedEnabled === true;
  }

  function reconstructGroup(observation) {
    const sources = {};
    for (const [agency, source] of Object.entries(observation?.sources || {})) {
      if (source?.rawInput && typeof source.rawInput === 'object') sources[agency] = source.rawInput;
    }
    return {
      ...(observation?.group || {}),
      sources
    };
  }

  function renderPoint(point) {
    const consensus = point?.consensus;
    const lat = finite(consensus?.lat);
    const lon = finite(consensus?.lon);
    if (lat === null || lon === null) return null;
    const entries = Array.isArray(point?.entries) ? point.entries : [];
    return {
      leadHours: finite(point?.leadHours),
      validTime: point?.validTime ?? null,
      lat,
      lon,
      agencyCount: Number(point?.agencyCount) || 0,
      agencies: Array.isArray(point?.agencies) ? point.agencies.slice() : [],
      spreadKm: finite(point?.spread?.distanceKm),
      interpolatedAgencyCount: entries.filter(entry => entry?.interpolated === true).length,
      provenance: entries.map(entry => ({
        agency: entry?.agency ?? null,
        provenance: entry?.provenance ?? null
      }))
    };
  }

  function splitConsensusSegments(points) {
    const segments = [];
    let current = [];
    for (const point of Array.isArray(points) ? points : []) {
      const rendered = point?.consensus ? renderPoint(point) : null;
      if (!rendered) {
        if (current.length >= 2) segments.push(current);
        current = [];
        continue;
      }
      current.push(rendered);
    }
    if (current.length >= 2) segments.push(current);
    return segments;
  }

  function buildRenderableTrack(observation, core, options = {}) {
    if (typeof core?.buildConsensusTrackForGroup !== 'function') return null;
    const group = reconstructGroup(observation);
    if (Object.keys(group.sources).length < 2) return null;

    const track = core.buildConsensusTrackForGroup(group, {
      generatedAt: observation?.observedAt || new Date().toISOString(),
      ...(options.trackOptions || {})
    });
    const rawPoints = Array.isArray(track?.points) ? track.points : [];
    const points = rawPoints.filter(point => point?.consensus).map(renderPoint).filter(Boolean);
    if (!points.length) return null;

    return {
      key: observation?.group?.key ?? null,
      displayName: observation?.group?.displayName ?? observation?.group?.nameEn ?? observation?.group?.key ?? 'Storm',
      schemaVersion: track?.schemaVersion ?? null,
      method: track?.method ?? null,
      referenceBaseTime: track?.referenceBaseTime ?? null,
      referenceMethod: track?.referenceMethod ?? null,
      stepHours: track?.stepHours ?? null,
      supportedThroughHours: points.at(-1)?.leadHours ?? null,
      points,
      segments: splitConsensusSegments(rawPoints)
    };
  }

  function buildRenderableTracks(observations, core, options = {}) {
    return (Array.isArray(observations) ? observations : [])
      .map(observation => buildRenderableTrack(observation, core, options))
      .filter(Boolean)
      .sort((left, right) => String(left.key || left.displayName).localeCompare(String(right.key || right.displayName)));
  }

  function observationSignature(observations) {
    return JSON.stringify((Array.isArray(observations) ? observations : []).map(observation => ({
      key: observation?.group?.key ?? null,
      observedAt: observation?.observedAt ?? null,
      sources: Object.entries(observation?.sources || {}).sort(([a], [b]) => a.localeCompare(b)).map(([agency, source]) => ({
        agency,
        sourceId: source?.sourceId ?? null,
        bulletinTime: source?.bulletinTime ?? null,
        positionCount: source?.positionCount ?? null,
        forecastCount: source?.forecastCount ?? null,
        currentTime: source?.current?.time ?? null,
        forecastEndTime: source?.forecastEnd?.time ?? null
      }))
    })));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function formatHkt(value) {
    const ms = Date.parse(value || '');
    if (!Number.isFinite(ms)) return '--';
    try {
      return new Intl.DateTimeFormat('zh-HK', {
        timeZone: 'Asia/Hong_Kong', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(ms)).replace(',', '');
    } catch {
      return String(value || '--');
    }
  }

  function installStyles(document) {
    if (!document || document.getElementById('storm-consensus-track-styles')) return;
    const style = document.createElement('style');
    style.id = 'storm-consensus-track-styles';
    style.textContent = `
.storm-consensus-track-hud{position:absolute;left:10px;top:10px;z-index:770;min-width:178px;padding:7px 9px;border:1px solid #4f7681;background:rgba(0,0,0,.82);color:#dff9ff;font-size:.69rem;line-height:1.42;pointer-events:none}
.storm-consensus-track-hud strong{font-weight:600;color:#fff}
.storm-consensus-track-hud .line{display:inline-block;width:24px;margin-right:7px;border-top:2px dashed ${LINE_COLOR};vertical-align:middle}
.storm-consensus-track-hud .sub{margin-top:2px;color:#7f9399}
.storm-consensus-tooltip{padding:5px 7px!important;border:1px solid #547985!important;border-radius:0!important;background:rgba(0,0,0,.94)!important;color:#fff!important;box-shadow:none!important;font-size:.72rem!important;line-height:1.45!important}
.storm-consensus-tooltip:before{display:none!important}
`;
    document.head.appendChild(style);
  }

  function ensureHud(document, map) {
    const container = map?.getContainer?.()?.parentElement || map?.getContainer?.();
    if (!document || !container) return null;
    let hud = container.querySelector?.('.storm-consensus-track-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'storm-consensus-track-hud';
      hud.dataset.consensusTrackHud = 'true';
      container.appendChild(hud);
    }
    return hud;
  }

  function pointTooltip(track, point) {
    const lead = Number.isFinite(point.leadHours) ? `+${point.leadHours}h` : '';
    const spread = Number.isFinite(point.spreadKm) ? `${Math.round(point.spreadKm)} km` : '--';
    const agencies = point.agencies.length ? point.agencies.join(' / ') : '--';
    return `<b>${escapeHtml(track.displayName)}</b><br>`
      + `Storm Track 共識 Beta ${escapeHtml(lead)} · ${point.agencyCount} 機構<br>`
      + `${escapeHtml(formatHkt(point.validTime))} · 分歧 ${escapeHtml(spread)}<br>`
      + `<span style="color:#8ca0a6">${escapeHtml(agencies)} · 插值 ${point.interpolatedAgencyCount}/${point.agencyCount}</span>`;
  }

  function createController(map, options = {}) {
    if (!map || !root?.L) return null;
    installStyles(root.document);

    let pane = map.getPane?.(PANE_NAME);
    if (!pane && typeof map.createPane === 'function') pane = map.createPane(PANE_NAME);
    if (pane?.style) {
      pane.style.zIndex = String(PANE_Z_INDEX);
      pane.style.pointerEvents = 'none';
    }

    const layer = root.L.layerGroup().addTo(map);
    const hud = ensureHud(root.document, map);
    const state = {
      signature: null,
      trackCount: 0,
      segmentCount: 0,
      pointCount: 0,
      supportedThroughHours: [],
      lastRefreshAt: null,
      archiveHidden: false
    };

    function clearLayers() {
      layer.clearLayers();
      state.trackCount = 0;
      state.segmentCount = 0;
      state.pointCount = 0;
      state.supportedThroughHours = [];
    }

    function renderTracks(tracks) {
      clearLayers();
      for (const track of tracks) {
        for (const segment of track.segments) {
          const latlngs = segment.map(point => [point.lat, point.lon]);
          root.L.polyline(latlngs, {
            pane: PANE_NAME,
            color: '#050505',
            weight: 5.4,
            opacity: 0.78,
            lineJoin: 'round',
            interactive: false
          }).addTo(layer);
          root.L.polyline(latlngs, {
            pane: PANE_NAME,
            color: LINE_COLOR,
            weight: 2.7,
            opacity: 0.96,
            dashArray: '10,6',
            lineJoin: 'round',
            interactive: false
          }).addTo(layer);
          state.segmentCount += 1;
        }

        for (const point of track.points) {
          const marker = root.L.circleMarker([point.lat, point.lon], {
            pane: PANE_NAME,
            radius: point.agencyCount >= 4 ? 4 : 3.4,
            color: LINE_COLOR,
            weight: 1.7,
            opacity: 1,
            fillColor: '#050505',
            fillOpacity: 0.95,
            interactive: true
          });
          marker.bindTooltip(pointTooltip(track, point), {
            direction: 'top',
            offset: [0, -6],
            opacity: 1,
            className: 'storm-consensus-tooltip'
          });
          marker.addTo(layer);
          state.pointCount += 1;
        }
      }
      state.trackCount = tracks.length;
      state.supportedThroughHours = tracks.map(track => ({
        key: track.key,
        hours: track.supportedThroughHours
      }));
    }

    function updateHud(tracks) {
      if (!hud) return;
      const count = tracks.length;
      const maxHorizon = tracks.map(track => finite(track.supportedThroughHours)).filter(Number.isFinite);
      const maxText = maxHorizon.length ? ` · 最長 +${Math.max(...maxHorizon)}h` : '';
      hud.innerHTML = `<div><span class="line"></span><strong>Storm Track 共識路徑 Beta</strong></div>`
        + `<div class="sub">${count ? `${count} 個風暴${maxText}` : '等待可用的多機構路徑'}</div>`
        + '<div class="sub">≥2 機構 · 6h valid-time 對齊 · 非官方預報</div>';
    }

    function readObservations() {
      try {
        return root?.StormHkThreatUi?.readProspectiveObservations?.() || [];
      } catch {
        return [];
      }
    }

    function refresh(force = false) {
      const archiveMode = root?.document?.body?.classList?.contains('archive-mode') === true;
      if (archiveMode) {
        if (!state.archiveHidden || force) clearLayers();
        state.archiveHidden = true;
        if (hud) hud.style.display = 'none';
        return getState();
      }
      state.archiveHidden = false;
      if (hud) hud.style.display = '';

      const observations = readObservations();
      const signature = observationSignature(observations);
      if (!force && signature === state.signature) return getState();
      state.signature = signature;

      const tracks = buildRenderableTracks(observations, root.StormAnalysisCore, options);
      renderTracks(tracks);
      updateHud(tracks);
      state.lastRefreshAt = new Date().toISOString();
      return getState();
    }

    function getState() {
      return {
        version: VERSION,
        enabled: true,
        trackCount: state.trackCount,
        segmentCount: state.segmentCount,
        pointCount: state.pointCount,
        supportedThroughHours: state.supportedThroughHours.map(item => ({ ...item })),
        lastRefreshAt: state.lastRefreshAt,
        archiveHidden: state.archiveHidden
      };
    }

    const timer = root.setInterval?.(() => refresh(false), options.pollIntervalMs || POLL_INTERVAL_MS) || null;
    refresh(true);

    return Object.freeze({
      refresh: () => refresh(true),
      getState,
      destroy() {
        if (timer) root.clearInterval?.(timer);
        clearLayers();
        if (map.hasLayer?.(layer)) map.removeLayer(layer);
        hud?.remove?.();
      }
    });
  }

  function dispatchState(enabled) {
    try {
      root?.dispatchEvent?.(new root.CustomEvent(STATE_EVENT, {
        detail: {
          enabled: enabled === true,
          state: root?.StormTrackRuntime?.consensusTrackController?.getState?.() || null
        }
      }));
    } catch {
      // Optional UI synchronization only.
    }
  }

  function installController(runtime, map) {
    if (!runtime || !map || runtime.consensusTrackController || runtime.consensusTrackEnabled !== true) {
      return runtime?.consensusTrackController || null;
    }
    runtime.consensusTrackController = createController(map);
    dispatchState(Boolean(runtime.consensusTrackController));
    return runtime.consensusTrackController;
  }

  function getEnabled() {
    const runtime = root?.StormTrackRuntime;
    if (typeof runtime?.consensusTrackEnabled === 'boolean') return runtime.consensusTrackEnabled;
    return isEnabled(root?.location?.search || '');
  }

  function setEnabled(enabled, options = {}) {
    if (!betaEnabled(root?.location?.search || '')) return false;
    const runtime = root.StormTrackRuntime || (root.StormTrackRuntime = {});
    runtime.consensusTrackEnabled = enabled === true;
    if (options.persist !== false) writeStoredEnabled(runtime.consensusTrackEnabled);

    if (runtime.consensusTrackEnabled) {
      installController(runtime, runtime.map);
    } else if (runtime.consensusTrackController) {
      runtime.consensusTrackController.destroy?.();
      runtime.consensusTrackController = null;
    }

    dispatchState(runtime.consensusTrackEnabled);
    return runtime.consensusTrackEnabled;
  }

  function autoInstall() {
    if (!root?.document || !betaEnabled(root.location?.search || '')) return null;
    const runtime = root.StormTrackRuntime || (root.StormTrackRuntime = {});

    if (typeof runtime.consensusTrackEnabled !== 'boolean') {
      runtime.consensusTrackEnabled = isEnabled(root.location?.search || '');
    }

    if (!runtime.consensusTrackLifecycleInstalled) {
      root.addEventListener?.(MAP_READY_EVENT, event => {
        const map = event?.detail?.map || runtime.map;
        if (map) runtime.map = map;
        installController(runtime, map);
      });
      root.addEventListener?.(TOGGLE_EVENT, event => {
        setEnabled(event?.detail?.enabled === true);
      });
      runtime.consensusTrackLifecycleInstalled = true;
    }

    installController(runtime, runtime.map);
    dispatchState(runtime.consensusTrackEnabled);
    return runtime.consensusTrackController || null;
  }

  return Object.freeze({
    VERSION,
    STORAGE_KEY,
    STATE_EVENT,
    TOGGLE_EVENT,
    PANE_NAME,
    PANE_Z_INDEX,
    betaEnabled,
    queryRequested,
    readStoredEnabled,
    writeStoredEnabled,
    isEnabled,
    reconstructGroup,
    splitConsensusSegments,
    buildRenderableTrack,
    buildRenderableTracks,
    observationSignature,
    createController,
    getEnabled,
    setEnabled,
    autoInstall
  });
});