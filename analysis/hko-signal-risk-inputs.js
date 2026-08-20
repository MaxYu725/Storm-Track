(function attachStormHkoSignalRiskInputs(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StormHkoSignalRiskInputs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStormHkoSignalRiskInputs() {
    'use strict';

    const INPUT_VERSION = 'hko-signal-risk-inputs/v1';
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

    function parsePressureHpa(value) {
        return parseMetricNumber(value);
    }

    function parseSpeedKmh(value) {
        const number = parseMetricNumber(value);
        if (number == null) return null;
        if (typeof value === 'number') return number;
        const unit = String(value).toLowerCase();
        if (/m\s*\/\s*s|米.*秒/.test(unit)) return number * 3.6;
        if (/\bkt\b|knot|節/.test(unit)) return number * 1.852;
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

    function initialBearingDegrees(lat1, lon1, lat2, lon2) {
        const values = [lat1, lon1, lat2, lon2].map(finiteNumber);
        if (values.some(value => value == null)) return null;
        const [aLat, aLon, bLat, bLon] = values;
        const toRad = degree => degree * Math.PI / 180;
        const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
        const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat))
            - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
        const bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    function compass8(bearing) {
        if (!Number.isFinite(bearing)) return null;
        const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        return labels[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
    }

    function quadrant4(bearing) {
        if (!Number.isFinite(bearing)) return null;
        const normalized = ((bearing % 360) + 360) % 360;
        if (normalized < 90) return 'ne';
        if (normalized < 180) return 'se';
        if (normalized < 270) return 'sw';
        return 'nw';
    }

    function median(values) {
        const numeric = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
        if (!numeric.length) return null;
        const middle = Math.floor(numeric.length / 2);
        return numeric.length % 2 ? numeric[middle] : (numeric[middle - 1] + numeric[middle]) / 2;
    }

    function numericRange(values) {
        const numeric = values.filter(Number.isFinite);
        if (!numeric.length) return null;
        const min = Math.min(...numeric);
        const max = Math.max(...numeric);
        return { min, max, span: max - min, median: median(numeric), count: numeric.length };
    }

    function timeSpreadHours(values) {
        const times = values.map(parseTimeMs).filter(Number.isFinite);
        if (!times.length) return null;
        return (Math.max(...times) - Math.min(...times)) / HOUR_MS;
    }

    function normalizeWindRadii(value) {
        if (!Array.isArray(value)) return [];
        return value.map(item => {
            if (!item || typeof item !== 'object') return null;
            const ne = parseMetricNumber(item.ne ?? item.NE ?? item.radius_ne_km);
            const se = parseMetricNumber(item.se ?? item.SE ?? item.radius_se_km);
            const sw = parseMetricNumber(item.sw ?? item.SW ?? item.radius_sw_km);
            const nw = parseMetricNumber(item.nw ?? item.NW ?? item.radius_nw_km);
            if (![ne, se, sw, nw].some(Number.isFinite)) return null;
            return {
                level: item.level ?? item.wind_level ?? item.threshold ?? null,
                ne: Number.isFinite(ne) ? ne : 0,
                se: Number.isFinite(se) ? se : 0,
                sw: Number.isFinite(sw) ? sw : 0,
                nw: Number.isFinite(nw) ? nw : 0
            };
        }).filter(Boolean);
    }

    function normalizeRawPoint(point) {
        if (!point || typeof point !== 'object') return null;
        const lat = finiteNumber(point.lat);
        const lon = finiteNumber(point.lon);
        const timeMs = parseTimeMs(point.timeMs ?? point.time);
        if (lat == null || lon == null || !Number.isFinite(timeMs)) return null;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return {
            kind: point.kind ?? null,
            lat,
            lon,
            timeMs,
            time: toIso(timeMs),
            maximumWindMs: parseWindMs(point.maximumWind),
            maximumGustMs: parseWindMs(point.maximumGust),
            pressureHpa: parsePressureHpa(point.pressure),
            intensity: point.intensity ?? null,
            movingSpeedKmh: parseSpeedKmh(point.movingSpeed),
            movingDirection: point.movingDirection ?? null,
            movementPrediction: point.movementPrediction ?? null,
            stateTransfer: point.stateTransfer ?? null,
            probabilityRadiusKm: parseMetricNumber(point.probabilityRadius),
            windRadii: normalizeWindRadii(point.windRadii)
        };
    }

    function sortedRawPoints(rawSource) {
        if (!rawSource || typeof rawSource !== 'object') return { positions: [], forecast: [] };
        const positions = (Array.isArray(rawSource.positions) ? rawSource.positions : [])
            .map(normalizeRawPoint).filter(Boolean).sort((a, b) => a.timeMs - b.timeMs);
        const forecast = (Array.isArray(rawSource.forecast) ? rawSource.forecast : [])
            .map(normalizeRawPoint).filter(Boolean).sort((a, b) => a.timeMs - b.timeMs);
        return { positions, forecast };
    }

    function deriveMotion(points) {
        if (!Array.isArray(points) || points.length < 2) return null;
        const after = points[points.length - 1];
        const before = points[points.length - 2];
        const hours = (after.timeMs - before.timeMs) / HOUR_MS;
        if (!(hours > 0)) return null;
        const distanceKm = haversineKm(before.lat, before.lon, after.lat, after.lon);
        const bearingDegrees = initialBearingDegrees(before.lat, before.lon, after.lat, after.lon);
        if (!Number.isFinite(distanceKm) || !Number.isFinite(bearingDegrees)) return null;
        return {
            source: 'track-geometry-v1',
            fromTime: before.time,
            toTime: after.time,
            speedKmh: distanceKm / hours,
            bearingDegrees,
            compass: compass8(bearingDegrees)
        };
    }

    function deriveAgencyMotion(rawPoints) {
        const { positions, forecast } = rawPoints;
        if (positions.length >= 2) return deriveMotion(positions.slice(-2));
        const latest = positions.length ? positions[positions.length - 1] : null;
        const nextForecast = latest ? forecast.find(point => point.timeMs > latest.timeMs) : null;
        if (latest && nextForecast) return deriveMotion([latest, nextForecast]);
        if (forecast.length >= 2) return deriveMotion(forecast.slice(0, 2));
        return null;
    }

    function closestByTime(points, targetMs) {
        if (!Array.isArray(points) || !points.length || !Number.isFinite(targetMs)) return null;
        return points.reduce((best, point) => {
            const delta = Math.abs(point.timeMs - targetMs);
            return !best || delta < best.delta ? { point, delta } : best;
        }, null)?.point ?? null;
    }

    function interpolateScalarAtTime(points, targetMs, key) {
        if (!Number.isFinite(targetMs)) return null;
        const timed = points.filter(point => Number.isFinite(point.timeMs) && Number.isFinite(point[key]));
        if (!timed.length) return null;
        const exact = timed.find(point => point.timeMs === targetMs);
        if (exact) return exact[key];
        for (let index = 1; index < timed.length; index += 1) {
            const before = timed[index - 1];
            const after = timed[index];
            if (targetMs < before.timeMs || targetMs > after.timeMs) continue;
            const span = after.timeMs - before.timeMs;
            if (span <= 0) return before[key];
            const ratio = (targetMs - before.timeMs) / span;
            return before[key] + (after[key] - before[key]) * ratio;
        }
        return closestByTime(timed, targetMs)?.[key] ?? null;
    }

    function windFieldEvidence(point, referencePoint) {
        if (!point || !point.windRadii.length) return null;
        const distanceKm = haversineKm(point.lat, point.lon, referencePoint.lat, referencePoint.lon);
        const bearingToHongKong = initialBearingDegrees(point.lat, point.lon, referencePoint.lat, referencePoint.lon);
        const quadrant = quadrant4(bearingToHongKong);
        if (!Number.isFinite(distanceKm) || !quadrant) return null;
        const levels = point.windRadii.map(radius => {
            const quadrantRadiusKm = finiteNumber(radius[quadrant]) ?? 0;
            return {
                level: radius.level,
                quadrant,
                quadrantRadiusKm,
                hongKongInside: quadrantRadiusKm > 0 && distanceKm <= quadrantRadiusKm
            };
        });
        return {
            time: point.time,
            stormDistanceToHongKongKm: distanceKm,
            bearingStormToHongKongDegrees: bearingToHongKong,
            hongKongQuadrantFromStorm: quadrant.toUpperCase(),
            levels,
            anyCoverage: levels.some(level => level.hongKongInside)
        };
    }

    function buildAgencyInput(agency, snapshotSource, rawSource, impactEntry, referencePoint) {
        const rawPoints = sortedRawPoints(rawSource);
        const latestAnalysis = rawPoints.positions.length ? rawPoints.positions[rawPoints.positions.length - 1] : null;
        const firstForecast = rawPoints.forecast.length ? rawPoints.forecast[0] : null;
        const current = latestAnalysis || firstForecast;
        const derivedMotion = deriveAgencyMotion(rawPoints);
        const closestTimeMs = parseTimeMs(impactEntry?.time);
        const nearClosestPoint = closestByTime(rawPoints.forecast.length ? rawPoints.forecast : rawPoints.positions, closestTimeMs);
        const windCandidates = [...rawPoints.positions, ...rawPoints.forecast].filter(point => point.windRadii.length);
        const latestWindPoint = rawPoints.positions.slice().reverse().find(point => point.windRadii.length)
            || windCandidates.slice().sort((a, b) => b.timeMs - a.timeMs)[0]
            || null;
        const closestWindPoint = closestByTime(windCandidates, closestTimeMs);
        const baseTimeMs = parseTimeMs(snapshotSource?.baseTime);
        const currentDistanceKm = current
            ? haversineKm(referencePoint.lat, referencePoint.lon, current.lat, current.lon)
            : null;
        const bearingFromHongKong = current
            ? initialBearingDegrees(referencePoint.lat, referencePoint.lon, current.lat, current.lon)
            : null;

        return {
            agency,
            state: snapshotSource?.state ?? (rawSource ? 'present' : 'missing'),
            baseTime: snapshotSource?.baseTime ?? null,
            current: current ? {
                time: current.time,
                lat: current.lat,
                lon: current.lon,
                distanceToHongKongKm: currentDistanceKm,
                bearingFromHongKongDegrees: bearingFromHongKong,
                sectorFromHongKong: compass8(bearingFromHongKong),
                intensity: current.intensity,
                maximumWindMs: current.maximumWindMs,
                maximumGustMs: current.maximumGustMs,
                pressureHpa: current.pressureHpa,
                officialMovingSpeedKmh: current.movingSpeedKmh,
                officialMovingDirection: current.movingDirection
            } : null,
            derivedMotion,
            closestApproach: impactEntry ? {
                time: impactEntry.time ?? null,
                distanceKm: finiteNumber(impactEntry.distanceKm),
                lat: finiteNumber(impactEntry.lat),
                lon: finiteNumber(impactEntry.lon),
                leadHoursFromBase: Number.isFinite(closestTimeMs) && Number.isFinite(baseTimeMs)
                    ? (closestTimeMs - baseTimeMs) / HOUR_MS
                    : null,
                maximumWindMs: interpolateScalarAtTime(rawPoints.forecast, closestTimeMs, 'maximumWindMs'),
                pressureHpa: interpolateScalarAtTime(rawPoints.forecast, closestTimeMs, 'pressureHpa'),
                nearestOfficialIntensity: nearClosestPoint?.intensity ?? null,
                nearestOfficialPointTime: nearClosestPoint?.time ?? null
            } : null,
            windField: {
                latestEvidence: windFieldEvidence(latestWindPoint, referencePoint),
                closestTimeEvidence: windFieldEvidence(closestWindPoint, referencePoint),
                radiusPointCount: windCandidates.length
            },
            provenance: {
                officialMetricSource: rawSource ? 'normalized-agency-source' : null,
                geometrySource: 'storm-track-computed',
                agencySubstitutionUsed: false
            }
        };
    }

    function normalizeHkoWarningContext(value) {
        if (!value || typeof value !== 'object') {
            return {
                provided: false,
                inferred: false,
                currentSignal: null,
                issuedAt: null,
                source: null,
                text: null
            };
        }
        return {
            provided: true,
            inferred: false,
            currentSignal: value.currentSignal ?? null,
            issuedAt: toIso(parseTimeMs(value.issuedAt)) ?? null,
            source: value.source ?? 'external-trusted-input',
            text: value.text ?? null
        };
    }

    function buildHkoSignalRiskInputs(snapshot, impact, sourceGroup, options) {
        const opts = options || {};
        const referencePoint = {
            name: snapshot?.referencePoint?.name || 'Hong Kong',
            lat: finiteNumber(snapshot?.referencePoint?.lat),
            lon: finiteNumber(snapshot?.referencePoint?.lon)
        };
        if (referencePoint.lat == null || referencePoint.lon == null) {
            throw new Error('StormAnalysisSnapshot referencePoint is required');
        }

        const rawSources = sourceGroup?.sources && typeof sourceGroup.sources === 'object'
            ? sourceGroup.sources
            : {};
        const impactEntries = new Map((Array.isArray(impact?.agencyClosestApproaches)
            ? impact.agencyClosestApproaches : []).map(entry => [entry.agency, entry]));
        const agencies = {};

        AGENCIES.forEach(agency => {
            agencies[agency] = buildAgencyInput(
                agency,
                snapshot?.sources?.[agency],
                rawSources[agency],
                impactEntries.get(agency),
                referencePoint
            );
        });

        const usable = AGENCIES.map(agency => agencies[agency]).filter(item => item.state === 'ok');
        const currentDistances = usable.map(item => item.current?.distanceToHongKongKm).filter(Number.isFinite);
        const derivedSpeeds = usable.map(item => item.derivedMotion?.speedKmh).filter(Number.isFinite);
        const currentWinds = usable.map(item => item.current?.maximumWindMs).filter(Number.isFinite);
        const closestWinds = usable.map(item => item.closestApproach?.maximumWindMs).filter(Number.isFinite);
        const closestDistances = usable.map(item => item.closestApproach?.distanceKm).filter(Number.isFinite);
        const closestTimes = usable.map(item => item.closestApproach?.time).filter(Boolean);
        const windRadiusAgencies = usable.filter(item => item.windField.radiusPointCount > 0);
        const latestWindCoverageAgencies = usable.filter(item => item.windField.latestEvidence?.anyCoverage);
        const closestWindCoverageAgencies = usable.filter(item => item.windField.closestTimeEvidence?.anyCoverage);

        const consensusClosest = impact?.closestApproach?.consensus ?? null;
        const consensusClosestMs = parseTimeMs(consensusClosest?.time);
        const referenceBaseMs = parseTimeMs(snapshot?.comparison?.referenceBaseTime);
        const consensusBearingFromHongKong = consensusClosest
            ? initialBearingDegrees(referencePoint.lat, referencePoint.lon, consensusClosest.lat, consensusClosest.lon)
            : null;
        const closestDistanceRange = numericRange(closestDistances);
        const currentWindRange = numericRange(currentWinds);
        const closestWindRange = numericRange(closestWinds);
        const hkoWarningContext = normalizeHkoWarningContext(opts.hkoWarningContext);

        return {
            schemaVersion: INPUT_VERSION,
            sourceSnapshotVersion: snapshot?.schemaVersion ?? null,
            sourceImpactVersion: impact?.schemaVersion ?? null,
            generatedAt: snapshot?.generatedAt ?? null,
            storm: snapshot?.storm ?? (sourceGroup ? {
                key: sourceGroup?.key ?? null,
                displayName: sourceGroup?.displayName ?? null,
                nameTc: sourceGroup?.nameTc ?? null,
                nameEn: sourceGroup?.nameEn ?? null
            } : null),
            referencePoint,
            coverage: {
                usableAgencies: snapshot?.coverage?.usableAgencies ?? usable.map(item => item.agency),
                usableAgencyCount: snapshot?.coverage?.usableAgencyCount ?? usable.length,
                windRadiusAgencies: windRadiusAgencies.map(item => item.agency),
                officialMotionAgencies: usable.filter(item => Number.isFinite(item.current?.officialMovingSpeedKmh)).map(item => item.agency),
                derivedMotionAgencies: usable.filter(item => Number.isFinite(item.derivedMotion?.speedKmh)).map(item => item.agency)
            },
            proximity: {
                agencyClosestDistanceRangeKm: impact?.closestApproach?.distanceRangeKm ?? closestDistanceRange,
                agencyClosestTimeWindow: impact?.closestApproach?.agencyTimeWindow ?? null,
                closestTimeSpreadHours: timeSpreadHours(closestTimes),
                currentDistanceRangeKm: numericRange(currentDistances),
                consensusClosest: consensusClosest ? {
                    time: consensusClosest.time ?? null,
                    distanceKm: finiteNumber(consensusClosest.distanceKm),
                    lat: finiteNumber(consensusClosest.lat),
                    lon: finiteNumber(consensusClosest.lon),
                    leadHoursFromReferenceBase: Number.isFinite(consensusClosestMs) && Number.isFinite(referenceBaseMs)
                        ? (consensusClosestMs - referenceBaseMs) / HOUR_MS
                        : null,
                    bearingFromHongKongDegrees: consensusBearingFromHongKong,
                    sectorFromHongKong: compass8(consensusBearingFromHongKong),
                    appComputed: true
                } : null
            },
            motion: {
                aggregateTrend: impact?.trend?.aggregate ?? null,
                agencyTrendCounts: impact?.trend?.counts ?? null,
                derivedSpeedRangeKmh: numericRange(derivedSpeeds)
            },
            intensity: {
                currentMaximumWindMs: currentWindRange,
                closestMaximumWindMs: closestWindRange,
                intensitySpreadMs: closestWindRange?.span ?? currentWindRange?.span ?? null
            },
            windField: {
                agenciesWithRadii: windRadiusAgencies.map(item => item.agency),
                latestCoverageAgencies: latestWindCoverageAgencies.map(item => item.agency),
                closestTimeCoverageAgencies: closestWindCoverageAgencies.map(item => item.agency),
                quadrantMethod: 'bearing-storm-to-hong-kong-v1'
            },
            disagreement: {
                comparisonSpreadKm: finiteNumber(snapshot?.comparison?.spread?.distanceKm),
                impactUncertaintyLevel: impact?.uncertainty?.level ?? null,
                impactUncertaintyMethod: impact?.uncertainty?.method ?? null,
                closestDistanceSpanKm: closestDistanceRange?.span ?? null,
                closestTimeSpreadHours: timeSpreadHours(closestTimes),
                intensitySpreadMs: closestWindRange?.span ?? currentWindRange?.span ?? null
            },
            officialHkoWarningContext: hkoWarningContext,
            agencies,
            featureVector: {
                usableAgencyCount: snapshot?.coverage?.usableAgencyCount ?? usable.length,
                comparisonSpreadKm: finiteNumber(snapshot?.comparison?.spread?.distanceKm),
                consensusClosestDistanceKm: finiteNumber(consensusClosest?.distanceKm),
                consensusClosestLeadHours: Number.isFinite(consensusClosestMs) && Number.isFinite(referenceBaseMs)
                    ? (consensusClosestMs - referenceBaseMs) / HOUR_MS
                    : null,
                closestDistanceMinKm: closestDistanceRange?.min ?? null,
                closestDistanceMaxKm: closestDistanceRange?.max ?? null,
                closestDistanceSpanKm: closestDistanceRange?.span ?? null,
                closestTimeSpreadHours: timeSpreadHours(closestTimes),
                currentDistanceMedianKm: median(currentDistances),
                derivedMotionSpeedMedianKmh: median(derivedSpeeds),
                currentMaximumWindMedianMs: median(currentWinds),
                closestMaximumWindMedianMs: median(closestWinds),
                intensitySpreadMs: closestWindRange?.span ?? currentWindRange?.span ?? null,
                windRadiusAgencyCount: windRadiusAgencies.length,
                latestWindFieldCoverageAgencyCount: latestWindCoverageAgencies.length,
                closestTimeWindFieldCoverageAgencyCount: closestWindCoverageAgencies.length
            },
            semantics: {
                deterministic: true,
                officialAgencyDataRemainSeparate: true,
                agencySubstitutionUsed: false,
                geometryIsAppComputed: true,
                warningSignalPredictionIncluded: false,
                warningRiskScoreIncluded: false,
                hkoDecisionInferred: false,
                officialHkoWarningContextInferred: false,
                windNumericUnitContract: 'm/s after adapter-compatible normalization',
                motionNumericUnitContract: 'km/h after normalization',
                aiGenerated: false
            }
        };
    }

    return Object.freeze({
        INPUT_VERSION,
        AGENCIES,
        parseWindMs,
        parseSpeedKmh,
        haversineKm,
        initialBearingDegrees,
        compass8,
        quadrant4,
        normalizeWindRadii,
        buildHkoSignalRiskInputs
    });
});
