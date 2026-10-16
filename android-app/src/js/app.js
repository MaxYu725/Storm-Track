// ==========================================================================
// Storm-Track Ultra 2.0 - Core Application, Map & UI Controllers
// ==========================================================================

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 4200 } = options;
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
    window._ultraToastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ==========================================================================
// 1. THEME & LIVE CLOCK MANAGER
// ==========================================================================
const ThemeManager = {
    isLight: false,
    init() {
        try {
            this.isLight = localStorage.getItem('storm_ultra_theme') === 'light';
        } catch (e) {}
        this.apply();
        this.startClock();
    },
    toggle() {
        this.isLight = !this.isLight;
        try {
            localStorage.setItem('storm_ultra_theme', this.isLight ? 'light' : 'dark');
        } catch (e) {}
        this.apply();
        if (window.RadarMapManager) {
            RadarMapManager.updateTileTheme(this.isLight);
        }
    },
    apply() {
        document.body.classList.toggle('light-theme', this.isLight);
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) btn.innerText = this.isLight ? '🌙' : '☀️';
    },
    startClock() {
        const tick = () => {
            const el = document.getElementById('live-clock');
            if (!el) return;
            const d = new Date();
            el.innerText = d.toTimeString().slice(0, 8) + ' HKT';
        };
        tick();
        setInterval(tick, 1000);
    }
};

