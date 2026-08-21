from pathlib import Path

path = Path('tests/frontend-hk-threat-ui.test.cjs')
text = path.read_text(encoding='utf-8')
anchor = "console.log('frontend-hk-threat-ui tests: OK');"
if text.count(anchor) != 1:
    raise SystemExit('followup9 frontend final anchor mismatch')
extra = r'''
// If HKO official warning context is explicitly supplied, the UI must show it as an
// official current state rather than leaving only Storm Track's estimate visible.
{
  const officialHtml = ui.renderGroupSummary(group, {
    generatedAt: '2026-08-21T12:00:00Z',
    signalOptions: {
      hkoWarningContext: {
        currentSignal: 'T3',
        issuedAt: '2026-08-21T11:40:00Z',
        source: 'HKO-official-test'
      }
    }
  });
  assert.match(officialHtml, /HKO官方/);
  assert.match(officialHtml, /T3/);
  assert.match(officialHtml, /Storm Track 估算/);
}

'''
path.write_text(text.replace(anchor, extra + anchor, 1), encoding='utf-8')
