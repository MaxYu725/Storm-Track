from pathlib import Path

path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')

old = """    const interpolationConfidence = clamp(finite(analyzers.interpolationReliability?.confidence) ?? 1);
    const t3LikelyIndex = clamp(Math.max(
      staticT3Risk * 0.88 * interpolationConfidence,
      t3Timeline.credibleSustainedEvidence ?? 0,
      t3WindFieldExposure * 0.72
    ));"""
new = """    const interpolationConfidence = clamp(finite(analyzers.interpolationReliability?.confidence) ?? 1);
    // Current analysed proximity is direct evidence and must not be penalized merely
    // because later forecast points are sparse. Only future/trajectory-derived T1
    // escalation is reliability-weighted; raw T1 risk remains unchanged for 'possible'.
    const t1CredibleStaticRisk = clamp(Math.max(
      currentT1Risk,
      futureT1Risk * interpolationConfidence
    ) + rapidEvolution * 0.05 * interpolationConfidence + windFieldConfidence * 0.04);
    const t1LikelyIndex = clamp(Math.max(
      t1CredibleStaticRisk,
      t1Timeline.credibleSustainedEvidence ?? 0
    ));
    const t3LikelyIndex = clamp(Math.max(
      staticT3Risk * 0.88 * interpolationConfidence,
      t3Timeline.credibleSustainedEvidence ?? 0,
      t3WindFieldExposure * 0.72
    ));"""
if text.count(old) != 1:
    raise SystemExit(f'followup19 T1 credible likely anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """    const t1Likelihood = likelihoodFromIndex(t1RiskIndex, 0.58, 0.35);
    const t3Likelihood = t3RiskIndex < 0.38 ? 'unlikely' : (t3LikelyIndex >= 0.65 ? 'likely' : 'possible');"""
new = """    const t1Likelihood = t1RiskIndex < 0.35 ? 'unlikely' : (t1LikelyIndex >= 0.58 ? 'likely' : 'possible');
    const t3Likelihood = t3RiskIndex < 0.38 ? 'unlikely' : (t3LikelyIndex >= 0.65 ? 'likely' : 'possible');"""
if text.count(old) != 1:
    raise SystemExit(f'followup19 T1 likelihood anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """      `timeline-evidence:${t1Timeline.maxEvidence.toFixed(3)}`, `t1-risk-index:${t1RiskIndex.toFixed(3)}`"""
new = """      `timeline-evidence:${t1Timeline.maxEvidence.toFixed(3)}`, `timeline-credible-evidence:${(t1Timeline.credibleMaxEvidence ?? 0).toFixed(3)}`, `interpolation-confidence:${interpolationConfidence.toFixed(3)}`, `t1-likely-index:${t1LikelyIndex.toFixed(3)}`, `t1-risk-index:${t1RiskIndex.toFixed(3)}`"""
if text.count(old) != 1:
    raise SystemExit(f'followup19 T1 basis anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
