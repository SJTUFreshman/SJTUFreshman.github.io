"""Inspect a scan cut using boundary-matched diagnostic walls, not terrain."""
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


UV_NAME = 'Hohenzollern diagnostic boundary UV'
BOUNDARY_TOLERANCE = 1e-4


def _rock_material(options):
    diffuse_path = Path(options['diffuse']).resolve()
    normal_path = Path(options['normal']).resolve()
    if not diffuse_path.is_file() or not normal_path.is_file():
        raise FileNotFoundError('Hohenzollern rock skirt textures are missing')
    material = bpy.data.materials.new('Hohenzollern diagnostic boundary material')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.inputs['Roughness'].default_value = .88
    diffuse = nodes.new('ShaderNodeTexImage')
    diffuse.image = bpy.data.images.load(str(diffuse_path), check_existing=True)
    diffuse.extension = 'REPEAT'
    normal = nodes.new('ShaderNodeTexImage')
    normal.image = bpy.data.images.load(str(normal_path), check_existing=True)
    normal.image.colorspace_settings.name = 'Non-Color'
    normal.extension = 'REPEAT'
    normal_map = nodes.new('ShaderNodeNormalMap')
    normal_map.uv_map = UV_NAME
    texcoord = nodes.new('ShaderNodeUVMap')
    texcoord.uv_map = UV_NAME
    links.new(texcoord.outputs['UV'], diffuse.inputs['Vector'])
    links.new(texcoord.outputs['UV'], normal.inputs['Vector'])
    links.new(diffuse.outputs['Color'], shader.inputs['Base Color'])
    links.new(normal.outputs['Color'], normal_map.inputs['Color'])
    links.new(normal_map.outputs['Normal'], shader.inputs['Normal'])
    links.new(shader.outputs['BSDF'], output.inputs['Surface'])
    return material


def _boundary_loops(points, edges):
    adjacency = {}
    unique_edges = set()
    for edge_index, (first, second) in enumerate(edges):
        if not all(math.isfinite(value) for point in (points[first], points[second]) for value in point):
            raise ValueError('Nonfinite Hohenzollern cut boundary point')
        if first == second or math.dist(points[first], points[second]) <= 1e-7:
            raise ValueError('Degenerate Hohenzollern cut boundary edge')
        identity = tuple(sorted((first, second)))
        if identity in unique_edges:
            raise ValueError('Duplicate Hohenzollern cut boundary edge')
        unique_edges.add(identity)
        adjacency.setdefault(first, []).append((edge_index, second))
        adjacency.setdefault(second, []).append((edge_index, first))
    open_vertices = sum(len(neighbours) == 1 for neighbours in adjacency.values())
    branch_vertices = sum(len(neighbours) > 2 for neighbours in adjacency.values())
    if open_vertices or branch_vertices:
        raise ValueError(f'Hohenzollern cut boundary is open or branched: '
                         f'{open_vertices} open vertices, {branch_vertices} branch vertices')
    loops, unused = [], set(range(len(edges)))
    while unused:
        index = min(unused)
        first, second = edges[index]
        unused.remove(index)
        loop = [first, second]
        while loop[-1] != loop[0]:
            candidates = [item for item in adjacency[loop[-1]] if item[0] in unused]
            if len(candidates) != 1:
                raise ValueError('Hohenzollern cut boundary traversal did not close uniquely')
            edge_index, following = candidates[0]
            unused.remove(edge_index)
            loop.append(following)
        if len(loop) < 4 or len(set(loop[:-1])) != len(loop) - 1:
            raise ValueError('Degenerate Hohenzollern cut boundary loop')
        polygon = [points[identifier] for identifier in loop[:-1]]
        signed_area = sum(first[0] * second[1] - second[0] * first[1]
                          for first, second in zip(polygon, polygon[1:] + polygon[:1])) * .5
        if abs(signed_area) <= 1e-8:
            raise ValueError('Hohenzollern cut boundary loop has no planar area')
        loops.append(polygon if signed_area > 0 else polygon[::-1])
    if sum(len(loop) for loop in loops) != len(edges):
        raise ValueError('Not every Hohenzollern cut boundary edge was consumed')
    return loops


def _clip_boundary(instance, clip_height):
    if not math.isfinite(clip_height):
        raise ValueError('Invalid Hohenzollern clipping height')
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
        if not mesh.faces:
            raise ValueError('Hohenzollern clipping removed all source faces')
        mesh.verts.index_update()
        cut_edges = {element for element in result.get('geom_cut', [])
                     if isinstance(element, bmesh.types.BMEdge) and element.is_valid}
        points, edges = {}, []
        retained_open_edges = 0
        for edge in mesh.edges:
            if not edge.is_boundary:
                continue
            endpoints = [instance.matrix_world @ vertex.co for vertex in edge.verts]
            on_plane = all(abs(point.z - clip_height) <= BOUNDARY_TOLERANCE for point in endpoints)
            if edge not in cut_edges or not on_plane:
                retained_open_edges += 1
                continue
            for vertex, point in zip(edge.verts, endpoints):
                points[vertex.index] = tuple(point)
            edges.append(tuple(vertex.index for vertex in edge.verts))
        loops = _boundary_loops(points, edges)
        report = {'object': instance.name, 'source_clip_intersections': len(result.get('geom_cut', [])),
                  'cut_boundary_edges': len(edges), 'cut_boundary_loops': len(loops),
                  'retained_source_open_edges': retained_open_edges,
                  'all_cut_boundary_edges_consumed': True}
        return mesh, loops, report
    except Exception:
        mesh.free()
        raise


