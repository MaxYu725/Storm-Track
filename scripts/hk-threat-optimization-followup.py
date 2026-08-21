from pathlib import Path
import re


def sub_once(text, pattern, replacement, label, flags=0):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 replacement, got {count}')
    return updated

# Fix compact wind-unit parsing (e.g. 34kt, not only "34 kt").
path = Path('analysis/hko-signal-risk-inputs.js')
text = path.read_text(encoding='utf-8')
text, count = re.subn(r"if \(/\\bkt\\b\|kts\|knot\|節/\.test\(text\)\)", "if (/(?:kt|kts|knot|knots|節)/.test(text))", text, count=1)
if count != 1:
    raise SystemExit(f'wind threshold compact-kt parser: expected 1 replacement, got {count}')
path.write_text(text, encoding='utf-8')

# Refine per-checkpoint physical evidence: T1 must care about approach/departure;
# T3/T8 proximity amplifies wind capability rather than manufacturing it.
path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')
text = sub_once(
    text,
    r"  function pointSignalEvidence\(entry, checkpoint, signal\) \{.*?\n  \}\n\n  function checkpointEvidence",
    r'''  function pointSignalEvidence(entry, checkpoint, signal) {
    const distanceKm = finite(entry?.distanceKm) ?? finite(checkpoint?.distanceMedianKm);
    const windMs = finite(entry?.maximumWindMs) ?? finite(checkpoint?.windMedianMs);
    const timeRelevance = clamp(finite(checkpoint?.timeRelevance) ?? softTimeRelevance(finite(checkpoint?.leadHours)));
    const rapid = clamp(finite(entry?.rapidEvolutionIndex) ?? finite(checkpoint?.rapidEvolutionIndex) ?? 0);
    const approachRateKmh = finite(entry?.approachRateKmh) ?? finite(checkpoint?.approachRateKmh);
    let physical;
    if (signal === 'T1') {
      const proximity = smoothCloser(distanceKm, 800);
      const motionPotential = Number.isFinite(approachRateKmh) ? clamp((approachRateKmh + 8) / 24) : 0.45;
      const intensityPotential = Number.isFinite(windMs) ? clamp((windMs - 8) / 22) : 0.35;
      physical = proximity * (0.28 + 0.52 * motionPotential) + intensityPotential * 0.08 + rapid * 0.12;
    } else if (signal === 'T3') {
      const proximity = smoothCloser(distanceKm, 500);
      const windCapability = Number.isFinite(windMs) ? clamp((windMs - 9) / 8.5) : 0.40;
      physical = proximity * (0.15 + 0.55 * windCapability) + rapid * proximity * 0.10;
    } else {
      const proximity = smoothCloser(distanceKm, 300);
      const windCapability = Number.isFinite(windMs) ? clamp((windMs - 15) / 10) : 0.35;
      physical = proximity * (0.12 + 0.58 * windCapability) + rapid * proximity * 0.10;
    }
    return clamp(physical * (0.62 + 0.38 * timeRelevance));
  }

  function checkpointEvidence''',
    'basic pointSignalEvidence',
    re.S
)

# Persistence must be one contiguous interval, not high-low-high segments added together.
text = sub_once(
    text,
    r"  function segmentDurationAbove\(left, right, threshold\) \{.*?\n  \}\n\n  function maximumPersistentDuration\(entries, threshold\) \{.*?\n  \}\n",
    r'''  function segmentIntervalAbove(left, right, threshold) {
    const leftLead = finite(left?.checkpoint?.leadHours);
    const rightLead = finite(right?.checkpoint?.leadHours);
    const a = finite(left?.evidence);
    const b = finite(right?.evidence);
    if (!Number.isFinite(leftLead) || !Number.isFinite(rightLead) || !(rightLead > leftLead) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a >= threshold && b >= threshold) return { start: leftLead, end: rightLead };
    if (a < threshold && b < threshold) return null;
    const delta = b - a;
    if (Math.abs(delta) < 1e-12) return null;
    const crossing = leftLead + ((threshold - a) / delta) * (rightLead - leftLead);
    return a >= threshold
      ? { start: leftLead, end: crossing }
      : { start: crossing, end: rightLead };
  }

  function maximumPersistentDuration(entries, threshold) {
    const intervals = [];
    for (let index = 1; index < entries.length; index += 1) {
      const interval = segmentIntervalAbove(entries[index - 1], entries[index], threshold);
      if (interval && interval.end > interval.start) intervals.push(interval);
    }
    if (!intervals.length) return 0;
    const merged = [{ ...intervals[0] }];
    for (let index = 1; index < intervals.length; index += 1) {
      const interval = intervals[index];
      const current = merged[merged.length - 1];
      if (interval.start <= current.end + 1e-9) current.end = Math.max(current.end, interval.end);
      else merged.push({ ...interval });
    }
    return merged.reduce((best, interval) => Math.max(best, interval.end - interval.start), 0);
  }
''',
    'basic contiguous persistence',
    re.S
)

# A first available future point already above threshold is not proof of a crossing.
text = text.replace("      if (index === 0) return finite(item.checkpoint?.leadHours) > 0;", "      if (index === 0) return false;", 1)

