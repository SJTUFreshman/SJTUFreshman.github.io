"""Decode native glTF geometry and compare actor anchors with Unreal evidence.

This checks geometry, hierarchy and coordinate conversion, not material fidelity.
Run on the server for large native exports; it does not install any site assets.
"""
import argparse
import base64
from collections import defaultdict
import hashlib
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

import numpy as np


DTYPES = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


class Geometry:
    def __init__(self, path):
        self.path = Path(path).resolve()
        self.document = json.loads(self.path.read_text(encoding='utf-8'))
        if self.document.get('asset', {}).get('version') != '2.0':
            raise ValueError('Expected a glTF 2.0 JSON file')
        self.buffers = []
        for item in self.document.get('buffers', []):
            uri = item['uri']
            if uri.startswith('data:'):
                prefix, encoded = uri.split(',', 1)
                if not prefix.endswith(';base64'):
                    raise ValueError('Only base64 embedded buffers are supported')
                raw = base64.b64decode(encoded, validate=True)
            else:
                parsed = urlsplit(uri)
                if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
                    raise ValueError('Expected a local buffer: ' + uri)
                target = (self.path.parent / unquote(parsed.path)).resolve()
                if not target.is_relative_to(self.path.parent):
                    raise ValueError('Buffer escapes export directory: ' + uri)
                raw = np.memmap(target, mode='r', dtype='u1')
            if len(raw) < item['byteLength']:
                raise ValueError('Truncated buffer: ' + uri)
            self.buffers.append(raw)

    def accessor(self, index):
        if not isinstance(index, int) or not 0 <= index < len(self.document['accessors']):
            raise ValueError('Invalid accessor index')
        item = self.document['accessors'][index]
        if 'sparse' in item:
            raise ValueError('Sparse geometry requires a separate decoder; review is incomplete')
        if item.get('normalized'):
            raise ValueError('Normalized geometry requires a separate decoder; review is incomplete')
        view = self.document['bufferViews'][item['bufferView']]
        dtype = np.dtype(DTYPES[item['componentType']])
        width = WIDTHS[item['type']]
        count = item['count']
        if not isinstance(count, int) or count <= 0:
            raise ValueError('Geometry accessor has no values')
        stride = view.get('byteStride', dtype.itemsize * width)
        offset = item.get('byteOffset', 0)
        if offset < 0 or stride < width * dtype.itemsize or stride % dtype.itemsize:
            raise ValueError('Malformed geometry accessor alignment/stride')
        end = offset + (count - 1) * stride + width * dtype.itemsize
        if end > view['byteLength']:
            raise ValueError('Geometry accessor exceeds its bufferView')
        start = view.get('byteOffset', 0)
        raw = self.buffers[view['buffer']]
        if start < 0 or start + view['byteLength'] > len(raw):
            raise ValueError('BufferView exceeds its buffer')
        values = np.ndarray((count, width), dtype=dtype, buffer=raw,
                            offset=start + offset, strides=(stride, dtype.itemsize))
        if not np.isfinite(values).all():
            raise ValueError('Nonfinite decoded geometry')
        for key, function in [('min', np.min), ('max', np.max)]:
            if key in item and not np.allclose(function(values, axis=0), item[key], rtol=2e-6, atol=2e-5):
                raise ValueError('Accessor ' + key + ' does not match decoded geometry')
        return values

    def mesh(self, index):
        if not isinstance(index, int) or not 0 <= index < len(self.document['meshes']):
            raise ValueError('Invalid mesh index')
        item = self.document['meshes'][index]
        if any(item.get('weights', [])):
            raise ValueError('Active morph geometry is not a static export')
        result, count = [], 0
        for primitive in item['primitives']:
            if primitive.get('mode', 4) != 4:
                raise ValueError('Expected triangle primitives')
            if primitive.get('extensions'):
                raise ValueError('Compressed/extended primitive needs its native decoder')
            position_index = primitive['attributes']['POSITION']
            accessor = self.document['accessors'][position_index]
            if accessor['type'] != 'VEC3' or accessor['componentType'] != 5126:
                raise ValueError('Expected float VEC3 positions from Unreal')
            positions = self.accessor(position_index)
            if 'indices' in primitive:
                index_accessor = self.document['accessors'][primitive['indices']]
                if index_accessor['type'] != 'SCALAR' or index_accessor['componentType'] not in (5121, 5123, 5125):
                    raise ValueError('Expected unsigned scalar triangle indices')
                indices = self.accessor(primitive['indices']).ravel()
                if indices.max() >= len(positions):
                    raise ValueError('Triangle references a nonexistent vertex')
                length = len(indices)
            else:
                length = len(positions)
            if length % 3:
                raise ValueError('Incomplete triangle')
            count += length // 3
            result.append(positions)
        if not result:
            raise ValueError('Empty mesh')
        return result, count


