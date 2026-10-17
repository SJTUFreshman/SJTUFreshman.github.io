"""Build the local sky's photographic, calibrated Galactic panorama.

Dependencies: Pillow, numpy, scipy. The public ESO source is 6000 x 3000;
the served images are downsampled, never AI-generated or upscaled.
"""

import argparse
import hashlib
import math
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates


ROOT = Path(__file__).resolve().parent.parent
SOURCE_URL = "https://cdn.eso.org/images/original/eso0932a.tif"
SOURCE_SHA256 = "10f209ab83e1fd89e7fa1ed70277ffc6ed19c43549f04ec637c6806d98aff035"

# name, Hipparcos ID, ICRS/J2000 Galactic unit vector [cos(b)cos(l),
# cos(b)sin(l), sin(b)], and the measured source image pixel centre.
# Directions come from assets/hipparcos-stars.js and the standard ICRS-to-
# Galactic rotation; pixel coordinates were inspected in the original TIFF.
CALIBRATION_LANDMARKS = (
    ("Sirius", 32349, -.6709173421, -.7252624695, -.1544806472, 5261, 1654),
    ("Canopus", 30438, -.1381454326, -.8935307227, -.4272220583, 4686, 1908),
    ("Arcturus", 69673, .3442913614, .0926898772, .9342762145, 2740, 324),
    ("Vega", 91262, .3621211010, .8719507319, .3294999686, 1919, 1182),
    ("Capella", 24608, -.9511516302, .2982758163, .0796373883, 344, 1455),
    ("Rigel", 24436, -.7892355315, -.4418438877, -.4264753858, 5552, 1936),
    ("Procyon", 37279, -.8105614845, -.5405857485, .2252934273, 5498, 1296),
    ("Achernar", 7588, .1843570992, -.4842547830, -.8552834414, 4175, 2454),
    ("Betelgeuse", 27989, -.9294821073, -.3343881962, -.1557162368, 5719, 1669),
    ("Altair", 97649, .6643532884, .7311949246, -.1548828282, 2262, 1639),
    ("Aldebaran", 21421, -.9380638594, -.0158864571, -.3460979862, 29, 1866),
    ("Spica", 65474, .4551020355, -.4377290578, .7754195053, 3796, 619),
    ("Fomalhaut", 113368, .3972604901, .1484246012, -.9056236750, 2762, 2559),
    ("Deneb", 102098, .0995114233, .9944251033, .0348739257, 1648, 1479),
    ("Regulus", 49669, -.4528206669, -.4759465832, .7539418370, 5314, 692),
    ("Pollux", 37826, -.8968767899, -.1943864600, .3972731150, 5858, 1133),
)
# Antares is in a nebular/blended field and is retained as an independent
# check, rather than influencing the rigid registration.
VALIDATION_LANDMARKS = (
    ("Antares", 80763, .9561030873, -.1352805723, .2599347092, 3184, 1214),
)


def pixel_direction(x, y, width=6000, height=3000):
    longitude = (.5 - (x + .5) / width) * math.tau
    latitude = (.5 - (y + .5) / height) * math.pi
    return [math.cos(latitude) * math.cos(longitude),
            math.cos(latitude) * math.sin(longitude), math.sin(latitude)]


def calibration():
    catalog = np.array([row[2:5] for row in CALIBRATION_LANDMARKS])
    observed = np.array([pixel_direction(*row[5:7]) for row in CALIBRATION_LANDMARKS])
    left, _, right = np.linalg.svd(observed.T @ catalog)
    correction = np.diag([1, 1, np.linalg.det(left @ right)])
    rotation = left @ correction @ right
    errors = []
    for row in CALIBRATION_LANDMARKS + VALIDATION_LANDMARKS:
        reference = np.array(row[2:5])
        reference /= np.linalg.norm(reference)
        measured = pixel_direction(*row[5:7])
        error = math.degrees(math.acos(np.clip(np.dot(rotation @ reference, measured), -1, 1)))
        errors.append(error)
        print(f"{row[0]:12s} HIP {row[1]:6d}: residual {error:.4f} deg")
    if max(errors) > .3 or not np.allclose(rotation.T @ rotation, np.eye(3), atol=1e-10):
        raise ValueError("The photographic panorama failed its rigid spherical calibration")
    print("Galactic-to-source rotation:", rotation.tolist())
    print(f"Fit RMS: {math.sqrt(np.mean(np.square(errors[:-1]))):.4f} deg; "
          f"independent Antares check: {errors[-1]:.4f} deg")
    return rotation


