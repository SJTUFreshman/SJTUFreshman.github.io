"""Build province/cultural-region/country overviews without replacing detailed atlas data.

--prepare changes only the new render archive; render its east_asia/europe_usa
colour variants in Blender, then --package attaches overview layers to atlas.json.
Daily visit changes only require --package; the original builder calls package()
with encode_images=False after rebuilding detailed city/route geometry.
"""
from __future__ import annotations

import argparse
import colorsys
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from shapely import make_valid
from shapely.geometry import box, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "tools/relief-atlas/footprints/administrative-20261016"
STYLE_PATH = ROOT / "tools/relief-atlas/footprints-style.json"
CONFIG_PATH = ROOT / "tools/relief-atlas/cultural-regions.json"
OUTPUT = ROOT / "assets/maps/relief"
MAPS = ("china", "east_asia", "europe_usa")
NATURAL_EARTH_NAME = "ne_10m_admin_1_states_provinces.geojson"


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def load_builder():
    spec = importlib.util.spec_from_file_location("footprint_atlas", ROOT / "scripts/build-footprint-atlas.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def stable_colour(identifier):
    """A stable muted pigment per ID; adding/reordering countries does not recolour old ones."""
    digest = hashlib.sha256(identifier.encode("ascii")).digest()
    hue = int.from_bytes(digest[:4], "big") / 2**32
    lightness = 0.64 + digest[4] / 255 * 0.10
    saturation = 0.22 + digest[5] / 255 * 0.17
    channels = colorsys.hls_to_rgb(hue, lightness, saturation)
    return "#" + "".join(f"{round(channel * 255):02x}" for channel in channels)


def geography(render_root):
    """Keep the original geometry compressed in the new archive for offline rebuilds."""
    archived = render_root / "cache" / (NATURAL_EARTH_NAME + ".gz")
    if archived.exists():
        return json.loads(gzip.decompress(archived.read_bytes()))["features"]
    source = ROOT / ".render-work/footprints/cache" / NATURAL_EARTH_NAME
    if not source.exists():
        raise FileNotFoundError(f"Missing Natural Earth source: {source}; restore the archived .geojson.gz first")
    raw = source.read_bytes()
    archived.parent.mkdir(parents=True, exist_ok=True)
    archived.write_bytes(gzip.compress(raw, mtime=0))
    return json.loads(raw)["features"]


def visit_sets(builder, colours):
    footprints = read_json(ROOT / "site_content.json")["life"]["footprints"]
    # Only recorded visits count. Passing through a province on rail/road does not light it.
    provinces = {city["province"] for city in builder.cities(colours) if city["visited"]}
    regions = set(footprints.get("visited_overseas_regions", []))
    countries = set(footprints.get("visited_country_codes", []))
    return provinces, regions, countries


def province_units(provinces, colours):
    return [{"id": str(province["adcode"]), "name": province["name"], "country": "CHN",
             "province": province["adcode"], "unit": "province", "color": colours[province["adcode"]],
             "geometry": province["geometry"]} for province in provinces]


def country_units(features, allowed=None):
    grouped = {}
    for feature in features:
        properties = feature["properties"]
        country = properties["adm0_a3"]
        if allowed is not None and country not in allowed:
            continue
        item = grouped.setdefault(country, {"id": country, "name": properties["admin"],
                                            "country": country, "unit": "country",
                                            "color": stable_colour(country), "members": [], "parts": []})
        item["members"].append(properties["adm1_code"])
        item["parts"].append(make_valid(shape(feature["geometry"])))
    for item in grouped.values():
        item["members"] = sorted(set(item["members"]))
        item["geometry"] = unary_union(item.pop("parts"))
    return sorted(grouped.values(), key=lambda item: item["id"])


def cultural_units(features):
    config = read_json(CONFIG_PATH)
    result = []
    for country in ("JPN", "KOR"):
        features_by_code = {feature["properties"]["iso_3166_2"]: feature for feature in features
                            if feature["properties"]["adm0_a3"] == country}
        members = [member for group in config[country] for member in group["members"]]
        if len(members) != len(set(members)) or set(members) != set(features_by_code):
            raise ValueError(f"{country}: cultural groups must cover each source prefecture/province exactly once")
        for group in config[country]:
            result.append({**group, "name": group["label"]["en"], "country": country, "unit": "cultural-region",
                           "color": stable_colour(group["id"]),
                           "geometry": unary_union([make_valid(shape(features_by_code[member]["geometry"]))
                                                    for member in group["members"]])})
    return result


def update_visited(regions, visits):
    provinces, overseas_regions, countries = visits
    for region in regions:
        if region["unit"] == "province":
            region["visited"] = region["province"] in provinces
        elif region["unit"] == "cultural-region":
            region["visited"] = region["id"] in overseas_regions
        else:
            region["visited"] = region["country"] in countries


def validate_visits(render_root, visits):
    # Typos should fail explicitly, rather than silently showing a white map.
    _, overseas_regions, countries = visits
    known_regions, known_countries = set(), set()
    for identifier in MAPS:
        path = render_root / "data" / (identifier + ".json")
        if path.exists():
            for region in read_json(path)["regions"]:
                known_countries.add(region["country"])
                if region["unit"] == "cultural-region":
                    known_regions.add(region["id"])
    if overseas_regions - known_regions:
        raise ValueError("Unknown visited cultural-region IDs: " + ", ".join(sorted(overseas_regions - known_regions)))
    if countries - known_countries:
        raise ValueError("Unknown visited country codes in these maps: " + ", ".join(sorted(countries - known_countries)))
    if {"CHN", "JPN", "KOR"} & countries:
        raise ValueError("China/Japan/Korea use province or cultural-region visits; do not light them using country codes")


def prepare(identifiers=None, render_root=ARCHIVE):
    identifiers = identifiers or MAPS
    builder = load_builder()
    routes = builder.load_module(ROOT / "scripts/prepare-footprint-routes.py", "footprint_routes")
    provinces, _, colours = routes.load_provinces(routes.DEFAULT_PROVINCE_PATH)
    visits = visit_sets(builder, colours)
    features = geography(render_root)
    source_root = ROOT / read_json(STYLE_PATH)["render_archive"]
    cultures = cultural_units(features)
    for identifier in identifiers:
        metadata = read_json(source_root / "data" / (identifier + ".json"))
        if identifier == "china":
            units = province_units(provinces, colours)
        elif identifier == "east_asia":
            units = province_units(provinces, colours) + cultures + country_units(features, {"PRK", "RUS", "MNG", "VNM", "LAO", "PHL"})
        else:
            units = country_units(features)
        # The exact orthographic projection/extent comes from the archived detail render.
        # Use its half-pixel outer bounds so the new material mask follows the same DEM grid.
        bounds = box(*metadata["geographic_bounds"])
        units = [unit for unit in units if unit["geometry"].intersects(bounds)]
        metadata["regions"] = [projected for unit in units if (projected := builder.projected_region(unit, metadata))]
        update_visited(metadata["regions"], visits)
        metadata["overview_unit"] = {"china": "province", "east_asia": "cultural-region", "europe_usa": "country"}[identifier]
        metadata["color_image"] = "china-colour.webp" if identifier == "china" else identifier + "-overview-colour.webp"
        metadata["source_archive"] = render_root.resolve().relative_to(ROOT).as_posix()
        metadata["relief_source_archive"] = source_root.resolve().relative_to(ROOT).as_posix()
        metadata["background"] = read_json(STYLE_PATH)["backgrounds"][identifier]
        metadata["visit_source"] = "visited_china -> province; visited_overseas_regions -> cultural-region; visited_country_codes -> country"
        # China reuses its already rendered provincial pigments. No new China raster/scene is needed.
        if identifier != "china":
            with np.load(source_root / "data" / (identifier + ".npz")) as source:
                arrays = {key: source[key] for key in source.files}
            projection = Transformer.from_crs("EPSG:4326", metadata["projection"], always_xy=True)
            step_x = float(arrays["x"][1] - arrays["x"][0]) * 1000
            step_y = float(arrays["y"][0] - arrays["y"][1]) * 1000
            target_transform = from_bounds(float(arrays["x"][0]) * 1000 - step_x / 2,
                                           float(arrays["y"][-1]) * 1000 - step_y / 2,
                                           float(arrays["x"][-1]) * 1000 + step_x / 2,
                                           float(arrays["y"][0]) * 1000 + step_y / 2,
                                           len(arrays["x"]), len(arrays["y"]))
            visible_ids = {region["id"] for region in metadata["regions"]}
            visible_units = sorted((unit for unit in units if unit["id"] in visible_ids), key=lambda unit: unit["id"])
            raster_ids = {unit["id"]: index for index, unit in enumerate(visible_units, 1)}
            shapes = [(transform(projection.transform, unit["geometry"].intersection(bounds)), raster_ids[unit["id"]])
                      for unit in visible_units]
            arrays["region"] = rasterize(shapes, out_shape=arrays["elevation"].shape,
                                          transform=target_transform, fill=0, dtype="uint16")
            metadata["region_colors"] = {str(raster_ids[unit["id"]]): unit["color"] for unit in visible_units}
            metadata["palette"] = list(dict.fromkeys(metadata["region_colors"].values()))
            for region in metadata["regions"]:
                region["raster_id"] = raster_ids[region["id"]]
            (render_root / "data").mkdir(parents=True, exist_ok=True)
            np.savez_compressed(render_root / "data" / (identifier + ".npz"), **arrays)
        write_json(render_root / "data" / (identifier + ".json"), metadata)
        print(f"Prepared overview {identifier}: {len(metadata['regions'])} units, {sum(region['visited'] for region in metadata['regions'])} visited", flush=True)
    validate_visits(render_root, visits)


def package(identifiers=None, render_root=ARCHIVE, encode_images=True):
    identifiers = identifiers or MAPS
    builder = load_builder()
    routes = builder.load_module(ROOT / "scripts/prepare-footprint-routes.py", "footprint_routes")
    _, _, colours = routes.load_provinces(routes.DEFAULT_PROVINCE_PATH)
    visits = visit_sets(builder, colours)
    validate_visits(render_root, visits)
    atlas = read_json(OUTPUT / "atlas.json")
    for identifier in identifiers:
        metadata = read_json(render_root / "data" / (identifier + ".json"))
        regions = metadata["regions"]
        update_visited(regions, visits)
        overview = {"unit": metadata["overview_unit"], "regions": regions,
                    "color_image": metadata["color_image"], "source_archive": metadata["source_archive"],
                    "relief_source_archive": metadata["relief_source_archive"], "visit_source": metadata["visit_source"],
                    "routes": [], "width": metadata["width"], "height": metadata["height"],
                    "projection": metadata["projection"], "extent_km": metadata["extent_km"]}
        if identifier == "china":
            overview["color_source_archive"] = metadata["relief_source_archive"]
            overview["outputs"] = read_json(ROOT / metadata["relief_source_archive"] / "renders/china-render.json")["outputs"]
        else:
            render_report = read_json(render_root / "renders" / (identifier + "-render.json"))
            overview["outputs"] = render_report["outputs"]
            overview["color_source_archive"] = metadata["source_archive"]
            overview["postprocessing"] = render_report["postprocessing"]
            overview["sea_material"] = render_report["sea_material"]
            native = render_root / "renders" / (identifier + "-colour.png")
            if hashlib.sha256(native.read_bytes()).hexdigest() != render_report["outputs"][native.name]:
                raise ValueError(f"Native render hash mismatch: {native}")
            if encode_images:
                with Image.open(native) as image:
                    if image.size != (metadata["width"], metadata["height"]):
                        raise ValueError(f"Native render size mismatch: {native}")
                    # Encoding only: all pigments, light, shadows and sea are native Blender output.
                    image.convert("RGB").save(OUTPUT / metadata["color_image"], quality=95, method=6)
            if not (OUTPUT / metadata["color_image"]).exists():
                raise FileNotFoundError("Package overview images first: " + metadata["color_image"])
        atlas["maps"][identifier]["overview"] = overview
    write_json(OUTPUT / "atlas.json", atlas)
    print("Packaged overview layers: " + ", ".join(identifiers), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--package", action="store_true")
    parser.add_argument("--maps", nargs="+", choices=MAPS, default=list(MAPS))
    parser.add_argument("--render-root", type=Path, default=ARCHIVE)
    arguments = parser.parse_args()
    if arguments.prepare:
        prepare(arguments.maps, arguments.render_root)
    if arguments.package:
        package(arguments.maps, arguments.render_root)
    if not arguments.prepare and not arguments.package:
        parser.error("Choose --prepare before Blender or --package after rendering")


if __name__ == "__main__":
    main()