// ==========================================================================
// 2. NEO-METRO PIVOT + FLOATING BOTTOM DOCK NAVIGATION
// ==========================================================================
const AppNav = {
    currentIndex: 0,
    touchStartX: 0,
    touchStartY: 0,
    touchEndX: 0,
    touchEndY: 0,
    swipeThreshold: 85,
    isAnimating: false,
    pageCount: 4,

    init() {
        const headers = document.getElementById('pivot-headers');
        const body = document.getElementById('pivot-content');

        headers.addEventListener('click', (e) => {
            const h = e.target.closest('.pivot-header');
            if (!h) return;
            this.goTo(Number(h.dataset.index));
        });

        body.addEventListener('touchstart', (e) => {
            if (e.target.closest('#page-radar, .leaflet-container, button, input, .horizon-pills-bar, .agency-compare-table')) return;
            const t = e.touches[0];
            this.touchStartX = t.clientX;
            this.touchStartY = t.clientY;
            this.touchEndX = t.clientX;
            this.touchEndY = t.clientY;
        }, { passive: true });

        body.addEventListener('touchend', (e) => {
            if (e.target.closest('#page-radar, .leaflet-container, button, input, .horizon-pills-bar, .agency-compare-table')) return;
            const t = e.changedTouches[0];
            this.touchEndX = t.clientX;
            this.touchEndY = t.clientY;
            this.handleSwipe();
        }, { passive: true });

        this.applyState(0, 'right', true);
    },

    handleSwipe() {
        const dx = this.touchEndX - this.touchStartX;
        const dy = this.touchEndY - this.touchStartY;
        if (Math.abs(dx) < this.swipeThreshold || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
        if (dx < 0) this.goTo((this.currentIndex + 1) % this.pageCount, 'right');
        else if (dx > 0) this.goTo((this.currentIndex - 1 + this.pageCount) % this.pageCount, 'left');
    },

    goTo(index, direction) {
        if (!Number.isInteger(index) || index < 0 || index >= this.pageCount) return;
        if (index === this.currentIndex || this.isAnimating) return;
        if (!direction) direction = index > this.currentIndex ? 'right' : 'left';
        this.applyState(index, direction, false);
    },

    applyState(index, direction, immediate) {
        this.isAnimating = !immediate;
        const pages = Array.from(document.querySelectorAll('.pivot-page'));
        const headers = Array.from(document.querySelectorAll('.pivot-header'));
        const navTabs = Array.from(document.querySelectorAll('.nav-tab'));
        const incoming = pages[index];

        pages.forEach((p, i) => {
            if (i !== index) {
                p.classList.remove('active', 'slide-from-left');
                p.setAttribute('aria-hidden', 'true');
            }
        });

        if (incoming) {
            incoming.classList.toggle('slide-from-left', direction === 'left');
            if (!immediate) void incoming.offsetWidth;
            incoming.classList.add('active');
            incoming.classList.remove('slide-from-left');
            incoming.setAttribute('aria-hidden', 'false');
        }

        headers.forEach(h => {
            const act = Number(h.dataset.index) === index;
            h.classList.toggle('active', act);
            if (act && h.scrollIntoView) {
                h.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        });

        navTabs.forEach(t => {
            t.classList.toggle('active', Number(t.dataset.index) === index);
        });

        this.currentIndex = index;
        if (index === 0 && window.RadarMapManager) {
            requestAnimationFrame(() => RadarMapManager.resizeMap());
            setTimeout(() => RadarMapManager.resizeMap(), 320);
        }

        clearTimeout(this._unlockTimer);
        this._unlockTimer = setTimeout(() => { this.isAnimating = false; }, immediate ? 0 : 300);
    }
};

// ==========================================================================
// 3. TACTICAL RADAR MAP & DYNAMIC WIND PARTICLE ENGINE
// ==========================================================================
const RadarMapManager = (function() {
    let map = null;
    let tileLayer = null;
    let cordonLayer = null;
    let coneLayer = null;
    let tracksLayer = null;
    let stationsLayer = null;
    let activeEyeMarker = null;

    const enabledAgencies = new Set(['CONSENSUS', 'HKO', 'JMA', 'CMA', 'CWA', 'JTWC']);
    const layersState = {
        windField: true,
        windCone: true,
        cordonRings: true,
        hkStations: false
    };

    // Animated Canvas Wind Streamlines
    let particleCanvas = null;
    let particleCtx = null;
    let particles = [];
    let animFrameId = null;

    function initMap() {
        if (typeof L === 'undefined') return;
        map = L.map('storm-map', {
            zoomControl: false,
            minZoom: 4,
            maxZoom: 13,
            zoomSnap: 0.25
        }).setView([20.8, 115.2], 6.2);

        updateTileTheme(ThemeManager.isLight);

        cordonLayer = L.layerGroup().addTo(map);
        coneLayer = L.layerGroup().addTo(map);
        tracksLayer = L.layerGroup().addTo(map);
        stationsLayer = L.layerGroup().addTo(map);

        renderAgencyFilterPills();
        drawHkoCordonRings();
        initWindParticleCanvas();

        map.on('move zoom resize', () => {
            resizeParticleCanvas();
        });
    }

    function updateTileTheme(isLight) {
        if (!map || typeof L === 'undefined') return;
        if (tileLayer) map.removeLayer(tileLayer);
        const url = isLight
            ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
        tileLayer = L.tileLayer(url).addTo(map);
    }

    function renderAgencyFilterPills() {
        const container = document.getElementById('agency-layer-pills');
        if (!container) return;
        container.innerHTML = window.STORM_AGENCIES.map(ag => {
            const isAct = enabledAgencies.has(ag.id);
            return `<div class="agency-toggle-pill ${isAct ? 'active' : ''}" onclick="RadarMapManager.toggleAgency('${ag.id}')">
                <span class="agency-dot" style="background:${ag.color};box-shadow:0 0 6px ${ag.color};"></span>
                <span>${ag.name}</span>
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

    function toggleLayer(key) {
        layersState[key] = !layersState[key];
        const btnMap = {
            windField: 'btn-layer-wind',
            windCone: 'btn-layer-cone',
            cordonRings: 'btn-layer-rings',
            hkStations: 'btn-layer-stations'
        };
        const btn = document.getElementById(btnMap[key]);
        if (btn) btn.classList.toggle('active', layersState[key]);

        if (key === 'windField' && particleCanvas) {
            particleCanvas.style.display = layersState.windField ? 'block' : 'none';
        }
        drawHkoCordonRings();
        StormApp.refreshAllViews();
    }

    function drawHkoCordonRings() {
        if (!cordonLayer) return;
        cordonLayer.clearLayers();

        // Always mark HKO HQ
        const hkoIcon = L.divIcon({
            className: '',
            html: `<div class="hko-hq-badge">🇭🇰 HKO 天文台</div>`,
            iconSize: [76, 20],
            iconAnchor: [38, 10]
        });
        L.marker([window.HKO_HQ.lat, window.HKO_HQ.lon], { icon: hkoIcon }).addTo(cordonLayer);

        if (!layersState.cordonRings) return;

        const rings = [
            { rKm: 100, color: '#EF4444', label: '100km 核心暴風警戒' },
            { rKm: 300, color: '#F59E0B', label: '300km 烈風警戒圈' },
            { rKm: 500, color: '#38BDF8', label: '500km 強風警戒圈' },
            { rKm: 800, color: '#64748B', label: '800km 一號戒備圈' }
        ];

        rings.forEach(rg => {
            L.circle([window.HKO_HQ.lat, window.HKO_HQ.lon], {
                radius: rg.rKm * 1000,
                color: rg.color,
                weight: 1.2,
                opacity: 0.45,
                fillOpacity: 0.01,
                dashArray: '5, 6',
                interactive: false
            }).addTo(cordonLayer);

            const labelLat = window.HKO_HQ.lat - (rg.rKm / 111.32);
            const labelIcon = L.divIcon({
                className: '',
                html: `<span class="ring-dist-label" style="border-color:${rg.color};color:${rg.color};">${rg.label}</span>`,
                iconSize: [110, 18],
                iconAnchor: [55, 9]
            });
            L.marker([labelLat, window.HKO_HQ.lon], { icon: labelIcon, interactive: false }).addTo(cordonLayer);
        });
    }

    function renderStormOnMap(stormCase, consensusTrack, currentIdx, threatEval) {
        if (!map || !tracksLayer || !coneLayer || !stationsLayer) return;
        tracksLayer.clearLayers();
        coneLayer.clearLayers();
        stationsLayer.clearLayers();

        const currentPt = consensusTrack[currentIdx] || consensusTrack[1];

        // 1. Draw 70% Probability Uncertainty Cone & Active Wind Radii (30kt / 50kt / 64kt)
        if (layersState.windCone && currentPt) {
            consensusTrack.forEach((pt, idx) => {
                if (idx >= currentIdx) {
                    L.circle([pt.lat, pt.lon], {
                        radius: pt.coneRadiusKm * 1000,
                        color: '#00F5D4',
                        weight: 1,
                        opacity: 0.22,
                        fillColor: '#00F5D4',
                        fillOpacity: 0.05,
                        interactive: false
                    }).addTo(coneLayer);
                }
            });

            const { r30, r50, r64 } = currentPt.radii;
            if (r30 > 0) {
                L.circle([currentPt.lat, currentPt.lon], {
                    radius: r30 * 1000,
                    color: '#F59E0B',
                    weight: 1.4,
                    dashArray: '4,4',
                    fillColor: '#F59E0B',
                    fillOpacity: 0.08,
                    interactive: false
                }).addTo(coneLayer);
            }
            if (r50 > 0) {
                L.circle([currentPt.lat, currentPt.lon], {
                    radius: r50 * 1000,
                    color: '#EF4444',
                    weight: 1.6,
                    fillColor: '#EF4444',
                    fillOpacity: 0.14,
                    interactive: false
                }).addTo(coneLayer);
            }
            if (r64 > 0) {
                L.circle([currentPt.lat, currentPt.lon], {
                    radius: r64 * 1000,
                    color: '#D946EF',
                    weight: 2.0,
                    fillColor: '#D946EF',
                    fillOpacity: 0.22,
                    interactive: false
                }).addTo(coneLayer);
            }

            // Tactical Distance Vector Line between HKO and Storm Center
            L.polyline([[window.HKO_HQ.lat, window.HKO_HQ.lon], [currentPt.lat, currentPt.lon]], {
                color: '#00E5FF',
                weight: 1.8,
                dashArray: '4, 6',
                opacity: 0.75
            }).addTo(coneLayer);
        }

        // 2. Draw Individual Agency Tracks
        window.STORM_AGENCIES.forEach(ag => {
            if (!enabledAgencies.has(ag.id)) return;
            const pts = ag.isConsensus ? consensusTrack : (stormCase.agencies[ag.id] || []);
            if (pts.length === 0) return;

            const latlngs = pts.map(p => [p.lat, p.lon]);
            L.polyline(latlngs, {
                color: ag.color,
                weight: ag.isConsensus ? 4.2 : 2.2,
                opacity: ag.isConsensus ? 0.96 : 0.78,
                dashArray: ag.dashed ? '6, 5' : null
            }).addTo(tracksLayer);

            pts.forEach((p, idx) => {
                const cat = StormEngine.classifyHkoCategory(p.windKmh);
                const radiusPx = ag.isConsensus ? 5.5 : 3.5;
                const marker = L.circleMarker([p.lat, p.lon], {
                    radius: radiusPx,
                    color: '#060913',
                    weight: 1.5,
                    fillColor: ag.isConsensus ? cat.color : ag.color,
                    fillOpacity: 0.95
                }).addTo(tracksLayer);

                const hLabel = p.h === 0 ? '實況 OBS' : (p.h > 0 ? `+${p.h}h 預報` : `${p.h}h 過去`);
                marker.bindPopup(`
                    <div style="font-family:Inter,sans-serif;min-width:165px;color:#0F172A;">
                        <div style="font-weight:800;font-size:0.86rem;border-bottom:1px solid #cbd5e1;padding-bottom:4px;margin-bottom:5px;">
                            ${ag.name} • ${hLabel}
                        </div>
                        <div style="font-size:0.78rem;line-height:1.5;">
                            <b>強度：</b>${cat.nameZh} (${p.windKmh} km/h)<br>
                            <b>氣壓：</b>${p.pres} hPa<br>
                            <b>座標：</b>${p.lat.toFixed(1)}°N, ${p.lon.toFixed(1)}°E
                        </div>
                    </div>
                `);
                if (ag.isConsensus) {
                    marker.on('click', () => StormApp.setTimelineIndex(idx));
                }
            });
        });

        // 3. Draw Rotating Cyclone Eye Marker at Current Scrubber Timestamp
        if (currentPt) {
            const eyeHtml = `
                <div class="typhoon-eye-marker">
                    <div class="typhoon-eye-pulse" style="border-color:${currentPt.category.color};"></div>
                    <svg class="typhoon-core-svg" viewBox="0 0 64 64">
                        <path d="M32 6 C16 6 6 20 10 36 C12 22 22 16 32 16 C42 16 48 24 46 34 C54 20 46 6 32 6 Z" fill="${currentPt.category.color}"/>
                        <path d="M32 58 C48 58 58 44 54 28 C52 42 42 48 32 48 C22 48 16 40 18 30 C10 44 18 58 32 58 Z" fill="${currentPt.category.color}"/>
                        <circle cx="32" cy="32" r="9" fill="#060913" stroke="#ffffff" stroke-width="3"/>
                    </svg>
                </div>
            `;
            const eyeIcon = L.divIcon({
                className: '',
                html: eyeHtml,
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });
            activeEyeMarker = L.marker([currentPt.lat, currentPt.lon], { icon: eyeIcon, zIndexOffset: 1000 }).addTo(tracksLayer);
        }

        // 4. Optional HK 8-Reference Anemometer Station Markers
        if (layersState.hkStations && threatEval && threatEval.localWinds) {
            threatEval.localWinds.stations.forEach(sta => {
                const col = sta.level === 'storm' ? '#D946EF' : (sta.level === 'gale' ? '#EF4444' : (sta.level === 'strong' ? '#F59E0B' : '#10B981'));
                const icon = L.divIcon({
                    className: '',
                    html: `<div style="background:rgba(6,9,19,0.88);border:1.5px solid ${col};color:#fff;padding:1px 5px;border-radius:6px;font-size:0.62rem;font-weight:800;white-space:nowrap;">${sta.name} ${sta.sustainedKmh}</div>`,
                    iconSize: [56, 18],
                    iconAnchor: [28, 9]
                });
                L.marker([sta.lat, sta.lon], { icon }).addTo(stationsLayer);
            });
        }
    }

    // Canvas Wind Field Streamlines Driven by Active Cyclone Vortex
    function initWindParticleCanvas() {
        particleCanvas = document.getElementById('wind-particle-canvas');
        if (!particleCanvas) return;
        particleCtx = particleCanvas.getContext('2d');
        resizeParticleCanvas();

        particles = Array.from({ length: 135 }, () => resetParticle({}));
        if (animFrameId) cancelAnimationFrame(animFrameId);
        animateWindParticles();
    }

    function resizeParticleCanvas() {
        if (!particleCanvas) return;
        const rect = particleCanvas.parentElement.getBoundingClientRect();
        particleCanvas.width = rect.width || window.innerWidth;
        particleCanvas.height = rect.height || window.innerHeight;
    }

    function resetParticle(p) {
        const w = particleCanvas ? particleCanvas.width : 400;
        const h = particleCanvas ? particleCanvas.height : 600;
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.age = Math.floor(Math.random() * 75);
        p.maxAge = 65 + Math.floor(Math.random() * 45);
        return p;
    }

    function animateWindParticles() {
        animFrameId = requestAnimationFrame(animateWindParticles);
        if (!layersState.windField || !particleCtx || !map || AppNav.currentIndex !== 0) return;

        const w = particleCanvas.width;
        const h = particleCanvas.height;
        particleCtx.fillStyle = 'rgba(6, 9, 19, 0.14)';
        particleCtx.globalCompositeOperation = 'destination-in';
        particleCtx.fillRect(0, 0, w, h);
        particleCtx.globalCompositeOperation = 'source-over';

        const currentPt = StormApp.getCurrentPoint();
        if (!currentPt) return;

        const eyeContainerPt = map.latLngToContainerPoint([currentPt.lat, currentPt.lon]);
        const ex = eyeContainerPt.x;
        const ey = eyeContainerPt.y;

        particles.forEach(p => {
            if (p.age >= p.maxAge || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
                resetParticle(p);
            }
            const dx = p.x - ex;
            const dy = p.y - ey;
            const rPx = Math.sqrt(dx * dx + dy * dy) + 1;

            // Counter-clockwise cyclonic tangential angle in screen coordinates (y down):
            // Screen counter-clockwise around (ex, ey): tangent is (dy, -dx) plus slight inward spiral (-0.22 * dx, -0.22 * dy)
            const ux = (dy / rPx) - 0.22 * (dx / rPx);
            const uy = (-dx / rPx) - 0.22 * (dy / rPx);

            // Speed profile peaking around eye wall
            const speed = Math.min(4.2, Math.max(0.9, (currentPt.windKmh / 65) * Math.exp(-Math.abs(rPx - 48) / 170)));
            const nx = p.x + ux * speed;
            const ny = p.y + uy * speed;

            particleCtx.beginPath();
            particleCtx.moveTo(p.x, p.y);
            particleCtx.lineTo(nx, ny);
            particleCtx.strokeStyle = rPx < 85 ? 'rgba(255, 46, 99, 0.72)' : (rPx < 165 ? 'rgba(251, 191, 36, 0.58)' : 'rgba(0, 229, 255, 0.42)');
            particleCtx.lineWidth = rPx < 90 ? 1.8 : 1.2;
            particleCtx.stroke();

            p.x = nx;
            p.y = ny;
            p.age++;
        });
    }

    function zoomIn() { if (map) map.zoomIn(0.8); }
    function zoomOut() { if (map) map.zoomOut(0.8); }
    function resizeMap() {
        if (map) map.invalidateSize();
        resizeParticleCanvas();
    }

    function focusHKAndStorm() {
        if (!map) return;
        const pt = StormApp.getCurrentPoint();
        if (pt) {
            map.flyToBounds([
                [window.HKO_HQ.lat, window.HKO_HQ.lon],
                [pt.lat, pt.lon]
            ], { padding: [55, 55], maxZoom: 7.5, duration: 0.75 });
        } else {
            map.flyTo([20.8, 115.2], 6.2, { duration: 0.7 });
        }
    }

    return {
        initMap,
        updateTileTheme,
        toggleAgency,
        toggleLayer,
        renderStormOnMap,
        zoomIn,
        zoomOut,
        resizeMap,
        focusHKAndStorm
    };
})();

// ==========================================================================
// 4. MULTI-AGENCY CONSENSUS LAB CONTROLLER
// ==========================================================================
const AgencyLabManager = {
    selectedHorizon: 0,

    setHorizon(h) {
        this.selectedHorizon = h;
        document.querySelectorAll('#agency-horizon-bar .horizon-pill').forEach(el => {
            el.classList.toggle('active', Number(el.dataset.h) === h);
        });
        this.render(StormApp.getActiveCase(), StormApp.getConsensusTrack());
    },

    render(stormCase, consensusTrack) {
        const tbody = document.getElementById('agency-compare-tbody');
        const spreadBadge = document.getElementById('consensus-spread-badge');
        const horizonLabel = document.getElementById('agency-table-horizon-label');
        const cpaBarsEl = document.getElementById('agency-cpa-bars');
        if (!tbody || !stormCase) return;

        const h = this.selectedHorizon;
        if (horizonLabel) horizonLabel.innerText = h === 0 ? '時段：實況 OBS' : `時段：+${h}h 預報`;

        const consPt = consensusTrack.find(p => p.h === h) || consensusTrack[1];
        if (spreadBadge && consPt) {
            spreadBadge.innerText = `模式分歧度：±${consPt.spreadKm} km`;
        }

        const rowsHtml = window.STORM_AGENCIES.map(ag => {
            let pt = null;
            if (ag.isConsensus) {
                pt = consPt;
            } else {
                pt = StormEngine.interpolateAgencyAtHour(stormCase.agencies[ag.id], h);
            }
            if (!pt) return '';
            const distHk = Math.round(StormEngine.haversineKm(window.HKO_HQ.lat, window.HKO_HQ.lon, pt.lat, pt.lon));
            const cat = StormEngine.classifyHkoCategory(pt.windKmh);

            return `<tr style="${ag.isConsensus ? 'background:rgba(0,245,212,0.08);font-weight:700;' : ''}">
                <td>
                    <span class="agency-badge-cell">
                        <span class="agency-dot" style="background:${ag.color};"></span>
                        <span>${ag.name}</span>
                    </span>
                </td>
                <td>${pt.lat.toFixed(1)}°N, ${pt.lon.toFixed(1)}°E</td>
                <td><span style="color:${cat.color};font-weight:800;">${pt.windKmh} km/h</span></td>
                <td>${pt.pres} hPa</td>
                <td style="font-weight:800;color:var(--accent-color);">${distHk} km</td>
            </tr>`;
        }).join('');
        tbody.innerHTML = rowsHtml;

        // Render CPA by Agency Comparison Bars
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
                        <span style="display:flex;align-items:center;gap:6px;">
                            <span class="agency-dot" style="background:${ag.color};"></span>
                            <b>${ag.name} (${ag.short})</b>
                        </span>
                        <span style="color:${ag.color};">香港${cpa.cpaBearingZh} <b>${cpa.cpaDistKm} km</b> (${cpa.cpaTimeStr})</span>
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
// 5. MAIN STORM-TRACK ULTRA ORCHESTRATOR
// ==========================================================================
const StormApp = (function() {
    let activeCaseId = '2025-ragasa';
    let consensusTrack = [];
    let currentTimelineIdx = 1; // Default to h = 0 (OBS)
    let playTimer = null;

    function getActiveCase() {
        return window.STORM_CASES_ARCHIVE.find(c => c.id === activeCaseId) || window.STORM_CASES_ARCHIVE[0];
    }

    function getConsensusTrack() {
        return consensusTrack;
    }

    function getCurrentPoint() {
        return consensusTrack[currentTimelineIdx] || consensusTrack[0];
    }

    function init() {
        RadarMapManager.initMap();
        loadStormCase(activeCaseId, false);
        syncLiveBackend(false);
    }

    function loadStormCase(caseId, notify = true) {
        stopTimelinePlay();
        activeCaseId = caseId;
        const sc = getActiveCase();
        consensusTrack = StormEngine.buildConsensusTrack(sc.agencies, [-12, 0, 12, 24, 36, 48, 72, 96]);
        currentTimelineIdx = Math.max(0, consensusTrack.findIndex(p => p.h === 0));

        const slider = document.getElementById('timeline-scrubber');
        if (slider) {
            slider.max = String(consensusTrack.length - 1);
            slider.value = String(currentTimelineIdx);
        }

        refreshAllViews();
        RadarMapManager.focusHKAndStorm();
        if (notify) {
            showUltraToast(`🌀 已切換至：${sc.code} ${sc.nameZh} (${sc.nameEn})`);
        }
    }

    function setTimelineIndex(idx) {
        if (idx < 0 || idx >= consensusTrack.length) return;
        currentTimelineIdx = idx;
        const slider = document.getElementById('timeline-scrubber');
        if (slider) slider.value = String(idx);
        refreshAllViews();
    }

    function toggleTimelinePlay() {
        if (playTimer) {
            stopTimelinePlay();
            return;
        }
        const btn = document.getElementById('btn-play-scrubber');
        if (btn) btn.innerText = '⏸';
        playTimer = setInterval(() => {
            const nextIdx = (currentTimelineIdx + 1) % consensusTrack.length;
            setTimelineIndex(nextIdx);
        }, 1250);
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
        stopTimelinePlay();
        let bestIdx = 0;
        let minD = Infinity;
        consensusTrack.forEach((pt, idx) => {
            if (pt.distHk < minD) {
                minD = pt.distHk;
                bestIdx = idx;
            }
        });
        setTimelineIndex(bestIdx);
        showUltraToast(`⚡ 已跳至最接近香港時刻 (距離 HKO ${minD} km)`);
    }

    function refreshAllViews() {
        const sc = getActiveCase();
        const currentPt = getCurrentPoint();
        if (!sc || !currentPt) return;

        const cpaInfo = StormEngine.computeCPA(consensusTrack, sc.baseTime);
        const threatEval = StormEngine.evaluateHkThreatV2(currentPt, consensusTrack, cpaInfo);

        // 1. Update Top Storm Ribbon
        const catDot = document.getElementById('ribbon-cat-dot');
        const nameEl = document.getElementById('ribbon-storm-name');
        const sigText = document.getElementById('ribbon-signal-text');
        if (catDot) {
            catDot.style.background = currentPt.category.color;
            catDot.style.boxShadow = `0 0 8px ${currentPt.category.color}`;
        }
        if (nameEl) {
            const hTag = currentPt.h === 0 ? 'OBS' : (currentPt.h > 0 ? `+${currentPt.h}h` : `${currentPt.h}h`);
            nameEl.innerText = `${sc.code} ${currentPt.category.short} ${sc.nameZh} ${sc.nameEn} (${hTag})`;
        }
        if (sigText) {
            sigText.innerText = `⚠️ ${threatEval.recSignal}`;
        }

        // 2. Update Radar HUD & Scrubber Labels
        const hudDist = document.getElementById('hud-dist-hk');
        const hudWind = document.getElementById('hud-max-wind');
        const hudPres = document.getElementById('hud-min-pres');
        const hudCpa = document.getElementById('hud-cpa-val');
        if (hudDist) hudDist.innerText = `${currentPt.distHk} km (${currentPt.bearingZh})`;
        if (hudWind) hudWind.innerText = `${currentPt.windKmh} km/h`;
        if (hudPres) hudPres.innerText = `${currentPt.pres} hPa`;
        if (hudCpa && cpaInfo) hudCpa.innerText = `${cpaInfo.cpaDistKm} km`;

        const labelsWrap = document.getElementById('timeline-step-labels');
        if (labelsWrap) {
            labelsWrap.innerHTML = consensusTrack.map((p, i) => {
                const lbl = p.h === 0 ? 'OBS' : (p.h > 0 ? `+${p.h}h` : `${p.h}h`);
                return `<span class="${i === currentTimelineIdx ? 'active' : ''}" onclick="StormApp.setTimelineIndex(${i})" style="cursor:pointer;">${lbl}</span>`;
            }).join('');
        }

        // 3. Render Map Layers
        RadarMapManager.renderStormOnMap(sc, consensusTrack, currentTimelineIdx, threatEval);

        // 4. Render Page 1: HK Threat & Signal V2 Dashboard
        renderThreatDashboard(sc, currentPt, cpaInfo, threatEval);

        // 5. Render Page 2: Multi-Agency Consensus Lab
        AgencyLabManager.render(sc, consensusTrack);

        // 6. Render Page 3: Historical Case Replay Archive
        renderReplayArchiveList();
    }

    function renderThreatDashboard(sc, currentPt, cpaInfo, threatEval) {
        const currDistEl = document.getElementById('threat-curr-dist');
        const brgEl = document.getElementById('threat-curr-bearing');
        const recSigEl = document.getElementById('threat-rec-signal');
        const semiEl = document.getElementById('threat-semicircle-badge');
        const cpaDistEl = document.getElementById('threat-cpa-dist');
        const cpaTimeEl = document.getElementById('threat-cpa-time');
        const staSumEl = document.getElementById('threat-8sta-summary');

        if (currDistEl) currDistEl.innerHTML = `${currentPt.distHk}<span>km</span>`;
        if (brgEl) brgEl.innerText = `方位：香港天文台${currentPt.bearingZh} (${currentPt.bearingDeg}°) • 強度：${currentPt.windKmh} km/h`;
        if (recSigEl) {
            recSigEl.innerText = threatEval.recSignal;
            recSigEl.style.color = threatEval.recBadgeColor;
        }
        if (semiEl && cpaInfo) {
            semiEl.innerText = cpaInfo.isDangerousSemicircle ? '⚠️ 危險半圓 (東南偏東無地形遮蔽)' : '🛡️ 可航半圓 (受內陸山脈地形屏障)';
        }
        if (cpaDistEl && cpaInfo) cpaDistEl.innerText = `${cpaInfo.cpaBearingZh} ${cpaInfo.cpaDistKm} km`;
        if (cpaTimeEl && cpaInfo) cpaTimeEl.innerText = cpaInfo.cpaTimeStr;
        if (staSumEl) {
            const lw = threatEval.localWinds;
            staSumEl.innerText = `強風 ${lw.strongCount}/8 • 烈風 ${lw.galeCount}/8`;
            staSumEl.style.color = lw.galeCount >= 4 ? '#EF4444' : (lw.strongCount >= 4 ? '#F59E0B' : '#10B981');
        }

        // Signal Probability Gauges
        const probListEl = document.getElementById('signal-prob-list');
        if (probListEl) {
            probListEl.innerHTML = threatEval.probabilities.map(s => `
                <div class="signal-prob-row">
                    <div class="signal-prob-top">
                        <div>
                            <span class="signal-badge-icon" style="background:${s.color};">${s.code}</span>
                            <span>${s.name}</span>
                        </div>
                        <span style="color:${s.color};font-weight:900;">${s.prob}% <span style="font-size:0.68rem;color:var(--sub-text);font-weight:600;">(${s.desc})</span></span>
                    </div>
                    <div class="signal-prob-track">
                        <div class="signal-prob-fill" style="width:${s.prob}%;background:${s.color};"></div>
                    </div>
                </div>
            `).join('');
        }

        // Situation Analysis Bullets
        const bulletsEl = document.getElementById('situation-analysis-bullets');
        if (bulletsEl) {
            bulletsEl.innerHTML = threatEval.bullets.map(b => `
                <div style="padding:9px 12px;border-radius:12px;background:rgba(255,255,255,0.04);border-left:3px solid var(--accent-color);">
                    ${b}
                </div>
            `).join('');
        }

        // 8-Reference Anemometer Stations Grid
        const staGridEl = document.getElementById('ref-stations-grid');
        if (staGridEl) {
            staGridEl.innerHTML = threatEval.localWinds.stations.map(st => `
                <div class="ref-sta-card ${st.level}">
                    <div class="ref-sta-header">
                        <span class="ref-sta-name">${st.name} <span style="font-size:0.68rem;color:var(--sub-text);font-weight:500;">${st.en}</span></span>
                        <span class="ref-sta-tag">${st.role}</span>
                    </div>
                    <div class="ref-sta-wind">
                        ${st.sustainedKmh} <span>km/h • 陣風 ${st.gustKmh}</span>
                    </div>
                    <div style="font-size:0.7rem;color:var(--sub-text);display:flex;justify-content:space-between;">
                        <span>風向：${st.windDirZh}</span>
                        <span style="font-weight:700;">${st.statusZh}</span>
                    </div>
                </div>
            `).join('');
        }
    }

    function renderReplayArchiveList() {
        const listEl = document.getElementById('replay-cases-list');
        if (!listEl) return;

        listEl.innerHTML = window.STORM_CASES_ARCHIVE.map(c => {
            const isAct = c.id === activeCaseId;
            const cons = StormEngine.buildConsensusTrack(c.agencies, [-12, 0, 12, 24, 36, 48, 72, 96]);
            const cpa = StormEngine.computeCPA(cons, c.baseTime);
            return `<div class="case-card ${isAct ? 'active-case' : ''}" onclick="StormApp.selectCaseFromArchive('${c.id}')">
                <div class="case-card-top">
                    <div class="case-title">
                        <span>🌀 ${c.code} ${c.nameZh} (${c.nameEn})</span>
                    </div>
                    <span class="case-signal-badge" style="background:${c.badgeColor};">${c.peakSignal}</span>
                </div>
                <div class="case-desc">${c.summary}</div>
                <div class="case-metrics-row">
                    <span>🎯 最接近香港 CPA：<b style="color:var(--accent-color);">${cpa ? cpa.cpaDistKm : '--'} km (${cpa ? cpa.cpaBearingZh : ''})</b></span>
                    <span>💨 巔峰強度：<b>${c.categoryName}</b></span>
                    <span style="margin-left:auto;color:var(--accent-color);">${isAct ? '● 當前載入中' : '點擊載入重演 ➔'}</span>
                </div>
            </div>`;
        }).join('');
    }

    function selectCaseFromArchive(caseId) {
        loadStormCase(caseId, true);
        AppNav.goTo(0);
    }

    function triggerEmergencyDrill() {
        if (navigator.vibrate) {
            navigator.vibrate([120, 80, 180, 80, 260]);
        }
        loadStormCase('2025-ragasa', false);
        jumpToCPA();
        AppNav.goTo(1);
        showUltraToast('🚨 防風演習啟動：八號東南烈風或暴風信號生效 (CPA 極近距模式)');
    }

    async function syncLiveBackend(manual = false) {
        const dot = document.getElementById('api-status-dot');
        const txt = document.getElementById('api-status-text');
        if (txt) txt.innerText = '同步中...';
        try {
            const [workerRes, hkoRes] = await Promise.allSettled([
                fetchWithTimeout('https://storm.max-yu.workers.dev/api/storms', { timeout: 3500 }),
                fetchWithTimeout('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc', { timeout: 3500 })
            ]);
            if (dot) dot.style.background = '#10B981';
            if (txt) txt.innerText = 'HKO + Worker 就緒';
            if (manual) {
                showUltraToast('✅ 已同步 storm.max-yu.workers.dev 與香港天文台最新開放數據');
            }
        } catch (e) {
            if (dot) dot.style.background = '#38BDF8';
            if (txt) txt.innerText = '離線風暴庫模式';
            if (manual) {
                showUltraToast('📡 當前處於離線封裝模式，已載入內建高精度多機構路徑庫');
            }
        }
    }

    return {
        init,
        getActiveCase,
        getConsensusTrack,
        getCurrentPoint,
        loadStormCase,
        setTimelineIndex,
        toggleTimelinePlay,
        jumpToCPA,
        refreshAllViews,
        selectCaseFromArchive,
        triggerEmergencyDrill,
        syncLiveBackend
    };
})();

window.ThemeManager = ThemeManager;
window.AppNav = AppNav;
window.RadarMapManager = RadarMapManager;
window.AgencyLabManager = AgencyLabManager;
window.StormApp = StormApp;