# Preserve raw evidence for 'possible'; use sustained evidence for escalation to 'likely'.
old = """    const maxEvidence = clamp(strongest.evidence * persistenceMultiplier);"""
new = """    const rawMaxEvidence = strongest.evidence;\n    const sustainedEvidence = clamp(rawMaxEvidence * persistenceMultiplier);\n    const maxEvidence = rawMaxEvidence;"""
if text.count(old) != 1:
    raise SystemExit('basic persistence evidence anchor mismatch')
text = text.replace(old, new, 1)
old = """      rawMaxEvidence: strongest.evidence,\n      strongest,"""
new = """      rawMaxEvidence,\n      sustainedEvidence,\n      strongest,"""
if text.count(old) != 1:
    raise SystemExit('basic timeline return anchor mismatch')
text = text.replace(old, new, 1)

# Avoid double-counting a minimum that is at/past the current reference time.
text = text.replace(
    "    const futureT1Proximity = smoothCloser(minimumDistanceKm, 650) * timeRelevance;",
    "    const futureT1Proximity = minimumLeadHours > 0 ? smoothCloser(minimumDistanceKm, 650) * timeRelevance : 0;",
    1
)
text = text.replace(
    "    const futureT3Proximity = smoothCloser(minimumDistanceKm, 450) * timeRelevance;",
    "    const futureT3Proximity = minimumLeadHours > 0 ? smoothCloser(minimumDistanceKm, 450) * timeRelevance : 0;",
    1
)
text = text.replace(
    "    const futureT8Proximity = smoothCloser(minimumDistanceKm, 280) * timeRelevance;",
    "    const futureT8Proximity = minimumLeadHours > 0 ? smoothCloser(minimumDistanceKm, 280) * timeRelevance : 0;",
    1
)

# Use departure/trajectory to stop current T1 proximity from becoming an automatic warning trigger.
old = """    const directApproach = clamp(finite(analyzers.directApproach?.confidence) ?? 0);\n    const reApproach = clamp(finite(analyzers.reApproach?.confidence) ?? 0);"""
new = """    const directApproach = clamp(finite(analyzers.directApproach?.confidence) ?? 0);\n    const directDepart = clamp(finite(analyzers.directDepart?.confidence) ?? 0);\n    const reApproach = clamp(finite(analyzers.reApproach?.confidence) ?? 0);"""
if text.count(old) != 1:
    raise SystemExit('basic direct-depart anchor mismatch')
text = text.replace(old, new, 1)

old = """    const staticT1Risk = clamp(\n      currentT1Proximity * 0.18\n      + futureT1Proximity * 0.45\n      + trajectory * 0.22\n      + rapidEvolution * 0.05\n      + windFieldConfidence * 0.10\n    );\n    const t1RiskIndex = clamp(Math.max(staticT1Risk, t1Timeline.maxEvidence));"""
new = """    const currentT1Motion = clamp(0.35 + directApproach * 0.65 - directDepart * 0.45 + reApproach * 0.25);\n    const currentT1Risk = currentT1Proximity * (0.30 + currentT1Motion * 0.48);\n    const futureT1Risk = futureT1Proximity * (0.35 + trajectory * 0.65);\n    const staticT1Risk = clamp(Math.max(currentT1Risk, futureT1Risk)\n      + rapidEvolution * 0.05\n      + windFieldConfidence * 0.04);\n    const t1RiskIndex = clamp(Math.max(staticT1Risk, t1Timeline.rawMaxEvidence));"""
if text.count(old) != 1:
    raise SystemExit('basic T1 channel anchor mismatch')
text = text.replace(old, new, 1)

# Likely must use sustained timeline evidence; possible can use raw scenario evidence.
old = """    const t1Likelihood = likelihoodFromIndex(t1RiskIndex, 0.58, 0.35);\n    const t3Likelihood = likelihoodFromIndex(t3RiskIndex, 0.65, 0.38);\n    const t8Likelihood = likelihoodFromIndex(t8RiskIndex, 0.70, 0.40);"""
new = """    const t1LikelyIndex = t1RiskIndex;\n    const t3LikelyIndex = clamp(Math.max(staticT3Risk * 0.88, t3Timeline.sustainedEvidence ?? 0));\n    const t8LikelyIndex = clamp(Math.max(staticT8Risk * 0.86, t8Timeline.sustainedEvidence ?? 0));\n    const t1Likelihood = likelihoodFromIndex(t1RiskIndex, 0.58, 0.35);\n    const t3Likelihood = t3RiskIndex < 0.38 ? 'unlikely' : (t3LikelyIndex >= 0.65 ? 'likely' : 'possible');\n    const t8Likelihood = t8RiskIndex < 0.40 ? 'unlikely' : (t8LikelyIndex >= 0.70 ? 'likely' : 'possible');"""
if text.count(old) != 1:
    raise SystemExit('basic likelihood anchor mismatch')
text = text.replace(old, new, 1)

