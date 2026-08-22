'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const truth = require('../analysis/hko-warning-truth.js');

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

assert.equal(truth.VERSION, 'hko-warning-truth/v1');
assert.equal(truth.normalizeTcCode('tc1'), 'TC1');
assert.equal(truth.signalLevel('TC1'), 1);
assert.equal(truth.signalLevel('TC3'), 3);
assert.equal(truth.signalLevel('TC8NE'), 8);
assert.equal(truth.signalLevel('TC9'), 9);
assert.equal(truth.signalLevel('TC10'), 10);
assert.equal(truth.normalizeTcCode('WRAINR'), null);

const noSignal = truth.normalizeSnapshot({
  warnsum: {},
  warningInfo: {},
  swt: {
    swt: [{
      desc: '天文台會密切監察其動向及本地風力變化，評估是否需要發出熱帶氣旋警告信號。',
      updateTime: '2026-08-22T09:35:00+08:00'
    }]
  },
  retrievedAt: '2026-08-22T10:00:00+08:00',
  sourceHashes: { warnsum: 'a', warningInfo: 'b', swt: 'c' },
  sourceCommit: 'abc'
});
assert.equal(noSignal.truth.present, false);
assert.equal(noSignal.truth.code, null);
assert.equal(noSignal.context.specialWeatherTips.length, 1);
assert.match(noSignal.context.specialWeatherTips[0].desc, /評估是否需要發出熱帶氣旋警告信號/);

const tc1 = truth.normalizeSnapshot({
  warnsum: {
    WTCSGNL: {
      name: '熱帶氣旋警告信號',
      code: 'TC1',
      actionCode: 'ISSUE',
      type: '一號戒備信號',
      issueTime: '2026-08-22T12:40:00+08:00',
      updateTime: '2026-08-22T12:40:00+08:00'
    }
  },
  warningInfo: {
    details: [{
      contents: ['一號戒備信號在下午12時40分發出。'],
      subtype: 'TC1',
      warningStatementCode: 'WTCSGNL',
      updateTime: '2026-08-22T12:40:00+08:00'
    }]
  },
  swt: { swt: [] },
  retrievedAt: '2026-08-22T12:42:00+08:00'
});
assert.equal(tc1.truth.present, true);
assert.equal(tc1.truth.code, 'TC1');
assert.equal(tc1.truth.level, 1);
assert.equal(tc1.truth.actionCode, 'ISSUE');
assert.equal(tc1.truth.issueTime, '2026-08-22T12:40:00+08:00');
assert.equal(tc1.truth.details.length, 1);

const tc1UpdatedText = truth.normalizeSnapshot({
  warnsum: {
    WTCSGNL: {
      code: 'TC1',
      actionCode: 'ISSUE',
      issueTime: '2026-08-22T12:40:00+08:00',
      updateTime: '2026-08-22T13:40:00+08:00'
    }
  },
  warningInfo: {
    details: [{
      contents: ['一號戒備信號仍然生效，最新公報文字已更新。'],
      subtype: 'TC1',
      warningStatementCode: 'WTCSGNL',
      updateTime: '2026-08-22T13:40:00+08:00'
    }]
  },
  swt: { swt: [] },
  retrievedAt: '2026-08-22T13:41:00+08:00'
});
assert.deepEqual(truth.truthStateMaterial(tc1.truth), truth.truthStateMaterial(tc1UpdatedText.truth));
assert.equal(hash(truth.truthStateMaterial(tc1.truth)), hash(truth.truthStateMaterial(tc1UpdatedText.truth)));
assert.notDeepEqual(tc1.truth, tc1UpdatedText.truth);

const tc8 = truth.normalizeSnapshot({
  warnsum: {
    WTCSGNL: {
      code: 'TC8NE', actionCode: 'ISSUE', type: '八號東北烈風或暴風信號',
      issueTime: '2026-08-23T18:00:00+08:00', updateTime: '2026-08-23T18:00:00+08:00'
    }
  },
  warningInfo: {
    details: [
      { warningStatementCode: 'WTCPRE8', updateTime: '2026-08-23T16:00:00+08:00', contents: ['預警八號特別報告'] },
      { warningStatementCode: 'WTCSGNL', subtype: 'TC8NE', updateTime: '2026-08-23T18:00:00+08:00', contents: ['八號東北烈風或暴風信號'] }
    ]
  },
  swt: { swt: [] },
  retrievedAt: '2026-08-23T18:01:00+08:00'
});
assert.equal(tc8.truth.level, 8);
assert.equal(tc8.context.pre8.length, 1);
assert.equal(tc8.context.pre8[0].warningStatementCode, 'WTCPRE8');

const cancelledFromSummary = truth.summaryState({
  WTCSGNL: { code: 'CANCEL', actionCode: 'CANCEL', issueTime: '2026-08-24T01:00:00+08:00' }
});
assert.equal(cancelledFromSummary.present, false);
assert.equal(cancelledFromSummary.code, 'CANCEL');
assert.equal(cancelledFromSummary.actionCode, 'CANCEL');

const cancelledFromDetail = truth.normalizeSnapshot({
  warnsum: {},
  warningInfo: {
    details: [{
      warningStatementCode: 'WTCSGNL',
      subtype: 'CANCEL',
      updateTime: '2026-08-24T01:00:00+08:00',
      contents: ['所有熱帶氣旋警告信號取消。']
    }]
  },
  swt: { swt: [] },
  retrievedAt: '2026-08-24T01:01:00+08:00'
});
assert.equal(cancelledFromDetail.truth.present, false);
assert.equal(cancelledFromDetail.truth.code, 'CANCEL');
assert.equal(cancelledFromDetail.truth.actionCode, 'CANCEL');
assert.equal(cancelledFromDetail.truth.updateTime, '2026-08-24T01:00:00+08:00');

console.log('hko warning truth tests: OK');
