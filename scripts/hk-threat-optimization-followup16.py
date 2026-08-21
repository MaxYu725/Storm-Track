from pathlib import Path

path = Path('analysis/hk-threat-assessment.js')
text = path.read_text(encoding='utf-8')

old = """  function weightedAverage(items, valueKey, weightKey = 'timeRelevance') {\n    let numerator = 0;\n    let denominator = 0;\n    items.forEach(item => {\n      const value = finite(item?.[valueKey]);\n      const weight = finite(item?.[weightKey]);\n      if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) return;\n      numerator += value * weight;\n      denominator += weight;\n    });\n    return denominator > 0 ? numerator / denominator : 0;\n  }"""
new = """  function weightedAverage(items, valueKey, weightKey = 'timeRelevance') {\n    let numerator = 0;\n    let denominator = 0;\n    items.forEach(item => {\n      const value = finite(item?.[valueKey]);\n      const relevance = finite(item?.[weightKey]);\n      const durationHours = finite(item?.durationHours);\n      const durationWeight = Number.isFinite(durationHours) && durationHours > 0 ? durationHours : 1;\n      const weight = Number.isFinite(relevance) ? relevance * durationWeight : null;\n      if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) return;\n      numerator += value * weight;\n      denominator += weight;\n    });\n    return denominator > 0 ? numerator / denominator : 0;\n  }"""

if text.count(old) != 1:
    raise SystemExit(f'followup16 duration-weighted analyzer anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
