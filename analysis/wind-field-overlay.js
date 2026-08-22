(function attachStormWindField(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormWindField = api;
  if (root?.document) api.autoInstall();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormWindField(root) {
  'use strict';

  const VERSION = 'wind-field-overlay/v1.1';
  const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/ecmwf';
  const CACHE_PREFIX = 'storm-track-wind-field-v1:';
  const CACHE_TTL_MS = 20 * 60 * 1000;
  const MIN_REFRESH_MS = 90 * 1000;
  const REQUEST_TIMEOUT_MS = 12000;
  const MAP_READY_EVENT = 'stormtrack:map-ready';

  const finite = value => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function parseGmtTime(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(text) ? text : `${text}Z`;
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? ms : null;
  }

  function meteorologicalWindToUv(speedMs, directionDeg) {
    const speed = finite(speedMs);
    const direction = finite(directionDeg);
    if (speed === null || direction === null || speed < 0) return null;
    const radians = direction * Math.PI / 180;
    return { u: -speed * Math.sin(radians), v: -speed * Math.cos(radians), speed };
  }

  function buildCoordinateGrid(bounds, options = {}) {
    if (!bounds) return null;
    const south = finite(bounds.south ?? bounds.getSouth?.());
    const north = finite(bounds.north ?? bounds.getNorth?.());
    const west = finite(bounds.west ?? bounds.getWest?.());
    const east = finite(bounds.east ?? bounds.getEast?.());
    if ([south, north, west, east].some(value => value === null)) return null;
    if (!(north > south) || !(east > west) || east - west > 180) return null;

    const rows = clamp(Math.round(finite(options.rows) ?? 9), 4, 15);
    const cols = clamp(Math.round(finite(options.cols) ?? 11), 4, 17);
    const padRatio = clamp(finite(options.padRatio) ?? 0.12, 0, 0.35);
    const latPad = (north - south) * padRatio;
    const lonPad = (east - west) * padRatio;
    const paddedSouth = clamp(south - latPad, -80, 80);
    const paddedNorth = clamp(north + latPad, -80, 80);
    const paddedWest = Math.max(-179.5, west - lonPad);
    const paddedEast = Math.min(179.5, east + lonPad);
    const latStep = (paddedNorth - paddedSouth) / (rows - 1);
    const lonStep = (paddedEast - paddedWest) / (cols - 1);
    const points = [];

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        points.push({
          lat: paddedSouth + latStep * row,
          lon: paddedWest + lonStep * col,
          row,
          col
        });
      }
    }

    return {
      south: paddedSouth, north: paddedNorth, west: paddedWest, east: paddedEast,
      rows, cols, latStep, lonStep, points
    };
  }

  function interpolateVector(grid, latValue, lonValue) {
    const lat = finite(latValue);
    const lon = finite(lonValue);
    if (!grid || lat === null || lon === null || !Array.isArray(grid.vectors)) return null;
    if (lat < grid.south || lat > grid.north || lon < grid.west || lon > grid.east) return null;
    if (!(grid.latStep > 0) || !(grid.lonStep > 0)) return null;

    const rowFloat = (lat - grid.south) / grid.latStep;
    const colFloat = (lon - grid.west) / grid.lonStep;
    const row0 = clamp(Math.floor(rowFloat), 0, grid.rows - 1);
    const col0 = clamp(Math.floor(colFloat), 0, grid.cols - 1);
    const row1 = clamp(row0 + 1, 0, grid.rows - 1);
    const col1 = clamp(col0 + 1, 0, grid.cols - 1);
    const ty = clamp(rowFloat - row0, 0, 1);
    const tx = clamp(colFloat - col0, 0, 1);
    const at = (row, col) => grid.vectors[row * grid.cols + col] || null;
    const q00 = at(row0, col0), q10 = at(row0, col1), q01 = at(row1, col0), q11 = at(row1, col1);
    if (![q00, q10, q01, q11].every(vector => vector && Number.isFinite(vector.u) && Number.isFinite(vector.v))) return null;

    const mix = key =>
      q00[key] * (1 - tx) * (1 - ty) +
      q10[key] * tx * (1 - ty) +
      q01[key] * (1 - tx) * ty +
      q11[key] * tx * ty;
    const u = mix('u');
    const v = mix('v');
    return { u, v, speed: Math.hypot(u, v) };
  }

  function gridSignature(spec) {
    const rounded = value => Math.round(value * 2) / 2;
    return [rounded(spec.south), rounded(spec.north), rounded(spec.west), rounded(spec.east), spec.rows, spec.cols].join(':');
  }

  function currentGridCovers(grid, bounds) {
    if (!grid || !bounds) return false;
    const south = finite(bounds.getSouth?.());
    const north = finite(bounds.getNorth?.());
    const west = finite(bounds.getWest?.());
    const east = finite(bounds.getEast?.());
    if ([south, north, west, east].some(value => value === null)) return false;
    return south >= grid.south && north <= grid.north && west >= grid.west && east <= grid.east;
  }

  function firstHourlyWind(item) {
    const hourly = item?.hourly;
    const speed = Array.isArray(hourly?.wind_speed_10m) ? hourly.wind_speed_10m[0] : null;
    const direction = Array.isArray(hourly?.wind_direction_10m) ? hourly.wind_direction_10m[0] : null;
    const time = Array.isArray(hourly?.time) ? hourly.time[0] : null;
    return { speed, direction, time };
  }

  function parseOpenMeteoGrid(spec, payload) {
    const rows = Array.isArray(payload) ? payload : [payload];
    if (rows.length !== spec.points.length) {
      throw new Error(`wind-grid-size-mismatch:${rows.length}/${spec.points.length}`);
    }
    let validTime = null;
    const vectors = rows.map((item, index) => {
      const hourly = firstHourlyWind(item);
      const vector = meteorologicalWindToUv(hourly.speed, hourly.direction);
      if (!vector) throw new Error(`wind-grid-invalid-vector:${index}`);
      if (!validTime && hourly.time) validTime = hourly.time;
      return vector;
    });
    if (parseGmtTime(validTime) === null) throw new Error('wind-grid-invalid-time');
    return { ...spec, vectors, validTime, fetchedAt: new Date().toISOString() };
  }

  async function fetchWindGrid(spec, options = {}) {
    const fetchImpl = options.fetchImpl || root?.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('fetch-unavailable');
    const params = new URLSearchParams({
      latitude: spec.points.map(point => point.lat.toFixed(3)).join(','),
      longitude: spec.points.map(point => point.lon.toFixed(3)).join(','),
      hourly: 'wind_speed_10m,wind_direction_10m',
      forecast_hours: '1',
      wind_speed_unit: 'ms',
      timezone: 'GMT',
      cell_selection: 'nearest',
      elevation: 'nan'
    });
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${OPEN_METEO_ENDPOINT}?${params}`, {
        signal: controller?.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response?.ok) throw new Error(`wind-http-${response?.status || 'error'}`);
      return parseOpenMeteoGrid(spec, await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }

  function readCachedGrid(signature) {
    try {
      const raw = root?.sessionStorage?.getItem(`${CACHE_PREFIX}${signature}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const fetchedAt = Date.parse(parsed?.fetchedAt || '');
      if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > CACHE_TTL_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeCachedGrid(signature, grid) {
    try {
      root?.sessionStorage?.setItem(`${CACHE_PREFIX}${signature}`, JSON.stringify(grid));
    } catch {
      // Optional cache only.
    }
  }

  function installStyles(document) {
    if (!document || document.getElementById('storm-wind-field-styles')) return;
    const style = document.createElement('style');
    style.id = 'storm-wind-field-styles';
    style.textContent = `
      .storm-wind-canvas{position:absolute;inset:0;z-index:250;pointer-events:none;width:100%;height:100%}
      .storm-wind-hud{position:absolute;left:10px;bottom:34px;z-index:760;padding:5px 7px;border:1px solid #3b3b3b;background:rgba(0,0,0,.78);color:#c9c9c9;font-size:.68rem;line-height:1.4;pointer-events:auto}
      .storm-wind-hud a{color:#8fd8ff;text-decoration:none}
      .storm-wind-status{margin:-3px 0 8px 29px;color:#777;font-size:.7rem;line-height:1.4}
      @media(max-width:640px){.storm-wind-hud{left:8px;bottom:8px;font-size:.64rem}.storm-wind-status{font-size:.66rem}}
    `;
    document.head.appendChild(style);
  }

  function installControls(document, onToggle) {
    const panel = document?.getElementById('storm-panel');
    const mapContainer = document?.getElementById('map-container');
    if (!panel || !mapContainer) return null;

    let checkbox = document.getElementById('toggle-model-wind-field');
    let status = document.getElementById('model-wind-field-status');
    let hud = document.getElementById('storm-wind-field-hud');

    if (!checkbox) {
      const title = document.createElement('div');
      title.className = 'panel-title';
      title.textContent = '模式風場 Beta';

      const label = document.createElement('label');
      label.className = 'toggle-row';
      checkbox = document.createElement('input');
      checkbox.id = 'toggle-model-wind-field';
      checkbox.type = 'checkbox';
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode('ECMWF IFS 10 m 動畫風場'));

      status = document.createElement('div');
      status.id = 'model-wind-field-status';
      status.className = 'storm-wind-status';
      status.textContent = '預設關閉 · 模式資料，非官方熱帶氣旋風圈';

      const anchor = Array.from(panel.querySelectorAll('.panel-title'))
        .find(node => node.textContent?.trim() === '強度顏色');
      panel.insertBefore(title, anchor || null);
      panel.insertBefore(label, anchor || null);
      panel.insertBefore(status, anchor || null);
    }

    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'storm-wind-field-hud';
      hud.className = 'storm-wind-hud hidden';
      mapContainer.appendChild(hud);
    }

    checkbox.addEventListener('change', () => onToggle(Boolean(checkbox.checked)));
    return { checkbox, status, hud };
  }

  function formatValidTime(value) {
    const ms = parseGmtTime(value);
    if (ms === null) return '--';
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(ms)).replace(',', '');
  }

  function createController(map) {
    const document = root?.document;
    if (!map || !document) return null;
    installStyles(document);

    const state = {
      enabled: false, grid: null, canvas: null, ctx: null, particles: [],
      frame: null, lastFrameAt: 0, lastFetchAt: 0, fetchSerial: 0, moveTimer: null,
      controls: null,
      reduceMotion: root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    };

    const setStatus = (text, kind = 'normal') => {
      if (!state.controls?.status) return;
      state.controls.status.textContent = text;
      state.controls.status.style.color = kind === 'error' ? '#e98181' : (kind === 'ok' ? '#aaa' : '#777');
    };

    const updateHud = () => {
      const hud = state.controls?.hud;
      if (!hud) return;
      if (!state.enabled || !state.grid) {
        hud.classList.add('hidden');
        return;
      }
      hud.classList.remove('hidden');
      hud.innerHTML = `ECMWF IFS · 10 m · ${formatValidTime(state.grid.validTime)} HKT<br><span style="color:#777">模式風場 · 非 HKO/CMA/JMA/CWA 官方路徑</span> · <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>`;
    };

    function particleCount() {
      const size = map.getSize();
      const area = Math.max(1, size.x * size.y);
      const mobile = root.innerWidth <= 640;
      return clamp(Math.round(area * (state.reduceMotion ? 0 : (mobile ? 0.00055 : 0.00072))), 140, mobile ? 360 : 620);
    }

    function seedParticle(particle) {
      const size = map.getSize();
      particle.x = Math.random() * size.x;
      particle.y = Math.random() * size.y;
      particle.age = Math.floor(Math.random() * 70);
      particle.maxAge = 45 + Math.floor(Math.random() * 55);
      return particle;
    }

    function seedParticles() {
      state.particles = Array.from({ length: particleCount() }, () => seedParticle({}));
      if (state.ctx) {
        const size = map.getSize();
        state.ctx.clearRect(0, 0, size.x, size.y);
      }
    }

    function resizeCanvas() {
      if (!state.canvas || !state.ctx) return;
      const size = map.getSize();
      const ratio = clamp(root.devicePixelRatio || 1, 1, 2);
      state.canvas.width = Math.max(1, Math.round(size.x * ratio));
      state.canvas.height = Math.max(1, Math.round(size.y * ratio));
      state.canvas.style.width = `${size.x}px`;
      state.canvas.style.height = `${size.y}px`;
      state.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      seedParticles();
    }

    function ensureCanvas() {
      if (state.canvas?.isConnected) return state.canvas;
      const container = map.getContainer?.();
      if (!container) return null;
      state.canvas = document.createElement('canvas');
      state.canvas.className = 'storm-wind-canvas';
      state.canvas.setAttribute('aria-hidden', 'true');
      container.appendChild(state.canvas);
      state.ctx = state.canvas.getContext('2d', { alpha: true });
      resizeCanvas();
      return state.canvas;
    }

    function renderStaticVectors() {
      if (!state.enabled || !state.grid || !state.ctx) return;
      const ctx = state.ctx;
      const size = map.getSize();
      ctx.clearRect(0, 0, size.x, size.y);
      ctx.strokeStyle = 'rgba(210,240,255,.65)';
      ctx.fillStyle = 'rgba(210,240,255,.65)';
      ctx.lineWidth = 1;

      for (let y = 30; y < size.y; y += 58) {
        for (let x = 30; x < size.x; x += 58) {
          const latlng = map.containerPointToLatLng([x, y]);
          const vector = interpolateVector(state.grid, latlng.lat, latlng.lng);
          if (!vector || vector.speed < 0.2) continue;
          const norm = Math.max(vector.speed, 0.01);
          const length = clamp(6 + vector.speed * 0.5, 7, 20);
          const dx = vector.u / norm * length;
          const dy = -vector.v / norm * length;
          const endX = x + dx, endY = y + dy;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          const angle = Math.atan2(dy, dx);
          ctx.beginPath();
          ctx.moveTo(endX, endY);
          ctx.lineTo(endX - 4 * Math.cos(angle - 0.55), endY - 4 * Math.sin(angle - 0.55));
          ctx.lineTo(endX - 4 * Math.cos(angle + 0.55), endY - 4 * Math.sin(angle + 0.55));
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    function animate(timestamp) {
      state.frame = null;
      if (!state.enabled || !state.grid || !state.ctx || document.visibilityState === 'hidden') return;
      if (state.reduceMotion) {
        renderStaticVectors();
        return;
      }
      if (timestamp - state.lastFrameAt < 28) {
        state.frame = root.requestAnimationFrame(animate);
        return;
      }
      state.lastFrameAt = timestamp;

      const ctx = state.ctx;
      const size = map.getSize();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = 'rgba(0,0,0,.92)';
      ctx.fillRect(0, 0, size.x, size.y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 1;

      for (const particle of state.particles) {
        if (particle.age++ > particle.maxAge || particle.x < 0 || particle.y < 0 || particle.x > size.x || particle.y > size.y) {
          seedParticle(particle);
          continue;
        }
        const latlng = map.containerPointToLatLng([particle.x, particle.y]);
        const vector = interpolateVector(state.grid, latlng.lat, latlng.lng);
        if (!vector || vector.speed < 0.15) {
          seedParticle(particle);
          continue;
        }
        const speed = Math.max(vector.speed, 0.01);
        const step = clamp(0.45 + speed * 0.065, 0.5, 2.4);
        const nextX = particle.x + vector.u / speed * step;
        const nextY = particle.y - vector.v / speed * step;
        const alpha = clamp(0.18 + speed / 38, 0.2, 0.72);
        ctx.strokeStyle = `rgba(205,238,255,${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(nextX, nextY);
        ctx.stroke();
        particle.x = nextX;
        particle.y = nextY;
      }
      state.frame = root.requestAnimationFrame(animate);
    }

    function startAnimation() {
      if (!state.enabled || !state.grid) return;
      ensureCanvas();
      if (state.reduceMotion) {
        renderStaticVectors();
        return;
      }
      if (!state.frame) state.frame = root.requestAnimationFrame(animate);
    }

    function stopAnimation(clear = true) {
      if (state.frame) root.cancelAnimationFrame(state.frame);
      state.frame = null;
      if (clear && state.ctx) {
        const size = map.getSize();
        state.ctx.clearRect(0, 0, size.x, size.y);
      }
    }

    async function refresh({ force = false } = {}) {
      if (!state.enabled) return;
      const now = Date.now();
      if (!force && state.grid && currentGridCovers(state.grid, map.getBounds()) && now - state.lastFetchAt < MIN_REFRESH_MS) {
        startAnimation();
        return;
      }

      const mobile = root.innerWidth <= 640;
      const spec = buildCoordinateGrid(map.getBounds(), {
        rows: mobile ? 8 : 10,
        cols: mobile ? 10 : 12,
        padRatio: 0.18
      });
      if (!spec) {
        setStatus('此地圖範圍暫不支援風場', 'error');
        return;
      }

      const signature = gridSignature(spec);
      const cached = !force ? readCachedGrid(signature) : null;
      if (cached) {
        state.grid = cached;
        state.lastFetchAt = Date.parse(cached.fetchedAt) || now;
        setStatus(`已載入快取 · ${formatValidTime(cached.validTime)} HKT`, 'ok');
        updateHud();
        startAnimation();
        return;
      }

      const serial = ++state.fetchSerial;
      setStatus('正在載入 ECMWF IFS 10 m 風場…');
      try {
        const grid = await fetchWindGrid(spec);
        if (!state.enabled || serial !== state.fetchSerial) return;
        state.grid = grid;
        state.lastFetchAt = Date.now();
        writeCachedGrid(signature, grid);
        setStatus(`已更新 · ${formatValidTime(grid.validTime)} HKT`, 'ok');
        updateHud();
        seedParticles();
        startAnimation();
      } catch (error) {
        if (!state.enabled || serial !== state.fetchSerial) return;
        setStatus(`風場暫時不可用 · ${error instanceof Error ? error.message : String(error)}`, 'error');
        updateHud();
        stopAnimation(false);
      }
    }

    async function enable() {
      if (state.enabled) return;
      state.enabled = true;
      ensureCanvas();
      updateHud();
      await refresh();
    }

    function disable() {
      if (!state.enabled) return;
      state.enabled = false;
      state.fetchSerial += 1;
      stopAnimation(true);
      state.controls?.hud?.classList.add('hidden');
      setStatus('已關閉 · 模式資料，非官方熱帶氣旋風圈');
    }

    function scheduleRefresh() {
      if (!state.enabled) return;
      clearTimeout(state.moveTimer);
      state.moveTimer = setTimeout(() => {
        if (state.grid && currentGridCovers(state.grid, map.getBounds())) {
          seedParticles();
          startAnimation();
        } else {
          refresh();
        }
      }, 450);
    }

    state.controls = installControls(document, checked => checked ? enable() : disable());
    if (!state.controls) return null;

    map.on('movestart zoomstart', () => {
      if (state.enabled) stopAnimation(true);
    });
    map.on('moveend zoomend', scheduleRefresh);
    map.on('resize', () => {
      resizeCanvas();
      scheduleRefresh();
    });
    document.addEventListener('visibilitychange', () => {
      if (!state.enabled) return;
      if (document.visibilityState === 'hidden') stopAnimation(false);
      else startAnimation();
    });

    return Object.freeze({
      VERSION, enable, disable, refresh,
      getState: () => ({
        enabled: state.enabled,
        validTime: state.grid?.validTime || null,
        fetchedAt: state.grid?.fetchedAt || null
      })
    });
  }

  function autoInstall() {
    if (!root?.document) return null;
    const runtime = root.StormTrackRuntime || (root.StormTrackRuntime = {});
    if (runtime.windFieldController) return runtime.windFieldController;

    const installForMap = map => {
      if (!map || runtime.windFieldController) return runtime.windFieldController || null;
      const controller = createController(map);
      if (controller) runtime.windFieldController = controller;
      return controller;
    };

    if (runtime.map) return installForMap(runtime.map);
    root.addEventListener?.(MAP_READY_EVENT, event => installForMap(event?.detail?.map), { once: true });
    return null;
  }

  return Object.freeze({
    VERSION,
    OPEN_METEO_ENDPOINT,
    parseGmtTime,
    meteorologicalWindToUv,
    buildCoordinateGrid,
    interpolateVector,
    parseOpenMeteoGrid,
    fetchWindGrid,
    createController,
    autoInstall
  });
});
