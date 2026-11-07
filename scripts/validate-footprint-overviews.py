"""Validate overview visits, grouping and native relief assets without rendering Blender.

Run after build-footprint-overviews.py --package. This intentionally leaves the
legacy city/route archive checks to validate-footprint-atlas.py.
"""

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import re

import numpy as np
from PIL import Image
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[1]
RELIEF = ROOT / "assets/maps/relief"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_builder():
    spec = importlib.util.spec_from_file_location("footprint_overviews", ROOT / "scripts/build-footprint-overviews.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def expected_chinese_visits(content):
    """Derive expected provinces from source geography, independent of the builder."""
    municipalities = {110000: "北京市", 120000: "天津市", 310000: "上海市", 500000: "重庆市"}
    city_parents = {}
    for feature in read_json(ROOT / "assets/maps/china_city_full.json")["features"]:
        properties = feature["properties"]
        parent = properties.get("parent", {}).get("adcode")
        if properties.get("level") == "city":
            city_parents[properties["name"]] = parent
        elif properties.get("level") == "district" and parent in municipalities:
            city_parents[municipalities[parent]] = parent
    cities = content["visited_china"]
    assert len(cities) == len(set(cities)), "Duplicate city visits should be removed from the source list"
    assert not (set(cities) - city_parents.keys()), "Every visited city must have a known province"
    return {city_parents[city] for city in cities}


def validate_regions(identifier, metadata, content, provinces):
    overview = metadata["overview"]
    expected_unit = {"china": "province", "east_asia": "cultural-region", "europe_usa": "country"}[identifier]
    assert overview["unit"] == expected_unit
    assert overview.get("routes", []) == [], "Transit corridors belong only in the detailed view"
    for key in ("width", "height", "projection", "extent_km"):
        assert overview[key] == metadata[key], (identifier, key, "overview must align exactly with the existing relief")
    regions = overview["regions"]
    assert regions and len({region["id"] for region in regions}) == len(regions), (identifier, "region IDs must be unique")
    countries = set(content.get("visited_country_codes", []))
    cultural_regions = set(content.get("visited_overseas_regions", []))
    for region in regions:
        assert region["name"] and region["path"] and re.fullmatch(r"#[0-9a-fA-F]{6}", region["color"])
        assert isinstance(region["visited"], bool)
        center = region["center"]
        assert len(center) == 2 and 0 <= center[0] <= metadata["width"] and 0 <= center[1] <= metadata["height"], (identifier, region["id"], "center outside image")
        values = np.asarray(re.findall(r"-?\d+(?:\.\d+)?", region["path"]), dtype=float)
        assert len(values) >= 6 and len(values) % 2 == 0 and np.isfinite(values).all()
        assert values[0::2].min() >= -0.02 and values[0::2].max() <= metadata["width"] + 0.02
        assert values[1::2].min() >= -0.02 and values[1::2].max() <= metadata["height"] + 0.02
        if region["unit"] == "province":
            expected = region["province"] in provinces
        elif region["unit"] == "cultural-region":
            expected = region["id"] in cultural_regions
        else:
            expected = region["country"] in countries
        assert region["visited"] == expected, (identifier, region["id"], "lighting must follow actual visits only")
    if identifier in {"china", "east_asia"}:
        provincial = [region for region in regions if region["unit"] == "province"]
        province_source = read_json(ROOT / "assets/maps/china_100000_full.json")["features"]
        bounds = box(*metadata["geographic_bounds"])
        all_provinces = {feature["properties"]["adcode"] for feature in province_source
                         if isinstance(feature["properties"]["adcode"], int)
                         and shape(feature["geometry"]).intersects(bounds)}
        assert {region["province"] for region in provincial} == all_provinces
        assert {region["province"] for region in provincial if region["visited"]} == provinces & all_provinces
        transit = {segment["adcode"] for route in metadata["routes"] for segment in route["segments"]}
        assert not any(region["visited"] for region in provincial if region["province"] in transit - provinces), "Passing through a province must not mark a visit"
    if not countries and not cultural_regions:
        assert not any(region["visited"] for region in regions if region["unit"] != "province"), "No overseas visits means no overseas coloured terrain"


def validate_cultures(atlas):
    config = read_json(ROOT / "tools/relief-atlas/cultural-regions.json")
    regions = atlas["maps"]["east_asia"]["overview"]["regions"]
    expected_members = {
        "JPN": {f"JP-{code:02d}" for code in range(1, 48)},
        # The archived Natural Earth source uses KR-49 for Jeju and KR-50 for Sejong.
        "KOR": {f"KR-{code:02d}" for code in [11, 26, 27, 28, 29, 30, 31, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]},
    }
    counts = {}
    for country in ("JPN", "KOR"):
        configured = config[country]
        members = [member for group in configured for member in group["members"]]
        assert len(members) == len(set(members)) and set(members) == expected_members[country], (country, "groups must cover each source unit exactly once")
        published = {region["id"]: region for region in regions if region["country"] == country}
        assert set(published) == {group["id"] for group in configured}
        for group in configured:
            region = published[group["id"]]
            assert region["unit"] == "cultural-region" and set(region["members"]) == set(group["members"])
            assert region["label"] == group["label"] and set(region["label"]) == {"en", "zh-CN", "zh-TW"}
        counts[country] = {"groups": len(configured), "source_units": len(members)}
    return counts


def validate_country_colours(atlas, builder):
    detail = atlas["maps"]["europe_usa"]["regions"]
    regions = atlas["maps"]["europe_usa"]["overview"]["regions"]
    assert all(region["unit"] == "country" and region["id"] == region["country"] for region in regions)
    assert {region["country"] for region in regions} == {region["country"] for region in detail}, "Country merging must retain the full original map coverage"
    palette = {region["id"]: region["color"] for region in regions}
    if builder.STYLE.get("map_palettes"):
        assert set(palette.values()) <= set(builder.STYLE["map_palettes"]["europe_usa"])
    else:
        assert len(set(palette.values())) == len(palette), "Every displayed country needs its own pigment"
    # Evaluate reversed order plus an added country ID: existing colours must be
    # determined by identity, never by a country's position in a palette list.
    reordered = {identifier: builder.stable_colour(identifier) for identifier in ["ZZZ", *reversed(palette)]}
    assert all(colour == reordered[identifier] for identifier, colour in palette.items())
    return {"countries": len(palette), "pigments": len(set(palette.values()))}


def validate_sectional_colours(atlas, builder):
    if not builder.STYLE.get("map_palettes"):
        return
    for identifier, metadata in atlas["maps"].items():
        provinces = builder.STYLE.get("map_province_colors", {}).get(identifier, builder.STYLE["province_colors"])
        for region in metadata["overview"]["regions"]:
            expected = (provinces[str(region["province"])] if region.get("province")
                        else builder.stable_colour(region["id"], identifier))
            assert region["color"] == expected, (identifier, region["id"], "sectional pigment differs")


def validate_cultural_policy(config):
    owners = {str(member): group['id'] for group in config['groups'] for member in group['members']}
    assert len(owners) == sum(len(group['members']) for group in config['groups']), "Cultural assignments must not overlap"
    assert config.get('policy', {}).get('priority'), "Cultural grouping must state its criteria"
    for group in config['groups']:
        assert group.get('basis'), (group['id'], "missing cultural rationale")
        assert not group['label']['zh-CN'].endswith('文化区'), (group['id'], "use the established short name")
    shared_groups = {
        'northeast': ['230100', '220100', '210100', '150500', '150700'],
        'bohai': ['210200', '370600', '371600'],
        'nanjing_anhui': ['320100', '321100', '340100', '341100'],
        'wuyue': ['310000', '320500', '330100', '330200', '330300'],
        'wuling': ['422800', '430800', '433100', '520600'],
        'qinba': ['610700', '420300', '621200'],
        'tibet': ['540100', '513200', '513300', '623000', '632200'],
        'hakka': ['360700', '350800', '441300', '441400'],
        'qinlian': ['450500', '450600', '450700'],
    }
    for name, members in shared_groups.items():
        assert len({owners[member] for member in members}) == 1, (name, "cross-province cultural connection lost")
    for first, second in [('341000', '340200'), ('350300', '350400'), ('441500', '441400'), ('450700', '450100')]:
        assert owners[first] != owners[second], (first, second, "distinct cultural regions were conflated")
    names = {group['id']: group['label']['zh-CN'] for group in config['groups']}
    assert names[owners['230100']] == '满洲' and names[owners['540100']] == '西藏'
    return {'groups': len(config['groups']), 'members': len(owners), 'cross_region_checks': len(shared_groups)}


def validate_china_cultural(atlas):
    cultural = atlas["maps"]["china"].get("cultural")
    if not cultural:
        return {"groups": 0, "members": 0}
    spec = importlib.util.spec_from_file_location("china_cultural", ROOT / "scripts/build-china-cultural-overview.py")
    cultural_builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cultural_builder)
    regions = cultural.get("regions", [])
    config = read_json(ROOT / "tools/relief-atlas/china-cultural-regions.json")
    validate_cultural_policy(config)
    assert cultural.get('classification_version') == config.get('version'), "Published cultural revision differs from its rules"
    configured = {region["id"]: region for region in config["groups"]}
    assert {region["id"] for region in regions} == set(configured), "Cultural groups differ from the editable configuration"
    china = atlas["maps"]["china"]
    detail = {str(region["id"]): region for region in china["regions"]}
    detail_provinces = {str(region["province"]) for region in china["regions"] if region.get("province")}
    detail.update({str(region["id"]): region for region in china.get("overview", {}).get("regions", [])
                   if str(region.get("province")) not in detail_provinces})
    assert regions and len({str(region["id"]) for region in regions}) == len(regions)
    assigned = []
    for region in regions:
        members = region.get("members", region.get("member_ids", []))
        visited = region.get("visited_members", [])
        assert set(map(str, members)) == set(map(str, configured[region["id"]]["members"])), "Rebake after changing cultural memberships"
        assert region["label"] == configured[region["id"]]["label"]
        assert members and len(members) == len(set(map(str, members))), (region["id"], "duplicate cultural members")
        assert set(map(str, visited)) <= set(map(str, members)), (region["id"], "visited member not assigned")
        assert all(str(member) in detail for member in members), (region["id"], "unknown cultural member")
        expected = {member_id for member_id, item in detail.items() if item.get("visited")}
        assert set(map(str, visited)) == expected.intersection(set(map(str, members))), (region["id"], "visit derivation differs")
        assert bool(visited) == bool(region.get("visited")), (region["id"], "group visit differs")
        assert region.get("boundary_path"), (region["id"], "missing cultural outline")
        boundary = cultural_builder.polygon_geometry(region["boundary_path"])
        assert boundary.geom_type in {"Polygon", "MultiPolygon"}, (region["id"], "invalid cultural outline")
        polygons = [boundary] if boundary.geom_type == "Polygon" else list(boundary.geoms)
        assert all(not polygon.interiors for polygon in polygons), (region["id"], "cultural outline contains internal seams")
        assigned.extend(map(str, members))
    assert len(assigned) == len(set(assigned)), "A city must belong to exactly one cultural group"
    assert set(assigned) == set(detail), "Cultural groups must cover every China detail city"
    return {"groups": len(regions), "members": len(assigned)}


