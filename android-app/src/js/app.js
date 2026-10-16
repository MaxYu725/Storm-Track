// ==========================================================================
// Storm-Track Ultra 2.1 - De-cluttered Map, 100% Keyless Multi-Tile Engine
// & Real-Time Live Cyclone + HKO / JMA / Open-Meteo Telemetry Controller
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

    goTo(index, immediate = false) {
        if (!Number.isInteger(index) || index < 0 || index >= this.pageCount) return;
        const pages = Array.from(document.querySelectorAll('.pivot-page'));
        const navTabs = Array.from(document.querySelectorAll('.nav-tab'));

        pages.forEach((p, i) => {
            p.classList.toggle('active', i === index);
        });
        navTabs.forEach((t, i) => {
            t.classList.toggle('active', i === index);
        });

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
    let currentStyle = 'dark';
    let sheetExpanded = false;

    // Default only HKO + CONSENSUS on so the map is super clean!
    const enabledAgencies = new Set(['CONSENSUS', 'HKO']);
    const auxLayers = {
        windCone: true,
        cordonRings: true,
        hkStations: false
    };

    // 100% Free, Keyless Tile Providers that NEVER show "API Key Required" in Android WebView
    const TILE_PROVIDERS = {
        dark: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'
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
        }).setView([20.8, 115.2], 5.6);

        coastlineLayer = L.layerGroup().addTo(map);
        cordonLayer = L.layerGroup().addTo(map);
        coneLayer = L.layerGroup().addTo(map);
        tracksLayer = L.layerGroup().addTo(map);
        stationsLayer = L.layerGroup().addTo(map);

        // Always draw built-in vector coastlines & lat/lon grid so map is NEVER blank even offline!
        drawBuiltinVectorCoastline();
        setBaseMapStyle(ThemeManager.isLight ? 'street' : 'dark');
        renderAgencyFilterPills();
        drawHkoCordonRings();

        // Automatically fix map size whenever container resizes in Android WebView
        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => {
                if (map) map.invalidateSize();
            });
            ro.observe(container);
        }
        setTimeout(() => { if (map) map.invalidateSize(); }, 120);
        setTimeout(() => { if (map) map.invalidateSize(); }, 500);
    }

    function drawBuiltinVectorCoastline() {
        if (!coastlineLayer) return;
        coastlineLayer.clearLayers();

        // Subtle Lat/Lon Tactical Graticule Grid (10°N–35°N, 105°E–135°E)
        for (let lat = 10; lat <= 35; lat += 5) {
            L.polyline([[lat, 100], [lat, 140]], {
                color: '#38BDF8',
                weight: 0.5,
                opacity: 0.16,
                interactive: false
            }).addTo(coastlineLayer);
        }
        for (let lon = 105; lon <= 135; lon += 5) {
            L.polyline([[5, lon], [38, lon]], {
                color: '#38BDF8',
                weight: 0.5,
                opacity: 0.16,
                interactive: false
            }).addTo(coastlineLayer);
        }

        // Crisp Built-in East Asia & South China Sea Coastlines
        (window.BUILTIN_COASTLINE_POLYLINES || []).forEach(poly => {
            L.polyline(poly, {
                color: '#38BDF8',
                weight: 1.4,
                opacity: 0.42,
                lineJoin: 'round',
                interactive: false
            }).addTo(coastlineLayer);
        });
    }

    function setBaseMapStyle(style) {
        currentStyle = style;
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
        let providerIdx = 0;

        const attachTileUrl = (idx) => {
            if (tileLayer) map.removeLayer(tileLayer);
            if (idx >= urls.length) return; // Fallback to built-in vector coastline
            let errorCount = 0;
            tileLayer = L.tileLayer(urls[idx], {
                maxZoom: 13,
                crossOrigin: true
            });
            tileLayer.on('tileerror', () => {
                errorCount++;
                if (errorCount > 4 && idx + 1 < urls.length) {
                    attachTileUrl(idx + 1);
                }
            });
            tileLayer.addTo(map);
            tileLayer.bringToBack();
        };

        attachTileUrl(providerIdx);
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

    // Minimalist HKO Cordon Rings (Only 400km and 800km subtle dashed lines, no giant text boxes)
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

    function renderMapContent(mode, stormCase, consensusTrack, currentIdx, threatEval) {
        if (!map || !tracksLayer || !coneLayer || !stationsLayer) return;
        tracksLayer.clearLayers();
        coneLayer.clearLayers();
        stationsLayer.clearLayers();

        // Always render HK 8 stations if toggled OR when in Live Quiet Mode
        if ((auxLayers.hkStations || mode === 'LIVE_QUIET') && threatEval && threatEval.localWinds) {
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

        // If Live Mode has NO active tropical cyclones in NW Pacific, keep the map super clean!
        if (mode === 'LIVE_QUIET' || !stormCase || !consensusTrack || consensusTrack.length === 0) {
            return;
        }

        const currentPt = consensusTrack[currentIdx] || consensusTrack[0];

        // 1. Subtle 70% Cone & Active Gale/Storm Radii
        if (auxLayers.windCone && currentPt) {
            const { r30, r50 } = currentPt.radii;
            if (r30 > 0) {
                L.circle([currentPt.lat, currentPt.lon], {
                    radius: r30 * 1000,
                    color: '#F59E0B',
                    weight: 1.2,
                    dashArray: '4,4',
                    fillColor: '#F59E0B',
                    fillOpacity: 0.06,
                    interactive: false
                }).addTo(coneLayer);
            }
            if (r50 > 0) {
                L.circle([currentPt.lat, currentPt.lon], {
                    radius: r50 * 1000,
                    color: '#EF4444',
                    weight: 1.5,
                    fillColor: '#EF4444',
                    fillOpacity: 0.12,
                    interactive: false
                }).addTo(coneLayer);
            }
        }

        // 2. Draw Selected Agency Tracks (Only HKO + Consensus by default)
        window.STORM_AGENCIES.forEach(ag => {
            if (!enabledAgencies.has(ag.id)) return;
            const pts = ag.isConsensus ? consensusTrack : (stormCase.agencies[ag.id] || []);
            if (!pts || pts.length === 0) return;

            const latlngs = pts.map(p => [p.lat, p.lon]);
            L.polyline(latlngs, {
                color: ag.color,
                weight: ag.isConsensus ? 3.5 : 2.0,
                opacity: ag.isConsensus ? 0.95 : 0.75,
                dashArray: ag.dashed ? '5, 5' : null
            }).addTo(tracksLayer);

            pts.forEach((p, idx) => {
                const cat = StormEngine.classifyHkoCategory(p.windKmh);
                const m = L.circleMarker([p.lat, p.lon], {
                    radius: ag.isConsensus ? 4.5 : 3.0,
                    color: '#060A14',
                    weight: 1.2,
                    fillColor: ag.isConsensus ? cat.color : ag.color,
                    fillOpacity: 0.95
                }).addTo(tracksLayer);

                const hLbl = p.h === 0 ? '實況 OBS' : (p.h > 0 ? `+${p.h}h` : `${p.h}h`);
                m.bindPopup(`<b>${ag.name} (${hLbl})</b><br>中心風速：${p.windKmh} km/h<br>中心氣壓：${p.pres} hPa`);
                if (ag.isConsensus) {
                    m.on('click', () => StormApp.setTimelineIndex(idx));
                }
            });
        });

        // 3. Cyclone Eye Icon at Current Position
        if (currentPt) {
            const eyeHtml = `
                <div class="typhoon-eye-marker">
                    <svg class="typhoon-core-svg" viewBox="0 0 64 64">
                        <path d="M32 6 C16 6 6 20 10 36 C12 22 22 16 32 16 C42 16 48 24 46 34 C54 20 46 6 32 6 Z" fill="${currentPt.category.color}"/>
                        <path d="M32 58 C48 58 58 44 54 28 C52 42 42 48 32 48 C22 48 16 40 18 30 C10 44 18 58 32 58 Z" fill="${currentPt.category.color}"/>
                        <circle cx="32" cy="32" r="9" fill="#060A14" stroke="#ffffff" stroke-width="3"/>
                    </svg>
                </div>
            `;
            const eyeIcon = L.divIcon({
                className: '',
                html: eyeHtml,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
            L.marker([currentPt.lat, currentPt.lon], { icon: eyeIcon, zIndexOffset: 1000 }).addTo(tracksLayer);
        }
    }

    function focusDefaultView() {
        if (!map) return;
        const pop = document.getElementById('map-layer-popover');
        if (pop) pop.classList.add('hidden');

        const pt = StormApp.getCurrentPoint();
        if (pt) {
            map.flyToBounds([
                [window.HKO_HQ.lat, window.HKO_HQ.lon],
                [pt.lat, pt.lon]
            ], { padding: [60, 60], maxZoom: 7.2, duration: 0.65 });
        } else {
            map.flyTo([21.8, 114.2], 6.2, { duration: 0.65 });
        }
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
        focusDefaultView,
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

    render(mode, stormCase, consensusTrack) {
        const tbody = document.getElementById('agency-compare-tbody');
        const spreadBadge = document.getElementById('consensus-spread-badge');
        const cpaBarsEl = document.getElementById('agency-cpa-bars');
        if (!tbody) return;

        if (mode === 'LIVE_QUIET' || !stormCase || !consensusTrack || consensusTrack.length === 0) {
            if (spreadBadge) spreadBadge.innerText = '目前無生效氣旋';
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--sub-text);">
                🟢 目前西北太平洋及南海無生效熱帶氣旋。<br>如需檢視多機構路徑對比，請於「風暴庫」選擇歷史颱風個案。
            </td></tr>`;
            if (cpaBarsEl) {
                cpaBarsEl.innerHTML = `<div style="color:var(--sub-text);font-size:0.78rem;">暫無活動氣旋 CPA 數據</div>`;
            }
            return;
        }

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
                const cpa = StormEngine.computeCPA(tr, stormCase.baseTime);
                return { ag, cpa };
            }).filter(x => x.cpa).sort((a, b) => a.cpa.cpaDistKm - b.cpa.cpaDistKm);

            cpaBarsEl.innerHTML = cpaList.map(({ ag, cpa }) => {
                const pct = Math.max(12, Math.min(100, Math.round((1 - Math.min(cpa.cpaDistKm, 500) / 500) * 100)));
                return `<div class="signal-prob-row">
                    <div class="signal-prob-top">
                        <span><span class="agency-dot" style="background:${ag.color};display:inline-block;margin-right:5px;"></span>${ag.name}</span>
                        <span style="color:${ag.color};">${cpa.cpaBearingZh} ${cpa.cpaDistKm} km (${cpa.cpaTimeStr})</span>
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
// 5. REAL-TIME LIVE CYCLONE + HKO + JMA + OPEN-METEO ORCHESTRATOR
// ==========================================================================
const StormApp = (function() {
    // appMode: 'LIVE_ACTIVE' | 'LIVE_QUIET' | 'REPLAY'
    let appMode = 'LIVE_QUIET';
    let liveStormCase = null;
    let activeReplayId = '2025-ragasa';
    let consensusTrack = [];
    let currentTimelineIdx = 1;
    let playTimer = null;

    // Live HKO & Open-Meteo 8-station cache
    let liveHkoState = {
        temp: 26,
        rh: 78,
        warningText: '現時無生效熱帶氣旋警告',
        tcInfoText: '目前西北太平洋及南海無生效熱帶氣旋影響本港。',
        updatedAt: ''
    };
    let liveStationsWinds = null;

    function init() {
        RadarMapManager.initMap();
        renderReplayArchiveList();
        // Start in Live Mode and immediately query real-time cyclones & HKO weather!
        syncLiveAll(false);
    }

    function getActiveCase() {
        if (appMode === 'LIVE_ACTIVE' && liveStormCase) return liveStormCase;
        if (appMode === 'REPLAY') {
            return window.STORM_CASES_ARCHIVE.find(c => c.id === activeReplayId) || window.STORM_CASES_ARCHIVE[0];
        }
        return null;
    }

    function getCurrentPoint() {
        if (appMode === 'LIVE_QUIET' || !consensusTrack || consensusTrack.length === 0) return null;
        return consensusTrack[currentTimelineIdx] || consensusTrack[0];
    }

    // Parse live cyclones from Worker JSON or JMA Bosai JSON
    function parseWorkerStormData(json) {
        if (!json) return null;
        const list = json.storms || json.activeStorms || json.cyclones || (Array.isArray(json) ? json : null);
        if (list && list.length > 0) {
            const s = list[0];
            if (s.agencies && Object.keys(s.agencies).length > 0) {
                return {
                    id: s.id || 'live-storm',
                    code: s.code || 'LIVE',
                    nameZh: s.nameZh || s.name || '實時熱帶氣旋',
                    nameEn: s.nameEn || s.id || 'ACTIVE TC',
                    categoryName: s.categoryName || '熱帶氣旋',
                    badgeColor: '#EF4444',
                    peakSignal: '實時監測中',
                    baseTime: s.baseTime || new Date().toISOString(),
                    summary: s.summary || '來自 storm.max-yu.workers.dev 實時多機構路徑數據。',
                    agencies: s.agencies
                };
            }
        }
        return null;
    }

    async function fetchJmaLiveCyclone() {
        try {
            const res = await fetchWithTimeout('https://www.jma.go.jp/bosai/typhoon/data/targetTc.json', { timeout: 4000 });
            if (!res.ok) return null;
            const list = await res.json();
            if (!Array.isArray(list) || list.length === 0) return null;

            const tc = list[0];
            const tcId = tc.tcId || tc.id;
            if (!tcId) return null;

            const fRes = await fetchWithTimeout(`https://www.jma.go.jp/bosai/typhoon/data/${tcId}/forecast.json`, { timeout: 4000 });
            if (!fRes.ok) return null;
            const fJson = await fRes.json();
            if (!Array.isArray(fJson) || fJson.length === 0) return null;

            const pts = [];
            fJson.forEach((entry, idx) => {
                const center = entry.center || entry.part?.center;
                if (center && center.lat !== undefined && center.lon !== undefined) {
                    const windKt = Number(entry.maxWindSpeed || entry.windSpeed || 45);
                    const pres = Number(entry.centralPressure || entry.pressure || 990);
                    pts.push({
                        h: idx * 12,
                        lat: Number(center.lat),
                        lon: Number(center.lon),
                        windKmh: Math.round(windKt * 1.852),
                        pres
                    });
                }
            });
            if (pts.length === 0) return null;

            return {
                id: `jma-${tcId}`,
                code: tc.typhoonNumber || tcId,
                nameZh: tc.name?.jp || tc.name?.en || '實時熱帶氣旋',
                nameEn: (tc.name?.en || tcId).toUpperCase(),
                categoryName: '實時生效氣旋',
                badgeColor: '#FF2E63',
                peakSignal: 'JMA 實時發布',
                baseTime: new Date().toISOString(),
                summary: '來自日本氣象廳 (JMA Bosai) 實時熱帶氣旋報文。',
                agencies: {
                    JMA: pts,
                    HKO: pts
                }
            };
        } catch (e) {
            return null;
        }
    }

    async function fetchLiveHkoAndOpenMeteo() {
        // 1. Fetch HKO Official Open Data (No API Key required)
        try {
            const [rhrRes, warnRes, flwRes] = await Promise.allSettled([
                fetchWithTimeout('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc', { timeout: 4000 }),
                fetchWithTimeout('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc', { timeout: 4000 }),
                fetchWithTimeout('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=flw&lang=tc', { timeout: 4000 })
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
                if (keys.length > 0) {
                    const names = keys.map(k => warn[k].name || warn[k].type || k).join('、');
                    liveHkoState.warningText = `⚠️ 生效警告：${names}`;
                } else {
                    liveHkoState.warningText = '🟢 現時無生效熱帶氣旋警告';
                }
            }

            if (flwRes.status === 'fulfilled' && flwRes.value.ok) {
                const flw = await flwRes.value.json();
                liveHkoState.tcInfoText = flw.tcInfo || flw.generalSituation || '目前西北太平洋及南海無生效熱帶氣旋影響本港。';
            }

            const d = new Date();
            liveHkoState.updatedAt = d.toTimeString().slice(0, 5) + ' 更新';
        } catch (e) {}

        // 2. Fetch Open-Meteo Real-Time Winds for all 8 HK Reference Anemometer Stations (No API Key required)
        try {
            const lats = window.HKO_REFERENCE_STATIONS.map(s => s.lat).join(',');
            const lons = window.HKO_REFERENCE_STATIONS.map(s => s.lon).join(',');
            const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m&timezone=Asia%2FHong_Kong`;
            const omRes = await fetchWithTimeout(omUrl, { timeout: 4200 });
            if (omRes.ok) {
                const omJson = await omRes.json();
                const arr = Array.isArray(omJson) ? omJson : [omJson];
                let strongCount = 0, galeCount = 0, stormCount = 0;

                const stations = window.HKO_REFERENCE_STATIONS.map((sta, i) => {
                    const cur = (arr[i] && arr[i].current) ? arr[i].current : (arr[0]?.current || {});
                    const sustainedKmh = Math.max(4, Math.round(Number(cur.wind_speed_10m ?? 16)));
                    const gustKmh = Math.max(sustainedKmh + 5, Math.round(Number(cur.wind_gusts_10m ?? (sustainedKmh * 1.4))));
                    const windDirZh = StormEngine.compass16Zh(Number(cur.wind_direction_10m ?? 90));

                    let level = 'normal';
                    let statusZh = '清勁 (<41)';
                    if (sustainedKmh >= 88) { level = 'storm'; statusZh = '暴風 (≥88)'; stormCount++; galeCount++; strongCount++; }
                    else if (sustainedKmh >= 63) { level = 'gale'; statusZh = '烈風 (≥63)'; galeCount++; strongCount++; }
                    else if (sustainedKmh >= 41) { level = 'strong'; statusZh = '強風 (≥41)'; strongCount++; }

                    return {
                        ...sta,
                        sustainedKmh,
                        gustKmh,
                        windDirZh,
                        level,
                        statusZh
                    };
                });

                liveStationsWinds = { stations, strongCount, galeCount, stormCount };
            }
        } catch (e) {}
    }

    async function syncLiveAll(manual = false) {
        const topTxt = document.getElementById('top-mode-text');
        if (topTxt && manual) topTxt.innerText = '正在同步實時氣旋...';

        // 1. Check Worker & JMA for live active tropical cyclones
        let detectedLiveStorm = null;
        try {
            const workerUrls = [
                'https://storm.max-yu.workers.dev/api/storms',
                'https://storm.max-yu.workers.dev'
            ];
            for (const u of workerUrls) {
                try {
                    const r = await fetchWithTimeout(u, { timeout: 3500 });
                    if (r.ok) {
                        const j = await r.json();
                        detectedLiveStorm = parseWorkerStormData(j);
                        if (detectedLiveStorm) break;
                    }
                } catch (e) {}
            }
        } catch (e) {}

        if (!detectedLiveStorm) {
            detectedLiveStorm = await fetchJmaLiveCyclone();
        }

        // 2. Fetch Live HKO Weather & Open-Meteo 8-Station Winds
        await fetchLiveHkoAndOpenMeteo();

        if (detectedLiveStorm) {
            liveStormCase = detectedLiveStorm;
            appMode = 'LIVE_ACTIVE';
            consensusTrack = StormEngine.buildConsensusTrack(liveStormCase.agencies, [0, 12, 24, 36, 48, 72]);
            currentTimelineIdx = 0;
            if (manual) showUltraToast(`🔴 偵測到實時生效氣旋：${liveStormCase.nameZh}`);
        } else if (appMode !== 'REPLAY') {
            appMode = 'LIVE_QUIET';
            consensusTrack = [];
            if (manual) showUltraToast('🟢 已更新實時狀態：目前西北太平洋及南海無生效氣旋');
        } else if (manual) {
            showUltraToast('✅ 已同步最新香港天文台與八大測風站實況數據');
        }

        refreshAllViews();
        RadarMapManager.focusDefaultView();
    }

    function activateLiveMode() {
        stopTimelinePlay();
        if (liveStormCase) {
            appMode = 'LIVE_ACTIVE';
            consensusTrack = StormEngine.buildConsensusTrack(liveStormCase.agencies, [0, 12, 24, 36, 48, 72]);
            currentTimelineIdx = 0;
            showUltraToast(`🔴 已切換至實時生效氣旋：${liveStormCase.nameZh}`);
        } else {
            appMode = 'LIVE_QUIET';
            consensusTrack = [];
            showUltraToast('🟢 已切換至實時監測模式（目前無生效氣旋）');
        }
        refreshAllViews();
        AppNav.goTo(0);
        RadarMapManager.focusDefaultView();
    }

    function selectCaseFromArchive(caseId) {
        stopTimelinePlay();
        appMode = 'REPLAY';
        activeReplayId = caseId;
        const sc = getActiveCase();
        consensusTrack = StormEngine.buildConsensusTrack(sc.agencies, [-12, 0, 12, 24, 36, 48, 72, 96]);
        currentTimelineIdx = Math.max(0, consensusTrack.findIndex(p => p.h === 0));

        const slider = document.getElementById('timeline-scrubber');
        if (slider) {
            slider.max = String(consensusTrack.length - 1);
            slider.value = String(currentTimelineIdx);
        }

        refreshAllViews();
        AppNav.goTo(0);
        RadarMapManager.focusDefaultView();
        showUltraToast(`⏪ 歷史重演模式：${sc.code} ${sc.nameZh} (${sc.nameEn})`);
    }

    function setTimelineIndex(idx) {
        if (!consensusTrack || idx < 0 || idx >= consensusTrack.length) return;
        currentTimelineIdx = idx;
        const slider = document.getElementById('timeline-scrubber');
        if (slider) slider.value = String(idx);
        refreshAllViews();
    }

    function toggleTimelinePlay() {
        if (appMode === 'LIVE_QUIET' || consensusTrack.length === 0) return;
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
        showUltraToast(`⚡ 已跳至最接近香港時刻 (CPA ${minD} km)`);
    }

    function refreshAllViews() {
        // 1. Update HKO Live Weather Card
        const tempEl = document.getElementById('hko-live-temp');
        const rhEl = document.getElementById('hko-live-rh');
        const warnEl = document.getElementById('hko-live-warn-badge');
        const tcInfoEl = document.getElementById('hko-live-tcinfo');
        const updEl = document.getElementById('hko-live-update-tag');
        if (tempEl) tempEl.innerText = `${liveHkoState.temp}°C`;
        if (rhEl) rhEl.innerText = `相對濕度 ${liveHkoState.rh}%`;
        if (warnEl) warnEl.innerText = liveHkoState.warningText;
        if (tcInfoEl) tcInfoEl.innerText = liveHkoState.tcInfoText;
        if (updEl && liveHkoState.updatedAt) updEl.innerText = liveHkoState.updatedAt;

        const topDot = document.getElementById('top-mode-dot');
        const topTxt = document.getElementById('top-mode-text');
        const sheetIcon = document.getElementById('sheet-status-icon');
        const sheetTitle = document.getElementById('sheet-title-text');
        const scrubRow = document.getElementById('scrubber-controls-row');

        // Default fallback live winds if Open-Meteo hasn't returned yet
        const fallbackLiveWinds = liveStationsWinds || {
            strongCount: 0,
            galeCount: 0,
            stormCount: 0,
            stations: window.HKO_REFERENCE_STATIONS.map(s => ({
                ...s, sustainedKmh: 18, gustKmh: 28, windDirZh: '東', level: 'normal', statusZh: '清勁 (<41)'
            }))
        };

        if (appMode === 'LIVE_QUIET') {
            if (topDot) topDot.className = 'live-dot';
            if (topTxt) topTxt.innerText = `實時：目前無生效氣旋 • 香港 ${liveHkoState.temp}°C`;
            if (sheetIcon) sheetIcon.innerText = '🟢';
            if (sheetTitle) sheetTitle.innerText = `西北太平洋無生效氣旋 • 實時氣溫 ${liveHkoState.temp}°C`;
            if (scrubRow) scrubRow.classList.add('hidden');

            document.getElementById('hud-dist-hk').innerText = '無氣旋';
            document.getElementById('hud-max-wind').innerText = '--';
            document.getElementById('hud-min-pres').innerText = '1012 hPa';
            document.getElementById('hud-cpa-val').innerText = '--';

            const quietThreat = {
                recSignal: '無需發出信號',
                recBadgeColor: '#10B981',
                localWinds: fallbackLiveWinds,
                probabilities: [
                    { code: 'T1',  name: '一號戒備信號',     prob: 0, color: '#38BDF8', desc: '800km 內無氣旋' },
                    { code: 'T3',  name: '三號強風信號',     prob: 0, color: '#F59E0B', desc: `強風站數 ${fallbackLiveWinds.strongCount}/8` },
                    { code: 'T8',  name: '八號烈風或暴風信號', prob: 0, color: '#EF4444', desc: `烈風站數 ${fallbackLiveWinds.galeCount}/8` }
                ],
                bullets: [
                    `🟢 <b>實時西北太平洋及南海監測：</b>目前洋面上沒有生效的熱帶氣旋。系統正持續連線香港天文台與日本氣象廳實時報文。`,
                    `🚩 <b>八大參考測風站實時風力：</b>目前本港八大參考測風站中，共有 <b>${fallbackLiveWinds.strongCount} / 8 站達強風</b>、<b>${fallbackLiveWinds.galeCount} / 8 站達烈風</b>。如需測試颱風襲港路徑，可點擊頂部切換至「歷史模擬重演」。`
                ]
            };

            RadarMapManager.renderMapContent('LIVE_QUIET', null, [], 0, quietThreat);
            renderThreatPage('LIVE_QUIET', null, null, null, quietThreat);
            AgencyLabManager.render('LIVE_QUIET', null, []);
            renderReplayArchiveList();
            return;
        }

        // Active Storm (Either LIVE_ACTIVE or REPLAY)
        const sc = getActiveCase();
        const currentPt = getCurrentPoint();
        if (!sc || !currentPt) return;

        const cpaInfo = StormEngine.computeCPA(consensusTrack, sc.baseTime);
        const threatEval = StormEngine.evaluateHkThreatV2(currentPt, consensusTrack, cpaInfo);
        const hTag = currentPt.h === 0 ? '實況 OBS' : (currentPt.h > 0 ? `+${currentPt.h}h` : `${currentPt.h}h`);

        if (topDot) topDot.className = appMode === 'LIVE_ACTIVE' ? 'live-dot alert' : 'live-dot sim';
        if (topTxt) {
            const prefix = appMode === 'LIVE_ACTIVE' ? '🔴 實時氣旋' : '⏪ 模擬重演';
            topTxt.innerText = `${prefix}：${sc.nameZh} (${hTag}) • 距港 ${currentPt.distHk}km`;
        }
        if (sheetIcon) sheetIcon.innerText = '🌀';
        if (sheetTitle) {
            sheetTitle.innerText = `${sc.nameZh} (${currentPt.category.short}) • 距港 ${currentPt.distHk}km • ${threatEval.recSignal}`;
        }
        if (scrubRow) scrubRow.classList.remove('hidden');

        document.getElementById('hud-dist-hk').innerText = `${currentPt.distHk} km`;
        document.getElementById('hud-max-wind').innerText = `${currentPt.windKmh} km/h`;
        document.getElementById('hud-min-pres').innerText = `${currentPt.pres} hPa`;
        document.getElementById('hud-cpa-val').innerText = cpaInfo ? `${cpaInfo.cpaDistKm} km` : '--';

        RadarMapManager.renderMapContent(appMode, sc, consensusTrack, currentTimelineIdx, threatEval);
        renderThreatPage(appMode, sc, currentPt, cpaInfo, threatEval);
        AgencyLabManager.render(appMode, sc, consensusTrack);
        renderReplayArchiveList();
    }

    function renderThreatPage(mode, sc, currentPt, cpaInfo, threatEval) {
        const titleEl = document.getElementById('threat-card-storm-title');
        const recSigEl = document.getElementById('threat-rec-signal');
        const currDistEl = document.getElementById('threat-curr-dist');
        const cpaDistEl = document.getElementById('threat-cpa-dist');
        const staSumEl = document.getElementById('threat-8sta-summary');
        const staSourceEl = document.getElementById('sta-source-badge');

        if (mode === 'LIVE_QUIET') {
            if (titleEl) titleEl.innerText = '🎯 實時氣旋威脅評估 (目前無生效氣旋)';
            if (recSigEl) { recSigEl.innerText = '無需發出信號'; recSigEl.style.color = '#10B981'; }
            if (currDistEl) currDistEl.innerText = '無氣旋';
            if (cpaDistEl) cpaDistEl.innerText = '--';
            if (staSourceEl) staSourceEl.innerText = '實時 Open-Meteo ▾';
        } else {
            if (titleEl) titleEl.innerText = `🎯 ${sc.code} ${sc.nameZh} 防風評估`;
            if (recSigEl) {
                recSigEl.innerText = threatEval.recSignal;
                recSigEl.style.color = threatEval.recBadgeColor;
            }
            if (currDistEl) currDistEl.innerText = `${currentPt.distHk} km`;
            if (cpaDistEl && cpaInfo) cpaDistEl.innerText = `${cpaInfo.cpaDistKm} km`;
            if (staSourceEl) staSourceEl.innerText = mode === 'LIVE_ACTIVE' ? '實時風場推演 ▾' : '歷史渦旋推演 ▾';
        }

        const lw = threatEval.localWinds;
        if (staSumEl && lw) {
            staSumEl.innerText = `強風 ${lw.strongCount}/8 • 烈風 ${lw.galeCount}/8`;
            staSumEl.style.color = lw.galeCount >= 4 ? '#EF4444' : (lw.strongCount >= 4 ? '#F59E0B' : '#10B981');
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
    }

    function renderReplayArchiveList() {
        const listEl = document.getElementById('replay-cases-list');
        const liveCard = document.getElementById('live-mode-selector-card');
        if (liveCard) {
            liveCard.style.borderColor = (appMode === 'LIVE_QUIET' || appMode === 'LIVE_ACTIVE') ? '#10B981' : 'var(--glass-border)';
        }
        if (!listEl) return;

        listEl.innerHTML = window.STORM_CASES_ARCHIVE.map(c => {
            const isAct = (appMode === 'REPLAY' && c.id === activeReplayId);
            return `<div class="clean-card" onclick="StormApp.selectCaseFromArchive('${c.id}')" style="cursor:pointer;border-color:${isAct ? 'var(--accent-color)' : 'var(--glass-border)'};">
                <div class="card-header-row">
                    <div class="card-title">🌀 ${c.code} ${c.nameZh} (${c.nameEn})</div>
                    <span class="card-badge" style="background:${c.badgeColor};color:#fff;">${c.peakSignal}</span>
                </div>
                <div style="font-size:0.76rem;color:var(--sub-text);margin-top:6px;line-height:1.4;">${c.summary}</div>
                <div style="font-size:0.72rem;font-weight:700;color:var(--accent-color);margin-top:8px;">
                    ${isAct ? '● 當前正在重演此個案' : '點擊載入路徑與八大測風站模擬 ➔'}
                </div>
            </div>`;
        }).join('');
    }

    return {
        init,
        getActiveCase,
        getCurrentPoint,
        syncLiveAll,
        activateLiveMode,
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
