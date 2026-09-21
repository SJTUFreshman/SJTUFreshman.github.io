"""Inspect and render the original NASA ISS interior in a Slurm A800 allocation."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys

import bpy
from mathutils import Vector


SOURCE_SHA256 = 'bb884b3f5fdae3fe6116bd2241b44e8efb2f804de8785840431f400ebfa09816'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require_gpu(scene):
    if not os.environ.get('SLURM_JOB_ID') or os.environ.get('SLURM_JOB_PARTITION') != 'hp_a800':
        raise RuntimeError('NASA inspection requires an hp_a800 Slurm compute allocation')
    scene.render.engine = 'CYCLES'
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = 'CUDA'
    preferences.get_devices()
    devices = []
    for device in preferences.devices:
        device.use = device.type == 'CUDA' and 'A800' in device.name
        if device.use:
            devices.append({'name': device.name, 'type': device.type, 'id': device.id})
    if not devices:
        raise RuntimeError('No allocated CUDA A800 device found; CPU rendering is prohibited')
    scene.cycles.device = 'GPU'
    return devices


def bounds(instance):
    points = [instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
    return ([min(point[axis] for point in points) for axis in range(3)],
            [max(point[axis] for point in points) for axis in range(3)])


def socket_value(socket):
    if not hasattr(socket, 'default_value'):
        return None
    value = socket.default_value
    if isinstance(value, (str, bool, int, float)):
        return value
    try:
        return list(value)
    except TypeError:
        return str(value)


def material_report(material):
    result = {'name': material.name, 'use_nodes': material.use_nodes, 'nodes': [], 'links': []}
    if not material.use_nodes:
        return result
    for node in material.node_tree.nodes:
        result['nodes'].append({'name': node.name, 'type': node.bl_idname,
                                'image': node.image.name if node.type == 'TEX_IMAGE' and node.image else None,
                                'inputs': {socket.name: socket_value(socket) for socket in node.inputs}})
    for link in material.node_tree.links:
        result['links'].append({'from_node': link.from_node.name, 'from_socket': link.from_socket.name,
                                'to_node': link.to_node.name, 'to_socket': link.to_socket.name})
    return result


def inspect_scene(source, devices):
    meshes, groups = [], {}
    for instance in bpy.context.scene.objects:
        if instance.type != 'MESH':
            continue
        low, high = bounds(instance)
        instance.data.calc_loop_triangles()
        ancestors = []
        parent = instance.parent
        while parent:
            ancestors.append(parent.name)
            parent = parent.parent
        group = ancestors[-2] if len(ancestors) >= 2 else ancestors[-1] if ancestors else instance.name.split('_')[0]
        groups.setdefault(group, []).append(instance.name)
        meshes.append({'name': instance.name, 'source_data': instance.data.name, 'parent_chain': ancestors,
                       'bbox_min_blender_units': low, 'bbox_max_blender_units': high,
                       'dimensions_blender_units': [high[axis] - low[axis] for axis in range(3)],
                       'vertices': len(instance.data.vertices), 'polygons': len(instance.data.polygons),
                       'triangles': len(instance.data.loop_triangles), 'uv_layers': list(instance.data.uv_layers.keys()),
                       'materials': [material.name if material else None for material in instance.data.materials],
                       'matrix_world': [list(row) for row in instance.matrix_world]})
    if not meshes:
        raise ValueError('Blender imported no mesh objects from NASA FBX')
    scene_low = [min(item['bbox_min_blender_units'][axis] for item in meshes) for axis in range(3)]
    scene_high = [max(item['bbox_max_blender_units'][axis] for item in meshes) for axis in range(3)]
    images = [{'name': image.name, 'filepath': image.filepath, 'size': list(image.size),
               'has_data': image.has_data, 'packed': bool(image.packed_file),
               'colorspace': image.colorspace_settings.name} for image in bpy.data.images]
    return {'asset': 'International Space Station (ISS) (E) (Internal)',
            'job_id': os.environ['SLURM_JOB_ID'], 'devices': devices, 'source_fbx': str(source),
            'source_bytes': source.stat().st_size, 'source_sha256': digest(source),
            'importer': 'Blender bpy.ops.import_scene.fbx', 'blender_version': bpy.app.version_string,
            'fallback_used': False, 'source_modified': False, 'physical_scale_verified': False,
            'coordinate_units': 'Unmodified Blender import units; physical scale requires module calibration',
            'scene_bbox_min_blender_units': scene_low, 'scene_bbox_max_blender_units': scene_high,
            'scene_dimensions_blender_units': [scene_high[axis] - scene_low[axis] for axis in range(3)],
            'mesh_count': len(meshes), 'triangle_count': sum(item['triangles'] for item in meshes),
            'material_count': len(bpy.data.materials), 'image_count': len(images),
            'images_loaded': sum(item['has_data'] for item in images),
            'images_packed': sum(item['packed'] for item in images),
            'groups': groups, 'meshes': meshes,
            'materials': [material_report(material) for material in bpy.data.materials], 'images': images,
            'visual_approval': False, 'rendered_views': []}


def repair_imported_materials():
    changes = []
    material = bpy.data.materials.get('Generic_Misc_Details')
    if material:
        shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        for suffix, socket, colorspace in (('Diffuse', 'Base Color', 'sRGB'), ('Metallic', 'Metallic', 'Non-Color')):
            name = f'Generic_Misc_Details_{suffix}.png'
            image = bpy.data.images.get(name)
            if image and not shader.inputs[socket].is_linked:
                image.colorspace_settings.name = colorspace
                texture = material.node_tree.nodes.new('ShaderNodeTexImage')
                texture.image = image
                material.node_tree.links.new(texture.outputs['Color'], shader.inputs[socket])
                changes.append({'material': material.name, 'socket': socket, 'connected_source_image': name})
    material = bpy.data.materials.get('Cupola_Glass')
    if material:
        shader = next(node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
        for socket, value in (('Metallic', 0), ('Transmission Weight', 1), ('Alpha', 1), ('Roughness', .035)):
            previous = shader.inputs[socket].default_value
            shader.inputs[socket].default_value = value
            changes.append({'material': material.name, 'socket': socket, 'previous': previous, 'new': value,
                            'reason': 'Explicit diagnostic glass interpretation; not recovered source metadata'})
    return changes


def authored_surface_response():
    changes = []
    for material in bpy.data.materials:
        if not material.use_nodes or material.get('nasa_authored_surface_response'):
            continue
        name = material.name.lower()
        if any(token in name for token in ('glass', 'light', 'lights')):
            continue
        shader = next((node for node in material.node_tree.nodes
                       if node.type == 'BSDF_PRINCIPLED'), None)
        if shader is None or shader.inputs['Roughness'].is_linked:
            continue
        if any(token in name for token in ('rack', 'metal', 'hub', 'patch')):
            center, spread = .32, .12
        elif any(token in name for token in ('bulkhead', 'diffuse', 'misc')):
            center, spread = .43, .08
        else:
            center, spread = .38, .1
        nodes, links = material.node_tree.nodes, material.node_tree.links
        diffuse_link = next((link for link in links
                             if link.to_node == shader and link.to_socket == shader.inputs['Base Color']
                             and link.from_node.type == 'TEX_IMAGE' and link.from_node.image), None)
        if diffuse_link is None:
            continue
        luminance = nodes.new('ShaderNodeRGBToBW')
        luminance.name = 'NASA authored diffuse luminance'
        ramp = nodes.new('ShaderNodeMapRange')
        ramp.name = 'NASA authored surface roughness range'
        ramp.clamp = True
        ramp.inputs['From Min'].default_value = .08
        ramp.inputs['From Max'].default_value = .92
        ramp.inputs['To Min'].default_value = max(.04, center - spread)
        ramp.inputs['To Max'].default_value = min(.92, center + spread)
        links.new(diffuse_link.from_socket, luminance.inputs['Color'])
        links.new(luminance.outputs['Val'], ramp.inputs['Value'])
        links.new(ramp.outputs['Result'], shader.inputs['Roughness'])
        material['nasa_authored_surface_response'] = json.dumps({
            'source': 'authored remap of source Diffuse luminance; source FBX has no roughness map',
            'coordinate_space': 'source Diffuse UV',
            'roughness_range': [max(.04, center - spread), min(.92, center + spread)]
        })
        changes.append({'material': material.name, 'socket': 'Roughness',
                        'range': [max(.04, center - spread), min(.92, center + spread)],
                        'reason': 'Explicit diagnostic remap of source Diffuse luminance; no NASA roughness map exists'})
    return changes


def render_views(scene, specification, directory):
    settings = json.loads(specification.read_text(encoding='utf-8'))
    world = bpy.data.worlds.new('NASA inspection neutral studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.32, .38, .46, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .22
    scene.world = world
    scene.cycles.samples = settings.get('samples', 48)
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    camera_data = bpy.data.cameras.new('NASA diagnostic camera')
    camera = bpy.data.objects.new('NASA diagnostic camera', camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.clip_start = .015
    camera_data.clip_end = 2000
    reports, changes = [], []
    repaired, authored = False, False
    for view in settings['views']:
        if view.get('authored_surface_response') and not view.get('repair_pbr'):
            raise ValueError('Authored surface response requires repaired materials')
        if repaired and not view.get('repair_pbr'):
            raise ValueError('Original material views must precede diagnostic repaired views')
        if authored and not view.get('authored_surface_response'):
            raise ValueError('Repair-only views must precede authored surface response views')
        if view.get('repair_pbr') and not repaired:
            changes.extend(repair_imported_materials())
            repaired = True
        if view.get('authored_surface_response') and not authored:
            changes.extend(authored_surface_response())
            authored = True
        world.node_tree.nodes['Background'].inputs['Color'].default_value = view.get('world_color', [.32, .38, .46, 1])
        world.node_tree.nodes['Background'].inputs['Strength'].default_value = view.get('world_strength', .22)
        scene.render.film_transparent = view.get('transparent_background', False)
        hidden_objects = []
        for name in view.get('hide_objects', []):
            instance = bpy.data.objects.get(name)
            if instance is None:
                raise ValueError('Diagnostic visibility override names an unknown object: ' + name)
            hidden_objects.append((instance, instance.hide_render))
            instance.hide_render = True
        lights = []
        camera.location = Vector(view['position'])
        camera.rotation_euler = (Vector(view['target']) - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera_data.type = 'PERSP'
        camera_data.sensor_fit = 'VERTICAL'
        camera_data.sensor_height = 24
        camera_data.lens = 24 / (2 * math.tan(math.radians(view.get('vertical_fov', 65)) / 2))
        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        clearance = []
        for direction in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
            hit, location, normal, face, instance, matrix = scene.ray_cast(graph, camera.location, Vector(direction), distance=1000)
            clearance.append({'direction': direction, 'distance_blender_units': (location - camera.location).length if hit else None,
                              'object': instance.name if hit else None})
        if any(item['distance_blender_units'] is not None and item['distance_blender_units'] < .05 for item in clearance):
            raise ValueError('Diagnostic camera is too close to imported geometry: ' + view['name'])
        for index, light in enumerate(view.get('lights', [])):
            data = bpy.data.lights.new(f'Inspection {view["name"]} light {index}', 'AREA')
            data.energy = light['watts']
            data.shape = 'DISK'
            data.size = light.get('size', 1.2)
            instance = bpy.data.objects.new(data.name, data)
            scene.collection.objects.link(instance)
            instance.location = Vector(light['position'])
            instance.rotation_euler = (Vector(light['target']) - instance.location).to_track_quat('-Z', 'Y').to_euler()
            lights.append(instance)
        target = directory / (view['name'] + '.png')
        scene.render.filepath = str(target)
        bpy.ops.render.render(write_still=True)
        reports.append({**view, 'image': target.name, 'sha256': digest(target),
                        'resolution': [1600, 1100], 'samples': scene.cycles.samples,
                        'material_state': {'repair_pbr': repaired, 'authored_surface_response': authored},
                        'camera_axis_clearance': clearance})
        for instance in lights:
            bpy.data.objects.remove(instance, do_unlink=True)
        for instance, original_visibility in hidden_objects:
            instance.hide_render = original_visibility
        print('NASA_VIEW_RENDERED', str(target), flush=True)
    return reports, changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fbx', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-sha256', default=SOURCE_SHA256)
    parser.add_argument('--save-blend', type=Path)
    parser.add_argument('--resume-blend', type=Path)
    parser.add_argument('--views', type=Path)
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if not os.environ.get('SLURM_JOB_ID') or os.environ.get('SLURM_JOB_PARTITION') != 'hp_a800':
        raise RuntimeError('NASA inspection cannot execute outside an hp_a800 Slurm allocation')
    source = arguments.fbx.resolve()
    if not source.is_file() or source.suffix.lower() != '.fbx':
        raise ValueError('Expected an existing FBX source; no fallback format is accepted')
    if arguments.source_sha256 != SOURCE_SHA256 or digest(source) != SOURCE_SHA256:
        raise ValueError('NASA FBX SHA256 does not match the verified official source')
    directory = arguments.output.resolve().parent
    directory.mkdir(parents=True, exist_ok=True)
    if arguments.resume_blend:
        bpy.ops.wm.open_mainfile(filepath=str(arguments.resume_blend.resolve()))
        if bpy.context.scene.get('nasa_source_sha256') != SOURCE_SHA256:
            raise ValueError('Resume blend does not identify the verified NASA source')
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        isolated_source = directory / 'source-copy.fbx'
        shutil.copyfile(source, isolated_source)
        bpy.ops.import_scene.fbx(filepath=str(isolated_source), use_image_search=True,
                                 automatic_bone_orientation=False, use_custom_normals=True)
    scene = bpy.context.scene
    devices = require_gpu(scene)
    bpy.context.view_layer.update()
    report = inspect_scene(source, devices)
    if any(not entry['has_data'] for entry in report['images']):
        raise ValueError('NASA FBX contains unloaded images; report cannot imply complete texture import')
    if arguments.views:
        report['rendered_views'], report['diagnostic_material_changes'] = render_views(scene, arguments.views, directory)
        report['materials_after_diagnostic_changes'] = [material_report(material) for material in bpy.data.materials]
    if arguments.save_blend:
        scene['nasa_source_sha256'] = SOURCE_SHA256
        bpy.ops.file.pack_all()
        arguments.save_blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(arguments.save_blend.resolve()))
        report['saved_blend'] = str(arguments.save_blend.resolve())
    if digest(source) != SOURCE_SHA256:
        raise ValueError('Source FBX changed during inspection')
    arguments.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('NASA_ISS_INTERIOR_INSPECTION', json.dumps({key: report[key] for key in
          ('job_id', 'scene_dimensions_blender_units', 'mesh_count', 'triangle_count', 'image_count', 'images_loaded')}), flush=True)


if __name__ == '__main__':
    main()