# Make the diagnostics explicit.
text = text.replace("      `direct-approach:${directApproach.toFixed(3)}`,", "      `direct-approach:${directApproach.toFixed(3)}`,\n      `direct-depart:${directDepart.toFixed(3)}`,", 1)
text = text.replace("`timeline-persistence:${t3Timeline.persistenceHours.toFixed(1)}h`, `t3-risk-index:${t3RiskIndex.toFixed(3)}`", "`timeline-persistence:${t3Timeline.persistenceHours.toFixed(1)}h`, `t3-likely-index:${t3LikelyIndex.toFixed(3)}`, `t3-risk-index:${t3RiskIndex.toFixed(3)}`", 1)
text = text.replace("`timeline-persistence:${t8Timeline.persistenceHours.toFixed(1)}h`, `t8-risk-index:${t8RiskIndex.toFixed(3)}`", "`timeline-persistence:${t8Timeline.persistenceHours.toFixed(1)}h`, `t8-likely-index:${t8LikelyIndex.toFixed(3)}`, `t8-risk-index:${t8RiskIndex.toFixed(3)}`", 1)
path.write_text(text, encoding='utf-8')

# Upgrade the old severe fixture: if it expects T8 likely, explicitly provide
# multi-agency gale-radius evidence instead of a generic wind-field number.
path = Path('tests/basic-hk-signal-forecast.test.cjs')
text = path.read_text(encoding='utf-8')
old = "function signalInputs({ windMs = 30, coverage = 1, agencies = 4, currentDistanceKm = null } = {}) {"
new = "function signalInputs({ windMs = 30, coverage = 1, agencies = 4, currentDistanceKm = null, strongCoverage = 0, galeCoverage = 0, windRadiusAgencies = 0 } = {}) {"
if text.count(old) != 1:
    raise SystemExit('basic-test signalInputs signature anchor mismatch')
text = text.replace(old, new, 1)
old = """      closestTimeWindFieldCoverageAgencyCount: coverage\n    }"""
new = """      closestTimeWindFieldCoverageAgencyCount: coverage,\n      windRadiusAgencyCount: windRadiusAgencies,\n      latestStrongWindFieldCoverageAgencyCount: strongCoverage,\n      closestTimeStrongWindFieldCoverageAgencyCount: strongCoverage,\n      latestGaleWindFieldCoverageAgencyCount: galeCoverage,\n      closestTimeGaleWindFieldCoverageAgencyCount: galeCoverage,\n      unknownThresholdWindFieldCoverageAgencyCount: 0\n    }"""
if text.count(old) != 1:
    raise SystemExit('basic-test feature vector anchor mismatch')
text = text.replace(old, new, 1)
old = "signalInputs({ windMs: 40, coverage: 3, currentDistanceKm: 300 })"
new = "signalInputs({ windMs: 40, coverage: 3, agencies: 3, currentDistanceKm: 300, strongCoverage: 3, galeCoverage: 3, windRadiusAgencies: 3 })"
if text.count(old) != 1:
    raise SystemExit('basic-test severe fixture anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

# Extend rule scenarios with cases specifically designed to catch false positives.
path = Path('tests/hk-threat-rule-scenarios.test.cjs')
text = path.read_text(encoding='utf-8')
anchor = "console.log('HK threat rule scenarios: OK');"
if text.count(anchor) != 1:
    raise SystemExit('rule-scenarios final anchor mismatch')
extra = r'''
// A weak cyclone can be very close yet clearly departing; proximity alone must not manufacture T1/T3/T8.
{
  const departing = () => source(
    [point(BASE, 22.0, 115.6, 8, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 22.0, 117.5, 8),
      point('2026-08-22T00:00:00Z', 22.0, 119.5, 8),
      point('2026-08-22T06:00:00Z', 22.0, 121.5, 8)
    ]
  );
  const result = run({ HKO: departing(), CMA: departing(), CWA: departing(), JMA: null });
  assert.equal(result.forecast.signals.T1.likelihood, 'unlikely');
  assert.equal(result.forecast.signals.T3.likelihood, 'unlikely');
  assert.equal(result.forecast.signals.T8.likelihood, 'unlikely');
}

// High-low-high threat is two separate episodes, not one continuous warning-level period.
{
  const separated = () => source(
    [point(BASE, 21.7, 115.0, 30, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 19.0, 122.0, 18),
      point('2026-08-22T00:00:00Z', 21.7, 115.0, 30)
    ]
  );
  const result = run({ HKO: separated(), CMA: separated(), CWA: separated(), JMA: null });
  assert.equal(result.forecast.signals.T3.likelihood, 'possible');
  assert.ok(result.forecast.signals.T3.persistenceHours < 6);
}

// Wind-radius threshold parser must accept compact knot notation.
{
  assert.ok(Math.abs(signalEngine.parseWindRadiusThresholdMs('34kt') - 34 * 0.514444) < 1e-6);
  assert.ok(Math.abs(signalEngine.parseWindRadiusThresholdMs('34 kt') - 34 * 0.514444) < 1e-6);
}

'''
text = text.replace(anchor, extra + anchor, 1)
path.write_text(text, encoding='utf-8')
