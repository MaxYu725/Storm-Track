(function attachHkoWarningHistory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HkoWarningHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHkoWarningHistory() {
  'use strict';

  const VERSION = 'hko-warning-history/v1';
  const SOURCE_URL = 'https://www.hko.gov.hk/dps/wxinfo/climat/warndb/tc.dat';

  function parseClock(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!digits || digits.length > 4) return null;
    const padded = digits.padStart(4, '0');
    const hour = Number(padded.slice(0, 2));
    const minute = Number(padded.slice(2, 4));
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  function hktToIso({ year, month, day, clock, summerTime = false }) {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const parsed = parseClock(clock);
    if (![y, m, d].every(Number.isInteger) || !parsed || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const offsetHours = summerTime ? 9 : 8;
    const ms = Date.UTC(y, m - 1, d, parsed.hour - offsetHours, parsed.minute, 0, 0);
    const date = new Date(ms);
    if (!Number.isFinite(ms)) return null;
    return date.toISOString();
  }

  function signalCode(level, direction) {
    const numeric = Number(level);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (numeric === 8) {
      const dir = String(direction || '').trim().toUpperCase();
      return ['NE', 'SE', 'SW', 'NW'].includes(dir) ? `TC8${dir}` : 'TC8';
    }
    return `TC${numeric}`;
  }

  function parseDataLine(line, provisional = false) {
    const fields = String(line || '').replace(/^\uFEFF/, '').split(/\t/);
    if (fields.length < 16) return null;
    if (String(fields[1] || '').trim().toUpperCase() === 'MSN') return null;
    const level = Number(fields[3]);
    if (!Number.isFinite(level) || level < 1) return null;

    const startAt = hktToIso({
      clock: fields[5],
      day: fields[6],
      month: fields[7],
      year: fields[8],
      summerTime: String(fields[9] || '').trim().toUpperCase() === 'S'
    });
    const endAt = hktToIso({
      clock: fields[10],
      day: fields[11],
      month: fields[12],
      year: fields[13],
      summerTime: String(fields[14] || '').trim().toUpperCase() === 'S'
    });
    if (!startAt || !endAt) return null;

    return {
      schemaVersion: VERSION,
      cycloneId: String(fields[0] || '').trim() || null,
      intensityCode: String(fields[1] || '').trim() || null,
      cycloneName: String(fields[2] || '').trim() || null,
      signal: signalCode(level, fields[4]),
      signalLevel: level,
      direction: level === 8 ? String(fields[4] || '').trim().toUpperCase() || null : null,
      startAt,
      endAt,
      durationRaw: String(fields[15] || '').trim() || null,
      provisional: Boolean(provisional)
    };
  }

  function parseDataset(text) {
    const records = [];
    let provisional = false;
    let provisionalMarkerPresent = false;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, '').trimEnd();
      if (!line) continue;
      if (line.trim() === 'UUUU') {
        provisional = true;
        provisionalMarkerPresent = true;
        continue;
      }
      const record = parseDataLine(line, provisional);
      if (record) records.push(record);
    }
    records.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)
      || a.signalLevel - b.signalLevel
      || String(a.signal).localeCompare(String(b.signal)));
    return {
      schemaVersion: VERSION,
      provisionalMarkerPresent,
      recordCount: records.length,
      provisionalRecordCount: records.filter(item => item.provisional).length,
      records
    };
  }

  function overlaps(record, from, to) {
    const start = Date.parse(record?.startAt || '');
    const end = Date.parse(record?.endAt || '');
    const fromMs = Date.parse(from || '');
    const toMs = Date.parse(to || '');
    if (![start, end, fromMs, toMs].every(Number.isFinite)) return false;
    return start <= toMs && end >= fromMs;
  }

  return Object.freeze({
    VERSION,
    SOURCE_URL,
    parseClock,
    hktToIso,
    signalCode,
    parseDataLine,
    parseDataset,
    overlaps
  });
});
