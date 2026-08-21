from pathlib import Path
import re


def sub_once(text, pattern, replacement, label, flags=0):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 replacement, got {count}')
    return updated

# 1) Physical HK impact: current proximity and a minimum occurring "now" are correlated
# evidence. Use separate current/future channels and let departure suppress current threat.
path = Path('analysis/hk-threat-assessment.js')
text = path.read_text(encoding='utf-8')
old = """    const currentProximityIndex = smoothCloser(currentDistanceKm, 800);\n    const futureProximityIndex = smoothCloser(forecastMinimumKm, 650) * softTimeRelevance(forecastMinimumLeadHours);\n    const trajectoryConfidence = clamp(Math.max(\n      directApproachConfidence,\n      reApproachConfidence * 0.85,\n      quasiStationaryConfidence * 0.35\n    ));\n    const rapidEvolutionConfidence = clamp(finite(fastestEvolution?.scenarioRapidEvolutionIndex) ?? 0);\n    const overallThreatIndex = clamp(\n      currentProximityIndex * 0.24\n      + futureProximityIndex * 0.32\n      + trajectoryConfidence * 0.22\n      + windFieldConfidence * 0.10\n      + rapidEvolutionConfidence * 0.12\n    );"""
new = """    const currentProximityIndex = smoothCloser(currentDistanceKm, 800);\n    const positiveMinimumLead = Math.max(0, forecastMinimumLeadHours ?? 0);\n    const futureNovelty = 1 - Math.exp(-positiveMinimumLead / 8);\n    const futureProximityIndex = positiveMinimumLead > 0\n      ? smoothCloser(forecastMinimumKm, 650) * softTimeRelevance(forecastMinimumLeadHours) * futureNovelty\n      : 0;\n    const trajectoryConfidence = clamp(Math.max(\n      directApproachConfidence,\n      reApproachConfidence * 0.85,\n      quasiStationaryConfidence * 0.35\n    ));\n    const currentMotionThreat = clamp(\n      0.22 + directApproachConfidence * 0.65 + reApproachConfidence * 0.20\n      + quasiStationaryConfidence * 0.15 - directDepartConfidence * 0.42\n    );\n    const rapidEvolutionConfidence = clamp(finite(fastestEvolution?.scenarioRapidEvolutionIndex) ?? 0);\n    const currentThreatChannel = clamp(currentProximityIndex * (0.16 + currentMotionThreat * 0.56));\n    const futureThreatChannel = clamp(futureProximityIndex * (0.18 + trajectoryConfidence * 0.70));\n    const windFieldThreatChannel = clamp(windFieldConfidence * 0.75);\n    const rapidThreatChannel = clamp(rapidEvolutionConfidence * Math.max(currentProximityIndex, futureProximityIndex, 0.20) * 0.55);\n    const overallThreatIndex = clamp(Math.max(\n      currentThreatChannel,\n      futureThreatChannel,\n      windFieldThreatChannel,\n      rapidThreatChannel\n    ));"""
if text.count(old) != 1:
    raise SystemExit('followup4 impact-channel anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

# 2) Wind-field evidence freshness. Keep raw official geometry, but expose how far its
# valid time is from the current/closest target and use a soft exponential relevance.
path = Path('analysis/hko-signal-risk-inputs.js')
text = path.read_text(encoding='utf-8')

marker = "    const HKO_STRONG_WIND_MS = 41 / 3.6;"
insert = "    const WIND_FIELD_FRESHNESS_SCALE_HOURS = 12;\n"
if text.count(marker) != 1:
    raise SystemExit('followup4 wind freshness constant anchor mismatch')
text = text.replace(marker, insert + marker, 1)

# Build explicit evidence objects/timeline before returning an agency input.
old = """        const bearingFromHongKong = current\n            ? initialBearingDegrees(referencePoint.lat, referencePoint.lon, current.lat, current.lon)\n            : null;\n\n        return {"""
new = """        const bearingFromHongKong = current\n            ? initialBearingDegrees(referencePoint.lat, referencePoint.lon, current.lat, current.lon)\n            : null;\n        const currentTimeMs = parseTimeMs(current?.time);\n        const latestWindEvidence = windFieldEvidence(latestWindPoint, referencePoint);\n        const closestWindEvidence = windFieldEvidence(closestWindPoint, referencePoint);\n        const evidenceAgeHours = (evidence, targetMs) => {\n            const evidenceMs = parseTimeMs(evidence?.time);\n            return Number.isFinite(evidenceMs) && Number.isFinite(targetMs)\n                ? Math.abs(evidenceMs - targetMs) / HOUR_MS : null;\n        };\n        const evidenceFreshness = ageHours => Number.isFinite(ageHours)\n            ? Math.exp(-Math.max(0, ageHours) / WIND_FIELD_FRESHNESS_SCALE_HOURS) : 0;\n        const latestEvidenceAgeHours = evidenceAgeHours(latestWindEvidence, currentTimeMs);\n        const closestEvidenceAgeHours = evidenceAgeHours(closestWindEvidence, closestTimeMs);\n        if (latestWindEvidence) {\n            latestWindEvidence.targetOffsetHours = latestEvidenceAgeHours;\n            latestWindEvidence.freshness = evidenceFreshness(latestEvidenceAgeHours);\n        }\n        if (closestWindEvidence) {\n            closestWindEvidence.targetOffsetHours = closestEvidenceAgeHours;\n            closestWindEvidence.freshness = evidenceFreshness(closestEvidenceAgeHours);\n        }\n        const windFieldTimelineEvidence = windCandidates\n            .map(point => windFieldEvidence(point, referencePoint))\n            .filter(Boolean);\n\n        return {"""
if text.count(old) != 1:
    raise SystemExit('followup4 agency evidence precompute anchor mismatch')
text = text.replace(old, new, 1)

old = """            windField: {\n                latestEvidence: windFieldEvidence(latestWindPoint, referencePoint),\n                closestTimeEvidence: windFieldEvidence(closestWindPoint, referencePoint),\n                radiusPointCount: windCandidates.length\n            },"""
new = """            windField: {\n                latestEvidence: latestWindEvidence,\n                closestTimeEvidence: closestWindEvidence,\n                timelineEvidence: windFieldTimelineEvidence,\n                radiusPointCount: windCandidates.length\n            },"""
if text.count(old) != 1:
    raise SystemExit('followup4 agency wind-field output anchor mismatch')
text = text.replace(old, new, 1)

# Add effective, freshness-weighted agency counts alongside raw counts.
old = """        const unknownThresholdCoverageAgencies = usable.filter(item =>\n            item.windField.latestEvidence?.unknownThresholdCoverage || item.windField.closestTimeEvidence?.unknownThresholdCoverage);"""
new = """        const unknownThresholdCoverageAgencies = usable.filter(item =>\n            item.windField.latestEvidence?.unknownThresholdCoverage || item.windField.closestTimeEvidence?.unknownThresholdCoverage);\n        const effectiveCoverageCount = (items, evidenceKey, coverageKey) => items.reduce((sum, item) => {\n            const evidence = item.windField?.[evidenceKey];\n            if (!evidence?.[coverageKey]) return sum;\n            return sum + (finiteNumber(evidence.freshness) ?? 0);\n        }, 0);\n        const latestStrongWindCoverageEffectiveCount = effectiveCoverageCount(usable, 'latestEvidence', 'strongWindCoverage');\n        const closestStrongWindCoverageEffectiveCount = effectiveCoverageCount(usable, 'closestTimeEvidence', 'strongWindCoverage');\n        const latestGaleCoverageEffectiveCount = effectiveCoverageCount(usable, 'latestEvidence', 'galeCoverage');\n        const closestGaleCoverageEffectiveCount = effectiveCoverageCount(usable, 'closestTimeEvidence', 'galeCoverage');\n        const latestEvidenceAges = usable.map(item => finiteNumber(item.windField.latestEvidence?.targetOffsetHours)).filter(Number.isFinite);\n        const closestEvidenceAges = usable.map(item => finiteNumber(item.windField.closestTimeEvidence?.targetOffsetHours)).filter(Number.isFinite);"""
if text.count(old) != 1:
    raise SystemExit('followup4 effective coverage declaration anchor mismatch')
text = text.replace(old, new, 1)

old = """                unknownThresholdWindFieldCoverageAgencyCount: unknownThresholdCoverageAgencies.length"""
new = """                unknownThresholdWindFieldCoverageAgencyCount: unknownThresholdCoverageAgencies.length,\n                latestStrongWindFieldCoverageEffectiveAgencyCount: latestStrongWindCoverageEffectiveCount,\n                closestTimeStrongWindFieldCoverageEffectiveAgencyCount: closestStrongWindCoverageEffectiveCount,\n                latestGaleWindFieldCoverageEffectiveAgencyCount: latestGaleCoverageEffectiveCount,\n                closestTimeGaleWindFieldCoverageEffectiveAgencyCount: closestGaleCoverageEffectiveCount,\n                latestWindFieldEvidenceAgeMedianHours: median(latestEvidenceAges),\n                closestTimeWindFieldEvidenceAgeMedianHours: median(closestEvidenceAges),\n                windFieldTimelinePointCount: usable.reduce((sum, item) => sum + (item.windField.timelineEvidence?.length ?? 0), 0)"""
if text.count(old) != 1:
    raise SystemExit('followup4 effective coverage feature anchor mismatch')
text = text.replace(old, new, 1)

old = """        HKO_STRONG_WIND_MS,\n        HKO_GALE_WIND_MS,"""
new = """        HKO_STRONG_WIND_MS,\n        HKO_GALE_WIND_MS,\n        WIND_FIELD_FRESHNESS_SCALE_HOURS,"""
if text.count(old) != 1:
    raise SystemExit('followup4 freshness export anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

# 3) Prefer freshness-weighted coverage in signal forecasting when available.
path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')
old = """    const latestStrongWindCoverage = coverageFraction(signalInputs?.featureVector?.latestStrongWindFieldCoverageAgencyCount);\n    const closestStrongWindCoverage = coverageFraction(signalInputs?.featureVector?.closestTimeStrongWindFieldCoverageAgencyCount);\n    const latestGaleCoverage = coverageFraction(signalInputs?.featureVector?.latestGaleWindFieldCoverageAgencyCount);\n    const closestGaleCoverage = coverageFraction(signalInputs?.featureVector?.closestTimeGaleWindFieldCoverageAgencyCount);"""
new = """    const latestStrongWindCoverage = coverageFraction(\n      finite(signalInputs?.featureVector?.latestStrongWindFieldCoverageEffectiveAgencyCount)\n        ?? signalInputs?.featureVector?.latestStrongWindFieldCoverageAgencyCount);\n    const closestStrongWindCoverage = coverageFraction(\n      finite(signalInputs?.featureVector?.closestTimeStrongWindFieldCoverageEffectiveAgencyCount)\n        ?? signalInputs?.featureVector?.closestTimeStrongWindFieldCoverageAgencyCount);\n    const latestGaleCoverage = coverageFraction(\n      finite(signalInputs?.featureVector?.latestGaleWindFieldCoverageEffectiveAgencyCount)\n        ?? signalInputs?.featureVector?.latestGaleWindFieldCoverageAgencyCount);\n    const closestGaleCoverage = coverageFraction(\n      finite(signalInputs?.featureVector?.closestTimeGaleWindFieldCoverageEffectiveAgencyCount)\n        ?? signalInputs?.featureVector?.closestTimeGaleWindFieldCoverageAgencyCount);"""
if text.count(old) != 1:
    raise SystemExit('followup4 basic freshness coverage anchor mismatch')
text = text.replace(old, new, 1)

# Expose freshness in the audit trail.
old = """      `wind-radius-data:${windRadiusDataFraction.toFixed(3)}`"""
new = """      `wind-radius-data:${windRadiusDataFraction.toFixed(3)}`,\n      Number.isFinite(finite(signalInputs?.featureVector?.latestWindFieldEvidenceAgeMedianHours))\n        ? `wind-field-latest-age:${finite(signalInputs.featureVector.latestWindFieldEvidenceAgeMedianHours).toFixed(1)}h` : 'wind-field-latest-age:unavailable',\n      Number.isFinite(finite(signalInputs?.featureVector?.closestTimeWindFieldEvidenceAgeMedianHours))\n        ? `wind-field-closest-age:${finite(signalInputs.featureVector.closestTimeWindFieldEvidenceAgeMedianHours).toFixed(1)}h` : 'wind-field-closest-age:unavailable'"""
if text.count(old) != 1:
    raise SystemExit('followup4 basis freshness anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

# 4) Regressions: weak close/departing should also have low overall HK impact; stale
# radius evidence must carry an age and lose most of its effective weight.
path = Path('tests/hk-threat-rule-scenarios.test.cjs')
text = path.read_text(encoding='utf-8')
old = """  assert.equal(result.forecast.signals.T1.likelihood, 'unlikely');\n  assert.equal(result.forecast.signals.T1.estimatedWindow, null);"""
new = """  assert.equal(result.forecast.impact.likelihood, 'unlikely');\n  assert.equal(result.forecast.signals.T1.likelihood, 'unlikely');\n  assert.equal(result.forecast.signals.T1.estimatedWindow, null);"""
if text.count(old) != 1:
    raise SystemExit('followup4 weak-impact assertion anchor mismatch')
text = text.replace(old, new, 1)

anchor = "console.log('HK threat rule scenarios: OK');"
extra = r'''
// A radius observed long before the current analysis must remain visible as raw evidence
// but must not keep full weight indefinitely.
{
  const oldRadii = [{ level: '7', ne: 900, se: 900, sw: 900, nw: 900 }];
  const stale = source(
    [
      point('2026-08-20T12:00:00Z', 20.0, 110.0, 20, { kind: 'analysis', windRadii: oldRadii }),
      point(BASE, 20.5, 112.0, 20, { kind: 'analysis' })
    ],
    [
      point('2026-08-22T12:00:00Z', 21.0, 113.0, 21),
      point('2026-08-24T12:00:00Z', 21.5, 114.0, 22)
    ]
  );
  const result = run({ CMA: stale, HKO: null, JMA: null, CWA: null });
  const evidence = result.signalInputs.agencies.CMA.windField.latestEvidence;
  assert.ok(evidence.targetOffsetHours >= 23.9);
  assert.ok(evidence.freshness < 0.15);
  assert.equal(result.signalInputs.agencies.CMA.windField.timelineEvidence.length, 1);
  assert.ok(result.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount >= 1);
  assert.ok(result.signalInputs.featureVector.latestStrongWindFieldCoverageEffectiveAgencyCount < 0.15);
}

'''
if text.count(anchor) != 1:
    raise SystemExit('followup4 final scenario anchor mismatch')
text = text.replace(anchor, extra + anchor, 1)
path.write_text(text, encoding='utf-8')
