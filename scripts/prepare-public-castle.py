"""Extract a reviewable architectural crop from the licensed Kokura scan."""
import argparse
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys

import numpy as np


SOURCE_SHA256 = '0e2c31ce4cf01eed7f4e24fe5adcc1206120b737201d2e7c670dce39de25c05c'
SOURCE_URL = 'https://sketchfab.com/3d-models/kokura-castle-aba23531911c45439067a6e0aaccad07'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load_glb(path):
    raw = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    if magic != 0x46546C67 or version != 2 or length != len(raw):
        raise ValueError('Expected a complete glTF 2.0 binary')
    json_length, chunk_type = struct.unpack_from('<II', raw, 12)
    if chunk_type != 0x4E4F534A:
        raise ValueError('First GLB chunk is not JSON')
    document = json.loads(raw[20:20 + json_length])
    binary_length, chunk_type = struct.unpack_from('<II', raw, 20 + json_length)
    if chunk_type != 0x004E4942:
        raise ValueError('Second GLB chunk is not binary')
    binary = memoryview(raw)[28 + json_length:28 + json_length + binary_length]
    return document, binary


def accessor(document, binary, index):
    record = document['accessors'][index]
    view = document['bufferViews'][record['bufferView']]
    component = {5123: '<u2', 5125: '<u4', 5126: '<f4'}[record['componentType']]
    components = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[record['type']]
    width = np.dtype(component).itemsize
    return np.ndarray((record['count'], components), dtype=component, buffer=binary,
                      offset=view.get('byteOffset', 0) + record.get('byteOffset', 0),
                      strides=(view.get('byteStride', width * components), width))


def blender_coordinates(points):
    transformed = points[:, [0, 2, 1]].copy()
    transformed[:, 2] *= -1
    return transformed


def polygon_contains(points, polygon):
    inside = np.zeros(len(points), dtype=bool)
    for first, last in zip(polygon, polygon[1:] + polygon[:1]):
        if abs(last[1] - first[1]) < 1e-9:
            continue
        crossing = first[0] + (points[:, 1] - first[1]) * (last[0] - first[0]) / (last[1] - first[1])
        inside ^= ((first[1] > points[:, 1]) != (last[1] > points[:, 1])) & (points[:, 0] < crossing)
    return inside


def architectural_regions(points):
    horizontal, depth, height = points.T
    base_fraction = np.clip((height - 9.35) / (28 - 9.35), 0, 1)
    podium = ((height >= 9.35) & (height < 28)
              & (horizontal >= 61) & (horizontal <= 125 - 8.2 * base_fraction)
              & (depth >= 53.5 + 2 * base_fraction) & (depth <= 117 - 9.2 * base_fraction))
    lower_keep = ((height >= 28) & (height < 50)
                  & (horizontal >= 60.5) & (horizontal <= 116.8)
                  & (depth >= 55.5) & (depth <= 108))
    upper_keep = ((height >= 50) & (horizontal >= 65) & (horizontal <= 112)
                  & (depth >= 63) & (depth <= 101))
    annex_center = 105 - (horizontal - 20) * .175
    annex = ((height >= 24) & (height <= 50) & (horizontal >= 15)
             & (horizontal <= 69) & (np.abs(depth - annex_center) <= 9.5))
    approach_polygon = [(41, 16), (50, 16), (51, 46), (64, 61), (66, 89),
                        (45, 89), (43, 65), (41, 49)]
    approach = polygon_contains(points, approach_polygon) & (height >= 20) & (height <= 28.2)
    return {'podium': podium, 'lower_keep': lower_keep, 'upper_keep': upper_keep,
            'annex': annex, 'approach': approach}


