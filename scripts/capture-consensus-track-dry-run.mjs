import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const DRY_RUN_VERSION = 'storm-consensus-track-dry-run/v0';
const DEFAULT_URL = 'https://maxyu725.github.io/Storm-Track/?beta=hk-signal';
const targetUrl = process.env.STORM_BETA_URL || DEFAULT_URL;
const settleTimeoutMs = Number(process.env.SETTLE_TIMEOUT_MS || 90000);

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const found = execFileSync('which', [command], { encoding: 'utf8' }).trim();
      if (found) return found;
    } catch {}
  }
  throw new Error('No system Chrome/Chromium executable found');
}

const executablePath = findChrome();
console.error(`CONSENSUS_DRY_RUN_CHROME=${executablePath}`);
console.error(`CONSENSUS_DRY_RUN_TARGET=${targetUrl}`);

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => console.error(`PAGE_ERROR ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') console.error(`PAGE_CONSOLE_ERROR ${message.text()}`);
  });

  const url = new URL(targetUrl);
  url.searchParams.set('beta', 'hk-signal');
  url.searchParams.set('consensusDryRun', String(Date.now()));

  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: settleTimeoutMs });
  await page.waitForFunction(() => {
    const badges = ['hko', 'cma', 'jma', 'cwa'].map(code => document.getElementById(`badge-${code}`));
    const allPresent = badges.every(Boolean);
    const allSettled = allPresent && badges.every(badge => !badge.classList.contains('loading'));
    const progress = document.getElementById('top-progress-bar');
    return allSettled && (!progress || progress.classList.contains('hidden'));
  }, null, { timeout: settleTimeoutMs });
  await page.waitForTimeout(750);

  const result = await page.evaluate(dryRunVersion => {
    const round = (value, digits = 1) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
    const percentile = (values, fraction) => {
      if (!values.length) return null;
      const sorted = values.slice().sort((a, b) => a - b);
      const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
      return sorted[index];
    };
    const stateNames = ['ok', 'empty', 'error', 'stale', 'loading'];
    const provenanceKeys = [
      'exact-analysis',
      'exact-forecast',
      'analysis-to-forecast-interpolation',
      'forecast-to-forecast-interpolation'
    ];
    const emptyProvenanceCounts = () => Object.fromEntries(provenanceKeys.map(key => [key, 0]));
    const sourceStates = ['HKO', 'CMA', 'JMA', 'CWA'].map(agency => {
      const badge = document.getElementById(`badge-${agency.toLowerCase()}`);
      return {
        agency,
        state: stateNames.find(name => badge?.classList.contains(name)) || 'unknown'
      };
    });

    const visibleGroupKeys = [...document.querySelectorAll('#active-storms-container .panel-storm-card[data-storm-key]')]
      .map(card => String(card.dataset.stormKey || ''))
      .filter(Boolean)
      .sort();
    const visibleKeySet = new Set(visibleGroupKeys);
    const ui = globalThis.StormHkThreatUi;
    const core = globalThis.StormAnalysisCore;
    if (typeof ui?.readProspectiveObservations !== 'function') {
      throw new Error('Prospective observation API unavailable');
    }
    if (typeof core?.buildConsensusTrackForGroup !== 'function') {
      throw new Error('Consensus track API unavailable');
    }

    const observations = ui.readProspectiveObservations()
      .filter(item => visibleKeySet.has(String(item?.group?.key || '')));

    const groups = observations.map(observation => {
      const sources = {};
      const missingRawInputAgencies = [];
      for (const [agency, source] of Object.entries(observation?.sources || {})) {
        if (source?.rawInput && typeof source.rawInput === 'object') sources[agency] = source.rawInput;
        else missingRawInputAgencies.push(agency);
      }

      const sourceReferences = Object.fromEntries(
        Object.entries(observation?.sources || {})
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([agency, source]) => [agency, {
            agency,
            sourceId: source?.sourceId ?? null,
            bulletinTime: source?.bulletinTime ?? null,
            currentTime: source?.current?.time ?? null,
            forecastBaseTime: source?.forecastStart?.baseTime ?? null,
            forecastFirstValidTime: source?.forecastStart?.time ?? null,
            forecastLastValidTime: source?.forecastEnd?.time ?? null,
            positionCount: Number(source?.positionCount) || 0,
            forecastCount: Number(source?.forecastCount) || 0
          }])
      );

      const group = {
        ...(observation?.group || {}),
        sources
      };
      const track = core.buildConsensusTrackForGroup(group, {
        generatedAt: observation?.observedAt || new Date().toISOString()
      });
      const points = Array.isArray(track?.points) ? track.points : [];
      const consensusPoints = points.filter(point => point?.consensus);
      const agencyCountHistogram = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
      const agencyContributions = { HKO: 0, CMA: 0, JMA: 0, CWA: 0 };
      const consensusProvenanceCounts = emptyProvenanceCounts();
      const consensusAgencyProvenance = {
        HKO: emptyProvenanceCounts(),
        CMA: emptyProvenanceCounts(),
        JMA: emptyProvenanceCounts(),
        CWA: emptyProvenanceCounts()
      };
      const unknownProvenanceValues = [];
      let totalEntries = 0;
      let interpolatedEntries = 0;
      let consensusEntryCount = 0;

      for (const point of points) {
        const count = Number(point?.agencyCount) || 0;
        agencyCountHistogram[Math.max(0, Math.min(4, count))] += 1;
        for (const entry of point?.entries || []) {
          totalEntries += 1;
          if (entry?.interpolated) interpolatedEntries += 1;
          if (Object.hasOwn(agencyContributions, entry?.agency)) agencyContributions[entry.agency] += 1;

          if (point?.consensus) {
            consensusEntryCount += 1;
            const provenance = String(entry?.provenance || 'missing');
            if (Object.hasOwn(consensusProvenanceCounts, provenance)) {
              consensusProvenanceCounts[provenance] += 1;
              if (Object.hasOwn(consensusAgencyProvenance, entry?.agency)) {
                consensusAgencyProvenance[entry.agency][provenance] += 1;
              }
            } else {
              unknownProvenanceValues.push(provenance);
            }
          }
        }
      }

      const consensusExactEntryCount = consensusProvenanceCounts['exact-analysis']
        + consensusProvenanceCounts['exact-forecast'];
      const consensusInterpolatedEntryCount = consensusProvenanceCounts['analysis-to-forecast-interpolation']
        + consensusProvenanceCounts['forecast-to-forecast-interpolation'];
      const consensusProvenancePct = Object.fromEntries(provenanceKeys.map(key => [
        key,
        consensusEntryCount ? round(consensusProvenanceCounts[key] * 100 / consensusEntryCount, 1) : 0
      ]));

      const spreadValues = consensusPoints
        .map(point => Number(point?.spread?.distanceKm))
        .filter(Number.isFinite);
      const firstConsensusIndex = points.findIndex(point => Boolean(point?.consensus));
      let continuousThroughHours = null;
      if (firstConsensusIndex >= 0) {
        continuousThroughHours = points[firstConsensusIndex].leadHours;
        for (let index = firstConsensusIndex + 1; index < points.length; index += 1) {
          if (!points[index]?.consensus) break;
          continuousThroughHours = points[index].leadHours;
        }
      }

      const supportedThroughHours = consensusPoints.at(-1)?.leadHours ?? null;
      const supportedPoints = supportedThroughHours == null
        ? []
        : points.filter(point => point.leadHours <= supportedThroughHours);
      const supportedConsensusPoints = supportedPoints.filter(point => point?.consensus);

      return {
        key: observation?.group?.key ?? null,
        displayName: observation?.group?.displayName ?? null,
        nameTc: observation?.group?.nameTc ?? null,
        nameEn: observation?.group?.nameEn ?? null,
        sourceAgencies: observation?.sourceAgencies || [],
        sourceReferences,
        missingRawInputAgencies,
        trackSchemaVersion: track?.schemaVersion ?? null,
        state: track?.state ?? null,
        referenceAgency: track?.referenceAgency ?? null,
        referenceBaseTime: track?.referenceBaseTime ?? null,
        referenceMethod: track?.referenceMethod ?? null,
        configuredHorizonHours: track?.endLeadHours ?? null,
        stepHours: track?.stepHours ?? null,
        totalSamplePoints: points.length,
        consensusPointCount: consensusPoints.length,
        consensusCoveragePct: points.length ? round(consensusPoints.length * 100 / points.length, 1) : 0,
        supportedThroughHours,
        supportedSamplePointCount: supportedPoints.length,
        consensusPointCountWithinSupportedHorizon: supportedConsensusPoints.length,
        coverageWithinSupportedHorizonPct: supportedPoints.length
          ? round(supportedConsensusPoints.length * 100 / supportedPoints.length, 1)
          : 0,
        firstConsensusLeadHours: consensusPoints[0]?.leadHours ?? null,
        lastConsensusLeadHours: consensusPoints.at(-1)?.leadHours ?? null,
        continuousConsensusThroughHours: continuousThroughHours,
        consensusGapLeadHours: points.filter(point => !point?.consensus).map(point => point.leadHours),
        agencyCountHistogram,
        agencyContributions,
        totalEntries,
        interpolatedEntries,
        interpolationPct: totalEntries ? round(interpolatedEntries * 100 / totalEntries, 1) : 0,
        consensusEntryCount,
        consensusExactEntryCount,
        consensusInterpolatedEntryCount,
        consensusExactPct: consensusEntryCount ? round(consensusExactEntryCount * 100 / consensusEntryCount, 1) : 0,
        consensusInterpolationPct: consensusEntryCount ? round(consensusInterpolatedEntryCount * 100 / consensusEntryCount, 1) : 0,
        consensusProvenanceCounts,
        consensusProvenancePct,
        consensusAgencyProvenance,
        unknownProvenanceValues: [...new Set(unknownProvenanceValues)].sort(),
        spreadKm: {
          median: round(percentile(spreadValues, 0.5), 1),
          p90: round(percentile(spreadValues, 0.9), 1),
          max: round(spreadValues.length ? Math.max(...spreadValues) : null, 1)
        },
        samples: points.map(point => ({
          leadHours: point.leadHours,
          validTime: point.validTime,
          agencyCount: point.agencyCount,
          agencies: point.agencies,
          interpolatedAgencyCount: (point.entries || []).filter(entry => entry?.interpolated).length,
          provenanceByAgency: Object.fromEntries((point.entries || []).map(entry => [entry.agency, entry.provenance || null])),
          consensusLat: round(Number(point?.consensus?.lat), 3),
          consensusLon: round(Number(point?.consensus?.lon), 3),
          spreadKm: round(Number(point?.spread?.distanceKm), 1)
        }))
      };
    });

    return {
      schemaVersion: dryRunVersion,
      capturedAt: new Date().toISOString(),
      pageTitle: document.title,
      sourceStates,
      visibleGroupKeys,
      observationCount: observations.length,
      groupCount: groups.length,
      groups,
      semantics: {
        rawInputsPersisted: false,
        summaryOnly: true,
        forecastSkillEvaluated: false,
        probabilityCalibrated: false
      }
    };
  }, DRY_RUN_VERSION);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
