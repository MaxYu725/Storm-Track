'use strict';

const assert = require('node:assert/strict');
const parser = require('../analysis/hko-signal-statement.js');

const current = parser.extractStatements({
  warnsum: { WTCSGNL: { code: 'TC1', updateTime: '2026-08-31T20:45:00+08:00' } },
  warningInfo: {
    details: [{
      warningStatementCode: 'WTCSGNL',
      subtype: 'TC1',
      updateTime: '2026-08-31T20:45:00+08:00',
      contents: [
        '香港天文台發出最新熱帶氣旋警報',
        '一號戒備信號，現正生效。',
        '受沙德爾與東北季候風的共同影響，本港正普遍吹偏北風。受地形屏蔽，今晚及明早本港普遍吹強風的機會不大，一號戒備信號會至少維持至明日（9月1日）中午12時。',
        '隨著沙德爾在明日下午至星期三（9月2日）靠近廣東東部沿岸並逐漸增強，預料本港風力會逐步上升。天文台會視乎沙德爾的強度、其相關的強風區與珠江口的距離，以及本地風力變化，評估屆時是否需要改發三號強風信號。'
      ]
    }]
  }
});

assert.equal(current.currentSignal, '一號戒備信號');
assert.equal(current.primary.kind, 'maintain_until');
assert.equal(current.primary.certainty, 'explicit');
assert.equal(current.primary.timeText, '明日（9月1日）中午12時');
assert.match(current.primary.summary, /一號戒備信號至少維持至 明日（9月1日）中午12時/);
assert.equal(current.secondary.kind, 'assessment');
assert.equal(current.secondary.targetSignal, '三號強風信號');
assert.doesNotMatch(current.secondary.summary, /預計|將於|時間/);

const exactChange = parser.classifySentence('天文台將於今晚10時改發三號強風信號。', {
  currentSignal: '一號戒備信號',
  updateTime: '2026-08-31T21:00:00+08:00',
  sourceCode: 'WTCSGNL'
});
assert.equal(exactChange.kind, 'change_at');
assert.equal(exactChange.certainty, 'explicit');
assert.equal(exactChange.targetSignal, '三號強風信號');
assert.equal(exactChange.timeText, '今晚10時');
assert.match(exactChange.summary, /三號強風信號：今晚10時改發/);

const windowChange = parser.classifySentence('天文台預計在明日下午2時至5時之間改發八號烈風或暴風信號。', {
  currentSignal: '三號強風信號'
});
assert.equal(windowChange.kind, 'change_window');
assert.equal(windowChange.certainty, 'explicit');
assert.equal(windowChange.targetSignal, '八號烈風或暴風信號');
assert.equal(windowChange.timeText, '明日下午2時至5時之間');
assert.match(windowChange.summary, /八號烈風或暴風信號改發時段：明日下午2時至5時之間/);
assert.doesNotMatch(windowChange.summary, /考慮/);

const deadline = parser.classifySentence('天文台將在下午5時20分或之前發出八號東北烈風或暴風信號。', {
  currentSignal: '三號強風信號',
  sourceCode: 'WTCPRE8'
});
assert.equal(deadline.kind, 'change_deadline');
assert.equal(deadline.certainty, 'explicit');
assert.equal(deadline.targetSignal, '八號烈風或暴風信號');
assert.equal(deadline.timeText, '下午5時20分或之前');
assert.match(deadline.summary, /八號烈風或暴風信號：下午5時20分或之前發出/);
assert.doesNotMatch(deadline.summary, /或之前或之前/);

const unlikely = parser.classifySentence('預料未來數小時改發三號強風信號的機會不大。', {
  currentSignal: '一號戒備信號'
});
assert.equal(unlikely.kind, 'unlikely_change');
assert.equal(unlikely.targetSignal, '三號強風信號');

const generic = parser.classifySentence('天文台會視乎熱帶氣旋的強度及本地風力變化，評估是否需要改發較高熱帶氣旋警告信號。', {
  currentSignal: '一號戒備信號'
});
assert.equal(generic.kind, 'assessment');
assert.equal(generic.certainty, 'conditional');
assert.equal(generic.timeText, null);

assert.equal(parser.classifySentence('預料明日本港部分地區雨勢較大。', {}), null);

console.log('hko-signal-statement tests: OK');