from pathlib import Path

REPLACEMENTS = [
    ('analysis/storm-analysis-core.js', 'asFiniteNumber'),
    ('analysis/hk-impact-engine.js', 'asFiniteNumber'),
    ('analysis/hko-signal-risk-inputs.js', 'finiteNumber'),
    ('analysis/hk-threat-assessment.js', 'finite'),
    ('analysis/basic-hk-signal-forecast.js', 'finite'),
]

for filename, helper in REPLACEMENTS:
    path = Path(filename)
    text = path.read_text(encoding='utf-8')
    old = f"""    function {helper}(value) {{\n        const number = Number(value);\n        return Number.isFinite(number) ? number : null;\n    }}"""
    # Newer files use two-space indentation.
    old2 = f"""  function {helper}(value) {{\n    const number = Number(value);\n    return Number.isFinite(number) ? number : null;\n  }}"""
    if old in text:
        new = f"""    function {helper}(value) {{\n        if (value == null || (typeof value === 'string' && value.trim() === '')) return null;\n        const number = Number(value);\n        return Number.isFinite(number) ? number : null;\n    }}"""
        text = text.replace(old, new, 1)
    elif old2 in text:
        new = f"""  function {helper}(value) {{\n    if (value == null || (typeof value === 'string' && value.trim() === '')) return null;\n    const number = Number(value);\n    return Number.isFinite(number) ? number : null;\n  }}"""
        text = text.replace(old2, new, 1)
    else:
        raise SystemExit(f'{filename}: {helper} anchor mismatch')
    path.write_text(text, encoding='utf-8')

# Dedicated regression: optional numeric data must never silently become zero.
Path('tests/hk-missing-numeric-semantics.test.cjs').write_text(r'''\'use strict\';

const assert = require('node:assert/strict');
const core = require('../analysis/storm-analysis-core.js');
const impactEngine = require('../analysis/hk-impact-engine.js');
const signalInputsEngine = require('../analysis/hko-signal-risk-inputs.js');
const threatEngine = require('../analysis/hk-threat-assessment.js');
const basic = require('../analysis/basic-hk-signal-forecast.js');

// Missing coordinates are missing, not (0, 0)-adjacent geometry.
assert.equal(core.haversineKm(null, 114, 22.3, 114.1), null);
assert.equal(impactEngine.haversineKm(null, 114, 22.3, 114.1), null);
assert.equal(signalInputsEngine.haversineKm(null, 114, 22.3, 114.1), null);

// A genuinely numeric zero remains a valid number.
assert.ok(Number.isFinite(core.haversineKm(0, 114, 22.3, 114.1)));

// Invalid source points with a missing latitude must be rejected rather than moved
// to the equator.
{
  const snapshot = core.buildStormAnalysisSnapshot({
    key: 'missing-coordinate',
    sources: {
      HKO: {
        bulletinTime: '2026-08-21T12:00:00Z',
        positions: [],
        forecast: [{ kind: 'forecast', time: '2026-08-21T18:00:00Z', lat: null, lon: 114 }]
      }
    }
  }, { generatedAt: '2026-08-21T12:00:00Z' });
  assert.equal(snapshot.sources.HKO.state, 'empty');
}

// Interpolation cannot manufacture a wind speed from a missing endpoint.
{
  const interpolated = core.interpolateTimedPoint([
    { timeMs: Date.parse('2026-08-21T12:00:00Z'), lat: 20, lon: 120, maximumWind: null },
    { timeMs: Date.parse('2026-08-21T14:00:00Z'), lat: 21, lon: 119, maximumWind: 18 }
  ], Date.parse('2026-08-21T13:00:00Z'));
  assert.equal(interpolated.maximumWind, null);
}

// Missing reference coordinates must fail at the reference contract, not be accepted
// as latitude/longitude zero.
{
  const assessment = threatEngine.buildHkThreatAssessment({
    snapshot: {
      generatedAt: '2026-08-21T12:00:00Z',
      referencePoint: { lat: null, lon: 114.1746 },
      sources: {}
    },
    generatedAt: '2026-08-21T12:00:00Z'
  });
  assert.equal(assessment.available, false);
  assert.equal(assessment.reason, 'reference-point-or-time-unavailable');
}

// Basic forecast fallback must use the real closest distance when an optional current
// distance is absent; null must not become 0 km.
{
  const result = basic.buildBasicHkSignalForecast({
    generatedAt: '2026-08-21T12:00:00Z',
    impact: {
      generatedAt: '2026-08-21T12:00:00Z',
      closestApproach: {
        consensus: { distanceKm: 600, time: '2026-08-22T12:00:00Z' }
      },
      agencyClosestApproaches: [],
      trend: { aggregate: 'steady' },
      uncertainty: { level: 'moderate' }
    },
    signalInputs: {
      generatedAt: '2026-08-21T12:00:00Z',
      coverage: { usableAgencyCount: 1 },
      featureVector: {
        usableAgencyCount: 1,
        currentDistanceMedianKm: null,
        currentMaximumWindMedianMs: null,
        closestMaximumWindMedianMs: null,
        closestTimeWindFieldCoverageAgencyCount: 0
      }
    }
  });
  assert.equal(result.available, true);
  assert.equal(result.impact.currentDistanceKm, 600);
}

console.log('HK missing numeric semantics: OK');
'''.replace("\\'use strict\\';", "'use strict';"), encoding='utf-8')

# Make the new contract part of the full regression command after patches are applied.
package = Path('workers/storm-analysis/package.json')
text = package.read_text(encoding='utf-8')
needle = 'node ../../tests/hk-threat-rule-scenarios.test.cjs && '
if needle not in text:
    raise SystemExit('package test anchor for missing numeric semantics not found')
text = text.replace(needle, needle + 'node ../../tests/hk-missing-numeric-semantics.test.cjs && ', 1)
package.write_text(text, encoding='utf-8')
