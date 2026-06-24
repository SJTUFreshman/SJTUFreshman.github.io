from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
CONTENT_FILE = ROOT / "site_content.json"
LANGS = ("en", "zh-CN", "zh-TW")


def esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def lang_value(mapping: dict[str, Any], lang: str) -> str:
    if not isinstance(mapping, dict):
        return "" if mapping is None else str(mapping)
    return str(mapping.get(lang) or mapping.get("en") or "")


def key_for(prefix: str, item: dict[str, Any], index: int, suffix: str = "") -> str:
    base = str(item.get("id") or f"{prefix}_{index + 1}")
    return f"{base}_{suffix}" if suffix else base


def json_js(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=4)


def load_content(root: Path = ROOT) -> dict[str, Any]:
    return json.loads((root / "site_content.json").read_text(encoding="utf-8"))


def replace_region(text: str, name: str, replacement: str, fallback_pattern: str) -> str:
    start = f"<!-- SITEGEN:{name}_START -->"
    end = f"<!-- SITEGEN:{name}_END -->"
    wrapped = f"{start}\n{replacement.rstrip()}\n{end}"

    if start in text and end in text:
        pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
        text, count = pattern.subn(lambda _match: wrapped, text, count=1)
    else:
        text, count = re.subn(fallback_pattern, lambda _match: wrapped, text, count=1, flags=re.S)

    if count != 1:
        raise RuntimeError(f"Could not replace region {name}")
    return text


def replace_code_region(text: str, name: str, replacement: str, fallback_pattern: str) -> str:
    start = f"/* SITEGEN:{name}_START */"
    end = f"/* SITEGEN:{name}_END */"
    wrapped = f"{start}\n{replacement.rstrip()}\n{end}"

    if start in text and end in text:
        pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
        text, count = pattern.subn(lambda _match: wrapped, text, count=1)
    else:
        text, count = re.subn(fallback_pattern, lambda _match: wrapped, text, count=1, flags=re.S)

    if count != 1:
        raise RuntimeError(f"Could not replace code region {name}")
    return text


def render_home_i18n(content: dict[str, Any]) -> str:
    home = content["home"]
    i18n = {lang: dict(home["labels"][lang]) for lang in LANGS}

    for lang in LANGS:
        i18n[lang]["hero_name"] = lang_value(home["hero"]["name_html"], lang)
        i18n[lang]["hero_title"] = lang_value(home["hero"]["title"], lang)
        i18n[lang]["hero_bio"] = lang_value(home["hero"]["bio"], lang)
        i18n[lang]["hero_location"] = lang_value(home["hero"]["location"], lang)
        i18n[lang]["life_card_title"] = lang_value(home["life_card"]["title"], lang)
        i18n[lang]["life_card_desc"] = lang_value(home["life_card"]["desc"], lang)
        i18n[lang]["notes_empty"] = lang_value(home["notes_empty"], lang)

    for index, item in enumerate(home["news"]):
        key = key_for("news", item, index)
        for lang in LANGS:
            i18n[lang][key] = lang_value(item.get("text", {}), lang)

    for index, item in enumerate(home["projects"]):
        key = key_for("proj", item, index)
        for lang in LANGS:
            i18n[lang][f"proj_{key}"] = lang_value(item.get("desc", {}), lang)

    for index, item in enumerate(home["gallery"]):
        key = key_for("cap", item, index)
        for lang in LANGS:
            i18n[lang][f"cap_{key}"] = lang_value(item.get("caption", {}), lang)

    return "/* ===== i18n Content ===== */\nconst i18n = " + json_js(i18n) + ";"


