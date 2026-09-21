"""Assembled CC0 industrial architecture for offline street panoramas."""
import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


ROOT = Path(__file__).resolve().parent.parent
REPLACED_BUILDINGS = (0, 1, 4)


def _extents(points):
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def _age_material(source):
    surface = source.copy()
    surface.name = 'Wasteland/CC0 retained PBR ' + source.name
    if 'glass' in source.name.lower():
        return surface
    nodes, links = surface.node_tree.nodes, surface.node_tree.links
    shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
    base = shader.inputs['Base Color']
    original = base.links[0].from_socket if base.links else None
    color = tuple(base.default_value)
    coordinates = nodes.new('ShaderNodeNewGeometry')
    stretched = nodes.new('ShaderNodeVectorMath')
    stretched.operation = 'MULTIPLY'
    stretched.inputs[1].default_value = (.75, .75, .035)
    links.new(coordinates.outputs['Position'], stretched.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 1
    noise.inputs['Detail'].default_value = 3
    links.new(stretched.outputs[0], noise.inputs['Vector'])
    stains = nodes.new('ShaderNodeValToRGB')
    stains.color_ramp.elements[0].position = .22
    stains.color_ramp.elements[0].color = (.60, .57, .52, 1)
    stains.color_ramp.elements[1].position = .68
    stains.color_ramp.elements[1].color = (.96, .95, .92, 1)
    links.new(noise.outputs['Fac'], stains.inputs[0])
    multiply = nodes.new('ShaderNodeMixRGB')
    multiply.blend_type = 'MULTIPLY'
    multiply.inputs[0].default_value = .52
    if original:
        links.new(original, multiply.inputs[1])
    else:
        multiply.inputs[1].default_value = color
    links.new(stains.outputs['Color'], multiply.inputs[2])
    links.new(multiply.outputs[0], base)
    surface['preserved_texture_channels'] = 'CC0 UV base color, ARM, normal and glass alpha'
    return surface


class _Modules:
    def __init__(self, asset, collection):
        directory = ROOT / 'assets/life/models' / asset
        candidates = [directory / f'{asset}_{resolution}.gltf' for resolution in ('8k', '4k', '2k', '1k')]
        source = next((candidate for candidate in candidates if candidate.is_file()), None)
        if source is None:
            raise FileNotFoundError(f'Offline industrial asset is required: {directory}')
        names = {node['name'] for node in json.loads(source.read_text())['nodes'] if 'mesh' in node}
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(source), merge_vertices=False)
        imported = set(bpy.data.objects) - before
        bpy.context.view_layer.update()
        self.asset, self.collection = asset, collection
        self.parts, self.instances, self.materials = {}, [], {}
        for instance in imported:
            if instance.type != 'MESH':
                continue
            name = instance.name if instance.name in names else re.sub(r'\.\d{3}$', '', instance.name)
            if name not in names or name in self.parts:
                raise ValueError(f'Ambiguous imported industrial module: {instance.name}')
            origin = instance.matrix_world.translation.copy()
            geometry = instance.data.copy()
            geometry.name = f'Wasteland/{asset}/{name}'
            geometry.transform(Matrix.Translation(-origin) @ instance.matrix_world)
            geometry.update()
            for slot, surface in enumerate(geometry.materials):
                if surface.name not in self.materials:
                    self.materials[surface.name] = _age_material(surface)
                geometry.materials[slot] = self.materials[surface.name]
            low, high = _extents([vertex.co for vertex in geometry.vertices])
            self.parts[name] = {'mesh': geometry, 'origin': origin, 'low': low, 'high': high}
        for instance in imported:
            bpy.data.objects.remove(instance, do_unlink=True)
        if len(self.parts) != len(names):
            raise ValueError(f'Incomplete industrial module import: {asset}')

    def place(self, name, transform, role):
        part = self.parts[name]
        instance = bpy.data.objects.new('Wasteland/' + role, part['mesh'])
        self.collection.objects.link(instance)
        instance.matrix_world = transform
        instance['public_asset'] = 'Poly Haven ' + self.asset + ', CC0'
        instance['public_asset_module'] = name
        instance['offline_only'] = True
        self.instances.append(instance)
        return instance

    def validate_factory(self):
        sample = self.parts['wall_standard_standard_01']
        extent = sample['high'] - sample['low']
        if abs(extent.x - 3) > .005 or abs(extent.z - 3) > .005 or extent.y > .01:
            raise ValueError('Factory must retain Blender-imported Z-up orientation and 3 m module size')


