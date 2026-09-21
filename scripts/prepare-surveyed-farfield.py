#!/usr/bin/env python3
"""Build a finite surveyed terrain ring around the existing Jungfrau prototype."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import threading

import numpy as np
from PIL import Image
import rasterio
from rasterio.merge import merge
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


SPECIFICATION = importlib.util.spec_from_file_location('surveyed_mountain', Path(__file__).with_name('prepare-surveyed-mountain.py'))
MOUNTAIN = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(MOUNTAIN)
OUTER_BOUNDS = (2637000, 1151000, 2646000, 1160000)
QUERY_BBOX = '7.92071,46.50873,8.03887,46.59025'
EXPECTED_BYTES = 92006446
NETWORK = threading.local()


def session():
    if not hasattr(NETWORK, 'session'):
        NETWORK.session = requests.Session()
        retries = Retry(total=2, backoff_factor=0.5, status_forcelist=[429, 502, 503, 504])
        NETWORK.session.mount('https://', HTTPAdapter(max_retries=retries))
    return NETWORK.session


def ring_tile(tile):
    east, north = (int(value) * 1000 for value in tile.split('-'))
    inside_outer = OUTER_BOUNDS[0] <= east < OUTER_BOUNDS[2] and OUTER_BOUNDS[1] <= north < OUTER_BOUNDS[3]
    inside_core = MOUNTAIN.BOUNDS[0] <= east < MOUNTAIN.BOUNDS[2] and MOUNTAIN.BOUNDS[1] <= north < MOUNTAIN.BOUNDS[3]
    return inside_outer and not inside_core


def discover(directory):
    target = directory / 'source-selection.json'
    if target.exists():
        return json.loads(target.read_text(encoding='utf-8'))
    assets = []
    for kind, collection, suffix in [('dtm', 'ch.swisstopo.swissalti3d', '_2_2056_5728.tif'),
                                     ('rgb', 'ch.swisstopo.swissimage-dop10', '_2_2056.tif')]:
        url = f'{MOUNTAIN.API}{collection}/items?bbox={QUERY_BBOX}&limit=100'
        selected = {}
        page = 0
        while url:
            cache = directory / f'{kind}-stac-page-{page:02}.json'
            if cache.exists():
                data = json.loads(cache.read_text(encoding='utf-8'))
            else:
                response = session().get(url, timeout=45)
                response.raise_for_status()
                data = response.json()
                MOUNTAIN.write_json(cache, data)
            for feature in data['features']:
                for filename, asset in feature['assets'].items():
                    if not filename.endswith(suffix):
                        continue
                    tile = filename.split('_')[2]
                    if not ring_tile(tile):
                        continue
                    if tile not in selected or filename > selected[tile]['filename']:
                        selected[tile] = {'kind': kind, 'filename': filename, 'tile': tile,
                                          'year': int(filename.split('_')[1]), 'url': asset['href'],
                                          'sha256': asset['checksum:multihash'][4:].lower()}
            url = next((link['href'] for link in data['links'] if link['rel'] == 'next'), None)
            page += 1
            if page > 20:
                raise ValueError('Unexpected STAC pagination length')
        if len(selected) != 72:
            raise ValueError(f'Expected 72 {kind} tiles, found {len(selected)}')
        assets.extend(selected.values())
        print(f'Discovered {len(selected)} {kind} assets', flush=True)
    report = {'bounds_lv95_m': list(OUTER_BOUNDS), 'excluded_core_bounds_lv95_m': list(MOUNTAIN.BOUNDS),
              'horizontal_crs': 'EPSG:2056', 'vertical_crs': 'EPSG:5728',
              'attribution': MOUNTAIN.ATTRIBUTION, 'license_url': MOUNTAIN.LICENSE_URL,
              'expected_bytes_from_head': EXPECTED_BYTES, 'assets': assets}
    MOUNTAIN.write_json(target, report)
    return report


def download(directory, selection):
    def fetch(asset):
        target = directory / asset['filename']
        if not target.exists():
            partial = target.with_suffix('.tif.part')
            response = session().get(asset['url'], timeout=60, stream=True)
            response.raise_for_status()
            with partial.open('wb') as stream:
                for chunk in response.iter_content(1024 * 1024):
                    stream.write(chunk)
            if MOUNTAIN.digest(partial) != asset['sha256']:
                raise ValueError(f'Hash mismatch: {asset["filename"]}')
            partial.replace(target)
        if MOUNTAIN.digest(target) != asset['sha256']:
            raise ValueError(f'Existing source hash mismatch: {target.name}')
        with rasterio.open(target) as source:
            if source.crs.to_epsg() != 2056 or source.res != (2, 2):
                raise ValueError(f'Unexpected raster coordinate system: {target.name}')
            asset['raster'] = {'bounds': list(source.bounds), 'nodata': source.nodata,
                               'dimensions': [source.width, source.height], 'resolution_m': list(source.res),
                               'band_count': source.count, 'dtype': list(source.dtypes)}
        asset['bytes'] = target.stat().st_size
        return asset

    with ThreadPoolExecutor(max_workers=3) as executor:
        assets = list(executor.map(fetch, selection['assets']))
    selection['assets'] = assets
    selection['downloaded_bytes'] = sum(asset['bytes'] for asset in assets)
    if selection['downloaded_bytes'] > 300_000_000:
        raise ValueError('Unexpected source size exceeds authorized 300 MB ceiling')
    MOUNTAIN.write_json(directory / 'sources.json', selection)
    print(f'Verified {len(assets)} sources, {selection["downloaded_bytes"]} bytes', flush=True)
    return selection


def merge_sources(paths, bounds, resolution):
    sources = [rasterio.open(path) for path in paths]
    try:
        pixels, transform = merge(sources, bounds=bounds, res=resolution, nodata=-9999)
    finally:
        for source in sources:
            source.close()
    return pixels[0], transform


def expanded_axis(core_axis, lower, upper, step):
    before = np.arange(lower, core_axis[0], step)
    after = np.arange(core_axis[-1] + step, upper, step)
    return np.unique(np.concatenate([before, core_axis, after, [upper]]))


def build(output, source_directory, sources, core_directory, options):
    core_report = json.loads((core_directory / 'prototype.json').read_text(encoding='utf-8'))
    core_sources = json.loads((core_directory.parent / 'sources.json').read_text(encoding='utf-8'))
    origin = np.array(core_report['origin_lv95_ln02_m'])
    core_grid = core_report['grid']
    west, south, east, north = MOUNTAIN.BOUNDS
    core_east = MOUNTAIN.make_axis(west, east, origin[0], core_grid['near_radius_m'], core_grid['outer_step_m'], core_grid['near_step_m'])
    core_north = MOUNTAIN.make_axis(south, north, origin[1], core_grid['near_radius_m'], core_grid['outer_step_m'], core_grid['near_step_m'])
    east_axis = expanded_axis(core_east, OUTER_BOUNDS[0], OUTER_BOUNDS[2], options.outer_step)
    north_axis = expanded_axis(core_north, OUTER_BOUNDS[1], OUTER_BOUNDS[3], options.outer_step)
    dem, dem_transform = merge_sources([source_directory / asset['filename'] for asset in sources['assets'] if asset['kind'] == 'dtm'], OUTER_BOUNDS, 2)
    core_dsm, core_transform = merge_sources([core_directory.parent / asset['filename'] for asset in core_sources['assets'] if asset['kind'] == 'dsm'], MOUNTAIN.BOUNDS, 0.5)
    valid_dem = np.isfinite(dem) & (dem != -9999)
    expected_samples = 72 * 500 * 500
    if np.count_nonzero(valid_dem) != expected_samples:
        raise ValueError('Unexpected missing data in the remote ring')

    def sample_dem(east_values, north_values):
        sample_east, sample_north = np.broadcast_arrays(east_values, north_values)
        sample_east = sample_east.copy()
        sample_north = sample_north.copy()
        near_north_interval = (sample_north >= south - 1) & (sample_north <= north + 1)
        near_east_interval = (sample_east >= west - 1) & (sample_east <= east + 1)
        sample_east = np.where(near_north_interval & (np.abs(sample_east - west) <= 1), west - 1.001, sample_east)
        sample_east = np.where(near_north_interval & (np.abs(sample_east - east) <= 1), east + 1.001, sample_east)
        sample_north = np.where(near_east_interval & (np.abs(sample_north - south) <= 1), south - 1.001, sample_north)
        sample_north = np.where(near_east_interval & (np.abs(sample_north - north) <= 1), north + 1.001, sample_north)
        return MOUNTAIN.bilinear_samples(dem, dem_transform, sample_east, sample_north)

    east_values, north_values = np.meshgrid(east_axis, north_axis)
    inside_core = (east_values >= west) & (east_values <= east) & (north_values >= south) & (north_values <= north)
    heights = np.empty_like(east_values)
    heights[inside_core] = MOUNTAIN.bilinear_samples(core_dsm, core_transform, east_values[inside_core], north_values[inside_core])
    outside = ~inside_core
    heights[outside] = sample_dem(east_values[outside], north_values[outside])
    boundary_east = np.clip(east_values, west, east)
    boundary_north = np.clip(north_values, south, north)
    distance = np.hypot(east_values - boundary_east, north_values - boundary_north)
    transition = outside & (distance < options.transition_width)
    core_edge = MOUNTAIN.bilinear_samples(core_dsm, core_transform, boundary_east[transition], boundary_north[transition])
    remote_edge = sample_dem(boundary_east[transition], boundary_north[transition])
    residual = core_edge - remote_edge
    progress = distance[transition] / options.transition_width
    weights = 1 - progress * progress * (3 - 2 * progress)
    heights[transition] += weights * residual
    if not np.all(np.isfinite(heights)) or np.min(heights) < -1000:
        raise ValueError('Invalid sampled height in farfield')
    gradient_north, gradient_east = np.gradient(heights, north_axis, east_axis)
    normals = np.stack([-gradient_east, -gradient_north, np.ones_like(heights)], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    core_rows = np.flatnonzero((north_axis >= south) & (north_axis <= north))
    core_columns = np.flatnonzero((east_axis >= west) & (east_axis <= east))
    core_heights = heights[np.ix_(core_rows, core_columns)]
    core_gradient_north, core_gradient_east = np.gradient(core_heights, core_north, core_east)
    core_normals = np.stack([-core_gradient_east, -core_gradient_north, np.ones_like(core_heights)], axis=-1)
    core_normals /= np.linalg.norm(core_normals, axis=-1, keepdims=True)
    normals[np.ix_(core_rows, core_columns)] = core_normals
    material_lines = []
    texture_report = []
    for asset in sources['assets']:
        if asset['kind'] != 'rgb':
            continue
        with rasterio.open(source_directory / asset['filename']) as raster:
            pixels = raster.read([1, 2, 3])
        target = output / f'rgb-{asset["tile"]}.png'
        Image.fromarray(np.moveaxis(pixels, 0, -1)).save(target)
        texture_report.append({'path': target.name, 'sha256': MOUNTAIN.digest(target), 'pixel_size_m': 2})
        material_lines.extend([f'newmtl surveyed-far-{asset["tile"]}', 'Ka 0 0 0', 'Kd 1 1 1', 'Ks 0 0 0', 'Ns 1', 'd 1', 'illum 2', f'map_Kd {target.name}', ''])
    (output / 'terrain.mtl').write_text('\n'.join(material_lines), encoding='utf-8')
    vertices = 0
    triangles = 0
    tiles = []
    mesh_path = output / 'terrain.obj'
    with mesh_path.open('w', encoding='ascii', newline='\n') as stream:
        stream.write('mtllib terrain.mtl\n')
        for tile in sorted({asset['tile'] for asset in sources['assets']}):
            tile_east, tile_north = (int(value) * 1000 for value in tile.split('-'))
            columns = np.flatnonzero((east_axis >= tile_east) & (east_axis <= tile_east + 1000))
            rows = np.flatnonzero((north_axis >= tile_north) & (north_axis <= tile_north + 1000))
            stream.write(f'o surveyed-far-{tile}\n')
            for row in rows:
                stream.writelines(f'v {east_axis[column] - origin[0]:.5f} {north_axis[row] - origin[1]:.5f} {heights[row, column] - origin[2]:.5f}\n' for column in columns)
            for row in rows:
                stream.writelines(f'vt {(east_axis[column] - tile_east) / 1000:.9f} {(north_axis[row] - tile_north) / 1000:.9f}\n' for column in columns)
            for row in rows:
                stream.writelines(f'vn {normals[row, column, 0]:.9f} {normals[row, column, 1]:.9f} {normals[row, column, 2]:.9f}\n' for column in columns)
            stream.write(f'usemtl surveyed-far-{tile}\ns 1\n')
            width = len(columns)
            for row_index in range(len(rows) - 1):
                lines = []
                for column_index in range(width - 1):
                    lower_left = vertices + row_index * width + column_index + 1
                    lower_right = lower_left + 1
                    upper_left = lower_left + width
                    upper_right = upper_left + 1
                    lines.append(f'f {lower_left}/{lower_left}/{lower_left} {lower_right}/{lower_right}/{lower_right} {upper_right}/{upper_right}/{upper_right}\n')
                    lines.append(f'f {lower_left}/{lower_left}/{lower_left} {upper_right}/{upper_right}/{upper_right} {upper_left}/{upper_left}/{upper_left}\n')
                stream.writelines(lines)
            count_vertices = len(rows) * width
            count_triangles = (len(rows) - 1) * (width - 1) * 2
            vertices += count_vertices
            triangles += count_triangles
            tiles.append({'tile': tile, 'vertices': count_vertices, 'triangles': count_triangles})
    report = {'visual_approval': False, 'installed': False, 'rendered': False,
              'attribution': MOUNTAIN.ATTRIBUTION, 'license_url': MOUNTAIN.LICENSE_URL,
              'source_report': 'sources/sources.json', 'source_bytes': sources['downloaded_bytes'],
              'bounds_lv95_m': list(OUTER_BOUNDS), 'excluded_core_bounds_lv95_m': list(MOUNTAIN.BOUNDS),
              'source_grid_m': 2, 'outer_grid_step_m': options.outer_step,
              'axis_order': 'X=east Y=north Z=up; one unit=one metre',
              'origin_lv95_ln02_m': origin.tolist(), 'camera_local_m': core_report['camera_local_m'],
              'core_mesh_sha256': core_report['mesh_sha256'], 'mesh': mesh_path.name,
              'mesh_sha256': MOUNTAIN.digest(mesh_path), 'vertex_count': vertices, 'triangle_count': triangles,
              'tiles': tiles, 'textures': texture_report, 'source_valid_dtm_samples': int(valid_dem.sum()),
              'source_dtm_elevation_range_ln02_m': [float(dem[valid_dem].min()), float(dem[valid_dem].max())],
              'seam': {'core_boundary_positions_and_normals': 'identical to unmodified core export',
                       'transition_width_m': options.transition_width,
                       'correction': 'DSM minus DTM boundary residual, smoothstep fade outward; no noise or extra layer',
                       'boundary_dtm_sampling': '1.001m outside the shared edge avoids missing interior DTM cells',
                       'residual_abs_max_m': float(np.max(np.abs(residual))),
                       'residual_abs_median_m': float(np.median(np.abs(residual))),
                       'applied_abs_max_m': float(np.max(np.abs(residual * weights)))},
              'limitations': ['9km finite extent does not yet prove full horizon coverage',
                              '2m aerial RGB contains baked acquisition shadows and cannot resolve cliff sidewalls',
                              'DTM/RGB/core DSM capture years differ; transition requires visual inspection',
                              'Distant valley terrain may need a larger real DEM ring'],
              'blender_import': {'forward_axis': 'Y', 'up_axis': 'Z', 'global_scale': 1,
                                 'texture_extension': 'EXTEND', 'texture_color_space': 'sRGB'}}
    MOUNTAIN.write_json(output / 'prototype.json', report)
    print(json.dumps({'output': str(output), 'vertices': vertices, 'triangles': triangles, 'seam': report['seam']}, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('.render-work/public-models/swisstopo/jungfrau-farfield-r1'))
    parser.add_argument('--core', type=Path, default=Path('.render-work/public-models/swisstopo/jungfrau-r1'))
    parser.add_argument('--outer-step', type=float, default=20)
    parser.add_argument('--transition-width', type=float, default=100)
    parser.add_argument('--download-only', action='store_true')
    parser.add_argument('--skip-download', action='store_true')
    options = parser.parse_args()
    if options.outer_step <= 0 or 1000 % options.outer_step != 0 or options.transition_width <= 0:
        parser.error('Outer step must divide 1000m and transition width must be positive')
    output = options.output.resolve()
    source_directory = output / 'sources'
    source_directory.mkdir(parents=True, exist_ok=True)
    if options.skip_download:
        sources = json.loads((source_directory / 'sources.json').read_text(encoding='utf-8'))
        for asset in sources['assets']:
            if MOUNTAIN.digest(source_directory / asset['filename']) != asset['sha256']:
                raise ValueError(f'Source integrity changed: {asset["filename"]}')
    else:
        sources = download(source_directory, discover(source_directory))
    if not options.download_only:
        build(output, source_directory, sources, options.core.resolve(), options)


if __name__ == '__main__':
    main()
