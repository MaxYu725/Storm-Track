from pathlib import Path

# Preserve agency independence inside per-agency signal evidence. Aggregate checkpoint
# medians remain valid for consensus evidence, but missing agency wind/motion must not
# be silently filled from other agencies.
path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')
old = """  function pointSignalEvidence(entry, checkpoint, signal) {\n    const distanceKm = finite(entry?.distanceKm) ?? finite(checkpoint?.distanceMedianKm);\n    const windMs = finite(entry?.maximumWindMs) ?? finite(checkpoint?.windMedianMs);\n    const timeRelevance = clamp(finite(checkpoint?.timeRelevance) ?? softTimeRelevance(finite(checkpoint?.leadHours)));\n    const rapid = clamp(finite(entry?.rapidEvolutionIndex) ?? finite(checkpoint?.rapidEvolutionIndex) ?? 0);\n    const approachRateKmh = finite(entry?.approachRateKmh) ?? finite(checkpoint?.approachRateKmh);"""
new = """  function pointSignalEvidence(entry, checkpoint, signal) {\n    const agencySpecific = entry?.agency != null;\n    const distanceKm = agencySpecific\n      ? finite(entry?.distanceKm)\n      : (finite(entry?.distanceKm) ?? finite(checkpoint?.distanceMedianKm));\n    const windMs = agencySpecific\n      ? finite(entry?.maximumWindMs)\n      : (finite(entry?.maximumWindMs) ?? finite(checkpoint?.windMedianMs));\n    const timeRelevance = clamp(finite(checkpoint?.timeRelevance) ?? softTimeRelevance(finite(checkpoint?.leadHours)));\n    const rapid = clamp(agencySpecific\n      ? (finite(entry?.rapidEvolutionIndex) ?? 0)\n      : (finite(entry?.rapidEvolutionIndex) ?? finite(checkpoint?.rapidEvolutionIndex) ?? 0));\n    const approachRateKmh = agencySpecific\n      ? finite(entry?.approachRateKmh)\n      : (finite(entry?.approachRateKmh) ?? finite(checkpoint?.approachRateKmh));"""
if text.count(old) != 1:
    raise SystemExit('followup12 agency evidence anchor mismatch')
text = text.replace(old, new, 1)

