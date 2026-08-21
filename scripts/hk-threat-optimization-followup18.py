from pathlib import Path
import re


def sub_once(text, pattern, replacement, label, flags=0):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 replacement, got {count}')
    return updated

path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')

# Keep raw physical evidence untouched for possible/riskIndex. Build a parallel
# reliability-aware aggregate used only when deciding whether evidence is credible
# enough to escalate to "likely". Exact / legacy entries default to reliability 1.
text = sub_once(
    text,
    r"  function checkpointEvidence\(checkpoint, signal\) \{.*?\n  \}\n\n  function segmentIntervalAbove",
    r'''  function checkpointEvidence(checkpoint, signal) {
    const agencies = Array.isArray(checkpoint?.agencies) ? checkpoint.agencies : [];
    const perAgency = agencies.map(entry => ({
      agency: entry.agency,
      evidence: pointSignalEvidence(entry, checkpoint, signal),
      reliability: clamp(finite(entry?.interpolationReliability) ?? 1),
      exactOfficialTime: entry?.exactOfficialTime === true
    }));
    if (!perAgency.length) {
      const fallback = pointSignalEvidence({}, checkpoint, signal);
      return {
        aggregate: fallback,
        credibleAggregate: fallback,
        consensus: fallback,
        credibleConsensus: fallback,
        scenarioMax: fallback,
        supportAgencyCount: 0,
        effectiveSupportWeight: 0,
        effectiveSupportFraction: 0,
        meanReliability: 1,
        totalAgencyCount: 0,
        perAgency: []
      };
    }
    const values = perAgency.map(item => item.evidence).filter(Number.isFinite);
    const consensus = median(values) ?? 0;
    const scenarioMax = values.length ? Math.max(...values) : 0;
    const threshold = signalThresholds(signal).possible;
    const supporting = perAgency.filter(item => item.evidence >= threshold);
    const supportAgencyCount = supporting.length;
    const totalAgencyCount = perAgency.length;
    const supportFraction = totalAgencyCount > 0 ? supportAgencyCount / totalAgencyCount : 0;
    const effectiveSupportWeight = supporting.reduce((sum, item) => sum + item.reliability, 0);
    const effectiveSupportFraction = totalAgencyCount > 0 ? effectiveSupportWeight / totalAgencyCount : 0;
    const meanReliability = totalAgencyCount > 0
      ? perAgency.reduce((sum, item) => sum + item.reliability, 0) / totalAgencyCount
      : 1;
    const coverageCredibility = totalAgencyCount >= 3 ? 1 : (totalAgencyCount === 2 ? 0.82 : 0.60);
    const scenarioCredibility = coverageCredibility * (0.35 + 0.65 * supportFraction);
    const credibleScenarioCredibility = coverageCredibility * (0.35 + 0.65 * effectiveSupportFraction);
    const aggregate = clamp(Math.max(consensus, scenarioMax * scenarioCredibility));
    const credibleConsensus = clamp(consensus * meanReliability);
    const credibleAggregate = clamp(Math.max(credibleConsensus, scenarioMax * credibleScenarioCredibility));
    return {
      aggregate,
      credibleAggregate,
      consensus,
      credibleConsensus,
      scenarioMax,
      supportAgencyCount,
      effectiveSupportWeight,
      effectiveSupportFraction,
      meanReliability,
      totalAgencyCount,
      scenarioCredibility,
      credibleScenarioCredibility,
      perAgency
    };
  }

  function segmentIntervalAbove''',
    'followup18 checkpoint evidence',
    re.S
)

