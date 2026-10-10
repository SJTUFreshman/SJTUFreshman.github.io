"""Prepare aligned DEMs, then package Cycles rasters and interactive map geometry."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
from shapely import make_valid
from shapely.geometry import box, LineString, shape
from shapely.ops import transform, unary_union
from shapely.affinity import affine_transform

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / ".render-work" / "footprints"
OUTPUT = ROOT / "assets" / "maps" / "relief"
SOURCE = ROOT / "tools" / "relief-atlas" / "reference"
STYLE = json.loads((SOURCE.parent / "footprints-style.json").read_text(encoding="utf-8"))
CONFIGS = {
    "china": {"title": {"en": "China", "zh-CN": "中国", "zh-TW": "中國"}, "width": STYLE["render_widths"]["china"], "exaggeration": 22},
    "east_asia": {"title": {"en": "East Asia", "zh-CN": "东亚", "zh-TW": "東亞"},
                  "bounds": [103, 18, 147, 47], "latitude": 34, "width": STYLE["render_widths"]["east_asia"], "exaggeration": 16},
    "europe_usa": {"title": {"en": "Europe + USA", "zh-CN": "欧洲与美国", "zh-TW": "歐洲與美國"},
                   "bounds": [-128, 24, 40, 66], "latitude": 45, "width": STYLE["render_widths"]["europe_usa"], "exaggeration": 30},
}


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def load_geography():
    source = load_module(SOURCE / "prepare_data.py", "relief_dem")
    source.CACHE = WORK / "cache"
    routes = load_module(ROOT / "scripts" / "prepare-footprint-routes.py", "footprint_routes")
    provinces, names, colours = routes.load_provinces(routes.DEFAULT_PROVINCE_PATH)
    source.cached_download("https://naturalearth.s3.amazonaws.com/10m_physical/ne_10m_land.zip", WORK / "cache" / "ne_10m_land.zip")
    source.cached_download("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson",
                           WORK / "cache" / "ne_10m_admin_1_states_provinces.geojson")
    return source, provinces, colours


def cities(colours):
    visited = set(read_json(ROOT / "site_content.json")["life"]["footprints"]["visited_china"])
    municipalities = {110000: "北京市", 120000: "天津市", 310000: "上海市", 500000: "重庆市"}
    grouped = {}
    for feature in read_json(ROOT / "assets" / "maps" / "china_city_full.json")["features"]:
        properties = feature["properties"]
        parent = properties.get("parent", {}).get("adcode")
        if properties.get("level") == "city":
            identifier, name = str(properties["adcode"]), properties["name"]
        elif properties.get("level") == "district" and parent in municipalities:
            identifier, name = str(parent), municipalities[parent]
        else:
            continue
        item = grouped.setdefault(identifier, {"id": identifier, "name": name, "province": parent,
                                               "color": colours[parent], "visited": name in visited, "parts": []})
        item["parts"].append(make_valid(shape(feature["geometry"])))
    for item in grouped.values():
        item["geometry"] = unary_union(item.pop("parts"))
    assert visited == {item["name"] for item in grouped.values() if item["visited"]}
    return list(grouped.values())


def regional_units(identifier):
    features = read_json(WORK / "cache" / "ne_10m_admin_1_states_provinces.geojson")["features"]
    grouped = {}
    for feature in features:
        properties = feature["properties"]
        country = properties["adm0_a3"]
        if identifier == "east_asia" and country in {"CHN", "TWN", "HKG", "MAC"}:
            continue
        if identifier == "east_asia" and country not in {"JPN", "KOR", "PRK", "RUS", "MNG", "VNM", "LAO", "PHL"}:
            continue
        if country in {"USA", "CAN", "DEU", "JPN", "KOR"}:
            key = properties["adm1_code"]
            name = properties.get("name_en") or properties["name"]
            unit = "state / province / prefecture"
        elif country in {"FRA", "ITA", "ESP", "GBR"}:
            name = properties.get("region") or properties["name"]
            key = country + ":" + name
            unit = "region"
        else:
            key, name, unit = country, properties["admin"], "country"
        item = grouped.setdefault(key, {"id": key, "name": name, "country": country,
                                        "unit": unit, "visited": False, "parts": []})
        item["parts"].append(make_valid(shape(feature["geometry"])))
    for item in grouped.values():
        item["geometry"] = unary_union(item.pop("parts"))
    return list(grouped.values())


def projected_region(item, metadata):
    projection = Transformer.from_crs("EPSG:4326", metadata["projection"], always_xy=True)
    west, south, east, north = metadata["extent_km"]
    width, height = metadata["width"], metadata["height"]

    def to_pixel(longitude, latitude, altitude=None):
        projected_x, projected_y = projection.transform(longitude, latitude)
        return ((np.asarray(projected_x) / 1000 - west) * width / (east - west),
                (north - np.asarray(projected_y) / 1000) * height / (north - south))

    source_geometry = item["geometry"].intersection(box(*metadata["geographic_bounds"]))
    if source_geometry.is_empty:
        return None
    geometry = make_valid(transform(to_pixel, source_geometry)).intersection(box(0, 0, width, height))
    if geometry.is_empty or geometry.area < 0.02:
        return None
    geometry = geometry.simplify(0.22, preserve_topology=True)
    polygons = [geometry] if geometry.geom_type == "Polygon" else [part for part in geometry.geoms if part.geom_type == "Polygon"]
    if not polygons:
        return None
    commands = []
    for polygon in polygons:
        for ring in [polygon.exterior, *polygon.interiors]:
            commands.append("M" + "L".join(f"{longitude:.2f},{latitude:.2f}" for longitude, latitude in ring.coords) + "Z")
    center = max(polygons, key=lambda polygon: polygon.area).representative_point()
    return {**{key: value for key, value in item.items() if key != "geometry"},
            "path": "".join(commands), "center": [round(center.x, 2), round(center.y, 2)]}


def prepare_map(identifier, config, source, provinces, colours, reuse_dem=False):
    if identifier == "china" or reuse_dem:
        data_root = WORK if reuse_dem else SOURCE
        with np.load(data_root / "data" / (identifier + ".npz")) as data:
            arrays = {key: data[key] for key in data.files}
        projection = read_json(data_root / "data" / (identifier + ".json"))["projection"]
        extent = [float(arrays["x"][0]), float(arrays["y"][-1]), float(arrays["x"][-1]), float(arrays["y"][0])]
        shape_rows, shape_columns = arrays["elevation"].shape
        spacing_x = float(arrays["x"][1] - arrays["x"][0]) * 1000
        spacing_y = float(arrays["y"][0] - arrays["y"][1]) * 1000
        target_transform = from_bounds(extent[0]*1000-spacing_x/2, extent[1]*1000-spacing_y/2,
                                       extent[2]*1000+spacing_x/2, extent[3]*1000+spacing_y/2, shape_columns, shape_rows)
    else:
        bounds = config["bounds"]
        projection = f"+proj=eqc +lat_ts={config['latitude']} +lat_0=0 +lon_0={(bounds[0]+bounds[2])/2} +datum=WGS84 +units=m +no_defs"
        transformer = Transformer.from_crs("EPSG:4326", projection, always_xy=True)
        min_x, min_y = transformer.transform(bounds[0], bounds[1])
        max_x, max_y = transformer.transform(bounds[2], bounds[3])
        shape_columns = 2400 if identifier == "east_asia" else 3000
        shape_rows = round(shape_columns * (max_y-min_y) / (max_x-min_x))
        target_transform = from_bounds(min_x, min_y, max_x, max_y, shape_columns, shape_rows)
        mosaic, mosaic_transform, tile_count = source.dem_mosaic(bounds, 7 if identifier == "east_asia" else 6)
        elevation = np.zeros((shape_rows, shape_columns), dtype=np.float32)
        reproject(mosaic, elevation, src_transform=mosaic_transform, src_crs="EPSG:3857",
                  dst_transform=target_transform, dst_crs=projection, resampling=Resampling.bilinear, num_threads=4)
        land = gpd.read_file("zip://" + str((WORK / "cache" / "ne_10m_land.zip").resolve()))
        clip = box(*bounds)
        land_shapes = [transform(transformer.transform, make_valid(geometry).intersection(clip)) for geometry in land.geometry if geometry.intersects(clip)]
        mask = rasterize([(geometry, 1) for geometry in land_shapes if not geometry.is_empty],
                         out_shape=elevation.shape, transform=target_transform, fill=0, dtype="uint8").astype(bool)
        arrays = {"elevation": elevation, "mask": mask,
                  "x": (min_x + (np.arange(shape_columns) + 0.5) * target_transform.a) / 1000,
                  "y": (max_y + (np.arange(shape_rows) + 0.5) * target_transform.e) / 1000}
        extent = [float(arrays["x"][0]), float(arrays["y"][-1]), float(arrays["x"][-1]), float(arrays["y"][0])]
    palette = list(dict.fromkeys(colours.values()))
    transformer = Transformer.from_crs("EPSG:4326", projection, always_xy=True)
    province_shapes = [(transform(transformer.transform, item["geometry"]), palette.index(colours[item["adcode"]])+1) for item in provinces]
    arrays["region"] = rasterize(province_shapes, out_shape=arrays["elevation"].shape,
                                  transform=target_transform, fill=0, dtype="uint8") if identifier != "europe_usa" else np.zeros_like(arrays["mask"], dtype="uint8")
    height = round(config["width"] * (extent[3]-extent[1]) / (extent[2]-extent[0]))
    metadata = {"id": identifier, "title": config["title"], "width": config["width"], "height": height,
                "projection": projection, "extent_km": extent, "geographic_bounds": config.get("bounds", [73,18,135.2,53.7]),
                "vertical_exaggeration": config["exaggeration"], "palette": palette, "background": STYLE["backgrounds"][identifier],
                "samples": STYLE["samples"], "dem_shape": list(arrays["elevation"].shape),
                "unvisited_material": "#ffffff", "image": identifier + "-relief.webp",
                "color_image": identifier + ("-colour.webp" if identifier != "europe_usa" else "-relief.webp"),
                "continuous_extent": True}
    metadata["region_colors"] = {str(index): colour for index, colour in enumerate(palette, start=1)}
    units = cities(colours) if identifier in {"china", "east_asia"} else []
    if identifier != "china":
        units += regional_units(identifier)
    metadata["regions"] = [result for item in units if (result := projected_region(item, metadata))]
    np.savez_compressed(WORK / "data" / (identifier + ".npz"), **arrays)
    write_json(WORK / "data" / (identifier + ".json"), metadata)
    print(f"Prepared {identifier}: {arrays['elevation'].shape}, {len(metadata['regions'])} regions", flush=True)


def polygon_path(geometry):
    polygons = [geometry] if geometry.geom_type == "Polygon" else [part for part in getattr(geometry, "geoms", []) if part.geom_type == "Polygon"]
    return "".join("M" + "L".join(f"{horizontal:.2f},{vertical:.2f}" for horizontal, vertical in ring.coords) + "Z"
                   for polygon in polygons for ring in [polygon.exterior, *polygon.interiors])


def route_data(metadata, journeys, provinces):
    projection = Transformer.from_crs("EPSG:4326", metadata["projection"], always_xy=True)
    west, south, east, north = metadata["extent_km"]
    width, height = metadata["width"], metadata["height"]
    land = unary_union([transform(projection.transform, province["geometry"]) for province in provinces])
    pixel_transform = [width / ((east-west)*1000), 0, 0, -height / ((north-south)*1000),
                       -west*width/(east-west), north*height/(north-south)]
    output = []
    for journey in journeys:
        if journey.get("geometry_status") != "network_routed":
            raise ValueError("Refusing city-to-city schematic route: " + journey["id"])
        segments = []
        for segment in journey["segments"]:
            coordinates = np.asarray(segment["points"])
            projected_x, projected_y = projection.transform(coordinates[:, 0], coordinates[:, 1])
            pixels = np.column_stack(((projected_x/1000-west)*width/(east-west), (north-projected_y/1000)*height/(north-south)))
            clipped = LineString(pixels).intersection(box(0, 0, width, height))
            parts = [clipped] if clipped.geom_type == "LineString" else list(getattr(clipped, "geoms", []))
            for part in parts:
                if part.is_empty or part.geom_type != "LineString":
                    continue
                simplified = part.simplify(0.10)
                segments.append({"province": segment["province"], "adcode": segment["adcode"], "color": segment["color"],
                                 "points": [[round(horizontal, 2), round(vertical, 2)] for horizontal, vertical in simplified.coords]})
        if segments:
            corridor_width = STYLE["corridor_width_km"][journey["kind"]]
            route_line = transform(projection.transform, shape(journey["geometry"]))
            corridor = route_line.buffer(corridor_width*500, quad_segs=6).intersection(land)
            corridor = affine_transform(corridor, pixel_transform).intersection(box(0, 0, width, height))
            corridor = corridor.simplify(0.35, preserve_topology=True)
            output.append({"id": journey["id"], "name": journey["name"], "kind": journey["kind"],
                           "geometry_status": journey["geometry_status"], "segments": segments,
                           "corridor_width_km": corridor_width, "corridor_path": polygon_path(corridor)})
    return output


def package(identifiers):
    journeys = read_json(ROOT / "assets" / "maps" / "footprint-journeys.json")["routes"]
    routes = load_module(ROOT / "scripts" / "prepare-footprint-routes.py", "footprint_routes")
    provinces, _, _ = routes.load_provinces(routes.DEFAULT_PROVINCE_PATH)
    maps = read_json(OUTPUT / "atlas.json")["maps"] if (OUTPUT / "atlas.json").exists() else {}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for identifier in identifiers:
        metadata = read_json(WORK / "data" / (identifier + ".json"))
        metadata["region_colors"] = {str(index): colour for index, colour in enumerate(metadata["palette"], start=1)}
        render_report = read_json(WORK / "renders" / (identifier + "-render.json"))
        for variant in ("relief", "colour") if identifier != "europe_usa" else ("relief",):
            with Image.open(WORK / "renders" / f"{identifier}-{variant}.png") as image:
                assert image.size == (metadata["width"], metadata["height"])
                if variant == "relief":
                    samples = image.convert("RGB").resize((160, 160), Image.Resampling.NEAREST)
                    background = max(samples.getcolors(25600), key=lambda item: item[0])[1]
                    metadata["display_background"] = "#" + "".join(f"{channel:02x}" for channel in background)
                image.convert("RGB").save(OUTPUT / f"{identifier}-{variant}.webp", quality=95, method=6)
        metadata.update(render_report)
        metadata["route_display"] = "coloured_terrain_corridor"
        metadata["routes"] = route_data(metadata, journeys, provinces) if identifier != "europe_usa" else []
        maps[identifier] = metadata
    write_json(OUTPUT / "atlas.json", {"version": 3, "maps": maps})
    print(json.dumps({identifier: {"visited": sum(region["visited"] for region in data["regions"]),
                                   "routes": len(data["routes"])} for identifier, data in maps.items()}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--package", action="store_true")
    parser.add_argument("--reuse-dem", action="store_true", help="Reuse prepared grids when only resolution, colours or visits change")
    parser.add_argument("--maps", nargs="+", choices=CONFIGS, default=list(CONFIGS))
    arguments = parser.parse_args()
    if arguments.prepare:
        (WORK / "data").mkdir(parents=True, exist_ok=True)
        source, provinces, colours = load_geography()
        for identifier in arguments.maps:
            prepare_map(identifier, CONFIGS[identifier], source, provinces, colours, arguments.reuse_dem)
    if arguments.package:
        package(arguments.maps)
    if not arguments.prepare and not arguments.package:
        parser.error("Choose --prepare before rendering, or --package after rendering")


if __name__ == "__main__":
    main()
