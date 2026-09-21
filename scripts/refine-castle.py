"""Original Gothic castle reconstruction for the offline highland overlook."""
import hashlib
import json
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

DESCRIPTOR_SHA256 = '4e871ff1409b2a23bb4afafdc45d863624e367c2112fa28445236616b87b8802'
COLLECTION_NAME = 'Highlands/original Gothic castle architecture'
BASIS = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
GATE_ANCHOR = (28.78, 7.0)
CAMPUS_SCALE = (1.4, 1.15)


def _campus(horizontal, vertical, depth):
    return (GATE_ANCHOR[0] + (horizontal - GATE_ANCHOR[0]) * CAMPUS_SCALE[0], vertical,
            GATE_ANCHOR[1] + (depth - GATE_ANCHOR[1]) * CAMPUS_SCALE[1])


def _island_radius(horizontal, depth):
    return math.hypot((horizontal + 12) / 66, (depth + 8) / 72)


def _castle(horizontal, vertical, depth):
    return (-45 + math.cos(.23) * horizontal + math.sin(.23) * depth,
            190 + math.sin(.23) * horizontal - math.cos(.23) * depth,
            -15 + vertical)


def _frame(horizontal, depth, angle=0):
    def transform(across, vertical, outward):
        return (horizontal + math.cos(angle) * across + math.sin(angle) * outward,
                vertical, depth - math.sin(angle) * across + math.cos(angle) * outward)
    return transform


