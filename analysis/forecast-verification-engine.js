(function attachStormForecastVerificationEngine(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StormForecastVerificationEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormForecastVerificationEngine() {
    'use strict';

    const VERIFICATION_VERSION = 'forecast-verification/v1';
    const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
    const EARTH_RADIUS_KM = 6371;
    const HOUR_MS = 60 * 60 * 1000;

    function finiteNumber(value) {
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

    function parseMetricNumber(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        const match = String(value).replace(/,/g, '').match(/[-+]?\d+(?:\.\d+)?/);
        return match ? finiteNumber(match[0]) : null;
    }

    function parseWindMs(value) {
        const number = parseMetricNumber(value);
        if (number == null) return null;
        if (typeof value === 'number') return number;
        const unit = String(value).toLowerCase();
        if (/km\s*\/\s*h|kmh|公里.*小時/.test(unit)) return number / 3.6;
        if (/\bkt\b|knot|節/.test(unit)) return number * 0.514444;
        return number;
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const values = [lat1, lon1, lat2, lon2].map(finiteNumber);
        if (values.some(value => value == null)) return null;
        const [aLat, aLon, bLat, bLon] = values;
        const toRad = degree => degree * Math.PI / 180;
        const dLat = toRad(bLat - aLat);
        const dLon = toRad(bLon - aLon);
        const h = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
        return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

    function normalizePoint(point, defaultType) {
        if (!point || typeof point !== 'object') return null;
        const lat = finiteNumber(point.lat ?? point.latitude);
        const lon = finiteNumber(point.lon ?? point.longitude);
        const timeMs = parseTimeMs(point.timeMs ?? point.time ?? point.validTime);
        if (lat == null || lon == null || !Number.isFinite(timeMs)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return {
            type: point.kind ?? point.pointType ?? defaultType ?? null,
            lat,
            lon,
            timeMs,
            time: toIso(timeMs),
            maximumWindMs: parseWindMs(point.maximumWind ?? point.windSpeed),
            pressureHpa: parseMetricNumber(point.pressure),
            baseTimeMs: parseTimeMs(point.baseTime),
            forecastHour: finiteNumber(point.forecastHour)
        };
    }

    function sortedPoints(points, defaultType) {
        return (Array.isArray(points) ? points : [])
            .map(point => normalizePoint(point, defaultType))
            .filter(Boolean)
            .sort((a, b) => a.timeMs - b.timeMs);
    }

    function interpolatePointAtTime(points, targetMs) {
        if (!Number.isFinite(targetMs) || !points.length) return null;
        const exact = points.find(point => point.timeMs === targetMs);
        if (exact) return { ...exact, interpolated: false };
        if (targetMs < points[0].timeMs || targetMs > points[points.length - 1].timeMs) return null;
        for (let index = 1; index < points.length; index += 1) {
            const before = points[index - 1];
            const after = points[index];
            if (targetMs > after.timeMs) continue;
            const span = after.timeMs - before.timeMs;
            if (span <= 0) return { ...before, interpolated: false };
            const ratio = (targetMs - before.timeMs) / span;
            const interpolateScalar = key => {
                const a = finiteNumber(before[key]);
                const b = finiteNumber(after[key]);
                return a == null || b == null ? null : a + (b - a) * ratio;
            };
            return {
                type: 'interpolated-actual',
                lat: before.lat + (after.lat - before.lat) * ratio,
                lon: interpolateLongitude(before.lon, after.lon, ratio),
                timeMs: targetMs,
                time: toIso(targetMs),
                maximumWindMs: interpolateScalar('maximumWindMs'),
                pressureHpa: interpolateScalar('pressureHpa'),
                baseTimeMs: null,
                forecastHour: null,
                interpolated: true
            };
        }
        return null;
    }

    function metricSummary(values) {
        const numeric = values.filter(Number.isFinite);
        if (!numeric.length) return { count: 0, mean: null, mae: null, rmse: null, maxAbs: null };
        const abs = numeric.map(Math.abs);
        return {
            count: numeric.length,
            mean: numeric.reduce((sum, value) => sum + value, 0) / numeric.length,
            mae: abs.reduce((sum, value) => sum + value, 0) / numeric.length,
            rmse: Math.sqrt(numeric.reduce((sum, value) => sum + value * value, 0) / numeric.length),
            maxAbs: Math.max(...abs)
        };
    }

    function buildTruth(truthInput) {
        if (!truthInput || typeof truthInput !== 'object') throw new Error('Explicit truth input is required');
        const source = String(truthInput.source || '').trim();
        if (!source) throw new Error('truth.source is required; verification must not infer a truth source');
        const track = sortedPoints(truthInput.track || truthInput.points || [], 'actual');
        if (!track.length) throw new Error('truth.track requires at least one valid observed point');
        return {
            source,
            datasetId: truthInput.datasetId ?? null,
            advisoryId: truthInput.advisoryId ?? null,
            track,
            officialHkoWarningOutcome: truthInput.officialHkoWarningOutcome ?? null
        };
    }

    function forecastLeadHours(point, source) {
        if (Number.isFinite(point.forecastHour)) return point.forecastHour;
        const baseMs = Number.isFinite(point.baseTimeMs) ? point.baseTimeMs : parseTimeMs(source?.baseTime);
        return Number.isFinite(baseMs) ? (point.timeMs - baseMs) / HOUR_MS : null;
    }

    function verifyAgency(source, agency, truth) {
        if (!source || source.state !== 'ok') {
            return { agency, state: source?.state ?? 'missing', points: [], summary: null };
        }
        const forecasts = sortedPoints(source.forecast, 'forecast');
        const points = [];
        for (const forecast of forecasts) {
            const actual = interpolatePointAtTime(truth.track, forecast.timeMs);
            if (!actual) continue;
            const trackErrorKm = haversineKm(forecast.lat, forecast.lon, actual.lat, actual.lon);
            const intensityErrorMs = Number.isFinite(forecast.maximumWindMs) && Number.isFinite(actual.maximumWindMs)
                ? forecast.maximumWindMs - actual.maximumWindMs : null;
            const pressureErrorHpa = Number.isFinite(forecast.pressureHpa) && Number.isFinite(actual.pressureHpa)
                ? forecast.pressureHpa - actual.pressureHpa : null;
            points.push({
                validTime: forecast.time,
                leadHours: forecastLeadHours(forecast, source),
                forecast: {
                    lat: forecast.lat,
                    lon: forecast.lon,
                    maximumWindMs: forecast.maximumWindMs,
                    pressureHpa: forecast.pressureHpa
                },
                actual: {
                    lat: actual.lat,
                    lon: actual.lon,
                    maximumWindMs: actual.maximumWindMs,
                    pressureHpa: actual.pressureHpa,
                    interpolated: Boolean(actual.interpolated)
                },
                errors: {
                    trackKm: trackErrorKm,
                    intensityMs: intensityErrorMs,
                    pressureHpa: pressureErrorHpa
                }
            });
        }
        const track = metricSummary(points.map(item => item.errors.trackKm));
        const intensity = metricSummary(points.map(item => item.errors.intensityMs));
        const pressure = metricSummary(points.map(item => item.errors.pressureHpa));
        return {
            agency,
            state: points.length ? 'verified' : 'no-overlap',
            points,
            summary: {
                verifiedPointCount: points.length,
                trackErrorKm: track,
                intensityErrorMs: intensity,
                pressureErrorHpa: pressure
            }
        };
    }

    function minimizeSegmentDistance(a, b, referencePoint) {
        let left = 0;
        let right = 1;
        const pointAt = ratio => ({
            lat: a.lat + (b.lat - a.lat) * ratio,
            lon: interpolateLongitude(a.lon, b.lon, ratio),
            timeMs: a.timeMs + (b.timeMs - a.timeMs) * ratio
        });
        for (let i = 0; i < 42; i += 1) {
            const third = (right - left) / 3;
            const m1 = left + third;
            const m2 = right - third;
            const p1 = pointAt(m1);
            const p2 = pointAt(m2);
            const d1 = haversineKm(referencePoint.lat, referencePoint.lon, p1.lat, p1.lon);
            const d2 = haversineKm(referencePoint.lat, referencePoint.lon, p2.lat, p2.lon);
            if (d1 <= d2) right = m2;
            else left = m1;
        }
        const ratio = (left + right) / 2;
        const point = pointAt(ratio);
        return {
            distanceKm: haversineKm(referencePoint.lat, referencePoint.lon, point.lat, point.lon),
            timeMs: point.timeMs,
            time: toIso(point.timeMs),
            lat: point.lat,
            lon: point.lon,
            interpolated: ratio > 1e-9 && ratio < 1 - 1e-9
        };
    }

    function continuousClosest(track, referencePoint) {
        if (!track.length) return null;
        let best = null;
        const consider = candidate => {
            if (!candidate || !Number.isFinite(candidate.distanceKm)) return;
            if (!best || candidate.distanceKm < best.distanceKm) best = candidate;
        };
        for (const point of track) {
            consider({
                distanceKm: haversineKm(referencePoint.lat, referencePoint.lon, point.lat, point.lon),
                timeMs: point.timeMs,
                time: point.time,
                lat: point.lat,
                lon: point.lon,
                interpolated: false
            });
        }
        for (let i = 1; i < track.length; i += 1) consider(minimizeSegmentDistance(track[i - 1], track[i], referencePoint));
        return best;
    }

    function verifyClosestApproach(predicted, actualClosest) {
        if (!predicted || !actualClosest) return null;
        const predictedTimeMs = parseTimeMs(predicted.time);
        const actualTimeMs = parseTimeMs(actualClosest.time);
        const distanceErrorKm = Number.isFinite(predicted.distanceKm) ? predicted.distanceKm - actualClosest.distanceKm : null;
        const timeErrorHours = Number.isFinite(predictedTimeMs) && Number.isFinite(actualTimeMs)
            ? (predictedTimeMs - actualTimeMs) / HOUR_MS : null;
        return {
            predicted: {
                time: predicted.time ?? null,
                distanceKm: finiteNumber(predicted.distanceKm),
                lat: finiteNumber(predicted.lat),
                lon: finiteNumber(predicted.lon)
            },
            actual: actualClosest,
            errors: {
                distanceKm: distanceErrorKm,
                absoluteDistanceKm: Number.isFinite(distanceErrorKm) ? Math.abs(distanceErrorKm) : null,
                timeHours: timeErrorHours,
                absoluteTimeHours: Number.isFinite(timeErrorHours) ? Math.abs(timeErrorHours) : null
            }
        };
    }

    function buildConsensusVerification(snapshot, truth) {
        const comparison = snapshot?.comparison;
        const consensus = comparison?.consensus;
        const targetMs = parseTimeMs(comparison?.targetValidTime);
        if (!consensus || !Number.isFinite(targetMs)) return null;
        const actual = interpolatePointAtTime(truth.track, targetMs);
        if (!actual) return null;
        return {
            validTime: toIso(targetMs),
            agencies: Array.isArray(consensus.agencies) ? consensus.agencies.slice() : [],
            agencyCount: finiteNumber(consensus.agencyCount),
            predicted: { lat: finiteNumber(consensus.lat), lon: finiteNumber(consensus.lon) },
            actual: { lat: actual.lat, lon: actual.lon, interpolated: Boolean(actual.interpolated) },
            trackErrorKm: haversineKm(consensus.lat, consensus.lon, actual.lat, actual.lon),
            appComputed: true
        };
    }

    function buildForecastVerification(input) {
        const snapshot = input?.snapshot;
        const impact = input?.impact ?? null;
        const signalInputs = input?.signalInputs ?? null;
        if (!snapshot || typeof snapshot !== 'object') throw new Error('prediction snapshot is required');
        const truth = buildTruth(input?.truth);
        const verifiedAtMs = parseTimeMs(input?.verifiedAt) ?? Date.now();
        const referencePoint = {
            lat: finiteNumber(snapshot?.referencePoint?.lat),
            lon: finiteNumber(snapshot?.referencePoint?.lon),
            name: snapshot?.referencePoint?.name || 'Hong Kong'
        };
        if (referencePoint.lat == null || referencePoint.lon == null) throw new Error('snapshot.referencePoint is required');

        const agencies = {};
        AGENCIES.forEach(agency => { agencies[agency] = verifyAgency(snapshot?.sources?.[agency], agency, truth); });
        const actualClosest = continuousClosest(truth.track, referencePoint);
        const consensusClosestVerification = verifyClosestApproach(impact?.closestApproach?.consensus, actualClosest);
        const agencyClosestVerification = {};
        (Array.isArray(impact?.agencyClosestApproaches) ? impact.agencyClosestApproaches : []).forEach(item => {
            if (!item?.agency) return;
            agencyClosestVerification[item.agency] = verifyClosestApproach(item, actualClosest);
        });
        const consensusVerification = buildConsensusVerification(snapshot, truth);

        const verifiedAgencySummaries = AGENCIES.map(agency => agencies[agency]?.summary).filter(Boolean);
        const allTrackErrors = verifiedAgencySummaries.flatMap(summary =>
            Number.isFinite(summary?.trackErrorKm?.mae) ? [summary.trackErrorKm.mae] : []);

        const officialOutcome = truth.officialHkoWarningOutcome == null ? null : {
            ...truth.officialHkoWarningOutcome,
            provided: true,
            inferred: false,
            source: truth.officialHkoWarningOutcome.source || truth.source
        };

        return {
            schemaVersion: VERIFICATION_VERSION,
            verifiedAt: toIso(verifiedAtMs),
            prediction: {
                snapshotVersion: snapshot?.schemaVersion ?? null,
                generatedAt: snapshot?.generatedAt ?? null,
                impactVersion: impact?.schemaVersion ?? null,
                signalInputVersion: signalInputs?.schemaVersion ?? null,
                storm: snapshot?.storm ?? null
            },
            truth: {
                source: truth.source,
                datasetId: truth.datasetId,
                advisoryId: truth.advisoryId,
                pointCount: truth.track.length,
                firstTime: truth.track[0]?.time ?? null,
                lastTime: truth.track[truth.track.length - 1]?.time ?? null,
                actualClosestApproach: actualClosest,
                officialHkoWarningOutcome: officialOutcome
            },
            agencies,
            consensusAtCommonValidTime: consensusVerification,
            hongKongImpact: {
                consensusClosestApproach: consensusClosestVerification,
                agencyClosestApproaches: agencyClosestVerification
            },
            calibrationRecord: {
                stormKey: snapshot?.storm?.key ?? null,
                predictionGeneratedAt: snapshot?.generatedAt ?? null,
                truthSource: truth.source,
                usableAgencyCount: snapshot?.coverage?.usableAgencyCount ?? null,
                comparisonSpreadKm: finiteNumber(snapshot?.comparison?.spread?.distanceKm),
                consensusTrackErrorKm: finiteNumber(consensusVerification?.trackErrorKm),
                consensusClosestDistanceErrorKm: finiteNumber(consensusClosestVerification?.errors?.distanceKm),
                consensusClosestTimeErrorHours: finiteNumber(consensusClosestVerification?.errors?.timeHours),
                meanAgencyTrackMaeKm: allTrackErrors.length
                    ? allTrackErrors.reduce((sum, value) => sum + value, 0) / allTrackErrors.length : null,
                hkoOfficialOutcomeProvided: Boolean(officialOutcome)
            },
            semantics: {
                deterministic: true,
                truthSourceExplicit: true,
                truthSourceInferred: false,
                actualTrackInterpolationMethod: 'linear-position-in-time-v1',
                actualIntensityInterpolationMethod: 'linear-between-observations-v1',
                forecastDataMutated: false,
                adaptiveWeightsUpdated: false,
                modelTrainingPerformed: false,
                hkoWarningOutcomeInferred: false,
                aiGenerated: false
            }
        };
    }

    return Object.freeze({
        VERIFICATION_VERSION,
        AGENCIES,
        parseWindMs,
        haversineKm,
        interpolatePointAtTime,
        continuousClosest,
        buildForecastVerification
    });
});
