"""Prepare real Terrain Tiles DEMs and Natural Earth geometry for atlas insets."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import math
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = ROOT / "tools" / "relief-atlas" / "footprints"
DEFAULT_ROOT = ARCHIVES / "sectional-20261105" / "detail"
DEFAULT_GEOMETRY = ARCHIVES / "administrative-20261016" / "cache" / "ne_10m_admin_1_states_provinces.geojson.gz"
CONFIGS = {
    "singapore": {
        "title": {"en": "Singapore", "zh-CN": "新加坡", "zh-TW": "新加坡"},
        "bounds": [103.46, 1.10, 104.24, 1.49],
        "latitude": 1.3, "zoom": 12, "exaggeration": 4,
    },
    "hawaii": {
        "title": {"en": "Hawaii", "zh-CN": "夏威夷", "zh-TW": "夏威夷"},
        "bounds": [-161.5, 18.5, -153.0, 22.5],
        "latitude": 20.5, "zoom": 9, "exaggeration": 8,
    },
}


def read_features(path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8") as stream:
        return json.load(stream)["features"]


def is_target(feature, identifier):
    properties = feature["properties"]
    if identifier == "singapore":
        return properties.get("adm0_a3") == "SGP"
    return properties.get("adm0_a3") == "USA" and properties.get("iso_3166_2") == "US-HI"


def geometry_summary(features, identifiers):
    summary = {}
    for identifier in identifiers:
        selected = [feature for feature in features if is_target(feature, identifier)]
        if len(selected) != (5 if identifier == "singapore" else 1):
            raise ValueError(f"Unexpected Natural Earth feature count for {identifier}: {len(selected)}")
        summary[identifier] = {
            "features": [{"id": feature["properties"]["adm1_code"],
                          "name": feature["properties"]["name"],
                          "type": feature["geometry"]["type"]} for feature in selected],
            "requested_bounds": CONFIGS[identifier]["bounds"],
            "dem_prepared": False,
        }
    return summary


def load_dem_helper(cache):
    path = ROOT / "tools" / "relief-atlas" / "reference" / "prepare_data.py"
    specification = importlib.util.spec_from_file_location("footprint_inset_dem", path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    module.CACHE = cache
    return module


def offline_tiles(source, bounds, zoom, cache):
    left, top = source.tile_coordinates(bounds[0], bounds[3], zoom)
    right, bottom = source.tile_coordinates(bounds[2], bounds[1], zoom)
    missing = []
    for tile_y in range(math.floor(top), math.floor(bottom) + 1):
        for tile_x in range(math.floor(left), math.floor(right) + 1):
            path = cache / "terrarium" / str(zoom) / str(tile_x) / f"{tile_y}.png"
            if not path.is_file() or not path.stat().st_size:
                missing.append(str(path))
    if missing:
        raise FileNotFoundError(f"Offline DEM cache is missing {len(missing)} tiles; first: {missing[0]}")


def polygon_parts(geometry):
    if geometry.geom_type == "Polygon":
        yield geometry
    else:
        for part in getattr(geometry, "geoms", []):
            yield from polygon_parts(part)


def prepare_map(identifier, arguments, features, source, style, geometry_hash):
    import numpy as np
    from pyproj import Transformer
    from rasterio.features import rasterize
    from rasterio.transform import from_bounds
    from rasterio.warp import Resampling, reproject
    from shapely import make_valid
    from shapely.geometry import box, shape
    from shapely.ops import transform

    config = CONFIGS[identifier]
    requested_bounds = config["bounds"]
    longitude = (requested_bounds[0] + requested_bounds[2]) / 2
    projection = f"+proj=eqc +lat_ts={config['latitude']} +lat_0=0 +lon_0={longitude} +datum=WGS84 +units=m +no_defs"
    projector = Transformer.from_crs("EPSG:4326", projection, always_xy=True)
    inverse = Transformer.from_crs(projection, "EPSG:4326", always_xy=True)
    west, south = projector.transform(*requested_bounds[:2])
    east, north = projector.transform(*requested_bounds[2:])
    extent_width = max(east - west, (north - south) * arguments.width / arguments.height)
    extent_height = extent_width * arguments.height / arguments.width
    center_x, center_y = (west + east) / 2, (south + north) / 2
    west, east = center_x - extent_width / 2, center_x + extent_width / 2
    south, north = center_y - extent_height / 2, center_y + extent_height / 2
    minimum_lon, minimum_lat = inverse.transform(west, south)
    maximum_lon, maximum_lat = inverse.transform(east, north)
    bounds = [minimum_lon, minimum_lat, maximum_lon, maximum_lat]
    clip = box(*bounds)
    units = []
    land = []
    for feature in features:
        geometry = make_valid(shape(feature["geometry"]))
        if not geometry.intersects(clip):
            continue
        clipped = geometry.intersection(clip)
        if clipped.is_empty or not list(polygon_parts(clipped)):
            continue
        projected = transform(projector.transform, clipped)
        land.append(projected)
        if is_target(feature, identifier):
            properties = feature["properties"]
            units.append({"id": properties["adm1_code"],
                          "name": properties.get("name_en") or properties["name"],
                          "country": properties["adm0_a3"], "unit": "state / planning region",
                          "visited": False, "geometry": projected})
    if not units:
        raise ValueError(f"No target land intersects the {identifier} bounds")
    if arguments.offline:
        offline_tiles(source, bounds, config["zoom"], arguments.cache)
    mosaic, source_transform, tile_count = source.dem_mosaic(bounds, config["zoom"])
    columns = arguments.grid_width
    rows = round(columns * arguments.height / arguments.width)
    target_transform = from_bounds(west, south, east, north, columns, rows)
    elevation = np.zeros((rows, columns), dtype=np.float32)
    reproject(mosaic, elevation, src_transform=source_transform, src_crs="EPSG:3857",
              dst_transform=target_transform, dst_crs=projection,
              resampling=Resampling.bilinear, num_threads=4)
    mask = rasterize([(geometry, 1) for geometry in land], out_shape=elevation.shape,
                     transform=target_transform, fill=0, dtype="uint8").astype(bool)
    regions = rasterize([(item["geometry"], index) for index, item in enumerate(units, start=1)],
                        out_shape=elevation.shape, transform=target_transform, fill=0, dtype="uint8")
    elevation[~mask] = 0
    if not mask.any() or not np.isfinite(elevation).all():
        raise ValueError(f"Invalid real DEM or land mask for {identifier}")
    horizontal = (west + (np.arange(columns) + 0.5) * target_transform.a) / 1000
    vertical = (north + (np.arange(rows) + 0.5) * target_transform.e) / 1000
    extent = [float(horizontal[0]), float(vertical[-1]), float(horizontal[-1]), float(vertical[0])]
    width, height = arguments.width, arguments.height

    def to_pixel(projected_x, projected_y, altitude=None):
        return ((np.asarray(projected_x) / 1000 - extent[0]) * width / (extent[2] - extent[0]),
                (extent[3] - np.asarray(projected_y) / 1000) * height / (extent[3] - extent[1]))

    metadata_regions = []
    for item in units:
        pixels = transform(to_pixel, item["geometry"]).intersection(box(0, 0, width, height))
        polygons = list(polygon_parts(pixels.simplify(0.22, preserve_topology=True)))
        if not polygons:
            continue
        path = "".join("M" + "L".join(f"{pixel_x:.2f},{pixel_y:.2f}" for pixel_x, pixel_y in ring.coords) + "Z"
                       for polygon in polygons for ring in [polygon.exterior, *polygon.interiors])
        center = max(polygons, key=lambda polygon: polygon.area).representative_point()
        metadata_regions.append({**{key: value for key, value in item.items() if key != "geometry"},
                                 "path": path, "center": [round(center.x, 2), round(center.y, 2)]})
    palette = style.get("map_palettes", {}).get("east_asia", style["palette"])
    metadata = {
        "id": identifier, "title": config["title"], "width": width, "height": height,
        "projection": projection, "extent_km": extent, "geographic_bounds": bounds,
        "vertical_exaggeration": config["exaggeration"], "palette": palette,
        "background": style["backgrounds"].get(identifier, style["backgrounds"]["east_asia"]),
        "samples": arguments.samples or style["samples"], "dem_shape": [rows, columns],
        "unvisited_material": style.get("unvisited_material", "#ffffff"), "image": identifier + "-relief.webp",
        "color_image": identifier + "-colour.webp", "continuous_extent": True,
        "region_colors": {str(index): palette[(index - 1) % len(palette)] for index in range(1, len(units) + 1)},
        "regions": metadata_regions,
        "provenance": {
            "dem": "AWS Terrain Tiles / Terrarium", "dem_url": source.TILE_BASE,
            "dem_zoom": config["zoom"], "dem_tiles": tile_count,
            "geometry": str(arguments.geometry.name), "geometry_sha256": geometry_hash,
            "coastline": "Natural Earth 1:10m admin1; generalized coastline with adjacent land context",
            "elevation_m_land": {"min": float(elevation[mask].min()), "max": float(elevation[mask].max())},
            "visited_source": "No visits configured for inset regions",
        },
    }
    destination = arguments.render_root / "data"
    destination.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(destination / f"{identifier}.npz", elevation=elevation, mask=mask,
                        region=regions, x=horizontal, y=vertical)
    (destination / f"{identifier}.json").write_text(
        json.dumps(metadata, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Prepared {identifier}: {columns} x {rows} DEM, {tile_count} real tiles, {len(metadata_regions)} regions", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--map", choices=CONFIGS, nargs="+", default=list(CONFIGS))
    parser.add_argument("--render-root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--geometry", type=Path, default=DEFAULT_GEOMETRY)
    parser.add_argument("--style", type=Path)
    parser.add_argument("--cache", type=Path)
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--height", type=int, default=800)
    parser.add_argument("--grid-width", type=int, default=1400)
    parser.add_argument("--samples", type=int)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--geometry-only", action="store_true")
    arguments = parser.parse_args()
    if min(arguments.width, arguments.height, arguments.grid_width) < 2:
        parser.error("Image and grid dimensions must be at least 2")
    features = read_features(arguments.geometry)
    summary = geometry_summary(features, arguments.map)
    if arguments.geometry_only:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    arguments.cache = arguments.cache or arguments.render_root / "cache"
    style_path = arguments.style or arguments.render_root.parent / "style.json"
    if not style_path.is_file():
        style_path = ROOT / "tools" / "relief-atlas" / "footprints-style.json"
    style = json.loads(style_path.read_text(encoding="utf-8"))
    source = load_dem_helper(arguments.cache)
    geometry_hash = hashlib.sha256(arguments.geometry.read_bytes()).hexdigest()
    for identifier in arguments.map:
        prepare_map(identifier, arguments, features, source, style, geometry_hash)


if __name__ == "__main__":
    main()
