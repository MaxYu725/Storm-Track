from pathlib import Path

# Interpolate the actual signal-evidence threshold crossing between adjacent
# below/above checkpoints. This removes timing-anchor dependence on resampling cadence
# while preserving the fail-closed rule for a first visible point already above threshold.
path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')
old = """    const crossing = threshold => entries.find((item, index) => {\n      if (item.evidence < threshold) return false;\n      if (index === 0) return false;\n      return entries[index - 1].evidence < threshold;\n    }) ?? null;"""
new = """    const crossing = threshold => {\n      for (let index = 1; index < entries.length; index += 1) {\n        const previous = entries[index - 1];\n        const item = entries[index];\n        if (!(previous.evidence < threshold && item.evidence >= threshold)) continue;\n        const previousMs = timeMs(previous.checkpoint?.validTime ?? previous.checkpoint?.time);\n        const itemMs = timeMs(item.checkpoint?.validTime ?? item.checkpoint?.time);\n        const evidenceDelta = item.evidence - previous.evidence;\n        if (!Number.isFinite(previousMs) || !Number.isFinite(itemMs) || !(itemMs > previousMs) || !(evidenceDelta > 1e-12)) {\n          return item;\n        }\n        const fraction = clamp((threshold - previous.evidence) / evidenceDelta);\n        const crossingMs = previousMs + fraction * (itemMs - previousMs);\n        const previousLead = finite(previous.checkpoint?.leadHours);\n        const itemLead = finite(item.checkpoint?.leadHours);\n        const crossingLead = Number.isFinite(previousLead) && Number.isFinite(itemLead)\n          ? previousLead + fraction * (itemLead - previousLead)\n          : finite(item.checkpoint?.leadHours);\n        return {\n          ...item,\n          checkpoint: {\n            ...item.checkpoint,\n            validTime: iso(crossingMs),\n            time: iso(crossingMs),\n            leadHours: crossingLead\n          },\n          thresholdCrossingInterpolated: true,\n          crossingFraction: fraction\n        };\n      }\n      return null;\n    };"""
if text.count(old) != 1:
    raise SystemExit('followup14 crossing interpolation anchor mismatch')
text = text.replace(old, new, 1)

old = """        interpolationCadenceDoesNotSetTimingPrecision: true,\n        officialHkoForecast: false,"""
new = """        interpolationCadenceDoesNotSetTimingPrecision: true,\n        timingThresholdCrossingsAreInterpolated: true,\n        firstVisibleAboveThresholdDoesNotInventCrossing: true,\n        officialHkoForecast: false,"""
if text.count(old) != 1:
    raise SystemExit('followup14 semantics anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

# Make cadence invariance part of the canonical full regression chain.
path = Path('workers/storm-analysis/package.json')
text = path.read_text(encoding='utf-8')
old = "node ../../tests/hk-signal-timing-uncertainty.test.cjs && node ../../tests/basic-hk-signal-forecast.test.cjs"
new = "node ../../tests/hk-signal-timing-uncertainty.test.cjs && node ../../tests/hk-signal-timing-cadence-invariance.test.cjs && node ../../tests/basic-hk-signal-forecast.test.cjs"
if text.count(old) != 1:
    raise SystemExit('followup14 package test anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
