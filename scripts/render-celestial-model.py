import argparse
import hashlib
import json
import math
import os
import sys
import time
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector


BODIES = ('sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune')


def arguments():
    parser = argparse.ArgumentParser()
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--body', choices=BODIES, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--width', type=int, default=3840)
    parser.add_argument('--height', type=int, default=2160)
    parser.add_argument('--samples', type=int, default=64)
    parser.add_argument('--azimuth-count', type=int, default=180)
    parser.add_argument('--elevations', default='-90,-60,-30,0,30,60,90')
    parser.add_argument('--frames', default='3:0')
    parser.add_argument('--device', choices=('CUDA', 'OPTIX'), default='CUDA')
    parser.add_argument('--halo', type=float, default=0.12)
    parser.add_argument('--longitude', type=float, default=0)
    parser.add_argument('--exposure', type=float, default=0)
    parser.add_argument('--sun-strength', type=float, default=3)
    parser.add_argument('--light-elevation', type=float, default=18)
    parser.add_argument('--light-azimuth', type=float, default=55)
    parser.add_argument('--texture-limit', type=int, default=0)
    parser.add_argument('--real-atmosphere', action='store_true')
    parser.add_argument('--cloud-relief', type=float, default=1)
    parser.add_argument('--framing', choices=('close-up', 'full-sphere'), default='close-up')
    parser.add_argument('--frame-margin', type=float, default=0.06)
    parser.add_argument('--layers', choices=('composite', 'split'), default='composite')
    parser.add_argument('--cloud-objects', help='Comma-separated object names; otherwise detect cloud meshes by object or material name.')
    parser.add_argument('--ring-objects', help='Comma-separated ring mesh names; otherwise detect ring meshes by object or material name.')
    parser.add_argument('--independent-ring-framing', action='store_true')
    parser.add_argument('--cloud-longitude', type=float, default=0)
    parser.add_argument('--cloud-texture', type=Path)
    parser.add_argument('--cloud-only', action='store_true')
    parser.add_argument('--climate-time', type=int)
    parser.add_argument('--climate-model', default='moisture-lifecycle-v2.1')
    parser.add_argument('--climate-frame-count', type=int, default=8)
    parser.add_argument('--climate-step-hours', type=float, default=3)
    parser.add_argument('--climate-time-pad', type=int, default=3)
    parser.add_argument('--blend', type=Path)
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--format', choices=('PNG', 'WEBP'), default='WEBP')
    parser.add_argument('--quality', type=int, default=90)
    parser.add_argument('--tier', choices=('auto', '2k', '4k', '8k'), default='auto')
    parser.add_argument('--shard-index', type=int, default=0)
    parser.add_argument('--shard-count', type=int, default=1)
    parser.add_argument('--threads', type=int, default=12)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.elevations = [float(value) for value in args.elevations.split(',')]
    if not args.elevations or any(not math.isfinite(value) or abs(value) > 90 for value in args.elevations):
        parser.error('Elevations must be finite values between -90 and 90.')
    if args.azimuth_count < 2 or min(args.width, args.height, args.samples, args.threads) < 1:
        parser.error('Invalid render size, samples or azimuth count.')
    if not 0 <= args.shard_index < args.shard_count or not 1 <= args.quality <= 100:
        parser.error('Invalid shard or image quality.')
    if not math.isfinite(args.frame_margin) or not 0.01 <= args.frame_margin <= 0.25:
        parser.error('--frame-margin must be between 0.01 and 0.25.')
    if not math.isfinite(args.cloud_longitude):
        parser.error('--cloud-longitude must be finite.')
    if args.layers == 'split' and args.framing != 'full-sphere':
        parser.error('Separate cloud layers require --framing full-sphere.')
    if args.independent_ring_framing and (args.layers != 'split' or args.framing != 'full-sphere'):
        parser.error('--independent-ring-framing requires --framing full-sphere --layers split.')
    if args.cloud_only and (args.layers != 'split' or args.framing != 'full-sphere'):
        parser.error('--cloud-only requires --framing full-sphere --layers split.')
    if args.cloud_only and args.climate_time is None:
        parser.error('--cloud-only requires --climate-time.')
    if args.climate_time is not None and args.climate_time < 0:
        parser.error('--climate-time must be nonnegative.')
    if args.climate_frame_count < 2 or args.climate_frame_count > 4096:
        parser.error('--climate-frame-count must be between 2 and 4096.')
    if not math.isfinite(args.climate_step_hours) or args.climate_step_hours <= 0:
        parser.error('--climate-step-hours must be positive and finite.')
    if not 0 <= args.climate_time_pad <= 6:
        parser.error('--climate-time-pad must be between 0 and 6.')
    if args.climate_time is not None and args.climate_time >= args.climate_frame_count:
        parser.error('--climate-time must be smaller than --climate-frame-count.')
    if args.cloud_texture and not args.cloud_texture.is_absolute():
        args.cloud_texture = args.cloud_texture.resolve()
    try:
        args.frames = parse_frame_selection(args.frames, len(args.elevations), args.azimuth_count)
    except ValueError as error:
        parser.error(str(error))
    if any(len(pair) != 2 or not 0 <= pair[0] < len(args.elevations) or not 0 <= pair[1] < args.azimuth_count for pair in args.frames):
        parser.error('Invalid row:column frame index.')
    args.frames.sort(key=lambda pair: (abs(args.elevations[pair[0]]), pair[0], pair[1]))
    total_frames = len(args.frames)
    args.frames = args.frames[args.shard_index * total_frames // args.shard_count:(args.shard_index + 1) * total_frames // args.shard_count]
    if not args.frames:
        parser.error('This shard contains no frames.')
    return args


def parse_frame_selection(specification, row_count, column_count):
    if specification == 'all':
        return [(row, column) for row in range(row_count) for column in range(column_count)]
    frames = []
    for selection in specification.split(','):
        row, columns = selection.split(':')
        endpoints = columns.split('-')
        if len(endpoints) == 1:
            first = last = int(endpoints[0])
        elif len(endpoints) == 2:
            first, last = map(int, endpoints)
        else:
            raise ValueError('Frames must use ROW:COLUMN or ROW:FIRST-LAST.')
        if first > last:
            raise ValueError('Frame ranges must be in increasing order.')
        frames.extend((int(row), column) for column in range(first, last + 1))
    if len(frames) != len(set(frames)):
        raise ValueError('Frame selections must not overlap.')
    if any(not 0 <= row < row_count or not 0 <= column < column_count for row, column in frames):
        raise ValueError('Frame selection is outside the angle grid.')
    return frames


def climate_time_directory(time_index, time_pad):
    return f't{time_index:0{time_pad}d}'


def render_report_path(output, args):
    time_suffix = f'-{climate_time_directory(args.climate_time, args.climate_time_pad)}' if args.climate_time is not None else ''
    return output / f'render{time_suffix}-{args.frames[0][0]}-{args.frames[0][1]}.json'


def texture_key(value):
    return ''.join(character for character in value.lower() if character.isalnum())


def relink_images(root, texture_limit):
    paths = list((root / 'Derived').glob('*.png')) + list((root / 'Textures').rglob('*.png'))
    aliases = {'earthcloudsmapa': 'earthcloudsamap', 'earthcloudsmapb': 'earthcloudsbmap'}
    used = set()
    visited = set()

    def collect_images(tree):
        if tree in visited:
            return
        visited.add(tree)
        for node in tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                used.add(node.image)
            elif node.type == 'GROUP' and node.node_tree:
                collect_images(node.node_tree)

    for obj in bpy.context.scene.objects:
        if obj.type == 'MESH':
            for material in obj.data.materials:
                if material and material.use_nodes:
                    collect_images(material.node_tree)
    records = []
    for image in bpy.data.images:
        if image.source != 'FILE' or image not in used:
            continue
        original = image.filepath
        name = Path(original.replace('\\', '/')).name
        key = texture_key(Path(name).stem)
        key = aliases.get(key, key)
        matches = [path for path in paths if texture_key(path.stem) == key]
        if not matches:
            name_key = texture_key(Path(image.name.removesuffix('.001')).stem)
            matches = [path for path in paths if texture_key(path.stem) == aliases.get(name_key, name_key)]
        chosen = min(matches, key=lambda path: {'Derived': 0, 'Textures23K': 1}.get(path.parent.name, 2)) if matches else None
        if chosen:
            image.filepath = str(chosen.resolve())
            image.reload()
            if texture_limit and max(image.size) > texture_limit:
                ratio = texture_limit / max(image.size)
                image.scale(round(image.size[0] * ratio), round(image.size[1] * ratio))
        elif not image.packed_file and image.users:
            raise FileNotFoundError(f'Unresolved material image: {image.name}: {original}')
        record = {'name': image.name, 'original': original, 'path': str(chosen) if chosen else original, 'size': list(image.size)}
        if chosen and chosen.with_suffix('.json').is_file():
            record['provenance'] = json.loads(chosen.with_suffix('.json').read_text(encoding='utf-8'))
        records.append(record)
    print('TEXTURES_READY', json.dumps(records), flush=True)
    return records


def configure_gpu(scene, device_type):
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = device_type
    preferences.refresh_devices()
    enabled = []
    for device in preferences.devices:
        device.use = device.type == device_type
        if device.use:
            enabled.append(device.name)
    if not enabled:
        raise RuntimeError(f'No {device_type} GPU available.')
    scene.cycles.device = 'GPU'
    print('GPU', device_type, enabled, flush=True)


def add_limb_haze(body, primary, strength, light_direction):
    colors = {
        'earth': (0.08, 0.38, 1.0), 'mars': (0.8, 0.26, 0.08),
        'venus': (1.0, 0.7, 0.36), 'jupiter': (0.7, 0.77, 0.9),
        'saturn': (1.0, 0.8, 0.52), 'uranus': (0.25, 0.82, 0.92),
        'neptune': (0.15, 0.4, 0.9), 'sun': (1.0, 0.32, 0.055),
    }
    if body not in colors or strength <= 0:
        return
    material = bpy.data.materials.new('Added thin limb haze')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    geometry = nodes.new('ShaderNodeNewGeometry')
    local_position = nodes.new('ShaderNodeVectorTransform')
    local_position.vector_type = 'POINT'
    local_position.convert_from = 'WORLD'
    local_position.convert_to = 'OBJECT'
    links.new(geometry.outputs['Position'], local_position.inputs[0])
    local_incoming = nodes.new('ShaderNodeVectorTransform')
    local_incoming.vector_type = 'VECTOR'
    local_incoming.convert_from = 'WORLD'
    local_incoming.convert_to = 'OBJECT'
    links.new(geometry.outputs['Incoming'], local_incoming.inputs[0])
    radial = nodes.new('ShaderNodeVectorMath')
    radial.operation = 'NORMALIZE'
    links.new(local_position.outputs[0], radial.inputs[0])
    incoming = nodes.new('ShaderNodeVectorMath')
    incoming.operation = 'NORMALIZE'
    links.new(local_incoming.outputs[0], incoming.inputs[0])
    facing = nodes.new('ShaderNodeVectorMath')
    facing.operation = 'DOT_PRODUCT'
    links.new(radial.outputs[0], facing.inputs[0])
    links.new(incoming.outputs[0], facing.inputs[1])
    absolute = nodes.new('ShaderNodeMath')
    absolute.operation = 'ABSOLUTE'
    links.new(facing.outputs['Value'], absolute.inputs[0])
    inverse = nodes.new('ShaderNodeMath')
    inverse.operation = 'SUBTRACT'
    inverse.inputs[0].default_value = 1
    links.new(absolute.outputs[0], inverse.inputs[1])
    power = nodes.new('ShaderNodeMath')
    power.operation = 'POWER'
    power.inputs[1].default_value = 5
    links.new(inverse.outputs[0], power.inputs[0])
    interior = nodes.new('ShaderNodeMath')
    interior.operation = 'MULTIPLY'
    interior.use_clamp = True
    interior.inputs[1].default_value = 3.7
    links.new(power.outputs[0], interior.inputs[0])
    squared = nodes.new('ShaderNodeMath')
    squared.operation = 'MULTIPLY'
    links.new(absolute.outputs[0], squared.inputs[0])
    links.new(absolute.outputs[0], squared.inputs[1])
    sine_squared = nodes.new('ShaderNodeMath')
    sine_squared.operation = 'SUBTRACT'
    sine_squared.inputs[0].default_value = 1
    sine_squared.use_clamp = True
    links.new(squared.outputs[0], sine_squared.inputs[1])
    sine = nodes.new('ShaderNodeMath')
    sine.operation = 'SQRT'
    links.new(sine_squared.outputs[0], sine.inputs[0])
    altitude = nodes.new('ShaderNodeMath')
    altitude.operation = 'MULTIPLY_ADD'
    altitude.inputs[1].default_value = 1.026
    altitude.inputs[2].default_value = -1
    altitude.use_clamp = True
    links.new(sine.outputs[0], altitude.inputs[0])
    scale_height = nodes.new('ShaderNodeMath')
    scale_height.operation = 'MULTIPLY'
    scale_height.inputs[1].default_value = -1 / 0.0045
    links.new(altitude.outputs[0], scale_height.inputs[0])
    extinction = nodes.new('ShaderNodeMath')
    extinction.operation = 'EXPONENT'
    links.new(scale_height.outputs[0], extinction.inputs[0])
    optical_depth = nodes.new('ShaderNodeMath')
    optical_depth.operation = 'MULTIPLY'
    links.new(interior.outputs[0], optical_depth.inputs[0])
    links.new(extinction.outputs[0], optical_depth.inputs[1])
    solar = nodes.new('ShaderNodeVectorMath')
    solar.operation = 'DOT_PRODUCT'
    solar.inputs[1].default_value = light_direction
    links.new(geometry.outputs['Normal'], solar.inputs[0])
    daylight = nodes.new('ShaderNodeMapRange')
    daylight.inputs['From Min'].default_value = -0.1
    daylight.inputs['From Max'].default_value = 0.4
    daylight.inputs['To Min'].default_value = 0.015
    daylight.inputs['To Max'].default_value = strength
    links.new(solar.outputs['Value'], daylight.inputs['Value'])
    mask = nodes.new('ShaderNodeMath')
    mask.operation = 'MULTIPLY'
    links.new(optical_depth.outputs[0], mask.inputs[0])
    links.new(daylight.outputs['Result'], mask.inputs[1])
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (*colors[body], 1)
    emission.inputs['Strength'].default_value = 2.2
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    mix = nodes.new('ShaderNodeMixShader')
    links.new(mask.outputs[0], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emission.outputs[0], mix.inputs[2])
    output = nodes.new('ShaderNodeOutputMaterial')
    links.new(mix.outputs[0], output.inputs['Surface'])
    corners = [Vector(corner) for corner in primary.bound_box]
    local_center = sum(corners, Vector()) / len(corners)
    axes = Vector(tuple(max(corner[axis] for corner in corners) - min(corner[axis] for corner in corners) for axis in range(3))) * 0.5
    bpy.ops.mesh.primitive_uv_sphere_add(segments=256, ring_count=128, radius=1)
    shell = bpy.context.object
    shell.name = 'Added thin limb haze'
    shell.parent = primary
    shell.location = local_center
    shell.scale = axes * 1.026
    shell.visible_shadow = False
    shell.data.materials.append(material)
    for polygon in shell.data.polygons:
        polygon.use_smooth = True


def cloud_meshes(scene, primary, requested_names):
    if requested_names:
        names = [name.strip() for name in requested_names.split(',')]
        objects = [scene.objects.get(name) for name in names]
        if any(obj is None or obj.type != 'MESH' or obj.hide_render or obj == primary for obj in objects):
            raise ValueError('--cloud-objects must name visible cloud meshes distinct from the primary body.')
        return objects
    return [obj for obj in scene.objects if obj.type == 'MESH' and obj != primary and not obj.hide_render
            and ('cloud' in obj.name.lower() or any(material and 'cloud' in material.name.lower() for material in obj.data.materials))]


def replace_cloud_textures(clouds, texture_path):
    if not texture_path:
        return None
    if not texture_path.is_file():
        raise FileNotFoundError(texture_path)
    targets = []
    visited = set()
    source_keys = {'earthcloudsbmap', 'earthcloudsmapb', 'marscloudsmap'}

    def visit(tree):
        if tree in visited:
            return
        visited.add(tree)
        for node in tree.nodes:
            if node.type == 'TEX_IMAGE':
                image_name = node.image.name if node.image else ''
                image_path = node.image.filepath if node.image else ''
                image_key = texture_key(Path(image_name.removesuffix('.001')).stem)
                path_key = texture_key(Path(image_path.replace('\\', '/')).stem) if image_path else ''
                if image_key in source_keys or path_key in source_keys:
                    targets.append(node)
            elif node.type == 'GROUP' and node.node_tree:
                visit(node.node_tree)

    for cloud in clouds:
        for material in cloud.data.materials:
            if not material or not material.use_nodes:
                continue
            visit(material.node_tree)
    if not targets:
        raise RuntimeError('No cloud texture image node found in the selected cloud materials.')
    colorspaces = {node.image.colorspace_settings.name for node in targets}
    if len(colorspaces) != 1:
        raise RuntimeError('Cloud texture nodes use conflicting color spaces.')
    image = bpy.data.images.load(str(texture_path.resolve()), check_existing=False)
    image.colorspace_settings.name = colorspaces.pop()
    for node in targets:
        node.image = image
    print('CLOUD_TEXTURE_REPLACED', len(targets), image.colorspace_settings.name, flush=True)
    return image


def ring_meshes(scene, primary, requested_names):
    if requested_names:
        names = [name.strip() for name in requested_names.split(',')]
        objects = [scene.objects.get(name) for name in names]
        if any(obj is None or obj.type != 'MESH' or obj.hide_render or obj == primary for obj in objects):
            raise ValueError('--ring-objects must name visible ring meshes distinct from the primary body.')
        return objects
    return [obj for obj in scene.objects if obj.type == 'MESH' and obj != primary and not obj.hide_render
            and ('ring' in obj.name.lower() or any(material and 'ring' in material.name.lower() for material in obj.data.materials))]


def geometry_radius(obj, center):
    return max(((obj.matrix_world @ vertex.co - center).length for vertex in obj.data.vertices), default=0)


def full_sphere_projection(surface_radius, extent, width, height, margin):
    if not surface_radius > 0 or not extent >= surface_radius:
        raise ValueError('The source model has invalid dimensions.')
    aspect = width / height
    ortho_scale = 2 * extent * max(1, aspect) / (1 - 2 * margin)
    globe_width = 2 * surface_radius / ortho_scale
    globe_height = globe_width * aspect
    return ortho_scale, {'x': (1 - globe_width) / 2, 'y': (1 - globe_height) / 2,
                         'width': globe_width, 'height': globe_height}


def full_sphere_layer_projections(surface_radius, surface_extent, ring_extent, width, height, margin):
    surface_scale, surface_rect = full_sphere_projection(surface_radius, surface_extent, width, height, margin)
    ring_scale, ring_rect = full_sphere_projection(surface_radius, ring_extent, width, height, margin)
    return surface_scale, surface_rect, ring_scale, ring_rect


def frame_full_sphere(scene, camera, primary, center, args, rings=None):
    bpy.context.view_layer.update()
    surface_radius = geometry_radius(primary, center)
    extent = max(geometry_radius(obj, center) for obj in scene.objects if obj.type == 'MESH' and not obj.hide_render)
    camera.data.sensor_fit = 'HORIZONTAL'
    camera.data.ortho_scale, sphere_rect = full_sphere_projection(surface_radius, extent, args.width, args.height, args.frame_margin)
    camera.location = center + Vector((0, -extent * 10, 0))
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.clip_end = max(camera.data.clip_end, extent * 25)
    presentation = {'framing': 'full-sphere', 'transparent': True,
                    'sphereRect': sphere_rect,
                    'projection': 'orthographic'}
    if args.independent_ring_framing and rings:
        surface_extent = max(geometry_radius(obj, center) for obj in scene.objects
                             if obj.type == 'MESH' and not obj.hide_render and obj not in rings)
        surface_scale, surface_rect, ring_scale, ring_rect = full_sphere_layer_projections(
            surface_radius, surface_extent, extent, args.width, args.height, args.frame_margin)
        camera.data.ortho_scale = surface_scale
        presentation['sphereRect'] = surface_rect
        presentation['ringSphereRect'] = ring_rect
    return presentation


def render_frame(scene, destination, allow_empty=False):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f'.{destination.stem}.{os.getpid()}.partial{destination.suffix}')
    scene.render.filepath = str(temporary.resolve())
    bpy.ops.render.render(write_still=True)
    if scene.render.film_transparent:
        validate_transparent_frame(temporary, allow_empty)
    temporary.replace(destination)


