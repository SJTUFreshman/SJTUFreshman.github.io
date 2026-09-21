#!/usr/bin/env python3
"""Create image evidence for an offline render queue without installing it."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


DETAILS = {
    'spaceship': [('instruments', 0, -20, 50), ('life-support', 234, -9.5, 34),
                  ('avionics', 126, -9.5, 34), ('lining', 90, 51, 35), ('footwell', 0, -51, 40)],
    'shelter': [('street-front', 0, 8, 55), ('street-rear', 180, 8, 55),
                ('factory-left', 316, 8, 35), ('factory-right', 40, 8, 35), ('ground', 0, -50, 45)],
    'hogwarts': [('castle', 346, 8, 29), ('gate-bridge', 12, -2, 30),
                 ('foreground', 0, -37, 48), ('far-ridges', 145, 8, 40)],
    'snowmountain': [('forward-ridge', 8.6, -4, 55), ('rear-ridge', 180, 0, 55),
                     ('snow-contact', 0, -53, 40), ('rock-contact', 265, -9, 42)],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', choices=DETAILS, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--sky')
    parser.add_argument('--output-dir', required=True)
    options = parser.parse_args()
    source = Path(options.source).resolve()
    directory = Path(options.output_dir).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    specification = importlib.util.spec_from_file_location('panorama_projection',
                                                          Path(__file__).with_name('panorama-contact-sheet.py'))
    projection = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(projection)
    foreground = Image.open(source).convert('RGBA')
    if foreground.width != foreground.height * 2:
        raise ValueError('Expected a complete 2:1 equirectangular render')
    sky = Image.open(options.sky).convert('RGBA').resize(foreground.size) if options.sky else Image.new('RGBA', foreground.size, '#101b2a')
    pixels = np.asarray(Image.alpha_composite(sky, foreground).convert('RGB'))
    sheet = Image.new('RGB', (1440, 1440), '#171c23')
    labels = ImageDraw.Draw(sheet)
    views = []
    directions = [('forward', 0, 0), ('right', 90, 0), ('rear', 180, 0),
                  ('left', 270, 0), ('zenith', 0, 90), ('nadir', 0, -90)]
    for index, (name, yaw, pitch) in enumerate(directions):
        result = projection.perspective(pixels, math.radians(yaw), math.radians(pitch), 1080, 675, 75)
        target = directory / f'{source.stem}-{name}.png'
        result.save(target)
        origin = ((index % 2) * 720, (index // 2) * 480)
        sheet.paste(result.resize((720, 450), Image.Resampling.LANCZOS), (origin[0], origin[1] + 30))
        labels.text((origin[0] + 12, origin[1] + 8), name.upper(), fill='white')
        views.append({'view': name, 'path': target.name, 'yaw': yaw, 'pitch': pitch, 'vertical_fov': 75})
    sheet.save(directory / f'{source.stem}-six-directions.jpg', quality=93)
    for name, yaw, pitch, fov in DETAILS[options.scene]:
        result = projection.perspective(pixels, math.radians(yaw), math.radians(pitch), 1440, 1000, fov)
        target = directory / f'{source.stem}-detail-{name}.png'
        result.save(target)
        views.append({'view': name, 'path': target.name, 'yaw': yaw, 'pitch': pitch, 'vertical_fov': fov})
    with source.open('rb') as stream:
        source_digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    report = {'scene': options.scene, 'source': str(source),
              'source_sha256': source_digest,
              'dimensions': [foreground.width, foreground.height], 'views': views,
              'sky_source': str(Path(options.sky).resolve()) if options.sky else None,
              'sky_placeholder': options.sky is None, 'visual_approval': False,
              'installation_performed': False}
    if options.sky:
        with Path(options.sky).open('rb') as stream:
            report['sky_sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    target = directory / f'{source.stem}-evidence.json'
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(target)


if __name__ == '__main__':
    main()
