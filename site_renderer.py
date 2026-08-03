from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import unicodedata
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
AUTO_MOMENT_PREFIX = "__auto__"
STAR_CONTENT_BUDGET = 48
STAR_TEXT_COLUMNS = 42
CONSTELLATION_HIP_ORDER = {
    "gallery": (746, 3179, 4427, 6686, 8886),
    "footprints": (54061, 53910, 58001, 59774, 62956, 65378, 67301),
    "shelf": (91262, 91971, 92420, 93194, 92791),
    "thoughts": (102098, 100453, 95947, 97165, 102488),
    "friends": (36850, 37826, 32246, 35550, 30343, 31681),
    "about": (27989, 24436, 25336, 27366, 26207, 26311, 26727, 25930),
    "news": (97649, 93244, 99473, 93805, 93747, 98036, 97278, 97804, 95501),
    "publications": (
        113963,
        677,
        113881,
        1067,
        107315,
        112029,
        109427,
    ),
    "projects": (
        81693,
        84380,
        81833,
        83207,
        84345,
        80170,
        80816,
        84379,
    ),
    "notes": (76267, 76669, 79119, 75695, 78493, 76127, 78159, 76952, 77512),
}
CONSTELLATION_HIPS = {
    stream: set(hips)
    for stream, hips in CONSTELLATION_HIP_ORDER.items()
}


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
    return (1 if not date else 0, date)


def star_binding(content: dict[str, Any], stream: str, entry_id: str) -> int | None:
    value = content.get("life", {}).get("star_bindings", {}).get(stream, {}).get(entry_id)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def validate_content(
    content: dict[str, Any],
    *,
    require_star_bindings: bool = True,
) -> None:
    """Reject ambiguous IDs and broken galaxy references before writing HTML."""
    errors: list[str] = []
    home = content.get("home", {})
    life = content.get("life", {})

    collections = (
        ("home.news", home.get("news", [])),
        ("home.publications", home.get("publications", [])),
        ("home.projects", home.get("projects", [])),
        ("home.gallery", home.get("gallery", [])),
        ("home.notes", home.get("notes", [])),
        ("life.gallery", life.get("gallery", [])),
        ("life.shelf", life.get("shelf", [])),
        ("life.thoughts", life.get("thoughts", [])),
        ("life.friends", life.get("friends", [])),
        ("life.moments", life.get("moments", [])),
    )
    for label, items in collections:
        seen: set[str] = set()
        for index, item in enumerate(items):
            raw_id = item.get("id") if isinstance(item, dict) else None
            item_id = str(raw_id or "").strip()
            if not item_id:
                errors.append(f"{label}[{index}] 缺少非空 ID")
            elif isinstance(raw_id, str) and raw_id != item_id:
                errors.append(f"{label}[{index}] 的 ID 不能含首尾空格：{raw_id!r}")
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
        if moment_id.startswith(AUTO_MOMENT_PREFIX):
            errors.append(
                f"银河时刻 {moment_id} 使用了保留前缀 {AUTO_MOMENT_PREFIX}"
            )
        raw_stream = str(moment.get("stream") or "")
        stream = raw_stream.strip()
        if raw_stream != stream:
            errors.append(f"银河时刻 {moment_id} 的 stream 不能含首尾空格")
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
            raw_item_text = str(raw_item_id)
            item_id = raw_item_text.strip()
            if not item_id:
                errors.append(f"银河时刻 {moment_id} 含有空的条目 ID")
                continue
            if raw_item_text != item_id:
                errors.append(f"银河时刻 {moment_id} 的条目 ID 不能含首尾空格：{raw_item_text!r}")
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

        raw_date_value = str(moment.get("date") or "")
        date_value = raw_date_value.strip()
        if raw_date_value != date_value:
            errors.append(f"银河时刻 {moment_id} 的日期不能含首尾空格")
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

    if not errors:
        expected_entries = {
            stream: set(entry_ids)
            for stream, entry_ids in star_entry_ids(content).items()
        }
        bindings = life.get("star_bindings", {})
        if not isinstance(bindings, dict):
            errors.append("life.star_bindings 必须是对象")
            bindings = {}
        unknown_streams = sorted(set(bindings) - set(expected_entries))
        for stream in unknown_streams:
            errors.append(f"life.star_bindings 含有未知板块：{stream}")
        for stream, expected_ids in expected_entries.items():
            stream_bindings = bindings.get(stream, {})
            if not isinstance(stream_bindings, dict):
                errors.append(f"life.star_bindings.{stream} 必须是对象")
                continue
            for entry_id in sorted(expected_ids):
                hip = stream_bindings.get(entry_id)
                if hip is None and require_star_bindings:
                    errors.append(f"{stream} 条目 {entry_id} 尚未绑定星座恒星")
                elif hip is not None and (
                    not isinstance(hip, int)
                    or isinstance(hip, bool)
                    or hip not in CONSTELLATION_HIPS[stream]
                ):
                    errors.append(f"{stream} 条目 {entry_id} 绑定了不属于该星座的 HIP：{hip}")
            if require_star_bindings:
                for entry_id in stream_bindings:
                    if entry_id not in expected_ids:
                        errors.append(f"life.star_bindings.{stream} 含有悬空条目：{entry_id}")

            if not require_star_bindings:
                for entry_id, hip in stream_bindings.items():
                    if entry_id in expected_ids:
                        continue
                    if (
                        not isinstance(hip, int)
                        or isinstance(hip, bool)
                        or hip not in CONSTELLATION_HIPS[stream]
                    ):
                        errors.append(
                            f"life.star_bindings.{stream} 的悬空条目 "
                            f"{entry_id} 含有非法 HIP：{hip}"
                        )

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
        for item in unreferenced:
            item_id = str(item.get("id"))
            moments.append(
                {
                    "id": f"{AUTO_MOMENT_PREFIX}{stream}__{item_id}",
                    "stream": stream,
                    "date": "",
                    "date_label": {
                        "en": "Undated",
                        "zh-CN": "未标日期",
                        "zh-TW": "未標日期",
                    },
                    "location": {},
                    "summary": fallback_copy,
                    "item_ids": [item_id],
                    "prominence": 1,
                    "_items": [item],
                }
            )

    return sorted(moments, key=moment_sort_key)