class _StreetGrade:
    def __init__(self, scene, helpers):
        bpy.context.view_layer.update()
        dependency_graph = bpy.context.evaluated_depsgraph_get()
        self.surfaces = []
        for instance in scene.objects:
            if instance.type != 'MESH' or instance.hide_render:
                continue
            center, extent, low, high = helpers['bounds'](instance)
            if instance.get('offline_role') != 'wasteland-courtyard-ground' and not (
                    extent.x > 100 and extent.y > 100 and abs(center.z) < .05 and extent.z < .01):
                continue
            self.surfaces.append((instance.matrix_world.copy(), instance.matrix_world.inverted(),
                                  BVHTree.FromObject(instance, dependency_graph)))
        if not self.surfaces:
            raise ValueError('Industrial reconstruction requires actual street ground geometry')

    def height(self, horizontal, north):
        origin = Vector((horizontal, north, 20))
        hits = []
        for transform, inverse, tree in self.surfaces:
            direction = (inverse.to_3x3() @ Vector((0, 0, -1))).normalized()
            point = tree.ray_cast(inverse @ origin, direction)[0]
            if point is not None:
                hits.append((transform @ point).z)
        if not hits:
            raise ValueError('Industrial foundation lies outside verified street ground')
        return max(hits)

    def verify_contact(self, instances):
        clearances = []
        for instance in instances:
            points = [instance.matrix_world @ vertex.co for vertex in instance.data.vertices]
            minimum = min(point.z for point in points)
            for point in points:
                if point.z > minimum + .001:
                    continue
                clearance = point.z - self.height(point.x, point.y)
                if not -.004 <= clearance <= .002:
                    raise ValueError(f'Industrial foundation fails actual ground contact: {instance.name}, {clearance}')
                clearances.append(clearance)
        if not clearances:
            raise ValueError('Industrial ground contact has no actual mesh samples')
        return {'samples': len(clearances), 'minimum_clearance_m': min(clearances),
                'maximum_clearance_m': max(clearances)}


def _face_frame(transform, width, length, side):
    frames = ((0, -length / 2, 0), (width / 2, 0, math.pi / 2),
              (0, length / 2, math.pi), (-width / 2, 0, -math.pi / 2))
    across, north, angle = frames[side]
    return transform @ Matrix.Translation((across, north, 0)) @ Matrix.Rotation(angle, 4, 'Z')


