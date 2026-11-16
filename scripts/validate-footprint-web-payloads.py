"""Check published display geometry against the original, archived atlas.

Requires Shapely. Checks every retained ring (including small islands), all
visit flags, restricted-area hit targets, transfer budgets and WebP chunks.
"""

import json
from pathlib import Path
import re
import struct
import zlib

from shapely.geometry import LineString, Polygon
from footprint_web_geometry import compact_path

ROOT = Path(__file__).resolve().parents[1]
RELIEF = ROOT / "assets/maps/relief"


def read(name):
    return json.loads((RELIEF / name).read_text(encoding="utf-8"))


def path_rings(path):
    result = []
    for text in re.findall(r"M([^M]+)", path):
        numbers = list(map(float, re.findall(r"[-+]?(?:\d*\.)?\d+", text)))
        if len(numbers) >= 6:
            points = list(zip(numbers[::2], numbers[1::2]))
            if points[0] != points[-1]:
                points.append(points[0])
            result.append(LineString(points))
    return result


def compare_paths(original, compact, bound):
    before, after = path_rings(original), path_rings(compact)
    assert len(before) == len(after), "An island or hole was lost"
    worst = 0
    for source, target in zip(before, after):
        if Polygon(source).is_valid:
            assert Polygon(target).is_valid, "Quantisation introduced a self-intersecting ring"
        error = source.hausdorff_distance(target)
        assert error <= bound, (error, bound)
        worst = max(worst, error)
    return worst


def check_webp(path):
    data = path.read_bytes()
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    chunks, offset = [], 12
    while offset < len(data):
        tag, size = struct.unpack_from("<4sI", data, offset)
        chunks.append(tag.decode("ascii"))
        offset += 8 + size + (size % 2)
    assert offset == len(data), path
    assert not {"EXIF", "XMP ", "ICCP"}.intersection(chunks), (path, chunks)
    return chunks


def main():
    # Sub-pixel islands may need all source digits after quantisation fails.
    # Exercise both the final fallback and fixed-point SVG serialization.
    for path in (
        "M1000,0L1000.004,0L1000.004,0.1L1000,0.1Z",
        "M0.000001,0L0.000002,0L0.000002,0.000001L0.000001,0.000001Z",
    ):
        compact = compact_path(path, 4.8, 0)
        assert not re.search(r"[eE][-+]?\d", compact), compact
        assert compare_paths(path, compact, 0) == 0
    source = read("atlas.json")
    runtime = read("atlas-runtime.json")
    index = read("atlas-preview.json")
    report = {}
    for key, metadata in runtime["maps"].items():
        assert read(index["maps"][key]["data_file"]) == metadata
        hits = read(index["maps"][key]["hit_file"])
        full = source["maps"][key]
        maximum_runtime_error = maximum_hit_error = 0
        for view in hits["views"]:
            original = full if view == "detail" else full[view]
            published = metadata if view == "detail" else metadata[view]
            originals = {region["id"]: region for region in original["regions"]}
            expected_ids = {region["id"] for region in original["regions"]
                            if view != "detail" or region.get("visited")}
            assert {region["id"] for region in published["regions"]} == expected_ids
            for region in published["regions"]:
                old = originals[region["id"]]
                assert region.get("visited") == old.get("visited")
                for name in ("path", "boundary_path"):
                    if region.get(name):
                        maximum_runtime_error = max(maximum_runtime_error,
                            compare_paths(old[name], region[name], 0.43))
                if old.get("boundary_path") and old.get("unit") == "cultural-region":
                    assert "path" not in region, "Duplicate cultural geometry"
            if key == "east_asia" and view == "detail":
                originals["PRK"] = next(region for region in full["overview"]["regions"] if region["id"] == "PRK")
                expected_ids.add("PRK")
            assert {region["id"] for region in hits["views"][view]} == expected_ids
            for region in hits["views"][view]:
                old = originals[region["id"]]
                assert region.get("visited") == old.get("visited")
                maximum_hit_error = max(maximum_hit_error,
                    compare_paths(old.get("boundary_path") or old["path"], region["path"], 5.95))
                if region["id"] == "PRK":
                    assert region["restricted"] == "closed"
        for before, after in zip(full["routes"], metadata["routes"]):
            maximum_runtime_error = max(maximum_runtime_error,
                compare_paths(before["corridor_path"], after["corridor_path"], 0.43))
        hit_bytes = (RELIEF / index["maps"][key]["hit_file"]).read_bytes()
        assert len(hit_bytes) < 200_000, (key, len(hit_bytes))
        runtime_bytes = (RELIEF / index["maps"][key]["data_file"]).read_bytes()
        assert len(runtime_bytes) < 1_400_000
        report[key] = {"runtime_bytes": len(runtime_bytes), "hit_bytes": len(hit_bytes),
                       "hits_deflate_bytes": len(zlib.compress(hit_bytes)),
                       "max_runtime_error_source_pixels": round(maximum_runtime_error, 3),
                       "max_hit_error_at_960px": round(maximum_hit_error * 960 / metadata["width"], 3)}
    report["webp_metadata"] = {path.name: check_webp(path) for path in RELIEF.glob("*.webp")}
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
