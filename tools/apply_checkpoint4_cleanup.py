from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

replacements = [
    ("    let reloadingForUpdate = false;\n", ""),
    ("                if (!hadController || reloadingForUpdate) return;\n", "                if (!hadController) return;\n"),
    (
        "    function applyPwaUpdate() {\n        reloadingForUpdate = true;\n        location.reload();\n    }\n",
        "    function applyPwaUpdate() {\n        location.reload();\n    }\n",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match, found {count}: {old[:80]!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