def _factory(library, builder, helpers, grade, building_index, center, bays, depth_bays, floors, yaw):
    width, length, height = bays * 3.0, depth_bays * 3.0, floors * 3.0
    ground_height = grade.height(center.x, center.y)
    transform = Matrix.Translation((center.x, center.y, ground_height - .001)) @ Matrix.Rotation(yaw, 4, 'Z')
    start = len(library.instances)
    roof_name = f'factory_roof_{building_index}'
    helpers['library_material'](builder, roof_name, 'painted_metal_shutter', (.66, .72, .72), .65)
    roof_shader = next(node for node in builder.materials[roof_name].node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    roof_shader.inputs['Metallic'].default_value = .42
    glass_name = f'factory_northlight_{building_index}'
    builder.materials[glass_name] = helpers['material']('dust filmed wire glass northlight', '#697b78', .36, .22)
    glass_shader = next(node for node in builder.materials[glass_name].node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    glass_shader.inputs['Transmission Weight'].default_value = .18
    brick = library.parts['wall_standard_standard_01']['mesh'].materials[0]
    batch = helpers['batch'](builder.collection, f'Wasteland/factory {building_index} interior and roof',
                             [builder.materials['concrete'], builder.materials[roof_name],
                              builder.materials[glass_name], brick])

    def place(across, north, altitude):
        return transform @ Vector((across, north, altitude))

    for side in range(4):
        count = bays if side % 2 == 0 else depth_bays
        face_width = count * 3
        frame = _face_frame(transform, width, length, side)
        for floor in range(floors):
            for bay in range(count):
                origin = frame @ Matrix.Translation((-face_width / 2 + (bay + 1) * 3, 0, floor * 3))
                if side == 0 and floor == 0 and bay == 1:
                    library.place('wall_door_centered_large_01', origin, 'factory street entrance brickwork')
                    library.place('door_centered_large_01', origin, 'factory weathered double entrance door')
                else:
                    variant = ('01', '02', '03', '04')[(bay + side * 2 + floor + building_index) % 4]
                    if side == 2 and (bay + floor) % 3 == 0:
                        library.place('wall_standard_standard_01', origin, 'factory solid service wall')
                    else:
                        library.place('wall_window_centered_large_' + variant, origin, 'factory brick window bay')
                        library.place('window_centered_large_' + variant, origin, 'factory retained or broken glazed sash')
                if floor == 0:
                    plinth = ('base_standard_standard_01' if not (side == 0 and bay == 1)
                              else 'dado_door_centered_large_01')
                    library.place(plinth, origin, 'factory ground contact brick plinth')
                if floor == floors - 1:
                    cornice = frame @ Matrix.Translation((-face_width / 2 + (bay + 1) * 3, 0, height))
                    library.place('cornice01_standard_standard_01', cornice, 'factory deep weathered roof cornice')
                elif floor > 0:
                    library.place('cornice03_standard_standard_01', origin, 'factory restrained storey string course')
        for edge in range(count + 1):
            for floor in range(floors):
                origin = frame @ Matrix.Translation((-face_width / 2 + edge * 3, -.015, floor * 3))
                library.place('wall_pier_standard_01', origin, 'factory brick structural pilaster')
    for floor in range(floors):
        batch.box((0, 0, floor * 3 + .06), (width - .12, length - .12, .12), place, 0)
    for across in (-width / 6, width / 6):
        batch.box((across, 0, height / 2), (.24, length - .34, height - .24), place, 3)
    for north in (-length / 6, length / 6):
        batch.box((0, north, height / 2), (width - .34, .16, height - .24), place, 0)
    roof_height = height + .17
    tooth_count = 3 if depth_bays >= 7 else 2
    tooth_depth = length / tooth_count
    for tooth in range(tooth_count):
        first = -length / 2 + tooth * tooth_depth
        last = first + tooth_depth
        ridge = last - .8
        for section in range(bays * 24):
            left = -width / 2 - .13 + section / (bays * 24) * (width + .26)
            right = -width / 2 - .13 + (section + 1) / (bays * 24) * (width + .26)
            corrugation_left = .014 * math.cos(section * math.pi)
            corrugation_right = .014 * math.cos((section + 1) * math.pi)
            batch.prism([place(left, first, roof_height + corrugation_left),
                         place(right, first, roof_height + corrugation_right),
                         place(right, ridge, roof_height + 1.70 + corrugation_right),
                         place(left, ridge, roof_height + 1.70 + corrugation_left)],
                        [place(left, first, roof_height - .018 + corrugation_left),
                         place(right, first, roof_height - .018 + corrugation_right),
                         place(right, ridge, roof_height + 1.682 + corrugation_right),
                         place(left, ridge, roof_height + 1.682 + corrugation_left)], 1)
        batch.prism([place(-width / 2, ridge, roof_height + 1.69), place(width / 2, ridge, roof_height + 1.69),
                     place(width / 2, last, roof_height), place(-width / 2, last, roof_height)],
                    [place(-width / 2, ridge + .02, roof_height + 1.69), place(width / 2, ridge + .02, roof_height + 1.69),
                     place(width / 2, last + .02, roof_height), place(-width / 2, last + .02, roof_height)], 2)
        for side in (-1, 1):
            batch.prism([place(side * width / 2, first, roof_height),
                         place(side * width / 2, ridge, roof_height + 1.70),
                         place(side * width / 2, last, roof_height)],
                        [place(side * (width / 2 - .16), first, roof_height),
                         place(side * (width / 2 - .16), ridge, roof_height + 1.70),
                         place(side * (width / 2 - .16), last, roof_height)], 3)
        for seam in range(bays + 1):
            across = -width / 2 + seam * 3
            builder.rod('factory roof sheet overlap rib', place(across, first, roof_height + .036),
                        place(across, ridge, roof_height + 1.736), .018, roof_name, 10)
        for fraction in (.0, .5, 1.0):
            north = ridge + (last - ridge) * fraction
            altitude = roof_height + 1.70 * (1 - fraction) + .026
            builder.rod('factory continuous northlight transom', place(-width / 2, north, altitude),
                        place(width / 2, north, altitude), .029, 'steel', 12)
        for mullion in range(bays * 2 + 1):
            across = -width / 2 + mullion * 1.5
            builder.rod('factory northlight steel mullion', place(across, ridge - .01, roof_height + 1.72),
                        place(across, last - .02, roof_height + .02), .024, 'steel', 12)
    assembled = batch.finish(bevel=.004)
    helpers['physical_uv'](assembled)
    bpy.context.view_layer.update()
    ground_parts = [instance for instance in library.instances[start:]
                    if instance['public_asset_module'].startswith(('base_', 'dado_'))]
    minima = [min((instance.matrix_world @ Vector(corner)).z for corner in instance.bound_box)
              for instance in ground_parts]
    contact = grade.verify_contact(ground_parts)
    return {'building': building_index, 'style': 'CC0 brick factory with sawtooth roof',
            'footprint_m': [width, length], 'height_m': roof_height + 1.70,
            'storeys': floors, 'factory_modules': len(library.instances) - start,
            'roof_cladding': 'CC0 weathered metal with physical sheet seams, brick end walls and glazed northlights',
            'ground_contact_min_m': min(minima), 'actual_ground_height_m': ground_height,
            'actual_plinth_ground_contact': contact, 'yaw_radians': yaw}


def _insulator_terminals(part):
    candidates = sorted((vertex.co.copy() for vertex in part['mesh'].vertices
                         if vertex.co.z > part['high'].z - .03), key=lambda point: point.x)
    groups = []
    for point in candidates:
        if not groups or point.x - groups[-1][-1].x > .08:
            groups.append([])
        groups[-1].append(point)
    if len(groups) != 3:
        raise ValueError('Utility crossarm must expose three separate insulator terminal caps')
    tree = BVHTree.FromPolygons([vertex.co for vertex in part['mesh'].vertices],
                               [tuple(polygon.vertices) for polygon in part['mesh'].polygons])
    terminals, distances = [], []
    for group in groups:
        low, high = _extents(group)
        origin = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, high.z + .04))
        hit = tree.ray_cast(origin, Vector((0, 0, -1)), .09)[0]
        if hit is None or hit.z < high.z - .025:
            raise ValueError('Utility terminal center does not intersect its actual top cap')
        terminal = hit + Vector((0, 0, .004))
        nearest = tree.find_nearest(terminal)
        if nearest[0] is None or nearest[3] > .006:
            raise ValueError('Utility conductor fails contact with its scanned insulator cap')
        terminals.append(terminal)
        distances.append(nearest[3])
    separations = [(last - first).length for first, last in zip(terminals, terminals[1:])]
    if any(not .43 < separation < .47 for separation in separations):
        raise ValueError('Utility terminal spacing changed from the verified 45 cm crossarm')
    return terminals, distances


