from pathlib import Path
import re

text = Path('analysis/basic-hk-signal-forecast.js').read_text(encoding='utf-8')

for label, pattern in [
    ('CHECKPOINT_EVIDENCE', r"  function pointSignalEvidence\(.*?\n  function timelineSignalSummary"),
    ('LIKELIHOOD_BLOCK', r"    const t3LikelyIndex = .*?\n    const t8Likelihood = .*?;"),
]:
    match = re.search(pattern, text, re.S)
    if not match:
        raise SystemExit(f'{label} not found')
    print(f'--- {label} ---')
    print(match.group(0))
