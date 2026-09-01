const assert = require('node:assert/strict');
const localWind = require('../analysis/hko-local-wind-shadow.js');

assert.equal(localWind.VERSION, 'hko-local-wind-shadow/v1');
assert.equal(localWind.parseHkoTime('202609011150'), '2026-09-01T03:50:00.000Z');
assert.equal(localWind.parseHkoTime('bad'), null);
assert.deepEqual(localWind.parseCsvLine('a,"b,c","d""e"'), ['a', 'b,c', 'd"e']);

const csv = [
  'Date time,Automatic Weather Station,10-Minute Mean Wind Direction(Compass points),10-Minute Mean Speed(km/hour),10-Minute Maximum Gust(km/hour)',
  '202609011150,Waglan Island,East,61,73',
  '202609011150,Tate\'s Cairn,N/A,40,56',
  '202609011150,Green Island,North,32,40',
  '202609011150,Hong Kong Sea School,N/A,N/A,N/A',
  '202609011150,"Station, Test",Variable,,42'
].join('\n');

const stations = localWind.parseCsv(csv);
assert.equal(stations.length, 5);
assert.deepEqual(stations[0], {
  observedAt: '2026-09-01T03:50:00.000Z',
  station: 'Waglan Island',
  meanDirection: 'East',
  meanSpeedKmh: 61,
  maxGustKmh: 73
});
assert.equal(stations[3].meanSpeedKmh, null);
assert.equal(stations[3].maxGustKmh, null);
assert.equal(stations[4].station, 'Station, Test');
assert.equal(stations[4].meanSpeedKmh, null);
assert.equal(stations[4].maxGustKmh, 42);

const summary = localWind.summarize(stations);
assert.equal(summary.dataTimestamp, '2026-09-01T03:50:00.000Z');
assert.equal(summary.stationCount, 5);
assert.equal(summary.validMeanStationCount, 3);
assert.equal(summary.validGustStationCount, 4);
assert.deepEqual(summary.maximumMean, { station: 'Waglan Island', valueKmh: 61 });
assert.deepEqual(summary.maximumGust, { station: 'Waglan Island', valueKmh: 73 });
assert.equal(summary.meanStrongStationCount, 1);
assert.equal(summary.meanGaleStationCount, 0);
assert.equal(summary.gustStrongStationCount, 3);
assert.equal(summary.gustGaleStationCount, 1);
assert.deepEqual(summary.meanStrongStations, [{ station: 'Waglan Island', valueKmh: 61 }]);
assert.deepEqual(summary.gustGaleStations, [{ station: 'Waglan Island', valueKmh: 73 }]);

console.log('hko-local-wind-shadow tests passed');
