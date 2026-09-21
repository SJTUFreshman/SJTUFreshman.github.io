"""Authored Scottish-highland landforms and foreground, for offline rendering."""
import math
import random
import runpy
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils import noise
from mathutils.bvhtree import BVHTree

INNER_RADIUS = 1500 / 220 * 5
ISLAND_CENTER = (-12, -8)
ISLAND_RADII = (66, 72)
RIDGES = [
    ([(-1400, -450), (-950, -80), (-720, 430), (-880, 950), (-430, 1720)], 260, 250),
    ([(1200, -650), (940, -50), (1150, 410), (860, 930), (1300, 1750)], 320, 320),
    ([(-1550, -1200), (-650, -950), (150, -1150), (950, -960), (1600, -1550)], 390, 165),
    ([(-1500, 1740), (-800, 1500), (150, 1740), (860, 1550), (1800, 1780)], 370, 275),
]


def _smooth(value):
    value = max(0, min(1, value))
    return value * value * (3 - 2 * value)


def _footpath_centerline():
    points = [(-.8 + .55 * math.sin((north + 8) / 5), north) for north in range(-22, 3, 2)]
    for first, control, last in [(points[-1], (-.30, 6.3), (8.5, 5.6)),
                                  ((8.5, 5.6), (17, 5), (11, -7)),
                                  ((11, -7), (8, -19), (-.8 + .55 * math.sin(-14 / 5), -22))]:
        for index in range(1, 21):
            fraction = index / 20
            points.append(tuple(first[axis] * (1 - fraction) ** 2 + control[axis] * 2 * fraction * (1 - fraction)
                                + last[axis] * fraction ** 2 for axis in (0, 1)))
    return points


FOOTPATH = _footpath_centerline()
FOOTPATH_SEGMENTS = [(first[0], first[1], last[0] - first[0], last[1] - first[1],
                     1 / ((last[0] - first[0]) ** 2 + (last[1] - first[1]) ** 2))
                    for first, last in zip(FOOTPATH[:-1], FOOTPATH[1:])]


def _footpath_distance(horizontal, north):
    minimum = math.inf
    for start_x, start_y, delta_x, delta_y, inverse_length_squared in FOOTPATH_SEGMENTS:
        across, along = horizontal - start_x, north - start_y
        fraction = max(0, min(1, (across * delta_x + along * delta_y) * inverse_length_squared))
        minimum = min(minimum, (across - delta_x * fraction) ** 2 + (along - delta_y * fraction) ** 2)
    return math.sqrt(minimum)


def _ridge_frame(horizontal, north, points):
    distance = math.inf
    along = 0
    chainage = 0
    across = 0
    for first, second in zip(points[:-1], points[1:]):
        delta_x, delta_y = second[0] - first[0], second[1] - first[1]
        length = math.hypot(delta_x, delta_y)
        fraction = max(0, min(1, ((horizontal - first[0]) * delta_x + (north - first[1]) * delta_y) / (length * length)))
        offset_x, offset_y = horizontal - first[0] - delta_x * fraction, north - first[1] - delta_y * fraction
        candidate = math.hypot(offset_x, offset_y)
        if candidate < distance:
            distance = candidate
            along = chainage + fraction * length
            across = (offset_x * -delta_y + offset_y * delta_x) / length
        chainage += length
    return distance, along, across


def _fractal(horizontal, north, scale, seed=0):
    value, amplitude = 0, 1
    for octave in range(4):
        value += amplitude * noise.noise(Vector((horizontal * scale, north * scale, seed + octave * 7.91)), noise_basis='PERLIN_NEW')
        scale *= 2.07
        amplitude *= .46
    return value


def _ridge(horizontal, north, points, width, height):
    distance, along, across = _ridge_frame(horizontal, north, points)
    summit_mass = noise.noise(Vector((along * .0027, 6.4, height * .013)), noise_basis='PERLIN_NEW')
    shoulder_mass = noise.noise(Vector((along * .0051, 19.7, width * .009)), noise_basis='PERLIN_NEW')
    height *= .94 + summit_mass * .35
    width *= 1 + shoulder_mass * .19 + math.tanh(across / (width * .4)) * .11
    form = height * math.exp(-((distance / width) ** 1.65))
    flank = _smooth(distance / (width * .23)) * math.exp(-((distance / (width * 1.2)) ** 2))
    warp = _fractal(along, across, .0031, 47) * 58
    drainage = noise.noise(Vector(((along + warp) * .017, across * .0019, 13.7)), noise_basis='PERLIN_NEW')
    tributary = noise.noise(Vector(((along + warp) * .041, across * .0041, 29.3)), noise_basis='PERLIN_NEW')
    erosion = math.exp(-((drainage / .19) ** 2)) * height * .051
    erosion += math.exp(-((tributary / .15) ** 2)) * height * .020
    shoulder = _fractal(horizontal, north, .018, 71) * height * .032
    crest_noise = noise.noise(Vector(((along + warp) * .0105, across * .0065, 83.4)), noise_basis='PERLIN_NEW')
    crest_noise_2 = noise.noise(Vector(((along + warp) * .024, across * .014, 91.8)), noise_basis='PERLIN_NEW')
    crest = max(0, crest_noise * .72 + crest_noise_2 * .28) ** 2 * height * .25
    crest *= math.exp(-((distance / (width * .58)) ** 2))
    gullies = max(0, tributary * .5 + drainage * .3 + .10) * height * .028
    gullies *= math.exp(-((distance / (width * .82)) ** 1.5))
    return form + flank * (shoulder - erosion) + crest - gullies


def _landform(horizontal, north):
    height = -47
    for points, width, elevation in RIDGES:
        height += _ridge(horizontal, north, points, width, elevation)
    lake_distance = math.hypot((horizontal + 25) / 225, (north - 160) / 175)
    lake_blend = _smooth((1.13 - lake_distance) / .27) * _smooth((north - 40) / 45)
    height = height * (1 - lake_blend) + (-43 + min(1, lake_distance) * 5) * lake_blend
    shoreline_noise = _fractal(horizontal, north, .023, 193) * .034
    shore = _smooth((lake_distance + shoreline_noise - .90) / .14)
    shore *= (1 - _smooth((lake_distance - 1.18) / .18)) * _smooth((north - 38) / 37)
    height += max(0, -30.7 + shoreline_noise * 20 - height) * shore
    return _island_landform(horizontal, north, height)


def _island_coordinates(horizontal, north):
    delta_x, delta_z, angle = horizontal + 45, -north + 190, .23
    local_x = math.cos(angle) * delta_x - math.sin(angle) * delta_z
    local_z = math.sin(angle) * delta_x + math.cos(angle) * delta_z
    return local_x, local_z


def _island_landform(horizontal, north, height):
    local_x, local_z = _island_coordinates(horizontal, north)
    island_distance = math.hypot((local_x - ISLAND_CENTER[0]) / ISLAND_RADII[0],
                                 (local_z - ISLAND_CENTER[1]) / ISLAND_RADII[1])
    if island_distance >= 2.15:
        return height
    if island_distance <= .86:
        return -15
    edge = _smooth((island_distance - .86) / .12)
    direction_x = (local_x - ISLAND_CENTER[0]) / max(1, island_distance * ISLAND_RADII[0])
    direction_y = (local_z - ISLAND_CENTER[1]) / max(1, island_distance * ISLAND_RADII[1])
    coastline = _fractal(direction_x * 60, direction_y * 60, .031, 239) * .21
    channels = _fractal(local_x, local_z, .061, 311)
    headland = .29 * math.exp(-((direction_x + .78) / .42) ** 2 - ((direction_y - .55) / .55) ** 2)
    headland += .18 * math.exp(-((direction_x - .30) / .50) ** 2 - ((direction_y - .93) / .42) ** 2)
    irregular_distance = island_distance + (coastline + channels * .048 - headland) * edge
    cliff_blend = 1 - _smooth((irregular_distance - .86) / .92)
    erosion = max(0, channels + .12) * 4.6 * edge * (1 - _smooth((island_distance - 1.48) / .45))
    rock_height = height * (1 - cliff_blend) - 15 * cliff_blend - erosion
    shoulder = _smooth((island_distance - .89) / .18) * (1 - _smooth((island_distance - 1.61) / .34))
    ledges = _fractal(local_x * .48 + local_z * .21, local_z, .12, 521) * 3.6 * shoulder
    talus = _smooth((island_distance - 1.16) / .24) * (1 - _smooth((island_distance - 1.82) / .28))
    rock_height += ledges + max(0, channels + .45) * 3.1 * talus
    outer_transition = 1 - _smooth((island_distance - 1.9) / .25)
    return height + (min(-15, rock_height) - height) * outer_transition


def _material(name, color, roughness=1):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = color + (1,)
    shader.inputs['Roughness'].default_value = roughness
    return material


def _texture(root, nodes, links, coordinate, name, suffix, color_space):
    if name == 'brown_mud':
        candidates = [root / 'assets/life/textures' / f'{name}_{suffix}_1k.jpg']
    else:
        candidates = [root / directory / name / f'{name}_{suffix}_{resolution}.jpg'
                      for resolution in ['4k', '2k', '1k']
                      for directory in ['assets/life/textures/library', '.render-work/library']]
    source = next((candidate for candidate in candidates if candidate.is_file()), None)
    if source is None:
        return None
    texture = nodes.new('ShaderNodeTexImage')
    texture.name = 'Highlands/' + name + '/' + suffix
    texture.image = bpy.data.images.load(str(source), check_existing=True)
    texture.image.colorspace_settings.name = color_space
    texture.extension = 'REPEAT'
    links.new(coordinate, texture.inputs['Vector'])
    return texture


