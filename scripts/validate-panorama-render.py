#!/usr/bin/env python3
"""Render six emissive axis markers and verify actual equirectangular pixels."""
import argparse
import json
import math
import os
import socket
import sys
from pathlib import Path

import bpy
from mathutils import Vector


MARKERS = (
    {'name': 'three-positive-x-east', 'position': (3, 0, 0), 'color': (1, 0, 0), 'uv': (.75, .5)},
    {'name': 'three-negative-x-west', 'position': (-3, 0, 0), 'color': (0, 1, 1), 'uv': (.25, .5)},
    {'name': 'three-negative-z-front', 'position': (0, 3, 0), 'color': (0, 1, 0), 'uv': (.5, .5)},
    {'name': 'three-positive-z-back', 'position': (0, -3, 0), 'color': (1, 0, 1), 'uv': (0, .5)},
    {'name': 'three-positive-y-up', 'position': (0, 0, 3), 'color': (0, 0, 1), 'uv': (.5, 0)},
    {'name': 'three-negative-y-down', 'position': (0, 0, -3), 'color': (1, 1, 0), 'uv': (.5, 1)},
)


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--sizes', default='64x32,256x128')
    parser.add_argument('--device', choices=('CPU', 'CUDA', 'OPTIX'), default='CPU')
    arguments = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return parser.parse_args(arguments)


def require_compute_allocation():
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('This render diagnostic must run inside a Slurm allocation on a compute node.')
    allocation_nodes = os.environ.get('SLURM_JOB_NODELIST', os.environ.get('SLURM_NODELIST', ''))
    if not allocation_nodes:
        raise RuntimeError('Slurm allocation has no assigned compute-node list.')
    print('COMPUTE_ALLOCATION', json.dumps({
        'job': os.environ['SLURM_JOB_ID'],
        'nodes': allocation_nodes,
        'hostname': socket.gethostname(),
    }), flush=True)


def configure_device(scene, requested):
    scene.cycles.device = 'CPU' if requested == 'CPU' else 'GPU'
    if requested == 'CPU':
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = min(4, max(1, int(os.environ.get('SLURM_CPUS_PER_TASK', '1'))))
        print('PANORAMA_DIAGNOSTIC_DEVICE CPU explicit, tiny render', flush=True)
        return
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = requested
    preferences.get_devices()
    for candidate in preferences.devices:
        candidate.use = candidate.type == requested
    active = [candidate for candidate in preferences.devices if candidate.use]
    print('PANORAMA_DIAGNOSTIC_DEVICE', requested,
          [(candidate.name, candidate.type, candidate.use) for candidate in preferences.devices], flush=True)
    if not active:
        raise RuntimeError(f'No active {requested} device; no implicit CPU fallback.')


def build_scene(requested_device):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 0
    configure_device(scene, requested_device)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.world = bpy.data.worlds.new('Orientation black background')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0

    for marker in MARKERS:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=.6, location=marker['position'])
        instance = bpy.context.object
        instance.name = marker['name']
        material = bpy.data.materials.new(marker['name'])
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        shader = nodes.new('ShaderNodeEmission')
        shader.inputs['Color'].default_value = marker['color'] + (1,)
        shader.inputs['Strength'].default_value = 1
        output = nodes.new('ShaderNodeOutputMaterial')
        material.node_tree.links.new(shader.outputs[0], output.inputs['Surface'])
        instance.data.materials.append(material)

    camera_data = bpy.data.cameras.new('Equirectangular axis diagnostic')
    camera_data.type = 'PANO'
    camera_data.panorama_type = 'EQUIRECTANGULAR'
    camera_data.longitude_min = -math.pi
    camera_data.longitude_max = math.pi
    camera_data.latitude_min = -math.pi / 2
    camera_data.latitude_max = math.pi / 2
    camera = bpy.data.objects.new('Equirectangular axis diagnostic', camera_data)
    scene.collection.objects.link(camera)
    camera.location = (0, 0, 0)
    camera.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = camera
    bpy.context.view_layer.update()
    print('CAMERA_WORLD_FORWARD', tuple(camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))), flush=True)
    print('CAMERA_WORLD_UP', tuple(camera.matrix_world.to_quaternion() @ Vector((0, 1, 0))), flush=True)
    return scene


def sample_image(image, horizontal, top_vertical):
    width, height = image.size
    column = min(width - 1, max(0, int(horizontal * width)))
    top_row = min(height - 1, max(0, int(top_vertical * height)))
    bottom_row = height - 1 - top_row
    offset = (bottom_row * width + column) * image.channels
    return {'column': column, 'top_row': top_row, 'blender_bottom_row': bottom_row,
            'rgba': list(image.pixels[offset:offset + 4])}


def verify_image(source):
    image = bpy.data.images.load(str(source), check_existing=False)
    image.colorspace_settings.name = 'sRGB'
    samples = []
    failures = []
    for marker in MARKERS:
        result = sample_image(image, *marker['uv'])
        passed = all(actual > .75 if expected else actual < .12
                     for actual, expected in zip(result['rgba'][:3], marker['color']))
        result.update({'name': marker['name'], 'expected_top_origin_uv': marker['uv'],
                       'expected_rgb': marker['color'], 'passed': passed})
        samples.append(result)
        if not passed:
            failures.append(marker['name'])
    seam_sample = sample_image(image, 1, .5)
    seam_ok = seam_sample['rgba'][0] > .75 and seam_sample['rgba'][1] < .12 and seam_sample['rgba'][2] > .75
    samples.append({'name': 'back-wrap-right-edge', 'passed': seam_ok, **seam_sample})
    if not seam_ok:
        failures.append('back-wrap-right-edge')
    bpy.data.images.remove(image)
    return {'file': str(source), 'samples': samples, 'failures': failures, 'passed': not failures}


def main():
    arguments = parse_arguments()
    require_compute_allocation()
    resolutions = []
    for value in arguments.sizes.split(','):
        width, height = map(int, value.lower().split('x'))
        if width != height * 2 or not 16 <= height <= 256:
            raise ValueError('Diagnostic sizes must be 2:1 and between 32x16 and 512x256.')
        resolutions.append((width, height))
    directory = Path(arguments.output_dir).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    scene = build_scene(arguments.device)
    results = []
    for width, height in resolutions:
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        target = directory / f'panorama-axis-{width}x{height}.png'
        scene.render.filepath = str(target)
        bpy.ops.render.render(write_still=True)
        result = verify_image(target)
        results.append(result)
        print('PANORAMA_AXIS_RESULT', json.dumps(result), flush=True)
    report = {'device': arguments.device, 'job': os.environ['SLURM_JOB_ID'],
              'hostname': socket.gethostname(), 'projection': 'EQUIRECTANGULAR',
              'camera_euler': [math.pi / 2, 0, 0], 'sampling_origin': 'top-left converted to Blender bottom-up',
              'passed': all(result['passed'] for result in results), 'renders': results}
    report_path = directory / 'panorama-axis-report.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print('PANORAMA_AXIS_REPORT', report_path, 'PASS' if report['passed'] else 'FAIL', flush=True)
    if not report['passed']:
        raise RuntimeError('Actual Blender panorama orientation differs from the web texture convention; see report.')


if __name__ == '__main__':
    main()
