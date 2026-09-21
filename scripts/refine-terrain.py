"""Offline Everest-region DEM with measured foreground terrain."""
import array
import gzip
import hashlib
import math
import random
import sys
from pathlib import Path

SOURCE_SHA256 = '0e95b43508321ee2b3d9454797130bf1c972737377eff4cb07b4cf912138aad1'
RAW_SHA256 = '150d99a7cee9472de347cf7c5d2baf95b70b8c87d0f9ac992976774d94c8e717'
ANCHOR_LATITUDE = 27.9718
ANCHOR_LONGITUDE = 86.9300
SIDE = 3601
SPACING = 1500 / 220
INNER_RADIUS = SPACING * 5
OUTER_RADIUS = 18000
DEM_INNER_EXTENT = 2500
DEM_OUTER_BOUNDS = (-18000, 6400, -18000, 2800)
SNOW_FOREGROUND_SUBDIVISION = 6
SNOW_CRUST_TRANSITION = .24


class HeightTile:
    def __init__(self, path):
        compressed = Path(path).read_bytes()
        if hashlib.sha256(compressed).hexdigest() != SOURCE_SHA256:
            raise ValueError('Terrain source checksum mismatch')
        raw = gzip.decompress(compressed)
        if len(raw) != SIDE * SIDE * 2 or hashlib.sha256(raw).hexdigest() != RAW_SHA256:
            raise ValueError('Unexpected terrain payload')
        self.samples = array.array('h')
        self.samples.frombytes(raw)
        if sys.byteorder == 'little':
            self.samples.byteswap()
        self.anchor_height = self.sample(ANCHOR_LATITUDE, ANCHOR_LONGITUDE)
        self.metres_per_longitude = 111320 * math.cos(math.radians(ANCHOR_LATITUDE))
        self.observation_ground = (0, -7)
        self.observation_offset = self.relative(*self.observation_ground)

    def sample(self, latitude, longitude):
        row, column = (28 - latitude) * (SIDE - 1), (longitude - 86) * (SIDE - 1)
        if not (0 <= row <= SIDE - 1 and 0 <= column <= SIDE - 1):
            raise ValueError('Terrain sample lies outside the verified tile')
        near, left = min(SIDE - 2, int(row)), min(SIDE - 2, int(column))
        fraction_row, fraction_column = row - near, column - left
        interpolated = []
        for offset_row in (-1, 0, 1, 2):
            sample_row = min(SIDE - 1, max(0, near + offset_row))
            values = [self.samples[sample_row * SIDE + min(SIDE - 1, max(0, left + offset))]
                      for offset in (-1, 0, 1, 2)]
            if -32768 in values:
                raise ValueError('Void in source terrain; refusing invented height')
            interpolated.append(_monotone_cubic(values, fraction_column))
        return _monotone_cubic(interpolated, fraction_row)

    def relative(self, east, north):
        return self.sample(ANCHOR_LATITUDE + north / 111320,
                           ANCHOR_LONGITUDE + east / self.metres_per_longitude) - self.anchor_height


def _smooth(value):
    value = min(1, max(0, value))
    return value * value * (3 - 2 * value)


def _monotone_cubic(values, fraction):
    before, first, second, after = values
    difference = second - first
    def tangent(previous, following):
        if previous * following <= 0:
            return 0
        return 2 * previous * following / (previous + following)
    first_tangent = tangent(first - before, difference)
    second_tangent = tangent(difference, after - second)
    squared, cubed = fraction * fraction, fraction * fraction * fraction
    return ((2 * cubed - 3 * squared + 1) * first + (cubed - 2 * squared + fraction) * first_tangent
            + (-2 * cubed + 3 * squared) * second + (cubed - squared) * second_tangent)


def _descriptor_geometry(descriptor):
    matches = []
    for geometry in descriptor.get('geometry', []):
        positions = geometry.get('positions', [])
        if len(positions) != 221 * 221 * 3:
            continue
        horizontal, depth = positions[0::3], positions[2::3]
        if abs(min(horizontal) + 750) < .001 and abs(max(horizontal) - 750) < .001 and abs(min(depth) + 750) < .001 and abs(max(depth) - 750) < .001:
            matches.append(geometry)
    if len(matches) != 1:
        raise ValueError('Expected exactly one 1500 m, 48841-vertex authored far terrain')
    geometry = matches[0]
    objects = [item for item in descriptor.get('objects', []) if item.get('geometry') == geometry['id']]
    if len(objects) != 1:
        raise ValueError('Far terrain descriptor must have one instance')
    matrix = objects[0]['matrix']
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    if any(abs(value - expected) > .00001 for value, expected in zip(matrix, identity)):
        raise ValueError('Unexpected far terrain transform; refusing misaligned replacement')
    return geometry


def _authored_height(geometry, east, north):
    column = min(219.999999, max(0, (east + 750) / SPACING))
    row = min(219.999999, max(0, (-north + 750) / SPACING))
    left, near = int(column), int(row)
    fraction_x, fraction_z = column - left, row - near
    positions = geometry['positions']
    first = positions[(near * 221 + left) * 3 + 1]
    right = positions[(near * 221 + left + 1) * 3 + 1]
    lower = positions[((near + 1) * 221 + left) * 3 + 1]
    diagonal = positions[((near + 1) * 221 + left + 1) * 3 + 1]
    if fraction_x + fraction_z <= 1:
        return first * (1 - fraction_x - fraction_z) + right * fraction_x + lower * fraction_z
    return lower * (1 - fraction_x) + right * (1 - fraction_z) + diagonal * (fraction_x + fraction_z - 1)


def _authored_tint(geometry, east, north):
    colors = geometry.get('colors', [])
    if not colors:
        return (1, 1, 1, 1)
    column = min(219.999999, max(0, (east + 750) / SPACING))
    row = min(219.999999, max(0, (-north + 750) / SPACING))
    left, near = int(column), int(row)
    fraction_x, fraction_z = column - left, row - near
    result = []
    blend = _smooth((max(abs(east), abs(north)) - INNER_RADIUS) / 65)
    for channel in range(3):
        first = colors[(near * 221 + left) * 3 + channel]
        right = colors[(near * 221 + left + 1) * 3 + channel]
        lower = colors[((near + 1) * 221 + left) * 3 + channel]
        diagonal = colors[((near + 1) * 221 + left + 1) * 3 + channel]
        value = first * (1 - fraction_x - fraction_z) + right * fraction_x + lower * fraction_z if fraction_x + fraction_z <= 1 else lower * (1 - fraction_x) + right * (1 - fraction_z) + diagonal * (fraction_x + fraction_z - 1)
        result.append(value * (1 - blend) + blend)
    return tuple(result) + (1,)


