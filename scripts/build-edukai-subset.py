#!/usr/bin/env python3
"""Build the EduKai and companion WenKai webfont subsets used by the static site.

The page sources are scanned as text instead of parsing only visible DOM text.
That deliberately keeps characters contained in JavaScript/i18n strings, CSS
generated content, and templates that become visible at runtime. The default
Life page also contributes its referenced first-party CSS and JavaScript files.

Run from anywhere:

    python scripts/build-edukai-subset.py
    python scripts/build-edukai-subset.py --check

Additional generated pages can be included with one or more ``--page`` options.
Passing ``--page`` replaces the default index.html/life.html/observatory.html list.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.ttLib import woff2 as fonttools_woff2
except ImportError as exc:  # pragma: no cover - only reached without build deps
    raise SystemExit(
        "fontTools with WOFF2 support is required. "
        "Install it with: python -m pip install 'fonttools[woff]'"
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FONT = REPO_ROOT / "fonts" / "edukai-5.0.woff2"
DEFAULT_OUTPUT = REPO_ROOT / "fonts" / "edukai-site-subset.woff2"
WENKAI_SOURCE = REPO_ROOT / ".render-work" / "LXGWWenKai-Regular.ttf"
WENKAI_OUTPUT = REPO_ROOT / "fonts" / "wenkai-site-subset.woff2"
WENKAI_URL = "https://github.com/lxgw/LxgwWenKai/releases/download/v1.530/LXGWWenKai-Regular.ttf"
WENKAI_SHA256 = "2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b"
DEFAULT_PAGES = (REPO_ROOT / "index.html", REPO_ROOT / "life.html", REPO_ROOT / "observatory.html")

LIFE_PAGE = REPO_ROOT / 'life.html'
LIFE_SOURCE_ROOTS = (
    (REPO_ROOT / 'assets' / 'life' / 'styles').resolve(),
    (REPO_ROOT / 'assets' / 'life' / 'scripts').resolve(),
    (REPO_ROOT / 'assets' / 'life' / 'observatory').resolve(),
)

# Space is needed even if a future page happens to contain no literal spaces.
ALWAYS_KEEP = {0x20}


def text_codepoints(text: str) -> set[int]:
    decoded = unescape(text)
    decoded = re.sub(r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match[1], 16)), decoded)
    return {ord(char) for char in decoded if char not in "\r\n\t"}


def is_cjk(codepoint: int) -> bool:
    return any(start <= codepoint <= end for start, end in (
        (0x2E80, 0x9FFF), (0xAC00, 0xD7AF), (0xF900, 0xFAFF),
        (0xFE10, 0xFE1F), (0xFE30, 0xFE4F), (0xFF00, 0xFFEF), (0x20000, 0x323AF),
    ))


def resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPO_ROOT / path


class LifeSourceReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.references: list[tuple[str, str]] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        self._record_reference(tag, attrs)

    def handle_startendtag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        self._record_reference(tag, attrs)

    def _record_reference(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        values = {name.casefold(): value for name, value in attrs if value}
        reference = None
        expected_suffix = None
        if tag.casefold() == 'link':
            reference = values.get('href')
            expected_suffix = '.css'
        elif tag.casefold() == 'script':
            reference = values.get('src')
            expected_suffix = '.js'
        if reference and expected_suffix:
            self.references.append((reference, expected_suffix))


def referenced_life_sources(page: Path, text: str) -> list[Path]:
    if page.resolve() not in {LIFE_PAGE.resolve(), (REPO_ROOT / 'observatory.html').resolve()}:
        return []

    parser = LifeSourceReferenceParser()
    parser.feed(text)
    parser.close()

    sources: list[Path] = []
    seen: set[Path] = set()
    for reference, expected_suffix in parser.references:
        try:
            parsed = urlsplit(reference)
        except ValueError:
            continue
        if parsed.scheme or parsed.netloc or not parsed.path:
            continue

        reference_path = unquote(parsed.path)
        try:
            candidate = (
                REPO_ROOT / reference_path.lstrip('/\\')
                if reference_path.startswith(('/', '\\'))
                else page.parent / reference_path
            ).resolve()
        except OSError:
            continue
        if candidate.suffix.casefold() != expected_suffix:
            continue
        if not any(candidate.is_relative_to(root) for root in LIFE_SOURCE_ROOTS):
            continue
        if candidate not in seen:
            sources.append(candidate)
            seen.add(candidate)
    return sources


def collect_codepoints(pages: list[Path]) -> set[int]:
    codepoints = set(ALWAYS_KEEP)
    scanned_life_sources: set[Path] = set()
    for page in pages:
        try:
            text = page.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise SystemExit(f"Page source does not exist: {page}") from exc
        except UnicodeDecodeError as exc:
            raise SystemExit(f"Page source is not valid UTF-8: {page}") from exc

        # CR/LF/TAB control layout but do not need font glyphs. Other Unicode
        # format and combining characters are retained when the font supports
        # them (for example variation selectors).
        codepoints.update(text_codepoints(text))
        for source in referenced_life_sources(page, text):
            if source in scanned_life_sources:
                continue
            scanned_life_sources.add(source)
            try:
                source_text = source.read_text(encoding='utf-8')
            except FileNotFoundError as exc:
                raise SystemExit(
                    f'Referenced Life source does not exist: {source}'
                ) from exc
            except UnicodeDecodeError as exc:
                raise SystemExit(
                    f'Referenced Life source is not valid UTF-8: {source}'
                ) from exc
            codepoints.update(text_codepoints(source_text))
    if any(page.resolve() in {path.resolve() for path in DEFAULT_PAGES} for page in pages):
        content = json.loads((REPO_ROOT / 'site_content.json').read_text(encoding='utf-8'))
        codepoints.update(text_codepoints(json.dumps(content, ensure_ascii=False)))
        for collection in content.get('life', {}).get('reading', {}).get('collections', []):
            for field in ('articles_file', 'translations_file'):
                if not collection.get(field):
                    continue
                source = (REPO_ROOT / collection[field]).resolve()
                if not source.is_relative_to(REPO_ROOT.resolve()) or source.suffix != '.json':
                    raise SystemExit(f'Invalid reading font source: {source}')
                data = json.loads(source.read_text(encoding='utf-8'))
                codepoints.update(text_codepoints(json.dumps(data, ensure_ascii=False)))
    return codepoints


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def format_bytes(size: int) -> str:
    units = ("B", "KiB", "MiB", "GiB")
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            return f"{value:.2f} {unit}"
        value /= 1024
    raise AssertionError("unreachable")


def build_subset(
    input_font: Path,
    output_font: Path,
    pages: list[Path],
    brotli_quality: int,
    cjk_only: bool = False,
    family_name: str | None = None,
) -> None:
    if not input_font.is_file():
        raise SystemExit(f"Source font does not exist: {input_font}")
    if input_font.resolve() == output_font.resolve():
        raise SystemExit("Refusing to overwrite the source font; choose another --output.")

    requested = collect_codepoints(pages)
    if cjk_only:
        requested = {codepoint for codepoint in requested if is_cjk(codepoint)}
    source_size = input_font.stat().st_size

    print("Collecting source glyphs...", flush=True)
    source = TTFont(input_font, recalcTimestamp=False, lazy=False)
    if family_name:
        names = {1: family_name, 2: "Regular", 3: family_name + " Regular 1.530", 4: family_name + " Regular", 6: family_name.replace(" ", "") + "-Regular", 16: family_name, 17: "Regular"}
        for record in source["name"].names:
            if record.nameID in names:
                record.string = names[record.nameID].encode(record.getEncoding())
    source_cmap = set((source.getBestCmap() or {}).keys())
    supported = requested & source_cmap
    missing = requested - source_cmap
    original_glyph_count = len(source.getGlyphOrder())

    if not supported:
        source.close()
        raise SystemExit("None of the collected page characters exist in the source font.")

    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = True
    options.recalc_bounds = False
    options.recalc_timestamp = False
    options.canonical_order = True
    options.drop_tables.append("FFTM")

    print(
        f"Subsetting {len(supported):,} supported code points...",
        flush=True,
    )
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=supported)
    subsetter.subset(source)

    output_font.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{output_font.stem}-",
            suffix=output_font.suffix,
            dir=output_font.parent,
            delete=False,
        ) as temporary:
            temporary_name = temporary.name

        temporary_path = Path(temporary_name)
        source.flavor = "woff2"
        print(
            f"Encoding WOFF2 (Brotli quality {brotli_quality})...",
            flush=True,
        )

        # fontTools exposes WOFF2 output but not Brotli quality through TTFont.
        # Its internal writer otherwise uses Brotli's very slow quality-11
        # default. Quality 9 is deterministic, produces nearly the same webfont
        # size, and keeps routine site rebuilds practical.
        original_brotli_compress = fonttools_woff2.brotli.compress

        def compress_woff2(data: bytes, mode: int) -> bytes:
            return original_brotli_compress(
                data,
                mode=mode,
                quality=brotli_quality,
            )

        fonttools_woff2.brotli.compress = compress_woff2
        try:
            source.save(temporary_path, reorderTables=True)
        finally:
            fonttools_woff2.brotli.compress = original_brotli_compress
        source.close()

        # Reopen before replacing the public artifact so a failed/corrupt build
        # can never destroy the last good subset.
        check = TTFont(temporary_path, recalcTimestamp=False, lazy=False)
        output_cmap = set((check.getBestCmap() or {}).keys())
        output_glyph_count = len(check.getGlyphOrder())
        check.close()
        lost = supported - output_cmap
        if lost:
            preview = ", ".join(f"U+{value:04X}" for value in sorted(lost)[:8])
            raise RuntimeError(f"Subset validation lost {len(lost)} characters: {preview}")

        os.replace(temporary_path, output_font)
        temporary_name = None
    finally:
        source.close()
        if temporary_name is not None:
            Path(temporary_name).unlink(missing_ok=True)

    output_size = output_font.stat().st_size
    reduction = 100 * (1 - output_size / source_size)
    print(f"{output_font.name} built successfully")
    print("Pages:")
    for page in pages:
        try:
            label = page.resolve().relative_to(REPO_ROOT)
        except ValueError:
            label = page.resolve()
        print(f"  - {label}")
    print(f"Collected Unicode code points: {len(requested):,}")
    print(f"Supported code points retained: {len(supported):,}")
    print(f"Unsupported code points skipped: {len(missing):,}")
    print(f"Glyphs: {original_glyph_count:,} -> {output_glyph_count:,}")
    print(
        f"Size: {format_bytes(source_size)} -> {format_bytes(output_size)} "
        f"({reduction:.1f}% smaller)"
    )
    print(f"Output: {output_font}")
    print(f"SHA-256: {sha256(output_font)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a WOFF2 EduKai subset from current static page sources."
    )
    parser.add_argument(
        "--check", action="store_true", help="Check that the published subsets cover every current CJK character."
    )
    parser.add_argument(
        "--font",
        default=str(DEFAULT_FONT),
        help="source EduKai font (default: fonts/edukai-5.0.woff2)",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="generated WOFF2 path (default: fonts/edukai-site-subset.woff2)",
    )
    parser.add_argument(
        "--page",
        action="append",
        dest="pages",
        help=(
            "UTF-8 page/template source to scan; repeat as needed. "
            "Defaults to index.html, life.html and observatory.html."
        ),
    )
    parser.add_argument(
        "--brotli-quality",
        type=int,
        choices=range(0, 12),
        default=9,
        metavar="0..11",
        help="WOFF2 Brotli quality (default: 9; 11 is smaller but much slower)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pages = (
        [resolve_path(value) for value in args.pages]
        if args.pages
        else list(DEFAULT_PAGES)
    )
    if args.check:
        validate_coverage(pages)
        return 0
    build_subset(
        resolve_path(args.font),
        resolve_path(args.output),
        pages,
        args.brotli_quality,
    )
    if resolve_path(args.font) == DEFAULT_FONT and resolve_path(args.output) == DEFAULT_OUTPUT:
        WENKAI_SOURCE.parent.mkdir(parents=True, exist_ok=True)
        if not WENKAI_SOURCE.is_file():
            subprocess.run(["curl.exe" if os.name == "nt" else "curl", "--fail", "--location", "--retry", "2", "--output", str(WENKAI_SOURCE), WENKAI_URL], check=True)
        if sha256(WENKAI_SOURCE) != WENKAI_SHA256:
            raise SystemExit("WenKai source checksum mismatch; remove the cached download and retry.")
        build_subset(WENKAI_SOURCE, WENKAI_OUTPUT, pages, args.brotli_quality, cjk_only=True, family_name="Site WenKai")
        validate_coverage(pages)
    return 0


def validate_coverage(pages: list[Path]) -> None:
    requested = {codepoint for codepoint in collect_codepoints(pages) if is_cjk(codepoint)}
    coverage = set()
    for path in (DEFAULT_OUTPUT, WENKAI_OUTPUT):
        with TTFont(path) as font:
            coverage.update(font.getBestCmap())
    missing = requested - coverage
    if missing:
        preview = " ".join(f"{chr(value)} (U+{value:04X})" for value in sorted(missing))
        raise SystemExit(f"Missing {len(missing)} CJK characters: {preview}")
    print(f"CJK coverage passed: {len(requested):,} unique characters; no missing glyphs.")


if __name__ == "__main__":
    sys.exit(main())