def validate_transparent_frame(filename, allow_empty=False):
    import numpy as np

    image = bpy.data.images.load(str(filename.resolve()), check_existing=False)
    try:
        width, height = image.size
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        alpha = pixels.reshape(height, width, 4)[:, :, 3]
        if not allow_empty and float(alpha.max()) <= 1 / 255:
            raise RuntimeError(f'The render is completely transparent: {filename}')
        edges = (alpha[0, :], alpha[-1, :], alpha[:, 0], alpha[:, -1])
        if any(float(edge.max()) > 1 / 255 for edge in edges):
            raise RuntimeError(f'The full sphere or cloud layer touches the frame boundary: {filename}')
    finally:
        bpy.data.images.remove(image)


def render_layers(scene, primary, clouds, destination, cloud_destination, resume, rings=None):
    states = {obj: (obj.hide_render, obj.is_holdout) for obj in scene.objects if obj.type == 'MESH'}
    try:
        if not resume or not destination.is_file():
            for obj in clouds:
                obj.hide_render = True
            for obj in rings or ():
                obj.hide_render = True
            render_frame(scene, destination)
        if clouds and (not resume or not cloud_destination.is_file()):
            for obj, (hidden, holdout) in states.items():
                obj.hide_render = hidden or (obj != primary and obj not in clouds)
                obj.is_holdout = obj == primary
            for obj in rings or ():
                obj.hide_render = True
            render_frame(scene, cloud_destination)
    finally:
        for obj, (hidden, holdout) in states.items():
            obj.hide_render = hidden
            obj.is_holdout = holdout


