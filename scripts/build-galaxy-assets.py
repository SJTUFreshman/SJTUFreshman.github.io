import argparse
import hashlib
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from PIL import Image, ImageFilter


SOURCE_URL = "https://www.esa.int/var/esa/storage/images/esa_multimedia/images/2025/01/the_best_milky_way_map_by_gaia/26530986-1-eng-GB/The_best_Milky_Way_map_by_Gaia.jpg"
ROOT = Path(__file__).resolve().parent.parent
TEXTURE_SIZE = 4096
LUMINANCE = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def natural_starlight(pixels):
    """Grade the artist reconstruction, without changing its arm geometry.

    This is a display colour treatment, not a new photometric measurement.
    Remove the broad violet cast while keeping blue young populations, warm
    old populations and the source's small red emission regions distinct.
    """
    light = pixels @ LUMINANCE
    red, green, blue = (pixels[:, :, channel] for channel in range(3))
    emission = np.clip((red - np.maximum(green, blue) * 1.4 - 0.025) * 8, 0, 1)
    green_floor = (red * 0.54 + blue * 0.46) * 0.98
    graded = pixels.copy()
    graded[:, :, 1] += np.maximum(0, green_floor - green) * (1 - emission * 0.8)
    graded *= light[:, :, None] / np.maximum((graded @ LUMINANCE)[:, :, None], 0.001)
    graded = light[:, :, None] + (graded - light[:, :, None]) * 0.78

    # Contrast at the scale of dust filaments, not pixel noise or new arms.
    # A bounded ratio preserves faint outer fragments and the bright bar.
    light_image = Image.fromarray(np.round(np.clip(light, 0, 1) * 255).astype(np.uint8))
    smooth = np.asarray(light_image.filter(ImageFilter.GaussianBlur(TEXTURE_SIZE * 0.007)), dtype=np.float32) / 255
    structure = np.clip(light / np.maximum(smooth, 0.015), 0.45, 1.65)
    graded *= np.power(structure, 0.48)[:, :, None]
    return np.clip(np.power(np.maximum(graded, 0), 1.10), 0, 1)


def build(source, output):
    image = Image.open(source).convert("RGB").resize((TEXTURE_SIZE, TEXTURE_SIZE), Image.Resampling.LANCZOS)
    detail = np.asarray(image, dtype=np.float32) / 255
    pixels = np.asarray(image.filter(ImageFilter.GaussianBlur(1.25)), dtype=np.float32) / 255
    fine_light = (detail - pixels) @ LUMINANCE
    pixels = natural_starlight(np.clip(pixels + fine_light[:, :, None] * 0.18, 0, 1))
    rows, columns = np.mgrid[:TEXTURE_SIZE, :TEXTURE_SIZE].astype(np.float32)
    horizontal = (columns / (TEXTURE_SIZE - 1) - 0.5) * 800
    vertical = (0.5 - rows / (TEXTURE_SIZE - 1)) * 800
    radial = np.hypot(horizontal, vertical)
    edge = np.clip((392 - radial) / 65, 0, 1)
    edge = edge * edge * (3 - 2 * edge)
    companion = np.exp(-0.5 * (((horizontal + 51) / 22) ** 2 + ((vertical - 354) / 27) ** 2))
    pixels = np.maximum(0, pixels - 0.005) * edge[:, :, None] * (1 - companion[:, :, None])
    image = Image.fromarray(np.round(np.clip(pixels, 0, 1) * 255).astype(np.uint8))
    luminance = pixels @ LUMINANCE
    smooth = np.asarray(image.convert("L").filter(ImageFilter.GaussianBlur(14)), dtype=np.float32) / 255
    contrast = np.maximum(0, smooth - luminance) / np.maximum(smooth, 0.08)
    warm_dust = np.maximum(0, pixels[:, :, 0] - pixels[:, :, 2])
    dust = np.clip(contrast * 3.2 + warm_dust * 0.65, 0, 1)
    dust *= np.clip(luminance / 0.08, 0, 1)
    bar_minor = horizontal * 0.9563 - vertical * 0.2924
    bar_major = horizontal * 0.2924 + vertical * 0.9563
    bulge_weight = np.exp(-0.5 * ((bar_minor / 36) ** 2 + (bar_major / 72) ** 2)) * 0.86
    smooth_light = np.asarray(image.filter(ImageFilter.GaussianBlur(18)), dtype=np.float32) / 255
    bulge = np.minimum(pixels, smooth_light * bulge_weight[:, :, None])
    warmth = np.clip(bulge[:, :, 2] / np.maximum(bulge[:, :, 0], 0.001), 0, 1)
    warmth *= np.clip(bulge[:, :, 0] / 0.01, 0, 1)
    structure = np.stack((dust, bulge[:, :, 0], warmth), axis=2)
    output.mkdir(parents=True, exist_ok=True)
    image.save(output / "milky-way-starlight.webp", quality=96, method=6)
    structure_image = Image.fromarray(np.round(np.clip(structure, 0, 1) * 255).astype(np.uint8))
    structure_image.resize((2048, 2048), Image.Resampling.LANCZOS).save(output / "milky-way-dust.webp", quality=94, method=6)
    print("Source SHA-256:", hashlib.sha256(source.read_bytes()).hexdigest())
    for asset in sorted(output.glob("*.webp")):
        print(f"{asset.name}: {asset.stat().st_size:,} bytes")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / ".render-work/gaia-milky-way-original.jpg")
    parser.add_argument("--output", type=Path, default=ROOT / "assets/life/galaxy")
    options = parser.parse_args()
    if not options.source.exists():
        options.source.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(SOURCE_URL, timeout=60) as response:
            options.source.write_bytes(response.read())
    build(options.source, options.output)


if __name__ == "__main__":
    main()