def _blend_height(tile, geometry, east, north):
    measured = tile.relative(east, north) - tile.observation_offset
    radial = math.hypot(east, north)
    detail_blend = _smooth((radial - 80) / 160)
    if detail_blend:
        slope_x = (tile.relative(east + 14, north) - tile.relative(east - 14, north)) / 28
        slope_y = (tile.relative(east, north + 14) - tile.relative(east, north - 14)) / 28
        exposure = _smooth((math.hypot(slope_x, slope_y) - .22) / .7)
        fine_weight = 1 - _smooth((radial - 800) / 900)
        warping = _value_noise(east / 143 + 9, north / 143 - 4)
        first_joint = _value_noise((east + north * .31) / 49 + warping * .45,
                                   (north - east * .13) / 71)
        second_joint = _value_noise((east - north * .44) / 23 + 42,
                                    (north + east * .16) / 37 - 11)
        fractured = (1 - abs(first_joint)) ** 1.65 - .53
        relief = _value_noise(east / 131, north / 163) * 9 + fractured * 23
        relief += second_joint * 4.2 * fine_weight
        measured += detail_blend * exposure * relief
    return measured


def _value_noise(horizontal, depth):
    left, near = math.floor(horizontal), math.floor(depth)
    fraction_x, fraction_y = horizontal - left, depth - near
    fraction_x = fraction_x ** 3 * (fraction_x * (fraction_x * 6 - 15) + 10)
    fraction_y = fraction_y ** 3 * (fraction_y * (fraction_y * 6 - 15) + 10)
    values = []
    for offset_x, offset_y in ((0, 0), (1, 0), (0, 1), (1, 1)):
        hashed = math.sin((left + offset_x) * 127.1 + (near + offset_y) * 311.7) * 43758.5453123
        values.append((hashed - math.floor(hashed)) * 2 - 1)
    front = values[0] * (1 - fraction_x) + values[1] * fraction_x
    back = values[2] * (1 - fraction_x) + values[3] * fraction_x
    return front * (1 - fraction_y) + back * fraction_y


def _surface_properties(tile, geometry, east, north):
    delta = 1.5 + 3.5 * _smooth((max(abs(east), abs(north)) - 80) / 220)
    slope_x = (_blend_height(tile, geometry, east + delta, north) - _blend_height(tile, geometry, east - delta, north)) / (delta * 2)
    slope_y = (_blend_height(tile, geometry, east, north + delta) - _blend_height(tile, geometry, east, north - delta)) / (delta * 2)
    magnitude = math.sqrt(1 + slope_x * slope_x + slope_y * slope_y)
    normal = (-slope_x / magnitude, -slope_y / magnitude, 1 / magnitude)
    slope = math.hypot(slope_x, slope_y)
    deposition = _smooth((1.18 - slope) / .88)
    concavity = (_blend_height(tile, geometry, east + delta * 2, north)
                 + _blend_height(tile, geometry, east - delta * 2, north)
                 + _blend_height(tile, geometry, east, north + delta * 2)
                 + _blend_height(tile, geometry, east, north - delta * 2)
                 - 4 * _blend_height(tile, geometry, east, north)) / (delta * 4)
    deposit_gain = max(-.18, min(.23, concavity * .32))
    aspect = (slope_x * .79 + slope_y * .61) / max(.2, slope)
    patchiness = _value_noise(east / 61 + 19, north / 83 - 7)
    patchiness += .45 * _value_noise((east + north * .47) / 27, (north - east * .29) / 39)
    wind = .73 - aspect * .16 + patchiness * .33
    snow = max(0, min(1, deposition * wind + deposit_gain))
    local_snow = 1 - _smooth((math.hypot(east, north) - 42) / 80)
    snow = snow * (1 - local_snow) + local_snow
    return normal, snow


def _boundary_point(index, radius, segments=200):
    side, fraction = divmod(index, segments)
    offset = fraction / segments * 2 - 1
    if side == 0:
        return radius, offset * radius
    if side == 1:
        return -offset * radius, radius
    if side == 2:
        return -radius, -offset * radius
    return offset * radius, -radius


def _terrain_boundary_point(index, radius):
    east, north = _boundary_point(index, radius)
    if radius <= DEM_INNER_EXTENT:
        return east, north
    fraction = (radius - DEM_INNER_EXTENT) / (OUTER_RADIUS - DEM_INNER_EXTENT)
    west, eastern, south, northern = DEM_OUTER_BOUNDS
    width = DEM_INNER_EXTENT + fraction * ((eastern if east >= 0 else -west) - DEM_INNER_EXTENT)
    depth = DEM_INNER_EXTENT + fraction * ((northern if north >= 0 else -south) - DEM_INNER_EXTENT)
    return east / radius * width, north / radius * depth


def _build_geometry(tile, geometry):
    radii = [INNER_RADIUS, 36, 38, 40, 42, 45, 48, 52, 56, 60, 65, 70, 76, 82, 90, 100, 110]
    radii += list(range(120, 1001, 5)) + list(range(1010, DEM_INNER_EXTENT, 15)) + [DEM_INNER_EXTENT]
    radii += list(range(DEM_INNER_EXTENT + 100, OUTER_RADIUS + 1, 100))
    if radii[-1] != OUTER_RADIUS:
        radii.append(OUTER_RADIUS)
    vertices, faces, surface_values = [], [], []
    ring_size = 800
    for radius in radii:
        for index in range(ring_size):
            east, north = _terrain_boundary_point(index, radius)
            height = _blend_height(tile, geometry, east, north)
            vertices.append((east, north, height))
            surface_values.append(_surface_properties(tile, geometry, east, north))
    for ring in range(len(radii) - 1):
        for index in range(ring_size):
            following = (index + 1) % ring_size
            inner, next_inner = ring * ring_size + index, ring * ring_size + following
            outer, next_outer = (ring + 1) * ring_size + index, (ring + 1) * ring_size + following
            faces.extend(((inner, outer, next_outer), (inner, next_outer, next_inner)))
    perimeter = (len(radii) - 1) * ring_size
    skirt_start = len(vertices)
    floor = min(vertex[2] for vertex in vertices) - 900
    for index in range(ring_size):
        east, north, height = vertices[perimeter + index]
        vertices.append((east, north, floor))
        surface_values.append(((0, 0, 1), 0))
    for index in range(ring_size):
        following = (index + 1) % ring_size
        faces.append((perimeter + index, skirt_start + index, skirt_start + following, perimeter + following))
    if any(not math.isfinite(value) for vertex in vertices for value in vertex):
        raise ValueError('Non-finite DEM geometry')
    return vertices, faces, surface_values