def render_cloud_frame(scene, primary, clouds, destination):
    states = {obj: (obj.hide_render, obj.is_holdout) for obj in scene.objects if obj.type == 'MESH'}
    try:
        for obj, (hidden, holdout) in states.items():
            obj.hide_render = obj != primary and obj not in clouds
            obj.is_holdout = obj == primary
        render_frame(scene, destination)
    finally:
        for obj, (hidden, holdout) in states.items():
            obj.hide_render = hidden
            obj.is_holdout = holdout


def render_ring_layer(scene, primary, clouds, rings, destination, resume, ortho_scale=None):
    if not rings or (resume and destination.is_file()):
        return False
    states = {obj: (obj.hide_render, obj.is_holdout) for obj in scene.objects if obj.type == 'MESH'}
    original_scale = scene.camera.data.ortho_scale if ortho_scale is not None else None
    try:
        if ortho_scale is not None:
            scene.camera.data.ortho_scale = ortho_scale
        for obj, (hidden, holdout) in states.items():
            obj.hide_render = obj != primary and obj not in rings
            obj.is_holdout = obj == primary
        for obj in clouds:
            obj.hide_render = True
        render_frame(scene, destination, allow_empty=True)
    finally:
        if original_scale is not None:
            scene.camera.data.ortho_scale = original_scale
        for obj, (hidden, holdout) in states.items():
            obj.hide_render = hidden
            obj.is_holdout = holdout
    return True