def build_crop(source, output):
    from PIL import Image

    if digest(source) != SOURCE_SHA256:
        raise ValueError('Kokura source hash differs from the licensed verified source')
    document, binary = load_glb(source)
    diffuse_view = document['bufferViews'][document['images'][0]['bufferView']]
    diffuse_start = diffuse_view.get('byteOffset', 0)
    diffuse = np.asarray(Image.open(io.BytesIO(binary[diffuse_start:diffuse_start + diffuse_view['byteLength']])).convert('RGB'))
    result = {key: copy.deepcopy(document[key]) for key in
              ('asset', 'scene', 'scenes', 'nodes', 'materials', 'samplers', 'textures', 'images')}
    result.update(meshes=[], bufferViews=[], accessors=[], buffers=[])
    result['asset']['extras']['modification'] = 'Spatial triangle crop for offline source review; scale uncalibrated'
    packed = bytearray()

    def append_view(payload, target=None):
        packed.extend(b'\0' * (-len(packed) % 4))
        record = {'buffer': 0, 'byteOffset': len(packed), 'byteLength': len(payload)}
        if target is not None:
            record['target'] = target
        result['bufferViews'].append(record)
        packed.extend(payload)
        return len(result['bufferViews']) - 1

    def append_accessor(values, component_type, shape, bounds=False):
        record = {'bufferView': append_view(values.tobytes(), 34963 if shape == 'SCALAR' else 34962),
                  'componentType': component_type, 'count': len(values), 'type': shape}
        if bounds:
            record.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
        result['accessors'].append(record)
        return len(result['accessors']) - 1

    reports, retained_points = [], []
    source_triangles, retained_triangles, protected_triangles, retained_protected = 0, 0, 0, 0
    for source_mesh in document['meshes']:
        destination_mesh = {'name': source_mesh.get('name', 'Kokura crop'), 'primitives': []}
        for primitive in source_mesh['primitives']:
            original_positions = accessor(document, binary, primitive['attributes']['POSITION'])
            positions = blender_coordinates(original_positions)
            indices = accessor(document, binary, primitive['indices']).reshape(-1, 3)
            triangles = positions[indices]
            centers = triangles.mean(axis=1)
            regions = architectural_regions(centers)
            keep = np.logical_or.reduce(list(regions.values()))
            keep &= triangles[:, :, 2].min(axis=1) >= 9.2
            edges = np.stack((triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 1],
                              triangles[:, 0] - triangles[:, 2]), axis=1)
            long_closure = ((np.linalg.norm(edges, axis=2).max(axis=1) > 12)
                            & (triangles[:, :, 2].min(axis=1) < 24))
            coordinates = accessor(document, binary, primitive['attributes']['TEXCOORD_0'])[indices]
            texture_x = np.clip((coordinates[:, :, 0] * (diffuse.shape[1] - 1)).astype(int), 0, diffuse.shape[1] - 1)
            texture_y = np.clip((coordinates[:, :, 1] * (diffuse.shape[0] - 1)).astype(int), 0, diffuse.shape[0] - 1)
            colors = diffuse[texture_y, texture_x].astype(np.float32)
            green = (colors[:, :, 1] > colors[:, :, 0] * 1.06) & (colors[:, :, 1] > colors[:, :, 2] * 1.19)
            vegetation_region = ((centers[:, 2] > 28)
                                 & ((centers[:, 0] < 66) | (centers[:, 1] < 57) | (centers[:, 1] > 109)))
            vegetation = vegetation_region & (green.sum(axis=1) >= 2)
            removed_closure = int((keep & long_closure).sum())
            removed_vegetation = int((keep & vegetation).sum())
            keep &= ~long_closure & ~vegetation
            protected = triangles[:, :, 2].min(axis=1) >= 65
            if not np.all(keep[protected]):
                raise ValueError('Crop removes protected upper tower triangles')
            kept_indices = indices[keep]
            if not len(kept_indices):
                raise ValueError('A whole source mesh was removed; review the geometric crop')
            used, remapped = np.unique(kept_indices.reshape(-1), return_inverse=True)
            destination_primitive = {'attributes': {}, 'indices': append_accessor(remapped.astype('<u4'), 5125, 'SCALAR'),
                                     'material': primitive.get('material', 0), 'mode': 4}
            for attribute, source_accessor in primitive['attributes'].items():
                source_record = document['accessors'][source_accessor]
                values = accessor(document, binary, source_accessor)[used].copy()
                destination_primitive['attributes'][attribute] = append_accessor(
                    values, source_record['componentType'], source_record['type'], attribute == 'POSITION')
            destination_mesh['primitives'].append(destination_primitive)
            source_triangles += len(indices)
            retained_triangles += len(kept_indices)
            protected_triangles += int(protected.sum())
            retained_protected += int((protected & keep).sum())
            retained_points.append(positions[used])
            reports.append({'mesh': source_mesh.get('name'), 'source_triangles': len(indices),
                            'retained_triangles': len(kept_indices), 'retained_vertices': len(used),
                            'removed_long_closure_triangles': removed_closure,
                            'removed_outer_green_vegetation_triangles': removed_vegetation,
                            'regions': {name: int((region & keep).sum()) for name, region in regions.items()}})
        result['meshes'].append(destination_mesh)
    for image in result['images']:
        source_view = document['bufferViews'][image['bufferView']]
        start = source_view.get('byteOffset', 0)
        image['bufferView'] = append_view(bytes(binary[start:start + source_view['byteLength']]))
    packed.extend(b'\0' * (-len(packed) % 4))
    result['buffers'] = [{'byteLength': len(packed)}]
    json_chunk = json.dumps(result, separators=(',', ':')).encode('utf-8')
    json_chunk += b' ' * (-len(json_chunk) % 4)
    output.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(json_chunk) + len(packed))
                       + struct.pack('<II', len(json_chunk), 0x4E4F534A) + json_chunk
                       + struct.pack('<II', len(packed), 0x004E4942) + packed)
    points = np.concatenate(retained_points)
    return {'source': str(source.resolve()), 'source_sha256': SOURCE_SHA256, 'source_url': SOURCE_URL,
            'license': 'CC-BY-4.0', 'license_url': 'https://creativecommons.org/licenses/by/4.0/',
            'output': str(output.resolve()), 'output_sha256': digest(output),
            'source_triangles': source_triangles, 'retained_triangles': retained_triangles,
            'retained_vertices': len(points), 'protected_upper_triangles': protected_triangles,
            'retained_protected_upper_triangles': retained_protected,
            'blender_bounds_source_units': [points.min(axis=0).tolist(), points.max(axis=0).tolist()],
            'meshes': reports, 'classification': 'height-dependent XY envelopes, outer green texture mask, closure edge length',
            'boundary_policy': 'Whole triangles retained; no invented caps, remeshing, or vertex displacement',
            'materials': 'Original JPEG/PNG bytes, UVs and vertex normals retained',
            'limitations': ['Spatial crop is not semantic segmentation',
                            'Tree fragments touching the building envelopes may remain',
                            'Lower stonework obscured in the original scan is not reconstructed',
                            'Cropped approach edges require later reviewed terrain contact'],
            'photographic_acceptance': False, 'installation_performed': False,
            'consecutive_independent_passing_rounds': 0}


