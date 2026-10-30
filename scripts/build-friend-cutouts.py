import json
import re
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent


def build():
    content = json.loads((ROOT / "site_content.json").read_text(encoding="utf-8"))
    for group in content["life"].get("friend_groups", []):
        source = Image.open(ROOT / group["image"]).convert("RGBA")
        if source.size != (group["width"], group["height"]):
            raise ValueError(f"Unexpected dimensions for {group['image']}")
        for person in group["people"]:
            coordinates = [float(value) for value in re.findall(r"-?\d+(?:\.\d+)?", person["outline"])]
            points = list(zip(coordinates[::2], coordinates[1::2]))
            if len(points) < 3 or len(coordinates) % 2:
                raise ValueError(f"Invalid outline for {person['id']}")
            mask = Image.new("L", (source.width * 3, source.height * 3))
            ImageDraw.Draw(mask).polygon([(horizontal * 3, vertical * 3) for horizontal, vertical in points], fill=255)
            mask = mask.resize(source.size, Image.Resampling.LANCZOS)
            cutout = source.copy()
            cutout.putalpha(mask)
            cutout = cutout.crop(person["crop"])
            target = ROOT / person["cutout"]
            target.parent.mkdir(parents=True, exist_ok=True)
            cutout.save(target, lossless=True, method=6)
            print(person["id"], cutout.size, target.stat().st_size)


if __name__ == "__main__":
    build()