# Possible crossings and raw risk continue to use physical evidence. Likely escalation
# gets its own persistence/crossing path based on reliability-aware credible evidence.
text = sub_once(
    text,
    r"  function timelineSignalSummary\(timeline, signal\) \{.*?\n  \}\n\n  function timelineAnchor",
    r'''  function timelineSignalSummary(timeline, signal) {
    const entries = (Array.isArray(timeline) ? timeline : [])
      .filter(item => Number.isFinite(finite(item?.leadHours)) && finite(item.leadHours) >= 0)
      .map(item => {
        const details = checkpointEvidence(item, signal);
        return {
          checkpoint: item,
          evidence: details.aggregate,
          credibleEvidence: details.credibleAggregate,
          details
        };
      });
    if (!entries.length) return {
      maxEvidence: 0,
      rawMaxEvidence: 0,
      credibleMaxEvidence: 0,
      sustainedEvidence: 0,
      credibleSustainedEvidence: 0,
      strongest: null,
      strongestCredible: null,
      firstPossible: null,
      firstLikely: null,
      persistenceHours: 0,
      crediblePersistenceHours: 0
    };
    const futureEntries = entries.filter(item => (finite(item?.checkpoint?.leadHours) ?? 0) > 1e-6);
    const scoringEntries = futureEntries.length ? futureEntries : entries;
    const strongest = scoringEntries.reduce((best, item) => item.evidence > best.evidence ? item : best, scoringEntries[0]);
    const strongestCredible = scoringEntries.reduce(
      (best, item) => item.credibleEvidence > best.credibleEvidence ? item : best,
      scoringEntries[0]
    );
    const thresholds = signalThresholds(signal);
    const persistenceHours = maximumPersistentDuration(entries, thresholds.possible);
    const credibleEntries = entries.map(item => ({ ...item, evidence: item.credibleEvidence }));
    const crediblePersistenceHours = maximumPersistentDuration(credibleEntries, thresholds.possible);
    const persistenceFactor = signal === 'T1' ? 1 : 1 - Math.exp(-persistenceHours / 6);
    const crediblePersistenceFactor = signal === 'T1' ? 1 : 1 - Math.exp(-crediblePersistenceHours / 6);
    const persistenceMultiplier = signal === 'T8'
      ? 0.66 + 0.34 * persistenceFactor
      : (signal === 'T3' ? 0.70 + 0.30 * persistenceFactor : 1);
    const crediblePersistenceMultiplier = signal === 'T8'
      ? 0.66 + 0.34 * crediblePersistenceFactor
      : (signal === 'T3' ? 0.70 + 0.30 * crediblePersistenceFactor : 1);
    const rawMaxEvidence = strongest.evidence;
    const credibleMaxEvidence = strongestCredible.credibleEvidence;
    const sustainedEvidence = clamp(rawMaxEvidence * persistenceMultiplier);
    const credibleSustainedEvidence = clamp(credibleMaxEvidence * crediblePersistenceMultiplier);
    const maxEvidence = rawMaxEvidence;
    const crossing = (threshold, evidenceKey = 'evidence') => {
      for (let index = 1; index < entries.length; index += 1) {
        const previous = entries[index - 1];
        const item = entries[index];
        const previousEvidence = finite(previous?.[evidenceKey]);
        const itemEvidence = finite(item?.[evidenceKey]);
        if (!Number.isFinite(previousEvidence) || !Number.isFinite(itemEvidence)) continue;
        if (!(previousEvidence < threshold && itemEvidence >= threshold)) continue;
        const previousMs = timeMs(previous.checkpoint?.validTime ?? previous.checkpoint?.time);
        const itemMs = timeMs(item.checkpoint?.validTime ?? item.checkpoint?.time);
        const evidenceDelta = itemEvidence - previousEvidence;
        if (!Number.isFinite(previousMs) || !Number.isFinite(itemMs) || !(itemMs > previousMs) || !(evidenceDelta > 1e-12)) {
          return item;
        }
        const fraction = clamp((threshold - previousEvidence) / evidenceDelta);
        const crossingMs = previousMs + fraction * (itemMs - previousMs);
        const previousLead = finite(previous.checkpoint?.leadHours);
        const itemLead = finite(item.checkpoint?.leadHours);
        const crossingLead = Number.isFinite(previousLead) && Number.isFinite(itemLead)
          ? previousLead + fraction * (itemLead - previousLead)
          : finite(item.checkpoint?.leadHours);
        return {
          ...item,
          checkpoint: {
            ...item.checkpoint,
            validTime: iso(crossingMs),
            time: iso(crossingMs),
            leadHours: crossingLead
          },
          thresholdCrossingInterpolated: true,
          crossingFraction: fraction
        };
      }
      return null;
    };
    return {
      maxEvidence,
      rawMaxEvidence,
      credibleMaxEvidence,
      sustainedEvidence,
      credibleSustainedEvidence,
      strongest,
      strongestCredible,
      firstPossible: crossing(thresholds.possible, 'evidence'),
      firstLikely: crossing(thresholds.likely, 'credibleEvidence'),
      persistenceHours,
      crediblePersistenceHours,
      persistenceFactor,
      crediblePersistenceFactor
    };
  }

  function timelineAnchor''',
    'followup18 timeline summary',
    re.S
)

