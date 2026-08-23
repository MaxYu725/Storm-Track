'use strict';

const assert = require('node:assert/strict');
const ui = require('../analysis/settings-panel-ui.js');

assert.equal(ui.VERSION, 'settings-panel-ui/v1');
assert.equal(ui.PANEL_ID, 'storm-panel');
assert.equal(ui.BETA_BODY_ID, 'settings-beta-body');
assert.equal(typeof ui.install, 'function');
assert.equal(typeof ui.autoInstall, 'function');

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
try {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { search: '' }
  });
  assert.equal(ui.betaEnabled(), false);
  globalThis.location.search = '?beta=hk-signal';
  assert.equal(ui.betaEnabled(), true);
} finally {
  if (originalDescriptor) Object.defineProperty(globalThis, 'location', originalDescriptor);
  else delete globalThis.location;
}

console.log('settings-panel-ui tests: OK');