def _poles(builder, grade):
    library = _Modules('modular_electricity_poles', builder.collection)
    placements = ((-10.4, -13.2, '03', .06), (-10.7, 10.6, '03', .04),
                  (-11.1, 34.8, '03', .02), (10.5, 15.2, '02', -.07),
                  (10.9, 39.6, '02', -.05))
    connectors, reports, contact_distances, conductor_reports = [], [], [], []
    for index, (across, north, preset, yaw) in enumerate(placements):
        prefix = 'preset_' + preset + '_'
        parts = {name: part for name, part in library.parts.items() if name.startswith(prefix)}
        trunk = parts[prefix + 'pole']
        reference = trunk['origin']
        base = trunk['low'].z
        height = trunk['high'].z - base
        if not 5.7 <= height <= 6.4:
            raise ValueError('Imported electricity pole is not an upright six-metre module')
        ground_height = grade.height(across, north)
        transform = Matrix.Translation((across, north, ground_height - base - .001)) @ Matrix.Rotation(yaw, 4, 'Z')
        placed = {}
        for name, part in parts.items():
            relative = Matrix.Translation(part['origin'] - reference)
            placed[name] = library.place(name, transform @ relative, f'utility pole {index:02d} {name}')
        connector_name = prefix + ('connection_large_offset_01' if preset == '03' else 'connection_large_01')
        connector = parts[connector_name]
        local_terminals, distances = _insulator_terminals(connector)
        terminal_transform = placed[connector_name].matrix_world
        world_terminals = [terminal_transform @ terminal for terminal in local_terminals]
        connectors.append(world_terminals)
        contact_distances.extend(distances)
        bpy.context.view_layer.update()
        trunk_instance = placed[prefix + 'pole']
        ground = min((trunk_instance.matrix_world @ Vector(corner)).z for corner in trunk_instance.bound_box)
        contact = grade.verify_contact([trunk_instance])
        reports.append({'preset': preset, 'position_m': [across, north, ground], 'height_m': height,
                        'parts': len(placed), 'terminal_positions_m': [list(point) for point in world_terminals],
                        'terminal_surface_distances_m': distances,
                        'actual_ground_height_m': ground_height, 'actual_trunk_ground_contact': contact})
    for first_index, last_index in ((0, 1), (1, 2), (3, 4)):
        for strand in range(3):
            first, last = connectors[first_index][strand], connectors[last_index][strand]
            vertices = []
            for step in range(65):
                fraction = step / 64
                point = first.lerp(last, fraction)
                point.z -= .70 * 4 * fraction * (1 - fraction)
                if abs(point.x) < 8:
                    raise ValueError('Utility cable intrudes on the open central sky corridor')
                vertices.append(point)
            endpoint_error = max((vertices[0] - first).length, (vertices[-1] - last).length)
            if endpoint_error > .000001:
                raise ValueError('Utility span endpoints do not match transformed terminal contacts')
            builder.seam('continuous slack utility conductor along outer curb', vertices, .009, 'dark')
            conductor_reports.append({'pole_indices': [first_index, last_index], 'strand': strand,
                                      'start_m': list(first), 'end_m': list(last),
                                      'endpoint_alignment_error_m': endpoint_error})
    return {'asset': library.asset, 'poles': reports, 'longitudinal_wire_spans': 9,
            'wires_over_observer': 0, 'imported_z_up_preserved': True,
            'scanned_terminal_contacts': len(contact_distances),
            'maximum_terminal_surface_distance_m': max(contact_distances),
            'conductor_radius_m': .009, 'conductors': conductor_reports}