def star_entry_ids(content: dict[str, Any]) -> dict[str, list[str]]:
    """Return selectable Life entries in the same stable order used by the page."""
    return {
        "gallery": [
            str(moment["id"])
            for moment in resolved_moments(content, "gallery")
        ],
        "footprints": ["footprints-map"],
        "shelf": [
            str(moment["id"])
            for moment in resolved_moments(content, "shelf")
        ],
        "thoughts": [
            str(moment["id"])
            for moment in resolved_moments(content, "thoughts")
        ],
        "friends": [
            str(friend["id"])
            for friend in content["life"].get("friends", [])
        ],
        "about": ["about-profile"],
        "news": [
            str(item["id"])
            for item in content["home"].get("news", [])
        ],
        "publications": [
            str(item["id"])
            for item in content["home"].get("publications", [])
        ],
        "projects": [
            str(item["id"])
            for item in content["home"].get("projects", [])
        ],
        "notes": [
            str(item["id"])
            for item in content["home"].get("notes", [])
        ],
    }


def display_columns(value: Any) -> int:
    """Approximate rendered text width in a narrow Life content panel."""
    text = html.unescape(re.sub(r"<[^>]*>", "", str(value or "")))
    return sum(
        2 if unicodedata.east_asian_width(character) in {"W", "F", "A"} else 1
        for character in text
    )