def audit_cameras(queue_path):
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('Camera auditing requires a Slurm compute allocation')
    specification = importlib.util.spec_from_file_location(
        'public_study', Path(__file__).with_name('render-public-model-study.py'))
    study_renderer = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(study_renderer)
    configure_contact_import(study_renderer)
    reports = []
    for study in json.loads(queue_path.read_text(encoding='utf-8')):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        imported = set()
        for record in study['sources']:
            objects, unused_report = study_renderer.import_source(record)
            imported.update(objects)
        dependency_graph = bpy.context.evaluated_depsgraph_get()
        trees = [(instance, BVHTree.FromObject(instance, dependency_graph))
                 for instance in imported if instance.type == 'MESH']
        minimum, maximum = study_renderer.bounds(imported)

        def ray_cast(origin, direction, maximum_distance=10000):
            nearest = None
            for instance, tree in trees:
                inverse = instance.matrix_world.inverted()
                local_direction = inverse.to_3x3() @ direction
                local_direction.normalize()
                hit, unused_normal, face, unused_distance = tree.ray_cast(inverse @ origin, local_direction)
                if hit is None:
                    continue
                world_hit = instance.matrix_world @ hit
                distance = (world_hit - origin).length
                if distance <= maximum_distance and (nearest is None or distance < nearest['distance']):
                    nearest = {'object': instance.name, 'face': face, 'position': list(world_hit),
                               'distance': distance}
            return nearest

        for view in study['views']:
            camera = Vector(view['position'])
            target = Vector(view['target'])
            forward = ray_cast(camera, (target - camera).normalized())
            vertical = ray_cast(Vector((camera.x, camera.y, maximum.z + 100)), Vector((0, 0, -1)))
            proximity = [ray_cast(camera, Vector(direction), .25)
                         for direction in [(1, 0, 0), (-1, 0, 0), (0, 1, 0),
                                           (0, -1, 0), (0, 0, 1), (0, 0, -1)]]
            if any(hit is not None for hit in proximity):
                raise ValueError(f"Camera lies within 25 cm of scan geometry: {study['id']}/{view['name']}")
            if view['name'].startswith('near-'):
                if forward is None or forward['distance'] < .5:
                    raise ValueError(f"Close-up has no safe visible surface: {view['name']}")
                if vertical is not None and vertical['position'][2] >= camera.z - .5:
                    raise ValueError(f"Close-up lies below the actual upper surface: {view['name']}")
            reports.append({'study': study['id'], 'view': view['name'], 'camera': list(camera),
                            'target': list(target), 'forward_surface_hit': forward,
                            'actual_vertical_surface_hit': vertical,
                            'nearby_surface_within_25cm': False})
    destination = queue_path.with_name('camera-safety.json')
    destination.write_text(json.dumps({'job_id': os.environ['SLURM_JOB_ID'], 'views': reports}, indent=2)
                           + '\n', encoding='utf-8')
    print('CAMERA_AUDIT', destination, len(reports), flush=True)


