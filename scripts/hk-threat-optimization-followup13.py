from pathlib import Path
import re

# Timing precision must reflect forecast confidence/horizon, not the synthetic timeline
# resampling cadence. Keep risk scores untouched; only widen broad guidance windows.
path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')
pattern = r"  function timelineWindow\(anchor, timeline, referenceTime, defaultBefore = 4, defaultAfter = 6\) \{.*?\n  \}\n\n  function buildBasicHkSignalForecast"
replacement = r'''  function timelineWindow(anchor, timeline, referenceTime, defaultBefore = 4, defaultAfter = 6, analysisConfidence = 0.5) {
    if (!anchor) return null;
    const anchorMs = timeMs(anchor);
    if (!Number.isFinite(anchorMs)) return null;
    const index = (Array.isArray(timeline) ? timeline : []).findIndex(item => timeMs(item?.validTime ?? item?.time) === anchorMs);
    const previousGap = index > 0 ? finite(timeline[index]?.intervalFromPreviousHours) : null;
    const nextGap = index >= 0 && index + 1 < timeline.length
      ? finite(timeline[index + 1]?.intervalFromPreviousHours) : null;
    const cadenceBefore = Number.isFinite(previousGap) ? clamp(previousGap / 2, 2, 6) : defaultBefore;
    const cadenceAfter = Number.isFinite(nextGap) ? clamp(nextGap / 2, 2, 8) : defaultAfter;
    const referenceMs = timeMs(referenceTime);
    const anchorLeadHours = Number.isFinite(referenceMs) ? Math.max(0, (anchorMs - referenceMs) / HOUR_MS) : null;
    const horizonRelevance = Number.isFinite(anchorLeadHours) ? softTimeRelevance(anchorLeadHours) : 0.5;
    const confidence = clamp(finite(analysisConfidence) ?? 0.5);
    const uncertaintyHalfSpan = clamp(
      3
      + (1 - confidence) * 6
      + (1 - horizonRelevance) * 3,
      3,
      12
    );
    const before = Math.max(cadenceBefore, uncertaintyHalfSpan);
    const after = Math.max(cadenceAfter, uncertaintyHalfSpan);
    const startMs = Math.max(anchorMs - before * HOUR_MS, Number.isFinite(referenceMs) ? referenceMs : -Infinity);
    return { start: iso(startMs), end: iso(anchorMs + after * HOUR_MS) };
  }

  function buildBasicHkSignalForecast'''
text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'followup13 timelineWindow anchor mismatch: {count}')

old = """      if (timelineAnchorValue) return timelineWindow(timelineAnchorValue, timeline, referenceTime, before, after);"""
new = """      if (timelineAnchorValue) return timelineWindow(\n        timelineAnchorValue,\n        timeline,\n        referenceTime,\n        before,\n        after,\n        finite(summary.confidenceIndex)\n      );"""
if text.count(old) != 1:
    raise SystemExit('followup13 signalWindow call anchor mismatch')
text = text.replace(old, new, 1)

old = """        estimatedWindowsAreBroadGuidance: true,\n        officialHkoForecast: false,"""
new = """        estimatedWindowsAreBroadGuidance: true,\n        timingWindowsReflectAnalysisConfidence: true,\n        interpolationCadenceDoesNotSetTimingPrecision: true,\n        officialHkoForecast: false,"""
if text.count(old) != 1:
    raise SystemExit('followup13 semantics anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

# Promote the previously failing timing regression into the canonical npm test chain.
path = Path('workers/storm-analysis/package.json')
text = path.read_text(encoding='utf-8')
old = "node ../../tests/hk-agency-evidence-independence.test.cjs && node ../../tests/basic-hk-signal-forecast.test.cjs"
new = "node ../../tests/hk-agency-evidence-independence.test.cjs && node ../../tests/hk-signal-timing-uncertainty.test.cjs && node ../../tests/basic-hk-signal-forecast.test.cjs"
if text.count(old) != 1:
    raise SystemExit('followup13 package test anchor mismatch')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