def validate_visit_updates(atlas, builder, provinces):
    """Exercise an addition/removal in memory without editing the user's visits."""
    regions = deepcopy([region for metadata in atlas["maps"].values() for region in metadata["overview"]["regions"]])
    provincial_codes = {region["province"] for region in regions if region["unit"] == "province"}
    province = min(provincial_codes - provinces or provincial_codes)
    culture = next(region["id"] for region in regions if region["unit"] == "cultural-region")
    country = next(region["country"] for region in regions if region["unit"] == "country" and region["country"] == "FRA")
    builder.update_visited(regions, ({province}, {culture}, {country}))
    for region in regions:
        expected = (region.get("province") == province if region["unit"] == "province" else
                    region["id"] == culture if region["unit"] == "cultural-region" else region["country"] == country)
        assert region["visited"] == expected, (region["id"], "adding one visit must not light adjacent regions")
    builder.update_visited(regions, (set(), set(), set()))
    assert not any(region["visited"] for region in regions), "Removing visits must restore every region to white"


def sample_image(path, dimensions):
    with Image.open(path) as image:
        assert image.size == dimensions, (str(path), "native dimensions changed")
        return np.asarray(image.convert("RGB"))[::8, ::8].astype(np.int16)


def validate_native(identifier, metadata):
    overview = metadata["overview"]
    dimensions = (metadata["width"], metadata["height"])
    relief_root = ROOT / overview["relief_source_archive"]
    colour_root = ROOT / overview["color_source_archive"]
    native_colour = colour_root / "renders" / (identifier + "-colour.png")
    assert digest(native_colour) == overview["outputs"][native_colour.name], (identifier, "native colour image checksum")
    native = sample_image(native_colour, dimensions)
    published = sample_image(RELIEF / overview["color_image"], dimensions)
    difference = np.abs(published - native)
    assert difference.mean() < 1.5 and np.percentile(difference, 95) <= 4, (identifier, "only WebP encoding, without tonal editing, is allowed")
    native_relief = sample_image(relief_root / "renders" / (identifier + "-relief.png"), dimensions)
    published_relief = sample_image(RELIEF / metadata["image"], dimensions)
    with np.load(relief_root / "data" / f"{identifier}.npz") as grid:
        land = Image.fromarray(grid["mask"].astype(np.uint8)).resize(dimensions, Image.Resampling.NEAREST)
        neutral_land = np.asarray(land)[::8, ::8].astype(bool) & (native_relief.mean(axis=2) > 40)
    native_shades = native_relief[neutral_land].mean(axis=1)
    published_shades = published_relief[neutral_land].mean(axis=1)
    assert native_shades.size > 100 and published_shades.std() > 12 and np.ptp(published_shades) > 120, "White material must retain terrain shadows"
    contrast = published_shades.std() / native_shades.std()
    slope, offset = np.polyfit(native_shades, published_shades, 1)
    assert 0.995 < contrast < 1.005 and abs(slope - 1) < 0.005 and abs(offset) < 1, "White relief must not be brightened after rendering"
    background = np.asarray([int(metadata["display_background"][start:start + 2], 16) for start in (1, 3, 5)])
    sea = np.max(np.abs(native_relief - background), axis=2) <= 1
    assert sea.any() and np.percentile(np.abs(published[sea] - background), 95) <= 2, "Overview sea must match the original relief"
    relief_report = read_json(relief_root / "scenes" / (identifier + "-scenes.json"))["relief"]
    colour_report = read_json(colour_root / "scenes" / (identifier + "-scenes.json"))["colour"]
    style = read_json(ROOT / "tools/relief-atlas/footprints-style.json")
    unvisited = style.get("unvisited_materials", {}).get(identifier, style["unvisited_material"])
    assert relief_report["white_material_verified"] and metadata["unvisited_material"] == unvisited
    for report in (relief_report, colour_report):
        assert report["reopened"] and report["pigments_verified"] and report["lighting_verified"]
        assert report["resolution"] == list(dimensions) and report["postprocessing"] == "none"
        assert report["sea_material"] == metadata["sea_material"]
    if identifier != "china":
        assert overview["postprocessing"] == "none" and overview["sea_material"] == metadata["sea_material"]
        archive = ROOT / overview["source_archive"]
        source_metadata = read_json(archive / "data" / (identifier + ".json"))
        with np.load(archive / "data" / (identifier + ".npz")) as new, np.load(relief_root / "data" / (identifier + ".npz")) as previous:
            assert set(new.files) == set(previous.files)
            for key in previous.files:
                if key != "region":
                    assert np.array_equal(new[key], previous[key], equal_nan=True), (identifier, key, "overview pigments must reuse the same terrain and camera grid")
            assert set(np.unique(new["region"])) <= {0, *map(int, source_metadata["region_colors"])}
            for region in overview["regions"]:
                assert source_metadata["region_colors"][str(region["raster_id"])] == region["color"]
    return {"dimensions": dimensions, "colour_mean_error_255": round(float(difference.mean()), 4),
            "white_shadow_contrast": round(float(contrast), 4)}


