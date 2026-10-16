// ==========================================================================
// Storm-Track Ultra 2.0 - Geodesic, Consensus Track & HK Signal V2 Engine
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

    // Bearing from point 1 (e.g. HKO) to point 2 (e.g. Storm Center) in degrees [0, 360)
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

    // Estimate 30kt (Strong), 50kt (Gale), 64kt (Hurricane) radii in km
    function computeWindRadiiKm(windKmh, lat) {
        const latFactor = 1 + Math.max(0, (lat - 16) * 0.015);
        const r30 = windKmh >= 63  ? Math.round((165 + (windKmh - 63) * 1.45) * latFactor) : 0;
        const r50 = windKmh >= 88  ? Math.round((75  + (windKmh - 88) * 0.95) * latFactor) : 0;
        const r64 = windKmh >= 118 ? Math.round((32  + (windKmh - 118) * 0.55) * latFactor) : 0;
        return { r30, r50, r64 };
    }

    // Time-aligned linear interpolation for an agency's track at relative hour `targetH`
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

    // Build Multi-Agency Consensus Track Beta with RMS ensemble spread radius
    function buildConsensusTrack(agenciesMap, hours = [-12, 0, 12, 24, 36, 48, 72, 96]) {
        const agencyDefs = window.STORM_AGENCIES.filter(a => !a.isConsensus);
        return hours.map(h => {
            let sumLat = 0, sumLon = 0, sumWind = 0, sumPres = 0, sumW = 0;
            const samples = [];

            agencyDefs.forEach(ag => {
                const tr = agenciesMap[ag.id];
                if (!tr) return;
                const pt = interpolateAgencyAtHour(tr, h);
                if (pt) {
                    const w = ag.weight || 1.0;
                    sumLat += pt.lat * w;
                    sumLon += pt.lon * w;
                    sumWind += pt.windKmh * w;
                    sumPres += pt.pres * w;
                    sumW += w;
                    samples.push({ agencyId: ag.id, ...pt });
                }
            });

            if (sumW === 0) return null;
            const meanLat = Number((sumLat / sumW).toFixed(3));
            const meanLon = Number((sumLon / sumW).toFixed(3));
            const meanWind = Math.round(sumWind / sumW);
            const meanPres = Math.round(sumPres / sumW);

            // Compute ensemble spread (RMS distance in km + forecast horizon baseline cone)
            let sqDistSum = 0;
            samples.forEach(s => {
                const d = haversineKm(meanLat, meanLon, s.lat, s.lon);
                sqDistSum += d * d;
            });
            const rmsSpread = samples.length > 0 ? Math.sqrt(sqDistSum / samples.length) : 0;
            const coneRadiusKm = h <= 0 ? Math.max(12, Math.round(rmsSpread)) : Math.round(Math.max(28, rmsSpread * 1.65 + h * 1.35));

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

    // Sub-hourly dense interpolation to find exact Closest Point of Approach (CPA) to HKO
    function computeCPA(trackPoints, baseTimeIso) {
        if (!trackPoints || trackPoints.length === 0) return null;
        let minDist = Infinity;
        let bestH = 0;
        let bestLat = trackPoints[0].lat;
        let bestLon = trackPoints[0].lon;
        let bestWind = trackPoints[0].windKmh;
        let bestPres = trackPoints[0].pres;

        const sorted = [...trackPoints].sort((a, b) => a.h - b.h);
        for (let i = 0; i < sorted.length - 1; i++) {
            const p0 = sorted[i];
            const p1 = sorted[i + 1];
            const steps = 24;
            for (let s = 0; s <= steps; s++) {
                const r = s / steps;
                const h = p0.h + (p1.h - p0.h) * r;
                const lat = p0.lat + (p1.lat - p0.lat) * r;
                const lon = p0.lon + (p1.lon - p0.lon) * r;
                const wind = p0.windKmh + (p1.windKmh - p0.windKmh) * r;
                const pres = p0.pres + (p1.pres - p0.pres) * r;
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
        const cpaDate = new Date(baseDate.getTime() + bestH * 3600000);
        const pad = n => String(n).padStart(2, '0');
        const cpaTimeFormatted = `${pad(cpaDate.getMonth() + 1)}/${pad(cpaDate.getDate())} ${pad(cpaDate.getHours())}:${pad(cpaDate.getMinutes())}`;

        // Determine Dangerous Semicircle vs Navigable Semicircle for HK
        // When a westward/northwestward moving storm passes SOUTH or SSW of HK (bearing 135° to 245°), HK is in the right-hand Dangerous Semicircle
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

    // Parametric Rankine Combined Vortex + Semi-circle & Terrain Shelter Model for HK Reference Stations
    function simulateHkStationsWind(stormPt) {
        const results = [];
        let strongCount = 0; // >= 41 km/h among 8 reference stations
        let galeCount = 0;   // >= 63 km/h among 8 reference stations
        let stormCount = 0;  // >= 88 km/h among 8 reference stations

        const stormLat = stormPt.lat;
        const stormLon = stormPt.lon;
        const vmax = stormPt.windKmh;
        const rMax = vmax >= 180 ? 28 : (vmax >= 140 ? 36 : 45); // Radius of maximum wind (km)

        window.HKO_REFERENCE_STATIONS.forEach(sta => {
            const dist = haversineKm(stormLat, stormLon, sta.lat, sta.lon);
            const brgFromStormToSta = bearingDeg(stormLat, stormLon, sta.lat, sta.lon);

            // Northern hemisphere cyclone right-front quadrant enhancement (around 0° - 110° relative to WNW track)
            const semicircleBoost = (brgFromStormToSta >= 330 || brgFromStormToSta <= 95) ? 1.16 : 0.86;

            // Modified Rankine vortex profile
            let baseWind = 0;
            if (dist <= rMax) {
                baseWind = vmax * (dist / rMax) * 0.78;
            } else {
                const alpha = dist < 180 ? 0.52 : 0.66;
                baseWind = vmax * Math.pow(rMax / dist, alpha) * 0.78;
            }

            const sustainedKmh = Math.max(12, Math.round(baseWind * semicircleBoost * sta.exposure));
            const gustKmh = Math.round(sustainedKmh * (sta.isOutpost ? 1.38 : 1.45));

            // Local inflow wind direction (cyclonic counter-clockwise + 18 deg inflow angle)
            const windFromDeg = (brgFromStormToSta - 72 + 360) % 360;
            const windDirZh = compass16Zh(windFromDeg);

            let level = 'normal';
            let statusZh = '清勁 (<41)';
            if (sustainedKmh >= 118) {
                level = 'storm';
                statusZh = '颶風 (≥118)';
            } else if (sustainedKmh >= 88) {
                level = 'storm';
                statusZh = '暴風 (88-117)';
            } else if (sustainedKmh >= 63) {
                level = 'gale';
                statusZh = '烈風達標 (≥63)';
            } else if (sustainedKmh >= 41) {
                level = 'strong';
                statusZh = '強風達標 (≥41)';
            }

            if (!sta.isOutpost) {
                if (sustainedKmh >= 41) strongCount++;
                if (sustainedKmh >= 63) galeCount++;
                if (sustainedKmh >= 88) stormCount++;
            }

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

        return {
            stations: results,
            strongCount,
            galeCount,
            stormCount
        };
    }

    // Evaluate HK Signal V2 Probabilities & Situation Analysis
    function evaluateHkThreatV2(currentPt, consensusTrack, cpaInfo) {
        const localWinds = simulateHkStationsWind(currentPt);
        const currDist = currentPt.distHk;
        const cpaDist = cpaInfo ? cpaInfo.cpaDistKm : currDist;
        const effDist = Math.min(currDist, cpaDist * 0.92);
        const effWind = Math.max(currentPt.windKmh, cpaInfo ? cpaInfo.cpaWindKmh : currentPt.windKmh);
        const semiBoost = (cpaInfo && cpaInfo.isDangerousSemicircle) ? 1.15 : 0.88;

        // Compute probabilities [0..99] for T1, T3, T8, T9, T10
        let p1 = 0, p3 = 0, p8 = 0, p9 = 0, p10 = 0;

        if (effDist <= 820) {
            p1 = Math.min(99, Math.round(Math.max(25, (850 - effDist) / 4.8)));
        }
        if (effDist <= 550 && effWind >= 63) {
            p3 = Math.min(99, Math.round(((550 - effDist) / 3.4) * (effWind / 110) * semiBoost));
        }
        if (effDist <= 340 && effWind >= 88) {
            p8 = Math.min(98, Math.round(((340 - effDist) / 2.2) * (effWind / 135) * semiBoost));
        }
        if (effDist <= 145 && effWind >= 145) {
            p9 = Math.min(95, Math.round(((150 - effDist) / 1.35) * (effWind / 170) * semiBoost));
        }
        if (effDist <= 95 && effWind >= 175) {
            p10 = Math.min(92, Math.round(((105 - effDist) / 1.05) * (effWind / 185) * semiBoost));
        }

        // Enforce monotonic consistency with current 8-station observations
        if (localWinds.strongCount >= 4) p3 = Math.max(p3, 95);
        if (localWinds.galeCount >= 4)   p8 = Math.max(p8, 94);
        if (localWinds.stormCount >= 2 && currDist <= 90) p10 = Math.max(p10, 88);

        p1 = Math.max(p1, p3);
        p3 = Math.max(p3, p8);
        p8 = Math.max(p8, p9);
        p9 = Math.max(p9, p10);

        let recSignal = '無需發出信號';
        let recBadgeColor = '#10B981';
        if (p10 >= 65 && currDist <= 140) {
            recSignal = '十號颶風信號 (T10)';
            recBadgeColor = '#C084FC';
        } else if (p9 >= 65 && currDist <= 180) {
            recSignal = '九號風力增強 (T9)';
            recBadgeColor = '#EC4899';
        } else if (p8 >= 60 || localWinds.galeCount >= 4) {
            recSignal = '八號烈風或暴風 (T8)';
            recBadgeColor = '#EF4444';
        } else if (p3 >= 55 || localWinds.strongCount >= 4) {
            recSignal = '三號強風信號 (T3)';
            recBadgeColor = '#F59E0B';
        } else if (p1 >= 50 || currDist <= 800) {
            recSignal = '一號戒備信號 (T1)';
            recBadgeColor = '#38BDF8';
        }

        const bullets = [
            `🎯 <b>路徑與 CPA 幾何定位：</b>風暴目前位於香港天文台<b>${currentPt.bearingZh}約 ${currentPt.distHk} 公里</b>（中心持續風速 ${currentPt.windKmh} km/h，氣壓 ${currentPt.pres} hPa）。多機構共識預計於 <b>${cpaInfo.cpaTimeStr}</b> 在香港<b>${cpaInfo.cpaBearingZh}約 ${cpaInfo.cpaDistKm} 公里</b>處最接近本港。`,
            cpaInfo.isDangerousSemicircle
                ? `⚠️ <b>危險半圓與東南無屏障效應：</b>由於風暴於香港南至西南方掠過（「西登」格局），香港處於風暴移動方向的右半圓（<b>危險半圓</b>），風暴移行速度與環流風速疊加；當風向由東北轉吹東至東南風時，維港及南區無地形遮擋，風力及風暴潮將顯著飆升。`
                : `🛡️ <b>可航半圓與地形屏障效應：</b>風暴預計於偏東或偏北路徑掠過，香港主要吹北至西北風，受新界及大嶼山山脈地形屏障削弱，市區風力較離岸及高地溫和。`,
            `🚩 <b>八大參考測風站實況推演：</b>目前時段八大參考站中有 <b>${localWinds.strongCount} / 8 站達強風程度 (≥41 km/h)</b>、<b>${localWinds.galeCount} / 8 站達烈風程度 (≥63 km/h)</b>（天文台三號及八號信號標準為 8 站中至少 4 站持續達標或預計達標）。`
        ];

        return {
            probabilities: [
                { code: 'T1',  name: '一號戒備信號 (Standby Signal No. 1)',           prob: p1,  color: '#38BDF8', desc: '800 km 警戒範圍內戒備' },
                { code: 'T3',  name: '三號強風信號 (Strong Wind Signal No. 3)',       prob: p3,  color: '#F59E0B', desc: `強風站數 ${localWinds.strongCount}/8 (門檻 4/8)` },
                { code: 'T8',  name: '八號烈風或暴風信號 (Gale or Storm No. 8)',      prob: p8,  color: '#EF4444', desc: `烈風站數 ${localWinds.galeCount}/8 (門檻 4/8)` },
                { code: 'T9',  name: '九號烈風或暴風風力增強信號 (Increasing Gale 9)', prob: p9,  color: '#EC4899', desc: '中心逼近 150km 內且風力急升' },
                { code: 'T10', name: '十號颶風信號 (Hurricane Signal No. 10)',        prob: p10, color: '#C084FC', desc: '颶風圈 (≥118 km/h) 正面掠過本港' }
            ],
            recSignal,
            recBadgeColor,
            localWinds,
            bullets
        };
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
        simulateHkStationsWind,
        evaluateHkThreatV2
    };
})();

window.StormEngine = StormEngine;
