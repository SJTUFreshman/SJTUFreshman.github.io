"""Compose small static map cards and split detailed geometry for on-demand loading."""

import argparse
import json
from pathlib import Path
import re

from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets/maps/relief"
CARD_WIDTH = 960
SUPERSAMPLE = 2


def path_rings(path, scale):
    for ring in re.findall(r"M([^M]+)", path):
        values = [float(value) * scale for value in re.findall(r"[-+]?(?:\d*\.)?\d+", ring)]
        if len(values) >= 6:
            yield list(zip(values[::2], values[1::2]))


def path_mask(path, size, scale):
    mask = Image.new("1", size)
    for points in path_rings(path, scale):
        left = max(0, int(min(point[0] for point in points)))
        top = max(0, int(min(point[1] for point in points)))
        right = min(size[0], int(max(point[0] for point in points)) + 2)
        bottom = min(size[1], int(max(point[1] for point in points)) + 2)
        if right <= left or bottom <= top:
            continue
        bounds = (left, top, right, bottom)
        ring = Image.new("1", (right - left, bottom - top))
        ImageDraw.Draw(ring).polygon([(horizontal - left, vertical - top) for horizontal, vertical in points], fill=1)
        mask.paste(ImageChops.logical_xor(mask.crop(bounds), ring), bounds)
    return mask


def resized_image(directory, filename, size):
    with Image.open(directory / filename) as image:
        return image.convert("RGB").resize(size, Image.Resampling.LANCZOS)


def paint_visits(image, directory, colour, regions, scale, routes=(), cultural=False):
    path_key = "boundary_path" if cultural else "path"
    paths = [region[path_key] for region in regions if region.get("visited") and region.get(path_key)]
    paths.extend(route["corridor_path"] for route in routes if route.get("corridor_path"))
    if not paths or not colour:
        return
    mask = Image.new("1", image.size)
    for path in paths:
        mask = ImageChops.logical_or(mask, path_mask(path, image.size, scale))
    if cultural:
        for region in regions:
            if not region.get("visited"):
                mask = ImageChops.logical_and(mask, ImageChops.invert(path_mask(region[path_key], image.size, scale)))
    image.paste(resized_image(directory, colour, image.size), (0, 0), mask)


def paint_insets(image, metadata, directory, scale):
    for inset in metadata.get("insets", []):
        frame = inset["frame"]
        frame_width, frame_height = frame["width"], frame["height"]
        native_width, native_height = inset["width"], inset["height"]
        image_width = min(frame_width - 32, (frame_height - 116) * native_width / native_height)
        image_height = image_width * native_height / native_width
        left = frame["x"] + (frame_width - image_width) / 2
        top = frame["y"] + 100 + (frame_height - 116 - image_height) / 2
        rectangle = [round(value * scale) for value in (frame["x"], frame["y"], frame["x"] + frame_width, frame["y"] + frame_height)]
        ImageDraw.Draw(image, "RGBA").rectangle(rectangle, fill=(248, 249, 242, 245), outline=(57, 76, 74, 178), width=SUPERSAMPLE)
        size = (max(1, round(image_width * scale)), max(1, round(image_height * scale)))
        terrain = resized_image(directory, inset["image"], size)
        overview = inset.get("overview", inset)
        paint_visits(terrain, directory, overview.get("color_image"), overview.get("regions", []), size[0] / native_width)
        image.paste(terrain, (round(left * scale), round(top * scale)))


def package(runtime, destination):
    destination = Path(destination)
    manifest = {"version": runtime["version"], "maps": {}}
    for identifier, metadata in runtime["maps"].items():
        width = min(CARD_WIDTH, metadata["width"])
        height = round(width * metadata["height"] / metadata["width"])
        size = (width * SUPERSAMPLE, height * SUPERSAMPLE)
        scale = size[0] / metadata["width"]
        data_file = identifier + "-runtime.json"
        write_json(destination / data_file, metadata)
        entry = {"width": metadata["width"], "height": metadata["height"],
                 "display_background": metadata.get("display_background", metadata.get("background")),
                 "data_file": data_file, "views": {},
                 "insets": [{"id": inset["id"], "title": inset["title"], "frame": inset["frame"]}
                            for inset in metadata.get("insets", [])]}
        views = ["overview", "cultural", "detail"] if metadata.get("cultural") else ["overview", "detail"]
        base = resized_image(destination, metadata["image"], size)
        for view in views:
            layer = metadata if view == "detail" else metadata[view]
            image = base.copy()
            paint_visits(image, destination, layer.get("color_image"), layer["regions"], scale,
                         metadata.get("routes", []) if view == "detail" else [], cultural=view == "cultural")
            if view == "cultural":
                drawing = ImageDraw.Draw(image, "RGBA")
                for region in layer["regions"]:
                    for points in path_rings(region["boundary_path"], scale):
                        drawing.line(points, fill=(57, 76, 74, 56), width=max(1, round(0.5 * SUPERSAMPLE)), joint="curve")
            paint_insets(image, metadata, destination, scale)
            filename = identifier + "-card-" + view + ".webp"
            image.resize((width, height), Image.Resampling.LANCZOS).save(destination / filename, quality=78, method=6)
            entry["views"][view] = {"image": filename, "width": width, "height": height}
        manifest["maps"][identifier] = entry
    write_json(destination / "atlas-preview.json", manifest)
    return manifest


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=OUTPUT)
    arguments = parser.parse_args()
    runtime = json.loads((arguments.directory / "atlas-runtime.json").read_text(encoding="utf-8"))
    manifest = package(runtime, arguments.directory)
    print("Packaged lightweight map cards: " + ", ".join(manifest["maps"]))


if __name__ == "__main__":
    main()
