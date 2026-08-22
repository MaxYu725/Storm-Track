(function attachHistoricalReplayFeasibility(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StormHistoricalReplayFeasibility = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHistoricalReplayFeasibility() {
  'use strict';

  const VERSION = 'historical-replay-feasibility/v1';
  const AGENCIES = Object.freeze(['HKO', 'CMA', 'JMA', 'CWA']);

  function clean(value) {
    return value == null ? '' : String(value).trim();
  }

  function normalizeName(value) {
    return clean(value).toUpperCase().replace(/[\s_()（）\-–—./]+/g, '');
  }

  function timeMs(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : null;
  }

  function yearOf(row) {
    const candidates = [row?.first_seen_at, row?.last_seen_at];
    for (const value of candidates) {
      const ms = timeMs(value);
      if (Number.isFinite(ms)) return new Date(ms).getUTCFullYear();
    }
    return null;
  }

  function sourceHashValid(value) {
    return /^[0-9a-f]{64}$/i.test(clean(value));
  }

  function sourceUrlValid(value) {
    return /^https:\/\//i.test(clean(value));
  }

  function targetMatches(row, target) {
    if (!row || !target) return false;
    if (Number.isFinite(Number(target.year)) && yearOf(row) !== Number(target.year)) return false;
    const haystacks = [row.name_en, row.name_zh, row.international_number, row.storm_key]
      .map(normalizeName)
      .filter(Boolean);
    const aliases = (Array.isArray(target.aliases) ? target.aliases : [])
      .map(normalizeName)
      .filter(Boolean);
    return aliases.some(alias => haystacks.some(value => value.includes(alias) || alias.includes(value)));
  }

  function selectTargetStorms(stormRows, targets) {
    return (Array.isArray(targets) ? targets : []).map(target => {
      const matches = (Array.isArray(stormRows) ? stormRows : []).filter(row => targetMatches(row, target));
      return { target, matches };
    });
  }

  function normalizeAdvisory(row) {
    if (!row || !AGENCIES.includes(clean(row.agency))) return null;
    const issuedMs = timeMs(row.issued_at);
    const lastValidMs = timeMs(row.last_forecast_valid_at);
    const forecastPointCount = Number(row.forecast_point_count || 0);
    if (!Number.isFinite(issuedMs) || !Number.isFinite(lastValidMs) || forecastPointCount <= 0) return null;
    return {
      ...row,
      agency: clean(row.agency),
      issuedMs,
      lastValidMs,
      forecastPointCount
    };
  }

  function buildCutoffCoverage(advisoryRows) {
    const advisories = (Array.isArray(advisoryRows) ? advisoryRows : [])
      .map(normalizeAdvisory)
      .filter(Boolean)
      .sort((a, b) => a.issuedMs - b.issuedMs || clean(a.id).localeCompare(clean(b.id)));
    const candidateTimes = Array.from(new Set(advisories.map(row => row.issuedMs))).sort((a, b) => a - b);
    const states = candidateTimes.map(cutoffMs => {
      const selected = [];
      for (const agency of AGENCIES) {
        const candidates = advisories
          .filter(row => row.agency === agency && row.issuedMs <= cutoffMs && row.lastValidMs > cutoffMs)
          .sort((a, b) => b.issuedMs - a.issuedMs || clean(b.id).localeCompare(clean(a.id)));
        if (candidates[0]) selected.push(candidates[0]);
      }
      return {
        asOf: new Date(cutoffMs).toISOString(),
        agencyCount: selected.length,
        agencies: selected.map(row => row.agency).sort(),
        advisoryIds: selected.map(row => clean(row.id)).filter(Boolean).sort()
      };
    }).filter(state => state.agencyCount > 0);
    const maxAgencyCount = states.length ? Math.max(...states.map(state => state.agencyCount)) : 0;
    const preferred = states.filter(state => state.agencyCount === maxAgencyCount);
    return {
      candidateCount: states.length,
      maxAgencyCount,
      preferredCandidateCount: preferred.length,
      firstCandidateAt: states[0]?.asOf || null,
      lastCandidateAt: states.at(-1)?.asOf || null,
      preferredCutoffs: preferred.slice(0, 12)
    };
  }

  function provenanceSummary(advisoryRows) {
    const rows = Array.isArray(advisoryRows) ? advisoryRows : [];
    const total = rows.length;
    const withIssuedAt = rows.filter(row => Number.isFinite(timeMs(row?.issued_at))).length;
    const withSourceHash = rows.filter(row => sourceHashValid(row?.source_hash)).length;
    const withSourceUrl = rows.filter(row => sourceUrlValid(row?.source_url)).length;
    const withFetchedAt = rows.filter(row => Number.isFinite(timeMs(row?.fetched_at))).length;
    const withRawObjectKey = rows.filter(row => clean(row?.raw_object_key)).length;
    return {
      forecastBearingAdvisoryCount: total,
      withIssuedAt,
      withSourceHash,
      withSourceUrl,
      withFetchedAt,
      withRawObjectKey,
      completeForWalkForward: total > 0 && withIssuedAt === total && withSourceHash === total && withSourceUrl === total,
      gaps: {
        missingIssuedAt: total - withIssuedAt,
        missingSourceHash: total - withSourceHash,
        missingSourceUrl: total - withSourceUrl,
        missingFetchedAt: total - withFetchedAt,
        missingRawObjectKey: total - withRawObjectKey
      }
    };
  }

  function classifyReplay({ storm, coverage, provenance }) {
    if (!storm) return 'not-found';
    if (!coverage || coverage.maxAgencyCount === 0) return 'no-forecast-history';
    if (coverage.maxAgencyCount === 1) return provenance.completeForWalkForward ? 'single-agency-replay-only' : 'single-agency-with-provenance-gaps';
    if (coverage.maxAgencyCount === 2) return provenance.completeForWalkForward ? 'partial-multi-agency-replay-ready' : 'partial-multi-agency-with-provenance-gaps';
    return provenance.completeForWalkForward ? 'multi-agency-replay-ready' : 'multi-agency-with-provenance-gaps';
  }

  function auditHistoricalReplay({ stormRows, advisoryRows, targets, generatedAt }) {
    const selections = selectTargetStorms(stormRows, targets);
    const cases = selections.map(({ target, matches }) => {
      if (matches.length !== 1) {
        return {
          targetId: clean(target?.id),
          targetYear: Number(target?.year) || null,
          aliases: Array.isArray(target?.aliases) ? target.aliases : [],
          status: matches.length ? 'ambiguous-target' : 'not-found',
          matches: matches.map(row => ({
            stormKey: row.storm_key,
            nameEn: row.name_en,
            nameZh: row.name_zh,
            firstSeenAt: row.first_seen_at,
            lastSeenAt: row.last_seen_at
          }))
        };
      }
      const storm = matches[0];
      const rows = (Array.isArray(advisoryRows) ? advisoryRows : []).filter(row => clean(row.storm_id) === clean(storm.storm_key));
      const coverage = buildCutoffCoverage(rows);
      const provenance = provenanceSummary(rows);
      const agencies = AGENCIES.map(agency => {
        const agencyRows = rows.filter(row => clean(row.agency) === agency);
        return {
          agency,
          forecastBearingAdvisoryCount: agencyRows.length,
          forecastPointCount: agencyRows.reduce((sum, row) => sum + Number(row.forecast_point_count || 0), 0),
          firstIssueAt: agencyRows.map(row => row.issued_at).filter(Boolean).sort()[0] || null,
          lastIssueAt: agencyRows.map(row => row.issued_at).filter(Boolean).sort().at(-1) || null
        };
      });
      return {
        targetId: clean(target?.id),
        targetYear: Number(target?.year) || null,
        aliases: Array.isArray(target?.aliases) ? target.aliases : [],
        status: 'matched',
        storm: {
          stormKey: storm.storm_key,
          internationalNumber: storm.international_number ?? null,
          nameEn: storm.name_en ?? null,
          nameZh: storm.name_zh ?? null,
          status: storm.status ?? null,
          mergedIntoId: storm.merged_into_id ?? null,
          firstSeenAt: storm.first_seen_at ?? null,
          lastSeenAt: storm.last_seen_at ?? null,
          forecastAgencyCount: Number(storm.forecast_agency_count || 0),
          forecastAdvisoryCount: Number(storm.forecast_advisory_count || 0),
          forecastPointCount: Number(storm.forecast_point_count || 0)
        },
        agencies,
        cutoffCoverage: coverage,
        provenance,
        replayCapability: classifyReplay({ storm, coverage, provenance }),
        windRadiiAuditRequired: true
      };
    });
    return {
      schemaVersion: VERSION,
      generatedAt: generatedAt || new Date().toISOString(),
      source: {
        database: 'storm-track-db',
        mode: 'read-only-select',
        productionWorkerModified: false,
        productionDatabaseWritten: false
      },
      targetCount: cases.length,
      matchedCount: cases.filter(item => item.status === 'matched').length,
      cases,
      semantics: {
        asIssuedCutoffRequired: true,
        futureForecastValidTimesAllowed: true,
        futureAdvisoryIssueTimesRejected: true,
        missingAgencyNotSubstituted: true,
        currentV1ForecastModelNotModified: true,
        historicalReplayIsRetrospectiveNotProspective: true,
        calibrationOrTrainingPerformed: false
      }
    };
  }

  return Object.freeze({
    VERSION,
    AGENCIES,
    normalizeName,
    targetMatches,
    selectTargetStorms,
    buildCutoffCoverage,
    provenanceSummary,
    classifyReplay,
    auditHistoricalReplay
  });
});
