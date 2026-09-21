#!/usr/bin/env python3
"""Prepare an offline, metrically scaled Jungfraujoch DSM and aerial RGB prototype."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request

import numpy as np
from PIL import Image, ImageDraw
import rasterio
from rasterio.enums import Resampling
from rasterio.merge import merge


API = 'https://data.geo.admin.ch/api/stac/v0.9/collections/'
BOUNDS = (2640000, 1154000, 2643000, 1157000)
YEARS = {
    '2640-1154': (2021, 2023), '2640-1155': (2022, 2024),
    '2640-1156': (2022, 2024), '2641-1154': (2021, 2023),
    '2641-1155': (2022, 2023), '2641-1156': (2022, 2024),
    '2642-1154': (2021, 2023), '2642-1155': (2022, 2023),
    '2642-1156': (2022, 2024),
}
ATTRIBUTION = 'Source: Federal Office of Topography swisstopo'
LICENSE_URL = 'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def download_sources(directory):
    specifications = []
    for tile, years in YEARS.items():
        for kind, collection, year, suffix in [
            ('dsm', 'ch.swisstopo.swisssurface3d-raster', years[0], '0.5_2056_5728.tif'),
            ('rgb', 'ch.swisstopo.swissimage-dop10', years[1], '0.1_2056.tif'),
        ]:
            product = collection.removeprefix('ch.swisstopo.')
            item = f'{product}_{year}_{tile}'
            specifications.append((kind, collection, item, f'{item}_{suffix}', tile, year))

    def fetch(specification):
        kind, collection, item, filename, tile, year = specification
        item_path = directory / f'{item}.json'
        if item_path.exists():
            metadata = json.loads(item_path.read_text(encoding='utf-8'))
        else:
            with urllib.request.urlopen(f'{API}{collection}/items/{item}', timeout=60) as response:
                metadata = json.load(response)
            write_json(item_path, metadata)
        asset = metadata['assets'][filename]
        multihash = asset['checksum:multihash']
        if not multihash.lower().startswith('1220') or len(multihash) != 68:
            raise ValueError(f'Unsupported checksum: {filename}')
        expected = multihash[4:].lower()
        target = directory / filename
        if not target.exists():
            partial = target.with_suffix('.tif.part')
            with urllib.request.urlopen(asset['href'], timeout=120) as response, partial.open('wb') as stream:
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
            if digest(partial) != expected:
                raise ValueError(f'Download checksum mismatch: {filename}')
            partial.replace(target)
        actual = digest(target)
        if actual != expected:
            raise ValueError(f'Existing source checksum mismatch: {filename}')
        with rasterio.open(target) as source:
            raster = {'crs': source.crs.to_string(), 'bounds': list(source.bounds),
                      'resolution_m': list(source.res), 'dimensions': [source.width, source.height],
                      'band_count': source.count, 'nodata': source.nodata,
                      'dtype': list(source.dtypes)}
            if source.crs.to_epsg() != 2056:
                raise ValueError(f'Unexpected horizontal CRS: {filename}')
        print(f'Verified {filename}: {target.stat().st_size} bytes', flush=True)
        return {'kind': kind, 'tile': tile, 'year': year, 'filename': filename,
                'url': asset['href'], 'item_url': f'{API}{collection}/items/{item}',
                'sha256': actual, 'bytes': target.stat().st_size, 'raster': raster}

    with ThreadPoolExecutor(max_workers=4) as executor:
        assets = list(executor.map(fetch, specifications))
    report = {'region': 'Jungfraujoch / Jungfrau / Mönch', 'bounds_lv95_m': list(BOUNDS),
              'horizontal_crs': 'EPSG:2056', 'vertical_crs': 'EPSG:5728 (LN02)',
              'attribution': ATTRIBUTION, 'license_url': LICENSE_URL,
              'license': 'swisstopo OGD terms; attribution required; not CC0',
              'source_bytes': sum(asset['bytes'] for asset in assets), 'assets': assets}
    write_json(directory / 'sources.json', report)
    return report


def make_axis(start, stop, observer, near_radius, middle_step, near_step):
    breaks = sorted({float(start), float(stop),
                     *[float(value) for value in range(start + 1000, stop, 1000)],
                     max(start, observer - near_radius), min(stop, observer + near_radius)})
    chunks = []
    for lower, upper in zip(breaks[:-1], breaks[1:]):
        midpoint = (lower + upper) * 0.5
        step = near_step if abs(midpoint - observer) <= near_radius else middle_step
        count = int(np.ceil((upper - lower) / step))
        chunks.append(np.linspace(lower, upper, count + 1)[:-1])
    return np.concatenate([*chunks, np.array([float(stop)])])


def bilinear_samples(heights, transform, east, north):
    columns = np.clip((east - transform.c) / transform.a - 0.5, 0, heights.shape[1] - 1)
    rows = np.clip((north - transform.f) / transform.e - 0.5, 0, heights.shape[0] - 1)
    column_base = np.floor(columns).astype(np.int32)
    row_base = np.floor(rows).astype(np.int32)
    next_column = np.minimum(column_base + 1, heights.shape[1] - 1)
    next_row = np.minimum(row_base + 1, heights.shape[0] - 1)
    fraction_column = columns - column_base
    fraction_row = rows - row_base
    upper = heights[row_base, column_base] * (1 - fraction_column) + heights[row_base, next_column] * fraction_column
    lower = heights[next_row, column_base] * (1 - fraction_column) + heights[next_row, next_column] * fraction_column
    return upper * (1 - fraction_row) + lower * fraction_row


def prepare_geometry(directory, sources, options):
    output = directory / options.variant
    if output == directory or output.parent != directory:
        raise ValueError('Variant must be a single directory name')
    output.mkdir(parents=True, exist_ok=True)
    raster_sources = []
    try:
        for asset in sources['assets']:
            if asset['kind'] == 'dsm':
                raster_sources.append(rasterio.open(directory / asset['filename']))
        merged, transform = merge(raster_sources, bounds=BOUNDS, res=0.5, nodata=-9999)
    finally:
        for source in raster_sources:
            source.close()
    heights = merged[0]
    invalid = ~np.isfinite(heights) | (heights == -9999)
    if np.any(invalid):
        raise ValueError(f'DSM contains {np.count_nonzero(invalid)} invalid samples; no infill is permitted')
    west, south, east, north = BOUNDS
    origin = np.array([options.camera_east, options.camera_north,
                       float(bilinear_samples(heights, transform, options.camera_east, options.camera_north))])
    east_axis = make_axis(west, east, origin[0], options.near_radius, options.outer_step, options.near_step)
    north_axis = make_axis(south, north, origin[1], options.near_radius, options.outer_step, options.near_step)
    sampled = bilinear_samples(heights, transform, east_axis[None, :], north_axis[:, None])
    gradient_north, gradient_east = np.gradient(sampled, north_axis, east_axis)
    normals = np.stack([-gradient_east, -gradient_north, np.ones_like(sampled)], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    overview = Image.new('RGB', (1536, 1536))
    material_lines = []
    texture_files = []
    for asset in sources['assets']:
        if asset['kind'] != 'rgb':
            continue
        tile = asset['tile']
        with rasterio.open(directory / asset['filename']) as raster:
            pixels = raster.read([1, 2, 3], out_shape=(3, options.texture_size, options.texture_size),
                                 resampling=Resampling.average)
        texture = Image.fromarray(np.moveaxis(pixels, 0, -1))
        texture_path = output / f'rgb-{tile}.png'
        texture.save(texture_path)
        texture_files.append({'path': texture_path.name, 'sha256': digest(texture_path),
                              'pixel_size_m': 1000 / options.texture_size, 'year': asset['year']})
        tile_east, tile_north = map(int, tile.split('-'))
        thumbnail = texture.resize((512, 512), Image.Resampling.LANCZOS)
        overview.paste(thumbnail, ((tile_east - 2640) * 512, (1156 - tile_north) * 512))
        material_lines.extend([f'newmtl surveyed-{tile}', 'Ka 0 0 0', 'Kd 1 1 1',
                               'Ks 0 0 0', 'Ns 1', 'd 1', 'illum 2', f'map_Kd {texture_path.name}', ''])
    (output / 'terrain.mtl').write_text('\n'.join(material_lines), encoding='utf-8')
    camera_pixel = ((origin[0] - west) / (east - west) * 1536,
                    (north - origin[1]) / (north - south) * 1536)
    labels = ImageDraw.Draw(overview)
    labels.ellipse((camera_pixel[0] - 8, camera_pixel[1] - 8, camera_pixel[0] + 8, camera_pixel[1] + 8), outline='red', width=3)
    labels.text((camera_pixel[0] + 12, camera_pixel[1]), 'camera', fill='red')
    overview.save(output / 'aerial-overview.jpg', quality=95)
    vertices_written = 0
    triangles_written = 0
    mesh_tiles = []
    mesh_path = output / 'terrain.obj'
    with mesh_path.open('w', encoding='ascii', newline='\n') as stream:
        stream.write('mtllib terrain.mtl\n')
        for tile in sorted(YEARS):
            tile_east, tile_north = (int(value) * 1000 for value in tile.split('-'))
            columns = np.flatnonzero((east_axis >= tile_east) & (east_axis <= tile_east + 1000))
            rows = np.flatnonzero((north_axis >= tile_north) & (north_axis <= tile_north + 1000))
            stream.write(f'o surveyed-{tile}\n')
            for row in rows:
                stream.writelines(f'v {east_axis[column] - origin[0]:.5f} {north_axis[row] - origin[1]:.5f} {sampled[row, column] - origin[2]:.5f}\n' for column in columns)
            for row in rows:
                stream.writelines(f'vt {(east_axis[column] - tile_east) / 1000:.9f} {(north_axis[row] - tile_north) / 1000:.9f}\n' for column in columns)
            for row in rows:
                stream.writelines(f'vn {normals[row, column, 0]:.9f} {normals[row, column, 1]:.9f} {normals[row, column, 2]:.9f}\n' for column in columns)
            stream.write(f'usemtl surveyed-{tile}\ns 1\n')
            width = len(columns)
            for row_index in range(len(rows) - 1):
                lines = []
                for column_index in range(width - 1):
                    lower_left = vertices_written + row_index * width + column_index + 1
                    lower_right = lower_left + 1
                    upper_left = lower_left + width
                    upper_right = upper_left + 1
                    lines.append(f'f {lower_left}/{lower_left}/{lower_left} {lower_right}/{lower_right}/{lower_right} {upper_right}/{upper_right}/{upper_right}\n')
                    lines.append(f'f {lower_left}/{lower_left}/{lower_left} {upper_right}/{upper_right}/{upper_right} {upper_left}/{upper_left}/{upper_left}\n')
                stream.writelines(lines)
            vertex_count = len(rows) * width
            triangle_count = (len(rows) - 1) * (width - 1) * 2
            vertices_written += vertex_count
            triangles_written += triangle_count
            mesh_tiles.append({'tile': tile, 'vertices': vertex_count, 'triangles': triangle_count})
            print(f'Exported {tile}: {vertex_count} vertices, {triangle_count} triangles', flush=True)
    slope_samples = np.array([
        bilinear_samples(heights, transform, origin[0] - 1, origin[1]),
        bilinear_samples(heights, transform, origin[0] + 1, origin[1]),
        bilinear_samples(heights, transform, origin[0], origin[1] - 1),
        bilinear_samples(heights, transform, origin[0], origin[1] + 1),
    ])
    slope = np.degrees(np.arctan(np.hypot((slope_samples[1] - slope_samples[0]) / 2,
                                        (slope_samples[3] - slope_samples[2]) / 2)))
    report = {'region': sources['region'], 'visual_approval': False, 'installed': False,
              'attribution': ATTRIBUTION, 'license_url': LICENSE_URL,
              'source_report': '../sources.json', 'source_bounds_lv95_m': list(BOUNDS),
              'source_grid_m': 0.5, 'source_nodata_samples': int(np.count_nonzero(invalid)),
              'source_elevation_range_ln02_m': [float(heights.min()), float(heights.max())],
              'axis_order': 'OBJ X=east, Y=north, Z=up; one unit=one metre',
              'origin_lv95_ln02_m': origin.tolist(), 'camera_local_m': [0, 0, options.eye_height],
              'camera_ground_slope_degrees': float(slope),
              'camera_needs_visual_review': True, 'mesh': mesh_path.name,
              'mesh_sha256': digest(mesh_path), 'vertex_count': vertices_written,
              'triangle_count': triangles_written, 'mesh_tiles': mesh_tiles,
              'grid': {'type': 'shared Cartesian axes; 0.5m central square and 2m exterior by default',
                       'near_radius_m': options.near_radius, 'near_step_m': options.near_step,
                       'outer_step_m': options.outer_step, 'east_samples': len(east_axis),
                       'north_samples': len(north_axis), 'tile_boundary_vertices': 'identical positions and normals',
                       'source_sampling': 'bilinear, without procedural noise, smoothing, or height scaling',
                       'boundary_sampling': 'outermost 0.25m clamps to the closest measured pixel centre'},
              'textures': texture_files, 'texture_native_capture_note': 'Alpine aerial capture is 25cm; original output raster is 10cm',
              'texture_lighting_note': 'Real orthophoto RGB includes acquisition shadows; it is not de-lit PBR albedo',
              'limitations': ['Finite 3km terrain requires distant terrain before panorama acceptance',
                              'DSM is a height field and cannot represent overhangs',
                              'DSM 2021/2022 and RGB 2023/2024 differ in acquisition time',
                              'Aerial imagery resolution cannot resolve centimetre-scale ground contact'],
              'rendered': False}
    write_json(output / 'prototype.json', report)
    print(json.dumps({'output': str(output), 'vertices': vertices_written, 'triangles': triangles_written,
                      'camera_elevation_m': origin[2], 'camera_slope_degrees': float(slope)}, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.render-work/public-models/swisstopo'))
    parser.add_argument('--download-only', action='store_true')
    parser.add_argument('--skip-download', action='store_true')
    parser.add_argument('--variant', default='jungfrau-r1')
    parser.add_argument('--camera-east', type=float, default=2641350)
    parser.add_argument('--camera-north', type=float, default=1155300)
    parser.add_argument('--eye-height', type=float, default=1.7)
    parser.add_argument('--near-radius', type=float, default=100)
    parser.add_argument('--near-step', type=float, default=0.5)
    parser.add_argument('--outer-step', type=float, default=2)
    parser.add_argument('--texture-size', type=int, default=4096)
    options = parser.parse_args()
    if not (BOUNDS[0] < options.camera_east < BOUNDS[2] and BOUNDS[1] < options.camera_north < BOUNDS[3]):
        parser.error('Camera must be inside the surveyed region')
    if min(options.near_radius, options.near_step, options.outer_step, options.texture_size) <= 0:
        parser.error('Resolutions and near radius must be positive')
    directory = options.directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    if options.skip_download:
        sources = json.loads((directory / 'sources.json').read_text(encoding='utf-8'))
        for asset in sources['assets']:
            if digest(directory / asset['filename']) != asset['sha256']:
                raise ValueError(f"Source integrity changed: {asset['filename']}")
    else:
        sources = download_sources(directory)
    if not options.download_only:
        prepare_geometry(directory, sources, options)


if __name__ == '__main__':
    main()