def _triplanar_rock_channels(nodes, links, geometry, coordinates, images):
    normal_axes = nodes.new('ShaderNodeSeparateXYZ')
    links.new(geometry.outputs['Normal'], normal_axes.inputs[0])
    position_axes = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coordinates, position_axes.inputs[0])
    def operation(kind, first, second=None):
        node = nodes.new('ShaderNodeMath')
        node.operation = kind
        for index, value in enumerate((first, second)):
            if value is None:
                continue
            if isinstance(value, (float, int)):
                node.inputs[index].default_value = value
            else:
                links.new(value, node.inputs[index])
        return node.outputs[0]
    signs, weights = [], []
    for axis in range(3):
        signs.append(operation('SIGN', normal_axes.outputs[axis]))
        weights.append(operation('POWER', operation('ABSOLUTE', normal_axes.outputs[axis]), 4))
    total = operation('ADD', operation('ADD', weights[0], weights[1]), weights[2])
    weights = [operation('DIVIDE', weight, total) for weight in weights]
    results = {'diff': [], 'rough': [], 'normal': []}
    for axis in range(3):
        uv = nodes.new('ShaderNodeCombineXYZ')
        tangent_sign = operation('MULTIPLY', signs[axis], -1 if axis == 1 else 1)
        horizontal = position_axes.outputs[1] if axis == 0 else position_axes.outputs[0]
        vertical = position_axes.outputs[1] if axis == 2 else position_axes.outputs[2]
        links.new(operation('MULTIPLY', horizontal, tangent_sign), uv.inputs['X'])
        links.new(vertical, uv.inputs['Y'])
        for suffix, image in images.items():
            texture = nodes.new('ShaderNodeTexImage')
            texture.name = 'Aligned physical triplanar rock ' + suffix + ' axis ' + str(axis)
            texture.image = image
            links.new(uv.outputs[0], texture.inputs['Vector'])
            vector = texture.outputs['Color']
            if suffix == 'nor':
                decoded = nodes.new('ShaderNodeVectorMath')
                decoded.operation = 'MULTIPLY_ADD'
                decoded.inputs[1].default_value = (2, 2, 2)
                decoded.inputs[2].default_value = (-1, -1, -1)
                links.new(vector, decoded.inputs[0])
                components = nodes.new('ShaderNodeSeparateXYZ')
                links.new(decoded.outputs[0], components.inputs[0])
                converted = nodes.new('ShaderNodeCombineXYZ')
                tangent = operation('MULTIPLY', components.outputs['X'], tangent_sign)
                facing = operation('MULTIPLY', components.outputs['Z'], signs[axis])
                values = (facing, tangent, components.outputs['Y']) if axis == 0 else (
                    (tangent, facing, components.outputs['Y']) if axis == 1 else (tangent, components.outputs['Y'], facing))
                for coordinate, value in enumerate(values):
                    links.new(value, converted.inputs[coordinate])
                facing_axis = nodes.new('ShaderNodeCombineXYZ')
                links.new(signs[axis], facing_axis.inputs[axis])
                deviation = nodes.new('ShaderNodeVectorMath')
                deviation.operation = 'SUBTRACT'
                links.new(converted.outputs[0], deviation.inputs[0])
                links.new(facing_axis.outputs[0], deviation.inputs[1])
                vector = deviation.outputs[0]
            weighted = nodes.new('ShaderNodeVectorMath')
            weighted.operation = 'SCALE'
            links.new(vector, weighted.inputs[0])
            links.new(weights[axis], weighted.inputs['Scale'])
            results['normal' if suffix == 'nor' else suffix].append(weighted.outputs[0])
    combined = {}
    for channel, values in results.items():
        first = nodes.new('ShaderNodeVectorMath')
        first.operation = 'ADD'
        links.new(values[0], first.inputs[0])
        links.new(values[1], first.inputs[1])
        second = nodes.new('ShaderNodeVectorMath')
        second.operation = 'ADD'
        links.new(first.outputs[0], second.inputs[0])
        links.new(values[2], second.inputs[1])
        combined[channel] = second.outputs[0]
    surface_normal = nodes.new('ShaderNodeVectorMath')
    surface_normal.operation = 'ADD'
    links.new(combined['normal'], surface_normal.inputs[0])
    links.new(geometry.outputs['Normal'], surface_normal.inputs[1])
    normalized = nodes.new('ShaderNodeVectorMath')
    normalized.operation = 'NORMALIZE'
    links.new(surface_normal.outputs[0], normalized.inputs[0])
    combined['normal'] = normalized.outputs[0]
    return combined


