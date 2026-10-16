(function attachHkoLocalWindShadow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkoLocalWindShadow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkoLocalWindShadow() {
  'use strict';

  const VERSION = 'hko-local-wind-shadow/v1';
  const STRONG_WIND_KMH = 41;
  const GALE_WIND_KMH = 63;

  function finite(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function parseCsvLine(line) {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        cells.push(cell);
        cell = '';
      } else {
        cell += char;
      }
    }
    cells.push(cell);
    return cells;
  }

  function parseHkoTime(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    const hkt = `${year}-${month}-${day}T${hour}:${minute}:00+08:00`;
    const epoch = Date.parse(hkt);
    return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
  }

  function nullableText(value) {
    const text = String(value ?? '').trim();
    if (!text || /^n\/?a$/i.test(text)) return null;
    return text;
  }

  function nullableNumber(value) {
    const text = nullableText(value);
    return text == null ? null : finite(text);
  }

  function parseCsv(csvText) {
    const lines = String(csvText || '')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    return lines.slice(1).map(line => {
      const cells = parseCsvLine(line);
      const observedAt = parseHkoTime(cells[0]);
      const station = nullableText(cells[1]);
      if (!observedAt || !station) return null;
      return {
        observedAt,
        station,
        meanDirection: nullableText(cells[2]),
        meanSpeedKmh: nullableNumber(cells[3]),
        maxGustKmh: nullableNumber(cells[4])
      };
    }).filter(Boolean);
  }

  function maximumStation(stations, key) {
    return stations.reduce((best, station) => {
      const value = finite(station?.[key]);
      if (!Number.isFinite(value)) return best;
      if (!best || value > best.valueKmh) return { station: station.station, valueKmh: value };
      return best;
    }, null);
  }

  function thresholdStations(stations, key, thresholdKmh) {
    return stations
      .filter(station => Number.isFinite(finite(station?.[key])) && finite(station[key]) >= thresholdKmh)
      .map(station => ({ station: station.station, valueKmh: finite(station[key]) }))
      .sort((left, right) => right.valueKmh - left.valueKmh);
  }

  function topStations(stations, key, limit = 5) {
    return stations
      .filter(station => Number.isFinite(finite(station?.[key])))
      .map(station => ({ station: station.station, valueKmh: finite(station[key]) }))
      .sort((left, right) => right.valueKmh - left.valueKmh)
      .slice(0, limit);
  }

  function summarize(stations) {
    const rows = Array.isArray(stations) ? stations : [];
    const timestamps = rows.map(row => Date.parse(row.observedAt)).filter(Number.isFinite);
    const validMean = rows.filter(row => Number.isFinite(finite(row.meanSpeedKmh)));
    const validGust = rows.filter(row => Number.isFinite(finite(row.maxGustKmh)));
    const meanStrongStations = thresholdStations(rows, 'meanSpeedKmh', STRONG_WIND_KMH);
    const meanGaleStations = thresholdStations(rows, 'meanSpeedKmh', GALE_WIND_KMH);
    const gustStrongStations = thresholdStations(rows, 'maxGustKmh', STRONG_WIND_KMH);
    const gustGaleStations = thresholdStations(rows, 'maxGustKmh', GALE_WIND_KMH);

    return {
      schemaVersion: VERSION,
      dataTimestamp: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
      stationCount: rows.length,
      validMeanStationCount: validMean.length,
      validGustStationCount: validGust.length,
      thresholdsKmh: {
        strong: STRONG_WIND_KMH,
        gale: GALE_WIND_KMH
      },
      maximumMean: maximumStation(rows, 'meanSpeedKmh'),
      maximumGust: maximumStation(rows, 'maxGustKmh'),
      meanStrongStationCount: meanStrongStations.length,
      meanGaleStationCount: meanGaleStations.length,
      gustStrongStationCount: gustStrongStations.length,
      gustGaleStationCount: gustGaleStations.length,
      meanStrongStations,
      meanGaleStations,
      gustStrongStations,
      gustGaleStations,
      topMeanStations: topStations(rows, 'meanSpeedKmh'),
      topGustStations: topStations(rows, 'maxGustKmh')
    };
  }

  return Object.freeze({
    VERSION,
    STRONG_WIND_KMH,
    GALE_WIND_KMH,
    parseCsvLine,
    parseHkoTime,
    parseCsv,
    summarize
  });
});
