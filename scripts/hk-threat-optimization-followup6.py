from pathlib import Path

path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')

# A verified wind-field intersection is a direct physical threat channel, not merely
# a small additive bonus to centre-distance scoring. Keep it separate so distant
# large storms are not missed, while agreement/freshness continue to affect confidence.
old = """    const t3RiskIndex = clamp(Math.max(staticT3Risk, t3Timeline.maxEvidence));"""
new = """    const t3DirectWindFieldRisk = clamp(t3WindFieldExposure * 0.55);\n    const t3RiskIndex = clamp(Math.max(staticT3Risk, t3Timeline.maxEvidence, t3DirectWindFieldRisk));"""
if text.count(old) != 1:
    raise SystemExit('followup6 T3 direct wind-field anchor mismatch')
text = text.replace(old, new, 1)

old = """    const t8RiskIndex = clamp(Math.max(staticT8Risk, t8Timeline.maxEvidence));"""
new = """    const t8DirectWindFieldRisk = clamp(t8WindFieldExposure * 0.62);\n    const t8RiskIndex = clamp(Math.max(staticT8Risk, t8Timeline.maxEvidence, t8DirectWindFieldRisk));"""
if text.count(old) != 1:
    raise SystemExit('followup6 T8 direct wind-field anchor mismatch')
text = text.replace(old, new, 1)

text = text.replace(
    "`timeline-persistence:${t3Timeline.persistenceHours.toFixed(1)}h`, `t3-likely-index:${t3LikelyIndex.toFixed(3)}`, `t3-risk-index:${t3RiskIndex.toFixed(3)}`",
    "`timeline-persistence:${t3Timeline.persistenceHours.toFixed(1)}h`, `direct-wind-field-risk:${t3DirectWindFieldRisk.toFixed(3)}`, `t3-likely-index:${t3LikelyIndex.toFixed(3)}`, `t3-risk-index:${t3RiskIndex.toFixed(3)}`",
    1
)
text = text.replace(
    "`timeline-persistence:${t8Timeline.persistenceHours.toFixed(1)}h`, `t8-likely-index:${t8LikelyIndex.toFixed(3)}`, `t8-risk-index:${t8RiskIndex.toFixed(3)}`",
    "`timeline-persistence:${t8Timeline.persistenceHours.toFixed(1)}h`, `direct-wind-field-risk:${t8DirectWindFieldRisk.toFixed(3)}`, `t8-likely-index:${t8LikelyIndex.toFixed(3)}`, `t8-risk-index:${t8RiskIndex.toFixed(3)}`",
    1
)

old = """        windFieldThresholdsAreSignalSpecificWhenKnown: true,\n        localWindPersistenceIsContinuousEvidence: true,"""
new = """        windFieldThresholdsAreSignalSpecificWhenKnown: true,\n        windFieldIntersectionIsDirectThreatEvidence: true,\n        localWindPersistenceIsContinuousEvidence: true,"""
if text.count(old) != 1:
    raise SystemExit('followup6 semantics anchor mismatch')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
