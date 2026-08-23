(function attachStormAnalysisCore(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StormAnalysisCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormAnalysisCore() {
    'use strict';

    const SNAPSHOT_VERSION = 'storm-analysis-snapshot/v1';
    const CONSENSUS_TRACK_VERSION = 'storm-consensus-track/v0';
    const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
    const HONG_KONG = Object.freeze({ lat: 22.3023, lon: 114.1746 });
    const EARTH_RADIUS_KM = 6371;
    const CONSENSUS_TRACK_DEFAULTS = Object.freeze({
        startLeadHours: 0,
        endLeadHours: 120,
        stepHours: 6,
        minAgencyCount: 2
    });

    function asFiniteNumber(value) {
        if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function parseTimeMs(value) {
        if (value == null || value === '') return null;
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
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
        return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function normalizePoint(point, fallbackKind) {
        if (!point || typeof point !== 'object') return null;
        const lat = asFiniteNumber(point.lat);
        const lon = asFiniteNumber(point.lon);
        if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        const timeMs = parseTimeMs(point.time);
        const baseTimeMs = parseTimeMs(point.baseTime);
        const forecastHour = asFiniteNumber(point.forecastHour);
        return {
            kind: point.kind || fallbackKind || null,
            lat,
            lon,
            time: timeMs == null ? null : toIso(timeMs),
            timeMs,
            baseTime: baseTimeMs == null ? null : toIso(baseTimeMs),
            baseTimeMs,
            forecastHour,
            intensity: point.intensity ?? null,
            maximumWind: point.maximumWind ?? null,
            pressure: point.pressure ?? null,
            interpolated: Boolean(point.interpolated)
        };
    }

    function sortTimedPoints(points) {
        return points
            .filter(point => point && Number.isFinite(point.timeMs))
            .slice()
            .sort((a, b) => a.timeMs - b.timeMs);
    }

    function latestTimedPoint(points) {
        const timed = sortTimedPoints(points);
        return timed.length ? timed[timed.length - 1] : null;
    }

    function getSourceBaseTimeMs(source, positions, forecast) {
        const forecastBase = forecast.map(point => point.baseTimeMs).find(Number.isFinite);
        if (Number.isFinite(forecastBase)) return forecastBase;
        const bulletin = parseTimeMs(source?.bulletinTime);
        if (Number.isFinite(bulletin)) return bulletin;
        const latest = latestTimedPoint(positions);
        return latest?.timeMs ?? null;
    }

    function interpolateTimedPoint(points, targetMs) {
        if (!Number.isFinite(targetMs)) return null;
        const timed = sortTimedPoints(points);
        if (!timed.length) return null;

        const exact = timed.find(point => point.timeMs === targetMs);
        if (exact) return { ...exact, interpolated: false };
        if (targetMs < timed[0].timeMs || targetMs > timed[timed.length - 1].timeMs) return null;

        for (let index = 1; index < timed.length; index += 1) {
            const before = timed[index - 1];
            const after = timed[index];
            if (targetMs <= after.timeMs) {
                const span = after.timeMs - before.timeMs;
                if (span <= 0) return { ...before, interpolated: false };
                const ratio = (targetMs - before.timeMs) / span;
                const interpolateNumber = (left, right) => {
                    const a = asFiniteNumber(left);
                    const b = asFiniteNumber(right);
                    return a == null || b == null ? null : a + (b - a) * ratio;
                };
                return {
                    kind: 'forecast',
                    lat: before.lat + (after.lat - before.lat) * ratio,
                    lon: before.lon + (after.lon - before.lon) * ratio,
                    time: toIso(targetMs),
                    timeMs: targetMs,
                    baseTime: before.baseTime || after.baseTime || null,
                    baseTimeMs: before.baseTimeMs ?? after.baseTimeMs ?? null,
                    forecastHour: null,
                    intensity: null,
                    maximumWind: interpolateNumber(before.maximumWind, after.maximumWind),
                    pressure: interpolateNumber(before.pressure, after.pressure),
                    interpolated: true
                };
            }
        }
        return null;
    }

    function calculateNearestApproach(positions, forecast, referencePoint) {
        const points = [];
        const latestPosition = latestTimedPoint(positions);
        if (latestPosition) points.push(latestPosition);
        points.push(...sortTimedPoints(forecast));

        let best = null;
        for (const point of points) {
            const distanceKm = haversineKm(referencePoint.lat, referencePoint.lon, point.lat, point.lon);
            if (!Number.isFinite(distanceKm)) continue;
            if (!best || distanceKm < best.distanceKm) {
                best = {
                    distanceKm,
                    time: point.time,
                    lat: point.lat,
                    lon: point.lon,
                    kind: point.kind || null
                };
            }
        }
        return best;
    }

    function normalizeSource(source, agency, referencePoint) {
        if (!source || typeof source !== 'object') {
            return { agency, state: 'missing', error: null };
        }

        try {
            const positions = (Array.isArray(source.positions) ? source.positions : [])
                .map(point => normalizePoint(point, 'analysis'))
                .filter(Boolean);
            const forecast = (Array.isArray(source.forecast) ? source.forecast : [])
                .map(point => normalizePoint(point, 'forecast'))
                .filter(Boolean);
            const baseTimeMs = getSourceBaseTimeMs(source, positions, forecast);
            const current = latestTimedPoint(positions) || sortTimedPoints(forecast)[0] || null;

            return {
                agency,
                state: positions.length || forecast.length ? 'ok' : 'empty',
                error: null,
                sourceId: source.sourceId ?? null,
                bulletinTime: toIso(parseTimeMs(source.bulletinTime)),
                baseTime: toIso(baseTimeMs),
                current,
                positions,
                forecast,
                nearestApproach: calculateNearestApproach(positions, forecast, referencePoint)
            };
        } catch (error) {
            return {
                agency,
                state: 'error',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    function getComparisonReference(normalizedSources) {
        for (const agency of ['HKO', 'CWA', 'CMA', 'JMA']) {
            const source = normalizedSources[agency];
            if (source?.state !== 'ok') continue;
            const baseTimeMs = parseTimeMs(source.baseTime);
            if (Number.isFinite(baseTimeMs)) return { agency, baseTimeMs };
        }
        return null;
    }

    function getConsensusTrackReference(normalizedSources) {
        const analysisEntries = AGENCIES
            .map(agency => ({ agency, point: latestTimedPoint(normalizedSources[agency]?.positions || []) }))
            .filter(entry => Number.isFinite(entry.point?.timeMs));
        if (analysisEntries.length) {
            analysisEntries.sort((left, right) => right.point.timeMs - left.point.timeMs);
            return {
                agency: analysisEntries[0].agency,
                baseTimeMs: analysisEntries[0].point.timeMs,
                method: 'latest-analysis-valid-time'
            };
        }
        const fallback = getComparisonReference(normalizedSources);
        return fallback ? { ...fallback, method: 'source-base-time-fallback' } : null;
    }

    function maxPairwiseDistance(entries) {
        let best = null;
        for (let i = 0; i < entries.length; i += 1) {
            for (let j = i + 1; j < entries.length; j += 1) {
                const distanceKm = haversineKm(entries[i].lat, entries[i].lon, entries[j].lat, entries[j].lon);
                if (!Number.isFinite(distanceKm)) continue;
                if (!best || distanceKm > best.distanceKm) {
                    best = { distanceKm, agencies: [entries[i].agency, entries[j].agency] };
                }
            }
        }
        return best;
    }

    function buildConsensus(entries, referencePoint) {
        if (!entries.length) return null;
        const lat = entries.reduce((sum, entry) => sum + entry.lat, 0) / entries.length;
        const lon = entries.reduce((sum, entry) => sum + entry.lon, 0) / entries.length;
        return {
            method: 'unweighted-mean-v1',
            appComputed: true,
            agencies: entries.map(entry => entry.agency),
            agencyCount: entries.length,
            lat,
            lon,
            distanceToHongKongKm: haversineKm(referencePoint.lat, referencePoint.lon, lat, lon)
        };
    }

    function trackPointAtValidTime(source, targetMs) {
        if (source?.state !== 'ok' || !Number.isFinite(targetMs)) return null;

        const analysis = latestTimedPoint(source.positions || []);
        const forecast = sortTimedPoints(source.forecast || []);
        const track = [];
        if (analysis) track.push({ ...analysis, trackOrigin: 'analysis' });
        track.push(...forecast
            .filter(point => !analysis || point.timeMs >= analysis.timeMs)
            .map(point => ({ ...point, trackOrigin: 'forecast' })));
        const timed = sortTimedPoints(track);
        if (!timed.length) return null;

        const exact = timed.find(point => point.timeMs === targetMs);
        if (exact) {
            return {
                ...exact,
                interpolated: false,
                provenance: exact.trackOrigin === 'analysis' ? 'exact-analysis' : 'exact-forecast',
                interpolation: null
            };
        }
        if (targetMs < timed[0].timeMs || targetMs > timed[timed.length - 1].timeMs) return null;

        for (let index = 1; index < timed.length; index += 1) {
            const before = timed[index - 1];
            const after = timed[index];
            if (targetMs > after.timeMs) continue;
            const point = interpolateTimedPoint([before, after], targetMs);
            if (!point) return null;
            const beforeKind = before.trackOrigin === 'analysis' ? 'analysis' : 'forecast';
            const afterKind = after.trackOrigin === 'analysis' ? 'analysis' : 'forecast';
            const provenance = beforeKind === 'analysis' && afterKind === 'forecast'
                ? 'analysis-to-forecast-interpolation'
                : 'forecast-to-forecast-interpolation';
            return {
                ...point,
                provenance,
                interpolation: {
                    beforeTime: before.time,
                    afterTime: after.time,
                    beforeKind,
                    afterKind
                }
            };
        }
        return null;
    }

    function normalizeConsensusTrackOptions(options) {
        const opts = options || {};
        const start = asFiniteNumber(opts.consensusTrackStartLeadHours);
        const end = asFiniteNumber(opts.consensusTrackEndLeadHours);
        const step = asFiniteNumber(opts.consensusTrackStepHours);
        const minAgencyCount = asFiniteNumber(opts.consensusTrackMinAgencyCount);

        const startLeadHours = start != null && start >= 0
            ? start
            : CONSENSUS_TRACK_DEFAULTS.startLeadHours;
        const endLeadHours = end != null && end >= startLeadHours
            ? end
            : CONSENSUS_TRACK_DEFAULTS.endLeadHours;
        const stepHours = step != null && step > 0
            ? step
            : CONSENSUS_TRACK_DEFAULTS.stepHours;
        const normalizedMinAgencyCount = minAgencyCount == null
            ? CONSENSUS_TRACK_DEFAULTS.minAgencyCount
            : Math.max(2, Math.min(AGENCIES.length, Math.trunc(minAgencyCount)));

        return {
            startLeadHours,
            endLeadHours,
            stepHours,
            minAgencyCount: normalizedMinAgencyCount
        };
    }

    function buildConsensusTrack(sources, trackReference, referencePoint, options) {
        const config = normalizeConsensusTrackOptions(options);
        const referenceBaseTimeMs = trackReference?.baseTimeMs ?? null;
        const points = [];

        if (!Number.isFinite(referenceBaseTimeMs)) {
            return {
                state: 'unavailable',
                method: 'valid-time-aligned-unweighted-mean-v1',
                referenceAgency: null,
                referenceBaseTime: null,
                referenceMethod: null,
                ...config,
                points
            };
        }

        const sampleCount = Math.floor((config.endLeadHours - config.startLeadHours) / config.stepHours) + 1;
        for (let index = 0; index < sampleCount; index += 1) {
            const leadHours = config.startLeadHours + index * config.stepHours;
            const targetValidMs = referenceBaseTimeMs + leadHours * 60 * 60 * 1000;
            const entries = [];

            AGENCIES.forEach(agency => {
                const source = sources[agency];
                const point = trackPointAtValidTime(source, targetValidMs);
                if (!point) return;
                entries.push({
                    agency,
                    lat: point.lat,
                    lon: point.lon,
                    time: point.time,
                    kind: point.kind || null,
                    interpolated: Boolean(point.interpolated),
                    provenance: point.provenance || null,
                    interpolation: point.interpolation || null,
                    sourceBaseTime: source.baseTime
                });
            });

            const hasConsensus = entries.length >= config.minAgencyCount;
            const consensus = hasConsensus ? buildConsensus(entries, referencePoint) : null;
            const spread = hasConsensus ? maxPairwiseDistance(entries) : null;

            points.push({
                leadHours,
                validTime: toIso(targetValidMs),
                agencyCount: entries.length,
                agencies: entries.map(entry => entry.agency),
                entries,
                consensus,
                spread: spread ? {
                    distanceKm: spread.distanceKm,
                    agencies: spread.agencies
                } : null
            });
        }

        return {
            state: points.some(point => point.consensus) ? 'ok' : 'insufficient-coverage',
            method: 'valid-time-aligned-unweighted-mean-v1',
            referenceAgency: trackReference.agency,
            referenceBaseTime: toIso(referenceBaseTimeMs),
            referenceMethod: trackReference.method || null,
            ...config,
            points
        };
    }

    function buildConsensusTrackForGroup(group, options) {
        const opts = options || {};
        const referencePoint = {
            lat: asFiniteNumber(opts.referencePoint?.lat) ?? HONG_KONG.lat,
            lon: asFiniteNumber(opts.referencePoint?.lon) ?? HONG_KONG.lon
        };
        const generatedAtMs = parseTimeMs(opts.generatedAt) ?? Date.now();
        const rawSources = group?.sources && typeof group.sources === 'object' ? group.sources : {};
        const sources = {};

        AGENCIES.forEach(agency => {
            sources[agency] = normalizeSource(rawSources[agency], agency, referencePoint);
        });

        const trackReference = getConsensusTrackReference(sources);
        const track = buildConsensusTrack(sources, trackReference, referencePoint, opts);
        const usableAgencies = AGENCIES.filter(agency => sources[agency].state === 'ok');

        return {
            schemaVersion: CONSENSUS_TRACK_VERSION,
            generatedAt: toIso(generatedAtMs),
            storm: {
                key: group?.key ?? null,
                displayName: group?.displayName ?? null,
                nameTc: group?.nameTc ?? null,
                nameEn: group?.nameEn ?? null
            },
            referencePoint: {
                name: 'Hong Kong',
                lat: referencePoint.lat,
                lon: referencePoint.lon
            },
            coverage: {
                expectedAgencies: AGENCIES.slice(),
                usableAgencies,
                usableAgencyCount: usableAgencies.length
            },
            ...track,
            semantics: {
                officialAgencyDataRemainSeparate: true,
                consensusIsAppComputed: true,
                aiGenerated: false,
                probabilityCalibrated: false
            }
        };
    }

    function buildStormAnalysisSnapshot(group, options) {
        const opts = options || {};
        const referencePoint = {
            lat: asFiniteNumber(opts.referencePoint?.lat) ?? HONG_KONG.lat,
            lon: asFiniteNumber(opts.referencePoint?.lon) ?? HONG_KONG.lon
        };
        const compareLeadHours = asFiniteNumber(opts.compareLeadHours) ?? 24;
        const generatedAtMs = parseTimeMs(opts.generatedAt) ?? Date.now();
        const rawSources = group?.sources && typeof group.sources === 'object' ? group.sources : {};
        const sources = {};

        AGENCIES.forEach(agency => {
            sources[agency] = normalizeSource(rawSources[agency], agency, referencePoint);
        });

        const comparisonReference = getComparisonReference(sources);
        const targetValidMs = comparisonReference
            ? comparisonReference.baseTimeMs + compareLeadHours * 60 * 60 * 1000
            : null;
        const comparisonEntries = [];

        if (Number.isFinite(targetValidMs)) {
            AGENCIES.forEach(agency => {
                const source = sources[agency];
                if (source?.state !== 'ok') return;
                const point = interpolateTimedPoint(source.forecast, targetValidMs);
                if (!point) return;
                comparisonEntries.push({
                    agency,
                    lat: point.lat,
                    lon: point.lon,
                    time: point.time,
                    interpolated: point.interpolated,
                    sourceBaseTime: source.baseTime
                });
            });
        }

        const presentAgencies = AGENCIES.filter(agency => sources[agency].state !== 'missing');
        const usableAgencies = AGENCIES.filter(agency => sources[agency].state === 'ok');
        const consensus = buildConsensus(comparisonEntries, referencePoint);
        const spread = maxPairwiseDistance(comparisonEntries);

        return {
            schemaVersion: SNAPSHOT_VERSION,
            generatedAt: toIso(generatedAtMs),
            storm: {
                key: group?.key ?? null,
                displayName: group?.displayName ?? null,
                nameTc: group?.nameTc ?? null,
                nameEn: group?.nameEn ?? null
            },
            referencePoint: {
                name: 'Hong Kong',
                lat: referencePoint.lat,
                lon: referencePoint.lon
            },
            coverage: {
                expectedAgencies: AGENCIES.slice(),
                presentAgencies,
                usableAgencies,
                usableAgencyCount: usableAgencies.length
            },
            sources,
            comparison: {
                leadHours: compareLeadHours,
                referenceAgency: comparisonReference?.agency ?? null,
                referenceBaseTime: toIso(comparisonReference?.baseTimeMs),
                targetValidTime: toIso(targetValidMs),
                entries: comparisonEntries,
                consensus,
                spread: spread ? {
                    distanceKm: spread.distanceKm,
                    agencies: spread.agencies
                } : null
            },
            semantics: {
                officialAgencyDataRemainSeparate: true,
                consensusIsAppComputed: true,
                aiGenerated: false
            }
        };
    }

    return Object.freeze({
        SNAPSHOT_VERSION,
        CONSENSUS_TRACK_VERSION,
        AGENCIES,
        HONG_KONG,
        CONSENSUS_TRACK_DEFAULTS,
        haversineKm,
        interpolateTimedPoint,
        buildConsensusTrackForGroup,
        buildStormAnalysisSnapshot
    });
});
