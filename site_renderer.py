from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from datetime import date as calendar_date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
CONTENT_FILE = ROOT / "site_content.json"
LANGS = ("en", "zh-CN", "zh-TW")
THOUGHT_COLLAPSE_CHARS = 700
MONTH_NAMES = (
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)
GALAXY_STREAMS = ("gallery", "shelf", "thoughts")


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


def format_moment_date(moment: dict[str, Any], lang: str) -> str:
    custom = lang_value(moment.get("date_label", {}), lang)
    if custom:
        return custom

    value = str(moment.get("date") or "").strip()
    match = re.fullmatch(r"(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?", value)
    if not match:
        return {"en": "Undated", "zh-CN": "未标日期", "zh-TW": "未標日期"}[lang]

    year, month_text, day_text = match.groups()
    if not month_text:
        return year

    month = int(month_text)
    if not 1 <= month <= 12:
        return value
    if lang == "en":
        return f"{MONTH_NAMES[month]} {int(day_text)}, {year}" if day_text else f"{MONTH_NAMES[month]} {year}"
    suffix = f"{year}年{month}月"
    return f"{suffix}{int(day_text)}日" if day_text else suffix


def moment_sort_key(moment: dict[str, Any]) -> tuple[int, str]:
    date = str(moment.get("date") or "")
    # Python's sort is stable, so equal/undated moments retain the editor's
    # explicit up/down order instead of being silently reordered by ID.
    return (0 if not date else 1, date)


def validate_content(content: dict[str, Any]) -> None:
    """Reject ambiguous IDs and broken galaxy references before writing HTML."""
    errors: list[str] = []
    home = content.get("home", {})
    life = content.get("life", {})

    collections = (
        ("home.news", home.get("news", [])),
        ("home.publications", home.get("publications", [])),
        ("home.projects", home.get("projects", [])),
        ("home.gallery", home.get("gallery", [])),
        ("life.gallery", life.get("gallery", [])),
        ("life.shelf", life.get("shelf", [])),
        ("life.thoughts", life.get("thoughts", [])),
        ("life.moments", life.get("moments", [])),
    )
    for label, items in collections:
        seen: set[str] = set()
        for index, item in enumerate(items):
            item_id = str(item.get("id") or "").strip() if isinstance(item, dict) else ""
            if not item_id:
                errors.append(f"{label}[{index}] 缺少非空 ID")
            elif item_id in seen:
                errors.append(f"{label} 含有重复 ID：{item_id}")
            else:
                seen.add(item_id)

    item_ids_by_stream = {
        stream: {
            str(item.get("id")).strip()
            for item in life.get(stream, [])
            if isinstance(item, dict) and str(item.get("id") or "").strip()
        }
        for stream in GALAXY_STREAMS
    }
    referenced_by: dict[tuple[str, str], str] = {}

    for index, moment in enumerate(life.get("moments", [])):
        if not isinstance(moment, dict):
            errors.append(f"life.moments[{index}] 必须是对象")
            continue

        moment_id = str(moment.get("id") or f"#{index + 1}").strip()
        stream = str(moment.get("stream") or "").strip()
        if stream not in GALAXY_STREAMS:
            errors.append(
                f"银河时刻 {moment_id} 的 stream 必须是 gallery、shelf 或 thoughts"
            )
            continue

        raw_item_ids = moment.get("item_ids")
        if not isinstance(raw_item_ids, list) or not raw_item_ids:
            errors.append(f"银河时刻 {moment_id} 至少要引用一个 {stream} 条目")
            continue

        local_seen: set[str] = set()
        for raw_item_id in raw_item_ids:
            item_id = str(raw_item_id).strip()
            if not item_id:
                errors.append(f"银河时刻 {moment_id} 含有空的条目 ID")
                continue
            if item_id in local_seen:
                errors.append(f"银河时刻 {moment_id} 重复引用了 {item_id}")
                continue
            local_seen.add(item_id)
            if item_id not in item_ids_by_stream[stream]:
                errors.append(f"银河时刻 {moment_id} 引用了不存在的 {stream} 条目：{item_id}")
                continue
            reference_key = (stream, item_id)
            if reference_key in referenced_by:
                errors.append(
                    f"{stream} 条目 {item_id} 同时被银河时刻 "
                    f"{referenced_by[reference_key]} 和 {moment_id} 引用"
                )
            else:
                referenced_by[reference_key] = moment_id

        date_value = str(moment.get("date") or "").strip()
        if date_value:
            match = re.fullmatch(r"(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?", date_value)
            if not match:
                errors.append(
                    f"银河时刻 {moment_id} 的日期必须是 YYYY、YYYY-MM 或 YYYY-MM-DD"
                )
            else:
                year_text, month_text, day_text = match.groups()
                try:
                    calendar_date(
                        int(year_text),
                        int(month_text or 1),
                        int(day_text or 1),
                    )
                except ValueError:
                    errors.append(f"银河时刻 {moment_id} 的日期无效：{date_value}")

        prominence = moment.get("prominence", 1)
        try:
            prominence_number = float(prominence)
        except (TypeError, ValueError):
            prominence_number = 0
        if prominence_number not in (1, 2, 3):
            errors.append(f"银河时刻 {moment_id} 的 prominence 必须是 1、2 或 3")

    countries_seen: set[str] = set()
    for index, country in enumerate(life.get("footprints", {}).get("visited_countries", [])):
        map_name = str(country.get("map_name") or "").strip() if isinstance(country, dict) else ""
        if not map_name:
            errors.append(f"life.footprints.visited_countries[{index}] 缺少 GeoJSON map_name")
        elif map_name in countries_seen:
            errors.append(f"到访国家和地区含有重复 map_name：{map_name}")
        else:
            countries_seen.add(map_name)

    if errors:
        raise ValueError("内容数据校验失败：\n- " + "\n- ".join(errors))


