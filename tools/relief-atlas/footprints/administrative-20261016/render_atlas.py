import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


SPECS = {
    'shengsi': {'size': (2400, 1600), 'rect': (150, 300, 2250, 1310), 'background': '#7fa5b5', 'exaggeration': 6.0},
    'china': {'size': (2480, 2000), 'rect': (275, 315, 2250, 1760), 'background': '#dad5c3', 'exaggeration': 22.0},
    'hainan': {'size': (2000, 2400), 'rect': (260, 175, 1810, 2180), 'background': '#dcddda', 'exaggeration': 13.0},
    'fujian_taiwan': {'size': (2000, 2300), 'rect': (240, 300, 1790, 2015), 'background': '#dad5c3', 'exaggeration': 7.0},
}
PALETTE = ['#c9ad65', '#a9bc9a', '#c49a8b', '#a5bdc0', '#d2c6a6', '#afa4b9', '#b7c7a6', '#d0b880']
REGION_COLORS = {
    'china': {
        1: 4, 2: 3, 3: 1, 4: 3, 5: 0, 6: 2, 7: 1, 8: 3,
        9: 4, 10: 1, 11: 5, 12: 4, 13: 0, 14: 1, 15: 5, 16: 2,
        17: 0, 18: 2, 19: 3, 20: 4, 21: 2, 22: 5, 23: 4, 24: 0,
        25: 2, 26: 3, 27: 1, 28: 2, 29: 5, 30: 3, 31: 4, 32: 3,
    },
    'fujian_taiwan': {1: 1, 2: 2, 3: 3, 4: 2, 5: 0, 6: 1, 7: 4, 8: 5, 9: 0},
}


def linear_color(value):
    channels = np.array([int(value[index:index + 2], 16) / 255.0 for index in (1, 3, 5)])
    return np.where(channels < 0.04045, channels / 12.92, ((channels + 0.055) / 1.055) ** 2.4)


def matte_material(name, color, emission=False):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*linear_color(color), 1)
    nodes = material.node_tree.nodes
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*linear_color(color), 1)
    shader.inputs['Roughness'].default_value = 0.95
    shader.inputs['Specular IOR Level'].default_value = 0.15
    if emission:
        nodes.remove(shader)
        shader = nodes.new('ShaderNodeEmission')
        shader.inputs['Color'].default_value = (*linear_color(color), 1)
        shader.inputs['Strength'].default_value = 1
        material.node_tree.links.new(shader.outputs[0], nodes.get('Material Output').inputs['Surface'])
    return material


