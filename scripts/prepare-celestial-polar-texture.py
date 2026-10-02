import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description='Derive an RGB planet texture with smooth poles while preserving the original file.')
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pole-fraction', type=float, default=0.02)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        parser.error('The output must be separate from the original texture.')
    if args.output.suffix.lower() != '.png' or not 0 < args.pole_fraction < 0.1:
        parser.error('Use a PNG output and a pole-fraction between 0 and 0.1.')
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(args.source) as source:
        if source.mode != 'RGB':
            parser.error('The source must be an 8-bit RGB color texture.')
        width, height = source.size
        cap_rows = round(height * args.pole_fraction)
        if cap_rows < 2 or cap_rows * 2 >= height:
            parser.error('The source is too small for the requested pole-fraction.')
        result = source.copy()
        for top in (True, False):
            bounds = (0, 0, width, cap_rows) if top else (0, height - cap_rows, width, height)
            pixels = np.asarray(source.crop(bounds), dtype=np.float32) / 255
            linear = np.where(pixels <= 0.04045, pixels / 12.92, ((pixels + 0.055) / 1.055) ** 2.4)
            position = np.linspace(0, 1, cap_rows, dtype=np.float32)
            smoother = position ** 3 * (position * (position * 6 - 15) + 10)
            blend = (1 - smoother) if top else smoother
            average = linear.mean(axis=1, keepdims=True)
            linear = linear * (1 - blend[:, None, None]) + average * blend[:, None, None]
            pixels = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)
            pixels = np.clip(np.rint(pixels * 255), 0, 255).astype(np.uint8)
            result.paste(Image.fromarray(pixels), (0, bounds[1]))
        for row in (0, height - 1):
            samples = np.asarray(result.crop((0, row, width, row + 1)))
            if np.any(samples != samples[:, :1]):
                raise RuntimeError('The exact pole row must be uniform.')
        if source.crop((0, cap_rows, width, height - cap_rows)).tobytes() != result.crop((0, cap_rows, width, height - cap_rows)).tobytes():
            raise RuntimeError('Pixels outside the pole caps changed.')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        result.save(args.output, compress_level=4)
    report = {'source': str(args.source.resolve()), 'output': str(args.output.resolve()), 'size': [width, height], 'sourceSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(), 'outputSha256': hashlib.sha256(args.output.read_bytes()).hexdigest(), 'poleFraction': args.pole_fraction, 'capDegrees': args.pole_fraction * 180, 'capRows': cap_rows, 'method': 'linear RGB longitude mean blend, smootherstep to unchanged cap boundary'}
    args.output.with_suffix('.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