def _descriptor_targets(scene, descriptor):
    objects = descriptor['objects'][25:1081]
    identifiers = {item['geometry'] for item in objects}
    geometries = {item['id']: item for item in descriptor['geometry']}
    payload = {'objects': [{'geometry': item['geometry'], 'matrix': item['matrix']} for item in objects],
               'geometry': sorted([{'id': identifier, 'positions': geometries[identifier]['positions'],
                                    'indices': geometries[identifier].get('indices', [])}
                                   for identifier in identifiers], key=lambda item: item['id'])}
    encoded = json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if hashlib.sha256(encoded).hexdigest() != DESCRIPTOR_SHA256:
        raise ValueError('Castle descriptor changed; refusing to replace unrelated geometry')
    candidates = [instance for instance in scene.objects
                  if instance.type == 'MESH' and instance.name.startswith('NightWorld/mesh')]
    result = []
    for item in objects:
        geometry = geometries[item['geometry']]
        values = item['matrix']
        matrix = BASIS @ Matrix(tuple(tuple(values[column * 4 + row] for column in range(4)) for row in range(4))) @ BASIS.inverted()
        matches = [instance for instance in candidates if len(instance.data.vertices) * 3 == len(geometry['positions'])
                   and max(abs(instance.matrix_world[row][column] - matrix[row][column])
                           for row in range(4) for column in range(4)) < .0001]
        exact = []
        for instance in matches:
            valid = True
            for index, vertex in enumerate(instance.data.vertices):
                source = geometry['positions'][index * 3:index * 3 + 3]
                expected = matrix @ Vector((source[0], -source[2], source[1]))
                if (instance.matrix_world @ vertex.co - expected).length > .00015:
                    valid = False
                    break
            indices = geometry.get('indices') or list(range(len(geometry['positions']) // 3))
            expected_faces = [tuple(indices[index:index + 3]) for index in range(0, len(indices) - 2, 3)]
            if valid and [tuple(polygon.vertices) for polygon in instance.data.polygons] == expected_faces:
                exact.append(instance)
        if len(exact) != 1:
            raise ValueError(f'Castle mesh signature is not unique: {item["geometry"]}, {len(exact)} matches')
        result.append(exact[0])
    if len(set(result)) != 1056:
        raise ValueError('Castle replacement must identify exactly 1056 distinct original meshes')
    return result


def _material(name, color, roughness):
    material = bpy.data.materials.new('Castle/' + name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = color + (1,)
    shader.inputs['Roughness'].default_value = roughness
    return material


def _weather_surface(material, color_socket, scale, minimum, maximum, vertical_stains=False):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    coordinates = nodes.new('ShaderNodeTexCoord')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = 4
    links.new(coordinates.outputs['Object'], noise.inputs['Vector'])
    variation = nodes.new('ShaderNodeMapRange')
    variation.inputs['To Min'].default_value = minimum
    variation.inputs['To Max'].default_value = maximum
    links.new(noise.outputs['Fac'], variation.inputs[0])
    weather = nodes.new('ShaderNodeMixRGB')
    weather.blend_type = 'MULTIPLY'
    weather.inputs[0].default_value = 1
    links.new(color_socket, weather.inputs[1])
    links.new(variation.outputs[0], weather.inputs[2])
    result = weather.outputs[0]
    if vertical_stains:
        stretch = nodes.new('ShaderNodeVectorMath')
        stretch.operation = 'MULTIPLY'
        stretch.inputs[1].default_value = (.24, .24, .018)
        links.new(coordinates.outputs['Object'], stretch.inputs[0])
        streaks = nodes.new('ShaderNodeTexNoise')
        streaks.inputs['Scale'].default_value = 1
        streaks.inputs['Detail'].default_value = 3
        streaks.inputs['Roughness'].default_value = .7
        links.new(stretch.outputs[0], streaks.inputs['Vector'])
        tint = nodes.new('ShaderNodeValToRGB')
        tint.color_ramp.elements[0].position = .26
        tint.color_ramp.elements[0].color = (.40, .43, .35, 1)
        tint.color_ramp.elements[1].position = .64
        tint.color_ramp.elements[1].color = (1, .98, .94, 1)
        links.new(streaks.outputs['Fac'], tint.inputs[0])
        multiply = nodes.new('ShaderNodeMixRGB')
        multiply.blend_type = 'MULTIPLY'
        multiply.inputs[0].default_value = .52
        links.new(result, multiply.inputs[1])
        links.new(tint.outputs[0], multiply.inputs[2])
        result = multiply.outputs[0]
    links.new(result, shader.inputs['Base Color'])


def _materials(root):
    stone = _material('weathered warm limestone', (.38, .35, .29), .9)
    nodes, links = stone.node_tree.nodes, stone.node_tree.links
    shader = nodes.get('Principled BSDF')
    coordinates = nodes.new('ShaderNodeTexCoord')
    for suffix, color_space in [('diff', 'sRGB'), ('nor', 'Non-Color'), ('rough', 'Non-Color')]:
        source = next((root / directory / 'old_stone_wall' / f'old_stone_wall_{suffix}_{resolution}.jpg'
                       for resolution in ['4k', '2k'] for directory in ['assets/life/textures/library', '.render-work/library']
                       if (root / directory / 'old_stone_wall' / f'old_stone_wall_{suffix}_{resolution}.jpg').is_file()), None)
        if source is None:
            raise FileNotFoundError('Castle needs the verified old_stone_wall PBR library')
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(source), check_existing=True)
        texture.image.colorspace_settings.name = color_space
        links.new(coordinates.outputs['UV'], texture.inputs['Vector'])
        if suffix == 'diff':
            tint = nodes.new('ShaderNodeMixRGB')
            tint.blend_type = 'MULTIPLY'
            tint.inputs[0].default_value = 1
            tint.inputs[2].default_value = (.76, .73, .66, 1)
            links.new(texture.outputs['Color'], tint.inputs[1])
            _weather_surface(stone, tint.outputs[0], .065, .67, 1.09, True)
        elif suffix == 'rough':
            links.new(texture.outputs['Color'], shader.inputs['Roughness'])
        else:
            normal = nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value = .6
            links.new(texture.outputs['Color'], normal.inputs['Color'])
            links.new(normal.outputs[0], shader.inputs['Normal'])
    trim = _material('cut limestone dressings', (.39, .365, .305), .84)
    slate = [_material('slate ' + str(index), color, .77) for index, color in enumerate([
        (.038, .057, .063), (.050, .066, .071), (.061, .075, .078), (.046, .060, .065)])]
    for surface in [trim, *slate]:
        nodes = surface.node_tree.nodes
        shader = nodes.get('Principled BSDF')
        base = nodes.new('ShaderNodeRGB')
        base.outputs[0].default_value = tuple(shader.inputs['Base Color'].default_value)
        _weather_surface(surface, base.outputs[0], .18 if surface == trim else .38,
                         .68 if surface == trim else .64, 1.08, surface == trim)
    glazing = _material('recessed leaded glazing', (.027, .041, .043), .32)
    shader = glazing.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Transmission Weight'].default_value = .07
    shader.inputs['IOR'].default_value = 1.48
    lead = _material('oxidized lead and iron', (.035, .040, .039), .72)
    paving = _material('courtyard flagstone', (.19, .19, .165), .94)
    return [stone, trim, *slate, glazing, lead, paving]


class _Batch:
    def __init__(self, name, materials):
        self.name, self.materials = name, materials
        self.vertices, self.faces, self.indices = [], [], []

    def face(self, points, material=0):
        start = len(self.vertices)
        self.vertices.extend(points)
        self.faces.append(tuple(range(start, start + len(points))))
        self.indices.append(material)

    def prism(self, front, back, material=0):
        self.face(front, material)
        self.face(list(reversed(back)), material)
        for index in range(len(front)):
            following = (index + 1) % len(front)
            self.face([front[index], back[index], back[following], front[following]], material)

    def box(self, center, dimensions, material=0, frame=None):
        frame = frame or _frame(0, 0)
        horizontal, vertical, depth = center
        width, height, length = [value / 2 for value in dimensions]
        front = [frame(horizontal + offset_x, vertical + offset_y, depth + length)
                 for offset_x, offset_y in [(-width, -height), (width, -height), (width, height), (-width, height)]]
        back = [frame(horizontal + offset_x, vertical + offset_y, depth - length)
                for offset_x, offset_y in [(-width, -height), (width, -height), (width, height), (-width, height)]]
        self.prism(front, back, material)

    def finish(self, collection):
        if not self.faces:
            return None
        mesh = bpy.data.meshes.new('Castle/' + self.name)
        mesh.from_pydata([_castle(*point) for point in self.vertices], [], self.faces)
        mesh.update()
        topology = bmesh.new()
        topology.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
        topology.to_mesh(mesh)
        topology.free()
        for material in self.materials:
            mesh.materials.append(material)
        for polygon, material in zip(mesh.polygons, self.indices):
            polygon.material_index = material
        uv = mesh.uv_layers.new(name='Physical masonry scale')
        for polygon in mesh.polygons:
            first = self.vertices[mesh.loops[polygon.loop_start].vertex_index]
            second = self.vertices[mesh.loops[polygon.loop_start + 1].vertex_index]
            direction = Vector(second) - Vector(first)
            if direction.length < .00001:
                continue
            direction.normalize()
            points = [Vector(self.vertices[mesh.loops[index].vertex_index]) for index in polygon.loop_indices]
            normal = (points[1] - points[0]).cross(points[2] - points[0])
            if normal.length < .00001:
                continue
            vertical = normal.normalized().cross(direction).normalized()
            for loop_index in polygon.loop_indices:
                point = Vector(self.vertices[mesh.loops[loop_index].vertex_index])
                uv.data[loop_index].uv = (point.dot(direction) / 3.5, point.dot(vertical) / 3.5)
        instance = bpy.data.objects.new('Castle/' + self.name, mesh)
        collection.objects.link(instance)
        instance['original_gothic_castle'] = True
        return instance


def _arch(width, height, rounded=False):
    if rounded:
        points = [(-width / 2, 0), (-width / 2, height * .8)]
        for index in range(1, 21):
            angle = math.pi * (1 - index / 20)
            points.append((math.cos(angle) * width / 2, height * (.8 + .2 * math.sin(angle))))
        points.append((width / 2, 0))
        return points
    points = [(-width / 2, 0), (-width / 2, height * .62)]
    for index in range(1, 11):
        fraction = index / 10
        points.append((-width / 2 * (1 - fraction) ** .68, height * (.62 + .38 * fraction)))
    for index in range(1, 11):
        fraction = index / 10
        points.append((width / 2 * fraction ** .68, height * (1 - .38 * fraction)))
    points.append((width / 2, 0))
    return points


def _wall_polygon(batch, points, frame, thickness=.85, material=0):
    batch.prism([frame(horizontal, vertical, 0) for horizontal, vertical in points],
                [frame(horizontal, vertical, -thickness) for horizontal, vertical in points], material)


def _window_cell(walls, detail, frame, left, right, bottom, top, sill, width, height, door=False, rounded=False):
    center = (left + right) / 2
    half = width / 2
    aperture = _arch(width, height, rounded)
    if sill > bottom:
        _wall_polygon(walls, [(left, bottom), (right, bottom), (right, sill), (left, sill)], frame)
    _wall_polygon(walls, [(left, sill), (center - half, sill), (center - half, top), (left, top)], frame)
    _wall_polygon(walls, [(center + half, sill), (right, sill), (right, top), (center + half, top)], frame)
    for first, last in zip(aperture[1:-1], aperture[2:-1]):
        _wall_polygon(walls, [(center + first[0], sill + first[1]), (center + last[0], sill + last[1]),
                              (center + last[0], top), (center + first[0], top)], frame)
    inner, outer = _arch(width, height, rounded), _arch(width + .48, height + .25, rounded)
    for index in range(len(inner) - 1):
        ring = [(center + inner[index][0], sill + inner[index][1]),
                (center + inner[index + 1][0], sill + inner[index + 1][1]),
                (center + outer[index + 1][0], sill + outer[index + 1][1]),
                (center + outer[index][0], sill + outer[index][1])]
        detail.prism([frame(horizontal, vertical, .19) for horizontal, vertical in ring],
                     [frame(horizontal, vertical, -.10) for horizontal, vertical in ring], 1)
    if door:
        return
    detail.face([frame(center + horizontal, sill + vertical, -.66) for horizontal, vertical in aperture], 6)
    detail.box((center, sill - .1, .1), (width + .65, .2, .55), 1, frame)
    for offset in [-width / 6, width / 6]:
        detail.box((center + offset, sill + height * .4, -.54), (.10, height * .8, .14), 1, frame)
    for fraction in [.32, .59]:
        detail.box((center, sill + height * fraction, -.53), (width, .085, .11), 7, frame)


def _facade(walls, detail, frame, width, base, height, bays, windows):
    bay_width = width / bays
    boundaries = [base] + [(first[0] + first[1] + second[0]) / 2 for first, second in zip(windows[:-1], windows[1:])] + [height]
    for bay in range(bays):
        left, right = -width / 2 + bay * bay_width, -width / 2 + (bay + 1) * bay_width
        for row, (sill, window_height, window_width) in enumerate(windows):
            _window_cell(walls, detail, frame, left, right, boundaries[row], boundaries[row + 1],
                         sill, window_width, window_height)
    for elevation in [base + .4, height - .35]:
        detail.box((0, elevation, .13), (width + .12, .26, .3), 1, frame)


def _gable_roof(roofs, detail, center_x, center_z, width, length, eave, rise, dormers=0):
    half = width / 2 + .65
    near, far = center_z - length / 2 - .55, center_z + length / 2 + .55
    for side in [-1, 1]:
        roofs.face([(center_x, eave + rise, near), (center_x, eave + rise, far),
                    (center_x + side * half, eave, far), (center_x + side * half, eave, near)], 2)
        rows = math.ceil(half / .42)
        tiles = math.ceil((length + 1.1) / .72)
        for row in range(rows):
            first, last = row / rows, (row + .97) / rows
            for tile in range(tiles):
                front = near + (far - near) * tile / tiles
                back = near + (far - near) * (tile + .97) / tiles
                roofs.face([(center_x + side * half * amount, eave + rise * (1 - amount) + .032, depth)
                            for amount, depth in [(first, front), (first, back), (last, back), (last, front)]], 2 + (row + tile // 4) % 4)
    detail.box((center_x, eave + rise + .08, center_z), (.22, .18, length + 1.2), 1)
    for index in range(dormers):
        depth = center_z - length * .33 + index * length * .66 / max(1, dormers - 1)
        for side in [-1, 1]:
            horizontal = center_x + side * half * .62
            elevation = eave + rise * .38
            frame = _frame(horizontal, depth, side * math.pi / 2)
            _window_cell(detail, detail, frame, -1.2, 1.2, elevation - .2, elevation + 2.2,
                         elevation + .05, 1.25, 1.65)
            detail.prism([frame(-1.4, elevation + 2.2, .3), frame(1.4, elevation + 2.2, .3), frame(0, elevation + 3.55, .3)],
                         [frame(-1.4, elevation + 2.2, -1.8), frame(1.4, elevation + 2.2, -1.8), frame(0, elevation + 3.55, -1.8)], 3)


def _rotate_additions(batches, offsets, horizontal, depth, rotation):
    for batch, offset in zip(batches, offsets):
        for index in range(offset, len(batch.vertices)):
            across, elevation, along = batch.vertices[index]
            delta_x, delta_z = across - horizontal, along - depth
            batch.vertices[index] = (horizontal + math.cos(rotation) * delta_x + math.sin(rotation) * delta_z,
                                     elevation, depth - math.sin(rotation) * delta_x + math.cos(rotation) * delta_z)


def _hall(walls, detail, roofs, horizontal, depth, width, length, eave, rise, bays, grand=False, rotation=0):
    batches = [walls, detail, roofs]
    offsets = [len(batch.vertices) for batch in batches]
    base = 4
    walls.box((horizontal, 1.8, depth), (width + .65, 4.45, length + .65))
    windows = [(7.2, 11.4, 2.15)] if grand else [(6, 3.1, 1.45), (12.3, 3.0, 1.4)] if eave > 18 else [(6.1, 4.6, 1.65)]
    for side in [-1, 1]:
        _facade(walls, detail, _frame(horizontal + side * width / 2, depth, side * math.pi / 2),
                length, base, eave, bays, windows)
        for index in range(bays + 1):
            along = -length / 2 + length * index / bays
            for level in range(4):
                projection = (2.5 if grand else 1.4) * (1 - level * .18)
                height = (eave - base) / 4
                detail.box((horizontal + side * (width / 2 + projection / 2), base + (level + .5) * height,
                            depth + along), (projection, height - .06, .95 if grand else .7), 1)
    for side in [-1, 1]:
        frame = _frame(horizontal, depth + side * length / 2, 0 if side > 0 else math.pi)
        if grand:
            _facade(walls, detail, frame, width, base, eave, 3, [(7.1, 14, 3.7)])
        else:
            _facade(walls, detail, frame, width, base, eave, max(2, int(width / 4)), windows)
        _wall_polygon(walls, [(-width / 2, eave), (width / 2, eave), (0, eave + rise - .15)], frame)
        for edge in [-1, 1]:
            segments = 14
            for index in range(segments):
                fraction = index / segments
                detail.box((edge * width / 2 * (1 - fraction), eave + rise * fraction + .08, .16),
                           (.58, .27, .45), 1, frame)
    _gable_roof(roofs, detail, horizontal, depth, width, length, eave, rise, 3 if grand else 2)
    if grand:
        _flying_buttresses(detail, horizontal, depth, width, length, eave, rise)
        for along in [-length * .43, length * .43]:
            for side in [-1, 1]:
                px = horizontal + side * (width / 2 + .9)
                detail.box((px, eave + rise * .45, depth + along), (.82, 4.6, .82), 0)
                detail.box((px, eave + rise * .45 + 2.35, depth + along), (1.12, .3, 1.12), 1)
                detail.box((px, eave + rise * .45 + 3.1, depth + along), (.28, 1.3, .28), 7)
    if rotation:
        _rotate_additions(batches, offsets, horizontal, depth, rotation)


def _lateral_wings(walls, detail, roofs):
    wings = [(-19.5, 19.5, 8.5, 22, 23, 8.2, 5), (15.5, 21, 8.5, 22, 18.5, 7.2, 6)]
    for horizontal, depth, width, length, eave, rise, bays in wings:
        _hall(walls, detail, roofs, horizontal, depth, width, length, eave, rise, bays,
              rotation=math.pi / 2)
        first_vertex = len(detail.vertices)
        for along in [-length * .29, length * .24]:
            center_x = horizontal - width * .19
            center_z = depth + along
            roof_height = eave + rise * (1 - width * .19 / (width / 2 + .65))
            detail.box((center_x, roof_height + 1.4, center_z), (1.25, 4.5, 1.55), 0)
            detail.box((center_x, roof_height + 3.4, center_z), (1.57, .31, 1.87), 1)
            for side in [-1, 1]:
                detail.box((center_x, roof_height + 3.91, center_z + side * .43), (.43, .74, .43), 7)
        _rotate_additions([detail], [first_vertex], horizontal, depth, math.pi / 2)
    _polygon_tower(walls, detail, roofs, -29, 10, 3.1, 30, 9, 10)


def _peripheral_colleges(walls, detail, roofs):
    _hall(walls, detail, roofs, -30.5, -7, 8.5, 19, 27, 7.5, 5)
    _hall(walls, detail, roofs, 28.5, -13, 7.5, 18, 23, 7, 5)
    for horizontal, depth, elevation in [(-32.1, -9, 32), (-28.8, -1, 32), (30.2, -16, 27.5)]:
        detail.box((horizontal, elevation + 1.2, depth), (1.3, 4.1, 1.8), 0)
        detail.box((horizontal, elevation + 3.18, depth), (1.7, .28, 2.15), 1)
        for side in [-1, 1]:
            detail.box((horizontal, elevation + 3.7, depth + side * .43), (.44, .75, .44), 7)


def _polygon_tower(walls, detail, roofs, horizontal, depth, radius, height, roof_height, sides=12):
    apothem = radius * math.cos(math.pi / sides)
    width = radius * 2 * math.sin(math.pi / sides)
    walls.box((horizontal, 1.8, depth), (radius * 1.6, 4.45, radius * 1.6))
    for index in range(sides):
        angle = index * math.tau / sides
        frame = _frame(horizontal + math.sin(angle) * apothem, depth + math.cos(angle) * apothem, angle)
        _facade(walls, detail, frame, width, -.35, height, 1,
                [(height * .24, 4.8, min(1.65, width * .5)),
                 (height * .52, 5.2, min(1.9, width * .52)),
                 (height * .78, 5.8, min(2.1, width * .55))])
        for level in [height * .19, height * .47, height - 1.4]:
            detail.box((0, level, .18), (width + .18, .42, .42), 1, frame)
        detail.box((width / 2 - .17, height / 2, .12), (.34, height, .4), 1, frame)
    rings = [(height - .25, radius * 1.12), (height + roof_height * .18, radius * .91),
             (height + roof_height * .65, radius * .42), (height + roof_height, .08)]
    for first, last in zip(rings[:-1], rings[1:]):
        courses = math.ceil((last[0] - first[0]) / .4)
        for course in range(courses):
            lower, upper = course / courses, (course + .98) / courses
            for index in range(sides * 4):
                angles = [index * math.tau / (sides * 4), (index + .98) * math.tau / (sides * 4)]
                points = []
                for fraction, angle in [(lower, angles[0]), (lower, angles[1]), (upper, angles[1]), (upper, angles[0])]:
                    elevation = first[0] * (1 - fraction) + last[0] * fraction
                    radial = first[1] * (1 - fraction) + last[1] * fraction
                    points.append((horizontal + math.sin(angle) * radial, elevation, depth + math.cos(angle) * radial))
                roofs.face(points, 2 + (index // 7 + course) % 4)
    detail.box((horizontal, height + roof_height + .6, depth), (.11, 1.4, .11), 7)


def _battlement_ring(detail, horizontal, depth, width, length, elevation, frame=None,
                     merlons=0, material=1):
    frame = frame or _frame(horizontal, depth, 0)
    count = merlons or max(3, round(width / 1.65))
    for index in range(count):
        across = -width / 2 + (index + .5) * width / count
        detail.box((across, elevation, length / 2), (width / count * .58, 1.15, .72), material, frame)
        detail.box((across, elevation, -length / 2), (width / count * .58, 1.15, .72), material, frame)
    count = max(3, round(length / 1.65))
    for index in range(count):
        along = -length / 2 + (index + .5) * length / count
        detail.box((-width / 2, elevation, along), (.72, 1.15, length / count * .58), material, frame)
        detail.box((width / 2, elevation, along), (.72, 1.15, length / count * .58), material, frame)


def _flying_buttresses(detail, horizontal, depth, width, length, eave, rise, frame=None):
    frame = frame or _frame(horizontal, depth, 0)
    for side in [-1, 1]:
        for index in range(5):
            along = -length * .40 + index * length * .20
            spring = eave * .55
            top = eave * .89
            detail.box((side * (width / 2 + 3.2), (4 + spring) / 2, along),
                       (1.3, spring - 4, 1.3), 0, frame)
            detail.box((side * (width / 2 + 3.2), spring + .2, along), (1.55, .4, 1.55), 1, frame)
            for segment in range(10):
                first, last = segment / 10, (segment + 1) / 10
                points = []
                for fraction, offset in [(first, 0), (last, 0), (last, .7), (first, .7)]:
                    across = side * (width / 2 + 3.2 * (1 - fraction))
                    elevation = spring + (top - spring) * math.sin(fraction * math.pi / 2) + offset
                    points.append((across, elevation))
                detail.prism([frame(across, elevation, along - .45) for across, elevation in points],
                             [frame(across, elevation, along + .45) for across, elevation in points], 1)


def _flag(detail, horizontal, depth, elevation, height=10, side=1):
    detail.box((horizontal, elevation + height / 2, depth), (.16, height, .16), 7)
    cloth = [(horizontal, elevation + height - .7, depth),
             (horizontal + side * 3.2, elevation + height - 1.25, depth),
             (horizontal + side * 2.35, elevation + height - 3.05, depth),
             (horizontal, elevation + height - 2.75, depth)]
    detail.face(cloth, 7)


def _import_gate_door(root, collection):
    source = root / 'assets' / 'life' / 'models' / 'large_castle_door' / 'large_castle_door_4k.gltf'
    if not source.is_file():
        return {'imported': False, 'reason': 'asset not present'}
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(source), merge_vertices=False)
    imported = list(set(bpy.data.objects) - before)
    if not imported:
        raise ValueError('Castle door asset imported no objects')
    angle = .23
    horizontal_axis = Vector((math.cos(angle), math.sin(angle), 0))
    depth_axis = Vector((math.sin(angle), -math.cos(angle), 0))
    bpy.context.view_layer.update()
    bounds = [instance.matrix_world @ Vector(corner) for instance in imported
              if instance.type == 'MESH' for corner in instance.bound_box]
    minimum = Vector(tuple(min(point[axis] for point in bounds) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in bounds) for axis in range(3)))
    if not 2.8 < maximum.z - minimum.z < 3.1:
        raise ValueError('Castle door import must have the verified Blender Z-up height')
    origin = Vector(_castle(*_campus(28.78, 3.86, 7.0)))
    basis = Matrix(((-depth_axis.x, -horizontal_axis.x, 0, origin.x),
                    (-depth_axis.y, -horizontal_axis.y, 0, origin.y),
                    (0, 0, 1, origin.z), (0, 0, 0, 1)))
    width, height = 6.6 * CAMPUS_SCALE[1], 8.25
    placement = (basis @ Matrix.Diagonal((width / (maximum.x - minimum.x), 2.8,
                                         height / (maximum.z - minimum.z), 1)) @
                 Matrix.Translation(Vector((-(minimum.x + maximum.x) / 2, 0, -minimum.z))))
    world_matrices = {instance: instance.matrix_world.copy() for instance in imported}
    for instance in imported:
        if instance.parent not in imported:
            instance.matrix_world = placement @ world_matrices[instance]
        for owner in list(instance.users_collection):
            owner.objects.unlink(instance)
        collection.objects.link(instance)
        instance['public_asset'] = 'Poly Haven large_castle_door, CC0'
    return {'imported': True, 'objects': len(imported), 'asset': str(source.relative_to(root)),
            'verified_source_z_height': maximum.z - minimum.z,
            'opening_width_metres': width, 'opening_height_metres': height,
            'blender_z_up_preserved': True, 'bridge_gate_anchor_preserved': True}


def _polygon_hull(points):
    ordered = sorted(set(points))
    def turn(first, middle, last):
        return ((middle[0] - first[0]) * (last[1] - first[1])
                - (middle[1] - first[1]) * (last[0] - first[0]))
    lower, upper = [], []
    for point in ordered:
        while len(lower) >= 2 and turn(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    for point in reversed(ordered):
        while len(upper) >= 2 and turn(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _polygon_intersection_area(subject, clip):
    polygon = list(subject)
    for first, last in zip(clip, clip[1:] + clip[:1]):
        def side(point):
            return ((last[0] - first[0]) * (point[1] - first[1])
                    - (last[1] - first[1]) * (point[0] - first[0]))
        output = []
        if not polygon:
            return 0
        for previous, current in zip(polygon[-1:] + polygon[:-1], polygon):
            before, after = side(previous), side(current)
            if (before >= 0) != (after >= 0):
                fraction = before / (before - after)
                output.append(tuple(previous[axis] + (current[axis] - previous[axis]) * fraction for axis in range(2)))
            if after >= 0:
                output.append(current)
        polygon = output
    return abs(sum(first[0] * last[1] - first[1] * last[0]
                   for first, last in zip(polygon, polygon[1:] + polygon[:1]))) / 2


def _fort_building_clearances(instances):
    halls = [('great-hall', -5.5, 11, 19, 44, math.pi / 2, 0),
             ('west-hall', -26, 6, 9.5, 30, 0, 0),
             ('east-hall', 18, -8, 11, 33, 0, 0),
             ('rear-hall', -1, -38, 34, 8, 0, 0),
             ('west-lateral-wing', -19.5, 19.5, 8.5, 22, math.pi / 2, 0),
             ('east-lateral-wing', 15.5, 21, 8.5, 22, math.pi / 2, 0),
             ('western-college', -30.5, -7, 8.5, 19, 0, .60),
             ('eastern-college', 28.5, -13, 7.5, 18, 0, .60),
             ('clock-tower', 20, -25, 10, 10, 0, 0)]
    rectangles = []
    for name, horizontal, depth, width, length, rotation, dock_allowance in halls:
        frame = _frame(horizontal, depth, rotation)
        corners = [_campus(*frame(across, 0, along)) for across, along in
                   [(-width / 2, -length / 2 + dock_allowance),
                    (width / 2, -length / 2 + dock_allowance),
                    (width / 2, length / 2 - dock_allowance),
                    (-width / 2, length / 2 - dock_allowance)]]
        rectangles.append((name, _polygon_hull([(point[0], point[2]) for point in corners])))
    maximum_overlap = 0
    for instance in instances:
        points = [instance.matrix_world @ vertex.co for vertex in instance.data.vertices]
        footprint = _polygon_hull([((point.x + 45) * math.cos(.23) + (point.y - 190) * math.sin(.23),
                                    (point.x + 45) * math.sin(.23) - (point.y - 190) * math.cos(.23))
                                   for point in points])
        for name, rectangle in rectangles:
            overlap = _polygon_intersection_area(footprint, rectangle)
            maximum_overlap = max(maximum_overlap, overlap)
            if overlap > .001:
                raise ValueError(f'Fort module intersects occupied building footprint: {instance.name}, {name}, {overlap:.3f} m2')
    return {'actual_module_hulls': len(instances), 'protected_building_rectangles': len(rectangles),
            'maximum_footprint_overlap_square_metres': maximum_overlap,
            'college_gable_solid_pier_docking_allowance_metres': .60}


def _opening_verification(instances, fort_instances, collection, dependency_graph):
    def world_tree(instance):
        evaluated = instance.evaluated_get(dependency_graph)
        mesh = evaluated.to_mesh()
        try:
            return BVHTree.FromPolygons([evaluated.matrix_world @ vertex.co for vertex in mesh.vertices],
                                        [tuple(polygon.vertices) for polygon in mesh.polygons])
        finally:
            evaluated.to_mesh_clear()
    building_trees = [world_tree(instance) for instance in instances[:2]]
    fort_trees = [world_tree(instance) for instance in fort_instances]
    samples = [('great-hall', (18.5, 11, 11), (16.5, 11, 11), True)]
    for name, horizontal, depth, width, length in [('western-college', -30.5, -7, 8.5, 19),
                                                 ('eastern-college', 28.5, -13, 7.5, 18)]:
        for side in (-1, 1):
            frame = _frame(horizontal, depth + side * length / 2, 0 if side > 0 else math.pi)
            for center in (-width / 4, width / 4):
                for fraction in (-.3, 0, .3):
                    across = center + fraction * 1.45
                    samples.append((name, frame(across, 7.45, 1.2), frame(across, 7.45, 0), False))
        side = -1 if name == 'western-college' else 1
        frame = _frame(horizontal + side * width / 2, depth, side * math.pi / 2)
        for bay in range(5):
            center = -length / 2 + (bay + .5) * length / 5
            for sill, window_height, window_width in ((6, 3.1, 1.45), (12.3, 3, 1.4)):
                for fraction in (-.3, 0, .3):
                    across = center + fraction * window_width
                    elevation = sill + window_height * .47
                    samples.append((name, frame(across, elevation, 1.2), frame(across, elevation, 0), True))
    recesses = []
    for name, start, aperture, verify_glazing in samples:
        origin = Vector(_castle(*_campus(*start)))
        plane = Vector(_castle(*_campus(*aperture)))
        direction = (plane - origin).normalized()
        distance = (plane - origin).length + .9
        if verify_glazing:
            hits = [tree.ray_cast(origin, direction)[0] for tree in building_trees]
            distances = [(hit - origin).length for hit in hits if hit is not None]
            if not distances:
                raise ValueError('Window sample misses the rebuilt building: ' + name)
            distance = min(distances)
            recess = distance - (plane - origin).length
            if recess < .4:
                raise ValueError(f'Window grid sample lacks a true recessed opening: {name}, {recess}')
            recesses.append(recess)
        if any(tree.ray_cast(origin, direction, distance - .01)[0] is not None for tree in fort_trees):
            raise ValueError('Fort masonry occludes a sampled lower-storey window: ' + name)
    aperture = _arch(6.8 * CAMPUS_SCALE[1], 8.4, rounded=True)
    gate_minimum = _campus(28.75 - .85, 0, 7)[0]
    gate_maximum = _campus(28.75, 0, 7)[0]
    checked, maximum_overlap = 0, 0
    for instance in collection.objects:
        if instance.type != 'MESH' or not any(name in instance.name for name in ('large_castle_door_left', 'large_castle_door_right')):
            continue
        for vertex in instance.data.vertices:
            point = instance.matrix_world @ vertex.co
            local_x = (point.x + 45) * math.cos(.23) + (point.y - 190) * math.sin(.23)
            local_depth = (point.x + 45) * math.sin(.23) - (point.y - 190) * math.cos(.23)
            height = point.z + 15 - 4
            if not gate_minimum <= local_x <= gate_maximum:
                continue
            crossings = []
            for first, last in zip(aperture, aperture[1:] + aperture[:1]):
                if (first[1] > height) != (last[1] > height):
                    crossings.append(first[0] + (last[0] - first[0]) * (height - first[1]) / (last[1] - first[1]))
            opening = max(crossings) if crossings else 0
            overlap = max(abs(local_depth - 7) - opening, -height, height - 8.4)
            maximum_overlap = max(maximum_overlap, overlap)
            checked += 1
    if checked == 0 or maximum_overlap > .005:
        raise ValueError(f'Imported gate door intersects its masonry aperture: {checked} samples, {maximum_overlap} m')
    return {'window_grid_rays': len(samples), 'actual_glazing_recess_rays': len(recesses),
            'minimum_glazing_recess_metres': min(recesses),
            'great_hall_window_recess_metres': recesses[0], 'fort_included_in_window_visibility': True,
            'actual_door_leaf_vertices_inside_wall_slab': checked,
            'maximum_door_leaf_overlap_with_masonry_metres': maximum_overlap,
            'gate_aperture_profile': 'rounded arch matched to the scanned door'}


def _import_modular_fort(root, collection):
    source = root / 'assets' / 'life' / 'models' / 'modular_fort_01' / 'modular_fort_01_4k.gltf'
    if not source.is_file():
        raise FileNotFoundError('Castle reconstruction requires the verified modular_fort_01 asset')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(source), merge_vertices=False)
    imported = list(set(bpy.data.objects) - before)
    if not imported:
        raise ValueError('Modular fort asset imported no objects')
    bpy.context.view_layer.update()
    gltf = json.loads(source.read_text(encoding='utf-8'))
    source_nodes = {node['name']: node for node in gltf['nodes'] if 'mesh' in node}
    templates, template_bounds = {}, {}
    for instance in imported:
        if instance.type != 'MESH':
            continue
        source_name = next((name for name in source_nodes if instance.name == name or
                            instance.name.startswith(name + '.')), None)
        if source_name is None or source_name.removeprefix('modular_fort_01_') in templates:
            raise ValueError('Modular fort must import one mesh for every named source module')
        mesh = instance.data.copy()
        mesh.transform(instance.matrix_world.to_3x3().to_4x4())
        minimum = Vector(tuple(min(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)))
        maximum = Vector(tuple(max(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)))
        primitives = gltf['meshes'][source_nodes[source_name]['mesh']]['primitives']
        accessors = [gltf['accessors'][primitive['attributes']['POSITION']] for primitive in primitives]
        expected_height = max(accessor['max'][1] for accessor in accessors) - min(accessor['min'][1] for accessor in accessors)
        if abs(maximum.z - minimum.z - expected_height) > .001:
            raise ValueError(f'Modular fort axis conversion failed for {source_name}')
        center = Vector(((minimum.x + maximum.x) / 2, (minimum.y + maximum.y) / 2, minimum.z))
        mesh.transform(Matrix.Translation(-center))
        short_name = source_name.removeprefix('modular_fort_01_')
        templates[short_name] = mesh
        template_bounds[short_name] = tuple(maximum - minimum)
    if len(templates) != len(source_nodes):
        raise ValueError('Modular fort source module inventory changed')
    for instance in imported:
        bpy.data.objects.remove(instance, do_unlink=True)
    placed, placements = [], []

    def place(module, label, horizontal, depth, along=(0, 1), scale=(1, 1, 1)):
        normal = (along[1], -along[0])
        origin = Vector(_castle(horizontal, -.32, depth))
        normal_axis = Vector(_castle(normal[0], 0, normal[1])) - Vector(_castle(0, 0, 0))
        long_axis = Vector(_castle(along[0], 0, along[1])) - Vector(_castle(0, 0, 0))
        basis = Matrix(((normal_axis.x, -long_axis.x, 0, origin.x),
                        (normal_axis.y, -long_axis.y, 0, origin.y),
                        (0, 0, 1, origin.z), (0, 0, 0, 1)))
        instance = bpy.data.objects.new('Castle/Fort/' + label, templates[module])
        collection.objects.link(instance)
        instance.matrix_world = basis @ Matrix.Diagonal((*scale, 1))
        instance['public_asset'] = 'Poly Haven modular_fort_01, CC0'
        instance['fort_module'] = module
        placed.append(instance)
        placements.append({'name': label, 'module': module, 'horizontal': horizontal,
                           'depth': depth, 'base': -.32, 'scale': scale})

    def curtain(points, label, thickness=1.06):
        for span_index, (first, last) in enumerate(zip(points, points[1:])):
            length = math.dist(first, last)
            along = tuple((last[axis] - first[axis]) / length for axis in range(2))
            count = max(1, round(length / 15.7))
            for segment in range(count):
                module = 'wall_thick_straight_02' if (span_index + segment) % 3 == 1 else 'wall_thick_straight_01'
                if length / count < 7:
                    module = 'wall_thick_end_01'
                center = tuple(first[axis] + (last[axis] - first[axis]) * (segment + .5) / count for axis in range(2))
                scale_length = (length / count + .09) / template_bounds[module][1]
                place(module, f'{label}-{span_index + 1}-{segment + 1}', *center, along=along,
                      scale=(thickness, scale_length, 1.06))

    curtain([(-27, 39), (-8, 42), (10, 37), (29, 29), (30, 16)], 'lake-curtain', .72)
    curtain([(-52, -21.8), (-43, -52), (6, -53), (17, -51), (31, -34), (28.388, -29), (28.388, -26)],
            'rear-tower-college-curtain', .65)
    curtain([(28.388, -5.75), (30, -2)], 'gate-college-link', .65)
    place('tower_round', 'western-lake-bastion', -27, 39, scale=(.87, .87, .87))
    place('tower_round', 'eastern-lake-bastion', 15, 35, scale=(.75, .75, .75))
    bpy.context.view_layer.update()
    points = [instance.matrix_world @ vertex.co for instance in placed for vertex in instance.data.vertices]
    base_points = [point for point in points if point.z < -15.25]
    local_points = [((point.x + 45) * math.cos(.23) + (point.y - 190) * math.sin(.23),
                     (point.x + 45) * math.sin(.23) - (point.y - 190) * math.cos(.23)) for point in base_points]
    maximum_footprint = max(_island_radius(*point) for point in local_points)
    if maximum_footprint > .84:
        raise ValueError(f'Modular fort foundations leave the protected island core: {maximum_footprint}')
    clearance_report = _fort_building_clearances(placed)
    return placed, {'imported': True, 'objects': len(placed), 'asset': str(source.relative_to(root)),
                    'source_modules': len(templates), 'source_template_bounds_z_up': template_bounds,
                    'source_display_translations_removed': True, 'blender_z_up_preserved': True,
                    'maximum_foundation_island_radius': maximum_footprint,
                    'placements': placements, 'building_clearances': clearance_report,
                    'maximum_height_above_island': max(point.z + 15 for point in points)}


def _clock_tower(walls, detail, roofs):
    horizontal, depth, width = 20, -25, 10
    walls.box((horizontal, 1.8, depth), (10.5, 4.45, 10.5))
    for angle in [0, math.pi / 2, math.pi, math.pi * 1.5]:
        frame = _frame(horizontal + math.sin(angle) * width / 2, depth + math.cos(angle) * width / 2, angle)
        _facade(walls, detail, frame, width, 4, 43, 2, [(8, 4.5, 1.7), (20, 5.2, 1.75), (32, 6.8, 2.25)])
        detail.box((0, 29.6, .15), (width + .3, .55, .5), 1, frame)
        for side in [-1, 1]:
            detail.box((side * 4.5, 23.5, .38), (.9, 39, .9), 1, frame)
    roof_base = [(horizontal - 5.65, 43, depth - 5.65), (horizontal + 5.65, 43, depth - 5.65),
                 (horizontal + 5.65, 43, depth + 5.65), (horizontal - 5.65, 43, depth + 5.65)]
    for index in range(4):
        roofs.face([roof_base[index], roof_base[(index + 1) % 4], (horizontal, 53, depth)], 3)
    for offset_x, offset_z in [(-4.6, -4.6), (-4.6, 4.6), (4.6, -4.6), (4.6, 4.6)]:
        detail.box((horizontal + offset_x, 44.8, depth + offset_z), (.65, 3.6, .65), 1)
    _battlement_ring(detail, horizontal, depth, 11.4, 11.4, 44.0, merlons=6)
    _flag(detail, horizontal, depth, 53.0, 8.5, side=1)


def _closed_gable(walls, name, horizontal, depth, width, eave, rise, side):
    half_width = width / 2
    shoulder = eave + rise * .65 / (half_width + .65)
    frame = _frame(horizontal, depth, 0 if side > 0 else math.pi)
    first_face = len(walls.faces)
    _wall_polygon(walls, [(-half_width, eave - .025), (half_width, eave - .025),
                          (half_width, shoulder + .025), (0, eave + rise + .025),
                          (-half_width, shoulder + .025)], frame, thickness=.85)
    return {'name': name, 'horizontal': horizontal, 'depth': depth, 'width': width,
            'eave': eave, 'rise': rise, 'side': side, 'shoulder_height': shoulder,
            'thickness': .85, 'first_face': first_face, 'face_count': len(walls.faces) - first_face}


def _gable_verification(instance, gables):
    mesh = instance.data
    vertices = [instance.matrix_world @ vertex.co for vertex in mesh.vertices]
    maximum_error, ray_count = 0, 0
    for gable in gables:
        polygons = [tuple(mesh.polygons[index].vertices) for index in
                    range(gable['first_face'], gable['first_face'] + gable['face_count'])]
        tree = BVHTree.FromPolygons(vertices, polygons)
        frame = _frame(gable['horizontal'], gable['depth'], 0 if gable['side'] > 0 else math.pi)
        half_width = gable['width'] / 2
        for fraction_x in (-.95, -.75, -.3, 0, .3, .75, .95):
            across = fraction_x * half_width
            roof_height = gable['eave'] + gable['rise'] * (1 - abs(across) / (half_width + .65))
            for fraction_height in (.08, .4, .75, .96):
                height = gable['eave'] + (roof_height - gable['eave']) * fraction_height
                for outward, surface_depth in ((.35, 0), (-gable['thickness'] - .35, -gable['thickness'])):
                    origin = Vector(_castle(*_campus(*frame(across, height, outward))))
                    target = Vector(_castle(*_campus(*frame(across, height, surface_depth))))
                    direction = (target - origin).normalized()
                    hit, normal, polygon, distance = tree.ray_cast(origin, direction, (target - origin).length + .01)
                    if hit is None:
                        raise ValueError('Closed gable is missing an actual masonry face: ' + gable['name'])
                    error = (hit - target).length
                    maximum_error = max(maximum_error, error)
                    if error > .001 or abs(normal.dot(direction)) < .99:
                        raise ValueError(f'Closed gable world-space ray misses its specified wall plane: {gable["name"]}, {error}')
                    ray_count += 1
    return {'closed_gable_count': len(gables), 'front_and_back_world_space_rays': ray_count,
            'maximum_wall_plane_error_metres': maximum_error,
            'world_wall_thickness_metres': .85 * CAMPUS_SCALE[1],
            'roof_profile_overlap_metres': .025,
            'gable_dimensions': [{key: value for key, value in gable.items() if key not in ('first_face', 'face_count')}
                                  for gable in gables]}


def _gatehouse(walls, detail, roofs):
    gables = []
    walls.box((25, 1.8, 7), (8.1, 4.45, 15.4))
    for side in [-1, 1]:
        frame = _frame(25 + side * 3.75, 7, side * math.pi / 2)
        _window_cell(walls, detail, frame, -7.4, 7.4, 4, 18, 4, 6.8, 8.4, door=True, rounded=True)
        _facade(walls, detail, frame, 14.8, 18, 24, 3, [(19.1, 3.5, 1.8)])
        shoulder_rise = 8 * .65 / (3.75 + .65)
        walls.box((0, 24 + shoulder_rise / 2, -.425), (14.8, shoulder_rise + .05, .85), frame=frame)
    for side in [-1, 1]:
        _facade(walls, detail, _frame(25, 7 + side * 7.4, 0 if side > 0 else math.pi),
                7.5, 4, 24, 2, [(7, 4.4, 1.4), (17, 4.2, 1.4)])
        gables.append(_closed_gable(walls, 'gatehouse-' + str(side), 25, 7 + side * 7.4,
                                    7.5, 24, 8, side))
    _gable_roof(roofs, detail, 25, 7, 7.5, 14.8, 24, 8, 1)
    detail.box((27.8, 3.86, 7), (2.3, .28, 6.8), 8)
    return gables


def _cloister(walls, detail, roofs):
    gables = []
    for horizontal, depth, width, length in [(9, -10, 5, 38), (3, -28, 15, 5)]:
        walls.box((horizontal, 1.8, depth), (width + .3, 4.45, length + .3))
        for side in [-1, 1]:
            frame = _frame(horizontal + side * width / 2, depth, side * math.pi / 2)
            bays = max(2, round(length / 3.6))
            for bay in range(bays):
                left = -length / 2 + bay * length / bays
                _window_cell(walls, detail, frame, left, left + length / bays, 4, 10.8,
                             4, length / bays * .64, 4.9, door=True)
            shoulder_rise = 3.6 * .65 / (width / 2 + .65)
            walls.box((0, 10.8 + shoulder_rise / 2, -.425), (length, shoulder_rise + .05, .85), frame=frame)
        for side in [-1, 1]:
            frame = _frame(horizontal, depth + side * length / 2, 0 if side > 0 else math.pi)
            bays = max(1, round(width / 3.6))
            for bay in range(bays):
                left = -width / 2 + bay * width / bays
                _window_cell(walls, detail, frame, left, left + width / bays, 4, 10.8,
                             4, width / bays * .64, 4.9, door=True)
            gables.append(_closed_gable(walls, f'cloister-{horizontal}-{side}', horizontal,
                                        depth + side * length / 2, width, 10.8, 3.6, side))
        _gable_roof(roofs, detail, horizontal, depth, width, length, 10.8, 3.6)
    return gables


def _courtyard(walls, detail):
    outline = [(-29, -17), (-20, -42), (12, -43), (28.6, -25), (29, 14.9),
               (16, 27), (4, 36), (-14, 34), (-28, 21)]
    walls.prism([(horizontal, 3.8, depth) for horizontal, depth in outline],
                [(horizontal, -.4, depth) for horizontal, depth in outline], 0)
    for first, last in zip(outline, outline[1:] + outline[:1]):
        if first[0] > 28 and last[0] > 28:
            continue
        segments = max(1, math.ceil(math.dist(first, last) / 2.4))
        for index in range(segments):
            lower, upper = index / segments, (index + .96) / segments
            points = [(first[0] * (1 - fraction) + last[0] * fraction,
                       first[1] * (1 - fraction) + last[1] * fraction) for fraction in [lower, upper]]
            center_x, center_z = ((points[0][axis] + points[1][axis]) / 2 for axis in range(2))
            angle = math.atan2(-(points[1][1] - points[0][1]), points[1][0] - points[0][0])
            detail.box((0, 4.3, 0), (math.dist(*points), .85, .5), 1, _frame(center_x, center_z, angle))
    def inside(horizontal, depth):
        contained = False
        for first, last in zip(outline, outline[1:] + outline[:1]):
            if (first[1] > depth) != (last[1] > depth):
                crossing = first[0] + (depth - first[1]) * (last[0] - first[0]) / (last[1] - first[1])
                if horizontal < crossing:
                    contained = not contained
        return contained

    for horizontal in range(-26, 27, 2):
        for depth in range(-40, 35, 2):
            if all(inside(horizontal + offset_x, depth + offset_z) for offset_x in [-.98, .98] for offset_z in [-.98, .98]):
                detail.box((horizontal, 3.88, depth), (1.96, .12, 1.96), 8)


def _chimneys(detail):
    sources = [(-10, -2, -5.5, 19, 26, 12.5), (-6, 22, -5.5, 19, 26, 12.5),
               (-27, -2, -26, 9.5, 18.5, 8), (-27, 16, -26, 9.5, 18.5, 8),
               (0, -38, -1, 34, 22.5, 8), (12, -38, -1, 34, 22.5, 8), (18, -9, 18, 11, 18, 6.5)]
    for source_index, (horizontal, depth, roof_center, roof_width, eave, rise) in enumerate(sources):
        first_vertex = len(detail.vertices)
        base = eave + rise * (1 - abs(horizontal - roof_center) / (roof_width / 2 + .65)) - .4
        detail.box((horizontal, base + 2.2, depth), (1.25, 6.0, 1.8), 0)
        for level in [base + 4.4, base + 4.9]:
            detail.box((horizontal, level, depth), (1.55, .24, 2.1), 1)
        for offset in [-.45, .45]:
            detail.box((horizontal, base + 5.2, depth + offset), (.46, .72, .46), 7)
        if source_index < 2:
            _rotate_additions([detail], [first_vertex], -5.5, 11, math.pi / 2)


def refine(scene, descriptor, asset_root=None):
    if descriptor.get('scene') != 'hogwarts':
        return {'skipped': True, 'reason': 'not hogwarts'}
    if bpy.data.collections.get(COLLECTION_NAME):
        return {'skipped': True, 'reason': 'already refined'}
    targets = _descriptor_targets(scene, descriptor)
    unaffected = {instance: instance.hide_render for instance in scene.objects if instance not in targets}
    root = Path(asset_root) if asset_root else Path(__file__).resolve().parent.parent
    materials = _materials(root)
    walls = _Batch('masonry masses and true recessed openings', materials)
    detail = _Batch('buttresses window dressings and courtyard', materials)
    roofs = _Batch('asymmetric roofscape and individual slate', materials)
    _courtyard(walls, detail)
    _hall(walls, detail, roofs, -5.5, 11, 19, 44, 26, 12.5, 9, grand=True, rotation=math.pi / 2)
    _hall(walls, detail, roofs, -26, 6, 9.5, 30, 18.5, 8, 6)
    _hall(walls, detail, roofs, 18, -8, 11, 33, 18, 6.5, 7)
    _hall(walls, detail, roofs, -1, -38, 34, 8, 22.5, 8, 2)
    _polygon_tower(walls, detail, roofs, -25, -12, 7.4, 56, 16)
    _polygon_tower(walls, detail, roofs, 6, 29, 3.1, 29, 10, 8)
    _lateral_wings(walls, detail, roofs)
    _peripheral_colleges(walls, detail, roofs)
    _clock_tower(walls, detail, roofs)
    gables = _cloister(walls, detail, roofs)
    gables.extend(_gatehouse(walls, detail, roofs))
    _chimneys(detail)
    batches = [walls, detail, roofs]
    for batch in batches:
        batch.vertices = [_campus(*point) for point in batch.vertices]
    base_points = [point for batch in batches for point in batch.vertices if point[1] <= 4.05]
    maximum_footprint = max(_island_radius(point[0], point[2]) for point in base_points)
    if maximum_footprint > .84:
        raise ValueError(f'Castle foundations leave the protected island core: {maximum_footprint}')
    if any(not math.isfinite(value) for batch in batches for point in batch.vertices for value in point):
        raise ValueError('Non-finite castle geometry')
    collection = bpy.data.collections.new(COLLECTION_NAME)
    scene.collection.children.link(collection)
    instances = [batch.finish(collection) for batch in batches]
    door_report = _import_gate_door(root, collection)
    fort_instances, fort_report = _import_modular_fort(root, collection)
    bpy.context.view_layer.update()
    terrain_candidates = [instance for instance in scene.objects if instance.get('highlands_refinement')]
    if len(terrain_candidates) != 1:
        raise ValueError('Castle foundation verification needs exactly one refined highland terrain')
    dependency_graph = bpy.context.evaluated_depsgraph_get()
    terrain_tree = BVHTree.FromObject(terrain_candidates[0], dependency_graph)
    foundation_clearances = []
    for instance in [*instances, *fort_instances]:
        for vertex in instance.data.vertices:
            point = instance.matrix_world @ vertex.co
            if point.z >= -15:
                continue
            hit = terrain_tree.ray_cast(Vector((point.x, point.y, 900)), Vector((0, 0, -1)))[0]
            if hit is None:
                raise ValueError('Castle foundation lies outside the actual terrain mesh')
            foundation_clearances.append(point.z - hit.z)
    if not foundation_clearances or max(foundation_clearances) > .02:
        raise ValueError('Castle foundation floats above the actual island terrain')
    opening_report = _opening_verification(instances, fort_instances, collection, dependency_graph)
    gable_report = _gable_verification(instances[0], gables)
    for target in targets:
        target.hide_render = True
        target.hide_set(True)
        target['replaced_by_original_gothic_castle'] = True
    if any(instance.hide_render != visibility for instance, visibility in unaffected.items()):
        raise ValueError('Castle refinement changed visibility of unrelated scene geometry')
    all_instances = [*instances, *fort_instances]
    result = {'original_meshes_hidden': len(targets), 'new_meshes': len(all_instances),
              'vertices': sum(len(instance.data.vertices) for instance in all_instances),
              'polygons': sum(len(instance.data.polygons) for instance in all_instances),
              'foundation_maximum_island_radius': maximum_footprint,
              'maximum_height_above_island': max(point[1] for batch in batches for point in batch.vertices),
              'bridge_floor_local_height': 4, 'bridge_and_terrain_visibility_preserved': True,
              'campus_horizontal_depth_scale': CAMPUS_SCALE, 'campus_fixed_bridge_gate_anchor': GATE_ANCHOR,
              'campus_foundation_local_bounds': {'minimum': [min(point[axis] for point in base_points) for axis in [0, 2]],
                                                  'maximum': [max(point[axis] for point in base_points) for axis in [0, 2]]},
              'actual_foundation_samples': len(foundation_clearances),
              'maximum_foundation_above_terrain_metres': max(foundation_clearances),
              'great_hall_window_recess_metres': opening_report['great_hall_window_recess_metres'],
              'opening_verification': opening_report,
              'gable_verification': gable_report,
              'source_descriptor_sha256': DESCRIPTOR_SHA256, 'masonry_tile_metres': 3.5,
              'lateral_college_wings': 2, 'peripheral_college_halls': 2, 'physically_scaled_stone_weathering': True,
              'gate_door_public_asset': door_report,
              'modular_fort_public_assets': fort_report,
              'design': 'Broad fortified collegiate campus with individual scanned curtain-wall modules, unequal round lake bastions, recessed Gothic openings and a bridge-aligned gate'}
    collection['validation_report'] = json.dumps(result, sort_keys=True)
    print('CASTLE_REFINEMENT', json.dumps(result, sort_keys=True))
    return result
