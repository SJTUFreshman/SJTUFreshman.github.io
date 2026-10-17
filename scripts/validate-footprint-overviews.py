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
    assert len(set(palette.values())) == len(palette), "Every displayed country needs its own pigment"
    # Evaluate reversed order plus an added country ID: existing colours must be
    # determined by identity, never by a country's position in a palette list.
    reordered = {identifier: builder.stable_colour(identifier) for identifier in ["ZZZ", *reversed(palette)]}
    assert all(colour == reordered[identifier] for identifier, colour in palette.items())
    return len(palette)


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
    neutral_land = (np.ptp(native_relief, axis=2) <= 2) & (native_relief.mean(axis=2) > 40)
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
    assert relief_report["white_material_verified"] and metadata["unvisited_material"] == "#ffffff"
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
    countries = validate_country_colours(atlas, builder)
    validate_visit_updates(atlas, builder, provinces)
    native = {identifier: validate_native(identifier, metadata) for identifier, metadata in atlas["maps"].items()}
    print(json.dumps({"maps": 3, "visited_provinces": len(provinces), "culture_groups": cultures,
                      "distinct_country_pigments": countries, "native_assets": native}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
