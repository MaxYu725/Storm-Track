(function attachStormHistoricalBackfillImporter(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.StormHistoricalBackfillImporter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHistoricalBackfillImporter() {
    'use strict';

    const IMPORT_VERSION = 'historical-backfill-import/v1';
    const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);
    const FORECAST_PROVENANCE_TYPES = Object.freeze([
        'storm-track-d1',
        'original-official-advisory',
        'auditable-archive',
        'unknown'
    ]);
    const ELIGIBLE_FORECAST_PROVENANCE = new Set(FORECAST_PROVENANCE_TYPES.slice(0, 3));

    function finite(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function timeMs(value) {
        if (value == null || value === '') return null;
        if (Number.isFinite(value)) return value;
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function iso(value) {
        const parsed = timeMs(value);
        return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    }

    function stableClone(value) {
        if (Array.isArray(value)) return value.map(stableClone);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableClone(value[key])]));
    }

    function stableStringify(value) {
        return JSON.stringify(stableClone(value));
    }

    function fnv32(text, seed) {
        let hash = seed >>> 0;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
    }

    function fingerprint(value) {
        const text = typeof value === 'string' ? value : stableStringify(value);
        return `${fnv32(text, 0x811c9dc5)}${fnv32(text, 0x9e3779b9)}`;
    }

    function id(prefix, value) {
        return `${prefix}_${fingerprint(value)}`;
    }

    function normalizePoint(point) {
        if (!point || typeof point !== 'object') return null;
        const lat = finite(point.lat ?? point.latitude);
        const lon = finite(point.lon ?? point.longitude);
        const when = iso(point.time ?? point.validTime ?? point.observedAt);
        if (lat == null || lon == null || !when || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
        return {
            time: when,
            lat,
            lon,
            maximumWind: point.maximumWind ?? point.windSpeed ?? null,
            pressure: point.pressure ?? null,
            intensity: point.intensity ?? null,
            sourcePointId: point.sourcePointId ?? point.id ?? null
        };
    }

    function dedupePoints(points) {
        const byKey = new Map();
        (Array.isArray(points) ? points : []).map(normalizePoint).filter(Boolean).forEach(point => {
            const key = `${point.time}|${point.lat}|${point.lon}`;
            if (!byKey.has(key)) byKey.set(key, point);
        });
        return Array.from(byKey.values()).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    }

    function normalizeTruthDataset(stormKey, truth) {
        if (!truth || typeof truth !== 'object') return null;
        const source = String(truth.source || '').trim();
        if (!source) throw new Error(`truth.source is required for ${stormKey}`);
        const points = dedupePoints(truth.track || truth.points || []);
        if (!points.length) return null;
        const datasetFingerprint = fingerprint({ stormKey, source, datasetId: truth.datasetId ?? null, points });
        return {
            datasetId: truth.datasetId ? String(truth.datasetId) : `truth_${datasetFingerprint}`,
            fingerprint: datasetFingerprint,
            stormKey,
            source,
            sourceUrl: truth.sourceUrl ?? null,
            sourceVersion: truth.sourceVersion ?? null,
            retrievedAt: iso(truth.retrievedAt),
            points
        };
    }

    function normalizeForecastProvenance(value) {
        const input = value && typeof value === 'object' ? value : {};
        let type = String(input.type || 'unknown').trim();
        if (!FORECAST_PROVENANCE_TYPES.includes(type)) type = 'unknown';
        const dataRole = String(input.dataRole || 'forecast').trim().toLowerCase();
        const source = String(input.source || '').trim() || null;
        const originalIssuedAt = iso(input.originalIssuedAt ?? input.issuedAt);
        const archiveCapturedAt = iso(input.archiveCapturedAt ?? input.capturedAt ?? input.retrievedAt);
        const eligible = ELIGIBLE_FORECAST_PROVENANCE.has(type)
            && dataRole === 'forecast'
            && Boolean(source)
            && Boolean(originalIssuedAt);
        return {
            type,
            dataRole,
            source,
            sourceUrl: input.sourceUrl ?? null,
            archiveId: input.archiveId ?? null,
            originalIssuedAt,
            archiveCapturedAt,
            payloadHash: input.payloadHash ?? null,
            eligibleForWalkForward: eligible,
            rejectionReason: eligible ? null : (
                dataRole !== 'forecast' ? 'not-forecast-role'
                    : !source ? 'missing-source'
                        : !originalIssuedAt ? 'missing-original-issued-at'
                            : 'untrusted-provenance-type'
            )
        };
    }

    function snapshotHasForecast(snapshot) {
        return AGENCIES.some(agency => Array.isArray(snapshot?.sources?.[agency]?.forecast)
            && snapshot.sources[agency].forecast.length > 0);
    }

    function normalizeForecastCase(stormKey, item, index) {
        if (!item || typeof item !== 'object' || !item.snapshot) return null;
        const asOf = iso(item.asOf ?? item.snapshot.generatedAt);
        if (!asOf) return null;
        const provenance = normalizeForecastProvenance(item.provenance ?? item.forecastProvenance);
        const hasForecast = snapshotHasForecast(item.snapshot);
        const payload = {
            snapshot: item.snapshot,
            impact: item.impact ?? null,
            signalInputs: item.signalInputs ?? null,
            sourceAvailability: item.sourceAvailability ?? null
        };
        const payloadFingerprint = fingerprint(payload);
        const caseId = item.caseId ? String(item.caseId) : id('case', { stormKey, asOf, payloadFingerprint, index });
        const originalIssuedMs = timeMs(provenance.originalIssuedAt);
        const asOfMs = timeMs(asOf);
        const issuedAfterCutoff = Number.isFinite(originalIssuedMs) && Number.isFinite(asOfMs) && originalIssuedMs > asOfMs + 1000;
        const eligible = hasForecast && provenance.eligibleForWalkForward && !issuedAfterCutoff;
        return {
            caseId,
            fingerprint: fingerprint({ stormKey, asOf, provenance, payloadFingerprint }),
            stormKey,
            asOf,
            hasForecast,
            eligibleForWalkForward: eligible,
            rejectionReason: eligible ? null : (issuedAfterCutoff ? 'issued-after-as-of' : (!hasForecast ? 'no-forecast-points' : provenance.rejectionReason)),
            provenance,
            payloadFingerprint,
            payload
        };
    }

    function normalizeSignalOutcome(stormKey, input) {
        if (!input || typeof input !== 'object') return null;
        const source = String(input.source || '').trim();
        if (!source) throw new Error(`signal outcome source is required for ${stormKey}`);
        const issuedAt = iso(input.issuedAt ?? input.observedAt ?? input.startTime);
        const endedAt = iso(input.endedAt ?? input.cancelledAt ?? input.endTime);
        const highestSignal = input.highestSignal ?? input.signal ?? null;
        if (!highestSignal && !issuedAt) return null;
        const normalized = {
            stormKey,
            source,
            sourceUrl: input.sourceUrl ?? null,
            signalSystemEra: input.signalSystemEra ?? null,
            highestSignal,
            issuedAt,
            endedAt,
            details: input.details ?? null
        };
        return { ...normalized, fingerprint: fingerprint(normalized) };
    }

    function classifyCapability(truthDataset, forecastCases) {
        const eligibleCases = forecastCases.filter(item => item.eligibleForWalkForward);
        const forecastCasesWithPoints = forecastCases.filter(item => item.hasForecast);
        let mode = 'unavailable';
        if (truthDataset && !eligibleCases.length) mode = 'truth-only';
        else if (!truthDataset && forecastCasesWithPoints.length) mode = 'forecast-only';
        else if (truthDataset && forecastCasesWithPoints.length && eligibleCases.length === forecastCasesWithPoints.length) mode = 'full-walk-forward';
        else if (truthDataset && eligibleCases.length) mode = 'partial-walk-forward';
        return {
            mode,
            truthAvailable: Boolean(truthDataset),
            forecastCaseCount: forecastCases.length,
            casesWithForecasts: forecastCasesWithPoints.length,
            eligibleForecastCases: eligibleCases.length,
            eligibleForAgencySkill: Boolean(truthDataset) && eligibleCases.length > 0
        };
    }

    function buildStormImport(stormInput) {
        if (!stormInput || typeof stormInput !== 'object') throw new Error('storm input is required');
        const stormKey = String(stormInput.stormKey ?? stormInput.key ?? '').trim();
        if (!stormKey) throw new Error('stormKey is required');
        const truthDataset = normalizeTruthDataset(stormKey, stormInput.truth);
        const forecastCases = (Array.isArray(stormInput.predictionCases) ? stormInput.predictionCases : [])
            .map((item, index) => normalizeForecastCase(stormKey, item, index)).filter(Boolean);
        const signalOutcome = normalizeSignalOutcome(stormKey, stormInput.signalOutcome ?? stormInput.truth?.officialHkoWarningOutcome);
        const capability = classifyCapability(truthDataset, forecastCases);
        return {
            storm: {
                stormKey,
                nameTc: stormInput.nameTc ?? null,
                nameEn: stormInput.nameEn ?? null,
                season: finite(stormInput.season),
                basin: stormInput.basin ?? 'WNP'
            },
            truthDataset,
            forecastCases,
            signalOutcome,
            capability
        };
    }

    function row(table, primaryKey, values) {
        return { table, primaryKey, values };
    }

    function buildImportPlan(input) {
        const stormsInput = Array.isArray(input?.storms) ? input.storms : [];
        const runSource = String(input?.source || 'manual-backfill').trim();
        const generatedAt = iso(input?.generatedAt) ?? new Date().toISOString();
        const storms = stormsInput.map(buildStormImport);
        const runFingerprint = fingerprint({ runSource, storms: storms.map(item => ({ storm: item.storm, capability: item.capability })) });
        const runId = input?.runId ? String(input.runId) : `backfill_${runFingerprint}`;
        const rows = [];
        rows.push(row('backfill_runs', runId, {
            run_id: runId,
            import_version: IMPORT_VERSION,
            source: runSource,
            generated_at: generatedAt,
            fingerprint: runFingerprint,
            status: 'planned'
        }));

        storms.forEach(item => {
            rows.push(row('historical_storms', item.storm.stormKey, {
                storm_key: item.storm.stormKey,
                name_tc: item.storm.nameTc,
                name_en: item.storm.nameEn,
                season: item.storm.season,
                basin: item.storm.basin,
                backfill_mode: item.capability.mode,
                agency_skill_eligible: item.capability.eligibleForAgencySkill ? 1 : 0,
                updated_at: generatedAt
            }));
            if (item.truthDataset) {
                rows.push(row('truth_datasets', item.truthDataset.datasetId, {
                    dataset_id: item.truthDataset.datasetId,
                    storm_key: item.storm.stormKey,
                    source: item.truthDataset.source,
                    source_url: item.truthDataset.sourceUrl,
                    source_version: item.truthDataset.sourceVersion,
                    retrieved_at: item.truthDataset.retrievedAt,
                    fingerprint: item.truthDataset.fingerprint
                }));
                item.truthDataset.points.forEach(point => {
                    const pointId = id('truthpt', { datasetId: item.truthDataset.datasetId, point });
                    rows.push(row('truth_points', pointId, {
                        point_id: pointId,
                        dataset_id: item.truthDataset.datasetId,
                        valid_time: point.time,
                        lat: point.lat,
                        lon: point.lon,
                        maximum_wind_json: point.maximumWind == null ? null : JSON.stringify(point.maximumWind),
                        pressure_json: point.pressure == null ? null : JSON.stringify(point.pressure),
                        intensity: point.intensity,
                        source_point_id: point.sourcePointId,
                        fingerprint: fingerprint(point)
                    }));
                });
            }
            item.forecastCases.forEach(forecastCase => {
                rows.push(row('forecast_snapshots', forecastCase.caseId, {
                    snapshot_id: forecastCase.caseId,
                    storm_key: item.storm.stormKey,
                    as_of: forecastCase.asOf,
                    provenance_type: forecastCase.provenance.type,
                    provenance_source: forecastCase.provenance.source,
                    provenance_source_url: forecastCase.provenance.sourceUrl,
                    archive_id: forecastCase.provenance.archiveId,
                    original_issued_at: forecastCase.provenance.originalIssuedAt,
                    archive_captured_at: forecastCase.provenance.archiveCapturedAt,
                    payload_hash: forecastCase.provenance.payloadHash ?? forecastCase.payloadFingerprint,
                    eligible_for_walkforward: forecastCase.eligibleForWalkForward ? 1 : 0,
                    rejection_reason: forecastCase.rejectionReason,
                    snapshot_json: JSON.stringify(forecastCase.payload.snapshot),
                    impact_json: forecastCase.payload.impact == null ? null : JSON.stringify(forecastCase.payload.impact),
                    signal_inputs_json: forecastCase.payload.signalInputs == null ? null : JSON.stringify(forecastCase.payload.signalInputs),
                    source_availability_json: forecastCase.payload.sourceAvailability == null ? null : JSON.stringify(forecastCase.payload.sourceAvailability),
                    fingerprint: forecastCase.fingerprint
                }));
            });
            if (item.signalOutcome) {
                const outcomeId = id('signal', item.signalOutcome);
                rows.push(row('signal_outcomes', outcomeId, {
                    outcome_id: outcomeId,
                    storm_key: item.storm.stormKey,
                    source: item.signalOutcome.source,
                    source_url: item.signalOutcome.sourceUrl,
                    signal_system_era: item.signalOutcome.signalSystemEra,
                    highest_signal: item.signalOutcome.highestSignal,
                    issued_at: item.signalOutcome.issuedAt,
                    ended_at: item.signalOutcome.endedAt,
                    details_json: item.signalOutcome.details == null ? null : JSON.stringify(item.signalOutcome.details),
                    fingerprint: item.signalOutcome.fingerprint
                }));
            }
        });

        const tableCounts = rows.reduce((acc, item) => {
            acc[item.table] = (acc[item.table] || 0) + 1;
            return acc;
        }, {});
        return {
            schemaVersion: IMPORT_VERSION,
            runId,
            generatedAt,
            source: runSource,
            storms,
            rows,
            tableCounts,
            semantics: {
                deterministicPlan: true,
                idempotentKeys: true,
                truthSourceExplicit: true,
                bestTrackMayBeTruthOnly: true,
                bestTrackMayNotBeForecastProvenance: true,
                unknownForecastProvenanceExcludedFromSkill: true,
                productionDatabaseWritten: false,
                workerDeployed: false,
                aiGenerated: false
            }
        };
    }

    return Object.freeze({
        IMPORT_VERSION,
        AGENCIES,
        FORECAST_PROVENANCE_TYPES,
        stableStringify,
        fingerprint,
        dedupePoints,
        normalizeForecastProvenance,
        classifyCapability,
        buildStormImport,
        buildImportPlan
    });
});
