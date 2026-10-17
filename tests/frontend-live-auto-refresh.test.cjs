'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  assert.notEqual(start, -1, name + ' must exist');
  const brace = html.indexOf('{', start);
  let depth = 0;
  for (let i=brace; i<html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i+1);
  }
  throw new Error('Function not closed: ' + name);
}

function createContext() {
  const context = { result:null, document:{visibilityState:'visible'}, navigator:{onLine:true}};
  vm.createContext(context);
  const script = [
    "const LIVE_AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;",
    "let currentMode = 'live';",
    "let activeFetchCount = 0;",
    "let lastLiveRefreshStartedAt = Date.parse('2026-10-17T00:00:00Z');",
    "let pendingControllerReload = false;",
    extractFunction('shouldAutoRefreshLive'),
    "result = { shouldAutoRefreshLive, setMode: mode => currentMode = mode, setActive: count => activeFetchCount = count, setLast: ms => lastLiveRefreshStartedAt = ms, setPending: value => pendingControllerReload = value };"
  ].join('\n');
  vm.runInContext(script, context);
  return context;
}

test('foreground five-minute threshold does not refresh early', () => {
  const {result} = createContext();
  const base=Date.parse('2026-10-17T00:00:00Z');
  assert.equal(result.shouldAutoRefreshLive(base+4*60*1000+59000),false);
  assert.equal(result.shouldAutoRefreshLive(base+5*60*1000),true);
  result.setLast(base+5*60*1000);
  assert.equal(result.shouldAutoRefreshLive(base+5*60*1000),false);
});

test('hidden, offline, archive, pending PWA update, or active request blocks auto-refresh', () => {
  const c=createContext(),r=c.result,at=Date.parse('2026-10-17T00:06:00Z');
  assert.equal(r.shouldAutoRefreshLive(at),true);
  c.document.visibilityState='hidden'; assert.equal(r.shouldAutoRefreshLive(at),false);
  c.document.visibilityState='visible';
  c.navigator.onLine=false; assert.equal(r.shouldAutoRefreshLive(at),false);
  c.navigator.onLine=true;
  r.setMode('archive'); assert.equal(r.shouldAutoRefreshLive(at),false);
  r.setMode('live');
  r.setActive(2); assert.equal(r.shouldAutoRefreshLive(at),false);
  r.setActive(0);
  r.setPending(true); assert.equal(r.shouldAutoRefreshLive(at),false);
  r.setPending(false); assert.equal(r.shouldAutoRefreshLive(at),true);
});

test('ticker attaches once and manual refresh resets the five-minute clock', () => {
  assert.match(html, /if \(liveAutoRefreshTimer === null\) \{/);
  assert.match(html, /liveAutoRefreshTimer = window\.setInterval\(\(\) => \{/);
  assert.match(html, /if \(shouldAutoRefreshLive\(\)\) refreshData\(\);/);
  assert.match(html, /}, LIVE_AUTO_REFRESH_TICK_MS\);/);
  assert.match(extractFunction('refreshData'), /lastLiveRefreshStartedAt = Date\.now\(\);/);
  assert.match(html, /const LIVE_AUTO_REFRESH_TICK_MS = 60 \* 1000;/);
});