def terrain_material(map_id):
    material = matte_material('Terrain / matte cartographic pigments', '#d9e2df')
    nodes = material.node_tree.nodes
    attribute = nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'ReliefColor'
    material.node_tree.links.new(attribute.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
    return material


def make_terrain(map_id, data, spec, world_per_km, center_x, center_y):
    elevation = data['elevation'].astype(np.float32)
    mask = data['mask'].astype(bool) & np.isfinite(elevation)
    if map_id == 'hainan':
        mask &= ~((data['x'][None, :] < -41.84) & (data['y'][:, None] > 33.40))
    region = data['region'].astype(np.int32)
    rows, columns = elevation.shape
    indices = np.full((rows, columns), -1, dtype=np.int32)
    indices[mask] = np.arange(np.count_nonzero(mask), dtype=np.int32)
    selected_rows, selected_columns = np.nonzero(mask)
    heights = np.maximum(elevation[mask], 0)
    positions = np.empty((len(heights), 3), dtype=np.float32)
    positions[:, 0] = (data['x'][selected_columns] - center_x) * world_per_km
    positions[:, 1] = (data['y'][selected_rows] - center_y) * world_per_km
    positions[:, 2] = 0.008 + heights * world_per_km * spec['exaggeration'] / 1000
    face_mask = mask[:-1, :-1] & mask[1:, :-1] & mask[1:, 1:] & mask[:-1, 1:]
    faces = np.column_stack((indices[:-1, :-1][face_mask], indices[1:, :-1][face_mask], indices[1:, 1:][face_mask], indices[:-1, 1:][face_mask]))
    mesh = bpy.data.meshes.new('DEM surface / actual elevation samples')
    mesh.vertices.add(len(positions))
    mesh.vertices.foreach_set('co', positions.ravel())
    mesh.loops.add(faces.size)
    mesh.loops.foreach_set('vertex_index', faces.ravel())
    mesh.polygons.add(len(faces))
    mesh.polygons.foreach_set('loop_start', np.arange(0, faces.size, 4, dtype=np.int32))
    mesh.polygons.foreach_set('loop_total', np.full(len(faces), 4, dtype=np.int32))
    mesh.polygons.foreach_set('use_smooth', np.ones(len(faces), dtype=bool))
    mesh.update()
    terrain = bpy.data.objects.new('Terrain / ' + map_id, mesh)
    bpy.context.collection.objects.link(terrain)
    mesh.materials.append(terrain_material(map_id))
    colors = np.ones((len(positions), 4), dtype=np.float32)
    if map_id == 'hainan':
        low_color = linear_color('#badce8')
        high_color = linear_color('#12648d')
        blend = np.clip(heights / 1250, 0, 1) ** 0.75
        colors[:, :3] = low_color[None, :] * (1 - blend[:, None]) + high_color[None, :] * blend[:, None]
    elif map_id == 'shengsi':
        colors[:, :3] = linear_color('#e0e6df')
    else:
        palette = np.array([linear_color(color) for color in PALETTE])
        palette_indices = np.maximum(region[mask] - 1, 0) % len(PALETTE)
        for region_id, palette_index in REGION_COLORS.get(map_id, {}).items():
            palette_indices[region[mask] == region_id] = palette_index
        colors[:, :3] = palette[palette_indices]
    color_attribute = mesh.color_attributes.new(name='ReliefColor', type='FLOAT_COLOR', domain='POINT')
    color_attribute.data.foreach_set('color', colors.ravel())
    terrain['source'] = 'AWS Terrain Tiles / Terrarium decoded DEM'
    terrain['elevation_unit'] = 'metres'
    terrain['vertical_exaggeration'] = spec['exaggeration']
    print('MESH', map_id, len(positions), 'vertices', len(faces), 'quads', 'max height', float(heights.max()), flush=True)
    return terrain


def setup_lighting(sun_elevation=32.0):
    if not 5 <= sun_elevation <= 85:
        raise ValueError('Sun elevation must be between 5 and 85 degrees')
    elevation_radians = math.radians(sun_elevation)
    horizontal_direction = Vector((0.55, -0.70, 0)).normalized()
    reference_elevation = math.atan2(1.0, math.hypot(0.55, 0.70))
    world = bpy.data.worlds.new('Soft skylight')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
    bpy.context.scene.world = world
    light_data = bpy.data.lights.new('North-west sun / relief shadows', 'SUN')
    light_data.energy = 2.6 * math.sin(reference_elevation) / math.sin(elevation_radians)
    light_data.angle = math.radians(3)
    light = bpy.data.objects.new('North-west sun / relief shadows', light_data)
    bpy.context.collection.objects.link(light)
    direction = Vector((horizontal_direction.x * math.cos(elevation_radians),
                        horizontal_direction.y * math.cos(elevation_radians),
                        -math.sin(elevation_radians)))
    light.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    lighting = {'sun_elevation_degrees': sun_elevation,
                'sun_azimuth_degrees_clockwise_from_north': math.degrees(math.atan2(-0.55, 0.70)) % 360,
                'sun_energy': light_data.energy, 'sun_angular_diameter_degrees': 3.0,
                'world_strength': 0.45, 'horizontal_illuminance_matched_to_previous': True}
    bpy.context.scene['lighting'] = json.dumps(lighting)
    return lighting


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--map', choices=list(SPECS), required=True)
    parser.add_argument('--samples', type=int, default=96)
    parser.add_argument('--sun-elevation', type=float, default=32.0)
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    spec = SPECS[args.map]
    root = args.root
    for directory in ('renders', 'scenes'):
        (root / directory).mkdir(exist_ok=True, parents=True)
    data = np.load(root / 'data' / (args.map + '.npz'))
    metadata = json.loads((root / 'data' / (args.map + '.json')).read_text(encoding='utf-8'))
    extent = [float(data['x'][0]), float(data['y'][-1]), float(data['x'][-1]), float(data['y'][0])]
    width, height = spec['size']
    rect_left, rect_top, rect_right, rect_bottom = spec['rect']
    span_x, span_y = extent[2] - extent[0], extent[3] - extent[1]
    pixel_per_km = min((rect_right - rect_left) / span_x, (rect_bottom - rect_top) / span_y)
    fit_width, fit_height = span_x * pixel_per_km, span_y * pixel_per_km
    fit_left = (rect_left + rect_right - fit_width) / 2
    fit_top = (rect_top + rect_bottom - fit_height) / 2
    map_rect = [fit_left, fit_top, fit_left + fit_width, fit_top + fit_height]
    world_per_pixel = 24 / height
    world_per_km = pixel_per_km * world_per_pixel
    center_x, center_y = (extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    make_terrain(args.map, data, spec, world_per_km, center_x, center_y)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = 'Sea / paper backdrop'
    ground.data.materials.append(matte_material('Sea / paper', spec['background']))
    camera_data = bpy.data.cameras.new('Orthographic atlas camera')
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 24 * max(width / height, 1)
    camera = bpy.data.objects.new('Orthographic atlas camera', camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = ((width / 2 - (fit_left + fit_width / 2)) * world_per_pixel,
                       ((fit_top + fit_height / 2) - height / 2) * world_per_pixel, 50)
    camera.rotation_euler = (0, 0, 0)
    scene.camera = camera
    lighting = setup_lighting(args.sun_elevation)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32 if args.preview else args.samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 5
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 1
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = 'CUDA'
    preferences.get_devices()
    gpu_devices = []
    for device in preferences.devices:
        device.use = device.type == 'CUDA'
        if device.use:
            gpu_devices.append(device.name)
    if not gpu_devices:
        raise RuntimeError('No CUDA device visible; refuse accidental CPU rendering')
    scene.cycles.device = 'GPU'
    print('CUDA DEVICES', gpu_devices, flush=True)
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 50 if args.preview else 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'Medium High Contrast' if 'Medium High Contrast' in [item.identifier for item in scene.view_settings.bl_rna.properties['look'].enum_items] else 'None'
    scene.view_settings.exposure = -0.4
    scene.view_settings.gamma = 1
    scene.render.filepath = str(root / 'renders' / (args.map + '_terrain.png'))
    bpy.context.preferences.filepaths.save_version = 0
    layout = {'width': width, 'height': height, 'map_rect': map_rect, 'extent_km': extent,
              'projection': metadata.get('projection', metadata.get('crs_wkt', metadata.get('crs'))),
              'background': spec['background'], 'vertical_exaggeration': spec['exaggeration'],
              'render_engine': 'Blender 4.5.3 / Cycles CUDA', 'gpu_devices': gpu_devices,
              'samples': scene.cycles.samples, 'lighting': lighting}
    (root / 'data' / (args.map + '_layout.json')).write_text(json.dumps(layout, ensure_ascii=False, indent=2), encoding='utf-8')
    scene['cartographic_note'] = 'Artistic shaded relief; exaggerated elevation. See data provenance and limitations in README.'
    bpy.ops.wm.save_as_mainfile(filepath=str(root / 'scenes' / (args.map + '.blend')), compress=True)
    bpy.ops.render.render(write_still=True)
    print('COMPLETE', args.map, scene.render.filepath, flush=True)


if __name__ == '__main__':
    main()