def _land_material(root, use_leafy=True):
    material_name = 'Highlands/peat meadow and bedrock' if use_leafy else 'Highlands/far peat meadow and bedrock'
    material = _material(material_name, (.15, .19, .075))
    nodes, links = material.node_tree.nodes, material.node_tree.links
    if nodes.get('Highlands/brown_mud/diff'):
        return material
    shader = nodes.get('Principled BSDF')
    if use_leafy:
        shader.inputs['Specular IOR Level'].default_value = .12
    coordinates = nodes.new('ShaderNodeTexCoord')
    broad = nodes.new('ShaderNodeTexNoise')
    broad.inputs['Scale'].default_value = .29 if use_leafy else .24
    broad.inputs['Detail'].default_value = 3 if use_leafy else 5
    links.new(coordinates.outputs['Object'], broad.inputs['Vector'])
    pasture = nodes.new('ShaderNodeValToRGB')
    pasture.color_ramp.elements[0].color = (.42, .53, .30, 1) if use_leafy else (.30, .35, .12, 1)
    pasture.color_ramp.elements[1].color = (1.19, .97, .56, 1) if use_leafy else (.86, .81, .51, 1)
    if use_leafy:
        pasture.color_ramp.elements[0].position = .26
        pasture.color_ramp.elements[1].position = .73
    middle = pasture.color_ramp.elements.new(.53)
    middle.color = (.86, .91, .73, 1) if use_leafy else (.59, .68, .27, 1)
    links.new(broad.outputs['Fac'], pasture.inputs['Fac'])
    soil = _texture(root, nodes, links, coordinates.outputs['UV'], 'brown_mud', 'diff', 'sRGB')
    soil_normal = _texture(root, nodes, links, coordinates.outputs['UV'], 'brown_mud', 'nor_gl', 'Non-Color')
    soil_roughness = _texture(root, nodes, links, coordinates.outputs['UV'], 'brown_mud', 'rough', 'Non-Color')
    if any(texture is None for texture in [soil, soil_normal, soil_roughness]):
        raise FileNotFoundError('Highland soil requires the existing brown_mud diffuse, normal and roughness maps')
    if use_leafy:
        turf_scale = nodes.new('ShaderNodeVectorMath')
        turf_scale.operation = 'SCALE'
        turf_scale.inputs[3].default_value = 2
        links.new(coordinates.outputs['UV'], turf_scale.inputs[0])
        turf_diffuse = _texture(root, nodes, links, turf_scale.outputs[0], 'leafy_grass', 'diff', 'sRGB')
        turf_normal = _texture(root, nodes, links, turf_scale.outputs[0], 'leafy_grass', 'nor_gl', 'Non-Color')
        if turf_normal is None:
            turf_normal = _texture(root, nodes, links, turf_scale.outputs[0], 'leafy_grass', 'nor', 'Non-Color')
        turf_roughness = _texture(root, nodes, links, turf_scale.outputs[0], 'leafy_grass', 'rough', 'Non-Color')
        if any(texture is None for texture in (turf_diffuse, turf_normal, turf_roughness)):
            raise FileNotFoundError('Highland turf requires verified leafy_grass diffuse, normal and roughness maps')
        material['grass_surface_source'] = 'leafy_grass CC0 three-channel PBR'
        material['grass_surface_tile_metres'] = 1.75
        material['grass_surface_scale_provenance'] = 'art-directed mapping, not a measured capture scale'
        dry_turf = nodes.new('ShaderNodeMapRange')
        dry_turf.inputs['To Min'].default_value = .86
        dry_turf.inputs['To Max'].default_value = 1
        links.new(turf_roughness.outputs['Color'], dry_turf.inputs[0])
        turf_roughness_source = dry_turf.outputs[0]
        tint_luminance = nodes.new('ShaderNodeRGBToBW')
        links.new(turf_diffuse.outputs['Color'], tint_luminance.inputs[0])
        grass_tone = nodes.new('ShaderNodeValToRGB')
        grass_tone.color_ramp.elements[0].position = .018
        grass_tone.color_ramp.elements[0].color = (.027, .040, .016, 1)
        grass_tone.color_ramp.elements[1].position = .42
        grass_tone.color_ramp.elements[1].color = (.145, .181, .074, 1)
        links.new(tint_luminance.outputs[0], grass_tone.inputs[0])
        turf_diffuse_source = grass_tone.outputs['Color']
    else:
        turf_diffuse, turf_normal, turf_roughness = soil, soil_normal, soil_roughness
        turf_diffuse_source = turf_diffuse.outputs['Color']
        turf_roughness_source = turf_roughness.outputs['Color']
        material['grass_surface_source'] = 'brown_mud retained for distant terrain'
    turf = nodes.new('ShaderNodeMixRGB')
    turf.blend_type = 'MULTIPLY'
    turf.inputs[0].default_value = 1
    links.new(turf_diffuse_source, turf.inputs[1])
    links.new(pasture.outputs['Color'], turf.inputs[2])
    slope = nodes.new('ShaderNodeAttribute')
    slope.attribute_name = 'exposedBedrock'
    rock = nodes.new('ShaderNodeMixRGB')
    links.new(slope.outputs['Fac'], rock.inputs[0])
    links.new(turf.outputs['Color'], rock.inputs[1])
    rock.inputs[2].default_value = (.16, .175, .16, 1)
    normal = nodes.new('ShaderNodeNormalMap')
    normal.name = 'Highlands/terrain tangent normals'
    normal.inputs['Strength'].default_value = .24 if use_leafy else .68
    links.new(turf_normal.outputs['Color'], normal.inputs['Color'])
    links.new(turf_roughness_source, shader.inputs['Roughness'])
    for rock_name in ['rock_face_03', 'rocky_terrain_02', 'rocky_terrain_03', 'rocky_terrain', 'rock_boulder_dry']:
        rock_color = _texture(root, nodes, links, coordinates.outputs['UV'], rock_name, 'diff', 'sRGB')
        if rock_color is None:
            continue
        links.new(rock_color.outputs['Color'], rock.inputs[2])
        material['tileable_bedrock_source'] = rock_name
        rock_normal = _texture(root, nodes, links, coordinates.outputs['UV'], rock_name, 'nor_gl', 'Non-Color')
        if rock_normal is None:
            rock_normal = _texture(root, nodes, links, coordinates.outputs['UV'], rock_name, 'nor', 'Non-Color')
        if rock_normal is not None:
            blended_normal = nodes.new('ShaderNodeMixRGB')
            links.new(slope.outputs['Fac'], blended_normal.inputs[0])
            links.new(turf_normal.outputs['Color'], blended_normal.inputs[1])
            links.new(rock_normal.outputs['Color'], blended_normal.inputs[2])
            links.new(blended_normal.outputs[0], normal.inputs['Color'])
        rock_roughness = _texture(root, nodes, links, coordinates.outputs['UV'], rock_name, 'rough', 'Non-Color')
        if rock_roughness is not None:
            blended_roughness = nodes.new('ShaderNodeMixRGB')
            links.new(slope.outputs['Fac'], blended_roughness.inputs[0])
            links.new(turf_roughness_source, blended_roughness.inputs[1])
            links.new(rock_roughness.outputs['Color'], blended_roughness.inputs[2])
            links.new(blended_roughness.outputs[0], shader.inputs['Roughness'])
        break
    links.new(rock.outputs[0], shader.inputs['Base Color'])
    if not use_leafy:
        distance = nodes.new('ShaderNodeCameraData')
        filtering = nodes.new('ShaderNodeMapRange')
        filtering.name = 'Highlands/physical texture distance filtering'
        filtering.interpolation_type = 'SMOOTHSTEP'
        filtering.inputs['From Min'].default_value = 140
        filtering.inputs['From Max'].default_value = 520
        filtering.clamp = True
        links.new(distance.outputs['View Distance'], filtering.inputs['Value'])
        regional = nodes.new('ShaderNodeTexNoise')
        regional.inputs['Scale'].default_value = .016
        regional.inputs['Detail'].default_value = 4
        regional.inputs['Roughness'].default_value = .72
        links.new(coordinates.outputs['Object'], regional.inputs['Vector'])
        upland = nodes.new('ShaderNodeValToRGB')
        upland.color_ramp.elements[0].position = .25
        upland.color_ramp.elements[0].color = (.026, .043, .023, 1)
        upland.color_ramp.elements[1].position = .75
        upland.color_ramp.elements[1].color = (.16, .136, .072, 1)
        links.new(regional.outputs['Fac'], upland.inputs['Fac'])
        distant_rock = nodes.new('ShaderNodeValToRGB')
        distant_rock.color_ramp.elements[0].position = .24
        distant_rock.color_ramp.elements[0].color = (.045, .054, .048, 1)
        distant_rock.color_ramp.elements[1].position = .76
        distant_rock.color_ramp.elements[1].color = (.22, .204, .158, 1)
        strata_mapping = nodes.new('ShaderNodeVectorMath')
        strata_mapping.operation = 'MULTIPLY'
        strata_mapping.inputs[1].default_value = (.031, .017, .063)
        links.new(coordinates.outputs['Object'], strata_mapping.inputs[0])
        strata = nodes.new('ShaderNodeTexNoise')
        strata.name = 'Highlands/nonperiodic tilted geological strata'
        strata.inputs['Scale'].default_value = 1
        strata.inputs['Detail'].default_value = 3.1
        strata.inputs['Roughness'].default_value = .66
        links.new(strata_mapping.outputs[0], strata.inputs['Vector'])
        links.new(strata.outputs['Fac'], distant_rock.inputs['Fac'])
        geological = nodes.new('ShaderNodeMixRGB')
        links.new(slope.outputs['Fac'], geological.inputs[0])
        links.new(upland.outputs['Color'], geological.inputs[1])
        links.new(distant_rock.outputs['Color'], geological.inputs[2])
        color_lod = nodes.new('ShaderNodeMixRGB')
        links.new(filtering.outputs['Result'], color_lod.inputs[0])
        links.new(rock.outputs[0], color_lod.inputs[1])
        links.new(geological.outputs[0], color_lod.inputs[2])
        links.new(color_lod.outputs[0], shader.inputs['Base Color'])
        normal_lod = nodes.new('ShaderNodeMath')
        normal_lod.operation = 'SUBTRACT'
        normal_lod.inputs[0].default_value = 1
        links.new(filtering.outputs['Result'], normal_lod.inputs[1])
        links.new(normal_lod.outputs[0], normal.inputs['Strength'])
        roughness_source = shader.inputs['Roughness'].links[0].from_socket
        roughness_lod = nodes.new('ShaderNodeMixRGB')
        links.new(filtering.outputs['Result'], roughness_lod.inputs[0])
        links.new(roughness_source, roughness_lod.inputs[1])
        roughness_lod.inputs[2].default_value = (.94, .94, .94, 1)
        links.new(roughness_lod.outputs[0], shader.inputs['Roughness'])
        material['pbr_detail_distance_filter_metres'] = [140, 520]
    grain = nodes.new('ShaderNodeTexNoise')
    grain.inputs['Scale'].default_value = 6
    grain.inputs['Detail'].default_value = 3
    links.new(coordinates.outputs['Object'], grain.inputs['Vector'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .24
    bump.inputs['Distance'].default_value = .028
    if not use_leafy:
        links.new(normal_lod.outputs[0], bump.inputs['Strength'])
    links.new(grain.outputs['Fac'], bump.inputs['Height'])
    links.new(normal.outputs['Normal'], bump.inputs['Normal'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    if not use_leafy:
        landform_bump = nodes.new('ShaderNodeBump')
        landform_bump.name = 'Highlands/metre-scale fractured bedrock relief'
        landform_bump.inputs['Strength'].default_value = .32
        landform_bump.inputs['Distance'].default_value = 1.25
        links.new(strata.outputs['Fac'], landform_bump.inputs['Height'])
        links.new(bump.outputs['Normal'], landform_bump.inputs['Normal'])
        links.new(landform_bump.outputs['Normal'], shader.inputs['Normal'])
    material['texture_repeat_metres'] = 3.5
    return material


def _surface_height(geometry, helper, horizontal, north):
    blend = _smooth((math.hypot(horizontal, north) - 65) / 150)
    authored = helper['_authored_height'](geometry, horizontal, north)
    height = authored * (1 - blend) + _landform(horizontal, north) * blend
    local_x, local_z = _island_coordinates(horizontal, north)
    island_distance = math.hypot((local_x - ISLAND_CENTER[0]) / ISLAND_RADII[0],
                                 (local_z - ISLAND_CENTER[1]) / ISLAND_RADII[1])
    island_gate = 1 - _smooth((island_distance - 1.72) / .43)
    if island_gate > 0:
        height = height * (1 - island_gate) + _landform(horizontal, north) * island_gate
    width = 10 + min(30, max(0, north - 34) * .65)
    corridor = 1 - _smooth((abs(horizontal) - width) / 15)
    gate = _smooth((north - 35) / 8) * (1 - _smooth((north - 80) / 20)) * corridor
    graded = -34 * _smooth((north - 15) / 55)
    height += min(0, graded - height) * gate
    return _bridge_view_basin(horizontal, north, height)


def _bridge_view_basin(horizontal, north, height):
    angle = .23
    delta_x, delta_y = horizontal, north - 2
    denominator = delta_x * math.sin(angle) - delta_y * math.cos(angle)
    if abs(denominator) < .000001:
        return height
    line_start_x = -45 + math.sin(angle) * 7
    line_start_y = 188 - math.cos(angle) * 7
    fraction = (line_start_x * math.sin(angle) - line_start_y * math.cos(angle)) / denominator
    if fraction <= 1.015:
        return height
    crossing_x, crossing_y = delta_x * fraction, delta_y * fraction
    chainage = (crossing_x - line_start_x) * math.cos(angle) + (crossing_y - line_start_y) * math.sin(angle)
    view_gate = _smooth((chainage - 80) / 28) * (1 - _smooth((chainage - 215) / 30))
    view_gate *= _smooth((north - 38) / 26) * _smooth((fraction - 1.015) / .08)
    sight_height = 1.72 + (-13.5 - 1.72) / fraction
    return height + min(0, sight_height - height) * view_gate


def _far_mesh(collection, geometry, helper, root):
    radii = [INNER_RADIUS, 38, 42, 46, 50, 55, 60, 65, 72, 80, 90]
    radii += [100 + index * 2.5 for index in range(81)] + list(range(315, 1801, 15))
    if radii[-1] != 1800:
        radii.append(1800)
    vertices, faces, exposures = [], [], []
    for radius in radii:
        for index in range(800):
            horizontal, north = helper['_boundary_point'](index, radius)
            height = _surface_height(geometry, helper, horizontal, north)
            slope_x = (_surface_height(geometry, helper, horizontal + 2, north) - _surface_height(geometry, helper, horizontal - 2, north)) / 4
            slope_y = (_surface_height(geometry, helper, horizontal, north + 2) - _surface_height(geometry, helper, horizontal, north - 2)) / 4
            slope = math.hypot(slope_x, slope_y)
            vertices.append((horizontal, north, height))
            mottling = _fractal(horizontal, north, .019, 137) * .30 + _fractal(horizontal, north, .0036, 617) * .30
            exposures.append(_smooth((slope + mottling - .34) / .50))
    for ring in range(len(radii) - 1):
        for index in range(800):
            following = (index + 1) % 800
            inner, outer = ring * 800 + index, (ring + 1) * 800 + index
            next_inner, next_outer = ring * 800 + following, (ring + 1) * 800 + following
            faces.extend(((inner, outer, next_outer), (inner, next_outer, next_inner)))
    start = len(vertices)
    perimeter = start - 800
    for index in range(800):
        horizontal, north, height = vertices[perimeter + index]
        vertices.append((horizontal, north, -400))
        exposures.append(1)
    for index in range(800):
        following = (index + 1) % 800
        faces.append((perimeter + index, start + index, start + following, perimeter + following))
    mesh = bpy.data.meshes.new('Highlands/continuous glacial valleys')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    layer = mesh.attributes.new('exposedBedrock', 'FLOAT', 'POINT')
    for entry, value in zip(layer.data, exposures):
        entry.value = value
    coordinates = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        vertex = mesh.vertices[loop.vertex_index].co
        coordinates.data[loop.index].uv = (vertex.x / 3.5, vertex.y / 3.5)
    mesh.materials.append(_land_material(root, use_leafy=False))
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    instance = bpy.data.objects.new('Highlands/continuous ridges and lake basin', mesh)
    collection.objects.link(instance)
    instance['highlands_refinement'] = True
    return instance, vertices


def _near_height_sampler(instance):
    spacing = INNER_RADIUS * 2 / 200
    heights = [0] * 40401
    for vertex in instance.data.vertices:
        column = round((vertex.co.x + INNER_RADIUS) / spacing)
        row = round((vertex.co.y + INNER_RADIUS) / spacing)
        heights[row * 201 + column] = vertex.co.z

    def sample(horizontal, north):
        column = min(199.999999, max(0, (horizontal + INNER_RADIUS) / spacing))
        row = min(199.999999, max(0, (north + INNER_RADIUS) / spacing))
        left, lower = int(column), int(row)
        across, along = column - left, row - lower
        first = heights[lower * 201 + left] * (1 - across) + heights[lower * 201 + left + 1] * across
        last = heights[(lower + 1) * 201 + left] * (1 - across) + heights[(lower + 1) * 201 + left + 1] * across
        return first * (1 - along) + last * along
    return sample


def _lower_observation_lip(near):
    original = [tuple(vertex.normal) for vertex in near.data.vertices]
    maximum, changed = 0, 0
    for vertex in near.data.vertices:
        horizontal, north, height = vertex.co
        corridor = 1 - _smooth((abs(horizontal) - 10) / 15)
        lowering = .92 * _smooth((north - 5) / 3) * (1 - _smooth((north - 12) / 12)) * corridor
        vertex.co.z = height - lowering
        maximum = max(maximum, lowering)
        changed += lowering > .0001
    near.data.update()
    normals = [original[index] if max(abs(vertex.co.x), abs(vertex.co.y)) > INNER_RADIUS - .001 else tuple(vertex.normal)
               for index, vertex in enumerate(near.data.vertices)]
    near.data.normals_split_custom_set_from_vertices(normals)
    near['observation_lip_lowered_metres'] = maximum
    return {'modified_vertices': changed, 'maximum_lowering_metres': maximum,
            'preserved_north_max': 5, 'preserved_boundary': True}


def _grass_blade(origin, width, height, bend_angle, width_angle, spread=1):
    side = (math.cos(width_angle) * width, math.sin(width_angle) * width, 0)
    bend = (math.cos(bend_angle), math.sin(bend_angle))
    vertices = []
    for level in range(4):
        t = level / 3
        centre = (bend[0] * height * spread * (.30 * t + .70 * t * t),
                  bend[1] * height * spread * (.30 * t + .70 * t * t), height * t)
        taper = (1 - .97 * t) * (1 + .08 * math.sin(level * 2.3 + bend_angle))
        for sign in (-1, 1):
            vertices.append(tuple(origin[axis] + centre[axis] + sign * side[axis] * taper
                                  for axis in range(3)))
    return vertices


def _grass(collection, ground):
    randomizer = random.Random(27431)
    materials = [_material('Highlands/grass ' + str(index), color) for index, color in enumerate([
        (.085, .132, .040), (.108, .153, .049), (.155, .168, .073), (.079, .118, .035),
        (.164, .145, .074), (.116, .132, .057)])]
    for material in materials:
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = nodes.get('Principled BSDF')
        shader.inputs['Roughness'].default_value = .93
        shader.inputs['Specular IOR Level'].default_value = .12
        shader.inputs['Subsurface Weight'].default_value = .035
        shader.inputs['Subsurface Radius'].default_value = (.05, .025, .01)
        original_color = tuple(shader.inputs['Base Color'].default_value)
        height_attribute = nodes.new('ShaderNodeAttribute')
        height_attribute.attribute_name = 'grassBladeHeight'
        coloring = nodes.new('ShaderNodeValToRGB')
        coloring.color_ramp.elements[0].color = tuple(channel * .92 for channel in original_color[:3]) + (1,)
        coloring.color_ramp.elements[1].color = tuple(channel * 1.13 for channel in original_color[:3]) + (1,)
        links.new(height_attribute.outputs['Fac'], coloring.inputs[0])
        links.new(coloring.outputs['Color'], shader.inputs['Base Color'])
        translucency = nodes.new('ShaderNodeBsdfTranslucent')
        links.new(coloring.outputs['Color'], translucency.inputs['Color'])
        mix = nodes.new('ShaderNodeMixShader')
        mix.inputs[0].default_value = .38
        links.new(shader.outputs['BSDF'], mix.inputs[1])
        links.new(translucency.outputs[0], mix.inputs[2])
        links.new(mix.outputs[0], nodes.get('Material Output').inputs['Surface'])
    vertices, faces, colors = [], [], []
    accepted, short_clumps, tall_clumps, low_clumps = 0, 0, 0, 0
    blade_heights, density_samples = [], []
    for attempt in range(248000):
        if attempt < 142000:
            horizontal, north = randomizer.uniform(-19, 19), randomizer.uniform(-24, 12)
        else:
            horizontal, north = randomizer.uniform(-33, 33), randomizer.uniform(-33, 31)
            if -19 < horizontal < 19 and -24 < north < 12:
                continue
            fade = 1 - _smooth((max(abs(horizontal), abs(north)) - 25) / 8)
            if randomizer.random() > fade:
                continue
        path_distance = _footpath_distance(horizontal, north)
        if path_distance < .43 or randomizer.random() < 1 - _smooth((path_distance - .43) / .94):
            continue
        if math.hypot(horizontal + 7, north + 9) < 1.5:
            continue
        slope_x = (ground(horizontal + .12, north) - ground(horizontal - .12, north)) / .24
        slope_y = (ground(horizontal, north + .12) - ground(horizontal, north - .12)) / .24
        if randomizer.random() < _smooth((math.hypot(slope_x, slope_y) - .65) / .60):
            continue
        patch = _fractal(horizontal, north, .21, 109)
        fine_patch = _fractal(horizontal, north, 1.1, 613)
        density = min(.96, max(.05, .49 + patch * 1.12 + fine_patch * .20))
        density_samples.append(density)
        if randomizer.random() > density:
            continue
        habit = randomizer.random()
        if habit < .20:
            height, spread = randomizer.uniform(.012, .029), randomizer.uniform(1.9, 3.2)
            low_clumps += 1
        elif habit < .79 or patch < -.12:
            height, spread = randomizer.uniform(.046, .100), randomizer.uniform(.85, 1.65)
            short_clumps += 1
        else:
            height, spread = randomizer.uniform(.125, .225), randomizer.uniform(.72, 1.25)
            tall_clumps += 1
        accepted += 1
        blade_count = 7 + randomizer.randrange(7)
        wind = 1.09 + patch * .75
        radius = randomizer.uniform(.018, .062)
        dry_fraction = max(.08, min(.72, .28 + _fractal(horizontal, north, .11, 121) * .65))
        for blade in range(blade_count):
            bend_angle = wind + randomizer.uniform(-2.1, 2.1)
            angle = bend_angle + math.pi / 2 + randomizer.uniform(-.16, .16)
            width = randomizer.uniform(.0027, .0054) if habit >= .20 else randomizer.uniform(.0034, .0062)
            leaf_height = height * randomizer.uniform(.62, 1.18)
            origin_x, origin_y = horizontal + randomizer.uniform(-radius, radius), north + randomizer.uniform(-radius, radius)
            origin = (origin_x, origin_y, ground(origin_x, origin_y) - .002)
            start = len(vertices)
            vertices.extend(_grass_blade(origin, width, leaf_height, bend_angle, angle, spread))
            blade_heights.append(leaf_height)
            faces.extend(((start, start + 2, start + 3, start + 1),
                          (start + 2, start + 4, start + 5, start + 3),
                          (start + 4, start + 6, start + 7, start + 5)))
            material = randomizer.choice((2, 4, 5) if randomizer.random() < dry_fraction else (0, 1, 3))
            colors.extend((material, material, material))
    mesh = bpy.data.meshes.new('Highlands/foreground grass blades')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    blade_height = mesh.attributes.new('grassBladeHeight', 'FLOAT', 'POINT')
    for index, value in enumerate(blade_height.data):
        value.value = (0, 0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1, 1)[index % 8]
    for material in materials:
        mesh.materials.append(material)
    for polygon, material in zip(mesh.polygons, colors):
        polygon.material_index = material
        polygon.use_smooth = True
    instance = bpy.data.objects.new('Highlands/grazed grass beside worn path', mesh)
    collection.objects.link(instance)
    upward_faces = sum(1 for polygon in mesh.polygons if polygon.normal.z > .10)
    downward_faces = sum(1 for polygon in mesh.polygons if polygon.normal.z < -.10)
    if upward_faces != len(mesh.polygons) or downward_faces:
        raise ValueError(f'Grass blade surfaces are not upward-facing: {upward_faces}/{len(mesh.polygons)}')
    instance['grass_geometry_validation'] = 'all blade faces have world-up normal component > 0.10'
    instance['grass_blade_count'] = len(mesh.polygons) // 3
    return {'clumps': accepted, 'blades': len(mesh.polygons) // 3,
            'short_grass_clumps': short_clumps, 'tall_grass_clumps': tall_clumps,
            'prostrate_leaf_clumps': low_clumps, 'vertices_per_leaf': 8, 'quads_per_leaf': 3,
            'minimum_leaf_height_metres': min(blade_heights), 'maximum_leaf_height_metres': max(blade_heights),
            'minimum_density_probability': min(density_samples), 'maximum_density_probability': max(density_samples),
            'upward_faces': upward_faces, 'downward_faces': downward_faces,
            'minimum_upward_normal_component': min(polygon.normal.z for polygon in mesh.polygons)}


def _near_meadow(near, root):
    material = _land_material(root).copy()
    material.name = 'Highlands/foreground grass and worn footpath'
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    base_source = shader.inputs['Base Color'].links[0].from_socket
    blend = nodes.new('ShaderNodeAttribute')
    blend.attribute_name = 'footpathWear'
    peat_attribute = nodes.new('ShaderNodeAttribute')
    peat_attribute.attribute_name = 'meadowPeat'
    peat = nodes.new('ShaderNodeMixRGB')
    links.new(peat_attribute.outputs['Fac'], peat.inputs[0])
    links.new(base_source, peat.inputs[1])
    soil = nodes.get('Highlands/brown_mud/diff')
    links.new(soil.outputs['Color'], peat.inputs[2])
    path = nodes.new('ShaderNodeMixRGB')
    links.new(blend.outputs['Fac'], path.inputs[0])
    links.new(peat.outputs[0], path.inputs[1])
    links.new(soil.outputs['Color'], path.inputs[2])
    links.new(path.outputs[0], shader.inputs['Base Color'])
    normal = nodes.get('Highlands/terrain tangent normals')
    path_normal = nodes.new('ShaderNodeMixRGB')
    links.new(blend.outputs['Fac'], path_normal.inputs[0])
    links.new(normal.inputs['Color'].links[0].from_socket, path_normal.inputs[1])
    links.new(nodes.get('Highlands/brown_mud/nor_gl').outputs['Color'], path_normal.inputs[2])
    links.new(path_normal.outputs[0], normal.inputs['Color'])
    path_roughness = nodes.new('ShaderNodeMixRGB')
    links.new(blend.outputs['Fac'], path_roughness.inputs[0])
    links.new(shader.inputs['Roughness'].links[0].from_socket, path_roughness.inputs[1])
    links.new(nodes.get('Highlands/brown_mud/rough').outputs['Color'], path_roughness.inputs[2])
    links.new(path_roughness.outputs[0], shader.inputs['Roughness'])
    if near.data.uv_layers:
        coordinates = near.data.uv_layers.active
    else:
        coordinates = near.data.uv_layers.new(name='UVMap')
    for loop in near.data.loops:
        vertex = near.data.vertices[loop.vertex_index].co
        coordinates.data[loop.index].uv = (vertex.x / 3.5, vertex.y / 3.5)
    layer = near.data.attributes.get('exposedBedrock') or near.data.attributes.new('exposedBedrock', 'FLOAT', 'POINT')
    for vertex, entry in zip(near.data.vertices, layer.data):
        slope = math.hypot(vertex.normal.x, vertex.normal.y) / max(.001, abs(vertex.normal.z))
        entry.value = _smooth((slope - 1.1) / .75)
    wear = near.data.attributes.new('footpathWear', 'FLOAT', 'POINT')
    peat_layer = near.data.attributes.new('meadowPeat', 'FLOAT', 'POINT')
    for vertex, wear_entry, peat_entry in zip(near.data.vertices, wear.data, peat_layer.data):
        horizontal, north = vertex.co.x, vertex.co.y
        distance = _footpath_distance(horizontal, north) + _fractal(horizontal, north, 2.3, 887) * .11
        wear_entry.value = 1 - _smooth((distance - .43) / 1.02)
        peat_entry.value = _smooth((.13 - _fractal(horizontal, north, .21, 109)) / .65) * .36
    near.data.materials.clear()
    near.data.materials.append(material)


def _gravel(collection, ground):
    randomizer = random.Random(8271)
    vertices, faces, materials = [], [], []
    accepted, exposed_heights, burial_depths = 0, [], []
    for stone in range(1800):
        if accepted >= 560:
            break
        start_x, start_y, delta_x, delta_y, inverse_length_squared = randomizer.choice(FOOTPATH_SEGMENTS[4:-3])
        fraction = randomizer.random()
        offset = randomizer.choice((-1, 1)) * randomizer.uniform(.40, 1.80)
        inverse_length = math.sqrt(inverse_length_squared)
        horizontal = start_x + delta_x * fraction - delta_y * inverse_length * offset
        north = start_y + delta_y * fraction + delta_x * inverse_length * offset
        density = max(.16, min(.82, .47 + _fractal(horizontal, north, .46, 827) * .55))
        if randomizer.random() > density:
            continue
        radius = randomizer.uniform(.007, .027) * (1.4 if randomizer.random() < .08 else 1)
        count = randomizer.randrange(5, 9)
        rotation = randomizer.uniform(0, math.tau)
        flattening = randomizer.uniform(.43, .79)
        outline = []
        for corner in range(count):
            angle = rotation + math.tau * (corner + randomizer.uniform(-.15, .15)) / count
            length = radius * randomizer.uniform(.65, 1.14)
            outline.append((math.cos(angle) * length, math.sin(angle) * length * flattening))
        start = len(vertices)
        burial = radius * randomizer.uniform(.38, .66)
        top = radius * randomizer.uniform(.18, .38)
        for across, along in outline:
            vertices.append((horizontal + across, north + along, ground(horizontal + across, north + along) - burial))
        for across, along in outline:
            vertices.append((horizontal + across * .74, north + along * .74,
                             ground(horizontal + across * .74, north + along * .74) + top * randomizer.uniform(.25, 1)))
        vertices.append((horizontal + radius * .13, north - radius * .09, ground(horizontal, north) + top))
        color = randomizer.choices((0, 1, 2, 3), (36, 30, 24, 10))[0]
        faces.append(tuple(reversed(range(start, start + count))))
        materials.append(color)
        for corner in range(count):
            following = (corner + 1) % count
            faces.append((start + corner, start + following, start + count + following, start + count + corner))
            faces.append((start + count + corner, start + count + following, start + count * 2))
            materials.extend((color, color))
        accepted += 1
        exposed_heights.append(top)
        burial_depths.append(burial)
    mesh = bpy.data.meshes.new('Highlands/footpath weathered grit')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for index, color in enumerate(((.065, .063, .052), (.044, .049, .045), (.092, .085, .067), (.115, .108, .084))):
        material = _material('Highlands/weathered grit ' + str(index), color, .98)
        material.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = .12
        mesh.materials.append(material)
    for polygon, material in zip(mesh.polygons, materials):
        polygon.use_smooth = False
        polygon.material_index = material
    instance = bpy.data.objects.new('Highlands/gravel at worn path margins', mesh)
    collection.objects.link(instance)
    return {'angular_fragments': accepted, 'smooth_spheres': 0, 'maximum_exposed_height_m': max(exposed_heights),
            'minimum_burial_depth_m': min(burial_depths), 'terrain_sampled_per_corner': True}


def _lake_water(scene, collection):
    matches = []
    for instance in scene.objects:
        if instance.type != 'MESH' or len(instance.data.vertices) != 4:
            continue
        corners = [instance.matrix_world @ vertex.co for vertex in instance.data.vertices]
        low = Vector(tuple(min(vertex[axis] for vertex in corners) for axis in range(3)))
        high = Vector(tuple(max(vertex[axis] for vertex in corners) for axis in range(3)))
        if (low - Vector((-265, -30, -34))).length < .001 and (high - Vector((215, 350, -34))).length < .001:
            matches.append(instance)
    if len(matches) != 1:
        raise ValueError(f'Expected one exact Black Lake surface, found {len(matches)}')
    water = _material('Highlands/Black Lake dielectric water', (.89, .95, .97), .055)
    nodes, links = water.node_tree.nodes, water.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Transmission Weight'].default_value = 1
    shader.inputs['IOR'].default_value = 1.333
    coordinates = nodes.new('ShaderNodeTexCoord')
    combined = None
    for index, (scale, stretching, height) in enumerate([(1.8, (1.0, 4.7, 1.0), .055), (11, (1.0, 2.5, 1.0), .005)]):
        mapping = nodes.new('ShaderNodeVectorMath')
        mapping.operation = 'MULTIPLY'
        mapping.inputs[1].default_value = stretching
        links.new(coordinates.outputs['Object'], mapping.inputs[0])
        ripples = nodes.new('ShaderNodeTexNoise')
        ripples.inputs['Scale'].default_value = scale
        ripples.inputs['Detail'].default_value = 3
        ripples.inputs['Roughness'].default_value = .66
        links.new(mapping.outputs[0], ripples.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .48 if index == 0 else .23
        bump.inputs['Distance'].default_value = height
        links.new(ripples.outputs['Fac'], bump.inputs['Height'])
        if combined:
            links.new(combined, bump.inputs['Normal'])
        combined = bump.outputs['Normal']
    links.new(combined, shader.inputs['Normal'])
    absorption = nodes.new('ShaderNodeVolumeAbsorption')
    absorption.inputs['Color'].default_value = (.18, .38, .33, 1)
    absorption.inputs['Density'].default_value = .115
    links.new(absorption.outputs[0], nodes.get('Material Output').inputs['Volume'])
    vertices, faces = [], []
    columns, rows = 600, 475
    for row in range(rows + 1):
        north = -30 + row * .8
        for column in range(columns + 1):
            horizontal = -265 + column * .8
            ripple = noise.noise(Vector((horizontal * .22, north * .61, 479)), noise_basis='PERLIN_NEW') * .028
            vertices.append((horizontal, north, -34 + ripple))
    for row in range(rows):
        for column in range(columns):
            start = row * (columns + 1) + column
            faces.append((start, start + 1, start + columns + 2, start + columns + 1))
    perimeter = list(range(columns + 1))
    perimeter += [row * (columns + 1) + columns for row in range(1, rows + 1)]
    perimeter += [rows * (columns + 1) + column for column in range(columns - 1, -1, -1)]
    perimeter += [row * (columns + 1) for row in range(rows - 1, 0, -1)]
    bottom = len(vertices)
    for index in perimeter:
        horizontal, north, elevation = vertices[index]
        vertices.append((horizontal, north, -64))
    for index, upper in enumerate(perimeter):
        following = (index + 1) % len(perimeter)
        faces.append((upper, bottom + index, bottom + following, perimeter[following]))
    faces.append(tuple(reversed(range(bottom, len(vertices)))))
    mesh = bpy.data.meshes.new('Highlands/closed rippled lake volume')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    topology = bmesh.new()
    topology.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    topology.to_mesh(mesh)
    topology.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    mesh.materials.append(water)
    instance = bpy.data.objects.new('Highlands/refractive Black Lake', mesh)
    collection.objects.link(instance)
    matches[0].hide_render = True
    matches[0].hide_set(True)
    instance['physical_water_ior'] = 1.333
    return {'replaced_surface': matches[0].name, 'ior': 1.333, 'volume_absorption_density': .115,
            'surface_vertices': (columns + 1) * (rows + 1), 'maximum_geometric_ripple_metres': .028}


def _weathered_boulders(scene, descriptor, ground):
    candidates = [instance for instance in scene.objects if instance.type == 'MESH'
                  and len(instance.data.vertices) == 7914
                  and any(material and material.name.startswith('rock_07') for material in instance.data.materials)]
    assets = [asset for asset in descriptor.get('assets', []) if asset['id'] == 'rock_07']
    if len(candidates) != 24 or len(assets) != 24:
        raise ValueError('Expected exactly 24 original scanned foreground boulders')
    randomizer = random.Random(33281)
    report = []
    used = set()
    for index, asset in enumerate(assets):
        horizontal, north = asset['matrix'][12], -asset['matrix'][14]
        expected_height = asset['options']['height']
        found = []
        for instance in candidates:
            corners = [instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
            low = Vector(tuple(min(corner[axis] for corner in corners) for axis in range(3)))
            high = Vector(tuple(max(corner[axis] for corner in corners) for axis in range(3)))
            center = (low + high) * .5
            if math.hypot(center.x - horizontal, center.y - north) < expected_height * .55 and abs(high.z - low.z - expected_height) < .003:
                found.append((instance, center))
        if len(found) != 1 or found[0][0] in used:
            raise ValueError(f'Could not uniquely match scanned foreground boulder {index}')
        instance, center = found[0]
        used.add(instance)
        if index in [1, 3, 6, 9, 10, 11, 12, 13, 16, 18, 21]:
            instance.hide_render = True
            instance.hide_set(True)
            report.append({'index': index, 'hidden': True})
            continue
        offset_x, offset_y = randomizer.uniform(-.32, .32), randomizer.uniform(-1.4, 1.4)
        destination = Vector((horizontal + offset_x, north + offset_y, ground(horizontal + offset_x, north + offset_y)))
        transform = Matrix.Translation(destination) @ Matrix.Rotation(randomizer.uniform(-.7, .7), 4, 'Z')
        transform = transform @ Matrix.Rotation(randomizer.uniform(-.17, .17), 4, 'X')
        transform = transform @ Matrix.Diagonal((randomizer.uniform(.67, 1.09), randomizer.uniform(.65, 1.03), randomizer.uniform(.72, .94), 1))
        instance.matrix_world = transform @ Matrix.Translation((-horizontal, -north, .02)) @ instance.matrix_world
        bpy.context.view_layer.update()
        low = min((instance.matrix_world @ vertex.co).z for vertex in instance.data.vertices)
        instance.location.z += destination.z - low - expected_height * .21
        for slot in instance.material_slots:
            if slot.material is None:
                continue
            material = slot.material.copy()
            material.name = 'Highlands/weathered dry sandstone ' + str(index)
            nodes, links = material.node_tree.nodes, material.node_tree.links
            shader = nodes.get('Principled BSDF')
            for name, value in [('Metallic', 0), ('Roughness', .87), ('Coat Weight', 0), ('Specular IOR Level', .24)]:
                for link in list(shader.inputs[name].links):
                    links.remove(link)
                shader.inputs[name].default_value = value
            base = shader.inputs['Base Color']
            if base.is_linked:
                source = base.links[0].from_socket
                saturation = nodes.new('ShaderNodeHueSaturation')
                saturation.inputs['Saturation'].default_value = .12
                saturation.inputs['Value'].default_value = 1.42
                links.new(source, saturation.inputs['Color'])
                tint = nodes.new('ShaderNodeMixRGB')
                tint.blend_type = 'MULTIPLY'
                tint.inputs[0].default_value = 1
                tint.inputs[2].default_value = (.80, .88, .78, 1)
                links.new(saturation.outputs[0], tint.inputs[1])
                links.new(tint.outputs[0], base)
            slot.material = material
        report.append({'index': index, 'hidden': False, 'position': list(destination)})
    return report


def _bridge_foundations(scene, geometry, helper):
    corrected = []
    angle = .23
    for index in range(9):
        local_x = 30 + index * 8
        center_x = -45 + math.cos(angle) * local_x + math.sin(angle) * 7
        center_y = 190 + math.sin(angle) * local_x - math.cos(angle) * 7
        candidates = []
        for instance in scene.objects:
            if instance.type != 'MESH' or not instance.name.startswith('NightWorld/mesh'):
                continue
            if not 8 <= len(instance.data.vertices) <= 1000:
                continue
            corners = [instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
            low = Vector(tuple(min(vertex[axis] for vertex in corners) for axis in range(3)))
            high = Vector(tuple(max(vertex[axis] for vertex in corners) for axis in range(3)))
            center = (low + high) * .5
            if math.hypot(center.x - center_x, center.y - center_y) < .003 and abs(high.z + 13) < .003:
                candidates.append((instance, low.z, high.z))
        if len(candidates) != 1:
            raise ValueError(f'Could not uniquely identify castle bridge pier {index}')
        instance, bottom, top = candidates[0]
        footing = []
        for across in [-1.05, -.525, 0, .525, 1.05]:
            for along in [-3, -2, -1, 0, 1, 2, 3]:
                horizontal = -45 + math.cos(angle) * (local_x + across) + math.sin(angle) * (7 + along)
                north = 190 + math.sin(angle) * (local_x + across) - math.cos(angle) * (7 + along)
                footing.append(_surface_height(geometry, helper, horizontal, north))
        required = min(bottom, min(footing) - .55)
        inverse = instance.matrix_world.inverted()
        for vertex in instance.data.vertices:
            world = instance.matrix_world @ vertex.co
            world.z = top - (top - world.z) * (top - required) / (top - bottom)
            vertex.co = inverse @ world
        instance.data.update()
        instance['extended_bridge_pier_bottom'] = required
        corrected.append({'pier': index, 'old_bottom': bottom, 'new_bottom': required,
                          'sampled_ground_minimum': min(footing)})
    return corrected


def _complete_bridge(scene, collection, terrain, root):
    angle = .23

    def position(along, across, elevation):
        return (-45 + math.cos(angle) * along + math.sin(angle) * across,
                190 + math.sin(angle) * along - math.cos(angle) * across, elevation)

    expected = Vector(position(98, 7, -12))
    matches = []
    for instance in scene.objects:
        if instance.type != 'MESH' or not instance.name.startswith('NightWorld/mesh'):
            continue
        corners = [instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
        low = Vector(tuple(min(vertex[axis] for vertex in corners) for axis in range(3)))
        high = Vector(tuple(max(vertex[axis] for vertex in corners) for axis in range(3)))
        if ((low + high) * .5 - expected).length < .003 and abs(high.z + 11) < .003:
            matches.append(instance)
    if len(matches) != 1:
        raise ValueError(f'Expected one actual last bridge deck, found {len(matches)}')
    local = []
    for vertex in matches[0].data.vertices:
        world = matches[0].matrix_world @ vertex.co
        local.append((world.x + 45) * math.cos(angle) + (world.y - 190) * math.sin(angle))
    endpoint = max(local)
    if abs(endpoint - 103.05) > .003:
        raise ValueError('Castle bridge endpoint differs from the verified 103.05 m chainage')
    candidates = []
    for instance in scene.objects:
        if instance.type != 'MESH' or not instance.name.startswith('NightWorld/mesh'):
            continue
        if not 8 <= len(instance.data.vertices) <= 1000:
            continue
        points = []
        for corner in instance.bound_box:
            world = instance.matrix_world @ Vector(corner)
            points.append(Vector(((world.x + 45) * math.cos(angle) + (world.y - 190) * math.sin(angle),
                                  (world.x + 45) * math.sin(angle) - (world.y - 190) * math.cos(angle), world.z)))
        low = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
        high = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
        candidates.append((instance, (low + high) / 2, high - low))

    def match_original(center, dimensions, role):
        found = [instance for instance, actual_center, extent in candidates
                 if (actual_center - Vector(center)).length < .003 and
                 max(abs(extent[axis] - dimensions[axis]) for axis in range(3)) < .003]
        if len(found) != 1:
            raise ValueError(f'Bridge {role} requires one exact original geometry match: {center}, {len(found)}')
        return found[0]

    original_decks, original_rails = [], []
    for span in range(9):
        along = 34 + span * 8
        original_decks.append(match_original((along, 7, -12), (10.1, 6.8, 2), 'deck'))
        for across in (3.85, 10.15):
            original_rails.append(match_original((along, across, -10.75), (8, .38, .8), 'parapet'))
    original_piers = [instance for instance, center, extent in candidates
                      if instance.get('extended_bridge_pier_bottom') is not None]
    if len(original_piers) != 9 or len(set(original_decks + original_rails + original_piers)) != 36:
        raise ValueError('Original bridge must contain exactly 9 distinct piers, 9 decks and 18 parapets')
    unrelated_visibility = {instance: instance.hide_render for instance in scene.objects
                            if instance not in original_decks + original_rails + original_piers}
    terrain_bvh = BVHTree.FromObject(terrain, bpy.context.evaluated_depsgraph_get())

    def ground(horizontal, north):
        hit, normal, polygon, distance = terrain_bvh.ray_cast(Vector((horizontal, north, 900)), Vector((0, 0, -1)))
        if hit is None:
            raise ValueError('Bridge landing lies outside the supporting terrain mesh')
        return hit.z

    def cross_section_ground(along, half_width=3.4):
        return max(ground(*position(along, 7 - half_width + half_width * index / 8, 0)[:2])
                   for index in range(17))

    material = _material('Highlands/unified bridge weathered limestone', (.31, .30, .25), .91)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    coordinates = nodes.new('ShaderNodeTexCoord')
    diffuse = _texture(root, nodes, links, coordinates.outputs['UV'], 'old_stone_wall', 'diff', 'sRGB')
    normal = _texture(root, nodes, links, coordinates.outputs['UV'], 'old_stone_wall', 'nor', 'Non-Color')
    roughness = _texture(root, nodes, links, coordinates.outputs['UV'], 'old_stone_wall', 'rough', 'Non-Color')
    if any(texture is None for texture in (diffuse, normal, roughness)):
        raise FileNotFoundError('The entire castle bridge requires matching limestone diffuse, normal and roughness maps')
    tint = nodes.new('ShaderNodeMixRGB')
    tint.blend_type = 'MULTIPLY'
    tint.inputs[0].default_value = 1
    tint.inputs[2].default_value = (.78, .77, .70, 1)
    links.new(diffuse.outputs['Color'], tint.inputs[1])
    links.new(tint.outputs[0], shader.inputs['Base Color'])
    links.new(roughness.outputs['Color'], shader.inputs['Roughness'])
    shader.inputs['Specular IOR Level'].default_value = .20
    normal_map = nodes.new('ShaderNodeNormalMap')
    normal_map.inputs['Strength'].default_value = .55
    links.new(normal.outputs['Color'], normal_map.inputs['Color'])
    links.new(normal_map.outputs[0], shader.inputs['Normal'])

    def physical_masonry_uv(instance):
        mesh = instance.data
        uv = mesh.uv_layers.active or mesh.uv_layers.new(name='Physical bridge masonry')
        normals = instance.matrix_world.to_3x3().inverted().transposed()
        for polygon in mesh.polygons:
            world_normal = normals @ polygon.normal
            local_normal = (math.cos(angle) * world_normal.x + math.sin(angle) * world_normal.y,
                            math.sin(angle) * world_normal.x - math.cos(angle) * world_normal.y, world_normal.z)
            dominant = max(range(3), key=lambda axis: abs(local_normal[axis]))
            axes = [axis for axis in range(3) if axis != dominant]
            for loop_index in polygon.loop_indices:
                world = instance.matrix_world @ mesh.vertices[mesh.loops[loop_index].vertex_index].co
                point = ((world.x + 45) * math.cos(angle) + (world.y - 190) * math.sin(angle),
                         (world.x + 45) * math.sin(angle) - (world.y - 190) * math.cos(angle), world.z)
                uv.data[loop_index].uv = (point[axes[0]] / 3.5, point[axes[1]] / 3.5)

    vertices, faces = [], []

    def prism(first, last):
        start = len(vertices)
        vertices.extend(first)
        vertices.extend(last)
        faces.extend([(start, start + 1, start + 2, start + 3),
                      (start + 7, start + 6, start + 5, start + 4)])
        for index in range(4):
            following = (index + 1) % 4
            faces.append((start + index, start + following, start + 4 + following, start + 4 + index))

    def strip(first, last, across_min, across_max, low_first, low_last, high_first, high_last):
        prism([position(first, across_min, low_first), position(first, across_max, low_first),
               position(first, across_max, high_first), position(first, across_min, high_first)],
              [position(last, across_min, low_last), position(last, across_max, low_last),
               position(last, across_max, high_last), position(last, across_min, high_last)])

    landing = 250
    landing_point = position(landing, 7, 0)
    length = landing - endpoint
    ramp_length = 22

    def grade_weight(along):
        distance = max(0, min(length, along - endpoint))
        if distance < ramp_length:
            fraction = distance / ramp_length
            integral = ramp_length * (fraction ** 3 - .5 * fraction ** 4)
        elif distance > length - ramp_length:
            fraction = (length - distance) / ramp_length
            integral = length - ramp_length - ramp_length * (fraction ** 3 - .5 * fraction ** 4)
        else:
            integral = distance - ramp_length * .5
        return integral / (length - ramp_length)

    sample_count = math.ceil(length / .5)
    ground_profile = [(endpoint + length * index / sample_count,
                       cross_section_ground(endpoint + length * index / sample_count))
                      for index in range(sample_count + 1)]
    landing_height = max(height + 1.35 for along, height in ground_profile[-20:])
    for along, height in ground_profile:
        required_height = height + 1.35
        weight = grade_weight(along)
        if weight < .000001:
            if required_height > -11:
                raise ValueError('Terrain already intersects the original bridge connection')
            continue
        landing_height = max(landing_height, -11 + (required_height + 11) / weight)
    maximum_grade = abs(landing_height + 11) / (length - ramp_length)
    if maximum_grade > .18:
        raise ValueError(f'Bridge clearance requires an excessive grade: {maximum_grade}')

    def deck_height(along):
        return -11 + (landing_height + 11) * grade_weight(along)

    minimum_clearance = min(deck_height(along) - 1.1 - height for along, height in ground_profile)
    if minimum_clearance < .249:
        raise ValueError(f'Bridge underside intersects the sampled terrain: {minimum_clearance}')

    bridge_start = 28.95
    parapet_height = 1.02
    sections = math.ceil((landing - bridge_start) / 2)
    for index in range(sections):
        first = bridge_start + (landing - bridge_start) * index / sections - .012
        last = bridge_start + (landing - bridge_start) * (index + 1) / sections + .012
        first_height, last_height = deck_height(first), deck_height(last)
        strip(first, last, 3.6, 10.4, first_height - 1.1, last_height - 1.1, first_height, last_height)
        for across in [3.85, 10.15]:
            strip(first, last, across - .19, across + .19,
                  first_height - .05, last_height - .05,
                  first_height + parapet_height - .11, last_height + parapet_height - .11)
            strip(first, last, across - .23, across + .23,
                  first_height + parapet_height - .16, last_height + parapet_height - .16,
                  first_height + parapet_height, last_height + parapet_height)
    pier_starts = [30, 45, 62, 80, 101, 124, 148, 171, 192, 211, 227, 240, 250]
    foundations = []
    for index, along in enumerate(pier_starts):
        top_half_width = 1.35 if index in (0, len(pier_starts) - 1) else 1.65 + .48 * _smooth((along - 48) / 50) * (1 - _smooth((along - 174) / 58))
        base_half_width = top_half_width + .64
        footing = [position(along + offset, across, 0)
                   for offset in [-base_half_width, -base_half_width * .5, 0, base_half_width * .5, base_half_width]
                   for across in [3.68, 5.34, 7, 8.66, 10.32]]
        ground_samples = [ground(point[0], point[1]) for point in footing]
        bottom = min(ground_samples) - .65
        top = deck_height(along) - 1.02
        prism([position(along - base_half_width, 3.68, bottom), position(along + base_half_width, 3.68, bottom),
               position(along + base_half_width, 10.32, bottom), position(along - base_half_width, 10.32, bottom)],
              [position(along - top_half_width, 4.08, deck_height(along - top_half_width) - 1.02),
               position(along + top_half_width, 4.08, deck_height(along + top_half_width) - 1.02),
               position(along + top_half_width, 9.92, deck_height(along + top_half_width) - 1.02),
               position(along - top_half_width, 9.92, deck_height(along - top_half_width) - 1.02)])
        foundations.append({'along': along, 'bottom': bottom, 'top': top, 'top_half_width': top_half_width,
                            'base_half_width': base_half_width, 'actual_ground_minimum': min(ground_samples),
                            'minimum_burial_depth_metres': min(ground_samples) - bottom, 'ground_samples': len(ground_samples)})
    arch_spans = []
    for first_pier, last_pier in zip(foundations[:-1], foundations[1:]):
        first, last = first_pier['along'], last_pier['along']
        clear_first = first + first_pier['top_half_width'] - .08
        clear_last = last - last_pier['top_half_width'] + .08
        if clear_last <= clear_first:
            continue
        midpoint = (clear_first + clear_last) * .5
        rise = min((clear_last - clear_first) * .46,
                   max(1.2, (deck_height(midpoint) - 1.1 - cross_section_ground(midpoint, 2.92)) * .72))
        arch_spans.append({'first_chainage': first, 'last_chainage': last,
                           'clear_span_metres': clear_last - clear_first, 'arch_rise_metres': rise})
        for section in range(32):
            low_fraction, high_fraction = section / 32, (section + 1) / 32
            low_along = clear_first + (clear_last - clear_first) * low_fraction
            high_along = clear_first + (clear_last - clear_first) * high_fraction
            low_depth = .64 + rise * (1 - math.sqrt(max(0, 1 - (low_fraction * 2 - 1) ** 2)))
            high_depth = .64 + rise * (1 - math.sqrt(max(0, 1 - (high_fraction * 2 - 1) ** 2)))
            strip(low_along, high_along, 4.08, 9.92,
                  max(deck_height(low_along) - 1.1 - low_depth, cross_section_ground(low_along, 2.92) - .18),
                  max(deck_height(high_along) - 1.1 - high_depth, cross_section_ground(high_along, 2.92) - .18),
                  deck_height(low_along) - 1.06, deck_height(high_along) - 1.06)
    path_start = Vector(landing_point[:2])
    path_control = path_start + Vector((math.cos(angle), math.sin(angle))) * 11
    path_end = Vector((179.27, 268.69))
    previous = None
    previous_center = None
    approach_length = 0
    approach_grade = 0
    approach_lift = landing_height - cross_section_ground(landing) - .05
    approach_rows = []
    for index in range(81):
        fraction = index / 80
        center = path_start * (1 - fraction) ** 2 + path_control * 2 * fraction * (1 - fraction) + path_end * fraction ** 2
        tangent = (path_control - path_start) * (1 - fraction) + (path_end - path_control) * fraction
        tangent.normalize()
        across = Vector((-tangent.y, tangent.x))
        half_width = 3.4 * (1 - _smooth(fraction)) + 1.15 * _smooth(fraction)
        points = [center + across * half_width * side for side in [-1, 1]]
        surface_height = max(ground(*(center + across * half_width * offset / 8)) for offset in range(-8, 9))
        if previous_center is not None:
            approach_length += (center - previous_center).length
        rise = approach_lift * (1 - _smooth(approach_length / 26))
        elevation = surface_height + .05 + rise
        if index == 0:
            elevation = landing_height
        current = [(point.x, point.y, elevation) for point in points]
        approach_rows.append((approach_length, elevation, surface_height))
        low = []
        for side in [-1, 1]:
            point = center + across * half_width * side
            low.append((point.x, point.y, ground(point.x, point.y) - .4))
        if previous is not None:
            prism([previous[0][0], previous[0][1], previous[1][1], previous[1][0]],
                  [low[0], low[1], current[1], current[0]])
            approach_grade = max(approach_grade, abs(elevation - previous[1][0][2]) / (center - previous_center).length)
        previous, previous_center = (low, current), center
    if approach_grade > .18:
        raise ValueError(f'Bridge shore approach exceeds the maximum walking grade: {approach_grade}')
    if abs(approach_rows[0][1] - deck_height(landing)) > .00001:
        raise ValueError('Bridge approach does not meet the deck without a step')
    mesh = bpy.data.meshes.new('Highlands/continuous sloping stone viaduct to shore')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    topology = bmesh.new()
    topology.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
    topology.to_mesh(mesh)
    topology.free()
    mesh.materials.append(material)
    instance = bpy.data.objects.new('Highlands/complete descending lake crossing', mesh)
    collection.objects.link(instance)
    physical_masonry_uv(instance)
    bevel = instance.modifiers.new('Weathered masonry edge', 'BEVEL')
    bevel.width, bevel.segments = .025, 2
    for source in original_decks + original_rails + original_piers:
        source.hide_render = True
        source.hide_set(True)
        source['replaced_by_unified_stone_bridge'] = True
    if any(source.hide_render != visibility for source, visibility in unrelated_visibility.items()):
        raise ValueError('Bridge reconstruction changed unrelated castle or terrain visibility')
    observer = Vector((0, 2, 1.72))
    bridge_sightlines = []
    for along in range(112, 209, 6):
        target = Vector(position(along, 7, deck_height(along) + .75))
        ray = target - observer
        hit = terrain_bvh.ray_cast(observer, ray.normalized(), ray.length - .2)[0]
        bridge_sightlines.append({'chainage': along, 'clear_of_far_terrain': hit is None})
    return {'verified_original_endpoint': endpoint, 'landing_chainage': landing,
            'landing_world': list(landing_point[:2]) + [landing_height], 'maximum_bridge_grade': maximum_grade,
            'minimum_deck_underside_clearance': minimum_clearance, 'full_width_profile_samples': len(ground_profile) * 17,
            'shore_approach_maximum_grade': approach_grade, 'shore_approach_length': approach_length,
            'landing_step_metres': abs(approach_rows[0][1] - deck_height(landing)),
            'foundation_count': len(foundations), 'landfall_ground_sampled_from_actual_mesh': True,
            'original_decks_replaced': len(original_decks), 'original_parapets_replaced': len(original_rails),
            'original_thin_piers_replaced': len(original_piers), 'tapered_foundations': foundations,
            'continuous_parapet_top_metres': parapet_height, 'unified_deck_thickness_metres': 1.1,
            'shared_masonry_tile_metres': 3.5, 'continuous_arch_spans': len(arch_spans), 'arch_span_geometry': arch_spans,
            'observer_bridge_sightlines': bridge_sightlines,
            'clear_bridge_sightline_count': sum(sample['clear_of_far_terrain'] for sample in bridge_sightlines)}


def _original_grass(scene, descriptor):
    geometries = {item['id']: item for item in descriptor['geometry']}
    box_ids = set()
    for identifier, geometry in geometries.items():
        positions = geometry.get('positions', [])
        if len(positions) == 72 and all(abs(min(positions[axis::3]) + .5) < .00001 and abs(max(positions[axis::3]) - .5) < .00001 for axis in range(3)):
            box_ids.add(identifier)
    basis = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    targets = []
    for clump in range(18):
        horizontal = (-1 if clump % 2 else 1) * (8.5 + clump % 3)
        depth, scale = -1 + clump, 1 + (clump % 3) * .2
        group = Matrix.Translation((horizontal, 0, depth)) @ Matrix.Scale(scale, 4)
        for blade in range(9):
            angle, lean = blade * 2.399, .15 + (blade % 3) * .06
            position = Matrix.Translation((math.cos(angle) * .12, .22, math.sin(angle) * .12))
            rotation = Matrix.Rotation(angle, 4, 'Y') @ Matrix.Rotation(math.cos(angle) * lean, 4, 'Z')
            size = Matrix.Diagonal((.025, .45 + (blade % 2) * .2, .025, 1))
            expected = group @ position @ rotation @ size
            matches = []
            for item in descriptor['objects']:
                if item['geometry'] not in box_ids:
                    continue
                matrix = item['matrix']
                if max(abs(matrix[column * 4 + row] - expected[row][column]) for row in range(4) for column in range(4)) < .00001:
                    matches.append(item)
            if len(matches) != 1:
                raise ValueError('Original grassTuft descriptor changed; refusing imprecise grass replacement')
            targets.append(basis @ expected @ basis.inverted())
    imported = []
    candidates = [instance for instance in scene.objects if instance.type == 'MESH' and len(instance.data.vertices) == 24]
    for matrix in targets:
        matches = [instance for instance in candidates
                   if max(abs(instance.matrix_world[row][column] - matrix[row][column]) for row in range(4) for column in range(4)) < .00001]
        if len(matches) != 1:
            raise ValueError('Original grassTuft mesh changed; refusing imprecise grass replacement')
        imported.append(matches[0])
    if len(set(imported)) != 162:
        raise ValueError('Expected 18 original grassTuft groups of nine blades')
    return imported


def refine(scene, descriptor, asset_root=None):
    if descriptor.get('scene') != 'hogwarts':
        return {'skipped': True, 'reason': 'not hogwarts'}
    if bpy.data.collections.get('NightWorld/highlands refinements'):
        return {'skipped': True, 'reason': 'already refined'}
    root = Path(asset_root) if asset_root else Path(__file__).resolve().parent.parent
    helper = runpy.run_path(str(root / 'scripts/refine-terrain.py'))
    geometry = helper['_descriptor_geometry'](descriptor)
    candidates = [instance for instance in scene.objects if instance.type == 'MESH' and len(instance.data.vertices) == 48841]
    matches = []
    for instance in candidates:
        if all(max(abs((instance.matrix_world @ instance.data.vertices[index].co)[axis] - expected) for axis, expected in enumerate((geometry['positions'][index * 3], -geometry['positions'][index * 3 + 2], geometry['positions'][index * 3 + 1]))) < .0001 for index in range(48841)):
            matches.append(instance)
    near = [instance for instance in scene.objects if instance.type == 'MESH' and len(instance.data.vertices) == 40401]
    if len(matches) != 1 or len(near) != 1:
        raise ValueError('Could not uniquely identify highland far and near meshes; no changes made')
    original_grass = _original_grass(scene, descriptor)
    collection = bpy.data.collections.new('NightWorld/highlands refinements')
    scene.collection.children.link(collection)
    instance, vertices = _far_mesh(collection, geometry, helper, root)
    boundary = {(round(vertex.co.x, 4), round(vertex.co.y, 4)): vertex.co.z for vertex in near[0].data.vertices
                if abs(max(abs(vertex.co.x), abs(vertex.co.y)) - INNER_RADIUS) < .0001}
    error = max(abs(height - boundary[(round(horizontal, 4), round(north, 4))]) for horizontal, north, height in vertices[:800])
    if error > .0001:
        raise ValueError('Highland foreground seam exceeds 0.1 mm')
    near_geometry = next(item for item in descriptor['geometry'] if len(item.get('positions', [])) == 40401 * 3)
    boundary_normals = {}
    for index in range(40401):
        position = near_geometry['positions'][index * 3:index * 3 + 3]
        normal = near_geometry.get('normals', [])[index * 3:index * 3 + 3]
        if len(normal) == 3 and abs(max(abs(position[0]), abs(position[2])) - INNER_RADIUS) < .0001:
            boundary_normals[(round(position[0], 4), round(-position[2], 4))] = (normal[0], -normal[2], normal[1])
    if len(boundary_normals) == 800:
        normals = [boundary_normals[(round(vertex[0], 4), round(vertex[1], 4))] if index < 800 else tuple(instance.data.vertices[index].normal)
                   for index, vertex in enumerate(vertices)]
        instance.data.normals_split_custom_set_from_vertices(normals)
    lip_report = _lower_observation_lip(near[0])
    _near_meadow(near[0], root)
    ground = _near_height_sampler(near[0])
    footpath_grades = [abs(ground(*last) - ground(*first)) / math.dist(first, last)
                      for first, last in zip(FOOTPATH[:-1], FOOTPATH[1:])]
    if max(footpath_grades) > .18 or math.dist(FOOTPATH[0], FOOTPATH[-1]) > .001:
        raise ValueError('Highland overlook footpath must form a continuous gentle loop before the cliff edges')
    grass_report = _grass(collection, ground)
    gravel_report = _gravel(collection, ground)
    water_report = _lake_water(scene, collection)
    boulder_report = _weathered_boulders(scene, descriptor, ground)
    pier_report = _bridge_foundations(scene, geometry, helper)
    bridge_report = _complete_bridge(scene, collection, instance, root)
    for blade in original_grass:
        blade.hide_render = True
        blade.hide_set(True)
        blade['replaced_original_grass_tuft'] = True
    matches[0].hide_render = True
    matches[0].hide_set(True)
    matches[0]['replaced_by_highlands'] = True
    result = {'far_replaced': matches[0].name, 'near_boundary_preserved': near[0].name,
              'seam_error_metres': error, 'grass_clumps': grass_report['clumps'], 'extent_metres': 3600,
              'castle_foundation_height': _landform(-45, 190), 'lake_height': -34,
              'original_grass_blades_hidden': len(original_grass), 'near_lip': lip_report,
              'surface_tile_metres': 3.5,
              'bedrock_source': _land_material(root).get('tileable_bedrock_source', 'procedural fallback'),
              'far_surface_source': _land_material(root, use_leafy=False).get('grass_surface_source'),
              'grass_surface_source': _land_material(root).get('grass_surface_source'),
              'grass_surface_tile_metres': _land_material(root).get('grass_surface_tile_metres'),
              'grass_surface_scale_provenance': _land_material(root).get('grass_surface_scale_provenance'),
              'observation_ground_height': ground(0, 2), 'observation_ground_preserved': True,
              'grass_blades': grass_report['blades'], 'grass_geometry': grass_report, 'physical_water': water_report,
              'foreground_gravel': gravel_report,
              'overlook_footpath': {'continuous_loop': True, 'maximum_grade': max(footpath_grades),
                                     'northern_limit_metres': max(point[1] for point in FOOTPATH),
                                     'eastern_limit_metres': max(point[0] for point in FOOTPATH),
                                     'shared_wear_and_vegetation_distance_field': True},
              'foreground_boulders': boulder_report, 'bridge_foundations': pier_report,
              'protected_castle_core_radius': .86, 'island_ring_spacing_metres': 2.5,
              'castle_island_local_center': ISLAND_CENTER, 'castle_island_semiaxes_metres': ISLAND_RADII,
              'bridge_completion': bridge_report}
    print('HIGHLANDS_REFINEMENT', result)
    return result