def validate_cultural_native(atlas):
    cultural = atlas["maps"]["china"].get("cultural")
    if not cultural:
        return None
    archive = ROOT / cultural["color_source_archive"]
    native_path = archive / "renders/china-colour.png"
    assert digest(native_path) == cultural["outputs"][native_path.name]
    dimensions = (atlas["maps"]["china"]["width"], atlas["maps"]["china"]["height"])
    with Image.open(native_path) as image:
        assert image.size == dimensions
        native = np.asarray(image.convert("RGB"))[::8, ::8].astype(np.int16)
    with Image.open(RELIEF / cultural["color_image"]) as image:
        assert image.size == dimensions
        published = np.asarray(image.convert("RGB"))[::8, ::8].astype(np.int16)
    difference = np.abs(published - native)
    assert difference.mean() < 1.5 and np.percentile(difference, 95) <= 4
    report = read_json(archive / "renders/china-render.json")
    assert report["postprocessing"] == "none" and report["outputs"][native_path.name] == digest(native_path)
    scene_path = archive / "scenes/china-scenes.json"
    if scene_path.exists():
        scene = read_json(scene_path).get("colour", read_json(scene_path))
        assert scene["reopened"] and scene["pigments_verified"] and scene["lighting_verified"]
        assert scene["postprocessing"] == "none"
        blend_path = archive / "scenes" / scene["file"]
        assert digest(blend_path) == scene["sha256"]
    preview = cultural.get("preview_color_image")
    if preview:
        with Image.open(RELIEF / preview) as image:
            assert image.width <= 1600 and image.height > 0
    return {"dimensions": dimensions, "colour_mean_error_255": round(float(difference.mean()), 4)}


