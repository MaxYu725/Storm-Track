(function attachStormHongKongImpactEngine(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StormHongKongImpactEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHongKongImpactEngine() {
    'use strict';

    const IMPACT_VERSION = 'hk-impact/v1';
    const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
    const DEFAULT_DISTANCE_BANDS_KM = Object.freeze([800, 500, 400, 300, 200, 100]);
    const EARTH_RADIUS_KM = 6371;
    const HOUR_MS = 60 * 60 * 1000;

    function asFiniteNumber(value) {
        if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function parseTimeMs(value) {
        if (value == null || value === '') return null;
        if (Number.isFinite(value)) return value;
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }

    function toIso(ms) {
        return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const values = [lat1, lon1, lat2, lon2].map(asFiniteNumber);
        if (values.some(value => value == null)) return null;
        const [aLat, aLon, bLat, bLon] = values;
        const toRad = degree => degree * Math.PI / 180;
        const dLat = toRad(bLat - aLat);
        const dLon = toRad(bLon - aLon);
        const h = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
        return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function normalizeTrackPoint(point) {
        if (!point || typeof point !== 'object') return null;
        const lat = asFiniteNumber(point.lat);
        const lon = asFiniteNumber(point.lon);
        const timeMs = parseTimeMs(point.timeMs ?? point.time);
        if (lat == null || lon == null || !Number.isFinite(timeMs)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return {
            lat,
            lon,
            timeMs,
            time: toIso(timeMs),
            kind: point.kind ?? null
        };
    }

    function buildSourceTrack(source) {
        if (!source || source.state !== 'ok') return [];
        const positions = (Array.isArray(source.positions) ? source.positions : [])
            .map(normalizeTrackPoint).filter(Boolean).sort((a, b) => a.timeMs - b.timeMs);
        const forecast = (Array.isArray(source.forecast) ? source.forecast : [])
            .map(normalizeTrackPoint).filter(Boolean).sort((a, b) => a.timeMs - b.timeMs);
        const latestAnalysis = positions.length ? positions[positions.length - 1] : null;
        const candidates = [];
        if (latestAnalysis) candidates.push(latestAnalysis);
        forecast.forEach(point => {
            if (!latestAnalysis || point.timeMs >= latestAnalysis.timeMs) candidates.push(point);
        });

        const byTime = new Map();
        candidates.forEach(point => {
            const existing = byTime.get(point.timeMs);
            if (!existing || (existing.kind === 'forecast' && point.kind !== 'forecast')) {
                byTime.set(point.timeMs, point);
            }
        });
        return Array.from(byTime.values()).sort((a, b) => a.timeMs - b.timeMs);
    }

    function normalizeLongitude(lon) {
        let value = lon;
        while (value > 180) value -= 360;
        while (value < -180) value += 360;
        return value;
    }

    function interpolateLongitude(leftLon, rightLon, ratio) {
        let delta = rightLon - leftLon;
        if (delta > 180) delta -= 360;
        else if (delta < -180) delta += 360;
        return normalizeLongitude(leftLon + delta * ratio);
    }

    function interpolatePoint(a, b, ratio) {
        const boundedRatio = Math.max(0, Math.min(1, ratio));
        const timeMs = a.timeMs + (b.timeMs - a.timeMs) * boundedRatio;
        return {
            lat: a.lat + (b.lat - a.lat) * boundedRatio,
            lon: interpolateLongitude(a.lon, b.lon, boundedRatio),
            timeMs,
            time: toIso(timeMs),
            kind: boundedRatio === 0 ? a.kind : (boundedRatio === 1 ? b.kind : 'interpolated'),
            interpolated: boundedRatio > 0 && boundedRatio < 1
        };
    }

    function interpolateTrackAtTime(track, targetMs) {
        if (!Number.isFinite(targetMs) || !track.length) return null;
        const exact = track.find(point => point.timeMs === targetMs);
        if (exact) return { ...exact, interpolated: false };
        if (targetMs < track[0].timeMs || targetMs > track[track.length - 1].timeMs) return null;
        for (let index = 1; index < track.length; index += 1) {
            const before = track[index - 1];
            const after = track[index];
            if (targetMs <= after.timeMs) {
                const span = after.timeMs - before.timeMs;
                if (span <= 0) return { ...before, interpolated: false };
                return interpolatePoint(before, after, (targetMs - before.timeMs) / span);
            }
        }
        return null;
    }

    function pointDistance(referencePoint, point) {
        return haversineKm(referencePoint.lat, referencePoint.lon, point.lat, point.lon);
    }

    function minimizeSegmentDistance(a, b, referencePoint) {
        if (a.timeMs === b.timeMs) {
            return { ratio: 0, point: a, distanceKm: pointDistance(referencePoint, a) };
        }
        let left = 0;
        let right = 1;
        for (let iteration = 0; iteration < 42; iteration += 1) {
            const oneThird = (right - left) / 3;
            const m1 = left + oneThird;
            const m2 = right - oneThird;
            const d1 = pointDistance(referencePoint, interpolatePoint(a, b, m1));
            const d2 = pointDistance(referencePoint, interpolatePoint(a, b, m2));
            if (d1 <= d2) right = m2;
            else left = m1;
        }
        const ratio = (left + right) / 2;
        const point = interpolatePoint(a, b, ratio);
        return { ratio, point, distanceKm: pointDistance(referencePoint, point) };
    }

    function calculateContinuousNearest(track, referencePoint) {
        if (!track.length) return null;
        let best = null;
        const consider = (point, distanceKm, method) => {
            if (!Number.isFinite(distanceKm)) return;
            if (!best || distanceKm < best.distanceKm) {
                best = {
                    distanceKm,
                    time: point.time,
                    timeMs: point.timeMs,
                    lat: point.lat,
                    lon: point.lon,
                    interpolated: Boolean(point.interpolated),
                    method
                };
            }
        };
        track.forEach(point => consider(point, pointDistance(referencePoint, point), 'official-point'));
        for (let index = 1; index < track.length; index += 1) {
            const minimum = minimizeSegmentDistance(track[index - 1], track[index], referencePoint);
            consider(minimum.point, minimum.distanceKm, 'linear-segment-minimum-v1');
        }
        return best;
    }

    function bisectThreshold(a, b, thresholdKm, referencePoint, leftRatio, rightRatio) {
        let left = leftRatio;
        let right = rightRatio;
        let leftValue = pointDistance(referencePoint, interpolatePoint(a, b, left)) - thresholdKm;
        let rightValue = pointDistance(referencePoint, interpolatePoint(a, b, right)) - thresholdKm;
        if (Math.abs(leftValue) < 1e-7) return left;
        if (Math.abs(rightValue) < 1e-7) return right;
        if (leftValue * rightValue > 0) return null;
        for (let iteration = 0; iteration < 48; iteration += 1) {
            const mid = (left + right) / 2;
            const midValue = pointDistance(referencePoint, interpolatePoint(a, b, mid)) - thresholdKm;
            if (Math.abs(midValue) < 1e-7) return mid;
            if (leftValue * midValue <= 0) {
                right = mid;
                rightValue = midValue;
            } else {
                left = mid;
                leftValue = midValue;
            }
        }
        return (left + right) / 2;
    }

    function segmentInsideIntervals(a, b, thresholdKm, referencePoint) {
        const d0 = pointDistance(referencePoint, a);
        const d1 = pointDistance(referencePoint, b);
        if (!Number.isFinite(d0) || !Number.isFinite(d1)) return [];
        const inside0 = d0 <= thresholdKm;
        const inside1 = d1 <= thresholdKm;
        const minimum = minimizeSegmentDistance(a, b, referencePoint);
        const minInside = minimum.distanceKm <= thresholdKm;

        if (inside0 && inside1) return [{ startRatio: 0, endRatio: 1 }];
        if (inside0 && !inside1) {
            const exitRatio = bisectThreshold(a, b, thresholdKm, referencePoint, 0, 1);
            return exitRatio == null ? [] : [{ startRatio: 0, endRatio: exitRatio }];
        }
        if (!inside0 && inside1) {
            const enterRatio = bisectThreshold(a, b, thresholdKm, referencePoint, 0, 1);
            return enterRatio == null ? [] : [{ startRatio: enterRatio, endRatio: 1 }];
        }
        if (!minInside || minimum.ratio <= 1e-9 || minimum.ratio >= 1 - 1e-9) return [];

        const enterRatio = bisectThreshold(a, b, thresholdKm, referencePoint, 0, minimum.ratio);
        const exitRatio = bisectThreshold(a, b, thresholdKm, referencePoint, minimum.ratio, 1);
        if (enterRatio == null || exitRatio == null || exitRatio < enterRatio) return [];
        return [{ startRatio: enterRatio, endRatio: exitRatio }];
    }

    function calculateBandIntervals(track, thresholdKm, referencePoint) {
        if (!track.length) return [];
        if (track.length === 1) {
            const distanceKm = pointDistance(referencePoint, track[0]);
            return distanceKm <= thresholdKm ? [{
                enterTime: track[0].time,
                exitTime: track[0].time,
                durationHours: 0,
                startsInside: true,
                endsInside: true
            }] : [];
        }

        const raw = [];
        for (let index = 1; index < track.length; index += 1) {
            const a = track[index - 1];
            const b = track[index];
            const intervals = segmentInsideIntervals(a, b, thresholdKm, referencePoint);
            intervals.forEach(interval => {
                const start = interpolatePoint(a, b, interval.startRatio);
                const end = interpolatePoint(a, b, interval.endRatio);
                raw.push({ startMs: start.timeMs, endMs: end.timeMs });
            });
        }
        if (!raw.length) return [];
        raw.sort((left, right) => left.startMs - right.startMs);
        const merged = [];
        raw.forEach(interval => {
            const previous = merged[merged.length - 1];
            if (previous && interval.startMs <= previous.endMs + 1000) {
                previous.endMs = Math.max(previous.endMs, interval.endMs);
            } else {
                merged.push({ ...interval });
            }
        });

        const firstDistance = pointDistance(referencePoint, track[0]);
        const lastDistance = pointDistance(referencePoint, track[track.length - 1]);
        return merged.map((interval, index) => ({
            enterTime: toIso(interval.startMs),
            exitTime: toIso(interval.endMs),
            durationHours: (interval.endMs - interval.startMs) / HOUR_MS,
            startsInside: index === 0 && firstDistance <= thresholdKm && interval.startMs === track[0].timeMs,
            endsInside: index === merged.length - 1 && lastDistance <= thresholdKm && interval.endMs === track[track.length - 1].timeMs
        }));
    }

    function classifyAgencyTrend(track, referencePoint, options) {
        if (track.length < 2) return { state: 'unavailable', deltaKm: null, horizonHours: null };
        const thresholdKm = options.trendThresholdKm;
        const requestedHorizonMs = options.trendHorizonHours * HOUR_MS;
        const start = track[0];
        let end = interpolateTrackAtTime(track, start.timeMs + requestedHorizonMs);
        if (!end) end = track.find(point => point.timeMs > start.timeMs) || null;
        if (!end) return { state: 'unavailable', deltaKm: null, horizonHours: null };
        const startDistance = pointDistance(referencePoint, start);
        const endDistance = pointDistance(referencePoint, end);
        const deltaKm = endDistance - startDistance;
        let state = 'steady';
        if (deltaKm <= -thresholdKm) state = 'approaching';
        else if (deltaKm >= thresholdKm) state = 'departing';
        return {
            state,
            deltaKm,
            horizonHours: (end.timeMs - start.timeMs) / HOUR_MS,
            startTime: start.time,
            endTime: end.time,
            startDistanceKm: startDistance,
            endDistanceKm: endDistance
        };
    }

    function buildConsensusTrack(sourceTracks, referencePoint, options) {
        const eligible = AGENCIES.map(agency => ({ agency, track: sourceTracks[agency] || [] }))
            .filter(item => item.track.length >= 2);
        if (eligible.length < options.consensusMinAgencies) return [];

        const startMs = Math.max(...eligible.map(item => item.track[0].timeMs));
        const endMs = Math.min(...eligible.map(item => item.track[item.track.length - 1].timeMs));
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

        const stepMs = options.consensusStepHours * HOUR_MS;
        const times = [];
        if (stepMs > 0) {
            for (let timeMs = startMs; timeMs <= endMs; timeMs += stepMs) times.push(timeMs);
        }
        if (!times.length || times[times.length - 1] !== endMs) times.push(endMs);

        return times.map(timeMs => {
            const entries = eligible.map(item => {
                const point = interpolateTrackAtTime(item.track, timeMs);
                return point ? { agency: item.agency, point } : null;
            }).filter(Boolean);
            if (entries.length < options.consensusMinAgencies) return null;
            const lat = entries.reduce((sum, entry) => sum + entry.point.lat, 0) / entries.length;
            const lonSin = entries.reduce((sum, entry) => sum + Math.sin(entry.point.lon * Math.PI / 180), 0);
            const lonCos = entries.reduce((sum, entry) => sum + Math.cos(entry.point.lon * Math.PI / 180), 0);
            const lon = normalizeLongitude(Math.atan2(lonSin, lonCos) * 180 / Math.PI);
            return {
                lat,
                lon,
                timeMs,
                time: toIso(timeMs),
                kind: 'app-consensus',
                agencies: entries.map(entry => entry.agency),
                agencyCount: entries.length,
                distanceToHongKongKm: haversineKm(referencePoint.lat, referencePoint.lon, lat, lon)
            };
        }).filter(Boolean);
    }

    function range(values) {
        const clean = values.filter(Number.isFinite);
        if (!clean.length) return null;
        return { min: Math.min(...clean), max: Math.max(...clean) };
    }

    function timeWindow(values) {
        const clean = values.map(parseTimeMs).filter(Number.isFinite);
        if (!clean.length) return null;
        return { start: toIso(Math.min(...clean)), end: toIso(Math.max(...clean)), spanHours: (Math.max(...clean) - Math.min(...clean)) / HOUR_MS };
    }

    function classifyUncertainty(snapshot, closestEntries) {
        if (closestEntries.length < 2) {
            return { level: 'insufficient', method: 'heuristic-v1', reasons: ['fewer-than-two-agencies'] };
        }
        const distanceRange = range(closestEntries.map(entry => entry.distanceKm));
        const closestWindow = timeWindow(closestEntries.map(entry => entry.time));
        const comparisonSpread = asFiniteNumber(snapshot?.comparison?.spread?.distanceKm);
        const distanceSpan = distanceRange ? distanceRange.max - distanceRange.min : Infinity;
        const timeSpan = closestWindow?.spanHours ?? Infinity;
        const reasons = [];

        if (Number.isFinite(comparisonSpread)) reasons.push(`comparison-spread:${comparisonSpread.toFixed(1)}km`);
        reasons.push(`closest-distance-span:${distanceSpan.toFixed(1)}km`);
        reasons.push(`closest-time-span:${timeSpan.toFixed(1)}h`);

        if (closestEntries.length >= 3
            && Number.isFinite(comparisonSpread) && comparisonSpread <= 100
            && distanceSpan <= 100 && timeSpan <= 6) {
            return { level: 'low', method: 'heuristic-v1', reasons };
        }
        if (Number.isFinite(comparisonSpread) && comparisonSpread <= 200
            && distanceSpan <= 200 && timeSpan <= 12) {
            return { level: 'moderate', method: 'heuristic-v1', reasons };
        }
        return { level: 'high', method: 'heuristic-v1', reasons };
    }

    function aggregateTrend(trends) {
        const counts = { approaching: 0, departing: 0, steady: 0, unavailable: 0 };
        Object.values(trends).forEach(trend => {
            if (counts[trend.state] == null) counts.unavailable += 1;
            else counts[trend.state] += 1;
        });
        const active = ['approaching', 'departing', 'steady'];
        const max = Math.max(...active.map(key => counts[key]));
        if (max === 0) return { state: 'unavailable', counts };
        const leaders = active.filter(key => counts[key] === max);
        return { state: leaders.length === 1 ? leaders[0] : 'mixed', counts };
    }

    function buildDistanceBands(sourceTracks, referencePoint, thresholds) {
        const result = {};
        thresholds.forEach(thresholdKm => {
            const agencies = [];
            AGENCIES.forEach(agency => {
                const track = sourceTracks[agency] || [];
                if (!track.length) return;
                const intervals = calculateBandIntervals(track, thresholdKm, referencePoint);
                agencies.push({ agency, intervals });
            });
            const firstEntries = agencies.flatMap(item => item.intervals.length ? [{ agency: item.agency, time: item.intervals[0].enterTime }] : []);
            const lastExits = agencies.flatMap(item => item.intervals.length ? [{ agency: item.agency, time: item.intervals[item.intervals.length - 1].exitTime }] : []);
            result[String(thresholdKm)] = {
                thresholdKm,
                agencies,
                agenciesEntering: firstEntries.map(entry => entry.agency),
                alreadyInsideAgencies: agencies.filter(item => item.intervals[0]?.startsInside).map(item => item.agency),
                entryWindow: timeWindow(firstEntries.map(entry => entry.time)),
                exitWindow: timeWindow(lastExits.map(entry => entry.time)),
                method: 'linear-track-circle-crossing-v1'
            };
        });
        return result;
    }

    function buildHongKongImpact(snapshot, options) {
        const opts = {
            distanceBandsKm: DEFAULT_DISTANCE_BANDS_KM,
            trendHorizonHours: 6,
            trendThresholdKm: 10,
            consensusStepHours: 3,
            consensusMinAgencies: 2,
            ...(options || {})
        };
        const thresholds = (Array.isArray(opts.distanceBandsKm) ? opts.distanceBandsKm : DEFAULT_DISTANCE_BANDS_KM)
            .map(asFiniteNumber).filter(value => value != null && value > 0)
            .filter((value, index, array) => array.indexOf(value) === index)
            .sort((a, b) => b - a);
        const referencePoint = {
            lat: asFiniteNumber(snapshot?.referencePoint?.lat),
            lon: asFiniteNumber(snapshot?.referencePoint?.lon),
            name: snapshot?.referencePoint?.name || 'Hong Kong'
        };
        if (referencePoint.lat == null || referencePoint.lon == null) {
            throw new Error('StormAnalysisSnapshot referencePoint is required');
        }

        const sourceTracks = {};
        const closestEntries = [];
        const trends = {};
        AGENCIES.forEach(agency => {
            const track = buildSourceTrack(snapshot?.sources?.[agency]);
            sourceTracks[agency] = track;
            if (!track.length) return;
            const closest = calculateContinuousNearest(track, referencePoint);
            if (closest) closestEntries.push({ agency, ...closest });
            trends[agency] = classifyAgencyTrend(track, referencePoint, opts);
        });

        const consensusTrack = buildConsensusTrack(sourceTracks, referencePoint, opts);
        const consensusClosest = calculateContinuousNearest(consensusTrack, referencePoint);
        const distanceRange = range(closestEntries.map(entry => entry.distanceKm));
        const closestWindow = timeWindow(closestEntries.map(entry => entry.time));
        const aggregate = aggregateTrend(trends);
        const distanceBands = buildDistanceBands(sourceTracks, referencePoint, thresholds);
        const uncertainty = classifyUncertainty(snapshot, closestEntries);

        let proximityBandKm = null;
        const representativeDistance = consensusClosest?.distanceKm ?? distanceRange?.min ?? null;
        if (Number.isFinite(representativeDistance)) {
            const ascending = thresholds.slice().sort((a, b) => a - b);
            proximityBandKm = ascending.find(threshold => representativeDistance <= threshold) ?? null;
        }

        return {
            schemaVersion: IMPACT_VERSION,
            sourceSnapshotVersion: snapshot?.schemaVersion ?? null,
            generatedAt: snapshot?.generatedAt ?? null,
            storm: snapshot?.storm ?? null,
            referencePoint,
            agencyClosestApproaches: closestEntries,
            closestApproach: {
                distanceRangeKm: distanceRange,
                agencyTimeWindow: closestWindow,
                consensus: consensusClosest ? {
                    ...consensusClosest,
                    appComputed: true,
                    source: 'unweighted-consensus-track-v1'
                } : null
            },
            trend: {
                aggregate: aggregate.state,
                counts: aggregate.counts,
                agencies: trends,
                horizonHours: opts.trendHorizonHours,
                thresholdKm: opts.trendThresholdKm
            },
            distanceBands,
            proximity: {
                representativeDistanceKm: representativeDistance,
                nearestConfiguredBandKm: proximityBandKm
            },
            uncertainty,
            consensusTrack: {
                method: 'unweighted-mean-fixed-step-v1',
                stepHours: opts.consensusStepHours,
                minimumAgencies: opts.consensusMinAgencies,
                points: consensusTrack
            },
            semantics: {
                deterministic: true,
                officialAgencyDataRemainSeparate: true,
                consensusIsAppComputed: true,
                crossingTimesAreInterpolated: true,
                interpolationMethod: 'linear-position-in-time-v1',
                hkoSignalPredictionIncluded: false,
                warningGuidanceIncluded: false,
                aiGenerated: false
            }
        };
    }

    return Object.freeze({
        IMPACT_VERSION,
        AGENCIES,
        DEFAULT_DISTANCE_BANDS_KM,
        haversineKm,
        buildSourceTrack,
        interpolateTrackAtTime,
        calculateContinuousNearest,
        calculateBandIntervals,
        buildHongKongImpact
    });
});
