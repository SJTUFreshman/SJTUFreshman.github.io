"""Trim a scanned mountain base and add a textured snow receiving plane."""
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


def _image(path):
    image = bpy.data.images.load(str(Path(path).resolve()), check_existing=True)
    image.colorspace_settings.name = 'sRGB'
    return image


def _material(options):
    material = bpy.data.materials.new('Public mountain snow receiving ground')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Roughness'].default_value = .88
    shader.inputs['Specular IOR Level'].default_value = .18
    texcoord = nodes.new('ShaderNodeUVMap')
    texcoord.uv_map = 'Mountain snow world XY'
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (options.get('texture_scale', 0.16),) * 3
    diff = nodes.new('ShaderNodeTexImage')
    diff.image = _image(options['diffuse'])
    diff.extension = 'REPEAT'
    normal = nodes.new('ShaderNodeTexImage')
    normal.image = _image(options['normal'])
    normal.extension = 'REPEAT'
    normal.image.colorspace_settings.name = 'Non-Color'
    rough = nodes.new('ShaderNodeTexImage')
    rough.image = _image(options['roughness'])
    rough.extension = 'REPEAT'
    rough.image.colorspace_settings.name = 'Non-Color'
    bump = nodes.new('ShaderNodeNormalMap')
    bump.uv_map = texcoord.uv_map
    bump.inputs['Strength'].default_value = .24
    links.new(texcoord.outputs['UV'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], diff.inputs['Vector'])
    links.new(mapping.outputs['Vector'], normal.inputs['Vector'])
    links.new(mapping.outputs['Vector'], rough.inputs['Vector'])
    links.new(diff.outputs['Color'], shader.inputs['Base Color'])
    links.new(rough.outputs['Color'], shader.inputs['Roughness'])
    links.new(normal.outputs['Color'], bump.inputs['Color'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    return material


def _world_xy_uv(mesh):
    layer = mesh.uv_layers.new(name='Mountain snow world XY')
    for loop in mesh.loops:
        coordinate = mesh.vertices[loop.vertex_index].co
        layer.data[loop.index].uv = (coordinate.x, coordinate.y)


def apply(objects, options):
    ground_z = float(options.get('ground_z', 0.45))
    size = float(options.get('size', 120.0))
    remove_below = options.get('remove_vertical_below')
    normal_limit = float(options.get('vertical_normal_z', 0.22))
    removed_faces = 0
    if remove_below is not None:
        remove_below = float(remove_below)
        for instance in objects:
            if instance.type != 'MESH':
                continue
            mesh = bmesh.new()
            mesh.from_mesh(instance.data)
            mesh.faces.ensure_lookup_table()
            world_normal = instance.matrix_world.to_3x3().inverted().transposed()
            doomed = []
            for face in mesh.faces:
                center = instance.matrix_world @ face.calc_center_median()
                normal = (world_normal @ face.normal).normalized()
                if center.z < remove_below and abs(normal.z) < normal_limit:
                    doomed.append(face)
            if doomed:
                bmesh.ops.delete(mesh, geom=doomed, context='FACES')
                removed_faces += len(doomed)
            mesh.to_mesh(instance.data)
            mesh.free()
            instance.data.update()
    half = size * .5
    mesh = bpy.data.meshes.new('Public mountain receiving ground mesh')
    mesh.from_pydata([(-half, -half, ground_z), (half, -half, ground_z),
                      (half, half, ground_z), (-half, half, ground_z)],
                     [], [(0, 1, 2, 3)])
    _world_xy_uv(mesh)
    mesh.materials.append(_material(options))
    ground = bpy.data.objects.new('Public mountain receiving ground', mesh)
    bpy.context.collection.objects.link(ground)
    if options.get('berm_inner_radius') is not None:
        inner = float(options['berm_inner_radius'])
        outer = float(options.get('berm_outer_radius', inner + 10.0))
        peak = ground_z + float(options.get('berm_height', 2.0))
        segments = int(options.get('berm_segments', 96))
        vertices = []
        faces = []
        for ring, radius in enumerate((inner, outer)):
            for index in range(segments):
                angle = 6.283185307179586 * index / segments
                height = peak if ring == 0 else ground_z
                vertices.append((radius * math.cos(angle), radius * math.sin(angle), height))
        for index in range(segments):
            next_index = (index + 1) % segments
            faces.append((index, next_index, segments + next_index, segments + index))
        berm_mesh = bpy.data.meshes.new('Public mountain snow berm mesh')
        berm_mesh.from_pydata(vertices, [], faces)
        _world_xy_uv(berm_mesh)
        berm_mesh.materials.append(mesh.materials[0])
        berm = bpy.data.objects.new('Public mountain snow berm', berm_mesh)
        bpy.context.collection.objects.link(berm)
    return {'ground_z': ground_z, 'size': size, 'material': mesh.materials[0].name,
            'removed_vertical_base_faces': removed_faces,
            'berm': {'inner_radius': options.get('berm_inner_radius'),
                     'outer_radius': options.get('berm_outer_radius'),
                     'height': options.get('berm_height')},
            'limitation': 'Receiving plane masks the scanned open base; it is not source geometry.'}