def resolved_moments(content: dict[str, Any], stream: str) -> list[dict[str, Any]]:
    life = content["life"]
    items = list(life.get(stream, []))
    by_id = {str(item.get("id")): item for item in items if item.get("id")}
    moments: list[dict[str, Any]] = []
    referenced: set[str] = set()

    for raw in life.get("moments", []):
        if raw.get("stream") != stream:
            continue
        item_ids = [str(item_id) for item_id in raw.get("item_ids", [])]
        resolved = [by_id[item_id] for item_id in item_ids if item_id in by_id]
        if not resolved:
            continue
        moment = dict(raw)
        moment["_items"] = resolved
        moments.append(moment)
        referenced.update(item_id for item_id in item_ids if item_id in by_id)

    unreferenced = [item for item in items if str(item.get("id")) not in referenced]
    if unreferenced:
        fallback_copy = {
            "gallery": {
                "en": "More photographs",
                "zh-CN": "更多光影",
                "zh-TW": "更多光影",
            },
            "shelf": {
                "en": "More from the shelf",
                "zh-CN": "更多书影",
                "zh-TW": "更多書影",
            },
            "thoughts": {
                "en": "More thoughts",
                "zh-CN": "更多随笔",
                "zh-TW": "更多隨筆",
            },
        }[stream]
        moments.append(
            {
                "id": f"{stream}-unsorted",
                "stream": stream,
                "date": "",
                "date_label": {
                    "en": "Undated",
                    "zh-CN": "未标日期",
                    "zh-TW": "未標日期",
                },
                "location": {},
                "summary": fallback_copy,
                "item_ids": [str(item.get("id")) for item in unreferenced],
                "prominence": 1,
                "_items": unreferenced,
            }
        )

    return sorted(moments, key=moment_sort_key)


def moment_seed(moment_id: str) -> int:
    return int(hashlib.sha1(moment_id.encode("utf-8")).hexdigest()[:8], 16)


def load_content(root: Path = ROOT) -> dict[str, Any]:
    return json.loads((root / "site_content.json").read_text(encoding="utf-8"))


def replace_region(text: str, name: str, replacement: str, fallback_pattern: str) -> str:
    start = f"<!-- SITEGEN:{name}_START -->"
    end = f"<!-- SITEGEN:{name}_END -->"
    replacement_text = replacement.rstrip()

    if start in text and end in text:
        wrapped = f"{start}\n{replacement_text}\n{end}"
        pattern = re.compile(r"^[ \t]*" + re.escape(start) + r"\s*.*?^[ \t]*" + re.escape(end), re.S | re.M)
        text, count = pattern.subn(lambda _match: wrapped, text, count=1)
    else:
        wrapped = replacement_text
        text, count = re.subn(r"^[ \t]*" + fallback_pattern, lambda _match: wrapped, text, count=1, flags=re.S | re.M)

    if count != 1:
        raise RuntimeError(f"Could not replace region {name}")
    return text


