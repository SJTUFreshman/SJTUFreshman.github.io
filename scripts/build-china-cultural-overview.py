"""Prepare and package a prefecture-based cultural view on the unchanged China DEM."""

from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ROOT / "tools/relief-atlas/footprints/selected-cultural-20261106"
PALETTE = ["#7eaaa0", "#99bab0", "#6d9a90", "#b1c8b9", "#86aaa2", "#a4bfaf", "#799f96", "#b9cebf"]
GROUP_SPECS = [
    ("yanzhao", "燕赵", "燕趙", "Yanzhao", [110000, 120000, 130000], [], []),
    ("jin", "三晋", "三晉", "Three Jin", [140000], [], []),
    ("dongbei-mongdong", "满洲", "滿洲", "Manchuria", [210000, 220000, 230000], [150400, 150500, 152200], [210200, 210800]),
    ("mongolian-steppe", "蒙古高原", "蒙古高原", "Mongolian Plateau", [], [150700, 152500], []),
    ("mongolian-west", "河套", "河套", "Hetao", [150000], [], [150400, 150500, 150700, 152200, 152500]),
    ("liaodong", "胶辽", "膠遼", "Jiaoliao", [], [210200, 210800, 370200, 370500, 370600, 370700, 371000, 371100, 371400, 371600], []),
    ("jiangnan", "江南", "江南", "Jiangnan", [], [310000, 320200, 320400, 320500, 321100, 330100, 330400, 330500, 330600], []),
    ("jianghuai", "江淮", "江淮", "Jianghuai", [], [320100, 320600, 320800, 320900, 321000, 321200, 340100, 340400, 341100, 341500], []),
    ("huaihai", "淮海", "淮海", "Huaihai", [], [320300, 320700, 321300, 340300, 340600, 341200, 341300, 341600, 370400, 370800, 371300], []),
    ("wuyue", "浙东", "浙東", "Eastern Zhejiang", [], [330200, 330700, 330800, 330900, 331000, 331100], []),
    ("ouyue", "瓯越", "甌越", "Ouyue", [], [330300], []),
    ("huizhou", "徽州", "徽州", "Huizhou", [340000], [], [340100, 340300, 340400, 340600, 341100, 341200, 341300, 341500, 341600]),
    ("min-north", "闽北", "閩北", "Northern Min", [], [350700], []),
    ("min-central", "闽中", "閩中", "Central Min", [], [350300, 350400], []),
    ("min-south", "闽南", "閩南", "Southern Min", [], [350200, 350500, 350600], []),
    ("min-east", "闽东", "閩東", "Eastern Min", [], [350100, 350900], []),
    ("gan", "赣鄱", "贛鄱", "Ganpo", [360000], [], [360700]),
    ("qilu", "齐鲁", "齊魯", "Qilu", [370000], [], [370200, 370400, 370500, 370600, 370700, 370800, 371000, 371100, 371300, 371400, 371600]),
    ("zhongyuan", "中原", "中原", "Central Plain", [410000], [], [411300, 411500]),
    ("nanyang", "豫南", "豫南", "Southern Henan", [], [411300, 411500], []),
    ("jingchu", "荆楚", "荊楚", "Jingchu", [420000], [], [420300, 420500, 422800, 429021]),
    ("chu-west", "鄂西", "鄂西", "Western Hubei", [], [420300, 420500, 422800, 429021], []),
    ("huxiang", "湖湘", "湖湘", "Huxiang", [430000], [], [430800, 431200, 433100]),
    ("xiangxi", "湘西", "湘西", "Western Hunan", [], [430800, 431200, 433100], []),
    ("guangfu", "广府", "廣府", "Guangfu", [440000, 810000, 820000], [450400, 450800, 450900, 451100], [440200, 441400, 441500, 441600, 440500, 445100, 445200]),
    ("hakka", "客家", "客家", "Hakka", [], [350800, 360700, 440200, 441400, 441500, 441600], []),
    ("chaoshan", "潮汕", "潮汕", "Chaoshan", [], [440500, 445100, 445200], []),
    ("guiliu", "桂柳", "桂柳", "Guiliu", [], [450200, 450300, 451300], []),
    ("zhuang", "壮乡", "壯鄉", "Zhuang country", [450000], [], [450200, 450300, 450400, 450800, 450900, 451100, 451300]),
    ("qiong", "琼州", "瓊州", "Qiongzhou", [460000], [], []),
    ("bashu", "巴蜀", "巴蜀", "Bashu", [500000, 510000], [], [510400, 513200, 513300, 513400]),
    ("panxi", "攀西", "攀西", "Panxi", [], [510400, 513400], []),
    ("qian", "黔中", "黔中", "Central Guizhou", [520000], [], [520600, 522600, 522700]),
    ("qiandong", "黔东", "黔東", "Eastern Guizhou", [], [520600, 522600, 522700], []),
    ("dian", "滇中", "滇中", "Central Yunnan", [], [530100, 530300, 530400, 532300], []),
    ("dian-northeast", "滇东北", "滇東北", "Northeastern Yunnan", [], [530600], []),
    ("dian-south", "滇南", "滇南", "Southern Yunnan", [], [530800, 530900, 532500, 532600, 532800], []),
    ("dian-west", "滇西", "滇西", "Western Yunnan", [530000], [], [530100, 530300, 530400, 530600, 530800, 530900, 532300, 532500, 532600, 532800, 533400]),
    ("qingzang", "西藏", "西藏", "Tibet", [540000, 630000], [513200, 513300, 533400, 623000], [630100, 630200, 632200]),
    ("guanzhong", "关中", "關中", "Guanzhong", [], [610100, 610200, 610300, 610400, 610500], []),
    ("shanbei", "陕北", "陝北", "Northern Shaanxi", [], [610600, 610800], []),
    ("shannan", "陕南", "陝南", "Southern Shaanxi", [], [610700, 610900, 611000], []),
    ("longyou", "陇右", "隴右", "Longyou", [620000], [], [620200, 620300, 620600, 620700, 620900, 623000]),
    ("hexi", "河西", "河西", "Hexi", [], [620200, 620300, 620600, 620700, 620900], []),
    ("hehuang", "河湟", "河湟", "Hehuang", [], [630100, 630200, 632200], []),
    ("ningxia", "宁夏", "寧夏", "Ningxia", [640000], [], []),
    ("xinjiang-north", "北疆", "北疆", "Northern Xinjiang", [650000], [], [650400, 650500, 652800, 652900, 653000, 653100, 653200, 659002, 659003, 659006, 659009]),
    ("xinjiang-east", "东疆", "東疆", "Eastern Xinjiang", [], [650400, 650500], []),
    ("xinjiang-south", "南疆", "南疆", "Southern Xinjiang", [], [652800, 652900, 653000, 653100, 653200, 659002, 659003, 659006, 659009], []),
    ("taiwan", "台湾", "臺灣", "Taiwan", [710000], [], []),
]


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + "\n", encoding="utf-8")


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def polygon_geometry(path):
    from shapely.geometry import Polygon
    from shapely import make_valid
    result = None
    for ring in re.findall(r"M([^M]+)", path):
        coordinates = [float(value) for value in re.findall(r"[-+]?(?:\d*\.)?\d+", ring)]
        if len(coordinates) < 6:
            continue
        polygon = make_valid(Polygon(list(zip(coordinates[::2], coordinates[1::2]))))
        result = polygon if result is None else result.symmetric_difference(polygon)
    if result is None or result.is_empty:
        raise ValueError("Empty archived boundary")
    return make_valid(result)


