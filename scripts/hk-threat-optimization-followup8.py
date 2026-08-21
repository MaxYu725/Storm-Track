from pathlib import Path

path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')

old = """    const t3WindFieldExposure = clamp(Math.max(latestStrongWindCoverage, closestStrongWindCoverage, windFieldConfidence * 0.35, unknownWindCoverage * 0.20));\n    const t8WindFieldExposure = clamp(Math.max(latestGaleCoverage, closestGaleCoverage, windFieldConfidence * 0.18, unknownWindCoverage * 0.08));"""
new = """    const windFieldScenarioExposure = coverageKey => {\n      const agencyItems = Object.values(signalInputs?.agencies || {}).filter(item => item?.state === 'ok');\n      if (!agencyItems.length) return 0;\n      const strengths = agencyItems.map(item => {\n        const latest = item?.windField?.latestEvidence;\n        const closestEvidence = item?.windField?.closestTimeEvidence;\n        const latestStrength = latest?.[coverageKey] ? clamp(finite(latest.freshness) ?? 1) : 0;\n        const closestStrength = closestEvidence?.[coverageKey] ? clamp(finite(closestEvidence.freshness) ?? 1) : 0;\n        return Math.max(latestStrength, closestStrength);\n      });\n      const scenarioMax = Math.max(...strengths, 0);\n      const supportCount = strengths.filter(value => value > 0).length;\n      const supportFraction = supportCount / agencyItems.length;\n      const coverageCredibility = agencyItems.length >= 3 ? 1 : (agencyItems.length === 2 ? 0.82 : 0.60);\n      return clamp(scenarioMax * coverageCredibility * (0.35 + 0.65 * supportFraction));\n    };\n    const t3WindFieldScenarioExposure = windFieldScenarioExposure('strongWindCoverage');\n    const t8WindFieldScenarioExposure = windFieldScenarioExposure('galeCoverage');\n    const t3WindFieldExposure = clamp(Math.max(latestStrongWindCoverage, closestStrongWindCoverage, t3WindFieldScenarioExposure, windFieldConfidence * 0.35, unknownWindCoverage * 0.20));\n    const t8WindFieldExposure = clamp(Math.max(latestGaleCoverage, closestGaleCoverage, t8WindFieldScenarioExposure, windFieldConfidence * 0.18, unknownWindCoverage * 0.08));"""
if text.count(old) != 1:
    raise SystemExit('followup8 wind-field scenario envelope anchor mismatch')
text = text.replace(old, new, 1)

# Direct verified coverage should be sufficient for "possible", but never by itself
# produce "likely" because the likely index intentionally excludes this direct channel.
old = """    const t3DirectWindFieldRisk = clamp(t3WindFieldExposure * 0.55);"""
new = """    const t3DirectWindFieldRisk = clamp(t3WindFieldExposure * 0.70);"""
if text.count(old) != 1:
    raise SystemExit('followup8 T3 direct coefficient anchor mismatch')
text = text.replace(old, new, 1)
old = """    const t8DirectWindFieldRisk = clamp(t8WindFieldExposure * 0.62);"""
new = """    const t8DirectWindFieldRisk = clamp(t8WindFieldExposure * 0.72);"""
if text.count(old) != 1:
    raise SystemExit('followup8 T8 direct coefficient anchor mismatch')
text = text.replace(old, new, 1)

text = text.replace(
    "`wind-field-t3:${t3WindFieldExposure.toFixed(3)}`,",
    "`wind-field-t3:${t3WindFieldExposure.toFixed(3)}`,\n      `wind-field-t3-scenario:${t3WindFieldScenarioExposure.toFixed(3)}`,",
    1
)
text = text.replace(
    "`wind-field-t8:${t8WindFieldExposure.toFixed(3)}`,",
    "`wind-field-t8:${t8WindFieldExposure.toFixed(3)}`,\n      `wind-field-t8-scenario:${t8WindFieldScenarioExposure.toFixed(3)}`,",
    1
)

old = """        minorityAgencyThreatScenarioPreserved: true,\n        windFieldThresholdsAreSignalSpecificWhenKnown: true,"""
new = """        minorityAgencyThreatScenarioPreserved: true,\n        minorityAgencyWindFieldScenarioPreserved: true,\n        windFieldThresholdsAreSignalSpecificWhenKnown: true,"""
if text.count(old) != 1:
    raise SystemExit('followup8 semantics anchor mismatch')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