def render_life_i18n(content: dict[str, Any]) -> str:
    life = content["life"]
    i18n = {lang: dict(life["labels"][lang]) for lang in LANGS}

    for index, item in enumerate(life["gallery"]):
        key = key_for("cap", item, index)
        for lang in LANGS:
            i18n[lang][f"cap_{key}"] = lang_value(item.get("caption", {}), lang)

    for index, item in enumerate(life["shelf"]):
        key = key_for("shelf", item, index)
        for lang in LANGS:
            i18n[lang][key] = lang_value(item.get("comment", {}), lang)

    for index, item in enumerate(life["thoughts"]):
        key = key_for("thought", item, index)
        date_key = f"date_{key}"
        for lang in LANGS:
            i18n[lang][date_key] = lang_value(item.get("date", {}), lang)
            i18n[lang][key] = lang_value(item.get("text", {}), lang)

    return "/* ===== i18n ===== */\nconst i18n = " + json_js(i18n) + ";"


def render_home_hero(content: dict[str, Any]) -> str:
    hero = content["home"]["hero"]
    links = []
    for link in hero.get("links", []):
        links.append(
            f'                <a href="{esc(link.get("href", "#"))}" target="_blank" class="hero-link">'
            f'<i class="{esc(link.get("icon", "fas fa-link"))}"></i> {esc(link.get("label", "Link"))}</a>'
        )
    link_html = "\n".join(links)
    return f"""    <section class="hero" id="about">
        <img src="{esc(hero.get("avatar", ""))}" alt="Runde Yang" class="hero-avatar" loading="eager" decoding="async" fetchpriority="high" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="hero-avatar-placeholder" style="display:none;">R</div>
        <div class="hero-info">
            <h1 class="hero-name" id="heroName">{lang_value(hero.get("name_html", {}), "en")}</h1>
            <p class="hero-title" data-key="hero_title">{lang_value(hero.get("title", {}), "en")}</p>
            <p class="hero-bio" data-key="hero_bio">{lang_value(hero.get("bio", {}), "en")}</p>
            <div class="hero-links">
                <a class="hero-link" id="emailLink"><i class="fas fa-envelope"></i> <span id="emailText"></span></a>
{link_html}
                <span class="hero-link"><i class="fas fa-map-marker-alt"></i> <span data-key="hero_location">{lang_value(hero.get("location", {}), "en")}</span></span>
            </div>
            <div class="weather-pill" id="weatherWidget" style="display:none;">
                <span class="weather-icon" id="weatherIcon"></span>
                <span class="weather-temp" id="weatherTemp"></span>
                <span class="weather-desc" id="weatherDesc"></span>
                <span class="weather-loc" id="weatherLoc">Shanghai</span>
            </div>
        </div>
    </section>"""


def render_home_news(content: dict[str, Any]) -> str:
    rows = []
    for index, item in enumerate(content["home"]["news"]):
        key = key_for("news", item, index)
        rows.append(f"""            <li class="news-item">
                <span class="news-date">{esc(item.get("date", ""))}</span>
                <span class="news-text" data-key="{esc(key)}">{lang_value(item.get("text", {}), "en")}</span>
            </li>""")
    return """    <!-- ===== News ===== -->
    <section id="news" class="fade-in">
        <div class="section-title" data-key="title_news">News</div>
        <ul class="news-list" id="newsList">
""" + "\n".join(rows) + """
        </ul>
    </section>"""


def render_publications(content: dict[str, Any]) -> str:
    rows = []
    for item in content["home"]["publications"]:
        paper = item.get("paper_url") or "#"
        code = item.get("code_url") or "#"
        cite = item.get("id") or ""
        cite_button = ""
        if item.get("citation"):
            cite_button = f'\n                    <button class="pub-btn" onclick="copyCitation(\'{esc(cite)}\')"><i class="fas fa-quote-right"></i> Cite</button>'
        rows.append(f"""            <div class="pub-item">
                <div class="pub-title-text en-only">{item.get("title", "")}</div>
                <div class="pub-authors en-only">{item.get("authors_html", "")}</div>
                <div class="pub-venue en-only">{item.get("venue", "")}</div>
                <div class="pub-actions">
                    <a href="{esc(paper)}" class="pub-btn"><i class="far fa-file-pdf"></i> Paper</a>
                    <a href="{esc(code)}" class="pub-btn"><i class="fab fa-github"></i> Code</a>{cite_button}
                </div>
            </div>""")
    return """    <!-- ===== Publications ===== -->
    <section id="publications" class="fade-in">
        <div class="section-title" data-key="title_pubs">Publications</div>
        <div class="pub-list">
""" + "\n".join(rows) + """
        </div>
    </section>"""