def geometry_path(geometry):
    from shapely.geometry import Polygon
    if isinstance(geometry, Polygon):
        return ''.join('M' + 'L'.join(f'{horizontal:.2f},{vertical:.2f}' for horizontal, vertical in ring.coords) + 'Z'
                       for ring in [geometry.exterior, *geometry.interiors])
    return ''.join(geometry_path(part) for part in getattr(geometry, 'geoms', []))


def update_visited(regions, visited_names):
    names = set(visited_names)
    for region in regions:
        visited = [identifier for identifier, name in zip(region['members'], region['member_names']) if name in names]
        region['visited'] = bool(visited)
        region['visited_members'] = visited


def update_boundaries(regions):
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    for region in regions:
        geometry = polygon_geometry(region['path'])
        polygons = [geometry] if geometry.geom_type == 'Polygon' else list(geometry.geoms)
        exterior = unary_union([Polygon(polygon.exterior) for polygon in polygons if polygon.geom_type == 'Polygon'])
        exterior = exterior.buffer(0.3, join_style=2).buffer(-0.3, join_style=2)
        polygons = [exterior] if exterior.geom_type == 'Polygon' else list(exterior.geoms)
        region['boundary_path'] = ''.join(geometry_path(Polygon(polygon.exterior))
                                         for polygon in polygons if polygon.geom_type == 'Polygon')


