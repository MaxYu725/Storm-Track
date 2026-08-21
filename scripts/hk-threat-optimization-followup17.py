from pathlib import Path
import re

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

# Earlier optimization code owns the field order here. Match the field independent of
# indentation/order so this follow-up remains a narrow metadata insertion.
def add_sample_reliability(match):
    indent = match.group(1)
    return (
        f"{indent}maximumWindMs: sample.maximumWindMs,\n"
        f"{indent}interpolationSpanHours: finite(sample.interpolationSpanHours) ?? 0,\n"
        f"{indent}interpolationReliability: clamp(finite(sample.interpolationReliability) ?? (sample.exactOfficialTime === true ? 1 : 0.5)),"
    )
text, count = re.subn(r"^(\s*)maximumWindMs: sample\.maximumWindMs,\s*$", add_sample_reliability, text, count=1, flags=re.M)
if count != 1:
    raise SystemExit(f'followup17 timeline sample anchor mismatch: {count}')

# Add checkpoint-level reliability beside exact official support. This is metadata /
# confidence evidence only; physical distance/wind threat remains unchanged.
def add_checkpoint_reliability(match):
    indent = match.group(1)
    return (
        f"{indent}exactOfficialSupportCount: agencyEntries.filter(entry => entry.exactOfficialTime).length,\n"
        f"{indent}interpolationReliability: agencyEntries.length\n"
        f"{indent}  ? agencyEntries.reduce((sum, entry) => sum + entry.interpolationReliability, 0) / agencyEntries.length\n"
        f"{indent}  : 0,"
    )
text, count = re.subn(
    r"^(\s*)exactOfficialSupportCount: agencyEntries\.filter\(entry => entry\.exactOfficialTime\)\.length,\s*$",
    add_checkpoint_reliability,
    text,
    count=1,
    flags=re.M
)
if count != 1:
    raise SystemExit(f'followup17 checkpoint reliability anchor mismatch: {count}')

# Compute an overall timeline reliability using the existing continuous time relevance.
old = """    const strongestTimelineThreat = timeline.reduce((best, item) => item.threatIndex > (best?.threatIndex ?? -1) ? item : best, null);\n    const fastestEvolution = timeline.reduce((best, item) => item.scenarioRapidEvolutionIndex > (best?.scenarioRapidEvolutionIndex ?? -1) ? item : best, null);"""
new = """    const strongestTimelineThreat = timeline.reduce((best, item) => item.threatIndex > (best?.threatIndex ?? -1) ? item : best, null);\n    const fastestEvolution = timeline.reduce((best, item) => item.scenarioRapidEvolutionIndex > (best?.scenarioRapidEvolutionIndex ?? -1) ? item : best, null);\n    const interpolationReliabilityConfidence = timeline.length\n      ? weightedAverage(timeline, 'interpolationReliability')\n      : 1;"""
if text.count(old) != 1:
    raise SystemExit(f'followup17 timeline reliability aggregate anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

# Previous optimization already multiplies agency coverage into confidence. Apply the
# interpolation term to that whole confidence expression, not to physical threat.
old = """    const confidenceIndex = clamp(\n      (1 - agencyDisagreementConfidence * 0.55 - forecastEdgeConfidence * 0.25)\n      * (0.55 + 0.45 * agencyCoverageConfidence)\n    );"""
new = """    const confidenceIndex = clamp(\n      (1 - agencyDisagreementConfidence * 0.55 - forecastEdgeConfidence * 0.25)\n      * (0.55 + 0.45 * agencyCoverageConfidence)\n      * (0.75 + 0.25 * interpolationReliabilityConfidence)\n    );"""
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