def configure_contact_import(study_renderer):
    import bpy
    from mathutils import Matrix, Vector

    original_import = study_renderer.import_source

    def surface_hit(objects, origin):
        dependency_graph = bpy.context.evaluated_depsgraph_get()
        nearest = None
        for instance in objects:
            if instance.type != 'MESH':
                continue
            inverse = instance.matrix_world.inverted()
            direction = inverse.to_3x3() @ Vector((0, 0, -1))
            evaluated = instance.evaluated_get(dependency_graph)
            success, point, unused_normal, unused_face = evaluated.ray_cast(inverse @ origin, direction.normalized())
            if success:
                world_point = instance.matrix_world @ point
                if nearest is None or world_point.z > nearest.z:
                    nearest = world_point
        if nearest is None:
            raise ValueError(f'Contact ray missed actual mesh at {list(origin)}')
        return nearest

    def contact_import(record):
        before = set(bpy.data.objects)
        imported, report = original_import(record)
        if 'contact_to_previous' in record:
            contact = record['contact_to_previous']
            target = surface_hit(before, Vector(contact['target_ray_origin']))
            current = surface_hit(imported, Vector(contact['source_ray_origin']))
            if (target.xy - current.xy).length > .001:
                raise ValueError('Support contact rays have different horizontal coordinates')
            embed = contact.get('embed', .1)
            correction = target.z - current.z + embed
            for instance in imported:
                if instance.parent not in imported:
                    instance.matrix_world = Matrix.Translation((0, 0, correction)) @ instance.matrix_world
            bpy.context.view_layer.update()
            adjusted = surface_hit(imported, Vector(contact['source_ray_origin']))
            if abs(adjusted.z - target.z - embed) > .002:
                raise ValueError('Actual support contact verification failed')
            report['surface_contact'] = {'target': list(target), 'support': list(adjusted),
                                         'embed': embed, 'translation_z_correction': correction,
                                         'verification_error': abs(adjusted.z - target.z - embed)}
            minimum, maximum = study_renderer.bounds(imported)
            report['placed_bounds'] = [list(minimum), list(maximum)]
            print('ACTUAL_SURFACE_CONTACT', json.dumps(report['surface_contact']), flush=True)
        return imported, report

    study_renderer.import_source = contact_import


def render_queue(queue_path):
    specification = importlib.util.spec_from_file_location(
        'public_study', Path(__file__).with_name('render-public-model-study.py'))
    study_renderer = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(study_renderer)
    configure_contact_import(study_renderer)
    sys.argv = [sys.argv[0], '--', '--queue', str(queue_path)]
    study_renderer.main()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output-directory', type=Path)
    parser.add_argument('--audit-queue', type=Path)
    parser.add_argument('--render-queue', type=Path)
    arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    options = parser.parse_args(arguments)
    if options.audit_queue:
        audit_cameras(options.audit_queue)
        return
    if options.render_queue:
        render_queue(options.render_queue)
        return
    if options.source is None or options.output_directory is None:
        parser.error('--source and --output-directory are required for preparation')
    options.output_directory.mkdir(parents=True, exist_ok=True)
    output = options.output_directory / 'kokura-architecture.glb'
    if output.exists():
        raise FileExistsError('Use a new isolated output directory for each crop revision')
    report = build_crop(options.source, output)
    report['preparation_script_sha256'] = digest(__file__)
    (options.output_directory / 'crop-evidence.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'meshes'}, indent=2))


if __name__ == '__main__':
    main()
