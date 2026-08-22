'use strict';

const assert = require('node:assert/strict');
const wind = require('../analysis/wind-field-overlay.js');

(async () => {
  assert.equal(wind.VERSION, 'wind-field-overlay/v1.5');
  assert.equal(wind.OPEN_METEO_ENDPOINT, 'https://api.open-meteo.com/v1/forecast');
  assert.equal(wind.OPEN_METEO_MODEL, 'ecmwf_ifs');
  assert.equal(wind.WIND_PANE_NAME, 'stormWindFieldPane');
  assert.equal(wind.WIND_PANE_Z_INDEX, 350);
  assert.equal(wind.MAX_LOCAL_PATCHES, 2);
  assert.equal(wind.RATE_LIMIT_BACKOFF_MS, 65 * 1000);

  {
    const mobileWide = wind.samplingProfile({ mobile: true, zoom: 4 });
    assert.deepEqual(
      { baseRows: mobileWide.baseRows, baseCols: mobileWide.baseCols, coreRows: mobileWide.coreRows, coreCols: mobileWide.coreCols },
      { baseRows: 7, baseCols: 9, coreRows: 9, coreCols: 9 }
    );
    assert.equal(mobileWide.coreRadiusKm, 460);
    assert.equal(mobileWide.maxLocalPatches, 2);

    const mobileClose = wind.samplingProfile({ mobile: true, zoom: 6 });
    assert.equal(mobileClose.baseRows, 7);
    assert.equal(mobileClose.baseCols, 9);
    assert.equal(mobileClose.coreRows, 11);
    assert.equal(mobileClose.coreCols, 11);
    assert.equal(mobileClose.coreRadiusKm, 320);
    assert.equal(mobileClose.maxLocalPatches, 1);

    const desktopWide = wind.samplingProfile({ mobile: false, zoom: 4 });
    assert.equal(desktopWide.baseRows, 8);
    assert.equal(desktopWide.baseCols, 10);

    const mobileWideLocations =
      mobileWide.baseRows * mobileWide.baseCols +
      mobileWide.maxLocalPatches * mobileWide.coreRows * mobileWide.coreCols;
    const mobileCloseLocations =
      mobileClose.baseRows * mobileClose.baseCols +
      mobileClose.maxLocalPatches * mobileClose.coreRows * mobileClose.coreCols;
    assert.ok(mobileWideLocations <= 225);
    assert.ok(mobileCloseLocations <= 184);
  }

  {
    const snapped = wind.snapStormCenter({ key: 'a', lat: 20.12, lon: 130.13 });
    assert.equal(snapped.lat, 20);
    assert.equal(snapped.lon, 130.25);
    assert.equal(snapped.key, 'a');
  }

  {
    assert.equal(wind.isRateLimitError(new Error('wind-http-429:Minutely API request limit exceeded')), true);
    assert.equal(wind.isRateLimitError(new Error('wind-http-400:test')), false);
  }

  {
    const north = wind.meteorologicalWindToUv(10, 0);
    assert.ok(Math.abs(north.u) < 1e-9);
    assert.ok(Math.abs(north.v + 10) < 1e-9);

    const east = wind.meteorologicalWindToUv(10, 90);
    assert.ok(Math.abs(east.u + 10) < 1e-9);
    assert.ok(Math.abs(east.v) < 1e-9);
  }

  {
    assert.equal(
      new Date(wind.parseGmtTime('2026-08-22T06:00')).toISOString(),
      '2026-08-22T06:00:00.000Z'
    );
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
    const core = wind.buildStormCenteredGrid(
      { key: 'SAUDEL', lat: 23, lon: 130, sourceCount: 4 },
      { radiusKm: 360, rows: 13 }
    );
    assert.equal(core.kind, 'storm-core');
    assert.equal(core.stormKey, 'SAUDEL');
    assert.equal(core.rows, 13);
    assert.equal(core.cols, 13);
    assert.equal(core.points.length, 169);
    assert.equal(core.centerLat, 23);
    assert.equal(core.centerLon, 130);
    assert.ok(core.latStep < 0.6);
    assert.ok(core.lonStep < 0.7);
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
    const base = {
      south: 0, north: 2, west: 0, east: 2,
      rows: 2, cols: 2, latStep: 2, lonStep: 2,
      vectors: Array.from({ length: 4 }, () => ({ u: 1, v: 0 }))
    };
    const local = {
      stormKey: 'storm-a',
      south: 0.5, north: 1.5, west: 0.5, east: 1.5,
      rows: 2, cols: 2, latStep: 1, lonStep: 1,
      vectors: Array.from({ length: 4 }, () => ({ u: 0, v: 5 }))
    };
    const refined = wind.interpolateAdaptiveVector(base, [local], 1, 1);
    assert.equal(refined.refined, true);
    assert.equal(refined.stormKey, 'storm-a');
    assert.ok(Math.abs(refined.v - 5) < 1e-9);
    const background = wind.interpolateAdaptiveVector(base, [local], 0.1, 0.1);
    assert.equal(background.refined, false);
    assert.ok(Math.abs(background.u - 1) < 1e-9);
  }

  {
    const nowMs = Date.parse('2026-08-22T16:00:00Z');
    const centers = wind.extractStormCenters([
      {
        observedAt: '2026-08-22T15:55:00Z',
        group: { key: 'storm-a' },
        sources: {
          HKO: { current: { lat: 20, lon: 130 } },
          CMA: { current: { lat: 22, lon: 132 } },
          JMA: { current: { lat: 21, lon: 131 } }
        }
      },
      {
        observedAt: '2026-08-22T14:00:00Z',
        group: { key: 'stale' },
        sources: { HKO: { current: { lat: 10, lon: 110 } } }
      }
    ], { nowMs, maxAgeMs: 30 * 60 * 1000 });
    assert.equal(centers.length, 1);
    assert.equal(centers[0].key, 'storm-a');
    assert.equal(centers[0].lat, 21);
    assert.equal(centers[0].lon, 131);
    assert.equal(centers[0].sourceCount, 3);
  }

  {
    const spec = wind.buildCoordinateGrid(
      { south: 10, north: 12, west: 100, east: 102 },
      { rows: 4, cols: 4, padRatio: 0 }
    );
    const payload = Array.from({ length: spec.points.length }, (_, index) => ({
      hourly: {
        time: ['2026-08-22T06:00'],
        wind_speed_10m: [5 + (index % 2)],
        wind_direction_10m: [180]
      }
    }));
    const parsed = wind.parseOpenMeteoGrid(spec, payload);
    assert.equal(parsed.vectors.length, spec.points.length);
    assert.equal(parsed.validTime, '2026-08-22T06:00');
    assert.ok(parsed.vectors.every(vector => vector.v > 0));
  }

  {
    const spec = wind.buildCoordinateGrid(
      { south: 10, north: 12, west: 100, east: 102 },
      { rows: 4, cols: 4, padRatio: 0 }
    );
    let requestedUrl = '';
    const payload = Array.from({ length: spec.points.length }, () => ({
      hourly: {
        time: ['2026-08-22T06:00'],
        wind_speed_10m: [8],
        wind_direction_10m: [90]
      }
    }));
    const result = await wind.fetchWindGrid(spec, {
      fetchImpl: async url => {
        requestedUrl = String(url);
        return { ok: true, json: async () => payload };
      }
    });
    assert.equal(result.vectors.length, 16);
    assert.ok(requestedUrl.startsWith('https://api.open-meteo.com/v1/forecast?'));
    assert.match(requestedUrl, /hourly=wind_speed_10m%2Cwind_direction_10m/);
    assert.match(requestedUrl, /models=ecmwf_ifs/);
    assert.match(requestedUrl, /forecast_hours=1/);
    assert.match(requestedUrl, /cell_selection=nearest/);
    const requested = new URL(requestedUrl);
    assert.equal(requested.searchParams.get('elevation').split(',').length, spec.points.length);
    assert.ok(requested.searchParams.get('elevation').split(',').every(value => value === 'nan'));
  }

  {
    const spec = wind.buildCoordinateGrid(
      { south: 10, north: 12, west: 100, east: 102 },
      { rows: 4, cols: 4, padRatio: 0 }
    );
    await assert.rejects(
      wind.fetchWindGrid(spec, {
        fetchImpl: async () => ({
          ok: false,
          status: 400,
          json: async () => ({ reason: 'test-api-reason' })
        })
      }),
      /wind-http-400:test-api-reason/
    );
  }

  {
    const spec = wind.buildCoordinateGrid(
      { south: 10, north: 12, west: 100, east: 102 },
      { rows: 4, cols: 4, padRatio: 0 }
    );
    await assert.rejects(
      wind.fetchWindGrid(spec, {
        fetchImpl: async () => ({
          ok: false,
          status: 429,
          json: async () => ({ reason: 'Minutely API request limit exceeded' })
        })
      }),
      /wind-http-429:Minutely API request limit exceeded/
    );
  }

  console.log('wind-field-overlay tests: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
