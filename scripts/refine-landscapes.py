"""Offline-only, original architectural and foreground refinement meshes."""
import math
import random
import runpy
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


def _color(value):
    channels = [(value >> shift & 255) / 255 for shift in (16, 8, 0)]
    return tuple(channel / 12.92 if channel <= .04045 else ((channel + .055) / 1.055) ** 2.4 for channel in channels)


def _material(name, color, roughness=.8, metalness=0, grain=0):
    material = bpy.data.materials.get(name)
    if material:
        return material
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = _color(color) + (1,)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metalness
    if grain:
        coordinates = nodes.new('ShaderNodeTexCoord')
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 160
        noise.inputs['Detail'].default_value = 3
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .24
        bump.inputs['Distance'].default_value = grain
        links.new(coordinates.outputs['Object'], noise.inputs['Vector'])
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return material


class _Batch:
    def __init__(self, collection, name, materials):
        self.collection, self.name, self.materials = collection, name, materials
        self.vertices, self.faces, self.indices = [], [], []

    def face(self, vertices, material=0):
        start = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.append(tuple(range(start, start + len(vertices))))
        self.indices.append(material)

    def prism(self, front, back, material=0):
        start, count = len(self.vertices), len(front)
        self.vertices.extend(front)
        self.vertices.extend(back)
        self.faces.append(tuple(range(start, start + count)))
        self.faces.append(tuple(reversed(range(start + count, start + count * 2))))
        self.indices.extend((material, material))
        for index in range(len(front)):
            following = (index + 1) % len(front)
            self.faces.append((start + index, start + count + index, start + count + following, start + following))
            self.indices.append(material)

    def box(self, center, dimensions, transform, material=0):
        horizontal, vertical, depth = center
        width, height, length = [value * .5 for value in dimensions]
        front = [transform(horizontal + offset_x, vertical + offset_y, depth + length) for offset_x, offset_y in [(-width, -height), (width, -height), (width, height), (-width, height)]]
        back = [transform(horizontal + offset_x, vertical + offset_y, depth - length) for offset_x, offset_y in [(-width, -height), (width, -height), (width, height), (-width, height)]]
        self.prism(front, back, material)

    def finish(self, bevel=0, smooth=False):
        if not self.faces:
            return None
        if any(not math.isfinite(coordinate) for vertex in self.vertices for coordinate in vertex):
            raise ValueError('Non-finite refinement geometry: ' + self.name)
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        for material in self.materials:
            mesh.materials.append(material)
        for polygon, index in zip(mesh.polygons, self.indices):
            polygon.material_index = index
            polygon.use_smooth = smooth
        topology = bmesh.new()
        topology.from_mesh(mesh)
        if smooth:
            bmesh.ops.remove_doubles(topology, verts=list(topology.verts), dist=.000001)
        bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
        topology.to_mesh(mesh)
        topology.free()
        instance = bpy.data.objects.new(self.name, mesh)
        self.collection.objects.link(instance)
        if bevel:
            modifier = instance.modifiers.new('Real edge radius', 'BEVEL')
            modifier.width, modifier.segments = bevel, 2
            modifier.limit_method = 'ANGLE'
        instance['offline_refinement'] = True
        return instance


def _world(horizontal, vertical, depth):
    return (horizontal, -depth, vertical)


def _castle(horizontal, vertical, depth):
    angle = .23
    return (-45 + math.cos(angle) * horizontal + math.sin(angle) * depth,
            190 + math.sin(angle) * horizontal - math.cos(angle) * depth,
            -15 + vertical)


def _local_castle(horizontal, depth, angle=0):
    def transform(local_x, vertical, local_z):
        return _castle(horizontal + math.cos(angle) * local_x + math.sin(angle) * local_z,
                       vertical, depth - math.sin(angle) * local_x + math.cos(angle) * local_z)
    return transform