def refine(scene, builder, helpers, targets):
    grade = _StreetGrade(scene, helpers)
    library = _Modules('modular_factory_facade', builder.collection)
    library.validate_factory()
    definitions = ((0, 6, 7, 2, .06), (1, 6, 8, 3, -.07), (4, 5, 6, 2, math.pi + .04))
    factories = []
    for building_index, bays, depth_bays, floors, yaw in definitions:
        center = helpers['bounds'](targets[building_index])[0]
        factories.append(_factory(library, builder, helpers, grade, building_index, center,
                                  bays, depth_bays, floors, yaw))
    poles = _poles(builder, grade)
    result = {'factories': factories, 'factory_asset': library.asset, 'factory_catalog_modules': len(library.parts),
              'factory_placed_modules': len(library.instances), 'electricity': poles,
              'offline_only': True, 'photorealistic_approval': False}
    print('INDUSTRIAL_CITY_REFINEMENT', json.dumps(result), flush=True)
    return result


def inspect_modules():
    collection = bpy.data.collections.new('Offline industrial asset inspection')
    bpy.context.scene.collection.children.link(collection)
    factory = _Modules('modular_factory_facade', collection)
    factory.validate_factory()
    poles = _Modules('modular_electricity_poles', collection)
    reports = {}
    selections = ((factory, ('wall_standard_standard_01', 'wall_window_centered_large_01',
                             'window_centered_large_01', 'base_standard_standard_01')),
                  (poles, ('preset_03_pole', 'preset_03_connection_large_offset_01',
                           'preset_02_pole', 'preset_02_connection_large_01')))
    for library, names in selections:
        selected = {}
        for name in names:
            part = library.parts[name]
            selected[name] = {'min_blender_xyz': list(part['low']), 'max_blender_xyz': list(part['high']),
                              'catalog_origin_blender_xyz': list(part['origin']),
                              'vertices': len(part['mesh'].vertices)}
        reports[library.asset] = {'catalog_modules': len(library.parts), 'selected': selected}
    for name in ('preset_02_pole', 'preset_03_pole'):
        extent = poles.parts[name]['high'] - poles.parts[name]['low']
        if not 5.7 <= extent.z <= 6.4 or max(extent.x, extent.y) > .20:
            raise ValueError('Electricity pole lost its six-metre upright orientation')
    print('INDUSTRIAL_MODULE_INSPECTION', json.dumps(reports), flush=True)


if __name__ == '__main__' and '--inspect' in sys.argv:
    inspect_modules()
