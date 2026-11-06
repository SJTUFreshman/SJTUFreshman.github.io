"""Prepare sectional map pigments from archived geometry without altering the DEM."""

from __future__ import annotations

import argparse
import ast
from array import array
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zipfile

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools/relief-atlas/footprints/material-white-20261012"
OVERVIEWS = ROOT / "tools/relief-atlas/footprints/administrative-20261016"
DEFAULT_OUTPUT = ROOT / "tools/relief-atlas/footprints/sectional-20261105"
PALETTES = {
    "celadon": ["#7eaaa0", "#99bab0", "#6d9a90", "#b1c8b9", "#86aaa2", "#a4bfaf", "#799f96", "#b9cebf"],
    "blue": ["#7e9eaf", "#9cb7c4", "#6e8da3", "#b0c4cb", "#8caab9", "#a5bcc7", "#819bac", "#b6c8cf"],
    "sand": ["#d1bca0", "#d9c9b3", "#c5ab8e", "#dfd2c0", "#ccb79c", "#e6dac7", "#d4c3ad", "#bfa587"],
}
MAPS = ("china", "east_asia", "europe_usa")
BACKGROUNDS = {
    "china": "#e3ebed", "east_asia": "#e4edf0", "europe_usa": "#e5e9e9",
    "singapore": "#e4edf0", "hawaii": "#e4edf0",
}
SAND_INDICES = {
    "USA": 0, "CAN": 3, "MEX": 2, "GRL": 5, "FRA": 0, "ESP": 3, "PRT": 2,
    "DEU": 4, "GBR": 6, "IRL": 3, "ITA": 7, "CHE": 5, "AUT": 1, "BEL": 2,
    "NLD": 3, "POL": 0, "CZE": 5, "RUS": 3, "NOR": 6, "SWE": 0, "FIN": 5,
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def stable_index(identifier):
    return int(hashlib.sha256(str(identifier).encode("utf-8")).hexdigest()[:4], 16) % 8


def region_colour(region, identifier, chinese_colours):
    province = str(region.get("province", region["id"]))
    if province in chinese_colours:
        return chinese_colours[province]
    key = str(region["id"])
    if identifier == "europe_usa":
        return PALETTES["sand"][SAND_INDICES.get(key, stable_index(key))]
    return PALETTES["blue"][stable_index(key)]


def npy_header(data):
    if data[:6] != b"\x93NUMPY":
        raise ValueError("Invalid NumPy array")
    length_size = 2 if data[6:8] == b"\x01\x00" else 4
    header_size = int.from_bytes(data[8:8 + length_size], "little")
    offset = 8 + length_size
    return ast.literal_eval(data[offset:offset + header_size].decode("latin-1")), offset + header_size


def region_array(image):
    values = array("H", image.getdata())
    if sys.byteorder != "little":
        values.byteswap()
    header = repr({"descr": "<u2", "fortran_order": False, "shape": (image.height, image.width)})
    padding = 64 - ((10 + len(header) + 1) % 64)
    encoded = (header + " " * padding + "\n").encode("latin-1")
    return b"\x93NUMPY\x01\x00" + struct.pack("<H", len(encoded)) + encoded + values.tobytes()


def province_grid(metadata, shape):
    rows, columns = shape
    image = Image.new("I", (columns, rows), 0)
    for region in metadata["regions"]:
        region_mask = Image.new("1", image.size)
        for ring in re.findall(r"M([^M]+)", region["path"]):
            coordinates = [float(value) for value in re.findall(r"[-+]?(?:\d*\.)?\d+", ring)]
            points = [(coordinates[index] * (columns - 1) / metadata["width"],
                       coordinates[index + 1] * (rows - 1) / metadata["height"])
                      for index in range(0, len(coordinates) - 1, 2)]
            if len(points) < 3:
                continue
            ring_mask = Image.new("1", image.size)
            ImageDraw.Draw(ring_mask).polygon(points, fill=1)
            region_mask = ImageChops.logical_xor(region_mask, ring_mask)
        image.paste(region["raster_id"], mask=region_mask)
    if not image.getbbox():
        raise ValueError("Province raster is empty")
    return region_array(image)


def write_grid(source, output, replacement):
    arrays = {}
    with zipfile.ZipFile(source) as archive, zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for name in archive.namelist():
            original = archive.read(name)
            value = replacement if name == "region.npy" else original
            target.writestr(name, value)
            arrays[name] = {"sha256": digest(value), "source_sha256": digest(original), "unchanged": original == value}
    assert all(value["unchanged"] for name, value in arrays.items() if name != "region.npy")
    return arrays


def clean_metadata(metadata, identifier, output, layer):
    result = deepcopy(metadata)
    for key in ("outputs", "gpu_devices", "render_engine", "lighting", "postprocessing", "sea_material", "display_background"):
        result.pop(key, None)
    result["background"] = BACKGROUNDS[identifier]
    result["unvisited_material"] = "#f4f1e9"
    result["source_archive"] = output.resolve().relative_to(ROOT).as_posix() + "/" + layer
    result["palette_design"] = "sectional-20261105"
    result["render_status"] = "pending"
    return result


def prepare(output, metadata_only=False):
    china_overview = read_json(OVERVIEWS / "data/china.json")
    chinese_colours = {str(region["id"]): PALETTES["celadon"][index % 8]
                       for index, region in enumerate(china_overview["regions"])}
    manifest = {"status": "metadata_prepared" if metadata_only else "ready_to_render", "postprocessing": "none",
                "rendered": False, "palettes": PALETTES, "backgrounds": BACKGROUNDS, "maps": {}}
    overview_metadata = {}
    for identifier in MAPS:
        metadata = clean_metadata(read_json(OVERVIEWS / "data" / (identifier + ".json")), identifier, output, "overview")
        for index, region in enumerate(metadata["regions"], 1):
            region["raster_id"] = int(region.get("raster_id", index))
            region["color"] = region_colour(region, identifier, chinese_colours)
        metadata["region_colors"] = {str(region["raster_id"]): region["color"] for region in metadata["regions"]}
        metadata["palette"] = list(dict.fromkeys(metadata["region_colors"].values()))
        metadata["relief_source_archive"] = output.resolve().relative_to(ROOT).as_posix() + "/detail"
        metadata["color_source_archive"] = output.resolve().relative_to(ROOT).as_posix() + ("/detail" if identifier == "china" else "/overview")
        overview_metadata[identifier] = metadata
        write_json(output / "overview/data" / (identifier + ".json"), metadata)
    for identifier in MAPS:
        metadata = clean_metadata(read_json(SOURCE / "data" / (identifier + ".json")), identifier, output, "detail")
        for region in metadata["regions"]:
            if region.get("province"):
                region["color"] = chinese_colours[str(region["province"])]
        if identifier != "europe_usa":
            metadata["palette"] = overview_metadata[identifier]["palette"]
            metadata["region_colors"] = overview_metadata[identifier]["region_colors"]
        metadata["colour_raster_units"] = "province" if identifier == "china" else "province / cultural-region" if identifier == "east_asia" else "none"
        write_json(output / "detail/data" / (identifier + ".json"), metadata)
        source_grid = SOURCE / "data" / (identifier + ".npz")
        record = {"detail_metadata": (output / "detail/data" / (identifier + ".json")).relative_to(ROOT).as_posix(),
                  "variants": ["relief", "colour"] if identifier != "europe_usa" else ["relief"]}
        if not metadata_only:
            with zipfile.ZipFile(source_grid) as archive:
                header, _ = npy_header(archive.read("elevation.npy"))
                if identifier == "china":
                    replacement = province_grid(overview_metadata[identifier], header["shape"])
                elif identifier == "east_asia":
                    with zipfile.ZipFile(OVERVIEWS / "data/east_asia.npz") as overview_grid:
                        for name in ("elevation.npy", "mask.npy", "x.npy", "y.npy"):
                            assert archive.read(name) == overview_grid.read(name), (identifier, name, "DEM grid mismatch")
                        replacement = overview_grid.read("region.npy")
                else:
                    replacement = archive.read("region.npy")
            record["arrays"] = write_grid(source_grid, output / "detail/data" / (identifier + ".npz"), replacement)
            if identifier != "china":
                with zipfile.ZipFile(OVERVIEWS / "data" / (identifier + ".npz")) as archive:
                    replacement = archive.read("region.npy")
                write_grid(OVERVIEWS / "data" / (identifier + ".npz"), output / "overview/data" / (identifier + ".npz"), replacement)
        manifest["maps"][identifier] = record
    for identifier in ("china", "east_asia"):
        for layer in ("detail", "overview"):
            metadata = read_json(output / layer / "data" / (identifier + ".json"))
            for region in metadata["regions"]:
                if region.get("province"):
                    assert region["color"] == chinese_colours[str(region["province"])]
    style = {"name": "Sectional celadon / mist blue / warm sand", "palette": PALETTES["celadon"],
             "unvisited_material": "#f4f1e9", "backgrounds": BACKGROUNDS, "samples": 192,
             "province_colors": chinese_colours, "map_palettes": {"china": PALETTES["celadon"], "east_asia": PALETTES["blue"], "europe_usa": PALETTES["sand"]},
             "country_palette_indices": SAND_INDICES, "palette_index_algorithm": "sha256-first-four-hex-modulo-eight",
             "render_widths": {"china": 6000, "east_asia": 6000, "europe_usa": 8000},
             "corridor_width_km": {"rail": 30, "road": 26}}
    write_json(output / "style.json", style)
    write_json(output / "prepare-manifest.json", manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--metadata-only", action="store_true")
    arguments = parser.parse_args()
    manifest = prepare(arguments.output.resolve(), arguments.metadata_only)
    print(json.dumps({"output": arguments.output.as_posix(), "status": manifest["status"], "maps": list(manifest["maps"]),
                      "same_chinese_province_colours": True, "rendered": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
