from pathlib import Path

path = Path('analysis/basic-hk-signal-forecast.js')
text = path.read_text(encoding='utf-8')

old = """    const t8LikelyIndex = clamp(Math.max(
      staticT8Risk * 0.86 * interpolationConfidence,
      t8Timeline.credibleSustainedEvidence ?? 0,
      t8WindFieldExposure * 0.75
    ));"""
new = """    // T8 normally benefits from persistence, but a short-lived extreme close-pass can
    // still be operationally important when the peak itself is well supported by
    // official forecast points. Keep this as a continuous credibility channel rather
    // than a hard agency-count gate: interpolated peaks decay with their checkpoint
    // reliability, while fully confirmed peaks retain their physical evidence.
    const t8PeakReliability = clamp(
      finite(t8Timeline.strongestCredible?.checkpoint?.interpolationReliability)
        ?? interpolationConfidence
    );
    const t8CrediblePeakEvidence = clamp(
      (t8Timeline.credibleMaxEvidence ?? 0) * t8PeakReliability
    );
    const t8LikelyIndex = clamp(Math.max(
      staticT8Risk * 0.86 * interpolationConfidence,
      t8Timeline.credibleSustainedEvidence ?? 0,
      t8CrediblePeakEvidence,
      t8WindFieldExposure * 0.75
    ));"""
if text.count(old) != 1:
    raise SystemExit(f'followup20 T8 likely block anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = "`t8-likely-index:${t8LikelyIndex.toFixed(3)}`"
new = "`t8-peak-reliability:${t8PeakReliability.toFixed(3)}`, `t8-credible-peak-evidence:${t8CrediblePeakEvidence.toFixed(3)}`, `t8-likely-index:${t8LikelyIndex.toFixed(3)}`"
if text.count(old) != 1:
    raise SystemExit(f'followup20 T8 basis anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

old = """        interpolationReliabilityAffectsLikelyEscalationNotRawThreat: true,
        timingThresholdCrossingsAreInterpolated: true,"""
new = """        interpolationReliabilityAffectsLikelyEscalationNotRawThreat: true,
        reliableConfirmedPeakCanSupportT8LikelyEscalation: true,
        timingThresholdCrossingsAreInterpolated: true,"""
if text.count(old) != 1:
    raise SystemExit(f'followup20 semantics anchor mismatch: {text.count(old)}')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
