from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "    // 前端需要 Storm Worker v3.3-alpha.2 或更新版本。\n",
        "    // Production Storm Worker is deployed independently at WORKER_ORIGIN.\n",
    ),
    (
        "    function firstLocalByType(node, localName, typeText) {\n        return elementsByLocalName(node, localName).find(item => (item.getAttribute('type') || '').includes(typeText)) || null;\n    }\n\n",
        "",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
