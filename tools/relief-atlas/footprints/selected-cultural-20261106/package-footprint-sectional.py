"""Verify native sectional renders, then stage or publish the footprint atlas."""

from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ROOT / "tools/relief-atlas/footprints/selected-cultural-20261106"
DEFAULT_OUTPUT = ROOT / "assets/maps/relief"
MAPS = ("china", "east_asia", "europe_usa")
INSETS = {
    "singapore": {"x": 4480, "y": 2850, "width": 1400, "height": 850},
    "hawaii": {"x": 4480, "y": 3810, "width": 1400, "height": 850},
}
GEOMETRY_KEYS = ("width", "height", "projection", "extent_km", "geographic_bounds")
RENDER_KEYS = (
    "palette", "region_colors", "background", "samples", "dem_shape",
    "unvisited_material", "vertical_exaggeration",
)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def archive_name(path):
    return path.resolve().relative_to(ROOT.resolve()).as_posix()


def verify_render(render_root, identifier, variants, style):
    metadata = read_json(render_root / "data" / f"{identifier}.json")
    report = read_json(render_root / "renders" / f"{identifier}-render.json")
    scenes = read_json(render_root / "scenes" / f"{identifier}-scenes.json")
    dimensions = [metadata["width"], metadata["height"]]
    require(report["native_render_size"] == dimensions, f"{identifier}: render dimensions differ")
    require(report.get("samples", 0) >= 192, f"{identifier}: production requires at least 192 samples")
    require(report.get("postprocessing") == "none", f"{identifier}: native render required")
    require(report.get("gpu_devices"), f"{identifier}: GPU provenance missing")
    require(report["sea_material"] == style["backgrounds"][identifier], f"{identifier}: sea material differs")
    unvisited = style.get("unvisited_materials", {}).get(identifier, style["unvisited_material"])
    require(report["unvisited_material"] == unvisited, f"{identifier}: land material differs")
    from PIL import Image
    for variant in variants:
        image_path = render_root / "renders" / f"{identifier}-{variant}.png"
        require(digest(image_path) == report["outputs"][image_path.name], f"{image_path}: checksum mismatch")
        with Image.open(image_path) as image:
            require(list(image.size) == dimensions, f"{image_path}: dimensions differ")
            image.verify()
        scene = scenes[variant]
        scene_path = render_root / "scenes" / f"{identifier}-{variant}.blend"
        require(scene.get("reopened") and scene.get("pigments_verified") and scene.get("lighting_verified"),
                f"{scene_path}: scene verification missing")
        require(scene["resolution"] == dimensions, f"{scene_path}: dimensions differ")
        require(scene["sha256"] == digest(scene_path), f"{scene_path}: checksum mismatch")
        require(scene["bytes"] == scene_path.stat().st_size, f"{scene_path}: byte count differs")
        require(scene.get("postprocessing") == "none", f"{scene_path}: native scene required")
        require(scene.get("sea_material") == report["sea_material"], f"{scene_path}: sea material differs")
        if variant == "relief":
            require(scene.get("white_material_verified"), f"{scene_path}: unvisited material unverified")
    return metadata, report


def recolour_regions(regions, prepared):
    colours = {str(region["id"]): region.get("color") for region in prepared}
    provinces = {str(region["province"]): region.get("color")
                 for region in prepared if region.get("province") and region.get("color")}
    result = deepcopy(regions)
    for region in result:
        colour = colours.get(str(region["id"])) or provinces.get(str(region.get("province")))
        if colour:
            region["color"] = colour
    return result


def verify_inputs(archive, published):
    style = read_json(archive / "style.json")
    verified = {"detail": {}, "overview": {}}
    for identifier in (*MAPS, *INSETS):
        variants = ("relief",) if identifier in ("europe_usa", *INSETS) else ("relief", "colour")
        verified["detail"][identifier] = verify_render(archive / "detail", identifier, variants, style)
    for identifier in ("east_asia", "europe_usa"):
        verified["overview"][identifier] = verify_render(archive / "overview", identifier, ("colour",), style)
    for identifier in MAPS:
        metadata = verified["detail"][identifier][0]
        for key in GEOMETRY_KEYS:
            require(metadata[key] == published["maps"][identifier][key],
                    f"{identifier}: {key} changed; existing visit geometry cannot be reused")
    for identifier in ("east_asia", "europe_usa"):
        overview = verified["overview"][identifier][0]
        detail = verified["detail"][identifier][0]
        for key in GEOMETRY_KEYS:
            require(overview[key] == detail[key], f"{identifier}: overview {key} differs")
    china_overview = read_json(archive / "overview/data/china.json")
    verified["overview"]["china"] = (china_overview, verified["detail"]["china"][1])
    for identifier in ("china", "east_asia"):
        expected = style.get("map_province_colors", {}).get(identifier, style["province_colors"])
        for region in verified["overview"][identifier][0]["regions"]:
            if region.get("province"):
                require(region["color"] == expected[str(region["province"])],
                        f"{identifier}/{region['id']}: province pigment differs from selected palette")
    if (archive / "cultural/data/china.json").exists():
        verified["cultural"] = verify_render(archive / "cultural", "china", ("colour",), style)
    return style, verified


