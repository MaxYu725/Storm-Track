'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const archive = require('../analysis/archive-pagination.js');

function item(id) { return { id, year: 2026, name_en: id }; }
function response(ids, offset, limit, includePagination = true) {
  return {
    storms: ids.map(item),
    ...(includePagination ? { pagination: { offset, limit, count: ids.length } } : {})
  };
}

test('multiple storm pages append without silent overlap or data loss', () => {
  const a = archive.appendStormPage([], response(['A','B'],0,2), 0,2);
  assert.deepEqual(a.storms.map(s => s.id), ['A','B']);
  assert.equal(a.hasMore,true);
  assert.equal(a.incomplete,false);
  const b = archive.appendStormPage(a.storms,response(['C','D'],2,2),2,2);
  assert.deepEqual(b.storms.map(s => s.id), ['A','B','C','D']);
  assert.equal(b.hasMore,true);
  const last = archive.appendStormPage(b.storms,response(['E'],4,2),4,2);
  assert.deepEqual(last.storms.map(s => s.id), ['A','B','C','D','E']);
  assert.equal(last.hasMore,false);
  assert.equal(last.incomplete,false);
});

test('full first page without pagination metadata is explicitly incomplete', () => {
  const page = archive.appendStormPage([], response(['A','B'],0,2,false),0,2);
  assert.equal(page.hasMore,false);
  assert.equal(page.incomplete,true);
});

test('smaller first page without pagination metadata can still be shown', () => {
  const page = archive.appendStormPage([], response(['A'],0,2,false),0,2);
  assert.equal(page.hasMore,false);
  assert.equal(page.incomplete,false);
});

test('offset requests require explicit matching pagination capability', () => {
  const existing=[item('A'),item('B')];
  assert.throws(() => archive.appendStormPage(existing,response(['C','D'],2,2,false),2,2),/未確認支援 offset/);
  assert.throws(() => archive.appendStormPage(existing,response(['C','D'],0,2),2,2),/未確認支援 offset/);
});

test('duplicate, out-of-range, and mismatched pages fail closed', () => {
  const existing=[item('A'),item('B')];
  assert.throws(() => archive.appendStormPage(existing,response(['B','C'],2,2),2,2),/重複/);
  assert.throws(() => archive.appendStormPage(existing,response(['C','C'],2,2),2,2),/重複/);
  assert.throws(() => archive.appendStormPage(existing,response(['C'],3,2),3,2),/起點不一致/);
  assert.throws(() => archive.appendStormPage([],response(['A','B','C'],0,2),0,2),/超出限制/);
  assert.throws(() => archive.appendStormPage([],{storms:[{id:''}]},0,2),/無效/);
  assert.throws(() => archive.appendStormPage([],{storm:[]},0,2),/格式/);
});

test('advisory cap and reported D1 count cannot be presented as complete playback', () => {
  let coverage=archive.advisoryCoverage(new Array(200).fill({id:'item'}),200);
  assert.equal(coverage.incomplete,true);
  assert.equal(coverage.reason,'page-limit-reached');
  coverage=archive.advisoryCoverage(new Array(199).fill({id:'item'}),201);
  assert.equal(coverage.incomplete,true);
  assert.equal(coverage.reason,'reported-count-exceeds-loaded');
  coverage=archive.advisoryCoverage(new Array(199).fill({id:'item'}),199);
  assert.equal(coverage.incomplete,false);
  coverage=archive.advisoryCoverage([],null);
  assert.equal(coverage.incomplete,false);
  assert.equal(coverage.reported,null);
});

test('frontend requests offset pages and exposes archive limitations without touching forecast', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.match(html,/src="\.\/analysis\/archive-pagination\.js"/);
  assert.match(html,/function loadMoreArchiveStorms\(/);
  assert.match(html,/StormArchivePagination\.appendStormPage\(archiveState\.storms, data, offset/);
  assert.match(html,/offset=\$\{offset\}/);
  assert.match(html,/id="archive-more-storms"/);
  assert.match(html,/id="archive-advisory-coverage"/);
  assert.match(html,/archiveState\.frameSerial \+= 1;/);
  assert.match(html,/正式 API 分頁功能仍待確認/);
});
