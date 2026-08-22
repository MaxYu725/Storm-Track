'use strict';

const assert = require('node:assert/strict');
const ui = require('../analysis/frontend-hk-threat-ui.js');

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');

function setSearch(search) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { search }
  });
}

try {
  setSearch('');
  assert.equal(ui.isBetaEnabled(), false, 'normal URL must keep HK signal Beta disabled');
  assert.equal(ui.renderGroupSummary({ sources: {} }), '', 'normal URL must render no Beta summary');

  setSearch('?beta=other');
  assert.equal(ui.isBetaEnabled(), false, 'unrelated beta values must not enable HK signal Beta');
  assert.equal(ui.renderGroupSummary({ sources: {} }), '', 'unrelated beta values must render no Beta summary');

  setSearch('?beta=hk-signal');
  assert.equal(ui.isBetaEnabled(), true, 'explicit hk-signal query must enable Beta');
  assert.match(
    ui.renderGroupSummary({ sources: {} }),
    /香港影響 Beta：暫未有足夠資料/,
    'enabled Beta must render the HK impact Beta surface'
  );

  console.log('frontend HK signal beta gate tests passed');
} finally {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'location', originalDescriptor);
  } else {
    delete globalThis.location;
  }
}