def source_units(archive):
    units = deepcopy(read_json(archive / 'detail/data/china.json')['regions'])
    units = [unit for unit in units if unit.get('province')]
    present = {str(unit['province']) for unit in units}
    for unit in read_json(archive / 'overview/data/china.json')['regions']:
        if str(unit.get('province')) not in present:
            units.append(deepcopy(unit))
    return units


def configured_specs():
    path = ROOT / 'tools/relief-atlas/china-cultural-regions.json'
    if not path.exists():
        return GROUP_SPECS
    config = read_json(path)
    specs = []
    for group in config.get('groups', []):
        identifier = str(group['id']).removeprefix('CHN:')
        label = group.get('label', {})
        specs.append((identifier, label.get('zh-CN', group.get('name', identifier)),
                      label.get('zh-TW', label.get('zh-CN', identifier)),
                      label.get('en', group.get('name', identifier)), [],
                      [int(member) for member in group.get('members', [])], []))
    return specs or GROUP_SPECS


def group_units(units, use_defaults=False):
    from shapely.ops import unary_union
    groups = []
    membership = {}
    specs = GROUP_SPECS if use_defaults else configured_specs()
    for slug, simplified, traditional, english, provinces, included, excluded in specs:
        members = [unit for unit in units
                   if (unit['province'] in provinces or int(unit['id']) in included) and int(unit['id']) not in excluded]
        if not members:
            raise ValueError('Empty cultural group: ' + slug)
        for member in members:
            if member['id'] in membership:
                raise ValueError(f'Duplicate membership: {member["id"]} in {membership[member["id"]]} and {slug}')
            membership[member['id']] = slug
        geometry = unary_union([polygon_geometry(member['path']) for member in members]).simplify(0.18, preserve_topology=True)
        center = geometry.representative_point()
        ordered_members = sorted(members, key=lambda member: member['id'])
        group = {'id': 'CHN:' + slug, 'name': english,
                 'label': {'en': english, 'zh-CN': simplified, 'zh-TW': traditional},
                 'country': 'CHN', 'unit': 'cultural-region',
                 'members': [member['id'] for member in ordered_members],
                 'member_names': [member['name'] for member in ordered_members],
                 'provinces': sorted({member['province'] for member in members}),
                 'path': geometry_path(geometry), 'center': [round(center.x, 2), round(center.y, 2)],
                 'geometry': geometry}
        groups.append(group)
    missing = {unit['id'] for unit in units} - membership.keys()
    if missing:
        raise ValueError('Unassigned source units: ' + ', '.join(sorted(missing)))
    adjacency = {group['id']: set() for group in groups}
    for position, group in enumerate(groups):
        for neighbour in groups[position + 1:]:
            if group['geometry'].distance(neighbour['geometry']) < 0.3:
                adjacency[group['id']].add(neighbour['id'])
                adjacency[neighbour['id']].add(group['id'])
    assigned = {}
    ordered = sorted(groups, key=lambda group: (-len(adjacency[group['id']]), group['id']))
    for group in ordered:
        unavailable = {assigned[identifier] for identifier in adjacency[group['id']] if identifier in assigned}
        index = next(index for index in range(len(PALETTE)) if index not in unavailable)
        assigned[group['id']] = index
        group['color'] = PALETTE[index]
    for index, group in enumerate(groups, 1):
        group['raster_id'] = index
    return groups, membership, adjacency


