from pathlib import Path

path = Path('tests/hk-threat-rule-scenarios.test.cjs')
text = path.read_text(encoding='utf-8')
old = """  const result = run({ HKO: departing(), CMA: departing(), CWA: departing(), JMA: null });\n  assert.equal(result.forecast.signals.T1.likelihood, 'unlikely');"""
new = """  const result = run({ HKO: departing(), CMA: departing(), CWA: departing(), JMA: null });\n  console.log('DEPARTING_DIAGNOSTIC', JSON.stringify({\n    T1: result.forecast.signals.T1,\n    summary: result.threatAssessment.summary,\n    analyzers: result.threatAssessment.analyzers,\n    timeline: result.threatAssessment.timeline.map(item => ({ label:item.label, lead:item.leadHours, distance:item.distanceMedianKm, approach:item.approachRateKmh, rapid:item.rapidEvolutionIndex }))\n  }));\n  assert.equal(result.forecast.signals.T1.likelihood, 'unlikely');"""
# Diagnostics are optional instrumentation. If a prior follow-up has already changed
# this assertion block, do not fail the product regression merely because the logging
# anchor moved.
if old in text:
    path.write_text(text.replace(old, new, 1), encoding='utf-8')
