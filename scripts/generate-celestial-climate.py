#!/usr/bin/env python3
"""Generate deterministic cloud visuals with physically inspired motion.

Periodic wind deformation and moisture-like density changes preserve the input
map's detail while producing a smooth repeating animation. These closed-form
fields are an artistic atmosphere model, not a fluid solver or weather forecast.
Earth and Mars use separate density and circulation assumptions.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def arguments(argv=None):
    parser = argparse.ArgumentParser(description='Generate advected cloud climate keyframes from an equirectangular cloud map.')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--frames', type=int, default=8)
    parser.add_argument('--step-hours', type=float, default=3)
    parser.add_argument('--period-hours', type=float)
    parser.add_argument('--seed', type=int, default=731)
    parser.add_argument('--body', choices=('earth', 'mars'), default='earth')
    parser.add_argument('--width', type=int)
    parser.add_argument('--height', type=int)
    parser.add_argument('--chunk-rows', type=int, default=128)
    parser.add_argument('--interpolation', choices=('step', 'crossfade'), default='step')
    parser.add_argument('--model', default='moisture-lifecycle-v2.1')
    args = parser.parse_args(argv)
    if args.frames < 2 or args.frames > 128:
        parser.error('--frames must be between 2 and 128.')
    if not math.isfinite(args.step_hours) or args.step_hours <= 0:
        parser.error('--step-hours must be positive and finite.')
    expected_period = args.frames * args.step_hours
    if args.period_hours is None:
        args.period_hours = expected_period
    elif abs(args.period_hours - expected_period) > max(1e-6, expected_period * 1e-6):
        parser.error('--period-hours must equal frames multiplied by step-hours.')
    if not math.isfinite(args.period_hours) or args.period_hours <= args.step_hours:
        parser.error('--period-hours must be larger than --step-hours.')
    if args.width is not None and args.width < 8:
        parser.error('--width must be at least 8 pixels.')
    if args.height is not None and args.height < 4:
        parser.error('--height must be at least 4 pixels.')
    if args.chunk_rows < 1:
        parser.error('--chunk-rows must be positive.')
    if not args.model or any(character in args.model for character in '\r\n/\\'):
        parser.error('--model must be a simple identifier.')
    args.input = args.input.resolve()
    args.output = args.output.resolve()
    return args


def resize_source(image, width, height):
    image = image.convert('L')
    if image.size != (width, height):
        image = image.resize((width, height), Image.Resampling.LANCZOS)
    values = np.asarray(image, dtype=np.float32)
    values /= 255.0
    return np.clip(values, 0, 1, out=values)


def smooth_noise(width, height, seed, scale):
    generator = np.random.default_rng(seed)
    coarse_width = max(8, round(360 / scale))
    coarse_height = max(4, round(180 / scale))
    coarse = generator.random((coarse_height, coarse_width), dtype=np.float32)
    image = Image.fromarray(np.tile(coarse, (1, 3)))
    image = image.resize((width, height), Image.Resampling.BICUBIC,
                         box=(coarse_width, 0, coarse_width * 2, coarse_height))
    values = np.array(image, dtype=np.float32)
    return np.clip(values, 0, 1, out=values)


def bilinear_wrap(source, x, y):
    height, width = source.shape
    x = np.mod(x, float(width))
    x = np.where(x >= width, 0, x)
    y = np.clip(y, 0, height - 1)
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    x1 = (x0 + 1) % width
    y1 = np.minimum(y0 + 1, height - 1)
    x_weight = (x - x0).astype(np.float32)
    y_weight = (y - y0).astype(np.float32)
    top = source[y0, x0] * (1 - x_weight) + source[y0, x1] * x_weight
    bottom = source[y1, x0] * (1 - x_weight) + source[y1, x1] * x_weight
    return top * (1 - y_weight) + bottom * y_weight


def smoothstep(edge0, edge1, value):
    amount = np.clip((value - edge0) / np.maximum(1e-6, edge1 - edge0), 0, 1)
    return amount * amount * (3 - 2 * amount)


def transport_coordinates(width, height, frame, args, row_start=0, row_stop=None):
    rows = np.arange(row_start, height if row_stop is None else row_stop, dtype=np.float32)[:, None]
    columns = np.arange(width, dtype=np.float32)[None, :]
    latitude = (0.5 - (rows + 0.5) / height) * math.pi
    longitude = columns / width * (2 * math.pi)
    phase_angle = (frame * args.step_hours / args.period_hours % 1) * 2 * math.pi
    radius = 3389500 if args.body == 'mars' else 6371000
    jet_latitude = math.radians(48 if args.body == 'mars' else 38)
    jets = np.exp(-((np.abs(latitude) - jet_latitude) / math.radians(15)) ** 2)
    zonal_speed = (22 if args.body == 'mars' else 20) * jets - 7 * np.cos(latitude) ** 2
    amplitude_seconds = args.period_hours * 3600 / (2 * math.pi)
    zonal_angle = zonal_speed * amplitude_seconds / radius * math.sin(phase_angle)
    zonal_angle /= np.maximum(0.35, np.cos(latitude))
    wave = (np.sin(longitude * 2 + phase_angle) - np.sin(longitude * 2) +
            0.25 * (np.sin(longitude * 5 - phase_angle * 2 + latitude * 4) -
                    np.sin(longitude * 5 + latitude * 4)))
    meridional_angle = 3 * amplitude_seconds / radius * wave * np.cos(latitude)
    source_x = columns - width * zonal_angle / (2 * math.pi)
    source_y = rows - height * meridional_angle / math.pi
    return source_x, source_y, latitude, longitude, phase_angle


def periodic_noise(field, phase_angle, offset=0, row_start=0, row_stop=None):
    height, width = field.shape
    columns = np.arange(width, dtype=np.float32)[None, :]
    rows = np.arange(row_start, height if row_stop is None else row_stop, dtype=np.float32)[:, None]
    phase = phase_angle + offset
    shifted_x = columns - width * 0.018 * math.sin(phase)
    shifted_y = rows - height * 0.006 * math.cos(phase)
    return bilinear_wrap(field, shifted_x, shifted_y)


def climate_frame_rows(source, frame, args, noise_fields, storm_field, quantize=True, row_start=0, row_stop=None):
    """Evaluate periodic visual fields without integrating a weather model."""
    height, width = source.shape
    source_x, source_y, latitude, longitude, phase_angle = transport_coordinates(width, height, frame, args, row_start, row_stop)
    advected = bilinear_wrap(source, source_x, source_y)
    shifted_large = periodic_noise(noise_fields[0], phase_angle, row_start=row_start, row_stop=row_stop)
    shifted_fine = periodic_noise(noise_fields[1], -phase_angle, 0.7, row_start, row_stop)
    storms = periodic_noise(storm_field, phase_angle, 1.8, row_start, row_stop)
    wave = np.sin(longitude * 3 - phase_angle + latitude * 2)
    frontal_wave = np.cos(longitude * 5 - phase_angle * 2 + latitude * 4)
    lifecycle = np.sin(phase_angle + shifted_large * 2 * math.pi)
    absolute_latitude = np.abs(latitude)

    if args.body == 'mars':
        cold_belt = np.exp(-((absolute_latitude - math.radians(58)) / math.radians(23)) ** 2)
        vapor = 0.10 + 0.16 * cold_belt + 0.06 * shifted_large
        convergence = 0.12 * frontal_wave + 0.10 * (storms - 0.5)
        saturation = 0.61 - 0.10 * cold_belt + 0.035 * wave
        lifecycle_strength = 0.11
    else:
        warm_belt = np.cos(latitude) ** 0.7
        itcz = np.exp(-(latitude / math.radians(10)) ** 2)
        subtropical_dry = np.exp(-((absolute_latitude - math.radians(27)) / math.radians(10)) ** 2)
        vapor = 0.20 + 0.20 * warm_belt + 0.07 * shifted_large
        convergence = 0.24 * itcz + 0.20 * frontal_wave * np.cos(latitude) - 0.18 * subtropical_dry
        convergence += 0.12 * (storms - 0.5)
        saturation = 0.48 + 0.08 * subtropical_dry + 0.035 * wave
        lifecycle_strength = 0.20

    ascent = smoothstep(-0.15, 0.45, convergence)
    subsidence = smoothstep(0.0, 0.45, -convergence)
    humidity = 0.62 * advected + 0.25 * vapor + 0.07 * shifted_large + 0.06 * shifted_fine
    supersaturation = np.clip((humidity - saturation) / 0.35, 0, 1)
    condensation = supersaturation * (0.30 + 0.70 * ascent)
    rainout = 0.035 * condensation + 0.04 * subsidence
    growth = lifecycle_strength * lifecycle + 0.07 * (ascent - 0.5)
    cloud_water = advected * (1 + growth - rainout)
    cloud_water += 0.10 * condensation * (1 - advected)
    cloud_water -= 0.025 * subsidence * (1 - advected)
    result = np.clip(cloud_water, 0, 1)
    return np.rint(result * 255).astype(np.uint8) if quantize else result


def climate_frame(source, frame, args, noise_fields, storm_field, quantize=True):
    height, width = source.shape
    values = np.empty((height, width), dtype=np.uint8 if quantize else np.float32)
    for row_start in range(0, height, args.chunk_rows):
        row_stop = min(height, row_start + args.chunk_rows)
        values[row_start:row_stop] = climate_frame_rows(
            source, frame, args, noise_fields, storm_field, quantize, row_start, row_stop)
    return values


def write_frame(values, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(values, 'L').save(destination, format='PNG', optimize=True)


def main(argv=None):
    args = arguments(argv)
    if not args.input.is_file():
        raise FileNotFoundError(args.input)
    with Image.open(args.input) as image:
        width = args.width or image.width
        height = args.height or max(4, round(image.height * width / image.width))
        source = resize_source(image, width, height)
    noise_fields = (smooth_noise(width, height, args.seed + 11, 42),
                    smooth_noise(width, height, args.seed + 23, 11))
    storm_field = smooth_noise(width, height, args.seed + 37, 68)
    for frame in range(args.frames):
        values = climate_frame(source, frame, args, noise_fields, storm_field)
        write_frame(values, args.output / f't{frame:03d}.png')
        print(f'CLIMATE_FRAME_DONE {args.body} {frame + 1}/{args.frames} {width}x{height}', flush=True)
    metadata = {
        'model': args.model, 'modelVersion': '2.1', 'body': args.body,
        'seed': args.seed, 'frameCount': args.frames,
        'stepHours': args.step_hours, 'periodHours': args.period_hours,
        'timeStepSeconds': args.step_hours * 3600, 'loopSeconds': args.period_hours * 3600,
        'timeUnit': 'hours', 'interpolation': args.interpolation, 'width': width, 'height': height,
        'timePad': 3, 'source': args.input.name, 'surfaceReuse': 'v5',
        'simulation': 'physically-inspired visual cloud lifecycle; single-frame evaluation with no temporal accumulation; not a weather simulation',
        'description': f'{args.period_hours:g}-hour periodic visual loop sampled every {args.step_hours:g} hours; '
                       + ('display one time sample per layer with premultiplied-alpha compositing; no temporal blending or frame accumulation'
                          if args.interpolation == 'step' else
                          'blend only adjacent time samples with premultiplied-alpha compositing; moving features can overlap during the blend'),
        'windModel': 'periodic-latitude-jets-and-meridional-wave-deformation',
        'moistureModel': 'cold-belt-sparse-vapor-proxy' if args.body == 'mars' else 'warm-belt-vapor-proxy',
        'convergenceModel': 'frontal-wave-lift' if args.body == 'mars' else 'itcz-frontal-wave-with-subtropical-subsidence',
        'densityModel': 'saturation-condensation-rainout-decay-with-advected-source',
        'cloudLifecycle': 'moisture-source-transport-convergence-condensation-precipitation',
        'periodicity': 'continuous-periodic-fields-without-time-reset',
        'noiseScaleUnit': 'degrees',
        'shadowMode': 'split-layer'
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'climate.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metadata, ensure_ascii=False))


if __name__ == '__main__':
    main()