def prepare_scene(args):
    matches = sorted(args.models.glob(f'*+{args.body.capitalize()}+*.blend'))
    if len(matches) != 1:
        raise RuntimeError(f'Expected one {args.body} blend, found {matches}')
    source = matches[0]
    bpy.ops.wm.open_mainfile(filepath=str(source.resolve()), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    textures = relink_images(args.models, args.texture_limit)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = args.samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.008
    scene.cycles.adaptive_min_samples = min(16, args.samples)
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = 'OPTIX'
    scene.cycles.denoising_use_gpu = True
    scene.cycles.use_auto_tile = False
    scene.cycles.seed = 731
    scene.cycles.max_bounces = 8
    scene.cycles.transparent_max_bounces = 24
    scene.cycles.volume_bounces = 2
    scene.render.use_persistent_data = True
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = args.threads
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.use_border = False
    scene.render.film_transparent = args.framing == 'full-sphere'
    scene.render.image_settings.file_format = args.format
    scene.render.image_settings.color_mode = 'RGBA' if scene.render.film_transparent else 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 15
    scene.render.image_settings.quality = args.quality
    scene.render.use_compositing = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = args.exposure
    scene.view_settings.gamma = 1
    configure_gpu(scene, args.device)
    for obj in list(scene.objects):
        obj.animation_data_clear()
        if obj.type in ('LIGHT', 'CAMERA'):
            bpy.data.objects.remove(obj, do_unlink=True)
        elif args.real_atmosphere and obj.name.lower() == 'real atmosphere':
            obj.hide_render = False
        elif args.real_atmosphere and obj.name.lower() == 'atmosphere':
            obj.hide_render = True
    for material in bpy.data.materials:
        if material.use_nodes and 'cloud' in material.name.lower():
            for node in material.node_tree.nodes:
                if node.type == 'DISPLACEMENT':
                    node.inputs['Scale'].default_value *= args.cloud_relief
    primary = next((obj for obj in scene.objects if obj.type == 'MESH' and obj.name.lower() == args.body), None)
    if primary is None:
        primary = max((obj for obj in scene.objects if obj.type == 'MESH' and not obj.hide_render), key=lambda obj: len(obj.data.vertices))
    if args.body == 'sun':
        duplicate = scene.objects.get('Esfera geodésica')
        if duplicate and duplicate.type == 'MESH':
            same_transform = all(abs(primary.matrix_world[row][column] - duplicate.matrix_world[row][column]) < 0.00001 for row in range(4) for column in range(4))
            same_geometry = len(primary.data.vertices) == len(duplicate.data.vertices) and all((first.co - second.co).length < 0.00001 for first, second in zip(primary.data.vertices, duplicate.data.vertices))
            if same_transform and same_geometry and list(primary.data.materials) == list(duplicate.data.materials):
                duplicate.hide_render = True
                print('HIDDEN_DUPLICATE', duplicate.name, flush=True)
            else:
                raise RuntimeError('The additional solar surface does not match; inspect it before baking.')
    bpy.context.view_layer.update()
    radius = max(primary.dimensions) * 0.5
    center = sum((primary.matrix_world @ Vector(corner) for corner in primary.bound_box), Vector()) / 8
    rig = bpy.data.objects.new('Atlas orientation', None)
    scene.collection.objects.link(rig)
    rig.rotation_mode = 'QUATERNION'
    for obj in list(scene.objects):
        if obj != rig and obj.parent is None:
            matrix = obj.matrix_world.copy()
            obj.parent = rig
            obj.matrix_world = matrix
    azimuth = math.radians(args.light_azimuth)
    elevation = math.radians(args.light_elevation)
    direction = Vector((math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation)))
    sun_data = bpy.data.lights.new('Atlas key light', 'SUN')
    sun_data.energy = args.sun_strength
    sun_data.color = (1.0, 0.965, 0.92)
    sun_data.angle = math.radians(0.53)
    sunlight = bpy.data.objects.new('Atlas key light', sun_data)
    scene.collection.objects.link(sunlight)
    sunlight.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type == 'MAPPING' and any(link.to_node.type == 'NORMAL' for link in material.node_tree.links if link.from_node == node):
                node.inputs['Rotation'].default_value = sunlight.rotation_euler
    world = bpy.data.worlds.new('Atlas black space')
    world.use_nodes = True
    world.node_tree.nodes.get('Background').inputs['Strength'].default_value = 0
    scene.world = world
    add_limb_haze(args.body, primary, args.halo, direction)
    clouds = cloud_meshes(scene, primary, args.cloud_objects)
    if args.cloud_only and not clouds:
        raise RuntimeError(f'No cloud meshes found for {args.body}.')
    replace_cloud_textures(clouds, args.cloud_texture)
    rings = ring_meshes(scene, primary, args.ring_objects)
    for cloud in clouds:
        cloud.rotation_euler.z += math.radians(args.cloud_longitude)
    camera_data = bpy.data.cameras.new('Atlas close-up camera')
    camera = bpy.data.objects.new('Atlas close-up camera', camera_data)
    scene.collection.objects.link(camera)
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = radius * (2.55 if args.body in ('saturn', 'uranus') else 1.54)
    target = center + Vector((radius * 0.56, 0, radius * 0.4))
    camera.location = target + Vector((0, -radius * 10, 0))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = camera
    presentation = frame_full_sphere(scene, camera, primary, center, args, rings) if args.framing == 'full-sphere' else None
    if presentation and args.layers == 'split':
        if clouds:
            cloud_radius = max(geometry_radius(cloud, center) for cloud in clouds)
            cloud_width = 2 * cloud_radius / camera.data.ortho_scale
            cloud_height = cloud_width * args.width / args.height
            presentation.update({'cloudFramePattern': f'{args.body}/clouds/e{{elevation}}/a{{azimuth}}.{args.format.lower()}',
                                 'cloudWidth': args.width, 'cloudHeight': args.height, 'cloudTransparent': True,
                                 'cloudSphereRect': {'x': (1 - cloud_width) / 2, 'y': (1 - cloud_height) / 2,
                                                     'width': cloud_width, 'height': cloud_height}})
        if rings:
            presentation.update({'ringFramePattern': f'{args.body}/rings/e{{elevation}}/a000.{args.format.lower()}',
                                 'ringWidth': args.width, 'ringHeight': args.height, 'ringTransparent': True})
    return scene, rig, primary, source, textures, clouds, rings, presentation


