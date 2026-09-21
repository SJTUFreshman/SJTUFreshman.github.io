#!/usr/bin/env python3
"""Render native perspective evidence from saved Cycles scenes on a Slurm GPU."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue', required=True)
    options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('Native review views require a Slurm compute allocation')
    specification = importlib.util.spec_from_file_location('world_renderer', Path(__file__).with_name('render-world-panorama.py'))
    renderer = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(renderer)
    queue = json.loads(Path(options.queue).read_text())
    for entry in queue:
        source = Path(entry['blend']).resolve()
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene = bpy.context.scene
        renderer.device(scene, 'CUDA')
        if entry.get('hdri'):
            renderer.environment(scene, SimpleNamespace(hdri=entry['hdri'], hdri_rotation=0,
                                                        environment_strength=1), {})
            for instance in scene.objects:
                if instance.type == 'LIGHT' and instance.data.type == 'SUN':
                    instance.hide_render = True
        if entry.get('panorama_output'):
            scene.cycles.samples = entry.get('samples', 128)
            scene.render.resolution_x = 4096
            scene.render.resolution_y = 2048
            scene.render.resolution_percentage = 100
            scene.render.film_transparent = True
            scene.render.filepath = str(Path(entry['panorama_output']).resolve())
            Path(scene.render.filepath).parent.mkdir(parents=True, exist_ok=True)
            bpy.ops.render.render(write_still=True)
            if entry.get('sky_output'):
                renderer.sky_image(scene, entry['sky_output'])
        scene.cycles.samples = entry.get('samples', 128)
        scene.render.resolution_x = 1600
        scene.render.resolution_y = 1100
        scene.render.resolution_percentage = 100
        scene.camera.data.type = 'PERSP'
        scene.camera.data.sensor_fit = 'VERTICAL'
        scene.camera.data.sensor_height = 24
        scene.render.film_transparent = not bool(entry.get('matched_hdri'))
        directory = Path(entry['output_dir']).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        report = {'source_blend': str(source), 'job_id': os.environ['SLURM_JOB_ID'],
                  'camera_position': list(scene.camera.location), 'native_render': True,
                  'dimensions': [1600, 1100], 'samples': scene.cycles.samples,
                  'runtime_sky_rendered': False, 'views': [], 'visual_approval': False}
        report['diagnostic_hdri'] = entry.get('hdri')
        report['camera_horizon_correction'] = json.loads(scene.world.get('camera_horizon_correction', 'null'))
        with source.open('rb') as stream:
            report['source_blend_sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
        for name, yaw, pitch, fov in entry['views']:
            azimuth, altitude = math.radians(yaw), math.radians(pitch)
            direction = Vector((math.sin(azimuth) * math.cos(altitude),
                                math.cos(azimuth) * math.cos(altitude), math.sin(altitude)))
            scene.camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
            scene.camera.data.lens = 24 / (2 * math.tan(math.radians(fov) / 2))
            prefix = entry.get('prefix', source.stem)
            target = directory / f'{prefix}-native-{name}.png'
            scene.render.filepath = str(target)
            bpy.ops.render.render(write_still=True)
            report['views'].append({'name': name, 'path': target.name, 'yaw': yaw, 'pitch': pitch,
                                    'vertical_fov': fov})
            print('NATIVE_REVIEW_OUTPUT', target, flush=True)
        prefix = entry.get('prefix', source.stem)
        (directory / f'{prefix}-native-evidence.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
