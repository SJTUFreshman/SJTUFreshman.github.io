"""Stitch six calibrated UE perspective RGBA PNGs into a site-oriented panorama.

Requires numpy and opencv-python. Input PNGs must be square RGBA8/RGBA16,
with explicit per-face colorSpace (srgb/linear) and alphaMode
(straight/premultiplied/premultiplied-linear). Premultiplied inputs mean RGB
was multiplied by alpha in the declared color space; premultiplied-linear
means multiplication occurred before any sRGB encoding. Output is straight RGBA, with RGB=0 at
zero alpha. Filtering always occurs in linear-light premultiplied space.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import tempfile
import zlib

import cv2
import numpy as np


PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'


def vector(value, name):
    if (not isinstance(value, list) or len(value) != 3 or
            any(isinstance(v, bool) or not isinstance(v, (int, float)) or
                not math.isfinite(v) for v in value)):
        raise ValueError(f'{name} must be three finite numbers')
    return np.array(value, dtype=np.float64)


def png_header(path):
    with path.open('rb') as source:
        header = source.read(33)
    if len(header) != 33 or header[:8] != PNG_SIGNATURE or header[12:16] != b'IHDR':
        raise ValueError(f'{path}: expected PNG input')
    width, height, depth, kind, compression, filtering, interlace = struct.unpack('>IIBBBBB', header[16:29])
    if zlib.crc32(header[12:29]) & 0xffffffff != struct.unpack('>I', header[29:33])[0]:
        raise ValueError(f'{path}: invalid PNG header checksum')
    if kind != 6 or depth not in (8, 16) or compression or filtering or interlace not in (0, 1):
        raise ValueError(f'{path}: require true RGBA8 or RGBA16 PNG, not RGB/palette/grayscale')
    if width != height or width < 2:
        raise ValueError(f'{path}: cube faces must be square and at least 2 pixels wide')
    return width, depth


def load_config(path):
    config = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(config, dict):
        raise ValueError('config must be an object')
    if config.get('coordinateSystem') != 'unreal-centimeters':
        raise ValueError('coordinateSystem must be unreal-centimeters')
    if not isinstance(config.get('faces'), list) or len(config['faces']) != 6:
        raise ValueError('exactly six calibrated faces are required')
    faces = []
    names = set()
    for index, value in enumerate(config['faces']):
        if not isinstance(value, dict):
            raise ValueError(f'face {index} must be an object')
        name = value.get('name')
        if not isinstance(name, str) or not name or name in names:
            raise ValueError('face names must be nonempty and unique')
        names.add(name)
        origin = vector(value.get('origin'), name + '.origin')
        axes = np.stack([vector(value.get(key), name + '.' + key) for key in ('forward', 'right', 'up')])
        if not np.allclose(axes @ axes.T, np.eye(3), atol=1e-5, rtol=0):
            raise ValueError(f'{name}: forward/right/up must be orthonormal unit directions')
        if not np.allclose(np.cross(axes[0], axes[1]), axes[2], atol=1e-5, rtol=0):
            raise ValueError(f'{name}: UE camera basis requires forward cross right = up')
        if any(isinstance(value.get(key), bool) or not isinstance(value.get(key), (float, int)) or not math.isfinite(value[key]) or
               abs(value[key] - 90) > 1e-6 for key in ('horizontalFovDegrees', 'verticalFovDegrees')):
            raise ValueError(f'{name}: horizontal and vertical FOV must both be exactly 90 degrees')
        if value.get('colorSpace') not in ('srgb', 'linear'):
            raise ValueError(f'{name}: colorSpace must explicitly be srgb or linear')
        if value.get('alphaMode') not in ('straight', 'premultiplied', 'premultiplied-linear'):
            raise ValueError(f'{name}: alphaMode must explicitly be straight, premultiplied or premultiplied-linear')
        image = value.get('image')
        if not isinstance(image, str) or not image:
            raise ValueError(f'{name}: image path is required')
        image_path = (path.parent / image).resolve()
        size, bits = png_header(image_path)
        faces.append(dict(name=name, origin=origin, axes=axes, path=image_path, size=size,
                          bits=bits, color_space=value['colorSpace'], alpha_mode=value['alphaMode']))
    for face in faces[1:]:
        if np.linalg.norm(face['origin'] - faces[0]['origin']) > .001:
            raise ValueError('all six camera origins must agree within 0.001 UE centimeters; parallax cannot be stitched')
    forwards = np.stack([face['axes'][0] for face in faces])
    for index, dots in enumerate(forwards @ forwards.T):
        if (np.count_nonzero(np.isclose(dots, 1, atol=1e-5, rtol=0)) != 1 or
                np.count_nonzero(np.isclose(dots, -1, atol=1e-5, rtol=0)) != 1 or
                np.count_nonzero(np.isclose(dots, 0, atol=1e-5, rtol=0)) != 4):
            raise ValueError(f'{faces[index]["name"]}: forward vectors must cover three perpendicular opposite pairs')
        for edge_axis in faces[index]['axes'][1:]:
            if not np.any(np.isclose(forwards @ edge_axis, 1, atol=1e-5, rtol=0)):
                raise ValueError(f'{faces[index]["name"]}: right/up must align with cube axes; independently rolled faces leave gaps')
    return faces


def stage_faces(faces, directory):
    for index, face in enumerate(faces):
        source = cv2.imread(str(face['path']), cv2.IMREAD_UNCHANGED)
        expected_dtype = np.uint8 if face['bits'] == 8 else np.uint16
        if source is None or source.dtype != expected_dtype or source.shape != (face['size'], face['size'], 4):
            raise ValueError(f'{face["path"]}: decoder did not preserve declared RGBA depth and dimensions')
        cached = np.lib.format.open_memmap(Path(directory) / f'face-{index}.npy', mode='w+',
                                          dtype=source.dtype, shape=source.shape)
        for first in range(0, face['size'], 32):
            cached[first:first + 32] = source[first:first + 32, :, [2, 1, 0, 3]]
        cached.flush()
        del source, cached
        face['pixels'] = np.load(Path(directory) / f'face-{index}.npy', mmap_mode='r')


def decode_srgb(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)


def encode_srgb(rgb):
    return np.where(rgb <= .0031308, rgb * 12.92, 1.055 * np.maximum(rgb, 0) ** (1 / 2.4) - .055)


def linear_premultiplied(samples, face):
    values = samples.astype(np.float32) / ((1 << face['bits']) - 1)
    alpha = values[:, 3:4]
    rgb = values[:, :3]
    if face['alpha_mode'] == 'premultiplied':
        if np.any(rgb > alpha + 1 / ((1 << face['bits']) - 1)):
            raise ValueError('premultiplied PNG RGB exceeds alpha; check the declared alpha/color convention')
        rgb = np.divide(rgb, alpha, out=np.zeros_like(rgb), where=alpha > 0)
        rgb = np.clip(rgb, 0, 1)
    if face['color_space'] == 'srgb':
        rgb = decode_srgb(rgb)
    if face['alpha_mode'] == 'premultiplied-linear':
        if np.any(rgb > alpha + 4 / ((1 << face['bits']) - 1)):
            raise ValueError('linear-premultiplied PNG RGB exceeds alpha; check the declared alpha/color convention')
        values[:, :3] = np.where(alpha > 0, np.minimum(rgb, alpha), 0)
    else:
        values[:, :3] = rgb * alpha
    return values


def sample_face(face, horizontal, vertical):
    size = face['size']
    x = np.clip((horizontal + 1) * (size / 2) - .5, 0, size - 1)
    y = np.clip((1 - vertical) * (size / 2) - .5, 0, size - 1)
    left, top = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64)
    right, bottom = np.minimum(left + 1, size - 1), np.minimum(top + 1, size - 1)
    dx, dy = (x - left).astype(np.float32), (y - top).astype(np.float32)
    result = np.zeros((len(x), 4), dtype=np.float32)
    for rows, columns, weights in (
            (top, left, (1 - dx) * (1 - dy)), (top, right, dx * (1 - dy)),
            (bottom, left, (1 - dx) * dy), (bottom, right, dx * dy)):
        result += linear_premultiplied(face['pixels'][rows, columns], face) * weights[:, None]
    return result


def render_rows(faces, width, height, first, last, output_space, bits):
    longitude = ((np.arange(width, dtype=np.float64) + .5) / width - .5) * (2 * np.pi)
    latitude = (.5 - (np.arange(first, last, dtype=np.float64) + .5) / height) * np.pi
    rays = np.empty((last - first, width, 3), dtype=np.float64)
    rays[:, :, 0] = np.cos(latitude[:, None]) * np.sin(longitude)
    rays[:, :, 1] = -np.cos(latitude[:, None]) * np.cos(longitude)
    rays[:, :, 2] = np.sin(latitude[:, None])
    rays = rays.reshape(-1, 3)
    best = np.full(len(rays), -np.inf)
    selected = np.zeros(len(rays), dtype=np.uint8)
    for index, face in enumerate(faces):
        depth = rays @ face['axes'][0]
        chosen = depth > best
        selected[chosen] = index
        best[chosen] = depth[chosen]
    rgba = np.zeros((len(rays), 4), dtype=np.float32)
    for index, face in enumerate(faces):
        positions = np.flatnonzero(selected == index)
        if not len(positions):
            continue
        face_rays = rays[positions]
        depth = best[positions]
        horizontal = (face_rays @ face['axes'][1]) / depth
        vertical = (face_rays @ face['axes'][2]) / depth
        if np.any(np.abs(horizontal) > 1.00002) or np.any(np.abs(vertical) > 1.00002):
            raise ValueError('camera coverage has a gap; cannot extrapolate outside a face')
        rgba[positions] = sample_face(face, horizontal, vertical)
    rgba[:, :3] = np.divide(rgba[:, :3], rgba[:, 3:4], out=np.zeros_like(rgba[:, :3]), where=rgba[:, 3:4] > 0)
    if output_space == 'srgb':
        rgba[:, :3] = encode_srgb(rgba[:, :3])
    dtype = np.uint8 if bits == 8 else np.uint16
    return np.rint(np.clip(rgba, 0, 1) * ((1 << bits) - 1)).astype(dtype).reshape(last - first, width, 4)


class PngWriter:
    def __init__(self, destination, width, height, bits, color_space):
        self.file = destination.open('wb')
        self.file.write(PNG_SIGNATURE)
        self.chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, bits, 6, 0, 0, 0))
        if color_space == 'srgb':
            self.chunk(b'sRGB', b'\x00')
            self.chunk(b'gAMA', struct.pack('>I', 45455))
        else:
            self.chunk(b'gAMA', struct.pack('>I', 100000))
        self.compressor = zlib.compressobj(6)
        self.bits = bits
        self.width = width
        self.height = height
        self.rows = 0

    def chunk(self, kind, data):
        self.file.write(struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff))

    def write(self, block):
        for row in block:
            encoded = row.astype('>u2', copy=False).tobytes() if self.bits == 16 else row.tobytes()
            data = self.compressor.compress(b'\x00' + encoded)
            if data:
                self.chunk(b'IDAT', data)
            self.rows += 1

    def finish(self):
        if self.rows != self.height:
            raise ValueError(f'PNG has {self.rows} rows, expected {self.height}')
        self.chunk(b'IDAT', self.compressor.flush())
        self.chunk(b'IEND', b'')
        self.file.close()


def stitch(config_path, output, width, block_rows=16, bits=None, output_space='srgb', allow_precision_loss=False, cache_dir=None):
    if output.suffix.lower() != '.png':
        raise ValueError('this tool outputs PNG only; EXR requires a separate explicit float pipeline and is not silently converted')
    if isinstance(width, bool) or not isinstance(width, int) or width < 4 or width % 2:
        raise ValueError('width must be an even integer >= 4 for an exact 2:1 panorama')
    if isinstance(block_rows, bool) or not isinstance(block_rows, int) or block_rows < 1 or output_space not in ('srgb', 'linear'):
        raise ValueError('block rows must be positive and output color space srgb or linear')
    faces = load_config(config_path)
    highest_bits = max(face['bits'] for face in faces)
    bits = highest_bits if bits is None else bits
    if bits not in (8, 16):
        raise ValueError('PNG output bits must be 8 or 16')
    if bits < highest_bits and not allow_precision_loss:
        raise ValueError('16-bit input cannot become 8-bit output without --allow-precision-loss')
    resolved_output = output.resolve()
    if resolved_output == config_path.resolve() or any(resolved_output == face['path'] for face in faces):
        raise ValueError('output must not overwrite a source face or its config')
    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=output.stem + '-', suffix='.png.tmp', dir=output.parent)
    os.close(handle)
    writer = None
    alpha_min, alpha_max = (1 << bits) - 1, 0
    transparent_pixels = opaque_pixels = 0
    try:
        with tempfile.TemporaryDirectory(prefix='unreal-panorama-', dir=cache_dir) as staging:
            try:
                stage_faces(faces, staging)
                writer = PngWriter(Path(temporary), width, width // 2, bits, output_space)
                for first in range(0, width // 2, block_rows):
                    block = render_rows(faces, width, width // 2, first, min(first + block_rows, width // 2), output_space, bits)
                    alpha = block[:, :, 3]
                    alpha_min = min(alpha_min, int(alpha.min()))
                    alpha_max = max(alpha_max, int(alpha.max()))
                    transparent_pixels += int(np.count_nonzero(alpha == 0))
                    opaque_pixels += int(np.count_nonzero(alpha == (1 << bits) - 1))
                    writer.write(block)
                writer.finish()
            finally:
                for face in faces:
                    pixels = face.pop('pixels', None)
                    if pixels is not None:
                        pixels._mmap.close()
        os.replace(temporary, output)
    finally:
        if writer is not None and not writer.file.closed:
            writer.file.close()
        if Path(temporary).exists():
            Path(temporary).unlink()
    origin = faces[0]['origin']
    report = {
        'output': str(output.resolve()), 'width': width, 'height': width // 2,
        'bitsPerChannel': bits, 'colorSpace': output_space, 'alphaMode': 'straight',
        'inputBitsPerChannel': [face['bits'] for face in faces],
        'precisionLossExplicitlyAllowed': bits < highest_bits,
        'filter': 'nearest-facing cube face; clamped bilinear in linear-light premultiplied RGBA; no cross-face blending',
        'pixelCoordinates': 'top-origin pixel centers',
        'ueToThree': '(X,Z,Y)*0.01', 'threeToNavigation': '(X,Y,-Z)',
        'centerDirectionUE': [0, -1, 0], 'rightQuarterDirectionUE': [1, 0, 0], 'northPoleDirectionUE': [0, 0, 1],
        'originUECentimeters': origin.tolist(), 'originThreeMeters': (origin[[0, 2, 1]] * .01).tolist(),
        'alpha': {'min': alpha_min, 'max': alpha_max, 'transparentPixels': transparent_pixels, 'opaquePixels': opaque_pixels},
        'memoryStrategy': 'one decoded integer face while staging; six disk memmaps; output computed in row blocks and streamed as PNG',
        'blockRows': block_rows, 'sourceConfigSha256': hashlib.sha256(config_path.read_bytes()).hexdigest(),
        'faces': [{'name': f['name'], 'image': str(f['path']), 'size': f['size'], 'bits': f['bits'],
                   'originUECentimeters': f['origin'].tolist(), 'forward': f['axes'][0].tolist(),
                   'right': f['axes'][1].tolist(), 'up': f['axes'][2].tolist(),
                   'colorSpace': f['color_space'], 'alphaMode': f['alpha_mode']} for f in faces]
    }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--width', type=int, required=True)
    parser.add_argument('--block-rows', type=int, default=16)
    parser.add_argument('--bits', type=int, choices=(8, 16))
    parser.add_argument('--output-color-space', choices=('srgb', 'linear'), default='srgb')
    parser.add_argument('--allow-precision-loss', action='store_true')
    parser.add_argument('--cache-dir', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    try:
        report = stitch(args.config, args.output, args.width, args.block_rows, args.bits,
                        args.output_color_space, args.allow_precision_loss, args.cache_dir)
    except (ValueError, OSError, KeyError, TypeError) as error:
        parser.exit(1, f'Error: {error}\n')
    report_path = args.report or args.output.with_suffix(args.output.suffix + '.json')
    report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': report['output'], 'report': str(report_path), 'bits': report['bitsPerChannel'], 'alpha': report['alpha']}))


if __name__ == '__main__':
    main()