def text_lines(value: Any) -> int:
    """Estimate wrapped lines, taking the longest localized variant."""
    if isinstance(value, dict):
        variants = [value.get(lang, "") for lang in LANGS]
        return max((text_lines(variant) for variant in variants), default=1)
    physical_lines = str(value or "").splitlines() or [""]
    return sum(
        max(1, (display_columns(line) + STAR_TEXT_COLUMNS - 1) // STAR_TEXT_COLUMNS)
        for line in physical_lines
    )


def moment_header_weight(moment: dict[str, Any]) -> int:
    date_lines = max(text_lines(format_moment_date(moment, lang)) for lang in LANGS)
    return (
        4
        + date_lines
        + text_lines(moment.get("location", {}))
        + text_lines(moment.get("summary", {}))
    )


def star_entry_weights(content: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Estimate fully expanded content height in consistent panel-line units."""
    life = content["life"]
    home = content["home"]
    weights: dict[str, dict[str, int]] = {
        stream: {}
        for stream in CONSTELLATION_HIP_ORDER
    }

    for stream in GALAXY_STREAMS:
        for moment in resolved_moments(content, stream):
            entry_id = str(moment["id"])
            weight = moment_header_weight(moment)
            items = moment.get("_items", [])
            if stream == "gallery":
                weight += max(1, len(items)) * 13
            elif stream == "shelf":
                weight += sum(
                    4
                    + text_lines(item.get("title", ""))
                    + text_lines(item.get("comment", {}))
                    for item in items
                )
            else:
                weight += sum(
                    4
                    + text_lines(item.get("date", {}))
                    + text_lines(item.get("text", {}))
                    for item in items
                )
            weights[stream][entry_id] = max(1, weight)

    weights["footprints"]["footprints-map"] = STAR_CONTENT_BUDGET
    for friend in life.get("friends", []):
        entry_id = str(friend.get("id") or "")
        weights["friends"][entry_id] = 5 + text_lines(friend.get("label", ""))
    weights["about"]["about-profile"] = STAR_CONTENT_BUDGET
    for item in home.get("news", []):
        entry_id = str(item.get("id") or "")
        weights["news"][entry_id] = (
            5 + text_lines(item.get("date", "")) + text_lines(item.get("text", {}))
        )
    for item in home.get("publications", []):
        entry_id = str(item.get("id") or "")
        weights["publications"][entry_id] = (
            9
            + text_lines(item.get("title", ""))
            + text_lines(item.get("authors_html", ""))
            + text_lines(item.get("venue", ""))
        )
    for item in home.get("projects", []):
        entry_id = str(item.get("id") or "")
        weights["projects"][entry_id] = (
            19
            + text_lines(item.get("name", ""))
            + text_lines(item.get("desc", {}))
        )
    for item in home.get("notes", []):
        entry_id = str(item.get("id") or "")
        weights["notes"][entry_id] = (
            5 + text_lines(item.get("meta", "")) + text_lines(item.get("title", ""))
        )
    return weights


def assign_missing_star_bindings(content: dict[str, Any]) -> bool:
    """Fill one real star until its expanded content becomes too long.

    Existing valid bindings remain stable. New entries follow rendered order,
    continue on the current star while its estimated full height stays within
    the soft budget, then advance along the constellation's real-star path.
    """
    life = content.setdefault("life", {})
    existing = life.get("star_bindings", {})
    if not isinstance(existing, dict):
        existing = {}

    weights = star_entry_weights(content)
    rebuilt: dict[str, dict[str, int]] = {}
    for stream, entry_ids in star_entry_ids(content).items():
        path = CONSTELLATION_HIP_ORDER[stream]
        old_stream = existing.get(stream, {})
        if not isinstance(old_stream, dict):
            old_stream = {}

        loads = {hip: 0 for hip in path}
        stream_bindings: dict[str, int] = {}
        for entry_id in entry_ids:
            hip = old_stream.get(entry_id)
            if isinstance(hip, int) and not isinstance(hip, bool) and hip in loads:
                stream_bindings[entry_id] = hip
                loads[hip] += weights[stream].get(entry_id, 1)

        cursor = 0
        for entry_id in entry_ids:
            if entry_id in stream_bindings:
                cursor = path.index(stream_bindings[entry_id])
                continue
            weight = weights[stream].get(entry_id, 1)
            hip = path[cursor]
            if loads[hip] and loads[hip] + weight > STAR_CONTENT_BUDGET:
                candidates = [
                    path[(cursor + offset) % len(path)]
                    for offset in range(1, len(path) + 1)
                ]
                fitting = [
                    candidate
                    for candidate in candidates
                    if loads[candidate] == 0
                    or loads[candidate] + weight <= STAR_CONTENT_BUDGET
                ]
                if fitting:
                    hip = fitting[0]
                else:
                    distance = {candidate: index for index, candidate in enumerate(candidates)}
                    hip = min(candidates, key=lambda candidate: (loads[candidate], distance[candidate]))
                cursor = path.index(hip)
            stream_bindings[entry_id] = hip
            loads[hip] += weight

        rebuilt[stream] = stream_bindings

    changed = life.get("star_bindings") != rebuilt
    life["star_bindings"] = rebuilt
    return changed


def moment_seed(moment_id: str) -> int:
    return int(hashlib.sha1(moment_id.encode("utf-8")).hexdigest()[:8], 16)


def load_content(root: Path = ROOT) -> dict[str, Any]:
    return json.loads((root / "site_content.json").read_text(encoding="utf-8"))


def plain_html_text(value: Any) -> str:
    return html.unescape(re.sub(r"<[^>]*>", "", str(value or ""))).strip()


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
    home = content["home"]
    i18n = {lang: dict(life["labels"][lang]) for lang in LANGS}

    home_title_keys = {
        "title_about": "nav_about",
        "title_news": "title_news",
        "title_publications": "title_pubs",
        "title_projects": "title_projects",
        "title_notes": "title_notes",
    }
    action_copy = {
        "en": {
            "life_action_email": "Email",
            "life_action_paper": "Paper",
            "life_action_code": "Code",
            "life_action_cite": "Cite",
            "life_action_copied": "Copied",
        },
        "zh-CN": {
            "life_action_email": "邮件",
            "life_action_paper": "论文",
            "life_action_code": "代码",
            "life_action_cite": "引用",
            "life_action_copied": "已复制",
        },
        "zh-TW": {
            "life_action_email": "郵件",
            "life_action_paper": "論文",
            "life_action_code": "程式碼",
            "life_action_cite": "引用",
            "life_action_copied": "已複製",
        },
    }
    for lang in LANGS:
        for life_key, home_key in home_title_keys.items():
            i18n[lang][life_key] = lang_value(home["labels"][lang], home_key)
        i18n[lang]["life_about_name"] = plain_html_text(
            lang_value(home["hero"].get("name_html", {}), lang)
        )
        i18n[lang]["life_about_title"] = lang_value(home["hero"].get("title", {}), lang)
        i18n[lang]["life_about_bio"] = lang_value(home["hero"].get("bio", {}), lang)
        i18n[lang]["life_about_location"] = lang_value(home["hero"].get("location", {}), lang)
        i18n[lang]["notes_empty"] = lang_value(home.get("notes_empty", {}), lang)
        i18n[lang].update(action_copy[lang])

    for index, item in enumerate(home.get("news", [])):
        key = key_for("news", item, index)
        for lang in LANGS:
            i18n[lang][key] = lang_value(item.get("text", {}), lang)

    for index, item in enumerate(home.get("projects", [])):
        key = f"proj_{key_for('project', item, index)}"
        for lang in LANGS:
            i18n[lang][key] = lang_value(item.get("desc", {}), lang)

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

        hip = star_binding(content, stream, moment_id)
        blocks.append(f"""                <article class="portal-moment" data-moment="{esc(moment_id)}" data-portal-entry="{esc(moment_id)}" data-star-hip="{esc(hip)}">
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


def render_footprints(content: dict[str, Any]) -> str:
    hip = star_binding(content, "footprints", "footprints-map")
    country_names = [
        lang_value(country.get("label", {}), "en") or str(country.get("map_name") or "")
        for country in content["life"]["footprints"].get("visited_countries", [])
        if isinstance(country, dict)
    ]
    summary = f"Countries visited: {', '.join(filter(None, country_names))}"
    return f"""            <section id="footprints" class="portal-content" data-portal-content="footprints" hidden>
                <p class="sr-only" id="visitedCountriesSummary">{esc(summary)}</p>
                <div class="maps-list" data-portal-entry="footprints-map" data-star-hip="{esc(hip)}">
                    <article class="map-card">
                        <div class="map-card-title" data-key="chart_world">Countries visited</div>
                        <div id="worldMap" class="map-box" role="img" aria-describedby="visitedCountriesSummary"></div>
                    </article>
                    <article class="map-card">
                        <div class="map-card-title" data-key="chart_china">China</div>
                        <div id="chinaMap" class="map-box" role="img" aria-label="Cities visited in Mainland China"></div>
                    </article>
                </div>
            </section>"""


def render_shelf(content: dict[str, Any]) -> str:
    return render_portal_section(content, "shelf")


def render_thoughts(content: dict[str, Any]) -> str:
    return render_portal_section(content, "thoughts")


def render_friends(content: dict[str, Any]) -> str:
    rows = "\n".join(
        f'                    <a href="{esc(item.get("href", "#"))}" class="friend-link" '
        f'data-portal-entry="{esc(item.get("id", ""))}" '
        f'data-star-hip="{esc(star_binding(content, "friends", str(item.get("id") or "")))}">'
        f'{esc(item.get("label", ""))}</a>'
        for item in content["life"]["friends"]
    )
    return """        <section id="friends" class="portal-content" data-portal-content="friends" hidden>
                <div class="friends-list">
""" + rows + """
                </div>
            </section>"""


def render_life_about(content: dict[str, Any]) -> str:
    """Keep the About content model intact while its Life portal is hidden."""
    return ""


def _render_life_about_archive(content: dict[str, Any]) -> str:
    site = content["site"]
    hero = content["home"]["hero"]
    hip = star_binding(content, "about", "about-profile")
    email = f"{site.get('email_user', '')}@{site.get('email_domain', '')}"
    social_links = "\n".join(
        f"""                            <a class="about-link" href="{esc(link.get("href") or "#")}" target="_blank" rel="noopener">
                                <span class="about-link-mark" aria-hidden="true">↗</span>
                                <span>{esc(link.get("label") or "Link")}</span>
                            </a>"""
        for link in hero.get("links", [])
    )
    return f"""            <section id="about" class="portal-content" data-portal-content="about" hidden>
                <article class="about-card" data-portal-entry="about-profile" data-star-hip="{esc(hip)}">
                    <div class="about-portrait">
                        <img src="{esc(hero.get("avatar", ""))}" alt="Runde Yang" loading="lazy" decoding="async"
                            onerror="this.hidden=true;this.nextElementSibling.hidden=false">
                        <span class="about-portrait-fallback" hidden>RY</span>
                    </div>
                    <div class="about-copy">
                        <h3 data-key="life_about_name">{esc(plain_html_text(lang_value(hero.get("name_html", {}), "en")))}</h3>
                        <p class="about-role" data-key="life_about_title">{esc(lang_value(hero.get("title", {}), "en"))}</p>
                        <p class="about-bio" data-key="life_about_bio">{esc(lang_value(hero.get("bio", {}), "en"))}</p>
                        <div class="about-links">
                            <a class="about-link" href="mailto:{esc(email)}">
                                <span class="about-link-mark" aria-hidden="true">✉</span>
                                <span data-key="life_action_email">Email</span>
                            </a>
{social_links}
                            <span class="about-link">
                                <span class="about-link-mark" aria-hidden="true">⌖</span>
                                <span data-key="life_about_location">{esc(lang_value(hero.get("location", {}), "en"))}</span>
                            </span>
                        </div>
                    </div>
                </article>
            </section>"""


def render_life_news(content: dict[str, Any]) -> str:
    rows = []
    for index, item in enumerate(content["home"].get("news", [])):
        item_id = str(item.get("id") or "")
        key = key_for("news", item, index)
        rows.append(f"""                    <li class="news-item news-entry" data-portal-entry="{esc(item_id)}" data-star-hip="{esc(star_binding(content, "news", item_id))}">
                        <span class="news-date">{esc(item.get("date", ""))}</span>
                        <span class="news-text" data-key="{esc(key)}">{esc(lang_value(item.get("text", {}), "en"))}</span>
                    </li>""")
    return """            <section id="news" class="portal-content homepage-parity" data-portal-content="news" hidden>
                <ul class="news-list">
""" + "\n".join(rows) + """
                </ul>
            </section>"""


def render_life_publications(content: dict[str, Any]) -> str:
    rows = []
    for item in content["home"].get("publications", []):
        item_id = str(item.get("id") or "")
        citation = "\n".join(
            line.rstrip()
            for line in str(item.get("citation") or "").strip().splitlines()
        )
        cite_button = ""
        citation_source = ""
        if citation:
            cite_button = """                            <button class="pub-btn" type="button" data-copy-citation>
                                <i class="fas fa-quote-right" aria-hidden="true"></i>
                                <span data-key="life_action_cite">Cite</span>
                            </button>"""
            citation_source = f'\n                        <pre data-citation-source hidden>{esc(citation)}</pre>'
        rows.append(f"""                    <div class="pub-item publication-entry" data-portal-entry="{esc(item_id)}" data-star-hip="{esc(star_binding(content, "publications", item_id))}">
                         <div class="pub-title-text en-only">{esc(item.get("title", ""))}</div>
                         <div class="pub-authors en-only">{item.get("authors_html", "")}</div>
                         <div class="pub-venue en-only">{esc(item.get("venue", ""))}</div>
                         <div class="pub-actions">
                            <a class="pub-btn" href="{esc(item.get("paper_url") or "#")}">
                                <i class="far fa-file-pdf" aria-hidden="true"></i>
                                <span data-key="life_action_paper">Paper</span>
                            </a>
                            <a class="pub-btn" href="{esc(item.get("code_url") or "#")}">
                                <i class="fab fa-github" aria-hidden="true"></i>
                                <span data-key="life_action_code">Code</span>
                            </a>
{cite_button}
                         </div>{citation_source}
                    </div>""")
    return """            <section id="publications" class="portal-content homepage-parity" data-portal-content="publications" hidden>
                <div class="pub-list">
""" + "\n".join(rows) + """
                </div>
            </section>"""


def render_life_projects(content: dict[str, Any]) -> str:
    rows = []
    for index, item in enumerate(content["home"].get("projects", [])):
        item_id = str(item.get("id") or "")
        desc_key = f"proj_{key_for('project', item, index)}"
        rows.append(f"""                    <div class="project-card project-entry" data-portal-entry="{esc(item_id)}" data-star-hip="{esc(star_binding(content, "projects", item_id))}">
                         <div class="project-img-wrap">
                            <img src="{esc(item.get("image", ""))}" alt="{esc(item.get("alt", item.get("name", "")))}">
                         </div>
                         <div class="project-body">
                             <div class="project-name en-only">{esc(item.get("name", ""))}</div>
                             <div class="project-desc" data-key="{esc(desc_key)}">{esc(lang_value(item.get("desc", {}), "en"))}</div>
                             <div class="project-links">
                                <a class="project-link" href="{esc(item.get("paper_url") or "#")}">
                                    <i class="far fa-file-alt" aria-hidden="true"></i>
                                    <span data-key="life_action_paper">Paper</span>
                                </a>
                                <a class="project-link" href="{esc(item.get("code_url") or "#")}">
                                    <i class="fab fa-github" aria-hidden="true"></i>
                                    <span data-key="life_action_code">Code</span>
                                </a>
                             </div>
                         </div>
                    </div>""")
    return """            <section id="projects" class="portal-content homepage-parity" data-portal-content="projects" hidden>
                <div class="project-grid">
""" + "\n".join(rows) + """
                </div>
            </section>"""


def render_life_notes(content: dict[str, Any]) -> str:
    rows = []
    for item in content["home"].get("notes", []):
        item_id = str(item.get("id") or "")
        rows.append(f"""                    <a class="note-item note-entry" href="{esc(item.get("href") or "#")}" target="_blank" rel="noopener"
                         data-portal-entry="{esc(item_id)}" data-star-hip="{esc(star_binding(content, "notes", item_id))}">
                        <span class="note-icon"><i class="{esc(item.get("icon", "far fa-file-pdf"))}" aria-hidden="true"></i></span>
                        <div class="note-info">
                            <div class="note-title">{esc(item.get("title", ""))}</div>
                            <div class="note-meta">{esc(item.get("meta", ""))}</div>
                        </div>
                        <span class="note-arrow"><i class="fas fa-chevron-right" aria-hidden="true"></i></span>
                     </a>""")
    body = "\n".join(rows)
    if not rows:
        body = '                    <div class="notes-empty" data-key="notes_empty">Notes coming soon...</div>'
    return """            <section id="notes" class="portal-content homepage-parity" data-portal-content="notes" hidden>
                <div class="notes-grid">
""" + body + """
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


def render_life_artifacts(
    root: Path,
    content: dict[str, Any],
) -> tuple[str, str]:
    html_path = root / "life.html"
    content_data_path = root / "assets" / "life" / "scripts" / "01-content-data.js"
    html_text = html_path.read_text(encoding="utf-8")
    content_data_text = content_data_path.read_text(encoding="utf-8")
    html_text = replace_region(html_text, "LIFE_GALLERY", render_life_gallery(content), r'<!-- Gallery -->\s*<section id="gallery".*?</section>')
    html_text = replace_region(html_text, "LIFE_FOOTPRINTS", render_footprints(content), r'<section id="footprints".*?</section>')
    html_text = replace_region(html_text, "LIFE_SHELF", render_shelf(content), r'<!-- Shelf -->\s*<section id="shelf".*?</section>')
    html_text = replace_region(html_text, "LIFE_THOUGHTS", render_thoughts(content), r'<!-- Thoughts -->\s*<section id="thoughts".*?</section>')
    html_text = replace_region(html_text, "LIFE_FRIENDS", render_friends(content), r'<!-- Friends -->\s*<section id="friends".*?</section>')
    html_text = replace_region(html_text, "LIFE_ABOUT", render_life_about(content), r'<section id="about".*?</section>')
    html_text = replace_region(html_text, "LIFE_NEWS", render_life_news(content), r'<section id="news".*?</section>')
    html_text = replace_region(html_text, "LIFE_PUBLICATIONS", render_life_publications(content), r'<section id="publications".*?</section>')
    html_text = replace_region(html_text, "LIFE_PROJECTS", render_life_projects(content), r'<section id="projects".*?</section>')
    html_text = replace_region(html_text, "LIFE_NOTES", render_life_notes(content), r'<section id="notes".*?</section>')
    content_data_text = replace_code_region(content_data_text, "LIFE_I18N", render_life_i18n(content), r'/\* ===== i18n ===== \*/\s*const i18n = \{.*?\};')
    content_data_text = replace_code_region(content_data_text, "LIFE_VISITED", render_visited(content), r'const visited = \[.*?\];')
    content_data_text = replace_code_region(
        content_data_text,
        "LIFE_VISITED_COUNTRIES",
        render_visited_countries(content),
        r"const visitedCountries = \[.*?\];",
    )
    return html_text, content_data_text


def render_life(root: Path, content: dict[str, Any], write: bool) -> str:
    html_path = root / "life.html"
    content_data_path = root / "assets" / "life" / "scripts" / "01-content-data.js"
    html_text, content_data_text = render_life_artifacts(root, content)
    if write:
        html_path.write_text(html_text, encoding="utf-8", newline="\n")
        content_data_path.write_text(content_data_text, encoding="utf-8", newline="\n")
    return html_text


def render_site(root: Path = ROOT, write: bool = True) -> tuple[str, str]:
    content = load_content(root)
    if write:
        validate_content(content, require_star_bindings=False)
        bindings_changed = assign_missing_star_bindings(content)
        validate_content(content)
        if bindings_changed:
            (root / "site_content.json").write_text(
                json.dumps(content, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    else:
        validate_content(content)
    return render_home(root, content, write), render_life(root, content, write)


def render_life_only(root: Path = ROOT, write: bool = True) -> str:
    content = load_content(root)
    if write:
        validate_content(content, require_star_bindings=False)
        bindings_changed = assign_missing_star_bindings(content)
        validate_content(content)
        if bindings_changed:
            (root / "site_content.json").write_text(
                json.dumps(content, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
    else:
        validate_content(content)
    return render_life(root, content, write)


def require_current_artifact(path: Path, expected: str, root: Path) -> None:
    current = path.read_text(encoding="utf-8")
    if current == expected:
        return
    try:
        label = path.relative_to(root)
    except ValueError:
        label = path
    raise RuntimeError(
        f"{label} is out of date; run site_renderer.py to regenerate it"
    )


def check_life_render(root: Path = ROOT) -> tuple[str, str]:
    content = load_content(root)
    validate_content(content)
    html_text, content_data_text = render_life_artifacts(root, content)
    require_current_artifact(root / "life.html", html_text, root)
    require_current_artifact(
        root / "assets" / "life" / "scripts" / "01-content-data.js",
        content_data_text,
        root,
    )
    return html_text, content_data_text


def check_site_render(root: Path = ROOT) -> tuple[str, str, str]:
    content = load_content(root)
    validate_content(content)
    home_text = render_home(root, content, write=False)
    life_text, content_data_text = render_life_artifacts(root, content)
    require_current_artifact(root / "index.html", home_text, root)
    require_current_artifact(root / "life.html", life_text, root)
    require_current_artifact(
        root / "assets" / "life" / "scripts" / "01-content-data.js",
        content_data_text,
        root,
    )
    return home_text, life_text, content_data_text


def main() -> int:
    parser = argparse.ArgumentParser(description="Render static homepage HTML from site_content.json.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Render in memory, verify generated artifacts are current, and do not write files.",
    )
    parser.add_argument(
        "--life-only",
        action="store_true",
        help="Render only life.html, leaving index.html byte-for-byte untouched.",
    )
    args = parser.parse_args()
    if args.check and args.life_only:
        check_life_render(ROOT)
        print("Life render check passed")
    elif args.check:
        check_site_render(ROOT)
        print("Render check passed")
    elif args.life_only:
        render_life_only(ROOT, write=not args.check)
        print("Rendered life.html")
    else:
        render_site(ROOT, write=not args.check)
        print("Rendered index.html and life.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