def reproject(image, rotation, order=1):
    """Apply one rigid sphere rotation, without locally warping the photograph."""
    width, height = image.size
    pixels = np.asarray(image)
    # One duplicated column at each side permits interpolation across l=180.
    pixels = np.concatenate((pixels[:, -1:], pixels, pixels[:, :1]), axis=1)
    result = np.empty((height, width, 3), dtype=np.uint8)
    longitude = (.5 - (np.arange(width) + .5) / width) * math.tau
    for start in range(0, height, 96):
        end = min(height, start + 96)
        latitude = (.5 - (np.arange(start, end) + .5) / height) * math.pi
        cosine = np.cos(latitude)[:, None]
        directions = np.stack((cosine * np.cos(longitude)[None, :],
                               cosine * np.sin(longitude)[None, :],
                               np.broadcast_to(np.sin(latitude)[:, None], (end - start, width))))
        source = np.einsum("ij,jhw->ihw", rotation, directions)
        u = (.5 - np.arctan2(source[1], source[0]) / math.tau) % 1
        v = .5 - np.arcsin(np.clip(source[2], -1, 1)) / math.pi
        coordinates = (np.clip(v * height - .5, 0, height - 1), u * width + .5)
        for channel in range(3):
            result[start:end, :, channel] = map_coordinates(
                pixels[:, :, channel], coordinates, order=order, mode="nearest", prefilter=order > 1)
    return Image.fromarray(result)


def build(source, output, quality, observatory_detail_only=False):
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError(f"Source changed: expected {SOURCE_SHA256}, received {digest}; recalibrate before use")
    with Image.open(source) as opened:
        if opened.size != (6000, 3000):
            raise ValueError("Calibration requires the unmodified 6000 x 3000 public ESO TIFF")
        # The original carries sRGB IEC61966-2.1. Keep its colour values.
        image = opened.convert("RGB")
        image.load()
    image = reproject(image, calibration(), order=3 if observatory_detail_only else 1)
    output.mkdir(parents=True, exist_ok=True)
    sampling = b'cubic registration at native resolution' if observatory_detail_only else b'bilinear registration and downsampling'
    xmp = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
           b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
           b'<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" '
           b'dc:source="https://www.eso.org/public/images/eso0932a/" '
           b'dc:rights="ESO/S. Brunier; CC BY 4.0. Modified: rigid spherical '
           b'registration to Galactic coordinates; ' + sampling + b'; WebP compression."/>'
           b'</rdf:RDF></x:xmpmeta>')
    outputs = (("milky-way-sky-native.webp", (6000, 3000)),) if observatory_detail_only else (
        ("milky-way-preview.webp", (2048, 1024)), ("milky-way-sky.webp", (4096, 2048)))
    for filename, size in outputs:
        path = output / filename
        (image if image.size == size else image.resize(size, Image.Resampling.LANCZOS)).save(
            path, "WEBP", quality=quality, method=6, xmp=xmp)
        with Image.open(path) as check:
            if check.size != size:
                raise ValueError(f"Unexpected output dimensions: {path}")
        print(f"{filename}: {size[0]} x {size[1]}, {path.stat().st_size:,} bytes")
    print("Source SHA-256:", digest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path,
                        default=ROOT / ".render-work/galaxy-reference/eso0932a-original.tif")
    parser.add_argument("--output", type=Path, default=ROOT / "assets/life/sky")
    parser.add_argument("--quality", type=int, choices=range(88, 101), default=92)
    parser.add_argument("--observatory-detail-only", action="store_true",
                        help="Preserve native 6000 x 3000 detail with cubic spherical sampling; leave shared 2K/4K files untouched")
    options = parser.parse_args()
    if not options.source.exists():
        options.source.parent.mkdir(parents=True, exist_ok=True)
        with urlopen(SOURCE_URL, timeout=120) as response:
            options.source.write_bytes(response.read())
    build(options.source, options.output, options.quality, options.observatory_detail_only)


if __name__ == "__main__":
    main()
