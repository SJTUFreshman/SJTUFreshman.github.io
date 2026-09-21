"""Render public model selection studies on an allocated GPU, without installation."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace

import bpy
from mathutils import Euler, Matrix, Vector


def file_digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def bounds(objects):
    bpy.context.view_layer.update()
    corners = [instance.matrix_world @ Vector(corner)
               for instance in objects if instance.type == 'MESH' and instance.data.vertices
               for corner in instance.bound_box]
    if not corners:
        raise ValueError('Public source contains no mesh geometry')
    minimum = Vector([min(corner[axis] for corner in corners) for axis in range(3)])
    maximum = Vector([max(corner[axis] for corner in corners) for axis in range(3)])
    return minimum, maximum


def configure_materials(materials, options):
    if not options:
        return []
    allowed = {'unlit_to_principled', 'roughness', 'metallic', 'ior', 'specular_ior_level'}
    if set(options) - allowed:
        raise ValueError(f'Unsupported material diagnostic: {set(options) - allowed}')
    report = []
    for material in materials:
        if not material.use_nodes:
            raise ValueError(f'Material diagnostic requires nodes: {material.name}')
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = next((node for node in nodes if node.type == 'BSDF_PRINCIPLED'), None)
        converted = False
        if shader is None and options.get('unlit_to_principled'):
            emission = next((node for node in nodes if node.type == 'EMISSION'), None)
            output = next((node for node in nodes if node.type == 'OUTPUT_MATERIAL'
                           and node.is_active_output), None)
            if emission is None or output is None:
                raise ValueError(f'Unrecognized unlit material: {material.name}')
            shader = nodes.new('ShaderNodeBsdfPrincipled')
            color = emission.inputs['Color']
            shader.inputs['Base Color'].default_value = color.default_value
            if color.is_linked:
                links.new(color.links[0].from_socket, shader.inputs['Base Color'])
            links.new(shader.outputs['BSDF'], output.inputs['Surface'])
            converted = True
        if shader is None:
            raise ValueError(f'No surface shader for diagnostic: {material.name}')
        parameters = {}
        for key, socket in [('roughness', 'Roughness'), ('metallic', 'Metallic'),
                            ('ior', 'IOR'), ('specular_ior_level', 'Specular IOR Level')]:
            if key not in options:
                continue
            value = float(options[key])
            if not math.isfinite(value) or not (1 <= value <= 4 if key == 'ior' else 0 <= value <= 1):
                raise ValueError(f'Invalid material value: {key}={value}')
            target = shader.inputs[socket]
            parameters[key] = {'before': target.default_value, 'after': value,
                               'replaced_texture_input': target.is_linked}
            for link in list(target.links):
                links.remove(link)
            target.default_value = value
        report.append({'material': material.name, 'unlit_to_principled': converted,
                       'parameters': parameters,
                       'limitation': 'Diagnostic shading only; photographed color is not de-lit albedo'})
    return report


def clip_meshes_above(objects, clip_height):
    import bmesh

    if not math.isfinite(clip_height):
        raise ValueError(f'Invalid clip_below_z: {clip_height}')
    intersections = 0
    retained_faces = 0
    for instance in objects:
        if instance.type != 'MESH':
            continue
        mesh = bmesh.new()
        mesh.from_mesh(instance.data)
        try:
            plane_co = instance.matrix_world.inverted() @ Vector((0, 0, clip_height))
            plane_no = (instance.matrix_world.to_3x3().transposed() @ Vector((0, 0, 1))).normalized()
            result = bmesh.ops.bisect_plane(
                mesh, geom=list(mesh.verts) + list(mesh.edges) + list(mesh.faces),
                plane_co=plane_co, plane_no=plane_no, dist=1e-6,
                clear_inner=True, clear_outer=False,
            )
            intersections += len(result.get('geom_cut', []))
            retained_faces += len(mesh.faces)
            mesh.to_mesh(instance.data)
        finally:
            mesh.free()
        instance.data.update()
    bpy.context.view_layer.update()
    if retained_faces == 0:
        raise ValueError(f'Clipping removed all source faces at world z={clip_height}')
    return intersections


def import_source(record):
    source = Path(record['model']).resolve()
    digest = file_digest(source)
    if digest != record['sha256']:
        raise ValueError(f'Public source hash mismatch: {source}')
    for dependency in record.get('dependencies', []):
        target = (source.parent / dependency['path']).resolve()
        if not target.is_relative_to(source.parent) or file_digest(target) != dependency['sha256']:
            raise ValueError(f'Public source dependency mismatch: {target}')
    before = set(bpy.data.objects)
    suffix = source.suffix.lower()
    if suffix in ('.gltf', '.glb'):
        bpy.ops.import_scene.gltf(filepath=str(source), merge_vertices=False)
    elif suffix == '.obj':
        bpy.ops.wm.obj_import(filepath=str(source), forward_axis=record.get('forward_axis', 'NEGATIVE_Z'),
                             up_axis=record.get('up_axis', 'Y'))
    elif suffix == '.ply':
        bpy.ops.wm.ply_import(filepath=str(source))
    elif suffix == '.blend':
        with bpy.data.libraries.load(str(source), link=False) as (available, loaded):
            loaded.objects = available.objects
        for instance in loaded.objects:
            if instance is not None:
                bpy.context.collection.objects.link(instance)
    else:
        raise ValueError(f'Unsupported model format: {suffix}')
    imported = set(bpy.data.objects) - before
    for instance in imported:
        if instance.type in ('LIGHT', 'CAMERA'):
            instance.hide_render = True
    original_minimum, original_maximum = bounds(imported)
    rotation = Euler([math.radians(value) for value in record.get('rotation_degrees', [0, 0, 0])]).to_matrix().to_4x4()
    transform = rotation @ Matrix.Scale(record.get('units_to_metres', 1), 4)
    roots = [instance for instance in imported if instance.parent not in imported]
    for instance in roots:
        instance.matrix_world = transform @ instance.matrix_world
    minimum, maximum = bounds(imported)
    if record.get('expected_bounds'):
        for actual, expected in zip([minimum, maximum], record['expected_bounds']):
            if any(abs(actual[axis] - expected[axis]) > .02 for axis in range(3)):
                raise ValueError(f'Imported source axes or bounds differ: {minimum}, {maximum}')
    offset = Vector(record.get('position', [0, 0, 0]))
    if record.get('center_xy', True):
        offset.x -= (minimum.x + maximum.x) * .5
        offset.y -= (minimum.y + maximum.y) * .5
    if record.get('base_at_zero', True):
        offset.z -= minimum.z
    for instance in roots:
        instance.matrix_world = Matrix.Translation(offset) @ instance.matrix_world
    minimum, maximum = bounds(imported)
    if record.get('clip_below_z') is not None:
        clip_height = float(record['clip_below_z'])
        clipped_faces = clip_meshes_above(imported, clip_height)
        minimum, maximum = bounds(imported)
    meshes = [instance for instance in imported if instance.type == 'MESH']
    materials = {material for instance in meshes for material in instance.data.materials if material}
    if record.get('texture_extension'):
        for material in materials:
            if material.use_nodes:
                for node in material.node_tree.nodes:
                    if node.type == 'TEX_IMAGE':
                        node.extension = record['texture_extension']
    images = {node.image for material in materials if material.use_nodes
              for node in material.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image}
    for image in images:
        if min(image.size) <= 0:
            raise ValueError(f'Unresolved public source texture: {image.filepath}')
    material_diagnostics = configure_materials(materials, record.get('material_diagnostic'))
    triangle_count = 0
    for instance in meshes:
        instance.data.calc_loop_triangles()
        triangle_count += len(instance.data.loop_triangles)
        instance['public_source'] = record['source_url']
        instance['source_license'] = record['license']
    if triangle_count == 0:
        raise ValueError(f'Public source contains no renderable faces: {source}')
    report = {'model': str(source), 'sha256': digest, 'source_url': record['source_url'],
              'license': record['license'], 'license_url': record['license_url'],
              'mesh_objects': len(meshes), 'triangles_before_modifiers': triangle_count,
              'vertices': sum(len(instance.data.vertices) for instance in meshes),
              'original_bounds': [list(original_minimum), list(original_maximum)],
              'placed_bounds': [list(minimum), list(maximum)],
              'units_verified': record.get('units_verified', False),
              'images': [{'name': image.name, 'dimensions': list(image.size)} for image in images],
              'transform': record, 'materials_preserved': not material_diagnostics,
              'material_diagnostics': material_diagnostics}
    if record.get('clip_below_z') is not None:
        report['clip_below_z'] = float(record['clip_below_z'])
        report['clip_intersections'] = clipped_faces
    return imported, report


def panorama_camera(scene, specification, center, extent, maximum):
    position = (center + Vector(specification['relative_position']) * extent
                if 'relative_position' in specification else Vector(specification['position']))
    grounding = None
    if 'ground_clearance' in specification:
        clearance = float(specification['ground_clearance'])
        if not math.isfinite(clearance) or clearance <= 0:
            raise ValueError('Panorama ground clearance must be positive')
        origin = Vector((position.x, position.y, maximum.z + extent))
        hit, location, normal, face_index, instance, matrix = scene.ray_cast(
            bpy.context.evaluated_depsgraph_get(), origin, Vector((0, 0, -1)), distance=extent * 4)
        if not hit or normal.z <= 0:
            raise ValueError('Panorama position has no upward terrain surface')
        position.z = location.z + clearance
        grounding = {'surface': instance.name, 'point': list(location),
                     'normal': list(normal), 'face_index': face_index, 'clearance': clearance}
    return position, grounding


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue', required=True)
    options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('Public model studies require a Slurm compute allocation')
    renderer_path = Path(__file__).with_name('render-world-panorama.py')
    specification = importlib.util.spec_from_file_location('world_renderer', renderer_path)
    renderer = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(renderer)
    queue_path = Path(options.queue).resolve()
    for study in json.loads(queue_path.read_text(encoding='utf-8')):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        scene.render.engine = 'CYCLES'
        renderer.device(scene, 'CUDA')
        scene.cycles.samples = study.get('samples', 128)
        scene.cycles.use_denoising = True
        scene.render.resolution_x = study.get('width', 1600)
        scene.render.resolution_y = study.get('height', 1100)
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.film_transparent = False
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'AgX - Medium High Contrast'
        objects, source_reports = set(), []
        for source in study['sources']:
            imported, report = import_source(source)
            objects.update(imported)
            source_reports.append(report)
        geometry_filter = None
        if study.get('geometry_filter'):
            filter_spec = study['geometry_filter']
            filter_path = Path(filter_spec['script']).resolve()
            if not filter_path.is_file():
                raise FileNotFoundError(f'Geometry filter script not found: {filter_path}')
            helper = runpy.run_path(str(filter_path))
            apply_filter = helper.get('apply')
            if apply_filter is None:
                raise ValueError(f'Geometry filter has no apply() function: {filter_path}')
            geometry_filter = apply_filter(objects, filter_spec.get('options', {}))
        surface_detail = None
        if study.get('snow_surface_detail'):
            helper = runpy.run_path(str(Path(__file__).with_name('shade-surveyed-snow.py')))
            surface_detail = helper['apply'](objects, study['snow_surface_detail'])
        minimum, maximum = bounds(objects)
        center = (minimum + maximum) * .5
        extent = max(maximum - minimum)
        camera_data = bpy.data.cameras.new('Public asset study camera')
        camera_data.sensor_fit = 'VERTICAL'
        camera_data.sensor_height = 24
        camera_data.clip_start = .01
        camera_data.clip_end = max(1000, extent * 20)
        camera = bpy.data.objects.new('Public asset study camera', camera_data)
        scene.collection.objects.link(camera)
        scene.camera = camera
        directory = Path(study['output_dir']).resolve()
        directory.mkdir(parents=True, exist_ok=True)
        report = {'id': study['id'], 'job_id': os.environ['SLURM_JOB_ID'],
                  'queue_sha256': file_digest(queue_path), 'sources': source_reports,
                  'purpose': 'public source selection and composition study',
                  'photographic_acceptance': False, 'installation_performed': False,
                  'geometry_filter': geometry_filter,
                  'surface_detail': surface_detail,
                  'sources_of_lighting': [], 'views': []}
        panorama_position, grounding = None, None
        if study.get('panorama'):
            panorama_position, grounding = panorama_camera(scene, study['panorama'], center, extent, maximum)
            report['panorama_grounding'] = grounding
        for lighting in study['lighting']:
            renderer.environment(scene, SimpleNamespace(hdri=lighting['hdri'],
                hdri_rotation=lighting.get('rotation_degrees', 0), environment_strength=1), {})
            report['sources_of_lighting'].append({'phase': lighting['phase'],
                'path': str(Path(lighting['hdri']).resolve()), 'sha256': file_digest(lighting['hdri'])})
            if study.get('panorama'):
                panorama = study['panorama']
                camera.location = panorama_position
                camera.rotation_euler = (math.pi / 2, 0, 0)
                camera_data.type = 'PANO'
                camera_data.panorama_type = 'EQUIRECTANGULAR'
                scene.render.resolution_x = panorama.get('width', 4096)
                scene.render.resolution_y = scene.render.resolution_x // 2
                scene.render.film_transparent = True
                target_file = directory / f"{study['id']}-{lighting['phase']}-panorama.png"
                sky_file = directory / f"{study['id']}-{lighting['phase']}-sky.png"
                scene.render.filepath = str(target_file)
                bpy.ops.render.render(write_still=True)
                renderer.sky_image(scene, sky_file)
                report.setdefault('panoramas', []).append({'phase': lighting['phase'],
                    'path': target_file.name, 'sha256': file_digest(target_file),
                    'sky': sky_file.name, 'sky_sha256': file_digest(sky_file),
                    'camera': list(camera.location),
                    'dimensions': [scene.render.resolution_x, scene.render.resolution_y]})
                if study.get('save_blend'):
                    bpy.ops.file.pack_all()
                    bpy.ops.wm.save_as_mainfile(filepath=str(directory / f"{study['id']}-{lighting['phase']}.blend"))
            camera_data.type = 'PERSP'
            scene.render.film_transparent = False
            scene.render.resolution_x = study.get('width', 1600)
            scene.render.resolution_y = study.get('height', 1100)
            for view in study['views']:
                if view.get('from_panorama'):
                    if panorama_position is None:
                        raise ValueError('Fixed viewpoint review requires a panorama camera')
                    camera.location = panorama_position
                    yaw = math.radians(view.get('yaw_degrees', 0))
                    pitch = math.radians(view.get('pitch_degrees', 0))
                    target = camera.location + Vector((math.sin(yaw) * math.cos(pitch),
                        math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
                else:
                    camera.location = Vector(view['position']) if 'position' in view else center + Vector(view['relative_position']) * extent
                    target = Vector(view['target']) if 'target' in view else center + Vector(view.get('relative_target', [0, 0, 0])) * extent
                direction = target - camera.location
                if direction.length < .001:
                    raise ValueError('Study camera and target coincide')
                camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
                camera_data.lens = 24 / (2 * math.tan(math.radians(view.get('vertical_fov', 48)) / 2))
                target_file = directory / f"{study['id']}-{lighting['phase']}-{view['name']}.png"
                scene.render.filepath = str(target_file)
                bpy.ops.render.render(write_still=True)
                report['views'].append({'name': view['name'], 'phase': lighting['phase'],
                    'path': target_file.name, 'sha256': file_digest(target_file),
                    'camera': list(camera.location), 'target': list(target),
                    'vertical_fov': view.get('vertical_fov', 48)})
            (directory / 'evidence.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print('PUBLIC_MODEL_STUDY', json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
