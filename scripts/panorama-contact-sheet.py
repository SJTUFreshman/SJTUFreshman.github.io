#!/usr/bin/env python3
"""Reproject an equirectangular review image into rectilinear QA views."""
import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def perspective(source, yaw, pitch, width=640, height=400, fov=85):
    horizontal, vertical = np.meshgrid(
        (np.arange(width) + 0.5) / width * 2 - 1,
        1 - (np.arange(height) + 0.5) / height * 2,
    )
    tangent = math.tan(math.radians(fov) / 2)
    forward = np.array([math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch)])
    right = np.array([math.cos(yaw), 0, -math.sin(yaw)])
    up = np.cross(forward, right)
    ray = forward + horizontal[..., None] * tangent * width / height * right + vertical[..., None] * tangent * up
    ray /= np.linalg.norm(ray, axis=-1, keepdims=True)
    longitude = (np.arctan2(ray[..., 0], ray[..., 2]) / math.tau + 0.5) % 1
    latitude = 0.5 - np.arcsin(np.clip(ray[..., 1], -1, 1)) / math.pi
    columns = np.minimum((longitude * source.shape[1]).astype(int), source.shape[1] - 1)
    rows = np.minimum((latitude * source.shape[0]).astype(int), source.shape[0] - 1)
    return Image.fromarray(source[rows, columns])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('output')
    parser.add_argument('--sky')
    options = parser.parse_args()
    source = Image.open(options.source).convert('RGBA')
    if options.sky:
        background = Image.open(options.sky).convert('RGBA').resize(source.size)
    else:
        background = Image.new('RGBA', source.size, '#101b2a')
    pixels = np.asarray(Image.alpha_composite(background, source).convert('RGB'))
    sheet = Image.new('RGB', (1280, 1290), '#171c23')
    draw = ImageDraw.Draw(sheet)
    for index, (label, yaw, pitch) in enumerate([
        ('FORWARD', 0, 0), ('RIGHT', 90, 0), ('REAR', 180, 0),
        ('LEFT', 270, 0), ('ZENITH', 0, 90), ('NADIR', 0, -90),
    ]):
        origin = ((index % 2) * 640, (index // 2) * 430)
        sheet.paste(perspective(pixels, math.radians(yaw), math.radians(pitch)), (origin[0], origin[1] + 30))
        draw.text((origin[0] + 12, origin[1] + 9), label, fill='white')
    Path(options.output).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(options.output)


if __name__ == '__main__':
    main()
