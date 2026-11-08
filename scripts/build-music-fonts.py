import argparse
import hashlib
import re
from html import unescape
from pathlib import Path

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCES = [ROOT / 'assets/music' / filename for filename in ('shell.html', 'player.js', 'library.json')]
FACES = (
    ('LANMI_yujian2_jianfan.ttf', '9d179a554aa3604dd8064c36b4dd40ebecec1109e9cd4eb5862c4932b74410dc', 'lanmi-music.woff2'),
    ('LXGWWenKai-Regular.ttf', '2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b', 'wenkai-music.woff2'),
)


def codepoints():
    text = unescape('\n'.join(source.read_text(encoding='utf-8') for source in SOURCES))
    text = re.sub(r'\\u([0-9a-fA-F]{4})', lambda match: chr(int(match[1], 16)), text)
    ranges = ((0x2E80, 0x9FFF), (0xAC00, 0xD7AF), (0xF900, 0xFAFF),
              (0xFE10, 0xFE1F), (0xFE30, 0xFE4F), (0xFF00, 0xFFEF), (0x20000, 0x323AF))
    return {ord(char) for char in text if any(start <= ord(char) <= end for start, end in ranges)}


def blank_glyphs(font, requested):
    glyphs = font.getGlyphSet()
    blank = set()
    for codepoint, name in font.getBestCmap().items():
        if codepoint not in requested or chr(codepoint).isspace():
            continue
        pen = BoundsPen(glyphs)
        glyphs[name].draw(pen)
        if pen.bounds is None:
            blank.add(codepoint)
    return blank


def build(source, output, requested):
    with TTFont(source, recalcTimestamp=False) as font:
        supported = requested & (set(font.getBestCmap()) - blank_glyphs(font, requested))
        options = subset.Options()
        options.flavor = 'woff2'
        options.recalc_timestamp = False
        options.drop_tables.append('FFTM')
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=supported)
        subsetter.subset(font)
        font.flavor = 'woff2'
        output.parent.mkdir(parents=True, exist_ok=True)
        font.save(output)
        print(f'{output.name}: {len(supported)} characters, {output.stat().st_size} bytes')


def main():
    parser = argparse.ArgumentParser(description='Build the music player subsets of the homepage typefaces.')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    requested = codepoints()
    covered = set()
    for source_name, checksum, filename in FACES:
        source = ROOT / '.render-work' / source_name
        output = ROOT / 'assets/music/fonts' / filename
        if not args.check:
            if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != checksum:
                raise SystemExit(f'Restore the verified original font at {source}; see docs/music-player.md.')
            build(source, output, requested - covered)
        with TTFont(output) as font:
            coverage = set(font.getBestCmap())
            if blank_glyphs(font, coverage):
                raise SystemExit(f'Blank glyphs in {filename}')
            covered.update(coverage)
    missing = requested - covered
    if missing:
        raise SystemExit('Rebuild music fonts; missing: ' + ', '.join(f'U+{codepoint:04X}' for codepoint in sorted(missing)))
    print(f'Music typography verified: {len(requested)} CJK characters, no missing or blank glyphs.')


if __name__ == '__main__':
    main()