def render_projects(content: dict[str, Any]) -> str:
    cards = []
    for index, item in enumerate(content["home"]["projects"]):
        key = f"proj_{key_for('project', item, index)}"
        cards.append(f"""            <div class="project-card">
                <div class="project-img-wrap">
                    <img src="{esc(item.get("image", ""))}" alt="{esc(item.get("alt", item.get("name", "")))}" loading="lazy" decoding="async">
                </div>
                <div class="project-body">
                    <div class="project-name en-only">{esc(item.get("name", ""))}</div>
                    <div class="project-desc" data-key="{esc(key)}">{lang_value(item.get("desc", {}), "en")}</div>
                    <div class="project-links">
                        <a href="{esc(item.get("paper_url") or "#")}" class="project-link"><i class="far fa-file-alt"></i> Paper</a>
                        <a href="{esc(item.get("code_url") or "#")}" class="project-link"><i class="fab fa-github"></i> Code</a>
                    </div>
                </div>
            </div>""")
    return """    <!-- ===== Projects ===== -->
    <section id="projects" class="fade-in">
        <div class="section-title" data-key="title_projects">Projects</div>
        <div class="project-grid">
""" + "\n".join(cards) + """
        </div>
    </section>"""


def render_gallery_items(items: list[dict[str, Any]], grid: bool) -> str:
    rows = []
    for index, item in enumerate(items):
        key = f"cap_{key_for('gallery', item, index)}"
        rows.append(f"""                <div class="gallery-item" onclick="openLightbox(this)">
                    <img src="{esc(item.get("image", ""))}" alt="{esc(item.get("alt", ""))}" loading="lazy" decoding="async">
                    <div class="gallery-caption" data-key="{esc(key)}">{lang_value(item.get("caption", {}), "en")}</div>
                </div>""")
    return "\n".join(rows)


def render_home_gallery(content: dict[str, Any]) -> str:
    home = content["home"]
    life_card = home["life_card"]
    bg_imgs = "\n".join(
        f'                <img src="{esc(src)}" alt="" loading="lazy" decoding="async">'
        for src in life_card.get("images", [])
    )
    return """    <!-- ===== Gallery ===== -->
    <section id="gallery" class="fade-in">
        <div class="section-title" data-key="title_gallery">Gallery</div>
        <div class="gallery-scroll" id="galleryScroll">
            <div class="gallery-track" id="galleryTrack">
""" + render_gallery_items(home["gallery"], grid=False) + f"""
            </div>
        </div>

        <!-- Life link card -->
        <div class="life-card" onclick="window.location.href='life.html'">
            <div class="life-card-bg">
{bg_imgs}
            </div>
            <div class="life-card-overlay"></div>
            <div class="life-card-content">
                <div class="life-card-icon"><i class="fas fa-compass"></i></div>
                <div class="life-card-title" data-key="life_card_title">{lang_value(life_card.get("title", {}), "en")}</div>
                <div class="life-card-rule"></div>
                <div class="life-card-desc" data-key="life_card_desc">{lang_value(life_card.get("desc", {}), "en")}</div>
            </div>
            <div class="life-card-arrow"><i class="fas fa-long-arrow-alt-right"></i> <span class="en-only" style="font-size:0.8rem;letter-spacing:0.05em;">EXPLORE</span></div>
        </div>
    </section>"""


def render_notes(content: dict[str, Any]) -> str:
    notes = content["home"].get("notes", [])
    if notes:
        body = "\n".join(
            f"""            <a href="{esc(item.get("href", "#"))}" class="note-item" target="_blank">
                <span class="note-icon"><i class="{esc(item.get("icon", "far fa-file-pdf"))}"></i></span>
                <div class="note-info">
                    <div class="note-title">{esc(item.get("title", ""))}</div>
                    <div class="note-meta">{esc(item.get("meta", ""))}</div>
                </div>
                <span class="note-arrow"><i class="fas fa-chevron-right"></i></span>
            </a>"""
            for item in notes
        )
    else:
        body = '            <div class="notes-empty" data-key="notes_empty">Notes coming soon...</div>'
    return """    <!-- ===== Notes ===== -->
    <section id="notes" class="fade-in">
        <div class="section-title" data-key="title_notes">Notes</div>
        <div class="notes-grid" id="notesGrid">
""" + body + """
        </div>
    </section>"""