def _arch_points(width, height):
    points = [(-width / 2, 0), (-width / 2, height * .67)]
    for index in range(1, 13):
        fraction = index / 12
        inverse = 1 - fraction
        points.append((inverse * inverse * -width / 2 + 2 * inverse * fraction * -width * .45,
                       inverse * inverse * height * .67 + 2 * inverse * fraction * height * .88 + fraction * fraction * height))
    for index in range(1, 13):
        fraction = index / 12
        inverse = 1 - fraction
        points.append((2 * inverse * fraction * width * .45 + fraction * fraction * width / 2,
                       inverse * inverse * height + 2 * inverse * fraction * height * .88 + fraction * fraction * height * .67))
    points.append((width / 2, 0))
    return points


def _window_surround(batch, transform, center, width, height, thickness=.19):
    horizontal, vertical, depth = center
    inner = _arch_points(width + .03, height + .015)
    outer = _arch_points(width + thickness * 2, height + thickness * 1.3)
    for index in range(len(inner) - 1):
        next_index = index + 1
        profile = [inner[index], inner[next_index], outer[next_index], outer[index]]
        front = [transform(horizontal + point[0], vertical + point[1], depth + .14) for point in profile]
        back = [transform(horizontal + point[0], vertical + point[1], depth - .015) for point in profile]
        batch.prism(front, back, index % len(batch.materials))
    batch.box((horizontal, vertical - .06, depth + .11), (width + thickness * 2.4, .17, .38), transform)
    batch.box((horizontal, vertical + height * .40, depth + .09), (.065, height * .76, .12), transform, 1)
    batch.box((horizontal, vertical + height * .41, depth + .10), (width, .085, .13), transform, 1)


