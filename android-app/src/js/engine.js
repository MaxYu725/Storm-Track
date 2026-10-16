// ==========================================================================
// Storm-Track Ultra 2.2 - Geodesic, Universal Worker JSON Parser,
// Consensus Track & HK Signal V2 Engine
// ==========================================================================

const StormEngine = (function() {
    const DEG2RAD = Math.PI / 180;
    const RAD2DEG = 180 / Math.PI;
    const EARTH_R_KM = 6371.0;

    function haversineKm(lat1, lon1, lat2, lon2) {
        const dLat = (lat2 - lat1) * DEG2RAD;
        const dLon = (lon2 - lon1) * DEG2RAD;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return EARTH_R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function bearingDeg(lat1, lon1, lat2, lon2) {
        const phi1 = lat1 * DEG2RAD;
        const phi2 = lat2 * DEG2RAD;
        const dLam = (lon2 - lon1) * DEG2RAD;
        const y = Math.sin(dLam) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) -
                  Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
        return (Math.atan2(y, x) * RAD2DEG + 360) % 360;
    }

    function compass16Zh(deg) {
        const dirs = [
            '北', '東北偏北', '東北', '東北偏東',
            '東', '東南偏東', '東南', '東南偏南',
            '南', '西南偏南', '西南', '西南偏西',
            '西', '西北偏西', '西北', '西北偏北'
        ];
        const idx = Math.round(((deg % 360) / 22.5)) % 16;
        return dirs[idx];
    }

    function classifyHkoCategory(windKmh) {
        if (windKmh >= 185) return { code: 'SuperTY', nameZh: '超強颱風', short: '超強颱風', color: '#C084FC' };
        if (windKmh >= 150) return { code: 'STY',     nameZh: '強颱風',   short: '強颱風',   color: '#EC4899' };
        if (windKmh >= 118) return { code: 'TY',      nameZh: '颱風',     short: '颱風',     color: '#EF4444' };
        if (windKmh >= 88)  return { code: 'STS',     nameZh: '強烈熱帶風暴', short: '強烈風暴', color: '#F59E0B' };
        if (windKmh >= 63)  return { code: 'TS',      nameZh: '熱帶風暴', short: '熱帶風暴', color: '#10B981' };
        return { code: 'TD', nameZh: '熱帶低氣壓', short: '熱帶低氣壓', color: '#38BDF8' };
    }

    function computeWindRadiiKm(windKmh, lat) {
        const latFactor = 1 + Math.max(0, (lat - 16) * 0.015);
        const r30 = windKmh >= 63  ? Math.round((150 + (windKmh - 63) * 1.35) * latFactor) : 0;
        const r50 = windKmh >= 88  ? Math.round((70  + (windKmh - 88) * 0.90) * latFactor) : 0;
        const r64 = windKmh >= 118 ? Math.round((30  + (windKmh - 118) * 0.50) * latFactor) : 0;
        return { r30, r50, r64 };
    }

    function interpolateAgencyAtHour(track, targetH) {
        if (!track || track.length === 0) return null;
        const sorted = [...track].sort((a, b) => a.h - b.h);
        if (targetH <= sorted[0].h) return { ...sorted[0], h: targetH };
        if (targetH >= sorted[sorted.length - 1].h) return { ...sorted[sorted.length - 1], h: targetH };

        for (let i = 0; i < sorted.length - 1; i++) {
            const p0 = sorted[i];
            const p1 = sorted[i + 1];
            if (targetH >= p0.h && targetH <= p1.h) {
                const ratio = (p1.h === p0.h) ? 0 : (targetH - p0.h) / (p1.h - p0.h);
                return {
                    h: targetH,
                    lat: Number((p0.lat + (p1.lat - p0.lat) * ratio).toFixed(3)),
                    lon: Number((p0.lon + (p1.lon - p0.lon) * ratio).toFixed(3)),
                    windKmh: Math.round(p0.windKmh + (p1.windKmh - p0.windKmh) * ratio),
                    pres: Math.round(p0.pres + (p1.pres - p0.pres) * ratio)
                };
            }
        }
        return null;
    }

    function buildConsensusTrack(agenciesMap, hours = [0, 12, 24, 36, 48, 72, 96, 120]) {
        const agencyDefs = window.STORM_AGENCIES.filter(a => !a.isConsensus);
        return hours.map(h => {
            let sumLat = 0, sumLon = 0, sumWind = 0, sumPres = 0, sumW = 0;
            const samples = [];

            agencyDefs.forEach(ag => {
                const tr = agenciesMap && agenciesMap[ag.id];
                if (!tr || tr.length === 0) return;
                const pt = interpolateAgencyAtHour(tr, h);
                if (pt && !isNaN(pt.lat) && !isNaN(pt.lon)) {
                    const w = ag.weight || 1.0;
                    sumLat += pt.lat * w;
                    sumLon += pt.lon * w;
                    sumWind += (pt.windKmh || 65) * w;
                    sumPres += (pt.pres || 994) * w;
                    sumW += w;
                    samples.push({ agencyId: ag.id, ...pt });
                }
            });

            if (sumW === 0) return null;
            const meanLat = Number((sumLat / sumW).toFixed(3));
            const meanLon = Number((sumLon / sumW).toFixed(3));
            const meanWind = Math.round(sumWind / sumW);
            const meanPres = Math.round(sumPres / sumW);

            let sqDistSum = 0;
            samples.forEach(s => {
                const d = haversineKm(meanLat, meanLon, s.lat, s.lon);
                sqDistSum += d * d;
            });
            const rmsSpread = samples.length > 0 ? Math.sqrt(sqDistSum / samples.length) : 0;
            const coneRadiusKm = h <= 0 ? Math.max(12, Math.round(rmsSpread)) : Math.round(Math.max(25, rmsSpread * 1.5 + h * 1.2));

            const distHk = Math.round(haversineKm(window.HKO_HQ.lat, window.HKO_HQ.lon, meanLat, meanLon));
            const brgHk = bearingDeg(window.HKO_HQ.lat, window.HKO_HQ.lon, meanLat, meanLon);
            const radii = computeWindRadiiKm(meanWind, meanLat);
            const cat = classifyHkoCategory(meanWind);

            return {
                h,
                lat: meanLat,
                lon: meanLon,
                windKmh: meanWind,
                pres: meanPres,
                spreadKm: Math.round(rmsSpread),
                coneRadiusKm,
                distHk,
                bearingDeg: Math.round(brgHk),
                bearingZh: compass16Zh(brgHk),
                radii,
                category: cat,
                samples
            };
        }).filter(Boolean);
    }

    function computeCPA(trackPoints, baseTimeIso) {
        if (!trackPoints || trackPoints.length === 0) return null;
        let minDist = Infinity;
        let bestH = 0;
        let bestLat = trackPoints[0].lat;
        let bestLon = trackPoints[0].lon;
        let bestWind = trackPoints[0].windKmh || 65;
        let bestPres = trackPoints[0].pres || 994;

        const sorted = [...trackPoints].sort((a, b) => a.h - b.h);
        for (let i = 0; i < sorted.length - 1; i++) {
            const p0 = sorted[i];
            const p1 = sorted[i + 1];
            const steps = 20;
            for (let s = 0; s <= steps; s++) {
                const r = s / steps;
                const h = p0.h + (p1.h - p0.h) * r;
                const lat = p0.lat + (p1.lat - p0.lat) * r;
                const lon = p0.lon + (p1.lon - p0.lon) * r;
                const wind = (p0.windKmh || 65) + ((p1.windKmh || 65) - (p0.windKmh || 65)) * r;
                const pres = (p0.pres || 994) + ((p1.pres || 994) - (p0.pres || 994)) * r;
                const d = haversineKm(window.HKO_HQ.lat, window.HKO_HQ.lon, lat, lon);
                if (d < minDist) {
                    minDist = d;
                    bestH = h;
                    bestLat = lat;
                    bestLon = lon;
                    bestWind = Math.round(wind);
                    bestPres = Math.round(pres);
                }
            }
        }

        const brg = bearingDeg(window.HKO_HQ.lat, window.HKO_HQ.lon, bestLat, bestLon);
        const baseDate = baseTimeIso ? new Date(baseTimeIso) : new Date();
        const validBase = isNaN(baseDate.getTime()) ? new Date() : baseDate;
        const cpaDate = new Date(validBase.getTime() + bestH * 3600000);
        const pad = n => String(n).padStart(2, '0');
        const cpaTimeFormatted = `${pad(cpaDate.getDate())}/${pad(cpaDate.getMonth() + 1)} ${pad(cpaDate.getHours())}:${pad(cpaDate.getMinutes())}`;
        const isDangerousSemicircle = (brg >= 120 && brg <= 250);

        return {
            cpaDistKm: Math.round(minDist),
            cpaHour: Number(bestH.toFixed(1)),
            cpaTimeStr: cpaTimeFormatted,
            cpaLat: Number(bestLat.toFixed(2)),
            cpaLon: Number(bestLon.toFixed(2)),
            cpaWindKmh: bestWind,
            cpaPres: bestPres,
            cpaBearingDeg: Math.round(brg),
            cpaBearingZh: compass16Zh(brg),
            isDangerousSemicircle
        };
    }

    // Compute closest CPA across all individual agencies (matches Web "預測最近距港：1705 km ( CWA )")
    function computeBestAgencyCPA(stormCase) {
        if (!stormCase || !stormCase.agencies) return null;
        let best = null;
        Object.keys(stormCase.agencies).forEach(agId => {
            const tr = stormCase.agencies[agId];
            if (!tr || tr.length === 0) return;
            const cpa = computeCPA(tr, stormCase.baseTime);
            if (cpa && (!best || cpa.cpaDistKm < best.cpaDistKm)) {
                best = { ...cpa, agencyId: agId };
            }
        });
        return best;
    }

    function simulateHkStationsWind(stormPt) {
        const results = [];
        let strongCount = 0, galeCount = 0, stormCount = 0;

        const stormLat = stormPt.lat;
        const stormLon = stormPt.lon;
        const vmax = stormPt.windKmh || 65;
        const rMax = vmax >= 180 ? 28 : (vmax >= 140 ? 36 : 45);

        window.HKO_REFERENCE_STATIONS.forEach(sta => {
            const dist = haversineKm(stormLat, stormLon, sta.lat, sta.lon);
            const brgFromStormToSta = bearingDeg(stormLat, stormLon, sta.lat, sta.lon);
            const semicircleBoost = (brgFromStormToSta >= 330 || brgFromStormToSta <= 95) ? 1.16 : 0.86;

            let baseWind = 0;
            if (dist > 950) {
                baseWind = 16; // Ambient monsoon/trade wind when storm is >950km away
            } else if (dist <= rMax) {
                baseWind = vmax * (dist / rMax) * 0.78;
            } else {
                const alpha = dist < 180 ? 0.52 : 0.66;
                baseWind = vmax * Math.pow(rMax / dist, alpha) * 0.78;
            }

            const sustainedKmh = Math.max(12, Math.round(baseWind * semicircleBoost * sta.exposure));
            const gustKmh = Math.round(sustainedKmh * 1.42);
            const windFromDeg = dist > 950 ? 85 : ((brgFromStormToSta - 72 + 360) % 360);
            const windDirZh = compass16Zh(windFromDeg);

            let level = 'normal', statusZh = '清勁 (<41)';
            if (sustainedKmh >= 88) { level = 'storm'; statusZh = '暴風 (≥88)'; stormCount++; galeCount++; strongCount++; }
            else if (sustainedKmh >= 63) { level = 'gale'; statusZh = '烈風 (≥63)'; galeCount++; strongCount++; }
            else if (sustainedKmh >= 41) { level = 'strong'; statusZh = '強風 (≥41)'; strongCount++; }

            results.push({
                ...sta,
                distKm: Math.round(dist),
                sustainedKmh,
                gustKmh,
                windDirZh,
                level,
                statusZh
            });
        });

        return { stations: results, strongCount, galeCount, stormCount };
    }

    function evaluateHkThreatV2(currentPt, consensusTrack, cpaInfo, liveWindsOverride = null) {
        const simWinds = simulateHkStationsWind(currentPt);
        const localWinds = (currentPt.distHk > 850 && liveWindsOverride) ? liveWindsOverride : simWinds;
        const currDist = currentPt.distHk;
        const cpaDist = cpaInfo ? cpaInfo.cpaDistKm : currDist;
        const effDist = Math.min(currDist, cpaDist * 0.92);
        const effWind = Math.max(currentPt.windKmh, cpaInfo ? cpaInfo.cpaWindKmh : currentPt.windKmh);
        const semiBoost = (cpaInfo && cpaInfo.isDangerousSemicircle) ? 1.15 : 0.88;

        let p1 = 0, p3 = 0, p8 = 0, p9 = 0, p10 = 0;
        if (effDist <= 820) p1 = Math.min(99, Math.round(Math.max(20, (850 - effDist) / 4.8)));
        if (effDist <= 550 && effWind >= 63) p3 = Math.min(99, Math.round(((550 - effDist) / 3.4) * (effWind / 110) * semiBoost));
        if (effDist <= 340 && effWind >= 88) p8 = Math.min(98, Math.round(((340 - effDist) / 2.2) * (effWind / 135) * semiBoost));
        if (effDist <= 145 && effWind >= 145) p9 = Math.min(95, Math.round(((150 - effDist) / 1.35) * (effWind / 170) * semiBoost));
        if (effDist <= 95 && effWind >= 175) p10 = Math.min(92, Math.round(((105 - effDist) / 1.05) * (effWind / 185) * semiBoost));

        if (localWinds.strongCount >= 4) p3 = Math.max(p3, 95);
        if (localWinds.galeCount >= 4)   p8 = Math.max(p8, 94);

        p1 = Math.max(p1, p3);
        p3 = Math.max(p3, p8);
        p8 = Math.max(p8, p9);
        p9 = Math.max(p9, p10);

        let recSignal = '無需發出信號 (距港 >800km)';
        let recBadgeColor = '#10B981';
        if (p10 >= 65 && currDist <= 140) { recSignal = '十號颶風信號 (T10)'; recBadgeColor = '#C084FC'; }
        else if (p9 >= 65 && currDist <= 180) { recSignal = '九號風力增強 (T9)'; recBadgeColor = '#EC4899'; }
        else if (p8 >= 60 || localWinds.galeCount >= 4) { recSignal = '八號烈風或暴風 (T8)'; recBadgeColor = '#EF4444'; }
        else if (p3 >= 55 || localWinds.strongCount >= 4) { recSignal = '三號強風信號 (T3)'; recBadgeColor = '#F59E0B'; }
        else if (p1 >= 50 || currDist <= 800) { recSignal = '一號戒備信號 (T1)'; recBadgeColor = '#38BDF8'; }

        const bullets = [
            `🎯 <b>風暴位置與最近距港評估：</b>風暴目前位於 <b>${currentPt.lat.toFixed(1)}°N, ${currentPt.lon.toFixed(1)}°E</b>（距離香港天文台<b>${currentPt.bearingZh}約 ${currentPt.distHk} km</b>，中心風速 ${currentPt.windKmh} km/h）。預測最近距港約 <b>${cpaInfo ? cpaInfo.cpaDistKm : currentPt.distHk} km</b>。`,
            currDist > 800
                ? `🟢 <b>香港防風狀態：</b>風暴目前位於香港 800 公里警戒範圍以外，對本港暫無直接風力威脅，系統持續追蹤 CMA、JMA、CWA 及 HKO 最新路徑預報。`
                : (cpaInfo && cpaInfo.isDangerousSemicircle
                    ? `⚠️ <b>危險半圓效應：</b>風暴預計於香港南至西南方掠過，香港處於風暴移動右半圓（危險半圓），轉吹東至東南風時無地形屏障，風力將顯著增強。`
                    : `🛡️ <b>可航半圓與地形屏障：</b>香港主要受偏北至西北氣流影響，受內陸山脈屏障削弱。`)
        ];

        return {
            probabilities: [
                { code: 'T1',  name: '一號戒備信號',       prob: p1,  color: '#38BDF8' },
                { code: 'T3',  name: '三號強風信號',       prob: p3,  color: '#F59E0B' },
                { code: 'T8',  name: '八號烈風或暴風信號', prob: p8,  color: '#EF4444' },
                { code: 'T9',  name: '九號風力增強信號',   prob: p9,  color: '#EC4899' },
                { code: 'T10', name: '十號颶風信號',       prob: p10, color: '#C084FC' }
            ],
            recSignal,
            recBadgeColor,
            localWinds,
            bullets
        };
    }

    // ==========================================================================
    // UNIVERSAL SCHEMA-AGNOSTIC WORKER / MULTI-AGENCY JSON PARSER
    // Parses ANY JSON structure returned by https://storm.max-yu.workers.dev
    // ==========================================================================
    function extractLatLon(pt) {
        if (!pt) return null;
        let lat = pt.lat ?? pt.latitude ?? pt.y;
        let lon = pt.lon ?? pt.lng ?? pt.longitude ?? pt.x;
        if (Array.isArray(pt) && pt.length >= 2) {
            const a = Number(pt[0]), b = Number(pt[1]);
            if (Math.abs(a) <= 65 && Math.abs(b) >= 90) { lat = a; lon = b; }
            else { lon = a; lat = b; }
        } else if (Array.isArray(pt.position || pt.coord || pt.coordinates)) {
            return extractLatLon(pt.position || pt.coord || pt.coordinates);
        }
        lat = parseFloat(String(lat).replace(/[^0-9.-]/g, ''));
        lon = parseFloat(String(lon).replace(/[^0-9.-]/g, ''));
        if (isNaN(lat) || isNaN(lon)) return null;
        if (lat > 75 && lon < 75) { const tmp = lat; lat = lon; lon = tmp; }
        return { lat: Number(lat.toFixed(2)), lon: Number(lon.toFixed(2)) };
    }

    function extractWindKmh(pt) {
        const rawKmh = pt.windKmh ?? pt.wind_kmh ?? pt.maxWindKmh ?? pt.speedKmh;
        if (rawKmh !== undefined && !isNaN(Number(rawKmh))) return Math.round(Number(rawKmh));
        const rawKt = pt.windKt ?? pt.wind_kt ?? pt.knots ?? pt.kts ?? pt.maxWindKt;
        if (rawKt !== undefined && !isNaN(Number(rawKt))) return Math.round(Number(rawKt) * 1.852);
        const rawMs = pt.windMs ?? pt.wind_ms ?? pt.ms ?? pt.vmax_ms;
        if (rawMs !== undefined && !isNaN(Number(rawMs))) return Math.round(Number(rawMs) * 3.6);
        const generic = Number(pt.wind ?? pt.maxWind ?? pt.windSpeed ?? pt.speed ?? pt.vmax ?? 68);
        if (isNaN(generic) || generic <= 0) return 68;
        // Heuristic: if <= 75 and likely m/s (e.g. 18-65 m/s), check if pt has unit; default < 55 -> *3.6
        if (generic <= 52) return Math.round(generic * 3.6);
        return Math.round(generic);
    }

    function normalizePointList(rawList, isForecast = true) {
        if (!Array.isArray(rawList) || rawList.length === 0) return [];
        const pts = [];
        rawList.forEach((item, idx) => {
            const coords = extractLatLon(item);
            if (!coords) return;
            const windKmh = extractWindKmh(item);
            const pres = Math.round(Number(item.pres ?? item.pressure ?? item.centralPressure ?? item.mslp ?? 994));
            let h = item.h ?? item.hour ?? item.forecastHour ?? item.leadHours ?? item.tau;
            if (h === undefined || isNaN(Number(h))) {
                h = isForecast ? idx * 12 : -(rawList.length - 1 - idx) * 12;
            }
            pts.push({
                h: Number(h),
                lat: coords.lat,
                lon: coords.lon,
                windKmh,
                pres
            });
        });
        return pts;
    }

    function parseAnyWorkerPayload(json) {
        if (!json || typeof json !== 'object') return [];
        const parsedStorms = [];

        // Case 1: Array of storm objects in json.storms / json.activeStorms / json.data / json.cases / json
        const candidateArr = json.storms || json.activeStorms || json.cyclones || json.cases || json.items || (Array.isArray(json) ? json : null);
        if (Array.isArray(candidateArr) && candidateArr.length > 0) {
            candidateArr.forEach((s, idx) => {
                const agencies = {};
                let observedTrack = [];
                const srcObj = s.agencies || s.sources || s.tracks || s.models || s;

                ['HKO', 'CMA', 'JMA', 'CWA', 'JTWC'].forEach(agKey => {
                    const rawAg = srcObj[agKey] || srcObj[agKey.toLowerCase()];
                    if (!rawAg) return;
                    if (Array.isArray(rawAg)) {
                        agencies[agKey] = normalizePointList(rawAg, true);
                    } else if (typeof rawAg === 'object') {
                        const obs = normalizePointList(rawAg.analysis || rawAg.history || rawAg.observed || rawAg.past || rawAg.track || [], false);
                        const fc = normalizePointList(rawAg.forecast || rawAg.future || rawAg.forecastTrack || rawAg.points || [], true);
                        if (obs.length > 0 && observedTrack.length === 0) observedTrack = obs;
                        if (fc.length > 0) {
                            if (obs.length > 0 && fc[0].h > 0) {
                                agencies[agKey] = [{ ...obs[obs.length - 1], h: 0 }, ...fc];
                            } else {
                                agencies[agKey] = fc;
                            }
                        } else if (obs.length > 0) {
                            agencies[agKey] = [{ ...obs[obs.length - 1], h: 0 }];
                        }
                    }
                });

                if (observedTrack.length === 0 && Array.isArray(s.observedTrack || s.history || s.analysis || s.past)) {
                    observedTrack = normalizePointList(s.observedTrack || s.history || s.analysis || s.past, false);
                }

                const activeSources = Object.keys(agencies).filter(k => agencies[k] && agencies[k].length > 0);
                if (activeSources.length > 0) {
                    const nameZh = s.nameZh || s.cnName || s.name_zh || s.tcName || s.name || '活躍風暴';
                    const nameEn = (s.nameEn || s.enName || s.name_en || s.id || '').toUpperCase();
                    const firstAg = agencies[activeSources[0]];
                    const p0 = firstAg[0];
                    const cat = classifyHkoCategory(p0.windKmh);

                    parsedStorms.push({
                        id: s.id || `live-storm-${idx}`,
                        code: s.code || s.number || s.typhoonNumber || 'LIVE',
                        nameZh,
                        nameEn,
                        displayTitle: nameEn && !nameZh.includes(nameEn) ? `${nameZh} (${nameEn})` : nameZh,
                        category: cat.code,
                        categoryName: s.intensity || s.categoryName || cat.nameZh,
                        badgeColor: cat.color,
                        peakSignal: '實時監測中',
                        bulletinTime: s.bulletinTime || s.updatedAt || s.issueTime || '最新公報',
                        baseTime: s.baseTime || s.updatedAt || new Date().toISOString(),
                        latestPosText: `${p0.lat.toFixed(1)}°N, ${p0.lon.toFixed(1)}°E`,
                        activeSources,
                        isLive: true,
                        observedTrack,
                        agencies,
                        summary: s.summary || `實時位置 ${p0.lat.toFixed(1)}°N, ${p0.lon.toFixed(1)}°E，資料來源：${activeSources.join(' / ')}。`
                    });
                }
            });
        }

        // Case 2: Top-level keyed by agency { hko: ..., cma: ..., jma: ..., cwa: ... }
        if (parsedStorms.length === 0) {
            const agencies = {};
            let observedTrack = [];
            let detectedNameZh = '';
            let detectedNameEn = '';

            ['HKO', 'CMA', 'JMA', 'CWA', 'JTWC'].forEach(agKey => {
                const node = json[agKey] || json[agKey.toLowerCase()] || (json.sources && (json.sources[agKey] || json.sources[agKey.toLowerCase()]));
                if (!node) return;
                const item = Array.isArray(node) ? node[0] : (node.storms ? node.storms[0] : node);
                if (!item) return;

                if (!detectedNameZh && (item.nameZh || item.cnName || item.name)) detectedNameZh = item.nameZh || item.cnName || item.name;
                if (!detectedNameEn && (item.nameEn || item.enName)) detectedNameEn = item.nameEn || item.enName;

                const obs = normalizePointList(item.analysis || item.history || item.observed || item.past || item.track || [], false);
                const fc = normalizePointList(item.forecast || item.future || item.forecastTrack || item.points || (Array.isArray(node) ? node : []), true);
                if (obs.length > 0 && observedTrack.length === 0) observedTrack = obs;
                if (fc.length > 0) {
                    agencies[agKey] = (obs.length > 0 && fc[0].h > 0) ? [{ ...obs[obs.length - 1], h: 0 }, ...fc] : fc;
                }
            });

            const activeSources = Object.keys(agencies).filter(k => agencies[k] && agencies[k].length > 0);
            if (activeSources.length > 0) {
                const p0 = agencies[activeSources[0]][0];
                const cat = classifyHkoCategory(p0.windKmh);
                const nameZh = detectedNameZh || '薔琵';
                const nameEn = (detectedNameEn || 'CHAMPI').toUpperCase();
                parsedStorms.push({
                    id: 'live-worker-storm',
                    code: 'LIVE',
                    nameZh,
                    nameEn,
                    displayTitle: nameEn && !nameZh.includes(nameEn) ? `${nameZh} (${nameEn})` : nameZh,
                    category: cat.code,
                    categoryName: cat.nameZh,
                    badgeColor: cat.color,
                    peakSignal: '實時監測中',
                    bulletinTime: '最新公報',
                    baseTime: new Date().toISOString(),
                    latestPosText: `${p0.lat.toFixed(1)}°N, ${p0.lon.toFixed(1)}°E`,
                    activeSources,
                    isLive: true,
                    observedTrack,
                    agencies,
                    summary: `實時位置 ${p0.lat.toFixed(1)}°N, ${p0.lon.toFixed(1)}°E，資料來源：${activeSources.join(' / ')}。`
                });
            }
        }

        return parsedStorms;
    }

    return {
        haversineKm,
        bearingDeg,
        compass16Zh,
        classifyHkoCategory,
        computeWindRadiiKm,
        interpolateAgencyAtHour,
        buildConsensusTrack,
        computeCPA,
        computeBestAgencyCPA,
        simulateHkStationsWind,
        evaluateHkThreatV2,
        parseAnyWorkerPayload
    };
})();

window.StormEngine = StormEngine;
