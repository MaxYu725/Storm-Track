'use strict';

const assert = require('node:assert/strict');
const wind = require('../analysis/wind-field-overlay.js');

{
  const north = wind.meteorologicalWindToUv(10, 0);
  assert.ok(Math.abs(north.u) < 1e-9);
  assert.ok(Math.abs(north.v + 10) < 1e-9);

  const east = wind.meteorologicalWindToUv(10, 90);
  assert.ok(Math.abs(east.u + 10) < 1e-9);
  assert.ok(Math.abs(east.v) < 1e-9);
}

{
  const spec = wind.buildCoordinateGrid(
    { south: 10, north: 12, west: 100, east: 102 },
    { rows: 4, cols: 4, padRatio: 0 }
  );
  assert.equal(spec.points.length, 16);
  assert.equal(spec.rows, 4);
  assert.equal(spec.cols, 4);
  assert.equal(spec.points[0].lat, 10);
  assert.equal(spec.points[0].lon, 100);
}

{
  const grid = {
    south: 0,
    north: 1,
    west: 0,
    east: 1,
    rows: 2,
    cols: 2,
    latStep: 1,
    lonStep: 1,
    vectors: [
      { u: 0, v: 0 },
      { u: 10, v: 0 },
      { u: 0, v: 10 },
      { u: 10, v: 10 }
    ]
  };
  const center = wind.interpolateVector(grid, 0.5, 0.5);
  assert.ok(Math.abs(center.u - 5) < 1e-9);
  assert.ok(Math.abs(center.v - 5) < 1e-9);
  assert.equal(wind.interpolateVector(grid, 3, 3), null);
}

{
  const spec = wind.buildCoordinateGrid(
    { south: 10, north: 12, west: 100, east: 102 },
    { rows: 4, cols: 4, padRatio: 0 }
  );
  const payload = Array.from({ length: spec.points.length }, (_, index) => ({
    current: {
      time: '2026-08-22T06:00',
      wind_speed_10m: 5 + (index % 2),
      wind_direction_10m: 180
    }
  }));
  const parsed = wind.parseOpenMeteoGrid(spec, payload);
  assert.equal(parsed.vectors.length, spec.points.length);
  assert.equal(parsed.validTime, '2026-08-22T06:00');
  assert.ok(parsed.vectors.every(vector => vector.v > 0));
}

console.log('wind-field-overlay tests: OK');