def transform(node):
    if 'matrix' in node:
        if any(key in node for key in ('translation', 'rotation', 'scale')):
            raise ValueError('Node combines matrix and TRS')
        result = np.asarray(node['matrix'], dtype=np.float64).reshape(4, 4).T
    else:
        q = np.asarray(node.get('rotation', [0, 0, 0, 1]), dtype=np.float64)
        if q.shape != (4,) or abs(np.linalg.norm(q) - 1) > 1e-4:
            raise ValueError('Node quaternion is not normalized')
        x, y, z, w = q
        rotation = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                             [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                             [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
        scale = np.asarray(node.get('scale', [1, 1, 1]), dtype=np.float64)
        translation = np.asarray(node.get('translation', [0, 0, 0]), dtype=np.float64)
        if scale.shape != (3,) or translation.shape != (3,):
            raise ValueError('Malformed node scale/translation')
        result = np.eye(4)
        result[:3, :3] = rotation @ np.diag(scale)
        result[:3, 3] = translation
    if not np.isfinite(result).all() or not np.allclose(result[3], [0, 0, 0, 1]):
        raise ValueError('Malformed or nonfinite node transform')
    return result


def inspect(path, evidence_path=None, tolerance=.05, unit='m'):
    if unit not in ('m', 'source') or (evidence_path and unit != 'm'):
        raise ValueError('Unreal actor comparison requires glTF metre units')
    geometry = Geometry(path)
    document = geometry.document
    if document.get('skins') or document.get('animations'):
        raise ValueError('Expected an evaluated static export')
    mesh_cache = {}
    nodes = document['nodes']
    roots = document['scenes'][document.get('scene', 0)]['nodes']
    stack = [(i, np.eye(4), None) for i in reversed(roots)]
    seen, records, by_name = set(), [], defaultdict(list)
    total_min, total_max = np.full(3, np.inf), np.full(3, -np.inf)
    triangles = 0
    while stack:
        index, parent_matrix, parent = stack.pop()
        if not isinstance(index, int) or not 0 <= index < len(nodes) or index in seen:
            raise ValueError('Invalid, shared or cyclic scene node')
        seen.add(index)
        node = nodes[index]
        if 'skin' in node or any(node.get('weights', [])):
            raise ValueError('Node has active skin/morph data')
        world = parent_matrix @ transform(node)
        record = {'node': index, 'name': node.get('name', ''), 'parent': parent,
                  'worldPosition': world[:3, 3].tolist()}
        if 'mesh' in node:
            mesh_index = node['mesh']
            if mesh_index not in mesh_cache:
                mesh_cache[mesh_index] = geometry.mesh(mesh_index)
            primitives, count = mesh_cache[mesh_index]
            lower, upper = np.full(3, np.inf), np.full(3, -np.inf)
            for positions in primitives:
                for start in range(0, len(positions), 262144):
                    actual = positions[start:start+262144] @ world[:3, :3].T + world[:3, 3]
                    lower = np.minimum(lower, actual.min(axis=0))
                    upper = np.maximum(upper, actual.max(axis=0))
            if not np.isfinite(lower).all() or not np.isfinite(upper).all():
                raise ValueError('Nonfinite transformed geometry')
            total_min, total_max = np.minimum(total_min, lower), np.maximum(total_max, upper)
            triangles += count
            record.update(mesh=mesh_index, triangles=count, worldBounds={'min': lower.tolist(), 'max': upper.tolist()})
        records.append(record)
        by_name[record['name']].append(record)
        stack.extend((child, world, index) for child in reversed(node.get('children', [])))
    if not mesh_cache:
        raise ValueError('No reachable geometry')
    report = {'status': 'decoded-needs-material-and-visual-review', 'gltfSha256': digest(Path(path)),
              'uniqueMeshes': len(mesh_cache), 'meshNodes': sum('mesh' in r for r in records),
              'sceneNodes': len(records), 'instancedTriangles': triangles,
              'unit': unit, 'worldBounds': {'min': total_min.tolist(), 'max': total_max.tolist()}, 'nodes': records,
              'limitations': ['Actor anchors do not prove material, decal, particle or per-instance custom-data fidelity.',
                              'Geometry is decoded from actual buffer bytes; accessor bounds alone are not evidence.']}
    if evidence_path:
        evidence = json.loads(Path(evidence_path).read_text(encoding='utf-8'))
        matches, failures, used = [], [], set()
        for actor in evidence['actors']:
            if actor.get('editorOnly') or actor.get('hidden') or actor.get('selectedForExport') is False:
                continue
            if not any(c.get('mesh') or 'LandscapeComponent' in c['class'] for c in actor.get('components', [])):
                continue
            point = actor['locationCm']
            expected = np.array([point[0], point[2], point[1]]) * .01
            options = [(np.linalg.norm(np.array(r['worldPosition']) - expected), r)
                       for r in by_name[actor['label']] if r['node'] not in used]
            options.sort(key=lambda value: value[0])
            result = {'actor': actor['path'], 'label': actor['label'], 'expectedPositionMetres': expected.tolist()}
            if options and options[0][0] <= tolerance:
                error, selected = options[0]
                used.add(selected['node'])
                result.update(node=selected['node'], errorMetres=float(error))
                matches.append(result)
            else:
                result['nearestErrorMetres'] = float(options[0][0]) if options else None
                failures.append(result)
        report['actorAnchorComparison'] = {'sourceEvidenceSha256': digest(Path(evidence_path)),
                                           'toleranceMetres': tolerance, 'matched': matches, 'unmatched': failures}
        if failures:
            report['status'] = 'geometry-decoded-actor-coverage-incomplete'
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gltf', type=Path)
    parser.add_argument('--evidence', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--tolerance', type=float, default=.05)
    parser.add_argument('--unit', choices=('m', 'source'), default='m',
                        help='Use source only for uncalibrated non-Unreal geometry diagnostics')
    args = parser.parse_args()
    if not np.isfinite(args.tolerance) or args.tolerance <= 0:
        parser.error('tolerance must be positive and finite')
    report = inspect(args.gltf, args.evidence, args.tolerance, args.unit)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key not in ('nodes', 'actorAnchorComparison')}))
    if report.get('actorAnchorComparison', {}).get('unmatched'):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
