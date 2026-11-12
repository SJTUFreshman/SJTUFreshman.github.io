#!/usr/bin/env python3
"""Build KaiTi webfonts for characters missing from the site's EduKai font.

Supply a KaiTi font licensed for web conversion and distribution. The source
is deliberately not distributed by this script. Requires fonttools[woff].
"""
import argparse
import hashlib
import importlib.util
import re
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('site_fonts', ROOT / 'scripts/build-edukai-subset.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

parser = argparse.ArgumentParser()
parser.add_argument('--font', required=True, type=Path, help='KaiTi source with webfont rights')
args = parser.parse_args()

with TTFont(ROOT / 'fonts/edukai-5.0.woff2') as font:
    edu = set(font.getBestCmap())
    edu -= builder.blank_cjk_codepoints(font, edu)

scopes = (
    ('home', builder.collect_home_codepoints(), [ROOT / 'index.html']),
    ('site', {cp for cp in builder.collect_codepoints(list(builder.DEFAULT_PAGES)) if builder.is_cjk(cp)}, list(builder.DEFAULT_PAGES)),
)
for name, requested, pages in scopes:
    output = ROOT / f'fonts/kaiti-{name}-subset.woff2'
    builder.build_subset(args.font, output, pages, 9,
                         cjk_only=True, family_name='Site KaiTi', codepoints=requested - edu)
    with TTFont(output) as font:
        chars = set(font.getBestCmap())
    target = ROOT / ('index.html' if name == 'home' else 'assets/life/styles/01-foundation-sky.css')
    indent, prefix = ('        ', 'fonts/') if name == 'home' else ('', '../../../fonts/')
    version = hashlib.sha256(output.read_bytes()).hexdigest()[:12]
    face = (f"{indent}@font-face {{\n{indent}    font-family: 'Site KaiTi';\n"
            f"{indent}    src: url('{prefix}{output.name}?v={version}') format('woff2');\n"
            f"{indent}    font-weight: 400;\n{indent}    font-style: normal;\n"
            f"{indent}    font-display: swap;\n{indent}    unicode-range: {builder.font_unicode_range(chars)};\n{indent}}}")
    text = target.read_text(encoding='utf-8')
    pattern = re.escape(indent) + r"@font-face\s*\{\s*font-family:\s*'Site KaiTi';[^}]*\}"
    text, count = re.subn(pattern, lambda _: face, text)
    if count != 1:
        raise SystemExit(f'Expected one Site KaiTi declaration in {target}; found {count}')
    target.write_text(text, encoding='utf-8')
