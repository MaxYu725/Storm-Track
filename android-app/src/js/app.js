// ==========================================================================
// Storm-Track Ultra 2.2 - Active Storm (CHAMPI) + Universal Worker Bridge
// + Keyless Multi-Tile Sea Chart & Clean Progressive Disclosure UI
// ==========================================================================

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 4500 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(resource, { ...options, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

function showUltraToast(msg) {
    const el = document.getElementById('ultra-toast');
    if (!el) return;
    el.innerText = msg;
    el.classList.add('show');
    clearTimeout(window._ultraToastTimer);
    window._ultraToastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ==========================================================================
// 1. THEME MANAGER
// ==========================================================================
const ThemeManager = {
    isLight: false,
    init() {
        try {
            this.isLight = localStorage.getItem('storm_ultra_theme') === 'light';
        } catch (e) {}
        this.apply();
    },
    toggle() {
        this.isLight = !this.isLight;
        try {
            localStorage.setItem('storm_ultra_theme', this.isLight ? 'light' : 'dark');
        } catch (e) {}
        this.apply();
        if (window.RadarMapManager) {
            RadarMapManager.setBaseMapStyle(this.isLight ? 'street' : 'dark');
        }
    },
    apply() {
        document.body.classList.toggle('light-theme', this.isLight);
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) btn.innerText = this.isLight ? '🌙' : '☀️';
    }
};

// ==========================================================================
// 2. NAVIGATION CONTROLLER
// ==========================================================================
const AppNav = {
    currentIndex: 0,
    pageCount: 4,

    init() {
        this.goTo(0, true);
    },

    goTo(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.pageCount) return;
        const pages = Array.from(document.querySelectorAll('.pivot-page'));
        const navTabs = Array.from(document.querySelectorAll('.nav-tab'));

        pages.forEach((p, i) => p.classList.toggle('active', i === index));
        navTabs.forEach((t, i) => t.classList.toggle('active', i === index));

        this.currentIndex = index;
        if (index === 0 && window.RadarMapManager) {
            requestAnimationFrame(() => RadarMapManager.resizeMap());
            setTimeout(() => RadarMapManager.resizeMap(), 180);
        }
    }
};

// ==========================================================================
// 3. 100% KEYLESS TACTICAL SEA CHART ENGINE (Esri + OSM + Built-in Vector Coast)
// ==========================================================================
const RadarMapManager = (function() {
    let map = null;
    let tileLayer = null;
    let coastlineLayer = null;
    let cordonLayer = null;
    let coneLayer = null;
    let tracksLayer = null;
    let stationsLayer = null;
    let sheetExpanded = false;

    // Matches the 4 default checked agencies in MaxYu725/Storm-Track Web (HKO, CMA, JMA, CWA)
    const enabledAgencies = new Set(['HKO', 'CMA', 'JMA', 'CWA']);
    const auxLayers = {
        observedTrack: true,
        windCone: true,
        cordonRings: true,
        hkStations: false
    };

    const TILE_PROVIDERS = {
        dark: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        sat: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        street: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
        ]
    };

    function initMap() {
        const container = document.getElementById('storm-map');
        if (!container || typeof L === 'undefined') return;

        map = L.map('storm-map', {
            zoomControl: false,
            attributionControl: false,
            minZoom: 3,
            maxZoom: 13,
            zoomSnap: 0.25
        }).setView([15.0, 144.0], 4.5);

        coastlineLayer = L.layerGroup().addTo(map);
        cordonLayer = L.layerGroup().addTo(map);
        coneLayer = L.layerGroup().addTo(map);
        tracksLayer = L.layerGroup().addTo(map);
        stationsLayer = L.layerGroup().addTo(map);

        drawBuiltinVectorCoastline();
        setBaseMapStyle(ThemeManager.isLight ? 'street' : 'dark');
        renderAgencyFilterPills();
        drawHkoCordonRings();

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                if (map) map.invalidateSize();
            });
            ro.observe(container);
        }
        setTimeout(() => { if (map) map.invalidateSize(); }, 120);
        setTimeout(() => { if (map) map.invalidateSize(); }, 450);
    }

    function drawBuiltinVectorCoastline() {
        if (!coastlineLayer) return;
        coastlineLayer.clearLayers();

        // Lat/Lon Graticule Grid (0°N–40°N, 100°E–170°E covering full West Pacific including 154.6°E!)
        for (let lat = 0; lat <= 40; lat += 5) {
            L.polyline([[lat, 95], [lat, 175]], {
                color: '#38BDF8',
                weight: 0.5,
                opacity: 0.14,
                interactive: false
            }).addTo(coastlineLayer);
        }
        for (let lon = 100; lon <= 170; lon += 5) {
            L.polyline([[0, lon], [40, lon]], {
                color: '#38BDF8',
                weight: 0.5,
                opacity: 0.14,
                interactive: false
            }).addTo(coastlineLayer);
        }

        (window.BUILTIN_COASTLINE_POLYLINES || []).forEach(poly => {
            L.polyline(poly, {
                color: '#38BDF8',
                weight: 1.3,
                opacity: 0.38,
                lineJoin: 'round',
                interactive: false
            }).addTo(coastlineLayer);
        });
    }

    function setBaseMapStyle(style) {
        document.querySelectorAll('#basemap-style-chips .layer-chip').forEach(el => {
            el.classList.toggle('active', el.dataset.style === style);
        });

        if (!map) return;
        if (tileLayer) {
            map.removeLayer(tileLayer);
            tileLayer = null;
        }
        if (style === 'vector') {
            drawBuiltinVectorCoastline();
            return;
        }

        const urls = TILE_PROVIDERS[style] || TILE_PROVIDERS.dark;
        const attachTileUrl = (idx) => {
            if (tileLayer) map.removeLayer(tileLayer);
            if (idx >= urls.length) return;
            let errorCount = 0;
            tileLayer = L.tileLayer(urls[idx], { maxZoom: 13, crossOrigin: true });
            tileLayer.on('tileerror', () => {
                errorCount++;
                if (errorCount > 4 && idx + 1 < urls.length) attachTileUrl(idx + 1);
            });
            tileLayer.addTo(map);
            tileLayer.bringToBack();
        };
        attachTileUrl(0);
    }

    function ToggleLayerPopover() {
        const pop = document.getElementById('map-layer-popover');
        if (pop) pop.classList.toggle('hidden');
    }

    function renderAgencyFilterPills() {
        const container = document.getElementById('agency-layer-pills');
        if (!container) return;
        container.innerHTML = window.STORM_AGENCIES.map(ag => {
            const isAct = enabledAgencies.has(ag.id);
            return `<div class="layer-chip ${isAct ? 'active' : ''}" onclick="RadarMapManager.toggleAgency('${ag.id}')">
                <span class="agency-dot" style="background:${ag.color};"></span>
                <span>${ag.short}</span>
            </div>`;
        }).join('');
    }

    function toggleAgency(agencyId) {
        if (enabledAgencies.has(agencyId)) {
            if (enabledAgencies.size <= 1) return;
            enabledAgencies.delete(agencyId);
        } else {
            enabledAgencies.add(agencyId);
        }
        renderAgencyFilterPills();
        StormApp.refreshAllViews();
    }

    function toggleAuxLayer(key) {
        auxLayers[key] = !auxLayers[key];
        const mapId = {
            observedTrack: 'chip-toggle-obs',
            windCone: 'chip-toggle-cone',
            cordonRings: 'chip-toggle-rings',
            hkStations: 'chip-toggle-stations'
        };
        const chip = document.getElementById(mapId[key]);
        if (chip) chip.classList.toggle('active', auxLayers[key]);
        drawHkoCordonRings();
        StormApp.refreshAllViews();
    }

    function toggleBottomSheet() {
        sheetExpanded = !sheetExpanded;
        const body = document.getElementById('sheet-expanded-body');
        const pill = document.getElementById('sheet-toggle-pill');
        if (body) body.classList.toggle('hidden', !sheetExpanded);
        if (pill) pill.innerText = sheetExpanded ? '收起 ▾' : '展開詳情 ▴';
    }

    function drawHkoCordonRings() {
        if (!cordonLayer) return;
        cordonLayer.clearLayers();

        const hkoIcon = L.divIcon({
            className: '',
            html: `<div class="hko-hq-dot" title="香港天文台 HKO"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });
        L.marker([window.HKO_HQ.lat, window.HKO_HQ.lon], { icon: hkoIcon })
            .bindPopup('<b>🇭🇰 香港天文台總部</b><br>22.3022°N, 114.1746°E')
            .addTo(cordonLayer);

        if (!auxLayers.cordonRings) return;

        [400, 800].forEach(rKm => {
            L.circle([window.HKO_HQ.lat, window.HKO_HQ.lon], {
                radius: rKm * 1000,
                color: rKm === 400 ? '#F59E0B' : '#64748B',
                weight: 1,
                opacity: 0.35,
                fillOpacity: 0,
                dashArray: '4, 6',
                interactive: false
            }).addTo(cordonLayer);
        });
    }

    function renderMapContent(stormCase, consensusTrack, currentIdx, threatEval) {
        if (!map || !tracksLayer || !coneLayer || !stationsLayer) return;
        tracksLayer.clearLayers();
        coneLayer.clearLayers();
        stationsLayer.clearLayers();

        if (auxLayers.hkStations && threatEval && threatEval.localWinds) {
            threatEval.localWinds.stations.forEach(sta => {
                const col = sta.level === 'storm' ? '#C084FC' : (sta.level === 'gale' ? '#EF4444' : (sta.level === 'strong' ? '#F59E0B' : '#10B981'));
                const icon = L.divIcon({
                    className: '',
                    html: `<div style="background:rgba(10,15,28,0.88);border:1px solid ${col};color:#fff;padding:1px 4px;border-radius:5px;font-size:0.6rem;font-weight:700;white-space:nowrap;">${sta.name} ${sta.sustainedKmh}</div>`,
                    iconSize: [52, 16],
                    iconAnchor: [26, 8]
                });
                L.marker([sta.lat, sta.lon], { icon }).addTo(stationsLayer);
            });
        }

        if (!stormCase || !consensusTrack || consensusTrack.length === 0) return;

        const currentPt = consensusTrack[currentIdx] || consensusTrack[0];

        // 1. Draw Observed / Analysis Past Track (Solid Emerald Green Line + Green Dots, matching Web screenshot!)
        if (auxLayers.observedTrack && Array.isArray(stormCase.observedTrack) && stormCase.observedTrack.length > 0) {
            const obsLatLngs = stormCase.observedTrack.map(p => [p.lat, p.lon]);
            L.polyline(obsLatLngs, {
                color: '#22C55E',
                weight: 2.5,
                opacity: 0.92
            }).addTo(tracksLayer);

            stormCase.observedTrack.forEach(p => {
                L.circleMarker([p.lat, p.lon], {
                    radius: 3.8,
                    color: '#060A14',
                    weight: 1,
                    fillColor: '#22C55E',
                    fillOpacity: 0.95
                }).bindPopup(`<b>實測 / 分析位置</b><br>座標：${p.lat.toFixed(1)}°N, ${p.lon.toFixed(1)}°E<br>風速：${p.windKmh || '--'} km/h`)
                  .addTo(tracksLayer);
            });
        }

        // 2. Draw Wind Radii & Cone around Current Point
        if (auxLayers.windCone && currentPt) {
            const { r30, r50 } = currentPt.radii;
            if (r30 > 0) {
                L.circle([currentPt.lat, currentPt.lon], {
                    radius: r30 * 1000,
                    color: '#38BDF8',
                    weight: 1.2,
                    dashArray: '4,4',
                    fillColor: '#38BDF8',
                    fillOpacity: 0.08,
                    interactive: false
                }).addTo(coneLayer);
            }
            if (r50 > 0) {
                L.circle([currentPt.lat, currentPt.lon], {
                    radius: r50 * 1000,
                    color: '#EF4444',
                    weight: 1.5,
                    fillColor: '#EF4444',
                    fillOpacity: 0.14,
                    interactive: false
                }).addTo(coneLayer);
            }
        }

        // 3. Draw Forecast Tracks for HKO (White), CMA (Red), JMA (Cyan), CWA (Yellow), JTWC, Consensus
        window.STORM_AGENCIES.forEach(ag => {
            if (!enabledAgencies.has(ag.id)) return;
            const pts = ag.isConsensus ? consensusTrack : (stormCase.agencies[ag.id] || []);
            if (!pts || pts.length === 0) return;

            const latlngs = pts.map(p => [p.lat, p.lon]);
            L.polyline(latlngs, {
                color: ag.color,
                weight: ag.isConsensus ? 3.2 : 2.2,
                opacity: 0.92,
                dashArray: ag.dashed ? '6, 5' : null
            }).addTo(tracksLayer);

            pts.forEach((p, idx) => {
                const m = L.circleMarker([p.lat, p.lon], {
                    radius: ag.isConsensus ? 4.5 : 3.8,
                    color: '#060A14',
                    weight: 1.2,
                    fillColor: ag.color,
                    fillOpacity: 0.95
                }).addTo(tracksLayer);

                const hLbl = p.h === 0 ? '最新實況' : (p.h > 0 ? `+${p.h}h 預測` : `${p.h}h`);
                m.bindPopup(`<b>${ag.name} (${hLbl})</b><br>位置：${p.lat.toFixed(1)}°N, ${p.lon.toFixed(1)}°E<br>中心風速：${p.windKmh} km/h<br>中心氣壓：${p.pres} hPa`);
                if (ag.isConsensus) {
                    m.on('click', () => StormApp.setTimelineIndex(idx));
                }
            });
        });

        // 4. Draw Glowing Current Position + Floating Storm Name Badge (e.g. "薔琵 (CHAMPI)") matching Web Screenshot!
        if (currentPt) {
            const labelTitle = stormCase.displayTitle || `${stormCase.nameZh} (${stormCase.nameEn})`;
            const eyeHtml = `
                <div style="display:flex;align-items:center;gap:6px;">
                    <div class="typhoon-eye-marker">
                        <svg class="typhoon-core-svg" viewBox="0 0 64 64">
                            <path d="M32 6 C16 6 6 20 10 36 C12 22 22 16 32 16 C42 16 48 24 46 34 C54 20 46 6 32 6 Z" fill="${currentPt.category.color}"/>
                            <path d="M32 58 C48 58 58 44 54 28 C52 42 42 48 32 48 C22 48 16 40 18 30 C10 44 18 58 32 58 Z" fill="${currentPt.category.color}"/>
                            <circle cx="32" cy="32" r="9" fill="#060A14" stroke="#ffffff" stroke-width="3"/>
                        </svg>
                    </div>
                    <div style="background:rgba(10,15,28,0.92);border:1px solid rgba(255,255,255,0.22);color:#fff;padding:2px 7px;border-radius:6px;font-size:0.7rem;font-weight:800;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.6);">
                        ${labelTitle}
                    </div>
                </div>
            `;
            const eyeIcon = L.divIcon({
                className: '',
                html: eyeHtml,
                iconSize: [140, 28],
                iconAnchor: [14, 14]
            });
            L.marker([currentPt.lat, currentPt.lon], { icon: eyeIcon, zIndexOffset: 1000 }).addTo(tracksLayer);
        }
    }

    function focusStormCenter() {
        if (!map) return;
        const pop = document.getElementById('map-layer-popover');
        if (pop) pop.classList.add('hidden');

        const sc = StormApp.getActiveCase();
        const cons = StormApp.getConsensusTrack();
        if (cons && cons.length > 0) {
            const lats = cons.map(p => p.lat);
            const lons = cons.map(p => p.lon);
            if (sc && Array.isArray(sc.observedTrack)) {
                sc.observedTrack.forEach(p => { lats.push(p.lat); lons.push(p.lon); });
            }
            const minLat = Math.min(...lats), maxLat = Math.max(...lats);
            const minLon = Math.min(...lons), maxLon = Math.max(...lons);
            map.flyToBounds([[minLat - 2.5, minLon - 3.5], [maxLat + 2.5, maxLon + 3.5]], {
                padding: [30, 30],
                maxZoom: 6.2,
                duration: 0.7
            });
        }
    }

    function focusHongKong() {
        if (!map) return;
        const pop = document.getElementById('map-layer-popover');
        if (pop) pop.classList.add('hidden');
        map.flyTo([window.HKO_HQ.lat, window.HKO_HQ.lon], 7.0, { duration: 0.7 });
    }

    function zoomIn() { if (map) map.zoomIn(0.8); }
    function zoomOut() { if (map) map.zoomOut(0.8); }
    function resizeMap() { if (map) map.invalidateSize(); }

    return {
        initMap,
        setBaseMapStyle,
        ToggleLayerPopover,
        toggleAgency,
        toggleAuxLayer,
        toggleBottomSheet,
        renderMapContent,
        focusStormCenter,
        focusHongKong,
        zoomIn,
        zoomOut,
        resizeMap
    };
})();

// ==========================================================================
// 4. AGENCY TABLE CONTROLLER
// ==========================================================================
const AgencyLabManager = {
    selectedHorizon: 0,

    setHorizon(h) {
        this.selectedHorizon = h;
        document.querySelectorAll('#agency-horizon-bar .horizon-pill').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.h) === h);
        });
        StormApp.refreshAllViews();
    },

    render(stormCase, consensusTrack) {
        const tbody = document.getElementById('agency-compare-tbody');
        const spreadBadge = document.getElementById('consensus-spread-badge');
        const cpaBarsEl = document.getElementById('agency-cpa-bars');
        if (!tbody || !stormCase || !consensusTrack || consensusTrack.length === 0) return;

        const h = this.selectedHorizon;
        const consPt = consensusTrack.find(p => p.h === h) || consensusTrack[0];
        if (spreadBadge && consPt) {
            spreadBadge.innerText = `分歧 ±${consPt.spreadKm} km`;
        }

        tbody.innerHTML = window.STORM_AGENCIES.map(ag => {
            const pt = ag.isConsensus ? consPt : StormEngine.interpolateAgencyAtHour(stormCase.agencies[ag.id], h);
            if (!pt) return '';
            const distHk = Math.round(StormEngine.haversineKm(window.HKO_HQ.lat, window.HKO_HQ.lon, pt.lat, pt.lon));
            const cat = StormEngine.classifyHkoCategory(pt.windKmh);
            return `<tr style="${ag.isConsensus ? 'background:rgba(0,245,212,0.08);font-weight:700;' : ''}">
                <td><span style="display:inline-flex;align-items:center;gap:5px;font-weight:800;"><span class="agency-dot" style="background:${ag.color};"></span>${ag.short}</span></td>
                <td>${pt.lat.toFixed(1)}°N, ${pt.lon.toFixed(1)}°E</td>
                <td style="color:${cat.color};font-weight:800;">${pt.windKmh} km/h</td>
                <td>${pt.pres} hPa</td>
                <td style="color:var(--accent-color);font-weight:800;">${distHk} km</td>
            </tr>`;
        }).join('');

        if (cpaBarsEl) {
            const cpaList = window.STORM_AGENCIES.map(ag => {
                const tr = ag.isConsensus ? consensusTrack : (stormCase.agencies[ag.id] || []);
                if (!tr || tr.length === 0) return null;
                const cpa = StormEngine.computeCPA(tr, stormCase.baseTime);
                return cpa ? { ag, cpa } : null;
            }).filter(Boolean).sort((a, b) => a.cpa.cpaDistKm - b.cpa.cpaDistKm);

            cpaBarsEl.innerHTML = cpaList.map(({ ag, cpa }) => {
                const pct = Math.max(12, Math.min(100, Math.round((1 - Math.min(cpa.cpaDistKm, 2200) / 2200) * 100)));
                return `<div class="signal-prob-row">
                    <div class="signal-prob-top">
                        <span><span class="agency-dot" style="background:${ag.color};display:inline-block;margin-right:5px;"></span>${ag.name}</span>
                        <span style="color:${ag.color};">${cpa.cpaDistKm} km (${cpa.cpaTimeStr})</span>
                    </div>
                    <div class="signal-prob-track">
                        <div class="signal-prob-fill" style="width:${pct}%;background:${ag.color};"></div>
                    </div>
                </div>`;
            }).join('');
        }
    }
};

// ==========================================================================
// 5. MAIN STORM-TRACK ULTRA 2.2 ORCHESTRATOR
// ==========================================================================
const StormApp = (function() {
    let liveStorms = [...(window.DEFAULT_LIVE_STORMS || [])];
    let currentStorm = liveStorms[0];
    let consensusTrack = [];
    let currentTimelineIdx = 0;
    let playTimer = null;

    let liveHkoState = {
        temp: 26,
        rh: 78,
        warningText: '🟢 現時無生效熱帶氣旋警告'
    };
    let liveStationsWinds = null;

    function init() {
        RadarMapManager.initMap();
        // Check if build-time bridge discovered initial live payload
        if (window.STORM_TRACK_INITIAL_LIVE_PAYLOAD) {
            const parsed = StormEngine.parseAnyWorkerPayload(window.STORM_TRACK_INITIAL_LIVE_PAYLOAD);
            if (parsed.length > 0) {
                liveStorms = parsed;
            }
        }
        loadStormObject(liveStorms[0], false);
        syncLiveAll(false);
    }

    function getActiveCase() {
        return currentStorm;
    }

    function getConsensusTrack() {
        return consensusTrack;
    }

    function getCurrentPoint() {
        if (!consensusTrack || consensusTrack.length === 0) return null;
        return consensusTrack[currentTimelineIdx] || consensusTrack[0];
    }

    function loadStormObject(stormObj, notify = true) {
        if (!stormObj) return;
        stopTimelinePlay();
        currentStorm = stormObj;
        consensusTrack = StormEngine.buildConsensusTrack(currentStorm.agencies, [0, 12, 24, 36, 48, 72, 96, 120]);
        currentTimelineIdx = 0;

        const slider = document.getElementById('timeline-scrubber');
        if (slider) {
            slider.max = String(Math.max(0, consensusTrack.length - 1));
            slider.value = '0';
        }

        refreshAllViews();
        setTimeout(() => RadarMapManager.focusStormCenter(), 100);
        if (notify) {
            showUltraToast(`🌀 已載入：${currentStorm.displayTitle || currentStorm.nameZh}`);
        }
    }

    async function syncLiveAll(manual = false) {
        const candidateUrls = [
            ...(window.DISCOVERED_WORKER_URLS || []),
            'https://storm.max-yu.workers.dev',
            'https://storm.max-yu.workers.dev/api/storms',
            'https://storm.max-yu.workers.dev/storms',
            'https://storm.max-yu.workers.dev/data'
        ];
        const uniqueUrls = [...new Set(candidateUrls)];

        for (const url of uniqueUrls) {
            try {
                const res = await fetchWithTimeout(url, { timeout: 3800 });
                if (res.ok) {
                    const json = await res.json();
                    const parsed = StormEngine.parseAnyWorkerPayload(json);
                    if (parsed && parsed.length > 0) {
                        liveStorms = parsed;
                        if (currentStorm && currentStorm.isLive) {
                            currentStorm = liveStorms[0];
                            consensusTrack = StormEngine.buildConsensusTrack(currentStorm.agencies, [0, 12, 24, 36, 48, 72, 96, 120]);
                        }
                        break;
                    }
                }
            } catch (e) {}
        }

        // Fetch HKO Open Data & Open-Meteo 8 Stations
        try {
            const [rhrRes, warnRes] = await Promise.allSettled([
                fetchWithTimeout('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc', { timeout: 3500 }),
                fetchWithTimeout('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc', { timeout: 3500 })
            ]);
            if (rhrRes.status === 'fulfilled' && rhrRes.value.ok) {
                const rhr = await rhrRes.value.json();
                if (rhr.temperature?.data?.length > 0) {
                    const hkoT = rhr.temperature.data.find(d => d.place === '香港天文台') || rhr.temperature.data[0];
                    liveHkoState.temp = hkoT.value;
                }
                if (rhr.humidity?.data?.length > 0) {
                    liveHkoState.rh = rhr.humidity.data[0].value;
                }
            }
            if (warnRes.status === 'fulfilled' && warnRes.value.ok) {
                const warn = await warnRes.value.json();
                const keys = Object.keys(warn || {});
                liveHkoState.warningText = keys.length > 0
                    ? `⚠️ 生效警告：${keys.map(k => warn[k].name || k).join('、')}`
                    : '🟢 現時無生效熱帶氣旋警告';
            }
        } catch (e) {}

        try {
            const lats = window.HKO_REFERENCE_STATIONS.map(s => s.lat).join(',');
            const lons = window.HKO_REFERENCE_STATIONS.map(s => s.lon).join(',');
            const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m&timezone=Asia%2FHong_Kong`;
            const omRes = await fetchWithTimeout(omUrl, { timeout: 3800 });
            if (omRes.ok) {
                const omJson = await omRes.json();
                const arr = Array.isArray(omJson) ? omJson : [omJson];
                let strongCount = 0, galeCount = 0, stormCount = 0;
                const stations = window.HKO_REFERENCE_STATIONS.map((sta, i) => {
                    const cur = (arr[i] && arr[i].current) ? arr[i].current : (arr[0]?.current || {});
                    const sustainedKmh = Math.max(4, Math.round(Number(cur.wind_speed_10m ?? 16)));
                    const gustKmh = Math.max(sustainedKmh + 5, Math.round(Number(cur.wind_gusts_10m ?? (sustainedKmh * 1.4))));
                    const windDirZh = StormEngine.compass16Zh(Number(cur.wind_direction_10m ?? 85));
                    let level = 'normal', statusZh = '清勁 (<41)';
                    if (sustainedKmh >= 88) { level = 'storm'; statusZh = '暴風 (≥88)'; stormCount++; galeCount++; strongCount++; }
                    else if (sustainedKmh >= 63) { level = 'gale'; statusZh = '烈風 (≥63)'; galeCount++; strongCount++; }
                    else if (sustainedKmh >= 41) { level = 'strong'; statusZh = '強風 (≥41)'; strongCount++; }
                    return { ...sta, sustainedKmh, gustKmh, windDirZh, level, statusZh };
                });
                liveStationsWinds = { stations, strongCount, galeCount, stormCount };
            }
        } catch (e) {}

        refreshAllViews();
        if (manual) {
            showUltraToast(`✅ 已同步活躍風暴：${currentStorm.displayTitle || currentStorm.nameZh}`);
        }
    }

    function selectLiveStorm(idx) {
        const st = liveStorms[idx];
        if (!st) return;
        loadStormObject(st, true);
        AppNav.goTo(0);
    }

    function selectCaseFromArchive(caseId) {
        const sc = window.STORM_CASES_ARCHIVE.find(c => c.id === caseId);
        if (!sc) return;
        loadStormObject(sc, true);
        AppNav.goTo(0);
    }

    function setTimelineIndex(idx) {
        if (!consensusTrack || idx < 0 || idx >= consensusTrack.length) return;
        currentTimelineIdx = idx;
        const slider = document.getElementById('timeline-scrubber');
        if (slider) slider.value = String(idx);
        refreshAllViews();
    }

    function toggleTimelinePlay() {
        if (!consensusTrack || consensusTrack.length === 0) return;
        if (playTimer) {
            stopTimelinePlay();
            return;
        }
        const btn = document.getElementById('btn-play-scrubber');
        if (btn) btn.innerText = '⏸';
        playTimer = setInterval(() => {
            const nextIdx = (currentTimelineIdx + 1) % consensusTrack.length;
            setTimelineIndex(nextIdx);
        }, 1200);
    }

    function stopTimelinePlay() {
        if (playTimer) {
            clearInterval(playTimer);
            playTimer = null;
        }
        const btn = document.getElementById('btn-play-scrubber');
        if (btn) btn.innerText = '▶';
    }

    function jumpToCPA() {
        if (!consensusTrack || consensusTrack.length === 0) return;
        stopTimelinePlay();
        let bestIdx = 0, minD = Infinity;
        consensusTrack.forEach((pt, idx) => {
            if (pt.distHk < minD) { minD = pt.distHk; bestIdx = idx; }
        });
        setTimelineIndex(bestIdx);
        showUltraToast(`⚡ 已跳至預測最近距港時刻 (${minD} km)`);
    }

    function refreshAllViews() {
        const sc = getActiveCase();
        const currentPt = getCurrentPoint();
        if (!sc || !currentPt) return;

        const bestAgencyCpa = StormEngine.computeBestAgencyCPA(sc);
        const cpaInfo = bestAgencyCpa || StormEngine.computeCPA(consensusTrack, sc.baseTime);
        const threatEval = StormEngine.evaluateHkThreatV2(currentPt, consensusTrack, cpaInfo, liveStationsWinds);

        const titleStr = sc.displayTitle || `${sc.nameZh} (${sc.nameEn})`;
        const cpaSummary = sc.cpaSummaryText || (bestAgencyCpa ? `${bestAgencyCpa.cpaDistKm} km ( ${bestAgencyCpa.agencyId} )` : `${cpaInfo.cpaDistKm} km`);
        const posStr = `${currentPt.lat.toFixed(1)}°N, ${currentPt.lon.toFixed(1)}°E`;
        const activeSrcList = sc.activeSources || Object.keys(sc.agencies || {});

        // 1. Update Top Header Bar
        const topDot = document.getElementById('top-mode-dot');
        const topTxt = document.getElementById('top-mode-text');
        if (topDot) topDot.className = sc.isLive ? 'live-dot alert' : 'live-dot sim';
        if (topTxt) {
            topTxt.innerText = `${sc.isLive ? '活躍風暴' : '歷史檔案'}：${titleStr}`;
        }

        // 2. Update Bottom Sheet on Radar Map
        document.getElementById('sheet-title-text').innerText = `${titleStr} • ${currentPt.category.nameZh}`;
        document.getElementById('sheet-subtitle-text').innerText = `最新位置：${posStr} • 預測最近距港：${cpaSummary}`;
        document.getElementById('hud-sources-badges').innerText = `來源：${activeSrcList.join(' / ')}`;
        document.getElementById('hud-bulletin-time').innerText = `最近公報：${sc.bulletinTime || '實時更新'}`;
        document.getElementById('hud-pos-val').innerText = posStr;
        document.getElementById('hud-max-wind').innerText = `${currentPt.windKmh} km/h`;
        document.getElementById('hud-min-pres').innerText = `${currentPt.pres} hPa`;
        document.getElementById('hud-cpa-val').innerText = cpaSummary;

        // 3. Render Map Content
        RadarMapManager.renderMapContent(sc, consensusTrack, currentTimelineIdx, threatEval);

        // 4. Render Page 1: Storm Details & HK Threat
        document.getElementById('threat-active-storm-name').innerText = `🌀 ${sc.isLive ? '活躍風暴' : '歷史個案'}：${titleStr}`;
        document.getElementById('threat-info-intensity').innerText = currentPt.category.nameZh;
        document.getElementById('threat-info-bulletin').innerText = sc.bulletinTime || '最新公報';
        document.getElementById('threat-info-pos').innerText = posStr;
        document.getElementById('threat-info-cpa').innerText = cpaSummary;

        const tagsEl = document.getElementById('threat-agency-tags');
        if (tagsEl) {
            const agColorMap = { HKO: '#FFFFFF', CMA: '#FF4D4F', JMA: '#38BDF8', CWA: '#FACC15', JTWC: '#FB923C' };
            tagsEl.innerHTML = activeSrcList.map(k => {
                const col = agColorMap[k] || '#38BDF8';
                return `<span style="font-size:0.68rem;font-weight:800;padding:2px 7px;border-radius:5px;border:1px solid ${col};color:${col};background:rgba(0,0,0,0.3);">${k}</span>`;
            }).join('');
        }

        document.getElementById('hko-live-temp').innerText = `${liveHkoState.temp}°C`;
        document.getElementById('hko-live-rh').innerText = `相對濕度 ${liveHkoState.rh}%`;
        document.getElementById('hko-live-warn-badge').innerText = liveHkoState.warningText;

        const recSigEl = document.getElementById('threat-rec-signal');
        if (recSigEl) {
            recSigEl.innerText = threatEval.recSignal;
            recSigEl.style.color = threatEval.recBadgeColor;
        }

        const lw = threatEval.localWinds;
        const staSumEl = document.getElementById('threat-8sta-summary');
        if (staSumEl && lw) {
            staSumEl.innerText = `強風 ${lw.strongCount}/8 • 烈風 ${lw.galeCount}/8 ▾`;
        }

        const probListEl = document.getElementById('signal-prob-list');
        if (probListEl) {
            probListEl.innerHTML = threatEval.probabilities.map(s => `
                <div class="signal-prob-row">
                    <div class="signal-prob-top">
                        <span><b style="color:${s.color};margin-right:6px;">${s.code}</b>${s.name}</span>
                        <span style="color:${s.color};">${s.prob}%</span>
                    </div>
                    <div class="signal-prob-track">
                        <div class="signal-prob-fill" style="width:${s.prob}%;background:${s.color};"></div>
                    </div>
                </div>
            `).join('');
        }

        const staGridEl = document.getElementById('ref-stations-grid');
        if (staGridEl && lw) {
            staGridEl.innerHTML = lw.stations.map(st => `
                <div class="ref-sta-card ${st.level}">
                    <div style="display:flex;justify-content:space-between;font-size:0.78rem;font-weight:800;">
                        <span>${st.name}</span>
                        <span style="color:var(--sub-text);font-size:0.68rem;">${st.windDirZh}風</span>
                    </div>
                    <div style="font-size:1.05rem;font-weight:900;margin-top:2px;">
                        ${st.sustainedKmh} <span style="font-size:0.66rem;font-weight:600;color:var(--sub-text);">km/h (陣風 ${st.gustKmh})</span>
                    </div>
                </div>
            `).join('');
        }

        const bulletsEl = document.getElementById('situation-analysis-bullets');
        if (bulletsEl) {
            bulletsEl.innerHTML = threatEval.bullets.map(b => `
                <div style="padding:8px 10px;border-radius:10px;background:rgba(255,255,255,0.04);border-left:3px solid var(--accent-color);">
                    ${b}
                </div>
            `).join('');
        }

        // 5. Render Page 2: Agency Comparison Table
        AgencyLabManager.render(sc, consensusTrack);

        // 6. Render Page 3: Active Storms & Historical Archive Lists
        renderStormLists();
    }

    function renderStormLists() {
        const liveListEl = document.getElementById('live-active-storms-list');
        if (liveListEl) {
            const agColorMap = { HKO: '#FFFFFF', CMA: '#FF4D4F', JMA: '#38BDF8', CWA: '#FACC15', JTWC: '#FB923C' };
            liveListEl.innerHTML = liveStorms.map((st, idx) => {
                const isAct = currentStorm && currentStorm.id === st.id;
                const bestCpa = StormEngine.computeBestAgencyCPA(st);
                const cpaStr = st.cpaSummaryText || (bestCpa ? `${bestCpa.cpaDistKm} km ( ${bestCpa.agencyId} )` : '--');
                const badgesHtml = (st.activeSources || []).map(k => {
                    const col = agColorMap[k] || '#38BDF8';
                    return `<span style="font-size:0.66rem;font-weight:800;padding:1px 6px;border-radius:4px;border:1px solid ${col};color:${col};">${k}</span>`;
                }).join(' ');

                return `<div class="clean-card" onclick="StormApp.selectLiveStorm(${idx})" style="cursor:pointer;border-color:${isAct ? 'var(--accent-color)' : 'var(--glass-border)'};background:linear-gradient(135deg, rgba(16,185,129,0.12), rgba(15,23,42,0.9));">
                    <div class="card-header-row">
                        <div class="card-title" style="font-size:0.95rem;">🌀 ${st.displayTitle || st.nameZh}</div>
                        <button class="chip-btn primary" onclick="event.stopPropagation();StormApp.selectLiveStorm(${idx})" style="padding:4px 10px;font-size:0.7rem;">定位</button>
                    </div>
                    <div style="display:flex;gap:5px;margin-top:6px;">${badgesHtml}</div>
                    <div style="font-size:0.76rem;color:var(--sub-text);margin-top:8px;line-height:1.55;">
                        強度：<b style="color:var(--text-color);">${st.categoryName}</b><br>
                        最新位置：<b style="color:var(--accent-color);">${st.latestPosText || '11.3°N, 154.6°E'}</b><br>
                        最近公報：<b>${st.bulletinTime || '16/10 08:00'}</b><br>
                        預測最近距港：<b style="color:#FF2E63;">${cpaStr}</b>
                    </div>
                </div>`;
            }).join('');
        }

        const archiveListEl = document.getElementById('replay-cases-list');
        if (archiveListEl) {
            archiveListEl.innerHTML = window.STORM_CASES_ARCHIVE.map(c => {
                const isAct = currentStorm && currentStorm.id === c.id;
                return `<div class="clean-card" onclick="StormApp.selectCaseFromArchive('${c.id}')" style="cursor:pointer;border-color:${isAct ? 'var(--accent-color)' : 'var(--glass-border)'};">
                    <div class="card-header-row">
                        <div class="card-title">⏪ ${c.code} ${c.displayTitle || c.nameZh}</div>
                        <span class="card-badge" style="background:${c.badgeColor};color:#fff;">${c.peakSignal}</span>
                    </div>
                    <div style="font-size:0.75rem;color:var(--sub-text);margin-top:6px;line-height:1.4;">${c.summary}</div>
                </div>`;
            }).join('');
        }
    }

    return {
        init,
        getActiveCase,
        getConsensusTrack,
        getCurrentPoint,
        syncLiveAll,
        selectLiveStorm,
        selectCaseFromArchive,
        setTimelineIndex,
        toggleTimelinePlay,
        jumpToCPA,
        refreshAllViews
    };
})();

window.ThemeManager = ThemeManager;
window.AppNav = AppNav;
window.RadarMapManager = RadarMapManager;
window.AgencyLabManager = AgencyLabManager;
window.StormApp = StormApp;
