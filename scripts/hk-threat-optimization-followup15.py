from pathlib import Path

path = Path('analysis/hko-signal-risk-inputs.js')
text = path.read_text(encoding='utf-8')

old = """        const windCandidates = [...rawPoints.positions, ...rawPoints.forecast].filter(point => point.windRadii.length);\n        const latestWindPoint = rawPoints.positions.slice().reverse().find(point => point.windRadii.length)\n            || windCandidates.slice().sort((a, b) => b.timeMs - a.timeMs)[0]\n            || null;\n        const closestWindPoint = closestByTime(windCandidates, closestTimeMs);"""
new = """        const windCandidates = [...rawPoints.positions, ...rawPoints.forecast].filter(point => point.windRadii.length);\n        const latestAnalysisWindPoint = rawPoints.positions.slice().reverse().find(point => point.windRadii.length) || null;\n        const currentEvidenceTimeMs = current?.timeMs;\n        const nearestFutureWindPoint = Number.isFinite(currentEvidenceTimeMs)\n            ? rawPoints.forecast\n                .filter(point => point.windRadii.length && point.timeMs >= currentEvidenceTimeMs)\n                .slice()\n                .sort((a, b) => a.timeMs - b.timeMs)[0] || null\n            : null;\n        const nearestAnyWindPoint = Number.isFinite(currentEvidenceTimeMs)\n            ? windCandidates.slice().sort((a, b) =>\n                Math.abs(a.timeMs - currentEvidenceTimeMs) - Math.abs(b.timeMs - currentEvidenceTimeMs))[0] || null\n            : null;\n        const latestWindPoint = latestAnalysisWindPoint\n            || nearestFutureWindPoint\n            || nearestAnyWindPoint\n            || null;\n        const closestWindPoint = closestByTime(windCandidates, closestTimeMs);"""

if text.count(old) != 1:
    raise SystemExit(f'followup15 wind-point selection anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