# Static track-derived escalation is also confidence-sensitive; direct verified wind-field
# intersection remains an independent likely channel and is not penalized by interpolation.
old = """    const t3LikelyIndex = clamp(Math.max(staticT3Risk * 0.88, t3Timeline.sustainedEvidence ?? 0, t3WindFieldExposure * 0.72));
    const t8LikelyIndex = clamp(Math.max(staticT8Risk * 0.86, t8Timeline.sustainedEvidence ?? 0, t8WindFieldExposure * 0.75));"""
new = """    const interpolationConfidence = clamp(finite(analyzers.interpolationReliability?.confidence) ?? 1);
    const t3LikelyIndex = clamp(Math.max(
      staticT3Risk * 0.88 * interpolationConfidence,
      t3Timeline.credibleSustainedEvidence ?? 0,
      t3WindFieldExposure * 0.72
    ));
    const t8LikelyIndex = clamp(Math.max(
      staticT8Risk * 0.86 * interpolationConfidence,
      t8Timeline.credibleSustainedEvidence ?? 0,
      t8WindFieldExposure * 0.75
    ));"""
if text.count(old) != 1:
    raise SystemExit(f'followup18 likely block anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

# Keep the audit trail explicit about why a raw scenario was or was not promoted.
text = text.replace(
    "`timeline-persistence:${t3Timeline.persistenceHours.toFixed(1)}h`, `t3-likely-index:${t3LikelyIndex.toFixed(3)}`",
    "`timeline-persistence:${t3Timeline.persistenceHours.toFixed(1)}h`, `timeline-credible-persistence:${t3Timeline.crediblePersistenceHours.toFixed(1)}h`, `interpolation-confidence:${interpolationConfidence.toFixed(3)}`, `t3-likely-index:${t3LikelyIndex.toFixed(3)}`",
    1
)
text = text.replace(
    "`timeline-persistence:${t8Timeline.persistenceHours.toFixed(1)}h`, `t8-likely-index:${t8LikelyIndex.toFixed(3)}`",
    "`timeline-persistence:${t8Timeline.persistenceHours.toFixed(1)}h`, `timeline-credible-persistence:${t8Timeline.crediblePersistenceHours.toFixed(1)}h`, `interpolation-confidence:${interpolationConfidence.toFixed(3)}`, `t8-likely-index:${t8LikelyIndex.toFixed(3)}`",
    1
)

old = """        interpolationCadenceDoesNotSetTimingPrecision: true,
        timingThresholdCrossingsAreInterpolated: true,"""
new = """        interpolationCadenceDoesNotSetTimingPrecision: true,
        interpolationReliabilityAffectsLikelyEscalationNotRawThreat: true,
        timingThresholdCrossingsAreInterpolated: true,"""
if text.count(old) != 1:
    raise SystemExit(f'followup18 semantics anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