def main():
    args = arguments()
    started = time.monotonic()
    scene, rig, primary, source, textures, clouds, rings, presentation = prepare_scene(args)
    original_rotation = primary.rotation_euler.copy()
    original_cloud_rotations = {cloud: cloud.rotation_euler.copy() for cloud in clouds}
    bpy.context.view_layer.update()
    spin_axis = (primary.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    elevation_axis = spin_axis.cross(Vector((0, -1, 0))).normalized()
    if elevation_axis.length < 0.5:
        raise RuntimeError('The source spin axis is parallel to the camera; choose an equatorial source orientation.')
    if presentation:
        camera_inverse = scene.camera.matrix_world.to_quaternion().inverted()
        presentation['spinAxes'] = [list(camera_inverse @ (Quaternion(elevation_axis, math.radians(elevation)) @ spin_axis)) for elevation in args.elevations]
        presentation['spinAxisCoordinates'] = 'right-up-toward-camera'
    ring_ortho_scale = (scene.camera.data.ortho_scale * presentation['sphereRect']['width'] / presentation['ringSphereRect']['width']
                        if presentation and 'ringSphereRect' in presentation else None)
    output = args.output / args.body
    output.mkdir(parents=True, exist_ok=True)
    report = {'body': args.body, 'model': source.name, 'modelSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'blender': bpy.app.version_string, 'width': args.width, 'height': args.height, 'samples': args.samples, 'azimuthCount': args.azimuth_count, 'elevations': args.elevations, 'halo': args.halo, 'format': args.format, 'quality': args.quality, 'lightAzimuth': args.light_azimuth, 'lightElevation': args.light_elevation, 'cloudRelief': args.cloud_relief, 'exposure': args.exposure, 'device': args.device, 'rotation': 'native-spin-axis', 'shardIndex': args.shard_index, 'shardCount': args.shard_count, 'textures': textures, 'frames': []}
    if args.cloud_texture:
        report['cloudTexture'] = str(args.cloud_texture)
    if args.climate_time is not None:
        report['climate'] = {'model': args.climate_model, 'modelVersion': '2.1',
                             'timeIndex': args.climate_time, 'timePad': args.climate_time_pad,
                             'frameCount': args.climate_frame_count,
                             'timeStepSeconds': args.climate_step_hours * 3600,
                             'loopSeconds': args.climate_step_hours * args.climate_frame_count * 3600,
                             'timeUnit': 'hours', 'surfaceReuse': 'v5',
                             'interpolation': 'step',
                             'simulation': 'physically-inspired moisture transport and cloud lifecycle'}
    if args.tier != 'auto' or args.independent_ring_framing:
        report['resolutionTier'] = args.tier if args.tier != 'auto' else ('8k' if max(args.width, args.height) >= 7680 else '4k' if max(args.width, args.height) >= 3840 else '2k')
    if presentation:
        report['presentation'] = presentation
        report['fullSphereBake'] = {'safeMargin': args.frame_margin, 'background': 'separate-celestial-sky',
                                   'layerMode': args.layers, 'cloudObjects': [obj.name for obj in clouds],
                                   'ringObjects': [obj.name for obj in rings],
                                   'cloudOcclusion': 'primary-holdout' if args.layers == 'split' else 'composite',
                                   'ringOcclusion': 'primary-holdout' if args.layers == 'split' else 'composite',
                                   'cloudShadows': 'not-baked-into-surface' if args.layers == 'split' else 'composite',
                                   'ringShadows': 'not-baked-into-surface' if args.layers == 'split' else 'composite'}
    report['angularStepDegrees'] = 360 / args.azimuth_count
    report['cloudLongitudeDegrees'] = args.cloud_longitude
    ring_rows = set()
    for row, column in args.frames:
        frame = output / f'e{row}' / f'a{column:03d}.{args.format.lower()}'
        cloud_root = output / 'clouds'
        if args.climate_time is not None:
            cloud_root /= climate_time_directory(args.climate_time, args.climate_time_pad)
        cloud_frame = cloud_root / f'e{row}' / f'a{column:03d}.{args.format.lower()}'
        ring_frame = output / 'rings' / f'e{row}' / f'a000.{args.format.lower()}'
        complete = cloud_frame.is_file() if args.cloud_only else frame.is_file() and (args.layers != 'split' or ((not clouds or cloud_frame.is_file()) and (not rings or ring_frame.is_file())))
        if args.resume and complete:
            continue
        rig.rotation_quaternion = Quaternion(elevation_axis, math.radians(args.elevations[row]))
        primary.rotation_euler = original_rotation
        primary.rotation_euler.z += math.radians(args.longitude + 360 * column / args.azimuth_count)
        for cloud, original_cloud_rotation in original_cloud_rotations.items():
            cloud.rotation_euler = original_cloud_rotation
            cloud.rotation_euler.z += math.radians(args.longitude + 360 * column / args.azimuth_count)
        bpy.context.view_layer.update()
        if args.blend:
            args.blend.parent.mkdir(parents=True, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()))
            args.blend = None
        frame_started = time.monotonic()
        print('FRAME_START', args.body, row, column, flush=True)
        if args.cloud_only:
            render_cloud_frame(scene, primary, clouds, cloud_frame)
        elif args.layers == 'split':
            render_layers(scene, primary, clouds, frame, cloud_frame, args.resume, rings)
            if row not in ring_rows:
                primary.rotation_euler = original_rotation
                render_ring_layer(scene, primary, clouds, rings, ring_frame, args.resume, ring_ortho_scale)
                ring_rows.add(row)
        else:
            render_frame(scene, frame)
        seconds = round(time.monotonic() - frame_started, 2)
        record = {'row': row, 'column': column, 'seconds': seconds,
                  'bytes': cloud_frame.stat().st_size if args.cloud_only else frame.stat().st_size}
        if args.layers == 'split' and clouds:
            record['cloudBytes'] = cloud_frame.stat().st_size
        if args.layers == 'split' and rings and ring_frame.is_file():
            record['ringBytes'] = ring_frame.stat().st_size
        report['frames'].append(record)
        print('FRAME_DONE', args.body, row, column, seconds, flush=True)
    report['seconds'] = round(time.monotonic() - started, 2)
    render_report_path(output, args).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('MODEL_BAKE_DONE', args.body, report['seconds'], flush=True)


if __name__ == '__main__':
    main()
