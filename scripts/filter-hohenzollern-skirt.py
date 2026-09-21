"""Add a textured, open-sided rock skirt around the Hohenzollern scan."""
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


def _rock_material(options):
    material = bpy.data.materials.get('Hohenzollern review rock skirt')
    if material is not None:
        return material
    diffuse_path = Path(options['diffuse']).resolve()
    normal_path = Path(options['normal']).resolve()
    if not diffuse_path.is_file() or not normal_path.is_file():
        raise FileNotFoundError('Hohenzollern rock skirt textures are missing')
    material = bpy.data.materials.new('Hohenzollern review rock skirt')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Roughness'].default_value = .88
    diffuse = nodes.new('ShaderNodeTexImage')
    diffuse.image = bpy.data.images.load(str(diffuse_path), check_existing=True)
    normal = nodes.new('ShaderNodeTexImage')
    normal.image = bpy.data.images.load(str(normal_path), check_existing=True)
    normal.image.colorspace_settings.name = 'Non-Color'
    normal_map = nodes.new('ShaderNodeNormalMap')
    texcoord = nodes.new('ShaderNodeTexCoord')
    links.new(texcoord.outputs['Generated'], diffuse.inputs['Vector'])
    links.new(texcoord.outputs['Generated'], normal.inputs['Vector'])
    links.new(diffuse.outputs['Color'], shader.inputs['Base Color'])
    links.new(normal.outputs['Color'], normal_map.inputs['Color'])
    links.new(normal_map.outputs['Normal'], shader.inputs['Normal'])
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    return material


def apply(objects, options=None):
    """Create an open-sided irregular skirt below the scan's existing terrain."""
    options = options or {}
    center_x = float(options.get('center_x', -4.5))
    center_y = float(options.get('center_y', -3.0))
    top_z = float(options.get('top_z', 8.5))
    lower_z = float(options.get('lower_z', -6.0))
    top_radius_x = float(options.get('top_radius_x', 38.5))
    top_radius_y = float(options.get('top_radius_y', 40.5))
    lower_radius_x = float(options.get('lower_radius_x', 47.0))
    lower_radius_y = float(options.get('lower_radius_y', 49.0))
    segments = int(options.get('segments', 96))
    if segments < 24 or top_z <= lower_z:
        raise ValueError('Invalid Hohenzollern skirt dimensions')
    material = _rock_material(options)
    clip_source_below_z = options.get('clip_source_below_z')
    clipped_faces = 0
    if clip_source_below_z is not None:
        clip_height = float(clip_source_below_z)
        for instance in list(objects):
            if instance.type != 'MESH':
                continue
            mesh = bmesh.new()
            mesh.from_mesh(instance.data)
            inverse = instance.matrix_world.inverted()
            plane_co = inverse @ Vector((0, 0, clip_height))
            plane_no = (inverse.transposed().to_3x3() @ Vector((0, 0, 1))).normalized()
            result = bmesh.ops.bisect_plane(
                mesh,
                geom=list(mesh.verts) + list(mesh.edges) + list(mesh.faces),
                plane_co=plane_co,
                plane_no=plane_no,
                dist=1e-5,
                clear_inner=True,
                clear_outer=False,
            )
            clipped_faces += len(result.get('geom_cut', []))
            mesh.to_mesh(instance.data)
            mesh.free()
            instance.data.update()
    vertices = []
    phases = (0.0, 0.16, -0.11)
    for ring_index, (height, rx, ry) in enumerate(((top_z, top_radius_x, top_radius_y),
                                                     ((top_z + lower_z) * .5,
                                                      (top_radius_x + lower_radius_x) * .5,
                                                      (top_radius_y + lower_radius_y) * .5),
                                                     (lower_z, lower_radius_x, lower_radius_y))):
        for index in range(segments):
            angle = 2 * math.pi * index / segments
            variation = 1 + .045 * math.sin(index * 2.37 + phases[ring_index])
            vertices.append((center_x + rx * variation * math.cos(angle),
                             center_y + ry * variation * math.sin(angle), height))
    faces = []
    for ring in range(2):
        first = ring * segments
        second = (ring + 1) * segments
        for index in range(segments):
            next_index = (index + 1) % segments
            faces.append((first + index, second + index, second + next_index, first + next_index))
    mesh = bpy.data.meshes.new('Hohenzollern review rock skirt mesh')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    skirt = bpy.data.objects.new('Hohenzollern review rock skirt', mesh)
    bpy.context.collection.objects.link(skirt)
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.material_index = 0
        polygon.use_smooth = True
    objects.add(skirt)
    return {
        'id': 'hohenzollern-textured-rock-skirt-r1',
        'method': 'open-sided irregular three-ring skirt with Poly Haven mountainside diffuse and normal maps',
        'source_installation': False,
        'parameters': {
            'center_xy': [center_x, center_y],
            'top_z': top_z,
            'lower_z': lower_z,
            'top_radii_xy': [top_radius_x, top_radius_y],
            'lower_radii_xy': [lower_radius_x, lower_radius_y],
            'segments': segments,
            'clip_source_below_z': clip_source_below_z,
        },
        'source_clip_intersections': clipped_faces,
        'vertices': len(vertices),
        'faces': len(faces),
        'limitations': [
            'Review-only geometry; original scan and source package remain unchanged',
            'Skirt is open at the top and bottom; all six directions require visual review',
        ],
    }
