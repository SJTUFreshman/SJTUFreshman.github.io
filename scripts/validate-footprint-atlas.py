"""Check relief projection, visited cities, network routing, and reference colours."""

import importlib.util
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, GeometryCollection
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def clip_geometry(path):
    result = GeometryCollection()
    for ring in path.replace('Z', '').split('M'):
        if ring:
            polygon = Polygon([tuple(map(float, point.split(','))) for point in ring.split('L')])
            result = result.symmetric_difference(polygon)
    return result


def main():
    atlas = read_json(ROOT / "assets/maps/relief/atlas.json")
    assert atlas["version"] == 3
    content = read_json(ROOT / "site_content.json")
    journeys = read_json(ROOT / "assets/maps/footprint-journeys.json")
    spec = importlib.util.spec_from_file_location("footprint_routes", ROOT / "scripts/prepare-footprint-routes.py")
    routes_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(routes_module)
    provinces, names, colours = routes_module.load_provinces(ROOT / "assets/maps/china_100000_full.json")
    province_lookup = {item["adcode"]: item["geometry"] for item in provinces}
    assert set(atlas["maps"]) == {"china", "east_asia", "europe_usa"}
    expected_visited = set(content["life"]["footprints"]["visited_china"])
    actual_visited = {region["name"] for region in atlas["maps"]["china"]["regions"] if region["visited"]}
    assert actual_visited == expected_visited
    assert {"成都市", "兰州市", "重庆市"} <= actual_visited
    lighting = None
    for identifier, metadata in atlas["maps"].items():
        assert metadata["continuous_extent"] and not metadata.get("panels")
        assert metadata["unvisited_material"] == "#ffffff"
        assert metadata["administrative_outlines"] is False
        assert metadata["route_display"] == "coloured_terrain_corridor"
        assert metadata["width"] >= 6000
        assert metadata["native_render_size"] == [metadata["width"], metadata["height"]]
        assert metadata["samples"] >= 192
        if identifier in {"china", "east_asia"}:
            assert metadata["region_colors"] == {str(index): colour for index, colour in enumerate(metadata["palette"], start=1)}
        assert metadata["lighting"]["sun_elevation_degrees"] == 32
        assert abs(metadata["lighting"]["sun_azimuth_degrees_clockwise_from_north"] - 321.8427734) < 0.0001
        if lighting is not None:
            assert lighting == metadata["lighting"]
        lighting = metadata["lighting"]
        image_arrays = {}
        for image_name in {metadata["image"], metadata["color_image"]}:
            with Image.open(ROOT / "assets/maps/relief" / image_name) as image:
                assert image.size == (metadata["width"], metadata["height"])
                assert float(np.asarray(image).std()) > 8
                image_arrays[image_name] = np.asarray(image.convert("RGB"), dtype=np.int16)
        if identifier in {"china", "east_asia"}:
            relief = image_arrays[metadata["image"]]
            colour = image_arrays[metadata["color_image"]]
            assert np.any(np.abs(relief - colour) > 5, axis=2).mean() > 0.01
        for region in metadata["regions"]:
            center_x, center_y = region["center"]
            assert 0 <= center_x <= metadata["width"] and 0 <= center_y <= metadata["height"]
            if region["visited"]:
                assert region["name"] in expected_visited
                assert region["color"] == colours[region["province"]]
        for route in metadata["routes"]:
            assert route["geometry_status"] == "network_routed"
            assert 20 <= route["corridor_width_km"] <= 32
            corridor = clip_geometry(route["corridor_path"])
            assert corridor.is_valid and 0 < corridor.area < metadata["width"]*metadata["height"]*0.025
            centerlines = unary_union([LineString(segment["points"]) for segment in route["segments"]])
            coverage = centerlines.intersection(corridor.buffer(1)).length / centerlines.length
            assert coverage > 0.97, (identifier, route["id"], coverage)
            for segment in route["segments"]:
                assert segment["color"] == colours[segment["adcode"]]
                assert all(-0.01 <= horizontal <= metadata["width"] + 0.01 and -0.01 <= vertical <= metadata["height"] + 0.01
                           for horizontal, vertical in segment["points"])
    china = atlas["maps"]["china"]
    raster_path = ROOT / ".render-work/footprints/data/china.npz"
    if raster_path.exists():
        with np.load(raster_path) as raster:
            assert set(np.unique(raster["region"])) <= {0, *map(int, china["region_colors"])}
            projection = Transformer.from_crs("EPSG:4326", china["projection"], always_xy=True)
            for name, coordinate in {"成都市": (104.0665, 30.5723), "兰州市": (103.856, 36.034), "重庆市": (106.55, 29.56)}.items():
                horizontal, vertical = projection.transform(*coordinate)
                column = np.argmin(abs(raster["x"] - horizontal/1000))
                row = np.argmin(abs(raster["y"] - vertical/1000))
                pigment = china["region_colors"][str(int(raster["region"][row, column]))]
                region = next(region for region in china["regions"] if region["name"] == name)
                assert pigment == region["color"], name + " raster pigment differs from the reference"
    for name, coordinate in {"成都市": (104.0665, 30.5723), "北京市": (116.4053, 39.9050), "上海市": (121.4737, 31.2304)}.items():
        transformer = Transformer.from_crs("EPSG:4326", china["projection"], always_xy=True)
        projected_x, projected_y = transformer.transform(*coordinate)
        west, south, east, north = china["extent_km"]
        pixel = Point((projected_x/1000-west)*china["width"]/(east-west), (north-projected_y/1000)*china["height"]/(north-south))
        region = next(region for region in china["regions"] if region["name"] == name)
        polygons = [Polygon([tuple(map(float, point.split(','))) for point in ring.split('L')]) for ring in region["path"].replace('Z', '').split('M') if ring]
        assert unary_union(polygons).buffer(1).covers(pixel), name + " is misaligned with the DEM projection"
    europe = atlas["maps"]["europe_usa"]
    assert europe["geographic_bounds"] == [-128, 24, 40, 66]
    assert not any(region["visited"] for region in europe["regions"])
    assert len([region for region in europe["regions"] if region.get("country") == "CHE"]) == 1
    assert len([region for region in europe["regions"] if region.get("country") == "FRA"]) >= 10
    assert len([region for region in europe["regions"] if region.get("country") == "USA"]) >= 48
    assert len(journeys["routes"]) == 12
    rail_count = 0
    road_count = 0
    coverage = {}
    for route in journeys["routes"]:
        assert route["geometry_status"] == "network_routed" and not route.get("schematic")
        coordinates = route["geometry"]["coordinates"]
        assert len(coordinates) > 100
        routes_module.validate_network_geometry(route["id"], route["geometry"], 35000 if route["kind"] == "rail" else 20000)
        if route["kind"] == "rail":
            rail_count += 1
            assert route["source"]["verified_way_tags"] == "railway=rail for every routed edge"
        else:
            road_count += 1
            assert route["source"]["geometry_detail"] == "overview=full"
        source_line = LineString(coordinates)
        rendered = []
        for segment in route["segments"]:
            assert segment["color"] == colours[segment["adcode"]]
            line = LineString(segment["points"])
            assert province_lookup[segment["adcode"]].buffer(0.000002).covers(line.interpolate(0.5, normalized=True))
            rendered.append(line)
        missing = source_line.difference(unary_union(rendered).buffer(0.000002)).length / source_line.length
        assert missing < 0.01, (route["id"], missing)
        coverage[route["id"]] = round((1-missing)*100, 3)
    assert rail_count == road_count == 6
    for identifier in ("shengsi", "china", "hainan", "fujian_taiwan"):
        reference = ROOT / "tools/relief-atlas/reference"
        assert (reference / "scenes" / (identifier + ".blend")).stat().st_size > 1000000
        assert (reference / "data" / (identifier + ".npz")).is_file()
    archive = ROOT / "tools/relief-atlas/footprints"
    render_reports = read_json(archive.parent / "footprints-render-report.json")
    for identifier, metadata in atlas["maps"].items():
        source = read_json(archive / "data" / (identifier + ".json"))
        assert (source["width"], source["height"], source["palette"]) == (metadata["width"], metadata["height"], metadata["palette"])
        with np.load(archive / "data" / (identifier + ".npz")) as grid:
            assert list(grid["elevation"].shape) == metadata["dem_shape"]
        scene_report = read_json(archive / "scenes" / (identifier + "-scenes.json"))
        assert set(scene_report) == ({"relief"} if identifier == "europe_usa" else {"relief", "colour"})
        for variant, report in scene_report.items():
            scene_file = archive / "scenes" / f"{identifier}-{variant}.blend"
            assert report["reopened"] and report["pigments_verified"] and report["lighting_verified"]
            assert report["resolution"] == [metadata["width"], metadata["height"]]
            assert report["sha256"] == hashlib.sha256(scene_file.read_bytes()).hexdigest()
            assert 1000000 < scene_file.stat().st_size == report["bytes"] < 100*1024*1024
        for filename, checksum in render_reports[identifier]["outputs"].items():
            with (archive / "renders" / filename).open("rb") as source_file:
                assert hashlib.file_digest(source_file, "sha256").hexdigest() == checksum
    for script in ("build-footprint-atlas.py", "prepare-footprint-routes.py", "render-footprint-atlas.py"):
        assert 'ROOT.parent / "relief-atlas-20261008"' not in (ROOT / "scripts" / script).read_text(encoding="utf-8")
    print(json.dumps({"maps": 3, "visited_china": len(actual_visited), "rail_routes": rail_count,
                      "road_routes": road_count, "network_coverage_percent": coverage}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