def _snow_rock_material(root):
    import bpy
    material = bpy.data.materials.new('Refinement/DEM slope snow and rock')
    material.use_nodes = True
    material['verified_dem_snow_rock'] = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = .83
    shader.inputs['Subsurface Weight'].default_value = .006
    shader.inputs['Subsurface Radius'].default_value = (.025, .04, .055)
    coordinates = nodes.new('ShaderNodeTexCoord')
    geometry_coordinates = nodes.new('ShaderNodeNewGeometry')
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = .075
    noise.inputs['Detail'].default_value = 5
    noise.inputs['Roughness'].default_value = .74
    links.new(geometry_coordinates.outputs['Position'], noise.inputs['Vector'])
    mask = nodes.new('ShaderNodeAttribute')
    mask.attribute_name = 'snowCoverage'
    deposition_mapping = nodes.new('ShaderNodeMapping')
    deposition_mapping.inputs['Scale'].default_value = (.65, 1.1, .82)
    deposition_mapping.inputs['Rotation'].default_value = (.17, -.28, .41)
    links.new(geometry_coordinates.outputs['Position'], deposition_mapping.inputs['Vector'])
    deposition_noise = nodes.new('ShaderNodeTexNoise')
    deposition_noise.inputs['Scale'].default_value = .12
    deposition_noise.inputs['Detail'].default_value = 5
    deposition_noise.inputs['Roughness'].default_value = .8
    links.new(deposition_mapping.outputs['Vector'], deposition_noise.inputs['Vector'])
    breakup = nodes.new('ShaderNodeMath')
    breakup.operation = 'MULTIPLY_ADD'
    breakup.inputs[1].default_value = .22
    breakup.inputs[2].default_value = -.11
    links.new(deposition_noise.outputs['Fac'], breakup.inputs[0])
    addition = nodes.new('ShaderNodeMath')
    addition.operation = 'ADD'
    links.new(mask.outputs['Fac'], addition.inputs[0])
    links.new(breakup.outputs[0], addition.inputs[1])
    coverage = nodes.new('ShaderNodeValToRGB')
    coverage.color_ramp.elements[0].position = .28
    coverage.color_ramp.elements[1].position = .73
    coverage.color_ramp.interpolation = 'EASE'
    links.new(addition.outputs[0], coverage.inputs['Fac'])
    rock_coordinates = nodes.new('ShaderNodeVectorMath')
    rock_coordinates.operation = 'SCALE'
    rock_coordinates.inputs['Scale'].default_value = 1 / 2.7
    links.new(geometry_coordinates.outputs['Position'], rock_coordinates.inputs[0])
    maps, rock_images = {}, {}
    for asset in ('snow_01', 'rock_face_03'):
        channels = [('nor', 'Non-Color'), ('rough', 'Non-Color')] if asset == 'snow_01' else [('diff', 'sRGB'), ('nor', 'Non-Color'), ('rough', 'Non-Color')]
        for suffix, color_space in channels:
            candidates = [base / asset / (asset + '_' + suffix + '_' + resolution + '.jpg')
                          for resolution in ('4k', '2k')
                          for base in (root / 'assets/life/textures/library', root / '.render-work/library')]
            source = next((candidate for candidate in candidates if candidate.is_file()), None)
            if not source:
                raise FileNotFoundError('Missing verified PBR channel: ' + asset + '/' + suffix)
            image = bpy.data.images.load(str(source), check_existing=True)
            image.colorspace_settings.name = color_space
            if asset == 'rock_face_03':
                rock_images[suffix] = image
                continue
            texture = nodes.new('ShaderNodeTexImage')
            texture.image = image
            links.new(coordinates.outputs['UV'], texture.inputs['Vector'])
            maps[(asset, suffix)] = texture.outputs['Color']
    rock_channels = _triplanar_rock_channels(nodes, links, geometry_coordinates,
                                           rock_coordinates.outputs['Vector'], rock_images)
    camera_data = nodes.new('ShaderNodeCameraData')
    texture_lod = nodes.new('ShaderNodeMapRange')
    texture_lod.name = 'Distance-filtered scanned rock repeat suppression'
    texture_lod.inputs['From Min'].default_value = 45
    texture_lod.inputs['From Max'].default_value = 210
    texture_lod.inputs['To Min'].default_value = 1
    texture_lod.inputs['To Max'].default_value = 0
    links.new(camera_data.outputs['View Distance'], texture_lod.inputs['Value'])
    desaturated_rock = nodes.new('ShaderNodeHueSaturation')
    desaturated_rock.inputs['Saturation'].default_value = .12
    links.new(rock_channels['diff'], desaturated_rock.inputs['Color'])
    filtered_color = nodes.new('ShaderNodeMixRGB')
    filtered_color.name = 'Slate rock macro albedo beyond texture-resolvable range'
    filtered_color.inputs[1].default_value = (.21, .225, .235, 1)
    links.new(texture_lod.outputs['Result'], filtered_color.inputs[0])
    links.new(desaturated_rock.outputs[0], filtered_color.inputs[2])
    filtered_roughness = nodes.new('ShaderNodeMixRGB')
    filtered_roughness.inputs[1].default_value = (.88, .88, .88, 1)
    links.new(texture_lod.outputs['Result'], filtered_roughness.inputs[0])
    links.new(rock_channels['rough'], filtered_roughness.inputs[2])
    maps[('rock_face_03', 'diff')] = filtered_color.outputs[0]
    maps[('rock_face_03', 'rough')] = filtered_roughness.outputs[0]
    macro_tint = nodes.new('ShaderNodeValToRGB')
    macro_tint.color_ramp.elements[0].color = (.22, .25, .29, 1)
    macro_tint.color_ramp.elements[1].color = (.60, .61, .59, 1)
    links.new(noise.outputs['Fac'], macro_tint.inputs['Fac'])
    rock_color = nodes.new('ShaderNodeMixRGB')
    rock_color.blend_type = 'MULTIPLY'
    rock_color.inputs[0].default_value = 1
    links.new(maps[('rock_face_03', 'diff')], rock_color.inputs[1])
    links.new(macro_tint.outputs['Color'], rock_color.inputs[2])
    snow_color = nodes.new('ShaderNodeValToRGB')
    snow_color.color_ramp.elements[0].color = (.62, .68, .74, 1)
    snow_color.color_ramp.elements[1].color = (.79, .84, .88, 1)
    links.new(noise.outputs['Fac'], snow_color.inputs['Fac'])
    mix = nodes.new('ShaderNodeMixRGB')
    links.new(coverage.outputs['Color'], mix.inputs[0])
    links.new(rock_color.outputs[0], mix.inputs[1])
    links.new(snow_color.outputs['Color'], mix.inputs[2])
    links.new(mix.outputs[0], shader.inputs['Base Color'])
    roughness = nodes.new('ShaderNodeMixRGB')
    links.new(coverage.outputs['Color'], roughness.inputs[0])
    links.new(maps[('rock_face_03', 'rough')], roughness.inputs[1])
    links.new(maps[('snow_01', 'rough')], roughness.inputs[2])
    links.new(roughness.outputs[0], shader.inputs['Roughness'])
    snow_normal = nodes.new('ShaderNodeMixRGB')
    snow_normal.inputs[0].default_value = .65
    snow_normal.inputs[1].default_value = (.5, .5, 1, 1)
    links.new(maps[('snow_01', 'nor')], snow_normal.inputs[2])
    snow_normal_node = nodes.new('ShaderNodeNormalMap')
    snow_normal_node.inputs['Strength'].default_value = .65
    links.new(snow_normal.outputs[0], snow_normal_node.inputs['Color'])
    normal_fade = nodes.new('ShaderNodeMapRange')
    normal_fade.inputs['From Min'].default_value = 30
    normal_fade.inputs['From Max'].default_value = 220
    normal_fade.inputs['To Min'].default_value = .35
    normal_fade.inputs['To Max'].default_value = 0
    links.new(camera_data.outputs['View Distance'], normal_fade.inputs['Value'])
    rock_normal = nodes.new('ShaderNodeMixRGB')
    links.new(normal_fade.outputs['Result'], rock_normal.inputs[0])
    links.new(geometry_coordinates.outputs['Normal'], rock_normal.inputs[1])
    links.new(rock_channels['normal'], rock_normal.inputs[2])
    normal_mix = nodes.new('ShaderNodeMixRGB')
    links.new(coverage.outputs['Color'], normal_mix.inputs[0])
    links.new(rock_normal.outputs[0], normal_mix.inputs[1])
    links.new(snow_normal_node.outputs['Normal'], normal_mix.inputs[2])
    normal_node = nodes.new('ShaderNodeVectorMath')
    normal_node.operation = 'NORMALIZE'
    links.new(normal_mix.outputs[0], normal_node.inputs[0])
    relief = nodes.new('ShaderNodeMath')
    relief.operation = 'MULTIPLY_ADD'
    relief.inputs[1].default_value = -.21
    relief.inputs[2].default_value = .23
    links.new(coverage.outputs['Color'], relief.inputs[0])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .44
    links.new(relief.outputs[0], bump.inputs['Distance'])
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(normal_node.outputs[0], bump.inputs['Normal'])
    joint_coordinates = nodes.new('ShaderNodeMapping')
    joint_coordinates.inputs['Rotation'].default_value = (.61, -.34, .27)
    joint_coordinates.inputs['Scale'].default_value = (1, .72, 1.8)
    links.new(geometry_coordinates.outputs['Position'], joint_coordinates.inputs['Vector'])
    joints = nodes.new('ShaderNodeTexNoise')
    joints.name = 'Irregular weathered rock relief without cellular seams'
    joints.inputs['Scale'].default_value = .21
    joints.inputs['Detail'].default_value = 5
    joints.inputs['Roughness'].default_value = .68
    joints.inputs['Distortion'].default_value = .3
    links.new(joint_coordinates.outputs['Vector'], joints.inputs['Vector'])
    rock_relief = nodes.new('ShaderNodeMapRange')
    rock_relief.inputs['From Min'].default_value = 0
    rock_relief.inputs['From Max'].default_value = 1
    links.new(joints.outputs['Fac'], rock_relief.inputs['Value'])
    joint_distance = nodes.new('ShaderNodeMath')
    joint_distance.operation = 'MULTIPLY_ADD'
    joint_distance.inputs[1].default_value = -.23
    joint_distance.inputs[2].default_value = .23
    links.new(coverage.outputs['Color'], joint_distance.inputs[0])
    joint_bump = nodes.new('ShaderNodeBump')
    joint_bump.inputs['Strength'].default_value = .20
    links.new(joint_distance.outputs[0], joint_bump.inputs['Distance'])
    links.new(rock_relief.outputs['Result'], joint_bump.inputs['Height'])
    links.new(bump.outputs['Normal'], joint_bump.inputs['Normal'])
    wind_coordinates = nodes.new('ShaderNodeMapping')
    wind_coordinates.inputs['Scale'].default_value = (.2, 1, 1)
    wind_coordinates.inputs['Rotation'].default_value = (0, 0, .35)
    links.new(geometry_coordinates.outputs['Position'], wind_coordinates.inputs['Vector'])
    wind_noise = nodes.new('ShaderNodeTexNoise')
    wind_noise.inputs['Scale'].default_value = 2.4
    wind_noise.inputs['Detail'].default_value = 3
    links.new(wind_coordinates.outputs['Vector'], wind_noise.inputs['Vector'])
    wind_bump = nodes.new('ShaderNodeBump')
    wind_bump.inputs['Strength'].default_value = .5
    wind_bump.inputs['Distance'].default_value = .035
    links.new(wind_noise.outputs['Fac'], wind_bump.inputs['Height'])
    links.new(joint_bump.outputs['Normal'], wind_bump.inputs['Normal'])
    crystal = nodes.new('ShaderNodeTexNoise')
    crystal.inputs['Scale'].default_value = 290
    crystal.inputs['Detail'].default_value = 2
    links.new(geometry_coordinates.outputs['Position'], crystal.inputs['Vector'])
    grain = nodes.new('ShaderNodeBump')
    grain.inputs['Strength'].default_value = .14
    grain.inputs['Distance'].default_value = .0009
    links.new(crystal.outputs['Fac'], grain.inputs['Height'])
    links.new(wind_bump.outputs['Normal'], grain.inputs['Normal'])
    links.new(grain.outputs['Normal'], shader.inputs['Normal'])
    return material


