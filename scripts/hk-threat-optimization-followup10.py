from pathlib import Path

path = Path('analysis/frontend-hk-threat-ui.js')
text = path.read_text(encoding='utf-8')

old = """    const forecast = result.basicForecast;\n    const threat = result.threatAssessment;\n    const impactLabel = likelihoodLabel(forecast?.impact?.likelihood);"""
new = """    const forecast = result.basicForecast;\n    const threat = result.threatAssessment;\n    const official = result.signalInputs?.officialHkoWarningContext || null;\n    const officialSignal = official?.provided === true && official?.currentSignal\n      ? String(official.currentSignal).trim() : null;\n    const officialIssued = officialSignal && official?.issuedAt ? formatHkt(official.issuedAt) : null;\n    const impactLabel = likelihoodLabel(forecast?.impact?.likelihood);"""
if text.count(old) != 1:
    raise SystemExit('followup10 official context declaration anchor mismatch')
text = text.replace(old, new, 1)

old = """      <div style=\"display:flex;justify-content:space-between;gap:8px;align-items:baseline\"><span style=\"color:#8f8f8f\">香港影響</span><strong style=\"color:#fff;font-size:.82rem\">${escapeHtml(impactLabel)}</strong></div>\n      <div style=\"margin-top:4px;color:#ddd\">${escapeHtml(t1)}</div>"""
new = """      <div style=\"display:flex;justify-content:space-between;gap:8px;align-items:baseline\"><span style=\"color:#8f8f8f\">香港影響</span><strong style=\"color:#fff;font-size:.82rem\">${escapeHtml(impactLabel)}</strong></div>\n      ${officialSignal ? `<div style=\"margin-top:5px;color:#fff\"><strong>HKO官方目前：${escapeHtml(officialSignal)}</strong>${officialIssued ? ` · ${escapeHtml(officialIssued)}` : ''}</div>` : ''}\n      <div style=\"margin-top:4px;color:#ddd\">${escapeHtml(t1)}</div>"""
if text.count(old) != 1:
    raise SystemExit('followup10 official UI insertion anchor mismatch')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
