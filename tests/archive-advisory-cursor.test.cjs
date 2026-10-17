'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../analysis/archive-advisory-cursor.js');
const STORM = 'STC-2026-TEST';

function sample(index) {
  return {
    id: 'ADV-' + String(300 - index).padStart(4, '0'),
    storm_id: STORM,
    agency: 'HKO',
    issued_at: new Date(Date.parse('2026-10-17T10:00:00Z') - index * 3600000).toISOString()
  };
}
function page(rows, limit, hasMore, nextCursor, overrides = {}) {
  return {
    stormId: STORM,
    advisories: rows,
    pagination: {
      contract: api.CONTRACT, order: api.ORDER, limit,
      count: rows.length, hasMore, nextCursor, ...overrides
    }
  };
}

test('235 advisories replay in exact order across cursor pages', () => {
  const firstRows = Array.from({ length: 200 }, (_, i) => sample(i));
  const secondRows = Array.from({ length: 35 }, (_, i) => sample(i + 200));
  const first = api.appendAdvisoryPage([], page(firstRows, 200, true, 'opaque-2'), {
    stormId: STORM, limit: 200
  });
  assert.equal(first.supported, true);
  assert.equal(first.complete, false);
  assert.equal(first.nextCursor, 'opaque-2');
  const second = api.appendAdvisoryPage(first.advisories, page(secondRows, 200, false, null), {
    stormId: STORM, limit: 200, cursor: first.nextCursor, seenCursors: first.seenCursors
  });
  assert.equal(second.supported, true);
  assert.equal(second.hasMore, false);
  assert.equal(second.complete, true);
  assert.equal(second.advisories.length, 235);
  assert.equal(second.advisories[0].id, firstRows[0].id);
  assert.equal(second.advisories.at(-1).id, secondRows.at(-1).id);
  const chronological = [...second.advisories].reverse();
  assert.equal(chronological[0].id, secondRows.at(-1).id);
  assert.equal(chronological.at(-1).id, firstRows[0].id);
});

test('legacy Worker response is never mistaken for cursor support', () => {
  const legacy = api.appendAdvisoryPage([], {
    stormId: STORM, advisories: Array.from({length:200},(_,i)=>sample(i))
  }, {stormId:STORM,limit:200});
  assert.equal(legacy.supported,false);
  assert.equal(legacy.complete,false);
  assert.equal(legacy.hasMore,false);
  assert.equal(legacy.reason,'cursor-contract-not-verified');
  assert.throws(() => api.appendAdvisoryPage(legacy.advisories, {
    stormId:STORM,advisories:[sample(200)]
  }, {stormId:STORM,limit:200,cursor:'guessed'}), /未提供已驗證/);
});

test('replayed pages and cursor loops fail closed', () => {
  const first = api.appendAdvisoryPage([],page([sample(0),sample(1)],2,true,'cursor-2'),{
    stormId:STORM,limit:2
  });
  assert.throws(() => api.appendAdvisoryPage(first.advisories,page([sample(1),sample(2)],2,false,null),{
    stormId:STORM,limit:2,cursor:'cursor-2',seenCursors:first.seenCursors
  }),/跨頁重複/);
  assert.throws(() => api.appendAdvisoryPage(first.advisories,page([sample(2)],2,true,'cursor-2'),{
    stormId:STORM,limit:2,cursor:'cursor-2',seenCursors:first.seenCursors
  }),/游標循環/);
  assert.throws(() => api.appendAdvisoryPage(first.advisories,page([sample(2)],2,false,null),{
    stormId:STORM,limit:2,cursor:'unknown',seenCursors:first.seenCursors
  }),/游標與已驗證/);
});

test('incorrect chronology, tie-break order and wrong storm cannot slip through', () => {
  const latest = sample(0), old = sample(1);
  assert.throws(() => api.appendAdvisoryPage([],page([old,latest],2,false,null),{
    stormId:STORM,limit:2
  }),/排序/);
  const tied = [{...latest,id:'A'},{...latest,id:'Z'}];
  assert.throws(() => api.appendAdvisoryPage([],page(tied,2,false,null),{
    stormId:STORM,limit:2
  }),/排序/);
  assert.throws(() => api.appendAdvisoryPage([],page([{
    ...latest,storm_id:'STC-OTHER'
  }],2,false,null),{stormId:STORM,limit:2}),/其他風暴/);
});

test('invalid contract metadata, oversized pages and unsafe cursor fail closed', () => {
  assert.throws(() => api.appendAdvisoryPage([],page([sample(0)],2,true,null),{
    stormId:STORM,limit:2
  }),/有效游標/);
  assert.throws(() => api.appendAdvisoryPage([],page([],2,true,'cursor'),{
    stormId:STORM,limit:2
  }),/空白分頁/);
  assert.throws(() => api.appendAdvisoryPage([],page([sample(0)],2,false,'extra'),{
    stormId:STORM,limit:2
  }),/末頁/);
  assert.throws(() => api.appendAdvisoryPage([],page([sample(0)],2,false,null,{order:'issued_at_desc'}),{
    stormId:STORM,limit:2
  }),/排序資訊/);
  assert.throws(() => api.appendAdvisoryPage([],page([sample(0)],2,false,null,{count:22}),{
    stormId:STORM,limit:2
  }),/count/);
  assert.throws(() => api.appendAdvisoryPage([],page([sample(0),sample(1),sample(2)],2,false,null),{
    stormId:STORM,limit:2
  }),/超出數量/);
});

test('no current homepage or Worker code is required by cursor helper', () => {
  assert.equal(api.CONTRACT,'storm-history-advisory-cursor/v1');
  assert.equal(api.ORDER,'issued_at_desc,id_desc');
  assert.equal(api.DEFAULT_LIMIT,200);
});