def prepare(archive, write_defaults=False):
    import numpy as np
    from rasterio.features import rasterize
    from rasterio.transform import Affine
    units = source_units(archive)
    groups, membership, adjacency = group_units(units, write_defaults)
    metadata = deepcopy(read_json(archive / 'detail/data/china.json'))
    for key in ('outputs', 'gpu_devices', 'render_engine', 'lighting', 'postprocessing', 'sea_material', 'display_background', 'routes'):
        metadata.pop(key, None)
    source = archive / 'detail/data/china.npz'
    with np.load(source) as original:
        arrays = {key: original[key] for key in original.files}
    rows, columns = arrays['elevation'].shape
    horizontal_scale = metadata['width'] / (columns - 1)
    vertical_scale = metadata['height'] / (rows - 1)
    pixel_transform = Affine(horizontal_scale, 0, -horizontal_scale / 2, 0, vertical_scale, -vertical_scale / 2)
    arrays['region'] = rasterize([(group['geometry'], group['raster_id']) for group in groups], out_shape=(rows, columns),
                                  transform=pixel_transform, fill=0, dtype='uint16')
    visited = set(read_json(ROOT / 'site_content.json')['life']['footprints']['visited_china'])
    regions = [{key: value for key, value in group.items() if key != 'geometry'} for group in groups]
    update_visited(regions, visited)
    metadata.update({'regions': regions, 'palette': list(dict.fromkeys(group['color'] for group in groups)),
                     'region_colors': {str(group['raster_id']): group['color'] for group in groups},
                     'overview_unit': 'cultural-region', 'color_image': 'china-cultural-colour.webp',
                     'preview_color_image': 'china-cultural-colour-preview.webp',
                     'source_archive': archive.relative_to(ROOT).as_posix() + '/cultural',
                     'relief_source_archive': archive.relative_to(ROOT).as_posix() + '/detail',
                     'visit_source': 'visited_china -> any member prefecture -> cultural-region',
                     'cultural_scope': 'Prefecture-scale display grouping; cultural boundaries are approximate.',
                     'render_status': 'pending'})
    target = archive / 'cultural/data/china.npz'
    target.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(target, **arrays)
    with np.load(source) as original, np.load(target) as result:
        unchanged = {key: bool(np.array_equal(original[key], result[key])) for key in ('elevation', 'mask', 'x', 'y')}
    if not all(unchanged.values()):
        raise ValueError('Cultural preparation changed DEM arrays')
    write_json(archive / 'cultural/data/china.json', metadata)
    configuration = {'description': metadata['cultural_scope'], 'source': 'Archived China prefecture boundaries and province boundaries for Hong Kong, Macao and Taiwan.',
                     'groups': [{key: value for key, value in region.items() if key not in ('path', 'center', 'visited', 'visited_members')} for region in regions],
                     'memberships': membership, 'adjacency': {key: sorted(value) for key, value in adjacency.items()}}
    write_json(archive / 'cultural/group-config.json', configuration)
    config_path = ROOT / 'tools/relief-atlas/china-cultural-regions.json'
    if write_defaults or not config_path.exists():
        write_json(config_path, configuration)
    land = arrays['mask'].astype(bool)
    report = {'status': 'ready_to_render', 'rendered': False, 'groups': len(regions), 'source_units': len(units),
              'visited_groups': sum(region['visited'] for region in regions), 'unassigned_source_units': [],
              'dem_arrays_unchanged': unchanged, 'source_dem_sha256': digest(source), 'cultural_dem_sha256': digest(target),
              'unassigned_land_fraction': round(float(np.mean(arrays['region'][land] == 0)), 6),
              'colour_image': metadata['color_image'], 'variants': ['colour']}
    write_json(archive / 'cultural/prepare-manifest.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return metadata


def package_layer(archive, destination, atlas):
    from PIL import Image
    archive, destination = Path(archive), Path(destination)
    cultural = archive / 'cultural'
    metadata = read_json(cultural / 'data/china.json')
    report = read_json(cultural / 'renders/china-render.json')
    native = cultural / 'renders/china-colour.png'
    if digest(native) != report['outputs'][native.name] or report.get('postprocessing') != 'none':
        raise ValueError('Cultural image must match the native render report')
    with Image.open(native) as original:
        if original.size != (metadata['width'], metadata['height']):
            raise ValueError('Cultural image dimensions differ')
        image = original.convert('RGB')
        image.save(destination / metadata['color_image'], quality=95, method=6)
        image.thumbnail((1600, round(1600 * metadata['height'] / metadata['width'])), Image.Resampling.LANCZOS)
        image.save(destination / metadata['preview_color_image'], quality=86, method=6)
    regions = deepcopy(metadata['regions'])
    update_visited(regions, set(read_json(ROOT / 'site_content.json')['life']['footprints']['visited_china']))
    update_boundaries(regions)
    return {'unit': 'cultural-region', 'regions': regions, 'color_image': metadata['color_image'],
            'preview_color_image': metadata['preview_color_image'], 'source_archive': cultural.relative_to(ROOT).as_posix(),
            'color_source_archive': cultural.relative_to(ROOT).as_posix(), 'relief_source_archive': atlas['maps']['china']['source_archive'],
            'visit_source': metadata['visit_source'], 'width': metadata['width'], 'height': metadata['height'],
            'projection': metadata['projection'], 'extent_km': metadata['extent_km'], 'routes': [],
            'outputs': report['outputs'], 'postprocessing': report['postprocessing'], 'sea_material': report['sea_material'],
            'description': metadata['cultural_scope']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--write-defaults', action='store_true', help='Write the initial editable group configuration')
    arguments = parser.parse_args()
    if not arguments.prepare:
        parser.error('Choose --prepare')
    prepare(arguments.archive.resolve(), arguments.write_defaults)


if __name__ == '__main__':
    main()