def encode(source, target, preview_width=1600):
    from PIL import Image
    with Image.open(source) as native:
        image = native.convert("RGB")
        image.save(target, quality=95, method=6)
        preview = image.copy()
        preview.thumbnail((preview_width, round(preview_width * image.height / image.width)), Image.Resampling.LANCZOS)
        preview_path = target.with_name(target.stem + "-preview.webp")
        preview.save(preview_path, quality=86, method=6)
        samples = image.resize((160, 160), Image.Resampling.NEAREST)
        background = max(samples.getcolors(25600), key=lambda item: item[0])[1]
        return {
            "image": preview_path.name, "width": preview.width, "height": preview.height,
        }, "#" + "".join(f"{channel:02x}" for channel in background)


def runtime_atlas(atlas):
    result = {"version": atlas["version"], "maps": {}}
    keys = ("id", "width", "height", "image", "color_image", "background", "display_background", "preview", "insets")
    for identifier, metadata in atlas["maps"].items():
        item = {key: deepcopy(metadata[key]) for key in keys if key in metadata}
        item["regions"] = [deepcopy(region) for region in metadata["regions"] if region.get("visited")]
        item["routes"] = [{key: route[key] for key in ("id", "corridor_path", "corridor_width_km")}
                          for route in metadata["routes"]]
        overview = metadata["overview"]
        item["overview"] = {key: deepcopy(overview[key]) for key in ("color_image", "preview_color_image", "regions")}
        if metadata.get("cultural"):
            item["cultural"] = deepcopy(metadata["cultural"])
        result["maps"][identifier] = item
    return result


