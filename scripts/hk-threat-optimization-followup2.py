from pathlib import Path

# Follow-up after the first stress pass: make a near-current minimum a smooth continuation
# of current conditions rather than a second future threat channel, and let explicit
# multi-agency signal-specific wind-field coverage support a 'likely' classification.
path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')
old = """    const currentT1Risk = currentT1Proximity * (0.30 + currentT1Motion * 0.48);\n    const futureT1Risk = futureT1Proximity * (0.35 + trajectory * 0.65);"""
new = """    const currentT1Risk = currentT1Proximity * (0.30 + currentT1Motion * 0.48);\n    const futureT1Novelty = 1 - Math.exp(-Math.max(0, minimumLeadHours ?? 0) / 6);\n    const futureT1Risk = futureT1Proximity * futureT1Novelty * (0.15 + trajectory * 0.85);"""
if text.count(old) != 1:
    raise SystemExit('followup2 T1 future-channel anchor mismatch')
text = text.replace(old, new, 1)

old = """    const t3LikelyIndex = clamp(Math.max(staticT3Risk * 0.88, t3Timeline.sustainedEvidence ?? 0));\n    const t8LikelyIndex = clamp(Math.max(staticT8Risk * 0.86, t8Timeline.sustainedEvidence ?? 0));"""
new = """    const t3LikelyIndex = clamp(Math.max(staticT3Risk * 0.88, t3Timeline.sustainedEvidence ?? 0, t3WindFieldExposure * 0.72));\n    const t8LikelyIndex = clamp(Math.max(staticT8Risk * 0.86, t8Timeline.sustainedEvidence ?? 0, t8WindFieldExposure * 0.75));"""
if text.count(old) != 1:
    raise SystemExit('followup2 likely wind-field anchor mismatch')
text = text.replace(old, new, 1)
text = text.replace("      `forecast-minimum-lead:${minimumLeadHours.toFixed(1)}h`", "      `forecast-minimum-lead:${minimumLeadHours.toFixed(1)}h`", 1)
path.write_text(text, encoding='utf-8')

# Add a timeline to the old severe synthetic case so its 'likely' expectation represents
# a sustained, rapidly approaching severe situation rather than a single static number.
path = Path('tests/basic-hk-signal-forecast.test.cjs')
text = path.read_text(encoding='utf-8')
old = """  overallThreatIndex = null,\n  confidenceIndex = 0.7\n}) {"""
new = """  overallThreatIndex = null,\n  confidenceIndex = 0.7,\n  timeline = []\n}) {"""
if text.count(old) != 1:
    raise SystemExit('followup2 assessment signature anchor mismatch')
text = text.replace(old, new, 1)
if text.count("    timeline: [],") != 1:
    raise SystemExit('followup2 assessment timeline anchor mismatch')
text = text.replace("    timeline: [],", "    timeline,", 1)

old = """    overallThreatIndex: 0.85,\n    confidenceIndex: 0.85\n  });"""
new = """    overallThreatIndex: 0.85,\n    confidenceIndex: 0.85,\n    timeline: [\n      { label: '+0h', validTime: '2026-08-21T12:00:00Z', leadHours: 0, timeRelevance: 1, distanceMedianKm: 300, windMedianMs: 40, agencies: [\n        { agency: 'HKO', distanceKm: 300, maximumWindMs: 40, rapidEvolutionIndex: 0 },\n        { agency: 'CMA', distanceKm: 300, maximumWindMs: 40, rapidEvolutionIndex: 0 },\n        { agency: 'CWA', distanceKm: 300, maximumWindMs: 40, rapidEvolutionIndex: 0 }\n      ] },\n      { label: '+6h', validTime: '2026-08-21T18:00:00Z', leadHours: 6, timeRelevance: 0.92, distanceMedianKm: 220, windMedianMs: 40, agencies: [\n        { agency: 'HKO', distanceKm: 220, maximumWindMs: 40, approachRateKmh: 13, rapidEvolutionIndex: 0.4 },\n        { agency: 'CMA', distanceKm: 220, maximumWindMs: 40, approachRateKmh: 13, rapidEvolutionIndex: 0.4 },\n        { agency: 'CWA', distanceKm: 220, maximumWindMs: 40, approachRateKmh: 13, rapidEvolutionIndex: 0.4 }\n      ] },\n      { label: '+12h', validTime: '2026-08-22T00:00:00Z', leadHours: 12, timeRelevance: 0.86, distanceMedianKm: 150, windMedianMs: 40, agencies: [\n        { agency: 'HKO', distanceKm: 150, maximumWindMs: 40, approachRateKmh: 12, rapidEvolutionIndex: 0.35 },\n        { agency: 'CMA', distanceKm: 150, maximumWindMs: 40, approachRateKmh: 12, rapidEvolutionIndex: 0.35 },\n        { agency: 'CWA', distanceKm: 150, maximumWindMs: 40, approachRateKmh: 12, rapidEvolutionIndex: 0.35 }\n      ] },\n      { label: '+18h', validTime: '2026-08-22T06:00:00Z', leadHours: 18, timeRelevance: 0.80, distanceMedianKm: 110, windMedianMs: 40, agencies: [\n        { agency: 'HKO', distanceKm: 110, maximumWindMs: 40, approachRateKmh: 7, rapidEvolutionIndex: 0.2 },\n        { agency: 'CMA', distanceKm: 110, maximumWindMs: 40, approachRateKmh: 7, rapidEvolutionIndex: 0.2 },\n        { agency: 'CWA', distanceKm: 110, maximumWindMs: 40, approachRateKmh: 7, rapidEvolutionIndex: 0.2 }\n      ] }\n    ]\n  });"""
if text.count(old) != 1:
    raise SystemExit('followup2 severe timeline fixture anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