def replace_code_region(text: str, name: str, replacement: str, fallback_pattern: str) -> str:
    start = f"/* SITEGEN:{name}_START */"
    end = f"/* SITEGEN:{name}_END */"
    replacement_text = replacement.rstrip()

    if start in text and end in text:
        wrapped = f"{start}\n{replacement_text}\n{end}"
        pattern = re.compile(r"^[ \t]*" + re.escape(start) + r"\s*.*?^[ \t]*" + re.escape(end), re.S | re.M)
        text, count = pattern.subn(lambda _match: wrapped, text, count=1)
    else:
        wrapped = replacement_text
        text, count = re.subn(r"^[ \t]*" + fallback_pattern, lambda _match: wrapped, text, count=1, flags=re.S | re.M)

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

    for stream in GALAXY_STREAMS:
        for moment in resolved_moments(content, stream):
            moment_id = str(moment.get("id") or "")
            for lang in LANGS:
                i18n[lang][f"moment_date_{moment_id}"] = format_moment_date(moment, lang)
                i18n[lang][f"moment_location_{moment_id}"] = lang_value(moment.get("location", {}), lang)
                i18n[lang][f"moment_summary_{moment_id}"] = lang_value(moment.get("summary", {}), lang)

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
        <img src="{esc(hero.get("avatar", ""))}" alt="Runde Yang" class="hero-avatar" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="hero-avatar-placeholder" style="display:none;">R</div>
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
            cite_arg = esc(json.dumps(cite, ensure_ascii=False))
            cite_button = f'\n                    <button class="pub-btn" onclick="copyCitation({cite_arg})"><i class="fas fa-quote-right"></i> Cite</button>'
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
                    <img src="{esc(item.get("image", ""))}" alt="{esc(item.get("alt", item.get("name", "")))}">
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
        rows.append(f"""                <div class="gallery-item" role="button" tabindex="0"
                    aria-label="{esc(lang_value(item.get("caption", {}), "en"))}"
                    onclick="openLightbox(this)"
                    onkeydown="if(event.key==='Enter'||event.key===' '){{event.preventDefault();openLightbox(this)}}">
                    <img src="{esc(item.get("image", ""))}" alt="{esc(item.get("alt", ""))}" loading="lazy" decoding="async">
                    <div class="gallery-caption" data-key="{esc(key)}">{lang_value(item.get("caption", {}), "en")}</div>
                </div>""")
    return "\n".join(rows)