def stage_atlas(archive, published, verified, destination):
    atlas = deepcopy(published)
    for identifier in MAPS:
        metadata, report = verified["detail"][identifier]
        current = atlas["maps"][identifier]
        current.update({key: deepcopy(metadata[key]) for key in RENDER_KEYS})
        current.update(deepcopy(report))
        current["source_archive"] = archive_name(archive / "detail")
        current["regions"] = recolour_regions(current["regions"], metadata["regions"])
        province_colours = {str(region["province"]): region["color"]
                            for region in verified["overview"][identifier][0]["regions"] if region.get("province")}
        for route in current["routes"]:
            for segment in route.get("segments", []):
                if str(segment.get("adcode")) in province_colours:
                    segment["color"] = province_colours[str(segment["adcode"])]
        variants = ("relief",) if identifier == "europe_usa" else ("relief", "colour")
        for variant in variants:
            filename = f"{identifier}-{variant}.webp"
            preview, background = encode(archive / "detail/renders" / f"{identifier}-{variant}.png",
                                         destination / filename)
            if variant == "relief":
                current["image"] = filename
                current["display_background"] = background
                current["preview"] = preview
            else:
                current["color_image"] = filename
                current["preview"]["color_image"] = preview["image"]
        if identifier == "europe_usa":
            current["color_image"] = current["image"]
            current["preview"]["color_image"] = current["preview"]["image"]
        overview_metadata, overview_report = verified["overview"][identifier]
        overview = current["overview"]
        overview["regions"] = recolour_regions(overview["regions"], overview_metadata["regions"])
        overview["source_archive"] = archive_name(archive / "overview")
        overview["relief_source_archive"] = current["source_archive"]
        overview["outputs"] = deepcopy(overview_report["outputs"])
        overview["postprocessing"] = overview_report["postprocessing"]
        overview["sea_material"] = overview_report["sea_material"]
        if identifier == "china":
            overview["color_source_archive"] = current["source_archive"]
            overview["color_image"] = current["color_image"]
            overview["preview_color_image"] = current["preview"]["color_image"]
        else:
            filename = f"{identifier}-overview-colour.webp"
            preview, _ = encode(archive / "overview/renders" / f"{identifier}-colour.png",
                                destination / filename)
            overview["color_image"] = filename
            overview["preview_color_image"] = preview["image"]
            overview["color_source_archive"] = archive_name(archive / "overview")
    insets = []
    for identifier, frame in INSETS.items():
        metadata, report = verified["detail"][identifier]
        filename = f"{identifier}-relief.webp"
        preview, background = encode(archive / "detail/renders" / f"{identifier}-relief.png",
                                     destination / filename)
        insets.append({
            "id": identifier, "title": metadata["title"], "frame": frame,
            "width": metadata["width"], "height": metadata["height"],
            "image": filename, "preview": preview, "regions": [],
            "background": report["sea_material"], "display_background": background,
            "source_archive": archive_name(archive / "detail"), "outputs": report["outputs"],
        })
    atlas["maps"]["east_asia"]["insets"] = insets
    if "cultural" in verified:
        spec = importlib.util.spec_from_file_location("china_cultural", ROOT / "scripts/build-china-cultural-overview.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        atlas["maps"]["china"]["cultural"] = module.package_layer(archive, destination, atlas)
    write_json(destination / "atlas.json", atlas)
    write_json(destination / "atlas-runtime.json", runtime_atlas(atlas))
    return atlas


def stage_activation(archive, style, destination):
    activation = destination / "activation"
    activation.mkdir()
    active_style = deepcopy(style)
    active_style["render_archive"] = archive_name(archive / "detail")
    active_style["overview_archive"] = archive_name(archive / "overview")
    if (archive / "cultural/data/china.json").exists():
        active_style["cultural_archive"] = archive_name(archive / "cultural")
    style_path = activation / "footprints-style.json"
    write_json(style_path, active_style)
    journeys = read_json(ROOT / "assets/maps/footprint-journeys.json")
    province_colours = style["province_colors"]
    for route in journeys["routes"]:
        for segment in route["segments"]:
            province = str(segment["adcode"])
            require(province in province_colours, f"{route['id']}: unknown province pigment {province}")
            segment["color"] = province_colours[province]
    journeys["source"]["colour_source"] = "tools/relief-atlas/footprints-style.json province_colors"
    journeys_path = activation / "footprint-journeys.json"
    write_json(journeys_path, journeys)
    return [
        (style_path, ROOT / "tools/relief-atlas/footprints-style.json"),
        (journeys_path, ROOT / "assets/maps/footprint-journeys.json"),
    ]


def publish(staged, output, activation=()):
    backup = staged / "backup"
    backup.mkdir()
    files = sorted((path for path in staged.iterdir() if path.is_file()), key=lambda path: path.suffix == ".json")
    operations = [(source, output / source.name) for source in files if source.suffix != ".json"]
    operations.extend(activation)
    operations.extend((source, output / source.name) for source in files if source.suffix == ".json")
    completed = []
    try:
        for index, (source, target) in enumerate(operations):
            saved = backup / f"{index}-{target.name}"
            if target.exists():
                shutil.copy2(target, saved)
            os.replace(source, target)
            completed.append((target, saved))
    except Exception:
        for target, saved in reversed(completed):
            if saved.exists():
                os.replace(saved, target)
            else:
                target.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--stage", type=Path, help="Encode into a separate new directory for review")
    parser.add_argument("--publish", action="store_true", help="Publish only after every native render and scene is verified")
    arguments = parser.parse_args()
    try:
        require(not (arguments.stage and arguments.publish), "Choose --stage or --publish")
        published = read_json(arguments.output / "atlas.json")
        style, verified = verify_inputs(arguments.archive, published)
        if arguments.stage:
            require(not arguments.stage.exists(), f"Stage directory already exists: {arguments.stage}")
            arguments.stage.mkdir(parents=True)
            try:
                stage_atlas(arguments.archive, published, verified, arguments.stage)
            except Exception:
                shutil.rmtree(arguments.stage)
                raise
        elif arguments.publish:
            with tempfile.TemporaryDirectory(prefix=".sectional-stage-", dir=arguments.output.parent) as temporary:
                staged = Path(temporary)
                stage_atlas(arguments.archive, published, verified, staged)
                activation = stage_activation(arguments.archive, style, staged)
                publish(staged, arguments.output, activation)
        print(json.dumps({"verified": True, "published": arguments.publish,
                          "stage": str(arguments.stage) if arguments.stage else None,
                          "maps": list(MAPS), "insets": list(INSETS)}))
    except (KeyError, ValueError, FileNotFoundError) as error:
        parser.exit(2, f"Refusing publication: {error}\n")


if __name__ == "__main__":
    main()
