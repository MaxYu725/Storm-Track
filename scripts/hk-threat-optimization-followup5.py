from pathlib import Path

path = Path('tests/hk-threat-rule-scenarios.test.cjs')
text = path.read_text(encoding='utf-8')
anchor = "console.log('HK threat rule scenarios: OK');"
if text.count(anchor) != 1:
    raise SystemExit('followup5 final scenario anchor mismatch')
extra = r'''
// A high-threat path supported by two agencies should carry more scenario credibility
// than the same path supported by only one agency, without erasing the minority case.
{
  const severe = () => source(
    [point(BASE, 19.0, 122.0, 24, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 20.0, 119.0, 28),
      point('2026-08-22T00:00:00Z', 21.0, 116.8, 32),
      point('2026-08-22T06:00:00Z', 21.7, 115.1, 36)
    ]
  );
  const safe = () => safeTrack(0.02);
  const one = run({ HKO: severe(), CMA: safe(), CWA: safe(), JMA: null });
  const two = run({ HKO: severe(), CMA: severe(), CWA: safe(), JMA: null });
  assert.ok(one.forecast.signals.T3.riskIndex >= 0.38);
  assert.ok(two.forecast.signals.T3.riskIndex > one.forecast.signals.T3.riskIndex + 0.03);
  assert.ok(two.forecast.signals.T3.strongestCheckpoint.supportAgencyCount >= 2);
}

// A very large strong-wind radius can make a distant centre relevant to T3, while
// a small radius on the identical centre track must not receive the same exposure.
{
  const huge = [{ level: '7', ne: 900, se: 900, sw: 900, nw: 900 }];
  const small = [{ level: '7', ne: 100, se: 100, sw: 100, nw: 100 }];
  const make = radii => source(
    [point(BASE, 20.5, 107.5, 24, { kind: 'analysis', windRadii: radii })],
    [
      point('2026-08-22T00:00:00Z', 20.7, 108.0, 24, { windRadii: radii }),
      point('2026-08-22T12:00:00Z', 20.9, 108.5, 23, { windRadii: radii })
    ]
  );
  const largeField = run({ CMA: make(huge), HKO: null, JMA: null, CWA: null });
  const smallField = run({ CMA: make(small), HKO: null, JMA: null, CWA: null });
  assert.equal(largeField.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount, 1);
  assert.equal(smallField.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount, 0);
  assert.ok(largeField.forecast.signals.T3.riskIndex > smallField.forecast.signals.T3.riskIndex + 0.08);
  assert.notEqual(largeField.forecast.signals.T3.likelihood, 'unlikely');
  assert.notEqual(largeField.forecast.signals.T8.likelihood, 'likely');
}

// Future gale-radius evidence that disappears before the closest forecast time must
// lose weight versus a forecast that continues to publish gale coverage near closest.
{
  const gale = [{ level: '10', ne: 450, se: 450, sw: 450, nw: 450 }];
  const fading = () => source(
    [point(BASE, 19.0, 121.5, 26, { kind: 'analysis' })],
    [
      point('2026-08-22T00:00:00Z', 20.8, 117.0, 31, { windRadii: gale }),
      point('2026-08-22T12:00:00Z', 21.7, 115.2, 33)
    ]
  );
  const persistent = () => source(
    [point(BASE, 19.0, 121.5, 26, { kind: 'analysis' })],
    [
      point('2026-08-22T00:00:00Z', 20.8, 117.0, 31, { windRadii: gale }),
      point('2026-08-22T12:00:00Z', 21.7, 115.2, 33, { windRadii: gale })
    ]
  );
  const a = run({ HKO: fading(), CMA: fading(), CWA: fading(), JMA: null });
  const b = run({ HKO: persistent(), CMA: persistent(), CWA: persistent(), JMA: null });
  assert.ok(a.signalInputs.featureVector.closestTimeWindFieldEvidenceAgeMedianHours >= 11.9);
  assert.ok(a.signalInputs.featureVector.closestTimeGaleWindFieldCoverageEffectiveAgencyCount < 1.2);
  assert.ok(b.signalInputs.featureVector.closestTimeGaleWindFieldCoverageEffectiveAgencyCount > 2.9);
  assert.ok(b.forecast.signals.T8.riskIndex > a.forecast.signals.T8.riskIndex + 0.05);
}

// Sparse long-interval guidance should not be treated as equally certain as the same
// hazardous passage confirmed by intermediate official forecast points.
{
  const sparse = () => source(
    [point(BASE, 18.0, 118.0, 30, { kind: 'analysis' })],
    [point('2026-08-22T12:00:00Z', 26.0, 110.0, 30)]
  );
  const dense = () => source(
    [point(BASE, 18.0, 118.0, 30, { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 20.0, 116.0, 30),
      point('2026-08-22T00:00:00Z', 22.0, 114.0, 30),
      point('2026-08-22T06:00:00Z', 24.0, 112.0, 30),
      point('2026-08-22T12:00:00Z', 26.0, 110.0, 30)
    ]
  );
  const a = run({ HKO: sparse(), CMA: sparse(), CWA: sparse(), JMA: null });
  const b = run({ HKO: dense(), CMA: dense(), CWA: dense(), JMA: null });
  assert.ok(b.threatAssessment.summary.confidenceIndex > a.threatAssessment.summary.confidenceIndex + 0.05);
  assert.ok(Math.abs(b.forecast.signals.T3.riskIndex - a.forecast.signals.T3.riskIndex) < 0.25);
}

'''
path.write_text(text.replace(anchor, extra + anchor, 1), encoding='utf-8')
