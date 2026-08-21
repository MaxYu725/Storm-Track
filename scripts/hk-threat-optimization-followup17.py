from pathlib import Path

path = Path('analysis/hk-threat-assessment.js')
text = path.read_text(encoding='utf-8')

old = "if (exact) return { ...exact, exactOfficialTime: true };"
new = "if (exact) return { ...exact, exactOfficialTime: true, interpolationSpanHours: 0, interpolationReliability: 1 };"
if text.count(old) != 1:
    raise SystemExit(f'followup17 exact interpolation anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """      const span = after.timeMs - before.timeMs;\n      if (!(span > 0)) return null;\n      const ratio = (targetMs - before.timeMs) / span;"""
new = """      const span = after.timeMs - before.timeMs;\n      if (!(span > 0)) return null;\n      const interpolationSpanHours = span / HOUR_MS;\n      const interpolationReliability = 1 / (1 + interpolationSpanHours / 18);\n      const ratio = (targetMs - before.timeMs) / span;"""
if text.count(old) != 1:
    raise SystemExit(f'followup17 span anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """        windRadiiAvailable: false,\n        kind: 'interpolated',\n        exactOfficialTime: false"""
new = """        windRadiiAvailable: false,\n        kind: 'interpolated',\n        exactOfficialTime: false,\n        interpolationSpanHours,\n        interpolationReliability"""
if text.count(old) != 1:
    raise SystemExit(f'followup17 interpolated return anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

# The buildTimeline object has been extended by earlier follow-ups. Insert the
# reliability metadata immediately after maximumWindMs rather than depending on the
# surrounding field order.
needle = "          maximumWindMs: sample.maximumWindMs,\n"
insertion = """          maximumWindMs: sample.maximumWindMs,\n          interpolationSpanHours: finite(sample.interpolationSpanHours) ?? 0,\n          interpolationReliability: clamp(finite(sample.interpolationReliability) ?? (sample.exactOfficialTime === true ? 1 : 0.5)),\n"""
if text.count(needle) != 1:
    raise SystemExit(f'followup17 timeline sample anchor mismatch: {text.count(needle)}')
text = text.replace(needle, insertion, 1)

# Add checkpoint-level reliability beside exact official support. This is metadata /
# confidence evidence only; physical distance/wind threat remains unchanged.
old = """        exactOfficialSupportCount: agencyEntries.filter(entry => entry.exactOfficialTime).length,\n        windSupportAgencyCount: winds.length,"""
new = """        exactOfficialSupportCount: agencyEntries.filter(entry => entry.exactOfficialTime).length,\n        interpolationReliability: agencyEntries.length\n          ? agencyEntries.reduce((sum, entry) => sum + entry.interpolationReliability, 0) / agencyEntries.length\n          : 0,\n        windSupportAgencyCount: winds.length,"""
if text.count(old) != 1:
    raise SystemExit(f'followup17 checkpoint reliability anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

# Compute an overall timeline reliability using the existing continuous time relevance.
old = """    const strongestTimelineThreat = timeline.reduce((best, item) => item.threatIndex > (best?.threatIndex ?? -1) ? item : best, null);\n    const fastestEvolution = timeline.reduce((best, item) => item.rapidEvolutionIndex > (best?.rapidEvolutionIndex ?? -1) ? item : best, null);"""
new = """    const strongestTimelineThreat = timeline.reduce((best, item) => item.threatIndex > (best?.threatIndex ?? -1) ? item : best, null);\n    const fastestEvolution = timeline.reduce((best, item) => item.rapidEvolutionIndex > (best?.rapidEvolutionIndex ?? -1) ? item : best, null);\n    const interpolationReliabilityConfidence = timeline.length\n      ? weightedAverage(timeline, 'interpolationReliability')\n      : 1;"""
if text.count(old) != 1:
    raise SystemExit(f'followup17 timeline reliability aggregate anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = "const confidenceIndex = clamp(1 - agencyDisagreementConfidence * 0.55 - forecastEdgeConfidence * 0.25);"
new = "const confidenceIndex = clamp(1 - agencyDisagreementConfidence * 0.55 - forecastEdgeConfidence * 0.25 - (1 - interpolationReliabilityConfidence) * 0.25);"
if text.count(old) != 1:
    raise SystemExit(f'followup17 confidence anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """        agencyDisagreement: { confidence: agencyDisagreementConfidence },\n        windField:"""
new = """        agencyDisagreement: { confidence: agencyDisagreementConfidence },\n        interpolationReliability: { confidence: interpolationReliabilityConfidence },\n        windField:"""
if text.count(old) != 1:
    raise SystemExit(f'followup17 analyzer anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """        crossAgencyInterpolationIsTransparent: true,\n        pastCheckpointsExcludedFromForecastTimeline: true,"""
new = """        crossAgencyInterpolationIsTransparent: true,\n        interpolationGapAffectsConfidenceNotPhysicalThreat: true,\n        interpolationReliabilityIsContinuous: true,\n        pastCheckpointsExcludedFromForecastTimeline: true,"""
if text.count(old) != 1:
    raise SystemExit(f'followup17 semantics anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