def render_home_gallery(content: dict[str, Any]) -> str:
    home = content["home"]
    life_card = home["life_card"]
    bg_imgs = "\n".join(
        f'                <img src="{esc(src)}" alt="">'
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
        <a class="life-card" id="lifePortalLink" href="life.html">
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
        </a>
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


def render_shelf_items(items: list[dict[str, Any]]) -> str:
    rows = []
    for index, item in enumerate(items):
        key = key_for("shelf", item, index)
        rows.append(f"""            <div class="shelf-item">
                <div class="shelf-icon"><i class="{esc(item.get("icon", "fas fa-book"))}"></i></div>
                <div class="shelf-info">
                    <div class="shelf-title en-only">{esc(item.get("title", ""))}</div>
                    <div class="shelf-comment" data-key="{esc(key)}">{lang_value(item.get("comment", {}), "en")}</div>
                </div>
            </div>""")
    return "\n".join(rows)


def render_thought_items(items: list[dict[str, Any]]) -> str:
    rows = []
    for index, item in enumerate(items):
        key = key_for("thought", item, index)
        text_values = item.get("text", {})
        should_collapse = any(len(lang_value(text_values, lang)) > THOUGHT_COLLAPSE_CHARS for lang in LANGS)
        text_class = "thought-text thought-text-collapsed" if should_collapse else "thought-text"
        toggle = ""
        if should_collapse:
            toggle = '\n                <button class="thought-toggle" type="button" data-thought-toggle aria-expanded="false">Read more</button>'
        rows.append(f"""            <div class="thought-item">
                <div class="thought-date" data-key="{esc('date_' + key)}">{lang_value(item.get("date", {}), "en")}</div>
                <div class="{text_class}" data-key="{esc(key)}">{lang_value(text_values, "en")}</div>{toggle}
            </div>""")
    return "\n".join(rows)


def render_galaxy_detail(stream: str, items: list[dict[str, Any]]) -> str:
    if stream == "gallery":
        return """                <div class="gallery-grid" data-gallery-group>
""" + render_gallery_items(items, grid=True) + """
                </div>"""
    if stream == "shelf":
        return """                <div class="shelf-list">
""" + render_shelf_items(items) + """
                </div>"""
    return """                <div class="thoughts-list">
""" + render_thought_items(items) + """
                </div>"""


def render_portal_section(content: dict[str, Any], stream: str) -> str:
    moments = resolved_moments(content, stream)
    blocks = []

    for index, moment in enumerate(moments):
        moment_id = str(moment.get("id") or f"{stream}-{index + 1}")
        date_key = f"moment_date_{moment_id}"
        location_key = f"moment_location_{moment_id}"
        summary_key = f"moment_summary_{moment_id}"
        date_text = format_moment_date(moment, "en")
        location_text = lang_value(moment.get("location", {}), "en")
        summary_text = lang_value(moment.get("summary", {}), "en")

        blocks.append(f"""                <article class="portal-moment" data-moment="{esc(moment_id)}">
                    <header class="portal-moment-header">
                        <div class="portal-moment-meta">
                            <span data-key="{esc(date_key)}">{esc(date_text)}</span>
                            <span class="portal-moment-location" data-key="{esc(location_key)}">{esc(location_text)}</span>
                        </div>
                        <h3 data-key="{esc(summary_key)}">{esc(summary_text)}</h3>
                    </header>
{render_galaxy_detail(stream, moment["_items"])}
                </article>""")

    return f"""        <section id="{stream}" class="portal-content" data-portal-content="{stream}" hidden>
            <div class="portal-moments">
{chr(10).join(blocks)}
            </div>
        </section>"""


def render_life_gallery(content: dict[str, Any]) -> str:
    return render_portal_section(content, "gallery")


def render_shelf(content: dict[str, Any]) -> str:
    return render_portal_section(content, "shelf")


def render_thoughts(content: dict[str, Any]) -> str:
    return render_portal_section(content, "thoughts")


def render_friends(content: dict[str, Any]) -> str:
    rows = "\n".join(
        f'                    <a href="{esc(item.get("href", "#"))}" class="friend-link">{esc(item.get("label", ""))}</a>'
        for item in content["life"]["friends"]
    )
    return """        <section id="friends" class="portal-content" data-portal-content="friends" hidden>
            <div class="friends-list">
""" + rows + """
            </div>
        </section>"""


def render_visited(content: dict[str, Any]) -> str:
    values = content["life"]["footprints"].get("visited_china", [])
    rows = ",\n".join(f"    {json.dumps(value, ensure_ascii=False)}" for value in values)
    return "const visited = [\n" + rows + "\n];"


def render_visited_countries(content: dict[str, Any]) -> str:
    values = content["life"]["footprints"].get("visited_countries", [])
    return "const visitedCountries = " + json_js(values) + ";"


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
        "LIFE_VISITED_COUNTRIES",
        render_visited_countries(content),
        r"const visitedCountries = \[.*?\];",
    )

    if write:
        path.write_text(text, encoding="utf-8", newline="\n")
    return text


def render_site(root: Path = ROOT, write: bool = True) -> tuple[str, str]:
    content = load_content(root)
    validate_content(content)
    return render_home(root, content, write), render_life(root, content, write)


def render_life_only(root: Path = ROOT, write: bool = True) -> str:
    content = load_content(root)
    validate_content(content)
    return render_life(root, content, write)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render static homepage HTML from site_content.json.")
    parser.add_argument("--check", action="store_true", help="Render in memory only; do not write files.")
    parser.add_argument(
        "--life-only",
        action="store_true",
        help="Render only life.html, leaving index.html byte-for-byte untouched.",
    )
    args = parser.parse_args()
    if args.life_only:
        render_life_only(ROOT, write=not args.check)
        print("Rendered life.html" if not args.check else "Life render check passed")
    else:
        render_site(ROOT, write=not args.check)
        print("Rendered index.html and life.html" if not args.check else "Render check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
