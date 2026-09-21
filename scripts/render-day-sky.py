#!/usr/bin/env python3
"""Render a physically based daytime/dusk equirectangular sky in Blender.

The output contains only sky and cloud volume (no terrain or scene geometry),
so it can be composited behind the existing constellation hit overlay. Three
coordinates use x=east, y=up, z=north; Blender uses x=east, y=north, z=up.
"""
import argparse
import json
import math
import sys
from pathlib import Path

try:
    import bpy
    from mathutils import Vector
except ImportError:
    raise SystemExit('Run with Blender: blender -b --python scripts/render-day-sky.py -- ...')


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--blend', required=True)
    parser.add_argument('--width', type=int, default=4096)
    parser.add_argument('--height', type=int, default=0)
    parser.add_argument('--samples', type=int, default=256)
    parser.add_argument('--device', choices=('CPU', 'CUDA', 'OPTIX', 'HIP', 'ONEAPI'), default='CUDA')
    parser.add_argument('--mode', choices=('clear', 'dusk'), required=True)
    parser.add_argument('--scene', default='hogwarts')
    parser.add_argument('--sun-direction', nargs=3, type=float)
    parser.add_argument('--cloud-scale', type=float, default=3.0)
    parser.add_argument('--cloud-density', type=float, default=0.003)
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:])


def read_solar_direction(args, root):
    if args.sun_direction:
        value = args.sun_direction
    else:
        scene_path = root / 'assets' / 'life' / 'panoramas' / f'{args.scene}.scene.json'
        if not scene_path.exists():
            raise SystemExit(f'Scene manifest not found: {scene_path}; pass --sun-direction X Y Z')
        value = json.loads(scene_path.read_text(encoding='utf-8')).get('environment', {}).get('sunDirection')
        if not value or len(value) != 3:
            raise SystemExit(f'Scene has no environment.sunDirection: {scene_path}')
    direction = Vector((float(value[0]), -float(value[2]), float(value[1])))
    if direction.length < 1e-6:
        raise SystemExit('Sun direction cannot be zero')
    return direction.normalized()


def setup_device(args):
    if args.device == 'CPU':
        print('CYCLES_DEVICE CPU')
        return
    try:
        preferences = bpy.context.preferences.addons['cycles'].preferences
        preferences.compute_device_type = args.device
        preferences.get_devices()
        candidates = [device for device in preferences.devices if device.type == args.device]
        for device in preferences.devices:
            device.use = device in candidates
        if not candidates:
            available = [(device.name, device.type) for device in preferences.devices]
            raise RuntimeError(f'No {args.device} device; available={available}')
        bpy.context.scene.cycles.device = 'GPU'
        print('CYCLES_DEVICE', args.device, [(device.name, device.type, device.use) for device in preferences.devices])
    except Exception as error:
        raise SystemExit(f'GPU device setup failed; refusing silent CPU fallback: {error}')


def make_sky_world(scene, mode, sun_direction):
    world = bpy.data.worlds.new(f'DaySky/{mode}')
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputWorld')
    background = nodes.new('ShaderNodeBackground')
    sky = nodes.new('ShaderNodeTexSky')
    texcoord = nodes.new('ShaderNodeTexCoord')
    separate = nodes.new('ShaderNodeSeparateXYZ')
    outgoing = nodes.new('ShaderNodeMath')
    outgoing.operation = 'MULTIPLY'
    outgoing.inputs[1].default_value = -1.0
    horizon = nodes.new('ShaderNodeMapRange')
    horizon.clamp = True
    horizon.inputs['From Min'].default_value = -1.0
    horizon.inputs['From Max'].default_value = 0.0
    horizon.inputs['To Min'].default_value = 0.0
    horizon.inputs['To Max'].default_value = 1.0
    lower = nodes.new('ShaderNodeRGB')
    lower.outputs['Color'].default_value = (0.22, 0.32, 0.5, 1.0) if mode == 'clear' else (0.35, 0.14, 0.08, 1.0)
    blend = nodes.new('ShaderNodeMixRGB')
    blend.blend_type = 'MIX'
    links.new(texcoord.outputs['Normal'], separate.inputs['Vector'])
    links.new(separate.outputs['Z'], outgoing.inputs[0])
    links.new(outgoing.outputs[0], horizon.inputs['Value'])
    links.new(horizon.outputs['Result'], blend.inputs[0])
    links.new(lower.outputs['Color'], blend.inputs[1])
    links.new(sky.outputs['Color'], blend.inputs[2])
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.asin(max(-1.0, min(1.0, sun_direction.z)))
    sky.sun_rotation = math.atan2(sun_direction.x, sun_direction.y) % math.tau
    sky.sun_disc = True
    sky.altitude = 1.5 if mode == 'clear' else 0.7
    sky.air_density = 1.0
    sky.dust_density = 1.25 if mode == 'dusk' else 0.9
    sky.ozone_density = 0.35
    sky.ground_albedo = 0.14
    background.inputs['Strength'].default_value = 0.72 if mode == 'clear' else 0.8
    links.new(blend.outputs['Color'], background.inputs['Color'])
    links.new(background.outputs['Background'], output.inputs['Surface'])
    return world