def _wall_geometry(loops, lower_z, texture_tile_size):
    vertices, faces, face_uvs = [], [], []
    for loop in loops:
        start = len(vertices)
        count = len(loop)
        vertices.extend(loop)
        vertices.extend((point[0], point[1], lower_z) for point in loop)
        chainage = 0
        for index, first in enumerate(loop):
            following = (index + 1) % count
            second = loop[following]
            next_chainage = chainage + math.dist(first, second)
            faces.append((start + index, start + count + index,
                          start + count + following, start + following))
            face_uvs.append(((chainage / texture_tile_size, (first[2] - lower_z) / texture_tile_size),
                             (chainage / texture_tile_size, 0), (next_chainage / texture_tile_size, 0),
                             (next_chainage / texture_tile_size, (second[2] - lower_z) / texture_tile_size)))
            chainage = next_chainage
    return vertices, faces, face_uvs


def apply(objects, options=None):
    """Clip a source and add diagnostic walls with exact cut-edge coverage."""
    options = options or {}
    obsolete = {'center_x', 'center_y', 'top_z', 'top_radius_x', 'top_radius_y',
                'lower_radius_x', 'lower_radius_y', 'segments'} & options.keys()
    if obsolete:
        raise ValueError(f'Obsolete Hohenzollern ellipse options: {sorted(obsolete)}')
    clip_height = float(options['clip_source_below_z'])
    lower_z = float(options.get('lower_z', -6.0))
    texture_tile_size = float(options.get('texture_tile_size', 8.0))
    if (not all(math.isfinite(value) for value in (clip_height, lower_z, texture_tile_size))
            or lower_z >= clip_height or texture_tile_size <= 0):
        raise ValueError('Invalid Hohenzollern diagnostic dimensions')
    prepared, loops, reports = [], [], []
    try:
        for instance in sorted((item for item in objects if item.type == 'MESH'), key=lambda item: item.name):
            mesh, boundary, report = _clip_boundary(instance, clip_height)
            prepared.append((instance, mesh))
            loops.extend(boundary)
            reports.append(report)
        if not loops:
            raise ValueError('Clipping produced no real Hohenzollern boundary loops')
        vertices, faces, face_uvs = _wall_geometry(loops, lower_z, texture_tile_size)
        material = _rock_material(options)
        wall_mesh = bpy.data.meshes.new('Hohenzollern diagnostic boundary mesh')
        wall_mesh.from_pydata(vertices, [], faces)
        wall_mesh.update()
        uv_layer = wall_mesh.uv_layers.new(name=UV_NAME)
        for polygon, coordinates in zip(wall_mesh.polygons, face_uvs):
            for loop_index, coordinate in zip(polygon.loop_indices, coordinates):
                uv_layer.data[loop_index].uv = coordinate
        wall_mesh.materials.append(material)
        walls = bpy.data.objects.new('Hohenzollern diagnostic boundary walls', wall_mesh)
        bpy.context.collection.objects.link(walls)
        for instance, mesh in prepared:
            mesh.to_mesh(instance.data)
            instance.data.update()
        objects.add(walls)
    finally:
        for instance, mesh in prepared:
            mesh.free()
    return {
        'id': 'hohenzollern-boundary-diagnostic-r4',
        'method': 'degree-two cut loops extended vertically for boundary diagnosis only',
        'source_installation': False,
        'photographic_acceptance': False,
        'parameters': {
            'lower_z': lower_z,
            'clip_source_below_z': clip_height,
            'texture_tile_size_source_units': texture_tile_size,
        },
        'objects': reports,
        'source_clip_intersections': sum(report['source_clip_intersections'] for report in reports),
        'vertices': len(vertices),
        'faces': len(faces),
        'real_boundary_loops': len(loops),
        'real_boundary_edges': sum(len(loop) for loop in loops),
        'all_cut_boundary_edges_consumed': True,
        'retained_source_open_edges': sum(report['retained_source_open_edges'] for report in reports),
        'diagnostic_bottom_open_edges': sum(len(loop) for loop in loops),
        'top_caps_added': 0,
        'source_surface_closed': False,
        'uv_map': UV_NAME,
        'limitations': [
            'Diagnostic walls are artificial extrusion, not a photographic terrain replacement',
            'Original licensed package is unchanged; imported study meshes are clipped',
            'Source holes and open wall bottoms are reported, not filled or claimed closed',
            'Texture scale is in unverified source units, not measured metres',
        ],
    }