def _surface_attributes(mesh, vertices, tile, geometry, surface_values=None):
    coordinates = mesh.uv_layers.active or mesh.uv_layers.new(name='World-scale UV')
    for loop in mesh.loops:
        vertex = vertices[loop.vertex_index]
        coordinates.data[loop.index].uv = (vertex[0] / 3.5, -vertex[1] / 3.5)
    coverage = mesh.attributes.get('snowCoverage') or mesh.attributes.new('snowCoverage', 'FLOAT', 'POINT')
    normals = []
    for index, vertex in enumerate(vertices):
        normal, snow = surface_values[index] if surface_values is not None else _surface_properties(tile, geometry, vertex[0], vertex[1])
        normals.append(normal)
        coverage.data[index].value = snow
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.normals_split_custom_set_from_vertices(normals)


def _snow_formations():
    generator = random.Random(650137)
    return [(generator.uniform(-29, 29), generator.uniform(-29, 29),
             generator.uniform(1.8, 6.5), generator.uniform(.34, .72),
             generator.uniform(.035, .15), generator.uniform(-.22, .22))
            for index in range(175)]


def _snow_crust_formations():
    generator = random.Random(792103)
    formations = []
    for attempt in range(1650):
        east, north = generator.uniform(-30, 30), generator.uniform(-30, 30)
        density = min(.82, max(.12, .49 + _value_noise(east / 5.3, north / 4.1) * .49))
        if generator.random() > density:
            continue
        angle = .35 + generator.uniform(-1.05, 1.05)
        formations.append((east, north, math.cos(angle), math.sin(angle),
                           generator.uniform(.48, 1.06), generator.uniform(.29, .56),
                           generator.uniform(.008, .033), generator.uniform(-.27, .27),
                           generator.uniform(-.28, .28), generator.uniform(-.32, .32)))
    return formations


def _snow_crust_relief(east, north, formations):
    height = 0
    for center_x, center_y, cosine, sine, half_length, half_width, amplitude, skew, tilt, notch in formations:
        offset_x, offset_y = east - center_x, north - center_y
        along = offset_x * cosine + offset_y * sine
        across = -offset_x * sine + offset_y * cosine
        if abs(along) > half_length + .38 or abs(across) > half_width + .65:
            continue
        diagonal = across - skew * along
        end_distance = half_length - abs(along)
        front_distance = half_width - diagonal
        back_distance = half_width + diagonal
        ends = _smooth(end_distance / (SNOW_CRUST_TRANSITION * 1.3))
        front = _smooth(front_distance / SNOW_CRUST_TRANSITION)
        back = _smooth(back_distance / (SNOW_CRUST_TRANSITION * 1.8))
        fracture = math.exp(-((along - notch) / .30) ** 2)
        front = _smooth((front_distance - fracture * .105) / SNOW_CRUST_TRANSITION)
        slab = ends * front * back * (1 + tilt * along / half_length)
        lee_scoop = .16 * math.exp(-((front_distance + .18) / .24) ** 2) * ends
        height += amplitude * (slab - lee_scoop)
    return height


def _snow_relief(east, north, formations, crusts=()):
    boundary = _smooth((INNER_RADIUS - max(abs(east), abs(north))) / 5)
    if boundary == 0:
        return 0
    height = .014 * _value_noise(east / 1.4, north / 2.7)
    height += .032 * _value_noise(east / 6.5 + 4, north / 8.2 - 3)
    height += .009 * _value_noise(east / .62, north / 1.1)
    for center_x, center_y, length, width, amplitude, rotation in formations:
        angle = .35 + rotation
        offset_x, offset_y = east - center_x, north - center_y
        along = (offset_x * math.cos(angle) + offset_y * math.sin(angle)) / length
        if abs(along) > 1.65:
            continue
        across = (-offset_x * math.sin(angle) + offset_y * math.cos(angle)) / width
        across -= .33 * math.sin(along * 2.1 + center_x) + .11 * math.sin(along * 5.7 + center_y)
        if not -3.4 < across < 2.4:
            continue
        crest = math.exp(-across * across * (3 if across > 0 else .47))
        taper = _smooth((1.65 - abs(along)) / .8)
        eroded = .16 * math.exp(-((across - .8) / .55) ** 2)
        height += amplitude * (crest - eroded) * taper
    height += _snow_crust_relief(east, north, crusts)
    return height * boundary