def make_cloud_volume(args):
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1700))
    cloud_box = bpy.context.object
    cloud_box.name = 'DaySky/CloudVolume'
    cloud_box.scale = (18000, 18000, 550)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    material = bpy.data.materials.new('DaySky/CloudVolumeMaterial')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    volume = nodes.new('ShaderNodeVolumePrincipled')
    volume.inputs['Color'].default_value = (0.92, 0.95, 1.0, 1)
    volume.inputs['Density'].default_value = 0.0
    volume.inputs['Anisotropy'].default_value = 0.5
    noise = nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '3D'
    noise.inputs['Scale'].default_value = args.cloud_scale
    noise.inputs['Detail'].default_value = 5.0
    noise.inputs['Roughness'].default_value = 0.68
    noise.inputs['Lacunarity'].default_value = 2.2
    texcoord = nodes.new('ShaderNodeTexCoord')
    cloud_coordinates = nodes.new('ShaderNodeVectorMath')
    cloud_coordinates.operation = 'MULTIPLY'
    cloud_coordinates.inputs[1].default_value = (32, 32, 1)
    density_ramp = nodes.new('ShaderNodeValToRGB')
    density_ramp.color_ramp.elements[0].position = 0.56
    density_ramp.color_ramp.elements[1].position = 0.69
    multiply = nodes.new('ShaderNodeMath')
    multiply.operation = 'MULTIPLY'
    multiply.inputs[1].default_value = args.cloud_density
    separate = nodes.new('ShaderNodeSeparateXYZ')
    altitude = nodes.new('ShaderNodeMapRange')
    altitude.clamp = True
    altitude.inputs['From Min'].default_value = 0.05
    altitude.inputs['From Max'].default_value = 0.22
    altitude.inputs['To Min'].default_value = 0.0
    altitude.inputs['To Max'].default_value = 1.0
    multiply_altitude = nodes.new('ShaderNodeMath')
    multiply_altitude.operation = 'MULTIPLY'
    cloud_top = nodes.new('ShaderNodeMapRange')
    cloud_top.clamp = True
    cloud_top.interpolation_type = 'SMOOTHSTEP'
    cloud_top.inputs['From Min'].default_value = 0.56
    cloud_top.inputs['From Max'].default_value = 0.93
    cloud_top.inputs['To Min'].default_value = 1.0
    cloud_top.inputs['To Max'].default_value = 0.0
    envelope = nodes.new('ShaderNodeMath')
    envelope.operation = 'MULTIPLY'
    links.new(texcoord.outputs['Generated'], cloud_coordinates.inputs[0])
    links.new(cloud_coordinates.outputs['Vector'], noise.inputs['Vector'])
    links.new(noise.outputs['Fac'], density_ramp.inputs['Fac'])
    links.new(density_ramp.outputs['Color'], multiply.inputs[0])
    links.new(texcoord.outputs['Generated'], separate.inputs['Vector'])
    links.new(separate.outputs['Z'], altitude.inputs['Value'])
    links.new(separate.outputs['Z'], cloud_top.inputs['Value'])
    links.new(altitude.outputs['Result'], envelope.inputs[0])
    links.new(cloud_top.outputs['Result'], envelope.inputs[1])
    links.new(envelope.outputs['Value'], multiply_altitude.inputs[0])
    links.new(multiply.outputs['Value'], multiply_altitude.inputs[1])
    links.new(multiply_altitude.outputs['Value'], volume.inputs['Density'])
    links.new(volume.outputs['Volume'], output.inputs['Volume'])
    cloud_box.data.materials.append(material)
    return cloud_box


def create_sun(scene, direction, mode):
    data = bpy.data.lights.new('DaySky/Sun', 'SUN')
    data.energy = 3.0 if mode == 'clear' else 1.1
    data.angle = math.radians(0.27)
    sun = bpy.data.objects.new('DaySky/Sun', data)
    scene.collection.objects.link(sun)
    sun.rotation_mode = 'QUATERNION'
    sun.rotation_quaternion = (-direction).to_track_quat('-Z', 'Y')
    return sun


def main():
    args = parse_args()
    if args.width < 256 or args.width > 16384 or args.samples < 1:
        raise SystemExit('Width must be 256..16384 and samples must be positive')
    args.height = args.height or args.width // 2
    root = Path(__file__).resolve().parents[1]
    output, blend = Path(args.output).resolve(), Path(args.blend).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.render.resolution_x, scene.render.resolution_y = args.width, args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.film_transparent = False
    scene.render.filepath = str(output)
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.volume_bounces = 4
    scene.cycles.volume_step_rate = 0.5
    setup_device(args)
    direction = read_solar_direction(args, root)
    if args.mode == 'dusk' and not args.sun_direction:
        horizontal = Vector((direction.x, direction.y, 0.0)).normalized()
        elevation = math.radians(1.36)
        direction = Vector((horizontal.x * math.cos(elevation), horizontal.y * math.cos(elevation), math.sin(elevation)))
    make_sky_world(scene, args.mode, direction)
    make_cloud_volume(args)
    create_sun(scene, direction, args.mode)
    camera_data = bpy.data.cameras.new('DaySky/EquirectangularCamera')
    camera_data.type = 'PANO'
    camera_data.panorama_type = 'EQUIRECTANGULAR'
    camera_data.longitude_min = -math.pi
    camera_data.longitude_max = math.pi
    camera_data.latitude_min = -math.pi / 2
    camera_data.latitude_max = math.pi / 2
    camera_data.lens = 18
    camera = bpy.data.objects.new('DaySky/EquirectangularCamera', camera_data)
    scene.collection.objects.link(camera)
    camera.rotation_euler = (math.pi / 2, 0.0, 0.0)
    scene.camera = camera
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 0.0
    print('DAY_SKY', json.dumps({'mode': args.mode, 'sun_direction_blender': list(direction), 'resolution': [args.width, args.height], 'samples': args.samples}))
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.render.render(write_still=True)
    print('DAY_SKY_OUTPUT', output)
    print('DAY_SKY_BLEND', blend)


if __name__ == '__main__':
    main()
