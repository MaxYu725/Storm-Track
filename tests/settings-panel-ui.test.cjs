'use strict';

const assert = require('node:assert/strict');
const ui = require('../analysis/settings-panel-ui.js');

assert.equal(ui.VERSION, 'settings-panel-ui/v1');
assert.equal(ui.PANEL_ID, 'storm-panel');
assert.equal(ui.BETA_BODY_ID, 'settings-beta-body');
assert.equal(ui.CONSENSUS_TOGGLE_ID, 'toggle-consensus-track-beta');
assert.equal(ui.CONSENSUS_STORAGE_KEY, 'storm-track-consensus-track-beta-enabled-v1');
assert.equal(typeof ui.install, 'function');
assert.equal(typeof ui.autoInstall, 'function');
assert.equal(typeof ui.ensureConsensusOverlayScript, 'function');

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
try {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: { search: '' }
  });
  assert.equal(ui.betaEnabled(), false);
  assert.equal(ui.consensusToggleEnabled('', false), false);

  globalThis.location.search = '?beta=hk-signal';
  assert.equal(ui.betaEnabled(), true);
  assert.equal(ui.consensusToggleEnabled(globalThis.location.search, false), false, 'normal HK Signal Beta must default consensus off');
  assert.equal(ui.consensusToggleEnabled(globalThis.location.search, true), true, 'stored opt-in should enable the toggle');

  globalThis.location.search = '?beta=hk-signal&consensusTrack=1';
  assert.equal(ui.consensusToggleEnabled(globalThis.location.search, false), true, 'explicit visual entry should start enabled');

  globalThis.location.search = '?consensusTrack=1';
  assert.equal(ui.betaEnabled(), false);
  assert.equal(ui.consensusToggleEnabled(globalThis.location.search, true), false, 'consensus layer must remain gated by HK Signal Beta');
} finally {
  if (originalDescriptor) Object.defineProperty(globalThis, 'location', originalDescriptor);
  else delete globalThis.location;
}

console.log('settings-panel-ui tests: OK');