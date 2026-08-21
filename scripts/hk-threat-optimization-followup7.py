from pathlib import Path

path = Path('tests/hk-threat-rule-scenarios.test.cjs')
text = path.read_text(encoding='utf-8')
anchor = "console.log('HK threat rule scenarios: OK');"
if text.count(anchor) != 1:
    raise SystemExit('followup7 final scenario anchor mismatch')
extra = r'''
// Wind-field minority scenarios must survive consensus dilution just as track minority
// scenarios do. Two safe agencies should reduce confidence, not erase a credible
// agency that explicitly puts Hong Kong inside strong-wind coverage.
{
  const huge = [{ level: '7', ne: 900, se: 900, sw: 900, nw: 900 }];
  const small = [{ level: '7', ne: 100, se: 100, sw: 100, nw: 100 }];
  const make = radii => source(
    [point(BASE, 20.5, 107.5, 24, { kind: 'analysis', windRadii: radii })],
    [point('2026-08-22T00:00:00Z', 20.7, 108.0, 24, { windRadii: radii })]
  );
  const result = run({ HKO: make(huge), CMA: make(small), CWA: make(small), JMA: null });
  assert.equal(result.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount, 1);
  assert.notEqual(result.forecast.signals.T3.likelihood, 'unlikely');
  assert.ok(result.forecast.signals.T3.confidenceIndex < 0.9);
}

// The same minority preservation applies to a gale-radius scenario: one agency saying
// Hong Kong enters gale coverage is a possible T8 scenario even if peers disagree.
{
  const huge = [{ level: '10', ne: 900, se: 900, sw: 900, nw: 900 }];
  const small = [{ level: '10', ne: 100, se: 100, sw: 100, nw: 100 }];
  const make = radii => source(
    [point(BASE, 20.5, 107.5, 30, { kind: 'analysis', windRadii: radii })],
    [point('2026-08-22T00:00:00Z', 20.7, 108.0, 30, { windRadii: radii })]
  );
  const result = run({ HKO: make(huge), CMA: make(small), CWA: make(small), JMA: null });
  assert.equal(result.signalInputs.featureVector.latestGaleWindFieldCoverageAgencyCount, 1);
  assert.notEqual(result.forecast.signals.T8.likelihood, 'unlikely');
  assert.notEqual(result.forecast.signals.T8.likelihood, 'likely');
}

// A short-lived intensity spike should not rank like sustained severe winds along the
// same close passage.
{
  const make = winds => source(
    [point(BASE, 19.0, 121.5, winds[0], { kind: 'analysis' })],
    [
      point('2026-08-21T18:00:00Z', 20.3, 118.5, winds[1]),
      point('2026-08-22T00:00:00Z', 21.2, 116.5, winds[2]),
      point('2026-08-22T06:00:00Z', 21.8, 115.2, winds[3])
    ]
  );
  const transient = run({ HKO: make([24, 42, 16, 12]), CMA: make([24, 42, 16, 12]), CWA: make([24, 42, 16, 12]), JMA: null });
  const sustained = run({ HKO: make([24, 42, 38, 34]), CMA: make([24, 42, 38, 34]), CWA: make([24, 42, 38, 34]), JMA: null });
  assert.notEqual(transient.forecast.signals.T8.likelihood, 'likely');
  assert.ok(sustained.forecast.signals.T8.riskIndex > transient.forecast.signals.T8.riskIndex + 0.08);
  assert.ok(sustained.forecast.signals.T8.persistenceHours > transient.forecast.signals.T8.persistenceHours);
}

// Compact knot labels are common in wind-radius feeds and must map to the correct
// strong/gale thresholds without relying on whitespace.
{
  const r34 = [{ level: '34KT', ne: 900, se: 900, sw: 900, nw: 900 }];
  const r50 = [{ level: '50KT', ne: 900, se: 900, sw: 900, nw: 900 }];
  const make = radii => source(
    [point(BASE, 20.5, 107.5, 28, { kind: 'analysis', windRadii: radii })],
    [point('2026-08-22T00:00:00Z', 20.7, 108.0, 28, { windRadii: radii })]
  );
  const strong = run({ CMA: make(r34), HKO: null, JMA: null, CWA: null });
  const gale = run({ CMA: make(r50), HKO: null, JMA: null, CWA: null });
  assert.equal(strong.signalInputs.featureVector.latestStrongWindFieldCoverageAgencyCount, 1);
  assert.equal(strong.signalInputs.featureVector.latestGaleWindFieldCoverageAgencyCount, 0);
  assert.equal(gale.signalInputs.featureVector.latestGaleWindFieldCoverageAgencyCount, 1);
}

'''
path.write_text(text.replace(anchor, extra + anchor, 1), encoding='utf-8')
