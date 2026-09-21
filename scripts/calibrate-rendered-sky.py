"""Explicit image-space sun calibration; never infers an astronomical date."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def direction_from_uv(horizontal, vertical):
    if not all(math.isfinite(value) for value in (horizontal, vertical)) or not 0 <= horizontal <= 1 or not 0 <= vertical <= 1:
        raise ValueError('Sun UV must contain finite normalized values in [0, 1]')
    longitude = math.tau * (horizontal - .5)
    latitude = math.pi * (.5 - vertical)
    cosine = math.cos(latitude)
    return [math.sin(longitude) * cosine, math.sin(latitude), math.cos(longitude) * cosine]


def uv_from_direction(direction):
    if len(direction) != 3 or not all(math.isfinite(value) for value in direction):
        raise ValueError('Direction must contain three finite values')
    length = math.hypot(*direction)
    if length < .000001:
        raise ValueError('Direction cannot be zero')
    horizontal, vertical, depth = [value / length for value in direction]
    return [(math.atan2(horizontal, depth) / math.tau + .5) % 1,
            .5 - math.asin(max(-1, min(1, vertical))) / math.pi]


def angular_distance(first, second):
    dot = sum(left * right for left, right in zip(first, second)) / (math.hypot(*first) * math.hypot(*second))
    return math.degrees(math.acos(max(-1, min(1, dot))))


def refine_in_seed_region(image, seed, radius_degrees):
    if not math.isfinite(radius_degrees) or not 0 < radius_degrees <= 10:
        raise ValueError('Local refinement radius must be within (0, 10] degrees')
    width, height = image.size
    row_start = max(0, int((seed[1] - radius_degrees / 180) * height) - 1)
    row_end = min(height, math.ceil((seed[1] + radius_degrees / 180) * height) + 1)
    maximum_latitude = min(90, abs(90 - seed[1] * 180) + radius_degrees)
    longitude_extent = .5 if maximum_latitude >= 89.999 else min(.5, radius_degrees / (360 * math.cos(math.radians(maximum_latitude))))
    column_start = math.floor((seed[0] - longitude_extent) * width) - 1
    column_end = math.ceil((seed[0] + longitude_extent) * width) + 1
    columns = np.unique(np.arange(column_start, column_end) % width)
    rows = np.arange(row_start, row_end)
    region_image = np.asarray(image.crop((0, row_start, width, row_end)))[:, columns]
    rgb = region_image.astype(np.float64) / 255
    rgb = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    luminance = rgb @ np.array([.2126, .7152, .0722])
    horizontal = (columns + .5) / width
    vertical = (rows + .5) / height
    longitude = math.tau * (horizontal - .5)
    latitude = math.pi * (.5 - vertical)
    cosine_latitude = np.cos(latitude)[:, None]
    first = np.sin(longitude)[None, :] * cosine_latitude
    second = np.broadcast_to(np.sin(latitude)[:, None], luminance.shape)
    third = np.cos(longitude)[None, :] * cosine_latitude
    seed_direction = direction_from_uv(*seed)
    dot = first * seed_direction[0] + second * seed_direction[1] + third * seed_direction[2]
    region = dot >= math.cos(math.radians(radius_degrees))
    if np.count_nonzero(region) < 3:
        raise ValueError('Seed region contains too few pixels at this image resolution')
    region_values = luminance[region]
    baseline = float(np.percentile(region_values, 50))
    peak = float(np.max(region_values))
    threshold = max(baseline, min(float(np.percentile(region_values, 92)), baseline + (peak - baseline) * .80))
    weights = np.where(region, np.maximum(0, luminance - threshold), 0) * cosine_latitude
    total = float(weights.sum())
    if total <= .0000001:
        raise ValueError('Seed region is uniformly bright or dark; explicit UV is safer than centroid refinement')
    direction = [float((component * weights).sum() / total) for component in (first, second, third)]
    length = math.hypot(*direction)
    direction = [value / length for value in direction]
    output_uv = uv_from_direction(direction)
    shift = angular_distance(seed_direction, direction)
    if shift > radius_degrees:
        raise ValueError('Refined center escaped the explicitly selected region')
    return output_uv, {'radiusDegrees': radius_degrees, 'thresholdLinearLuminance': threshold,
                       'seedShiftDegrees': shift, 'selectedPixelCount': int(np.count_nonzero(weights)),
                       'warning': 'A local brightness centroid is an image estimate, not proof of an unobscured solar disc.'}


def read_hdr_entry(path):
    entry = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(entry, dict):
        raise ValueError('HDR source entry must be a JSON object')
    prohibited = {'apiKey', 'api_key', 'authorization', 'token', 'password'}
    if any(key in prohibited for key in entry):
        raise ValueError('HDR source entry must not contain credentials')
    return entry


def calibrate(source, sun_uv, radius_degrees=0, uncertainty_degrees=None, hdr_entry=None):
    source = Path(source).resolve()
    data = source.read_bytes()
    with Image.open(source) as opened:
        if opened.format != 'PNG' or opened.width != opened.height * 2:
            raise ValueError('Source must be a 2:1 rendered equirectangular PNG')
        if opened.mode not in ('RGB', 'RGBA'):
            raise ValueError('Source must be RGB or fully opaque RGBA')
        if 'A' in opened.getbands() and opened.getchannel('A').getextrema() != (255, 255):
            raise ValueError('Sky calibration requires the full RGB sky, not transparent foreground scenery')
        image = opened.convert('RGB')
    direction_from_uv(*sun_uv)
    calibrated_uv = list(sun_uv)
    refinement = None
    if radius_degrees:
        calibrated_uv, refinement = refine_in_seed_region(image, sun_uv, radius_degrees)
    pixel_uncertainty = math.hypot(360 / image.width, 180 / image.height) * .5
    if uncertainty_degrees is not None and (not math.isfinite(uncertainty_degrees) or not 0 <= uncertainty_degrees <= 45):
        raise ValueError('Uncertainty must be a finite angular radius between 0 and 45 degrees')
    result = {
        'kind': 'art-direction-calibration',
        'coordinateSystem': 'sky-y-up-plus-z',
        'sunDirection': direction_from_uv(*calibrated_uv),
        'source': {
            'renderedImage': source.name,
            'renderedImageSha256': hashlib.sha256(data).hexdigest(),
            'width': image.width, 'height': image.height,
            'projection': 'equirectangular',
            'uvConvention': 'U0.5=+Z, U0.75=+X, V0=+Y; pixel-center coordinates',
            'sunUV': calibrated_uv,
            'seedUV': list(sun_uv),
            'method': 'explicit-uv' if refinement is None else 'explicit-seeded-local-luminance-centroid',
            'pixelAngularHalfDiagonalDegrees': pixel_uncertainty,
            'declaredUncertaintyDegrees': uncertainty_degrees,
            'note': 'Image art-direction calibration only; no astronomical observation date, location or physical ephemeris is inferred.',
        },
    }
    if refinement:
        result['source']['localRefinement'] = refinement
    if hdr_entry is not None:
        result['source']['hdrSource'] = hdr_entry
    return result


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='Fully rendered RGB equirectangular PNG, not foreground alpha')
    parser.add_argument('--output', required=True, help='New calibration JSON path; existing output is not overwritten')
    parser.add_argument('--sun-uv', required=True, nargs=2, type=float, metavar=('U', 'V'), help='Visually verified solar center in normalized image coordinates')
    parser.add_argument('--refine-radius-deg', type=float, default=0, help='Optional brightness-centroid refinement only inside this seeded angular radius')
    parser.add_argument('--uncertainty-deg', type=float, help='Explicitly declared angular uncertainty; use a wider value for cloud-obscured sun')
    parser.add_argument('--hdr-entry', help='Optional JSON file containing the exact HDR source manifest entry')
    return parser.parse_args()


if __name__ == '__main__':
    options = arguments()
    result = calibrate(options.source, options.sun_uv, options.refine_radius_deg, options.uncertainty_deg,
                       read_hdr_entry(options.hdr_entry) if options.hdr_entry else None)
    output = Path(options.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8', newline='\n') as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(json.dumps({'output': str(output), 'sunDirection': result['sunDirection'], 'method': result['source']['method']}))