def _sculpt_snow_foreground(mesh, descriptor, tile, geometry):
    import bmesh
    observation = descriptor['observation']['position']
    original_boundary = {(round(vertex.co.x, 5), round(vertex.co.y, 5)): vertex.co.z
                         for vertex in mesh.vertices
                         if max(abs(vertex.co.x), abs(vertex.co.y)) >= INNER_RADIUS - .001}
    topology = bmesh.new()
    topology.from_mesh(mesh)
    bmesh.ops.subdivide_edges(topology, edges=list(topology.edges),
                              cuts=SNOW_FOREGROUND_SUBDIVISION - 1, use_grid_fill=True)
    topology.to_mesh(mesh)
    topology.free()
    mesh.update()
    formations = _snow_formations()
    crusts = _snow_crust_formations()
    observation_relief = _snow_relief(observation[0], -observation[2], formations, crusts)
    lookup = {}
    for formation in formations:
        center_x, center_y, length, width, amplitude, rotation = formation
        extent = length * 1.7 + width * 3.5
        for column in range(math.floor((center_x - extent) / 4), math.floor((center_x + extent) / 4) + 1):
            for row in range(math.floor((center_y - extent) / 4), math.floor((center_y + extent) / 4) + 1):
                lookup.setdefault((column, row), []).append(formation)
    crust_lookup = {}
    for crust in crusts:
        center_x, center_y, cosine, sine, half_length, half_width, amplitude, skew, tilt, notch = crust
        extent = half_length + half_width + 1.05
        for column in range(math.floor((center_x - extent) / 2), math.floor((center_x + extent) / 2) + 1):
            for row in range(math.floor((center_y - extent) / 2), math.floor((center_y + extent) / 2) + 1):
                crust_lookup.setdefault((column, row), []).append(crust)
    displacements = []
    for vertex in mesh.vertices:
        local_formations = lookup.get((math.floor(vertex.co.x / 4), math.floor(vertex.co.y / 4)), [])
        local_crusts = crust_lookup.get((math.floor(vertex.co.x / 2), math.floor(vertex.co.y / 2)), [])
        boundary = _smooth((INNER_RADIUS - max(abs(vertex.co.x), abs(vertex.co.y))) / 5)
        relief = _snow_relief(vertex.co.x, vertex.co.y, local_formations, local_crusts) - observation_relief * boundary
        vertex.co.z = _blend_height(tile, geometry, vertex.co.x, vertex.co.y) + relief
        displacements.append(relief)
    mesh.update()
    remaining_boundary = {(round(vertex.co.x, 5), round(vertex.co.y, 5)): vertex.co.z
                          for vertex in mesh.vertices
                          if max(abs(vertex.co.x), abs(vertex.co.y)) >= INNER_RADIUS - .001}
    if any(position not in remaining_boundary or abs(height - remaining_boundary[position]) > .0001
           for position, height in original_boundary.items()):
        raise ValueError('Snow detail refinement modified the original DEM boundary')
    mesh.normals_split_custom_set_from_vertices([
        _surface_properties(tile, geometry, vertex.co.x, vertex.co.y)[0]
        if max(abs(vertex.co.x), abs(vertex.co.y)) >= INNER_RADIUS - .001 else (0, 0, 0)
        for vertex in mesh.vertices])
    spacing = INNER_RADIUS * 2 / (200 * SNOW_FOREGROUND_SUBDIVISION)
    if SNOW_CRUST_TRANSITION / spacing < 4:
        raise ValueError('Snow crust transition is narrower than four mesh intervals')
    return {'formations': len(formations), 'crust_formations': len(crusts),
            'maximum_height_metres': max(displacements),
            'minimum_height_metres': min(displacements), 'surface_vertices': len(mesh.vertices),
            'nominal_grid_spacing_metres': spacing,
            'minimum_crust_transition_metres': SNOW_CRUST_TRANSITION,
            'minimum_crust_transition_grid_intervals': SNOW_CRUST_TRANSITION / spacing,
            'minimum_steep_crest_efold_width_metres': .34 / math.sqrt(3),
            'original_boundary_vertices_preserved': len(original_boundary),
            'observation_relief_offset_metres': observation_relief,
            'circular_support_masks_removed': True,
            'displaced_vertices': sum(abs(value) > .001 for value in displacements)}


