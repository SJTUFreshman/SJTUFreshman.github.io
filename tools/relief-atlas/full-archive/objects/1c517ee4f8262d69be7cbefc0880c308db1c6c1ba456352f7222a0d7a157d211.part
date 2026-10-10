import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--sun-elevation', type=float, default=32.0)
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    reports = {}
    for map_id in ('shengsi', 'china', 'hainan', 'fujian_taiwan'):
        scene_path = arguments.root / 'scenes' / (map_id + '.blend')
        bpy.ops.wm.open_mainfile(filepath=str(scene_path))
        scene = bpy.context.scene
        layout = json.loads((arguments.root / 'data' / (map_id + '_layout.json')).read_text(encoding='utf-8'))
        lighting = json.loads(scene['lighting'])
        sun_objects = [item for item in scene.objects if item.type == 'LIGHT' and item.data.type == 'SUN']
        assert len(sun_objects) == 1, map_id
        sun = sun_objects[0]
        direction = sun.matrix_world.to_quaternion() @ Vector((0, 0, -1))
        elevation = math.degrees(math.asin(-direction.z))
        azimuth = math.degrees(math.atan2(-direction.x, -direction.y)) % 360
        assert abs(elevation - arguments.sun_elevation) < 0.001, (map_id, elevation)
        assert abs(azimuth - lighting['sun_azimuth_degrees_clockwise_from_north']) < 0.001, (map_id, azimuth)
        assert lighting == layout['lighting'], map_id
        assert abs(sun.data.energy - lighting['sun_energy']) < 0.0001, map_id
        assert scene.render.resolution_percentage == 100, map_id
        assert (scene.render.resolution_x, scene.render.resolution_y) == (layout['width'], layout['height']), map_id
        assert scene.cycles.samples == 96 and scene.cycles.device == 'GPU', map_id
        assert scene.use_nodes, map_id
        overlays = [node.image for node in scene.node_tree.nodes if node.type == 'IMAGE']
        assert len(overlays) == 1 and overlays[0].packed_file, map_id
        expected_labels = arguments.root / 'outputs' / (map_id + '_labels.png')
        packed_hash = hashlib.sha256(overlays[0].packed_file.data).hexdigest()
        assert packed_hash == hashlib.sha256(expected_labels.read_bytes()).hexdigest(), map_id
        reports[map_id] = {'sun_elevation_degrees': elevation, 'sun_azimuth_degrees': azimuth,
                           'lighting': lighting, 'packed_labels_sha256': packed_hash,
                           'scene_sha256': hashlib.sha256(scene_path.read_bytes()).hexdigest(),
                           'resolution_percentage': scene.render.resolution_percentage,
                           'samples': scene.cycles.samples, 'status': 'passed'}
    destination = arguments.root / 'logs' / 'scene_lighting_report.json'
    destination.write_text(json.dumps(reports, indent=2), encoding='utf-8')
    print('SCENE LIGHTING VERIFIED', json.dumps(reports), flush=True)


if __name__ == '__main__':
    main()