def _tower_roof(batch, transform, radius, height, roof_height):
    courses = max(12, int(roof_height / .32))
    for course in range(courses):
        lower = course / courses
        upper = (course + .94) / courses
        lower_radius = radius * 1.23 * (1 - lower) + .07 * lower + .045
        upper_radius = radius * 1.23 * (1 - upper) + .07 * upper + .045
        tiles = max(8, int(math.tau * lower_radius / .52))
        for tile in range(tiles):
            start = (tile + (course % 2) * .5) * math.tau / tiles
            end = start + math.tau / tiles * .975
            front = [transform(math.cos(angle) * tile_radius, height + fraction * roof_height + .022,
                               math.sin(angle) * tile_radius)
                     for angle, tile_radius, fraction in [(start, lower_radius, lower), (end, lower_radius, lower),
                                                          (end, upper_radius, upper), (start, upper_radius, upper)]]
            back = [(point[0], point[1], point[2] - .018) for point in front]
            batch.prism(front, back, (course + tile // 3) % len(batch.materials))


def _hall_roof(batch, horizontal, depth, width, length, height):
    transform = _local_castle(horizontal, depth)
    half = width * .56
    rows = max(10, int(half / .29))
    tiles = max(8, int((length + 1) / .6))
    for side in (-1, 1):
        for row in range(rows):
            lower = half * row / rows
            upper = half * (row + .96) / rows
            for tile in range(tiles):
                near = -(length + 1) / 2 + (length + 1) * tile / tiles
                far = near + (length + 1) / tiles * .985
                front = [transform(side * horizontal_offset, height + half - horizontal_offset + .035, depth_offset)
                         for horizontal_offset, depth_offset in [(lower, near), (lower, far), (upper, far), (upper, near)]]
                back = [(point[0], point[1], point[2] - .018) for point in front]
                batch.prism(front, back, (row + tile // 5) % len(batch.materials))


def _refine_castle(collection):
    stone = [_material('Refinement/limestone ' + str(index), tint, .91, grain=.0014)
             for index, tint in enumerate((0xa19b89, 0x979583, 0xb2aa94, 0x918d80))]
    slate = [_material('Refinement/slate ' + str(index), tint, .75, .035, .00025)
             for index, tint in enumerate((0x39494d, 0x45575b, 0x4b5b5c, 0x3f5054))]
    masonry = _Batch(collection, 'Refinement/castle carved limestone', stone)
    roofs = _Batch(collection, 'Refinement/castle individual slate courses', slate)
    towers = [(-13, -17, 5.2, 49, 17), (13, -29, 4.3, 36, 13), (-26, 1, 3.1, 26, 11),
              (26, -3, 3.8, 32, 14), (-26, -29, 3.2, 27, 10), (26, -37, 3, 30, 11),
              (0, 21, 3.8, 31, 15), (11, 14, 2.1, 22, 9)]
    for horizontal, depth, radius, height, roof_height in towers:
        transform = _local_castle(horizontal, depth)
        _tower_roof(roofs, transform, radius, height, roof_height)
        for facade in range(8):
            face = _local_castle(horizontal, depth, facade * math.pi / 4)
            for elevation in (height * .22, height * .53, height * .76):
                _window_surround(masonry, face, (0, elevation, radius * .976), .55 + radius * .18, 1.6 + radius * .28)
            for level in range(3):
                masonry.box((0, .16 + level * .3, radius - .01), (radius * .55, .285, .35), face, (facade + level) % 4)
            masonry.box((0, height - .22, radius * .977), (.35, .9, .55), face, facade % 4)
            masonry.box((0, height - .72, radius * .989), (.24, .28, .36), face, (facade + 1) % 4)
    halls = [(0, 0, 16, 38, 21), (-23, -14, 11, 30, 16), (20, -19, 13, 36, 20), (-4, -34, 44, 11, 15)]
    for horizontal, depth, width, length, height in halls:
        transform = _local_castle(horizontal, depth)
        _hall_roof(roofs, horizontal, depth, width, length, height)
        for side in (-1, 1):
            for bay in range(int(length / 3)):
                depth_offset = -length / 2 + 1.5 + bay * 3
                angle = side * math.pi / 2
                face = _local_castle(horizontal + side * (width / 2 + .015), depth + depth_offset, angle)
                _window_surround(masonry, face, (0, height * .36, 0), 1.15, height * .46, .22)
                for tier in range(4):
                    pier_height = height * .82 / 4
                    center_height = (tier + .5) * pier_height
                    projection = .88 - tier * .13
                    masonry.box((side * (width / 2 + projection * .5), center_height, depth_offset + 1.35),
                                (projection, pier_height - .025, .77 - tier * .08), transform, (bay + tier) % 4)
                    masonry.box((side * (width / 2 + projection * .5), (tier + 1) * pier_height, depth_offset + 1.35),
                                (projection + .08, .12, .81 - tier * .08), transform, (bay + tier + 1) % 4)
            masonry.box((side * (width / 2 + .12), height - .1, 0), (.48, .3, length + .4), transform, 1)
        for end in (-1, 1):
            face = _local_castle(horizontal, depth + end * (length / 2 + .01), math.pi if end < 0 else 0)
            for offset in (-width * .27, 0, width * .27):
                _window_surround(masonry, face, (offset, height * .35, 0), width * .16, height * .5, .22)
    masonry.finish(bevel=.006)
    roofs.finish(bevel=.0025)


def _tube(batch, points, radius, sides=12, material=0):
    for first, second in zip(points[:-1], points[1:]):
        start, end = Vector(first), Vector(second)
        direction = (end - start).normalized()
        tangent = direction.cross(Vector((0, 0, 1)))
        if tangent.length < .01:
            tangent = direction.cross(Vector((0, 1, 0)))
        tangent.normalize()
        bitangent = direction.cross(tangent).normalized()
        for index in range(sides):
            current = tangent * math.cos(index * math.tau / sides) * radius + bitangent * math.sin(index * math.tau / sides) * radius
            following = tangent * math.cos((index + 1) * math.tau / sides) * radius + bitangent * math.sin((index + 1) * math.tau / sides) * radius
            batch.face((start + current, end + current, end + following, start + following), material)


def _refine_shelter(collection):
    cloth = _material('Refinement/worn olive blanket', 0x53645b, .97, grain=.00055)
    textile = _Batch(collection, 'Refinement/shelter woven blanket folds', [cloth])
    columns, rows = 80, 120
    def cloth_point(column, row):
        across, along = column / columns * 2 - 1, row / rows * 2 - 1
        horizontal = -4.8 + across * .565
        depth = 6.5 + .55 * (2 / 3.8) + along * .70
        drape = max(0, (abs(across) - .95) / .05) ** 1.4 * .16
        folds = (.012 * math.sin(across * 19 + along * 3) + .008 * math.sin(across * 41 - along * 5)) * (.45 + .55 * along * along)
        height = .87 + folds + .009 * math.sin(along * 12 + across * 3) - drape
        return _world(horizontal, height, depth)
    for row in range(rows):
        for column in range(columns):
            textile.face((cloth_point(column, row), cloth_point(column, row + 1), cloth_point(column + 1, row + 1), cloth_point(column + 1, row)))
    instance = textile.finish(smooth=True)
    modifier = instance.modifiers.new('Woven blanket thickness', 'SOLIDIFY')
    modifier.thickness = .006
    metal = _material('Refinement/stove dark steel', 0x39423d, .46, .78, .00018)
    iron = _Batch(collection, 'Refinement/shelter stove hardware', [metal])
    for side in (-1, 1):
        iron.box((-4.5 + side * .254, .42, -1.701), (.026, .46, .04), _world)
        iron.box((-4.5, .42 + side * .228, -1.701), (.53, .027, .04), _world)
    for elevation in (.285, .565):
        _tube(iron, [_world(-4.765, elevation - .052, -1.69), _world(-4.765, elevation + .052, -1.69)], .018)
    _tube(iron, [_world(-4.23, .40, -1.70), _world(-4.15, .40, -1.65), _world(-4.15, .49, -1.65)], .013)
    iron.finish(bevel=.002)
    cracks = _Batch(collection, 'Refinement/shelter floor joint wear', [_material('Refinement/concrete joint shadow', 0x484c44, .98)])
    for route in ([(-5.5, -4.6), (-3.8, -3.9), (-2.9, -2.5), (-2.5, -.9)], [(1.4, 8.8), (.6, 7.1), (.9, 5.5), (.1, 4.4)], [(5.7, -3.2), (4.5, -2.4), (3.6, -2.6), (2.9, -1.8)]):
        for first, second in zip(route[:-1], route[1:]):
            length = math.hypot(second[0] - first[0], second[1] - first[1])
            offset_x = (second[1] - first[1]) / length * .0025
            offset_z = -(second[0] - first[0]) / length * .0025
            cracks.face((_world(first[0] + offset_x, .0007, first[1] + offset_z),
                         _world(second[0] + offset_x, .0007, second[1] + offset_z),
                         _world(second[0] - offset_x, .0007, second[1] - offset_z),
                         _world(first[0] - offset_x, .0007, first[1] - offset_z)))
    cracks.finish()


def _refine_snow(collection):
    if any(instance.get('verified_dem_walking_platform') for instance in bpy.context.scene.objects):
        return
    candidates = [instance for instance in bpy.context.scene.objects
                  if instance.type == 'MESH' and len(instance.data.vertices) == 201 * 201]
    if len(candidates) != 1:
        raise ValueError('Expected one near snow surface for continuous wind sculpting')
    surface = candidates[0]
    if any(material.get('verified_dem_snow_rock') for material in surface.data.materials):
        return
    boundary_normals = [tuple(normal.vector) for normal in surface.data.vertex_normals]
    generator = random.Random(58136)
    formations = [(generator.uniform(-22, 22), generator.uniform(-22, 22),
                   generator.uniform(1.5, 5), generator.uniform(.18, .55), generator.uniform(.008, .038))
                  for formation in range(52)]
    for vertex in surface.data.vertices:
        horizontal, north = vertex.co.x, vertex.co.y
        edge = max(0, min(1, (1500 / 220 * 5 - max(abs(horizontal), abs(north))) / 3))
        displacement = .009 * math.sin(horizontal * 1.8 + north * .32) * math.sin(north * .77)
        for center_x, center_y, length, width, amplitude in formations:
            along = ((horizontal - center_x) * .94 + (north - center_y) * .342) / length
            across = (-(horizontal - center_x) * .342 + (north - center_y) * .94) / width
            distance = along * along + across * across
            if distance < 9:
                displacement += amplitude * math.exp(-distance)
        vertex.co.z += displacement * edge * edge * (3 - 2 * edge)
    surface.data.normals_split_custom_set_from_vertices([
        boundary_normals[index] if max(abs(vertex.co.x), abs(vertex.co.y)) >= 1500 / 220 * 5 - .001 else (0, 0, 0)
        for index, vertex in enumerate(surface.data.vertices)])
    surface.data.update()
    surface['continuous_snow_sculpting'] = True
    for material in surface.data.materials:
        if material.get('verified_dem_snow_rock'):
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = material.node_tree.nodes.get('Principled BSDF')
        base = shader.inputs['Base Color']
        source = base.links[0].from_socket if base.is_linked else None
        clean_snow = nodes.new('ShaderNodeMixRGB')
        clean_snow.inputs[0].default_value = .16
        clean_snow.inputs[1].default_value = (.69, .74, .79, 1)
        if source:
            links.new(source, clean_snow.inputs[2])
        else:
            clean_snow.inputs[2].default_value = base.default_value
        links.new(clean_snow.outputs[0], base)
        shader.inputs['Subsurface Weight'].default_value = .035
        shader.inputs['Subsurface Radius'].default_value = (.025, .04, .055)
        for node in material.node_tree.nodes:
            if node.type == 'NORMAL_MAP':
                node.inputs['Strength'].default_value = .19


def _dry_summit_boulders(scene, descriptor):
    assets = [asset for asset in descriptor.get('assets', []) if asset['id'] == 'rock_07']
    candidates = [instance for instance in scene.objects if instance.type == 'MESH'
                  and len(instance.data.vertices) == 7914
                  and any(material and material.name.startswith('rock_07') for material in instance.data.materials)]
    if not assets or len(candidates) != len(assets):
        raise ValueError('Scanned summit boulder mesh count differs from exported instances')
    for instance in candidates:
        for slot in instance.material_slots:
            if slot.material is None:
                continue
            material = slot.material.copy()
            material.name = 'Refinement/dry exposed summit rock'
            nodes, links = material.node_tree.nodes, material.node_tree.links
            shader = nodes.get('Principled BSDF')
            for name, value in [('Metallic', 0), ('Roughness', .89), ('Coat Weight', 0), ('Specular IOR Level', .24)]:
                for link in list(shader.inputs[name].links):
                    links.remove(link)
                shader.inputs[name].default_value = value
            base = shader.inputs['Base Color']
            if base.is_linked:
                source = base.links[0].from_socket
                saturation = nodes.new('ShaderNodeHueSaturation')
                saturation.inputs['Saturation'].default_value = .10
                saturation.inputs['Value'].default_value = 1.30
                links.new(source, saturation.inputs['Color'])
                links.new(saturation.outputs[0], base)
            slot.material = material


def refine(scene, descriptor):
    scene_id = descriptor.get('scene')
    if scene_id not in ('hogwarts', 'snowmountain', 'shelter'):
        return {'scene': scene_id, 'objects': 0, 'skipped': True}
    collection_name = 'NightWorld/offline refinements/' + scene_id
    if bpy.data.collections.get(collection_name):
        return {'scene': scene_id, 'objects': 0, 'skipped': True}
    collection = bpy.data.collections.new(collection_name)
    scene.collection.children.link(collection)
    if scene_id == 'hogwarts':
        castle = runpy.run_path(str(Path(__file__).with_name('refine-castle.py')))
        castle['refine'](scene, descriptor)
    else:
        {'snowmountain': _refine_snow, 'shelter': _refine_shelter}[scene_id](collection)
    if scene_id == 'snowmountain':
        _dry_summit_boulders(scene, descriptor)
        summit = runpy.run_path(str(Path(__file__).with_name('refine-snow-props.py')))
        summit['refine'](scene, descriptor)
    result = {'scene': scene_id, 'objects': len(collection.objects),
              'vertices': sum(len(instance.data.vertices) for instance in collection.objects if instance.type == 'MESH')}
    print('LANDSCAPE_REFINEMENT', result)
    return result