def refine(scene, descriptor, asset_root=None):
    if descriptor.get('scene') != 'snowmountain':
        return {'skipped': True, 'reason': 'not snowmountain'}
    import bpy
    root = Path(asset_root) if asset_root else Path(__file__).resolve().parent.parent
    source = root / '.render-work/terrain/N27E086.hgt.gz'
    if not source.is_file():
        raise FileNotFoundError('Run scripts/fetch-terrain-source.cjs first: ' + str(source))
    if any(instance.get('verified_dem_source') == SOURCE_SHA256 for instance in scene.objects):
        return {'skipped': True, 'reason': 'already refined'}
    geometry = _descriptor_geometry(descriptor)
    candidates = []
    for instance in scene.objects:
        if instance.type != 'MESH' or len(instance.data.vertices) != 221 * 221:
            continue
        corners = [instance.matrix_world @ vertex.co for vertex in instance.data.vertices]
        if abs(min(corner.x for corner in corners) + 750) < .001 and abs(max(corner.x for corner in corners) - 750) < .001 and abs(min(corner.y for corner in corners) + 750) < .001 and abs(max(corner.y for corner in corners) - 750) < .001:
            candidates.append(instance)
    if len(candidates) != 1:
        raise ValueError('Could not uniquely identify the imported far terrain; no changes made')
    original = candidates[0]
    for index, vertex in enumerate(original.data.vertices):
        expected = geometry['positions'][index * 3:index * 3 + 3]
        actual = original.matrix_world @ vertex.co
        if max(abs(actual.x - expected[0]), abs(actual.y + expected[2]), abs(actual.z - expected[1])) > .0001:
            raise ValueError('Imported terrain does not exactly match its descriptor; no changes made')
    near = [instance for instance in scene.objects if instance.type == 'MESH' and len(instance.data.vertices) == 201 * 201]
    if len(near) != 1:
        raise ValueError('Expected one unchanged near terrain patch; no changes made')
    near_geometry = next(item for item in descriptor['geometry'] if len(item.get('positions', [])) == 40401 * 3)
    near_original = [near[0].matrix_world @ vertex.co for vertex in near[0].data.vertices]
    for index, actual in enumerate(near_original):
        expected = near_geometry['positions'][index * 3:index * 3 + 3]
        if max(abs(actual.x - expected[0]), abs(actual.y + expected[2]), abs(actual.z - expected[1])) > .0001:
            raise ValueError('Imported foreground does not exactly match its descriptor; no changes made')
    tile = HeightTile(source)
    observation = descriptor['observation']['position']
    tile.observation_ground = (observation[0], -observation[2])
    tile.observation_offset = tile.relative(*tile.observation_ground)
    vertices, faces, surface_values = _build_geometry(tile, geometry)
    near_vertices = [(vertex.x, vertex.y, _blend_height(tile, geometry, vertex.x, vertex.y)) for vertex in near_original]
    near_boundary = {(round(vertex[0], 4), round(vertex[1], 4)): vertex[2] for vertex in near_vertices
                     if abs(max(abs(vertex[0]), abs(vertex[1])) - INNER_RADIUS) < .0001}
    observation_error = abs(_blend_height(tile, geometry, *tile.observation_ground))
    if observation_error > .0001:
        raise ValueError('Measured terrain changes observation ground height: ' + str(observation_error))
    seam_error = 0
    for east, north, height in vertices[:800]:
        key = (round(east, 4), round(north, 4))
        if key not in near_boundary:
            raise ValueError('DEM boundary does not coincide with the authored foreground')
        seam_error = max(seam_error, abs(height - near_boundary[key]))
    if seam_error > .0001:
        raise ValueError('DEM-to-foreground seam exceeds 0.1 mm: ' + str(seam_error))
    mesh = bpy.data.meshes.new('Refinement/verified Everest DEM geometry')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    _surface_attributes(mesh, vertices, tile, geometry, surface_values)
    surface_material = _snow_rock_material(root)
    mesh.materials.append(surface_material)
    foreground_mesh = near[0].data.copy()
    foreground_mesh.name = 'Refinement/continuous measured-terrain foreground'
    inverse = near[0].matrix_world.inverted()
    from mathutils import Vector
    for vertex, position in zip(foreground_mesh.vertices, near_vertices):
        vertex.co = inverse @ Vector(position)
    foreground_mesh.update()
    _surface_attributes(foreground_mesh, near_vertices, tile, geometry)
    foreground_mesh.materials.clear()
    foreground_mesh.materials.append(surface_material)
    snow_relief = _sculpt_snow_foreground(foreground_mesh, descriptor, tile, geometry)
    near[0].data = foreground_mesh
    near[0]['verified_dem_walking_platform'] = True
    near[0]['verified_dem_measured_terrain'] = True
    instance = bpy.data.objects.new('Refinement/Everest-region measured terrain', mesh)
    scene.collection.objects.link(instance)
    instance['verified_dem_source'] = SOURCE_SHA256
    instance['anchor_latitude'] = ANCHOR_LATITUDE
    instance['anchor_longitude'] = ANCHOR_LONGITUDE
    instance['anchor_height'] = tile.anchor_height
    instance['vertical_exaggeration'] = 1.0
    instance['attribution'] = 'Mapzen Terrain Tiles; SRTM/GMTED2010 courtesy USGS; artistically recentered and foreground-blended; not for navigation'
    original.hide_render = True
    original.hide_set(True)
    original['replaced_by_verified_dem'] = True
    result = {'vertices': len(vertices), 'faces': len(faces), 'anchor_height': tile.anchor_height,
              'original_hidden': original.name, 'near_rebuilt': near[0].name,
              'bounds_metres': DEM_OUTER_BOUNDS,
              'interpolation': 'monotone cubic with original height samples preserved',
              'seam_error_metres': seam_error, 'observation_ground_error_metres': observation_error,
              'dem_transition_metres': [0, 0],
              'outer_dem_height_clipping': False, 'authored_summit_shoulder': False,
              'observation_offset_metres': tile.observation_offset,
              'decorative_snow_relief': snow_relief,
              'maximum_foreground_height_change': max(abs(vertex[2] - original.z) for vertex, original in zip(near_vertices, near_original))}
    print('DEM_REFINEMENT', result)
    return result


def _scanned_outcrop_point(point, bottom, height):
    fraction = (point[2] - bottom) / height
    taper = 1 - .48 * _smooth((fraction - .35) / .65)
    return (-18 + (point[0] + 18) * .53 * taper,
            -8 + (point[1] + 8) * .68 * taper,
            (point[2] - bottom) * .38 - 1.2)


def _weather_scanned_outcrop(instance):
    import bpy
    from mathutils import Matrix, Vector
    from mathutils.bvhtree import BVHTree
    mesh = instance.data.copy()
    mesh.transform(instance.matrix_world)
    bottom = min(vertex.co.z for vertex in mesh.vertices)
    height = max(vertex.co.z for vertex in mesh.vertices) - bottom
    for vertex in mesh.vertices:
        vertex.co = _scanned_outcrop_point(vertex.co, bottom, height)
    mesh.update()
    mesh.normals_split_custom_set_from_vertices([(0, 0, 0)] * len(mesh.vertices))
    surface = BVHTree.FromPolygons([vertex.co for vertex in mesh.vertices],
                                  [tuple(polygon.vertices) for polygon in mesh.polygons])
    coverage_attribute = mesh.attributes.new('summitRockSnow', 'FLOAT', 'POINT')
    exposed_vertices = 0
    for vertex in mesh.vertices:
        slope = _smooth((vertex.normal.z - .55) / .35)
        hit = surface.ray_cast(vertex.co + Vector((0, 0, .012)), Vector((0, 0, 1)), 12)[0] if slope else None
        coverage_attribute.data[vertex.index].value = slope if hit is None else 0
        exposed_vertices += bool(slope and hit is None)
    instance.data = mesh
    instance.parent = None
    instance.matrix_world = Matrix.Identity(4)
    for slot in instance.material_slots:
        if slot.material is None:
            continue
        material = slot.material.copy()
        material.name = 'Refinement/snow-settled scanned summit face'
        nodes, links = material.node_tree.nodes, material.node_tree.links
        rock = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
        output = next(node for node in nodes if node.type == 'OUTPUT_MATERIAL')
        for node in nodes:
            if node.type == 'NORMAL_MAP':
                node.inputs['Strength'].default_value = .32
        base = rock.inputs['Base Color']
        if base.is_linked:
            source = base.links[0].from_socket
            tint = nodes.new('ShaderNodeHueSaturation')
            tint.inputs['Saturation'].default_value = .16
            tint.inputs['Value'].default_value = 1.12
            links.new(source, tint.inputs['Color'])
            links.new(tint.outputs[0], base)
        for name, value in [('Roughness', .89), ('Metallic', 0), ('Coat Weight', 0)]:
            for link in list(rock.inputs[name].links):
                links.remove(link)
            rock.inputs[name].default_value = value
        geometry = nodes.new('ShaderNodeNewGeometry')
        normal = nodes.new('ShaderNodeSeparateXYZ')
        links.new(geometry.outputs['True Normal'], normal.inputs[0])
        slope = nodes.new('ShaderNodeMapRange')
        slope.inputs['From Min'].default_value = .55
        slope.inputs['From Max'].default_value = .90
        slope.clamp = True
        links.new(normal.outputs['Z'], slope.inputs['Value'])
        deposition = nodes.new('ShaderNodeTexNoise')
        deposition.inputs['Scale'].default_value = 2.6
        deposition.inputs['Detail'].default_value = 3
        links.new(geometry.outputs['Position'], deposition.inputs['Vector'])
        patch = nodes.new('ShaderNodeMapRange')
        patch.inputs['From Min'].default_value = .30
        patch.inputs['From Max'].default_value = .66
        patch.inputs['To Min'].default_value = .67
        patch.clamp = True
        links.new(deposition.outputs['Fac'], patch.inputs['Value'])
        coverage = nodes.new('ShaderNodeMath')
        coverage.operation = 'MULTIPLY'
        links.new(slope.outputs['Result'], coverage.inputs[0])
        links.new(patch.outputs['Result'], coverage.inputs[1])
        sky_exposure = nodes.new('ShaderNodeAttribute')
        sky_exposure.attribute_name = 'summitRockSnow'
        sheltered = nodes.new('ShaderNodeMath')
        sheltered.operation = 'MULTIPLY'
        links.new(coverage.outputs[0], sheltered.inputs[0])
        links.new(sky_exposure.outputs['Fac'], sheltered.inputs[1])
        snow = nodes.new('ShaderNodeBsdfPrincipled')
        snow.inputs['Base Color'].default_value = (.76, .81, .86, 1)
        snow.inputs['Roughness'].default_value = .87
        snow.inputs['Subsurface Weight'].default_value = .025
        snow.inputs['Subsurface Radius'].default_value = (.018, .026, .036)
        grain = nodes.new('ShaderNodeTexNoise')
        grain.inputs['Scale'].default_value = 48
        grain.inputs['Detail'].default_value = 2
        links.new(geometry.outputs['Position'], grain.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .24
        bump.inputs['Distance'].default_value = .006
        links.new(grain.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], snow.inputs['Normal'])
        mix = nodes.new('ShaderNodeMixShader')
        links.new(sheltered.outputs[0], mix.inputs[0])
        links.new(rock.outputs['BSDF'], mix.inputs[1])
        links.new(snow.outputs['BSDF'], mix.inputs[2])
        links.new(mix.outputs[0], output.inputs['Surface'])
        slot.material = material
    instance['scanned_outcrop_exposed_height_scale'] = .38
    instance['scanned_outcrop_old_base_removed_metres'] = bottom
    instance['scanned_outcrop_burial_metres'] = 1.2
    instance['scanned_outcrop_sky_exposed_snow_vertices'] = exposed_vertices
    instance['snow_deposition_follows_world_slope'] = True


