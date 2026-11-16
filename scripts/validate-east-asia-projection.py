"""Independently check East Asia's overlays against its historical raster grid.

Use a closed-form spherical equirectangular transform, rather than the builder's
PROJ transform, so a change in PROJ's interpretation cannot move both the
implementation and its expected result together. Requires Shapely, NumPy,
Pillow and pyproj (pyproj is used only to invert the separate China AEA map).
"""

import argparse
import gzip
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely import make_valid
from shapely.affinity import affine_transform
from shapely.geometry import box, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
RELIEF = ROOT / 'assets/maps/relief'
BASELINE = ROOT / 'tools/relief-atlas/footprints/selected-cultural-20261106/detail/data'
spec = importlib.util.spec_from_file_location('culture_geometry', ROOT / 'scripts/build-china-cultural-overview.py')
culture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(culture)


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def outline(region):
    return culture.polygon_geometry(region.get('boundary_path') or region['path'])


def sphere_pixels(geographic, metadata):
    # The existing DEM was sampled on this sphere; these constants are the
    # map's independent contract, not values taken from a generated CRS string.
    west, south, east, north = metadata['extent_km']
    width, height = metadata['width'], metadata['height']
    kilometres_per_degree = math.pi * 6378137 / 180 / 1000
    x_per_degree = kilometres_per_degree * math.cos(math.radians(34))
    sx = x_per_degree * width / (east - west)
    sy = -kilometres_per_degree * height / (north - south)
    ox = (-125 * x_per_degree - west) * width / (east - west)
    oy = north * height / (north - south)
    geographic = geographic.intersection(box(*metadata['geographic_bounds']))
    return affine_transform(geographic, [sx, 0, 0, sy, ox, oy]).intersection(box(0, 0, width, height))


def compare(identifier, actual, expected, minimum_iou, maximum_centroid):
    iou = actual.intersection(expected).area / actual.union(expected).area
    dx = actual.centroid.x - expected.centroid.x
    dy = actual.centroid.y - expected.centroid.y
    assert iou >= minimum_iou, (identifier, 'area mismatch', iou)
    assert math.hypot(dx, dy) <= maximum_centroid, (identifier, 'projection drift', dx, dy)
    return {'id': identifier, 'iou': round(iou, 7), 'centroid_error_source_pixels': round(math.hypot(dx, dy), 5)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--overview-root', type=Path, help='Validate a prepared archive before publication')
    args = parser.parse_args()
    atlas = read(RELIEF / 'atlas.json')['maps']['east_asia']
    overview_root = args.overview_root or ROOT / atlas['overview']['source_archive']
    metadata = read(overview_root / 'data/east_asia.json')
    regions = metadata['regions']
    assert '+R=6378137' in metadata['projection'], 'East Asia must declare its spherical raster grid explicitly'
    assert (metadata['width'], metadata['height']) == (6000, 4770)
    assert regions and len({region['id'] for region in regions}) == len(regions)

    before = np.load(BASELINE / 'east_asia.npz')
    after = np.load(overview_root / 'data/east_asia.npz')
    for name in ('elevation', 'mask', 'x', 'y'):
        assert np.array_equal(before[name], after[name], equal_nan=True), ('The original terrain grid changed', name)

    features = read_geojson(overview_root / 'cache/ne_10m_admin_1_states_provinces.geojson.gz')
    by_iso = {feature['properties']['iso_3166_2']: feature for feature in features}
    by_code = {feature['properties']['adm1_code']: feature for feature in features}
    checks = []
    for region in regions:
        if region['country'] == 'CHN':
            continue
        source = by_iso if region['country'] in ('JPN', 'KOR') else by_code
        geographic = unary_union([make_valid(shape(source[member]['geometry'])) for member in region['members']])
        checks.append(compare(region['id'], outline(region), sphere_pixels(geographic, metadata), .998, .12))

    # The existing city geometry is independent of the new cultural reprojector.
    # Small historical seam/harbour differences account for the wider tolerance.
    detail = {region['id']: culture.polygon_geometry(region['path']) for region in atlas['regions']}
    for region in regions:
        if region['country'] != 'CHN' or region['id'] == 'CHN:taiwan':
            continue
        members = [detail[member] for member in region['members'] if member in detail]
        assert members, ('Missing independent detailed geometry', region['id'])
        checks.append(compare(region['id'], outline(region), unary_union(members), .985, 5))

    style = read(ROOT / 'tools/relief-atlas/footprints-style.json')
    china = read(ROOT / style['cultural_archive'] / 'data/china.json')
    taiwan = next(region for region in china['regions'] if region['id'] == 'CHN:taiwan')
    west, south, east, north = china['extent_km']
    metres = affine_transform(outline(taiwan), [(east - west) * 1000 / china['width'], 0, 0,
                              -(north - south) * 1000 / china['height'], west * 1000, north * 1000])
    geographic = transform(Transformer.from_crs(china['projection'], 'EPSG:4326', always_xy=True).transform, metres)
    target = next(region for region in regions if region['id'] == 'CHN:taiwan')
    checks.append(compare(target['id'], outline(target), sphere_pixels(geographic, metadata), .9999, .02))

    # Interior colour-region centroids must align too: moving only the SVG paths
    # leaves the old paint boundaries embedded in the Blender image.
    for identifier in ('CHN:huizhou', 'CHN:gan', 'CHN:shanbei'):
        region = next(region for region in regions if region['id'] == identifier)
        y, x = np.where((after['region'] == region['raster_id']) & after['mask'])
        expected = unary_union([detail[member] for member in region['members'] if member in detail]).centroid
        dx = x.mean() / (len(after['x']) - 1) * 6000 - expected.x
        dy = y.mean() / (len(after['y']) - 1) * 4770 - expected.y
        assert math.hypot(dx, dy) <= .6, (identifier, 'terrain pigment drift', dx, dy)

    if not args.overview_root:
        assert atlas['projection'] == metadata['projection'] == atlas['overview']['projection']
        published = {region['id']: region for region in atlas['overview']['regions']}
        for region in regions:
            assert published[region['id']]['path'] == region['path'], ('Published geometry is stale', region['id'])
        for name in ('relief', 'colour', 'overview-colour'):
            for suffix, size in (('', (6000, 4770)), ('-preview', (1600, 1272))):
                with Image.open(RELIEF / f'east_asia-{name}{suffix}.webp') as image:
                    assert image.size == size

    assert len(checks) == len(regions)
    foreign = [check for check in checks if not check['id'].startswith('CHN:')]
    print(json.dumps({'regions_checked': len(checks), 'foreign_minimum_iou': min(check['iou'] for check in foreign),
                      'foreign_maximum_centroid_error_source_pixels': max(check['centroid_error_source_pixels'] for check in foreign),
                      'terrain_grid_unchanged': True, 'interior_pigments_aligned': True}, indent=2))


def read_geojson(path):
    return json.loads(gzip.decompress(path.read_bytes()))['features']


if __name__ == '__main__':
    main()
