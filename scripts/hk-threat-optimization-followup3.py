from pathlib import Path

path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')

# +0h is current-state evidence. Current-state risk is handled by the static/current
# channel where approach/departure analyzers are available. Do not let a +0h point
# with no previous radial-rate sample dominate the future escalation timeline.
old = """    const strongest = entries.reduce((best, item) => item.evidence > best.evidence ? item : best, entries[0]);\n    const thresholds = signalThresholds(signal);"""
new = """    const futureEntries = entries.filter(item => (finite(item?.checkpoint?.leadHours) ?? 0) > 1e-6);\n    const scoringEntries = futureEntries.length ? futureEntries : entries;\n    const strongest = scoringEntries.reduce((best, item) => item.evidence > best.evidence ? item : best, scoringEntries[0]);\n    const thresholds = signalThresholds(signal);"""
if text.count(old) != 1:
    raise SystemExit('followup3 scoringEntries anchor mismatch')
text = text.replace(old, new, 1)

# "starts inside at reference time" is not a future entry. Equality to now must not
# become a warning-issuance anchor.
text = text.replace("enterMs >= referenceMs", "enterMs > referenceMs + 1000", 3)
text = text.replace("fallback >= referenceMs", "fallback > referenceMs + 1000", 1)

# A closest-time-minus-N-hours fallback can invent an issuance time with no observed
# risk crossing. Keep only actual future risk crossings / distance-band entries.
old = """    const t1Anchor = t1TimelineAnchor ?? futureEntry(entry800) ?? addHours(minimumTime, -24);\n    const t3Anchor = t3TimelineAnchor ?? futureEntry(entry500) ?? addHours(minimumTime, -12);\n    const t8Anchor = t8TimelineAnchor ?? futureEntry(entry300) ?? addHours(minimumTime, -6);"""
new = """    const t1Anchor = t1TimelineAnchor ?? futureEntry(entry800) ?? null;\n    const t3Anchor = t3TimelineAnchor ?? futureEntry(entry500) ?? null;\n    const t8Anchor = t8TimelineAnchor ?? futureEntry(entry300) ?? null;"""
if text.count(old) != 1:
    raise SystemExit('followup3 timing fallback anchor mismatch')
text = text.replace(old, new, 1)

# A single outlier scenario should remain visible but should not become 'likely' merely
# because the maximum is extreme. Multiple supporting agencies increase credibility.
old = "const scenarioCredibility = coverageCredibility * (0.45 + 0.55 * supportFraction);"
new = "const scenarioCredibility = coverageCredibility * (0.35 + 0.65 * supportFraction);"
if text.count(old) != 1:
    raise SystemExit('followup3 scenario credibility anchor mismatch')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')

# Strengthen the departing regression: no invented timing window either.
path = Path('tests/hk-threat-rule-scenarios.test.cjs')
text = path.read_text(encoding='utf-8')
old = """  assert.equal(result.forecast.signals.T1.likelihood, 'unlikely');\n  assert.equal(result.forecast.signals.T3.likelihood, 'unlikely');"""
new = """  assert.equal(result.forecast.signals.T1.likelihood, 'unlikely');\n  assert.equal(result.forecast.signals.T1.estimatedWindow, null);\n  assert.equal(result.forecast.signals.T3.likelihood, 'unlikely');"""
if text.count(old) != 1:
    raise SystemExit('followup3 departing assertion anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