def render_life_gallery(content: dict[str, Any]) -> str:
    return """    <!-- Gallery -->
    <section id="gallery" class="fade-in">
        <div class="section-title" data-key="title_gallery">Gallery</div>
        <div class="gallery-grid">
""" + render_gallery_items(content["life"]["gallery"], grid=True) + """
        </div>
    </section>"""


def render_shelf(content: dict[str, Any]) -> str:
    rows = []
    for index, item in enumerate(content["life"]["shelf"]):
        key = key_for("shelf", item, index)
        rows.append(f"""            <div class="shelf-item">
                <div class="shelf-icon"><i class="{esc(item.get("icon", "fas fa-book"))}"></i></div>
                <div class="shelf-info">
                    <div class="shelf-title en-only">{esc(item.get("title", ""))}</div>
                    <div class="shelf-comment" data-key="{esc(key)}">{lang_value(item.get("comment", {}), "en")}</div>
                </div>
            </div>""")
    return """    <!-- Shelf -->
    <section id="shelf" class="fade-in">
        <div class="section-title" data-key="title_shelf">Shelf</div>
        <div class="shelf-list">
""" + "\n".join(rows) + """
        </div>
    </section>"""


def render_thoughts(content: dict[str, Any]) -> str:
    rows = []
    for index, item in enumerate(content["life"]["thoughts"]):
        key = key_for("thought", item, index)
        rows.append(f"""            <div class="thought-item">
                <div class="thought-date" data-key="{esc('date_' + key)}">{lang_value(item.get("date", {}), "en")}</div>
                <div class="thought-text" data-key="{esc(key)}">{lang_value(item.get("text", {}), "en")}</div>
            </div>""")
    return """    <!-- Thoughts -->
    <section id="thoughts" class="fade-in">
        <div class="section-title" data-key="title_thoughts">Thoughts</div>
        <div class="thoughts-list">
""" + "\n".join(rows) + """
        </div>
    </section>"""


def render_friends(content: dict[str, Any]) -> str:
    rows = "\n".join(
        f'            <a href="{esc(item.get("href", "#"))}" class="friend-link">{esc(item.get("label", ""))}</a>'
        for item in content["life"]["friends"]
    )
    return """    <!-- Friends -->
    <section id="friends" class="fade-in">
        <div class="section-title" data-key="title_friends">Friends</div>
        <div class="friends-list">
""" + rows + """
        </div>
    </section>"""


def render_visited(content: dict[str, Any]) -> str:
    values = content["life"]["footprints"].get("visited_china", [])
    rows = ",\n".join(f"    {json.dumps(value, ensure_ascii=False)}" for value in values)
    return "const visited = [\n" + rows + "\n];"


def render_world_points(content: dict[str, Any]) -> str:
    rows = []
    for item in content["life"]["footprints"].get("world_points", []):
        value = item.get("value", [0, 0])
        rows.append(f"                    {{ name: {json.dumps(item.get('name', ''), ensure_ascii=False)}, value: [{float(value[0])}, {float(value[1])}] }}")
    return "data: [\n" + ",\n".join(rows) + "\n                ]"


def render_citations(content: dict[str, Any]) -> str:
    citations = {
        item["id"]: item["citation"]
        for item in content["home"].get("publications", [])
        if item.get("id") and item.get("citation")
    }
    return "/* ===== Citations ===== */\nconst citations = " + json_js(citations) + ";"


