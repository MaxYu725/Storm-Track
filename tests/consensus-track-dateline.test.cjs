'use strict';

const assert = require('node:assert/strict');
const core = require('../analysis/storm-analysis-core.js');

function nearDateLine(value, tolerance = 1e-6) {
    return Number.isFinite(value) && Math.abs(Math.abs(value) - 180) <= tolerance;
}

function source(agency, analysisLon, forecastLon, latOffset = 0) {
    const baseTime = '2026-08-20T00:00:00Z';
    return {
        agency,
        sourceId: `${agency}-dateline`,
        bulletinTime: baseTime,
        positions: [{
            kind: 'analysis',
            time: baseTime,
            lat: 10 + latOffset,
            lon: analysisLon
        }],
        forecast: [{
            kind: 'forecast',
            time: '2026-08-20T12:00:00Z',
            baseTime,
            lat: 12 + latOffset,
            lon: forecastLon
        }]
    };
}

(function testConsensusTrackUsesShortestLongitudeArcAcrossDateLine() {
    const track = core.buildConsensusTrackForGroup({
        key: 'DATELINE',
        sources: {
            HKO: source('HKO', 179, -179, 0),
            CMA: source('CMA', -179, 179, 0.2)
        }
    }, {
        generatedAt: '2026-08-20T00:10:00Z',
        consensusTrackStartLeadHours: 0,
        consensusTrackEndLeadHours: 12,
        consensusTrackStepHours: 6
    });

    assert.equal(track.state, 'ok');
    assert.equal(track.longitudeMethod, 'circular-mean-v1');
    assert.equal(track.dateLineSafeLongitude, true);
    assert.equal(track.semantics.dateLineSafeLongitude, true);

    const lead0 = track.points.find(point => point.leadHours === 0);
    assert.ok(lead0?.consensus);
    assert.equal(nearDateLine(lead0.consensus.lon), true, `lead0 consensus longitude was ${lead0.consensus.lon}`);
    assert.equal(lead0.consensus.longitudeMethod, 'circular-mean-v1');
    assert.equal(lead0.consensus.dateLineSafe, true);

    const lead6 = track.points.find(point => point.leadHours === 6);
    assert.ok(lead6?.consensus);
    assert.equal(lead6.entries.length, 2);
    assert.equal(lead6.entries.every(entry => entry.interpolated === true), true);
    assert.equal(lead6.entries.every(entry => nearDateLine(entry.lon)), true,
        `interpolated longitudes were ${lead6.entries.map(entry => entry.lon).join(', ')}`);
    assert.equal(nearDateLine(lead6.consensus.lon), true, `lead6 consensus longitude was ${lead6.consensus.lon}`);
    assert.ok(lead6.spread.distanceKm < 100, `date-line spread unexpectedly large: ${lead6.spread.distanceKm}`);

    const lead12 = track.points.find(point => point.leadHours === 12);
    assert.ok(lead12?.consensus);
    assert.equal(nearDateLine(lead12.consensus.lon), true, `lead12 consensus longitude was ${lead12.consensus.lon}`);
})();

console.log('consensus-track dateline tests: OK');