old = """        minorityAgencyThreatScenarioPreserved: true,\n        minorityAgencyWindFieldScenarioPreserved: true,"""
new = """        minorityAgencyThreatScenarioPreserved: true,\n        minorityAgencyWindFieldScenarioPreserved: true,\n        perAgencyEvidenceUsesOnlyAgencyData: true,"""
if text.count(old) != 1:
    raise SystemExit('followup12 semantics anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

# Keep the live diagnostic faithful to product null semantics and agency independence.
path = Path('scripts/hk-live-engine-probe.mjs')
text = path.read_text(encoding='utf-8')
old = "const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;"
new = "const finite = value => value == null || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);"
if text.count(old) != 1:
    raise SystemExit('followup12 live diagnostic finite anchor mismatch')
text = text.replace(old, new, 1)
old = """const t1PointEvidence = (entry, checkpoint) => {\n  const distanceKm = finite(entry?.distanceKm) ?? finite(checkpoint?.distanceMedianKm);\n  const windMs = finite(entry?.maximumWindMs) ?? finite(checkpoint?.windMedianMs);\n  const timeRelevance = clamp(finite(checkpoint?.timeRelevance) ?? softTime(finite(checkpoint?.leadHours)));\n  const rapid = clamp(finite(entry?.rapidEvolutionIndex) ?? finite(checkpoint?.rapidEvolutionIndex) ?? 0);\n  const approachRateKmh = finite(entry?.approachRateKmh) ?? finite(checkpoint?.approachRateKmh);"""
new = """const t1PointEvidence = (entry, checkpoint) => {\n  const agencySpecific = entry?.agency != null;\n  const distanceKm = agencySpecific ? finite(entry?.distanceKm) : (finite(entry?.distanceKm) ?? finite(checkpoint?.distanceMedianKm));\n  const windMs = agencySpecific ? finite(entry?.maximumWindMs) : (finite(entry?.maximumWindMs) ?? finite(checkpoint?.windMedianMs));\n  const timeRelevance = clamp(finite(checkpoint?.timeRelevance) ?? softTime(finite(checkpoint?.leadHours)));\n  const rapid = clamp(agencySpecific ? (finite(entry?.rapidEvolutionIndex) ?? 0) : (finite(entry?.rapidEvolutionIndex) ?? finite(checkpoint?.rapidEvolutionIndex) ?? 0));\n  const approachRateKmh = agencySpecific ? finite(entry?.approachRateKmh) : (finite(entry?.approachRateKmh) ?? finite(checkpoint?.approachRateKmh));"""
if text.count(old) != 1:
    raise SystemExit('followup12 live diagnostic agency anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

# Direct regression: a missing HKO wind value must not borrow the CMA/CWA checkpoint
# median when per-agency support is counted. Test T1/T3/T8 separately because their
# physical thresholds differ.
path = Path('tests/hk-agency-evidence-independence.test.cjs')
path.write_text(r'''const assert = require('node:assert/strict');
const basic = require('../analysis/basic-hk-signal-forecast.js');

const BASE = '2026-08-21T12:00:00.000Z';
const FUTURE = '2026-08-22T12:00:00.000Z';

function buildForecast({ distanceKm, windMs, currentDistanceKm = 1000 }) {
  const threatAssessment = {
    schemaVersion: 'agency-independence-test/v1',
    available: true,
    summary: {
      currentDistanceKm,
      forecastMinimumKm: distanceKm,
      forecastMinimumLeadHours: 24,
      representativeMinimum: { distanceKm, time: FUTURE, source: 'test-consensus' },
      overallThreatIndex: 0.25,
      confidenceIndex: 0.75
    },
    analyzers: {
      directApproach: { confidence: 0.2 },
      directDepart: { confidence: 0.1 },
      reApproach: { confidence: 0.2 },
      quasiStationary: { confidence: 0 },
      forecastEdge: { confidence: 0 },
      agencyDisagreement: { confidence: 0.2 },
      windField: { confidence: 0, representativeWindMs: windMs },
      rapidEvolution: { confidence: 0 }
    },
    timeline: [
      {
        label: '+0h', validTime: BASE, leadHours: 0, timeRelevance: 1,
        distanceMedianKm: currentDistanceKm, windMedianMs: 15,
        rapidEvolutionIndex: 0, approachRateKmh: 0,
        agencies: [
          { agency: 'HKO', distanceKm: currentDistanceKm, maximumWindMs: 15, approachRateKmh: 0, rapidEvolutionIndex: 0 },
          { agency: 'CMA', distanceKm: currentDistanceKm, maximumWindMs: 15, approachRateKmh: 0, rapidEvolutionIndex: 0 },
          { agency: 'CWA', distanceKm: currentDistanceKm, maximumWindMs: 15, approachRateKmh: 0, rapidEvolutionIndex: 0 }
        ]
      },
      {
        label: '+24h', validTime: FUTURE, leadHours: 24, timeRelevance: 0.75,
        distanceMedianKm: distanceKm, windMedianMs: windMs,
        rapidEvolutionIndex: 0, approachRateKmh: 4,
        agencies: [
          { agency: 'HKO', distanceKm, maximumWindMs: null, approachRateKmh: null, rapidEvolutionIndex: 0 },
          { agency: 'CMA', distanceKm, maximumWindMs: windMs, approachRateKmh: 4, rapidEvolutionIndex: 0 },
          { agency: 'CWA', distanceKm, maximumWindMs: windMs, approachRateKmh: 4, rapidEvolutionIndex: 0 }
        ]
      }
    ]
  };

  return basic.buildBasicHkSignalForecast({
    generatedAt: BASE,
    impact: {
      generatedAt: BASE,
      closestApproach: { consensus: { distanceKm, time: FUTURE } },
      uncertainty: { level: 'moderate' },
      distanceBands: {}
    },
    weightedImpact: null,
    signalInputs: {
      generatedAt: BASE,
      coverage: { usableAgencyCount: 3 },
      agencies: {},
      featureVector: {
        usableAgencyCount: 3,
        currentDistanceMedianKm: currentDistanceKm,
        currentMaximumWindMedianMs: 15,
        closestMaximumWindMedianMs: windMs,
        windRadiusAgencyCount: 0,
        latestWindFieldCoverageAgencyCount: 0,
        closestTimeWindFieldCoverageAgencyCount: 0,
        latestStrongWindFieldCoverageAgencyCount: 0,
        closestTimeStrongWindFieldCoverageAgencyCount: 0,
        latestGaleWindFieldCoverageAgencyCount: 0,
        closestTimeGaleWindFieldCoverageAgencyCount: 0,
        unknownThresholdWindFieldCoverageAgencyCount: 0
      }
    },
    threatAssessment
  });
}

const t1 = buildForecast({ distanceKm: 650, windMs: 25 });
assert.equal(t1.signals.T1.strongestCheckpoint.supportAgencyCount, 2, 'T1 must not borrow CMA/CWA wind/motion for HKO');

const t3 = buildForecast({ distanceKm: 400, windMs: 25 });
assert.equal(t3.signals.T3.strongestCheckpoint.supportAgencyCount, 2, 'T3 must not borrow CMA/CWA wind for HKO');

const t8 = buildForecast({ distanceKm: 250, windMs: 30 });
assert.equal(t8.signals.T8.strongestCheckpoint.supportAgencyCount, 2, 'T8 must not borrow CMA/CWA wind for HKO');

assert.equal(t1.semantics.perAgencyEvidenceUsesOnlyAgencyData, true);
console.log('HK agency evidence independence: OK');
''', encoding='utf-8')

# Include the regression in the canonical full test chain after followup11 has added
# the missing-numeric semantics test.
path = Path('workers/storm-analysis/package.json')
text = path.read_text(encoding='utf-8')
old = "node ../../tests/hk-missing-numeric-semantics.test.cjs && node ../../tests/basic-hk-signal-forecast.test.cjs"
new = "node ../../tests/hk-missing-numeric-semantics.test.cjs && node ../../tests/hk-agency-evidence-independence.test.cjs && node ../../tests/basic-hk-signal-forecast.test.cjs"
if text.count(old) != 1:
    raise SystemExit('followup12 package test anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