def validate_card_previews():
    manifest_path = RELIEF / "atlas-preview.json"
    manifest = read_json(manifest_path)
    runtime = read_json(RELIEF / "atlas-runtime.json")
    assert manifest_path.stat().st_size < 5000, "Preview index must not contain detailed geometry"
    assert set(manifest["maps"]) == set(runtime["maps"])
    default_bytes = manifest_path.stat().st_size
    for identifier, metadata in manifest["maps"].items():
        detailed = read_json(RELIEF / metadata["data_file"])
        assert detailed == runtime["maps"][identifier], (identifier, "on-demand geometry differs from the original atlas")
        expected_views = {"overview", "detail", "cultural"} if detailed.get("cultural") else {"overview", "detail"}
        assert set(metadata["views"]) == expected_views
        for view, preview in metadata["views"].items():
            filename = RELIEF / preview["image"]
            with Image.open(filename) as image:
                assert image.size == (preview["width"], preview["height"])
                assert image.width <= 960 and abs(image.height / image.width - detailed["height"] / detailed["width"]) < 0.002
            assert filename.stat().st_size < 150000, (identifier, view, "preview exceeds transfer budget")
        default_bytes += (RELIEF / metadata["views"]["overview"]["image"]).stat().st_size
    assert default_bytes < 250000, "Initial map cards should remain lightweight"
    return {"index_bytes": manifest_path.stat().st_size, "default_cards_and_index_bytes": default_bytes}


def main():
    atlas = read_json(RELIEF / "atlas.json")
    assert set(atlas["maps"]) == {"china", "east_asia", "europe_usa"}
    assert all(metadata.get("overview") for metadata in atlas["maps"].values()), "Package the overview atlas before validation"
    content = read_json(ROOT / "site_content.json")["life"]["footprints"]
    provinces = expected_chinese_visits(content)
    for identifier, metadata in atlas["maps"].items():
        validate_regions(identifier, metadata, content, provinces)
    cultures = validate_cultures(atlas)
    builder = load_builder()
    validate_sectional_colours(atlas, builder)
    cultural = validate_china_cultural(atlas)
    countries = validate_country_colours(atlas, builder)
    validate_visit_updates(atlas, builder, provinces)
    native = {identifier: validate_native(identifier, metadata) for identifier, metadata in atlas["maps"].items()}
    cultural_native = validate_cultural_native(atlas)
    print(json.dumps({"maps": 3, "visited_provinces": len(provinces), "culture_groups": cultures,
                      "country_colours": countries, "cultural": cultural, "native_assets": native,
                      "cultural_native": cultural_native, "card_previews": validate_card_previews()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