def render_home(root: Path, content: dict[str, Any], write: bool) -> str:
    path = root / "index.html"
    text = path.read_text(encoding="utf-8")
    text = replace_region(text, "HOME_HERO", render_home_hero(content), r'<section class="hero" id="about">.*?</section>')
    text = replace_region(text, "HOME_NEWS", render_home_news(content), r'<!-- ===== News ===== -->\s*<section id="news".*?</section>')
    text = replace_region(text, "HOME_PUBLICATIONS", render_publications(content), r'<!-- ===== Publications ===== -->\s*<section id="publications".*?</section>')
    text = replace_region(text, "HOME_PROJECTS", render_projects(content), r'<!-- ===== Projects ===== -->\s*<section id="projects".*?</section>')
    text = replace_region(text, "HOME_GALLERY", render_home_gallery(content), r'<!-- ===== Gallery ===== -->\s*<section id="gallery".*?</section>')
    text = replace_region(text, "HOME_NOTES", render_notes(content), r'<!-- ===== Notes ===== -->\s*<section id="notes".*?</section>')
    text = replace_region(text, "HOME_FOOTER", f'<footer class="footer">\n    {content["site"]["footer"]}\n</footer>', r'<footer class="footer">.*?</footer>')
    text = replace_code_region(text, "HOME_I18N", render_home_i18n(content), r'/\* ===== i18n Content ===== \*/\s*const i18n = \{.*?\};')
    text = replace_code_region(text, "HOME_CITATIONS", render_citations(content), r'/\* ===== Citations ===== \*/\s*const citations = \{.*?\};')

    text = text.replace("const u = 'yangrundemdj', d = 'gmail.com';", f"const u = '{content['site']['email_user']}', d = '{content['site']['email_domain']}';")
    text = text.replace("setLang('en');\n\n/* ========== RPG Pixel Companion System", "setLang(currentLang);\n\n/* ========== RPG Pixel Companion System")
    text = text.replace('<script type="text/javascript" id="clstr_globe"', '<script async type="text/javascript" id="clstr_globe"')
    text = re.sub(
        r'\n/\* ========== RPG Pixel Companion System \(Final V3\) ========== \*/\s*class PixelPet \{.*?\n\}\s*\n\n// 啟動',
        '\n// 啟動',
        text,
        count=1,
        flags=re.S,
    )

    if write:
        path.write_text(text, encoding="utf-8", newline="\n")
    return text


def render_life(root: Path, content: dict[str, Any], write: bool) -> str:
    path = root / "life.html"
    text = path.read_text(encoding="utf-8")
    text = replace_region(text, "LIFE_GALLERY", render_life_gallery(content), r'<!-- Gallery -->\s*<section id="gallery".*?</section>')
    text = replace_region(text, "LIFE_SHELF", render_shelf(content), r'<!-- Shelf -->\s*<section id="shelf".*?</section>')
    text = replace_region(text, "LIFE_THOUGHTS", render_thoughts(content), r'<!-- Thoughts -->\s*<section id="thoughts".*?</section>')
    text = replace_region(text, "LIFE_FRIENDS", render_friends(content), r'<!-- Friends -->\s*<section id="friends".*?</section>')
    text = replace_code_region(text, "LIFE_I18N", render_life_i18n(content), r'/\* ===== i18n ===== \*/\s*const i18n = \{.*?\};')
    text = replace_code_region(text, "LIFE_VISITED", render_visited(content), r'const visited = \[.*?\];')
    text = replace_code_region(
        text,
        "LIFE_WORLD_POINTS",
        render_world_points(content),
        r"data:\s*\[\s*\{ name: 'Shanghai', value: \[[^\]]+\] \},\s*\{ name: 'New York', value: \[[^\]]+\] \}\s*\]",
    )

    if write:
        path.write_text(text, encoding="utf-8", newline="\n")
    return text


def render_site(root: Path = ROOT, write: bool = True) -> tuple[str, str]:
    content = load_content(root)
    return render_home(root, content, write), render_life(root, content, write)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render static homepage HTML from site_content.json.")
    parser.add_argument("--check", action="store_true", help="Render in memory only; do not write files.")
    args = parser.parse_args()
    render_site(ROOT, write=not args.check)
    print("Rendered index.html and life.html" if not args.check else "Render check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