def ground_props(scene, descriptor):
    import bpy
    from mathutils import Vector
    if descriptor.get('scene') != 'snowmountain':
        return {'skipped': True}
    surfaces = [instance for instance in scene.objects if instance.get('verified_dem_measured_terrain')]
    if len(surfaces) != 1:
        raise ValueError('Expected one rebuilt measured terrain surface before grounding equipment')
    surface = surfaces[0]
    inverse = surface.matrix_world.inverted()
    bpy.context.view_layer.update()

    def elevation(east, north):
        origin = inverse @ Vector((east, north, 250))
        direction = inverse.to_3x3() @ Vector((0, 0, -1))
        hit, position, normal, face = surface.ray_cast(origin, direction)
        if not hit:
            raise ValueError('Summit prop has no terrain contact: ' + str((east, north)))
        return (surface.matrix_world @ position).z

    observation = descriptor['observation']['position']
    ground_error = elevation(observation[0], -observation[2])
    if abs(ground_error) > .002:
        raise ValueError('Actual triangulated observation ground changed by more than 2 mm: ' + str(ground_error))
    movements = []
    pack_height, cairn_height = elevation(-6.8, -10), elevation(7.8, -4.6)
    pack_slope_x = (elevation(-6.56, -10) - elevation(-7.04, -10)) / .48
    pack_slope_y = (elevation(-6.8, -9.82) - elevation(-6.8, -10.18)) / .36
    pack_normal = Vector((-pack_slope_x, -pack_slope_y, 1)).normalized()
    from mathutils import Matrix
    pack_alignment = (Matrix.Translation((-6.8, -10, pack_height - .012))
                      @ Vector((0, 0, 1)).rotation_difference(pack_normal).to_matrix().to_4x4()
                      @ Matrix.Translation((6.8, 10, 0)))
    for instance in list(scene.objects):
        if instance.hide_render or instance.get('summit_grounded'):
            continue
        offset = None
        location = instance.matrix_world.translation
        if abs(location.x + 6.8) < .001 and abs(location.y + 10) < .001 and instance.name.startswith('Refinement/'):
            instance.matrix_world = pack_alignment @ instance.matrix_world
            instance['summit_grounded'] = True
            instance['snow_contact_embedding_metres'] = .012
            movements.append({'object': instance.name, 'pack_follows_surface_normal': list(pack_normal),
                              'compressed_snow_embedding_metres': .012})
            continue
        elif instance.name.startswith('NightWorld/') and math.hypot(location.x - 7.8, location.y + 4.6) < .8:
            offset = cairn_height
        elif instance.get('unique_eroded_summit_outcrop') is not None:
            bounds = [instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
            center_x = (min(point.x for point in bounds) + max(point.x for point in bounds)) * .5
            center_y = (min(point.y for point in bounds) + max(point.y for point in bounds)) * .5
            offset = elevation(center_x, center_y)
        elif instance.type == 'MESH' and any(material and material.name.lower().startswith('mountainside')
                                             for material in instance.data.materials):
            _weather_scanned_outcrop(instance)
            offset = elevation(-18, -8)
        elif instance.type == 'CURVE' and any(name in instance.name for name in
                                             ('fixed-line anchor', 'closed anchor eye', 'fixed line anchor hitch', 'irregular alpine fixed line')):
            curve_inverse = instance.matrix_world.inverted()
            for spline in instance.data.splines:
                for point in spline.points:
                    world = instance.matrix_world @ point.co.xyz
                    world.z += elevation(world.x, world.y)
                    point.co = tuple(curve_inverse @ world) + (point.co.w,)
            instance['summit_grounded'] = True
            movements.append({'object': instance.name, 'curve_follows_surface': True})
            continue
        if offset is not None:
            placement = instance.matrix_world.copy()
            placement.translation.z += offset
            instance.matrix_world = placement
            instance['summit_grounded'] = True
            movements.append({'object': instance.name, 'vertical_shift_metres': offset})
    bpy.context.view_layer.update()
    result = {'grounded_objects': len(movements), 'observation_ground_error_metres': ground_error,
              'camera_clearance_metres': observation[1] - ground_error, 'movements': movements}
    print('SUMMIT_GROUND_CONTACT', result)
    return result


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    tile = HeightTile(root / '.render-work/terrain/N27E086.hgt.gz')
    print({'source_verified': True, 'anchor_height': tile.anchor_height,
           'everest_reference_height': tile.sample(27.9881, 86.925)})
