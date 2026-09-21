"""Street-level ruins and an open-air inhabited courtyard for offline panoramas."""
import json
import math
import random
import runpy
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


ROOT = Path(__file__).resolve().parent
COLLECTION = 'Wasteland street settlement hero v1'


def _library_material(builder, name, asset, tint, repeat):
    surface = builder.materials[name] = builder.materials['concrete'].copy()
    surface.name = 'Wasteland/' + name
    nodes, links = surface.node_tree.nodes, surface.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    links.new(shader.outputs[0], output.inputs['Surface'])
    coordinates = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeVectorMath')
    mapping.operation = 'SCALE'
    mapping.inputs[3].default_value = repeat
    links.new(coordinates.outputs['UV'], mapping.inputs[0])
    for suffix in ('diff', 'nor', 'rough'):
        source = ROOT.parent / 'assets/life/textures/library' / asset / f'{asset}_{suffix}_2k.jpg'
        if not source.is_file():
            raise FileNotFoundError(source)
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(source), check_existing=True)
        texture.image.colorspace_settings.name = 'sRGB' if suffix == 'diff' else 'Non-Color'
        links.new(mapping.outputs[0], texture.inputs['Vector'])
        if suffix == 'diff':
            multiply = nodes.new('ShaderNodeMixRGB')
            multiply.blend_type = 'MULTIPLY'
            multiply.inputs[0].default_value = 1
            multiply.inputs[2].default_value = (*tint, 1)
            links.new(texture.outputs['Color'], multiply.inputs[1])
            links.new(multiply.outputs[0], shader.inputs['Base Color'])
        elif suffix == 'rough':
            roughness = nodes.new('ShaderNodeMapRange')
            roughness.inputs['To Min'].default_value = .68
            roughness.inputs['To Max'].default_value = .98
            links.new(texture.outputs[0], roughness.inputs[0])
            links.new(roughness.outputs[0], shader.inputs['Roughness'])
        else:
            normal = nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value = .5
            links.new(texture.outputs[0], normal.inputs['Color'])
            links.new(normal.outputs[0], shader.inputs['Normal'])
    return surface


def _ruin_surface(builder, name, source, tint, seed):
    surface = builder.materials[source].copy()
    surface.name = 'Wasteland/' + name
    nodes, links = surface.node_tree.nodes, surface.node_tree.links
    shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
    base = shader.inputs['Base Color']
    incoming = base.links[0].from_socket if base.links else None
    color = tuple(base.default_value)
    coordinates = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeVectorMath')
    mapping.operation = 'MULTIPLY'
    mapping.inputs[1].default_value = (1.6, 1.6, .075)
    links.new(coordinates.outputs['Object'], mapping.inputs[0])
    stains = nodes.new('ShaderNodeTexNoise')
    stains.noise_dimensions = '4D'
    stains.inputs['Scale'].default_value = 1
    stains.inputs['W'].default_value = seed
    stains.inputs['Detail'].default_value = 4
    links.new(mapping.outputs[0], stains.inputs['Vector'])
    weather = nodes.new('ShaderNodeValToRGB')
    weather.color_ramp.elements[0].position = .26
    weather.color_ramp.elements[0].color = (.48, .46, .41, 1)
    weather.color_ramp.elements[1].position = .52
    weather.color_ramp.elements[1].color = (*tint, 1)
    links.new(stains.outputs['Fac'], weather.inputs[0])
    mineral = nodes.new('ShaderNodeMixRGB')
    mineral.blend_type = 'MIX'
    mineral.inputs[0].default_value = .22
    mineral.inputs[2].default_value = (.42, .41, .37, 1)
    if incoming:
        links.new(incoming, mineral.inputs[1])
    else:
        mineral.inputs[1].default_value = color
    multiply = nodes.new('ShaderNodeMixRGB')
    multiply.blend_type = 'MULTIPLY'
    multiply.inputs[0].default_value = 1
    links.new(mineral.outputs[0], multiply.inputs[1])
    links.new(weather.outputs[0], multiply.inputs[2])
    links.new(multiply.outputs[0], base)
    fine_noise = nodes.new('ShaderNodeTexNoise')
    fine_noise.name = 'Physical aggregate and salt-pitting at 4 cm scale'
    fine_noise.noise_dimensions = '4D'
    fine_noise.inputs['Scale'].default_value = 25.0
    fine_noise.inputs['Detail'].default_value = 5.0
    fine_noise.inputs['Roughness'].default_value = .72
    fine_noise.inputs['W'].default_value = seed * .37 + 4.0
    physical = nodes.new('ShaderNodeNewGeometry')
    links.new(physical.outputs['Position'], fine_noise.inputs['Vector'])
    fine_bump = nodes.new('ShaderNodeBump')
    fine_bump.name = 'Millimetre aggregate relief, not a flat colour overlay'
    fine_bump.inputs['Strength'].default_value = .16
    fine_bump.inputs['Distance'].default_value = .018
    links.new(fine_noise.outputs['Fac'], fine_bump.inputs['Height'])
    normal_input = shader.inputs['Normal']
    if normal_input.links:
        links.new(normal_input.links[0].from_socket, fine_bump.inputs['Normal'])
        for link in list(normal_input.links):
            links.remove(link)
    links.new(fine_bump.outputs['Normal'], normal_input)
    for link in list(shader.inputs['Roughness'].links):
        links.remove(link)
    shader.inputs['Roughness'].default_value = .93
    surface['weathering_coordinates'] = 'physical world-space rain streaks; existing PBR normals retained'
    return surface


def _ruin_bar(batch, first, last, radius, material=5):
    first, last = Vector(first), Vector(last)
    axis = last - first
    if axis.length < .001:
        return
    rotation = axis.to_track_quat('Z', 'Y')
    offsets = [rotation @ Vector((math.cos(section * math.tau / 10) * radius,
                                  math.sin(section * math.tau / 10) * radius, 0)) for section in range(10)]
    batch.prism([first + offset for offset in offsets], [last + offset for offset in offsets], material)


def _broken_panel(batch, place, first, last, bottom, top, depth, randomizer, material, damage=.12):
    if last - first < .02 or top - bottom < .035:
        return
    profile = [(first, bottom), (last, bottom)]
    for section in range(7):
        across = last - (last - first) * section / 6
        chipped = randomizer.uniform(0, min(damage, (top - bottom) * .36))
        profile.append((across, top - chipped))
    batch.prism([place(across, depth + .17, elevation) for across, elevation in profile],
                [place(across, depth - .17, elevation) for across, elevation in profile], material)


def _urban_facade_remnants(batch, detail, place, width, length, floor_height, building_index, style, front_side):
    street_face = front_side * length / 2
    if building_index < 6:
        fascia_width = width * (.56 if style == 1 else .72)
        batch.box((0, street_face + front_side * .28, 3.02), (fascia_width, .22, .49), place, 5 if style == 3 else 4)
        for end in (-1, 1):
            batch.box((end * fascia_width * .47, street_face + front_side * .43, 3.02), (.035, .06, .41), place, 0)
        for glyph in range(8):
            horizontal = -fascia_width * .31 + glyph * fascia_width * .083
            if (glyph + building_index) % 5 == 0:
                continue
            batch.box((horizontal, street_face + front_side * .398, 3.035), (.115, .014, .21), place, 6)
            if glyph % 3:
                batch.box((horizontal + .062, street_face + front_side * .397, 2.982), (.105, .015, .05), place, 6)
        for bay in (-1, 1):
            shop_x = bay * width * .22
            for edge in (-1, 1):
                batch.box((shop_x + edge * width * .16, street_face + front_side * .21, 1.38),
                          (.115, .13, 2.70), place, 4)
            for slat in range(10 + (building_index + bay) % 7):
                elevation = 2.70 - slat * .105
                for section in range(3):
                    horizontal = shop_x + (section - 1) * width * .104
                    detail.box((horizontal, street_face + front_side * (.235 + math.sin(slat * 1.1) * .018), elevation),
                               (width * .105, .028, .084), place, 4 if slat % 5 else 5)
    if style in (0, 2):
        for horizontal in (-width * .40, width * .39):
            first = place(horizontal, street_face + front_side * .23, .22)
            last = place(horizontal, street_face + front_side * .23, floor_height * (3 if building_index < 6 else 2))
            _ruin_bar(detail, first, last, .037, 5)
            for clip in range(5):
                elevation = .75 + clip * 1.7
                detail.box((horizontal, street_face + front_side * .24, elevation), (.14, .105, .045), place, 5)
    if building_index < 10:
        service_x = (-.31 if building_index % 2 else .26) * width
        service_level = floor_height * (1.18 + (building_index % 3) * .24)
        service_depth = street_face + front_side * .31
        batch.box((service_x, service_depth, service_level), (.72, .16, .46), place, 4)
        detail.box((service_x, street_face + front_side * .405, service_level), (.57, .024, .31), place, 5)
        for grille in range(7):
            grille_x = service_x - .25 + grille * .083
            _ruin_bar(detail, place(grille_x, street_face + front_side * .425, service_level - .13),
                      place(grille_x, street_face + front_side * .425, service_level + .13), .011, 5)
        pipe_x = service_x + (.51 if building_index % 2 else -.51)
        _ruin_bar(detail, place(pipe_x, street_face + front_side * .39, service_level - .21),
                  place(pipe_x, street_face + front_side * .39, .25), .025, 4)
        for clamp_level in (.48, 1.34, 2.20):
            if clamp_level < service_level - .2:
                detail.box((pipe_x, street_face + front_side * .405, clamp_level), (.12, .035, .065), place, 5)
        if building_index % 3 == 0:
            tank_x = -width * .30
            tank_y = street_face + front_side * .52
            tank_z = floor_height * 2.05
            batch.box((tank_x, tank_y, tank_z), (.34, .30, .58), place, 4)
            detail.box((tank_x, street_face + front_side * .685, tank_z), (.23, .024, .39), place, 5)
    if building_index in (0, 2, 4):
        across = width * .34
        outer = street_face + front_side * 1.03
        flights = 3 if building_index == 0 else 2
        for level in range(1, flights + 1):
            elevation = level * floor_height
            for bearer in (-1, 1):
                batch.box((across + bearer * .56, (street_face + outer) / 2, elevation - .09), (.08, 1.08, .18), place, 5)
            for plank in range(11):
                batch.box((across - .55 + plank * .11, (street_face + outer) / 2, elevation + .025), (.065, 1.10, .038), place, 4)
            _ruin_bar(detail, place(across - .62, outer, elevation + 1.05), place(across + .65, outer, elevation + 1.05), .024, 5)
            for post in range(6):
                horizontal = across - .60 + post * .24
                _ruin_bar(detail, place(horizontal, outer, elevation + .025), place(horizontal, outer, elevation + 1.05), .015, 5)
            landing = across - .65 if level % 2 else across + .65
            direction = -1 if level % 2 else 1
            for step in range(18):
                ratio = step / 17
                horizontal = landing + direction * ratio * 2.45
                batch.box((horizontal, outer - front_side * .42, elevation - ratio * floor_height + .06),
                          (.16, .75, .042), place, 5)
            for edge in (-1, 1):
                _ruin_bar(detail, place(landing, outer - front_side * .42 + edge * .39, elevation + .06),
                          place(landing + direction * 2.45, outer - front_side * .42 + edge * .39, elevation - floor_height + .06), .044, 5)
                _ruin_bar(detail, place(landing, outer - front_side * .42 + edge * .39, elevation + .92),
                          place(landing + direction * 2.45, outer - front_side * .42 + edge * .39, elevation - floor_height + .92), .022, 5)
                for upright in range(6):
                    progress = upright / 5
                    horizontal = landing + direction * 2.45 * progress
                    altitude = elevation - floor_height * progress
                    _ruin_bar(detail, place(horizontal, outer - front_side * .42 + edge * .39, altitude + .055),
                              place(horizontal, outer - front_side * .42 + edge * .39, altitude + .94), .014, 5)


def _ruins(scene, builder, helpers):
    targets = [instance for instance in scene.objects if instance.get('offline_role') == 'wasteland-building']
    if len(targets) < 8:
        raise ValueError('Street settlement needs at least eight explicitly tagged surrounding buildings')
    industrial = runpy.run_path(str(ROOT / 'refine-city-industrial.py'))
    industrial_report = industrial['refine'](scene, builder, helpers, targets)
    styles = ('rendered tenement', 'reinforced office frame', 'masonry apartment', 'industrial warehouse')
    palette = ((1.18, 1.07, .80), (.80, .94, 1.02), (1.10, .68, .42), (.86, .92, .69))
    definitions = [(json.loads(source['offline_parameters']), helpers['bounds'](source)[0]) for source in targets]
    background = ((-38, 124, 24, 22, 6), (34, 142, 28, 21, 8), (-20, 170, 26, 24, 5),
                  (18, 207, 32, 24, 9), (-45, 223, 25, 27, 7), (48, 238, 32, 22, 6),
                  (-30, -110, 22, 21, 5), (29, -137, 28, 23, 8), (-29, -164, 31, 25, 7),
                  (12, -200, 30, 24, 6), (-49, -228, 29, 25, 9), (49, -243, 33, 22, 7))
    for across, north, width, length, floors in background:
        definitions.append(({'width': width, 'length': length, 'height': floors * 3.25,
                             'floors': floors, 'yaw': 0}, Vector((across, north, 0))))
    batches, reports = [], []
    for building_index, (parameters, center) in enumerate(definitions):
        if building_index in industrial['REPLACED_BUILDINGS']:
            continue
        width, length, height = (float(parameters[key]) for key in ('width', 'length', 'height'))
        floors = int(parameters['floors'])
        if building_index in (2, 3, 5):
            floors -= 2
            height = floors * 3.3
        if building_index in (6, 8, 9, 11, 14):
            floors = {6: 10, 8: 8, 9: 12, 11: 9, 14: 7}[building_index]
            height = floors * 3.3
        if not (width > 3 and length > 3 and floors >= 2 and height > 5):
            raise ValueError('Invalid street building dimensions')
        yaw = round(float(parameters.get('yaw', 0)) / (math.pi / 2)) * (math.pi / 2)
        transform = Matrix.Translation((center.x, center.y, -.025)) @ Matrix.Rotation(yaw, 4, 'Z')
        randomizer = random.Random(8623 + building_index * 173)
        style = building_index % len(styles)
        material_list = [
            _ruin_surface(builder, f'building {building_index:02d} stained aggregate concrete', 'concrete', (.84, .88, .83), building_index * 7.17),
            _ruin_surface(builder, f'building {building_index:02d} weathered facade', 'masonry' if style in (2, 3) else 'plaster', palette[style], building_index * 13.8),
            _ruin_surface(builder, f'building {building_index:02d} exposed masonry core', 'masonry', (.81, .65, .47), 8 + building_index * 3.6),
            builder.materials['dark'], builder.materials['steel'],
            helpers['material'](f'building {building_index:02d} oxidized reinforcement', '#604832', .91, .12, .001),
            _ruin_surface(builder, f'building {building_index:02d} peeling interior paint', 'plaster', (.79, .86, .70), 11 + building_index),
        ]
        batch = helpers['batch'](builder.collection, f'Wasteland/ruin {building_index:02d} {styles[style]} fractured shell', material_list)
        detail = helpers['batch'](builder.collection, f'Wasteland/ruin {building_index:02d} exposed reinforcement and facade detail', material_list)
        floor_height = height / floors
        damage_mode = ('retained shell', 'corner collapse', 'diagonal shear', 'partial upper bay')[building_index % 4]
        damage_start = floor_height * (floors - (2 + building_index % 3))
        damage_center = width * randomizer.uniform(-.23, .23)
        damage_radius = width * randomizer.uniform(.13, .20)
        damage_depth = min(3.8, length * randomizer.uniform(.13, .22))
        crown_start = max(2, floors - 3)
        crown_loss = width * (.27 if building_index % 4 == 1 else .16 if building_index % 4 == 2 else 0)
        crown_side = -1 if building_index % 3 == 0 else 1
        local_observer = transform.inverted() @ Vector((0, -2.8, 1.72))
        damaged_side = 1 if local_observer.y > 0 else -1
        fracture_count = 0
        collapsed_count = 0
        rebar_count = 0

        def place(horizontal, forward, elevation):
            return transform @ Vector((horizontal, forward, elevation))

        def bite(horizontal, elevation):
            if damage_mode == 'retained shell' or elevation <= damage_start:
                return 0
            progress = min(1, (elevation - damage_start) / max(floor_height, height - damage_start))
            centerline = damage_center
            radius = damage_radius * (.45 + .70 * progress)
            if damage_mode == 'corner collapse':
                centerline = crown_side * width * .49
                radius = width * (.10 + .20 * progress)
            elif damage_mode == 'diagonal shear':
                centerline += width * .31 * (progress - .5)
            elif damage_mode == 'partial upper bay':
                radius *= .67
            if abs(horizontal - centerline) >= radius:
                return 0
            segment = math.floor((horizontal - damage_center + damage_radius) / .39)
            floor_offset = max(0, round((elevation - damage_start) / floor_height) - 1)
            fracture = (.0, .21, -.08, .12, -.03, .26, .05)[(segment + building_index) % 7]
            falloff = 1 - abs(horizontal - centerline) / radius
            return max(.45, damage_depth * (.35 + .65 * falloff) + fracture + (.0, .14, -.09, .08)[floor_offset % 4])

        def crown_limits(level):
            setback = crown_loss * max(0, (level - crown_start) / (floors - crown_start))
            return (-width / 2 + (setback if crown_side < 0 else 0),
                    width / 2 - (setback if crown_side > 0 else 0))

        bay_count = max(3, round(width / (2.75, 4.65, 3.1, 4.9)[style]))
        bay_weights = [randomizer.uniform(.84, 1.16) for _ in range(bay_count)]
        boundaries = [-width / 2]
        for weight in bay_weights:
            boundaries.append(boundaries[-1] + width * weight / sum(bay_weights))
        for floor in range(floors + 1):
            elevation = floor * floor_height
            slab_first, slab_last = crown_limits(floor)
            perimeter = []
            for side in (-1, 1):
                sections = range(33) if side == -1 else reversed(range(33))
                for section in sections:
                    horizontal = slab_first + section / 32 * (slab_last - slab_first)
                    inset = bite(horizontal, elevation) if side == damaged_side else 0
                    chip = randomizer.uniform(.015, .09) if inset > 0 else 0
                    perimeter.append((horizontal, side * (length / 2 - inset - chip)))
            batch.prism([place(horizontal, forward, elevation + .23) for horizontal, forward in perimeter],
                        [place(horizontal, forward, elevation) for horizontal, forward in perimeter], 0)
            if floor == floors:
                for horizontal in (slab_first + .35, slab_last - .35):
                    far_side = -damaged_side * (length / 2 - .6)
                    batch.box((horizontal, far_side, elevation + .4), (.45, .45, .8), place, 2)
                continue
            ceiling = elevation + floor_height
            upper_first, upper_last = crown_limits(floor + 1)
            for side in (-1, 1):
                for bay, (first, last) in enumerate(zip(boundaries[:-1], boundaries[1:])):
                    first, last = max(first, upper_first), min(last, upper_last)
                    if last - first < .42:
                        continue
                    span, middle = last - first, (last + first) / 2
                    lower_loss = bite(middle, elevation) if side == damaged_side else 0
                    upper_loss = bite(middle, ceiling) if side == damaged_side else 0
                    damage = upper_loss > .42
                    column_x = first + .21
                    column_loss = bite(column_x, ceiling) if side == damaged_side else 0
                    column_top = ceiling - (randomizer.uniform(.38, 1.72) if column_loss > .35 else 0)
                    if lower_loss < .30 and column_top > elevation + .35 and (style in (1, 3) or bay in (0, bay_count - 1)):
                        batch.box((column_x, side * (length / 2 - .10), (elevation + column_top) / 2),
                                  (.36, .39, column_top - elevation), place, 0)
                        if column_loss > .35:
                            for bar_offset in (-.095, .095):
                                start = place(column_x + bar_offset, side * (length / 2 - .10), column_top - .10)
                                bend = start + Vector((.10 * side, -.05 * side, randomizer.uniform(.33, .72)))
                                end = bend + Vector((.18 * side, -.16 * side, .12))
                                _ruin_bar(detail, start, bend, .012)
                                _ruin_bar(detail, bend, end, .012)
                                rebar_count += 2

                    def facade(horizontal, depth, altitude):
                        return place(horizontal, side * (length / 2 + depth), altitude)

                    if lower_loss > .25:
                        fracture_count += 1
                        if floor > 0:
                            for bar_index in range(4):
                                horizontal = first + span * (bar_index + .5) / 4
                                retained_edge = side * (length / 2 - bite(horizontal, elevation) - .14)
                                start = place(horizontal, retained_edge - side * .26, elevation + .11)
                                bend = place(horizontal + randomizer.uniform(-.07, .07), retained_edge + side * .35, elevation + .10)
                                end = place(horizontal + randomizer.uniform(-.19, .19), retained_edge + side * .66, elevation - randomizer.uniform(.15, .55))
                                _ruin_bar(detail, start, bend, .012)
                                _ruin_bar(detail, bend, end, .012)
                                rebar_count += 2
                        continue
                    sill = elevation + (.88, .91, 1.01, .94)[style]
                    header = ceiling - (.43, .40, .62, .53)[style]
                    if damage:
                        _broken_panel(batch, facade, first + .08, last - .08, elevation + .23,
                                      elevation + randomizer.uniform(.52, 1.25), 0, randomizer, 2, .38)
                        fracture_count += 1
                        if floor > 1 and building_index < 9 and bay % 2 == 0:
                            retained = side * (length / 2 - bite(middle, ceiling) - .20)
                            broken_edge = side * (length / 2 - .24)
                            upper = [(first + .25, retained, ceiling - .20), (last - .20, retained, ceiling - .20),
                                     (last - .52, broken_edge, elevation + .34), (middle + .17, broken_edge + side * .13, elevation + .42),
                                     (first + .42, broken_edge, elevation + .38)]
                            batch.prism([place(*point) for point in upper],
                                        [place(horizontal, forward, altitude - .18) for horizontal, forward, altitude in upper], 0)
                            collapsed_count += 1
                        continue
                    solid_bay = style in (0, 2) and (bay == (building_index + 1) % bay_count or
                                                 (floor > 0 and randomizer.random() < .12))
                    if solid_bay:
                        _broken_panel(batch, facade, first + .035, last - .035, elevation + .23,
                                      ceiling, 0, randomizer, 1, .06)
                        continue
                    opening = span * (.51, .78, .41, .70)[style]
                    left, right = middle - opening / 2, middle + opening / 2
                    _broken_panel(batch, facade, first + .035, last - .035, elevation + .23, sill, 0, randomizer, 1, .06)
                    _broken_panel(batch, facade, first + .035, last - .035, header, ceiling, 0, randomizer, 1, .075)
                    _broken_panel(batch, facade, first + .035, left, sill, header, 0, randomizer, 1, .10)
                    _broken_panel(batch, facade, right, last - .035, sill, header, 0, randomizer, 1, .10)
                    if style in (0, 2):
                        batch.box((middle, side * (length / 2 + .23), sill - .035), (opening + .18, .19, .095), place, 0)
                    if style == 0 and floor > 0 and (bay + floor + building_index) % 4 != 1:
                        window_back = side * (length / 2 - .27)
                        detail.box((middle, window_back, (sill + header) / 2), (opening - .08, .018, header - sill - .07),
                                   place, 6 if (bay + floor) % 3 else 4)
                        if (bay + floor) % 3 == 0:
                            _ruin_bar(detail, place(left + .025, side * (length / 2 + .018), sill + .08),
                                      place(right - .025, side * (length / 2 + .018), header - .09), .042, 5)
                    if style == 2 and floor < 5 and bay % 3 == 0:
                        patch_width = span * .53
                        patch_height = min(.64, sill - elevation - .27)
                        patch = [(middle - patch_width / 2, elevation + .25),
                                 (middle + patch_width * .43, elevation + .24),
                                 (middle + patch_width * .50, elevation + .25 + patch_height * .67),
                                 (middle + patch_width * .11, elevation + .25 + patch_height),
                                 (middle - patch_width * .36, elevation + .25 + patch_height * .91)]
                        detail.face([facade(across, .178, altitude) for across, altitude in patch], 6)
                    frame_depth = -.035
                    if randomizer.random() > .23:
                        for edge in (left + .045, right - .045):
                            _ruin_bar(detail, facade(edge, frame_depth, sill), facade(edge, frame_depth, header), .022, 5)
                        _ruin_bar(detail, facade(left, frame_depth, sill), facade(right, frame_depth, sill), .021, 5)
                        if style in (1, 3):
                            for mullion in range(1, 3):
                                horizontal = left + opening * mullion / 3
                                _ruin_bar(detail, facade(horizontal, frame_depth, sill), facade(horizontal, frame_depth, header), .016, 4)
                            _ruin_bar(detail, facade(left, frame_depth, (sill + header) / 2), facade(right, frame_depth, (sill + header) / 2), .018, 4)
                    if randomizer.random() < .37:
                        crack_start = left if randomizer.random() < .5 else right
                        crack_end = crack_start + randomizer.uniform(-.34, .34)
                        crack_bottom = max(elevation + .24, sill - randomizer.uniform(.35, .72))
                        trace = [(crack_start, sill), (crack_start + .065, sill - .16),
                                 (crack_end - .05, (sill + crack_bottom) / 2), (crack_end, crack_bottom)]
                        for segment, (first_point, last_point) in enumerate(zip(trace[:-1], trace[1:])):
                            stroke = .014 - segment * .003
                            detail.face([facade(first_point[0] - stroke, .176, first_point[1]),
                                         facade(first_point[0] + stroke, .176, first_point[1]),
                                         facade(last_point[0] + stroke * .5, .176, last_point[1]),
                                         facade(last_point[0] - stroke * .5, .176, last_point[1])], 3)
                    if floor < 3 and style == 0 and bay % 3 == 1:
                        batch.box((middle, side * (length / 2 + .45), elevation + .22), (span - .26, .98, .19), place, 0)
                        _ruin_bar(detail, facade(first + .2, .9, elevation + 1.08), facade(last - .2, .9, elevation + 1.08), .021, 5)
                        for post in range(5):
                            horizontal = first + .22 + (span - .44) * post / 4
                            _ruin_bar(detail, facade(horizontal, .9, elevation + .27), facade(horizontal, .9, elevation + 1.08), .015, 5)
            for edge in (-1, 1):
                edge_x = edge * (width / 2 - .12)
                if edge_x < upper_first or edge_x > upper_last:
                    continue
                lower_front = damaged_side * (length / 2 - bite(edge_x, elevation) - .25)
                upper_front = damaged_side * (length / 2 - bite(edge_x, ceiling) - .25)
                rear = -damaged_side * (length / 2 - .24)
                near_edge = upper_front if abs(upper_front - rear) < abs(lower_front - rear) else lower_front
                side_first, side_last = sorted((rear, near_edge))
                side_count = max(2, round((side_last - side_first) / (4.4 if style == 1 else 5.6)))

                def side_facade(along, depth, altitude):
                    return place(edge_x + edge * depth, along, altitude)

                for side_bay in range(side_count):
                    first = side_first + (side_last - side_first) * side_bay / side_count
                    last = side_first + (side_last - side_first) * (side_bay + 1) / side_count
                    middle = (first + last) / 2
                    solid_party_wall = style in (0, 2) and side_bay % 3 != 1
                    if solid_party_wall:
                        _broken_panel(batch, side_facade, first, last, elevation + .23, ceiling, 0, randomizer, 1, .09)
                        if randomizer.random() < .63:
                            patch_center = middle + randomizer.uniform(-.45, .45)
                            patch_bottom = elevation + randomizer.uniform(.32, .78)
                            patch_height = randomizer.uniform(.62, 1.73)
                            outline = [(patch_center - .52, patch_bottom), (patch_center + .50, patch_bottom + .09),
                                       (patch_center + .77, patch_bottom + patch_height * .61),
                                       (patch_center + .32, patch_bottom + patch_height),
                                       (patch_center - .43, patch_bottom + patch_height * .91),
                                       (patch_center - .69, patch_bottom + patch_height * .42)]
                            detail.face([side_facade(along, .173, altitude) for along, altitude in outline], 2)
                    else:
                        opening = (last - first) * (.34 if style in (0, 2) else .53)
                        left, right = middle - opening / 2, middle + opening / 2
                        sill, header = elevation + 1.08, ceiling - .53
                        for panel_first, panel_last, panel_bottom, panel_top in (
                                (first, last, elevation + .23, sill), (first, last, header, ceiling),
                                (first, left, sill, header), (right, last, sill, header)):
                            _broken_panel(batch, side_facade, panel_first, panel_last, panel_bottom, panel_top, 0, randomizer, 1, .065)
                        if style == 1 or randomizer.random() > .35:
                            for jamb in (left, right):
                                _ruin_bar(detail, side_facade(jamb, -.02, sill), side_facade(jamb, -.02, header), .021, 5)
                            _ruin_bar(detail, side_facade(left, -.02, sill), side_facade(right, -.02, sill), .021, 5)
            if floor < floors - 1:
                for partition in range(1, 3):
                    horizontal = width * (partition / 3 - .5)
                    if horizontal < upper_first + .2 or horizontal > upper_last - .2:
                        continue
                    inner_front = damaged_side * (length / 2 - max(bite(horizontal, elevation), bite(horizontal, ceiling)) - 1.15)
                    inner_rear = -damaged_side * (length / 2 - .8)
                    if abs(inner_front - inner_rear) > 1:
                        batch.box((horizontal, (inner_front + inner_rear) / 2, elevation + floor_height / 2),
                                  (.15, abs(inner_front - inner_rear), floor_height - .25), place, 6)
            if floor > 0 and building_index < 9:
                for debris in range(13):
                    horizontal = randomizer.uniform(slab_first + .30, slab_last - .30)
                    front_limit = length / 2 - bite(horizontal, elevation) - .42
                    forward = randomizer.uniform(-length * .42, front_limit) * damaged_side
                    rubble_height = randomizer.uniform(.08, .33)
                    corners = [(horizontal + math.cos(section * math.tau / 5) * randomizer.uniform(.13, .42),
                                forward + math.sin(section * math.tau / 5) * randomizer.uniform(.09, .31)) for section in range(5)]
                    batch.prism([place(across, along, elevation + .23 + rubble_height * randomizer.uniform(.6, 1)) for across, along in corners],
                                [place(across, along, elevation + .23) for across, along in corners], 2)
        _urban_facade_remnants(batch, detail, place, width, length, floor_height, building_index, style, damaged_side)
        for debris in range(90 if damage_mode != 'retained shell' else 16):
            deposit_center = crown_side * width * .35 if damage_mode == 'corner collapse' else damage_center
            horizontal = max(-width * .48, min(width * .48, randomizer.gauss(deposit_center, width * .14)))
            forward = damaged_side * (length / 2 + abs(randomizer.gauss(.4, 1.15)))
            scale = .10 + .95 * randomizer.random() ** 2.2
            corners = [(horizontal + math.cos(section * math.tau / 6) * scale * randomizer.uniform(.65, 1),
                        forward + math.sin(section * math.tau / 6) * scale * randomizer.uniform(.4, .85)) for section in range(6)]
            batch.prism([place(across, along, scale * randomizer.uniform(.18, .55)) for across, along in corners],
                        [place(across, along, -.002) for across, along in corners], 2 if debris % 3 else 0)
        instance = batch.finish(bevel=.012)
        detail_instance = detail.finish()
        helpers['physical_uv'](instance)
        if detail_instance:
            helpers['physical_uv'](detail_instance)
        instance['wasteland_building_height'] = height
        instance['wasteland_base_height'] = -.025
        instance['wasteland_architecture_type'] = styles[style]
        instance['wasteland_damage_start'] = damage_start
        batches.append(instance)
        reports.append({'building': building_index, 'style': styles[style], 'fractured_bays': fracture_count,
                        'collapsed_floor_sections': collapsed_count, 'exposed_rebar_segments': rebar_count,
                        'height_m': height, 'facade_bays': bay_count, 'damage_start_m': round(damage_start, 2),
                        'damage_mode': damage_mode, 'background_block': building_index >= len(targets),
                        'maximum_notch_width_fraction': round(damage_radius * 2 / width, 3),
                        'maximum_notch_depth_m': round(damage_depth + .40, 3),
                        'single_roof_corner_loss_m': round(crown_loss, 3)})
    for instance in list(scene.objects):
        if instance.get('offline_role') in ('wasteland-building', 'wasteland-city-proxy'):
            instance.hide_render = True
            instance['replaced_by'] = COLLECTION
    return {'buildings': len(batches) + len(industrial_report['factories']), 'street_base_height': -.025,
            'background_blocks': len(background),
            'surrounding_open_floorplates': True, 'architecture_families': len(styles) + 1,
            'continuous_localized_collapse': True, 'details': reports, 'industrial': industrial_report}


def _canopies(scene, builder, helpers):
    sources = [instance for instance in scene.objects if instance.get('offline_role') == 'wasteland-canopy']
    report = []
    for canopy_index, source in enumerate(sources):
        center, extent, low, high = helpers['bounds'](source)
        if low.x < 1.5 and high.x > -1.5 and low.y < -2.8 < high.y:
            raise ValueError('A canopy would obstruct the default observation point')
        parameters = json.loads(source['offline_parameters'])
        post_width = parameters['width'] - .45
        post_length = parameters['length'] - .59
        post_height = parameters['height'] - .08
        supports = []
        for side in (-1, 1):
            for end in (-1, 1):
                target = Vector((center.x + side * post_width / 2, center.y + end * post_length / 2, post_height / 2))
                matches = []
                for instance in scene.objects:
                    if instance.type != 'MESH' or instance.hide_render:
                        continue
                    candidate_center, candidate_extent, unused_low, unused_high = helpers['bounds'](instance)
                    if (candidate_center - target).length < .008 and abs(candidate_extent.z - post_height) < .008 and max(candidate_extent.x, candidate_extent.y) < .14:
                        matches.append(instance)
                if len(matches) != 1:
                    raise ValueError('Canopy post replacement must match one source at ' + repr(tuple(target)))
                matches[0].hide_render = True
                supports.append(target)
        def cloth_height(horizontal, forward):
            across = (horizontal - center.x) / post_width + .5
            along = (forward - center.y) / post_length + .5
            clamped_across = max(0, min(1, across))
            clamped_along = max(0, min(1, along))
            support_mask = math.sin(clamped_across * math.pi) * math.sin(clamped_along * math.tau) ** 2
            sag = .105 * support_mask
            folds = (.006 * math.sin(across * 31 + along * 11) + .003 * math.sin(across * 67 - along * 19)) * support_mask
            overhang = max(0, -across, across - 1, -along, along - 1)
            return post_height + .075 - parameters['side'] * (across - .5) * .10 - sag + folds - overhang * .08
        vertices, faces = [], []
        for row in range(65):
            along = row / 64
            for column in range(49):
                across = column / 48
                horizontal, forward = low.x + across * extent.x, low.y + along * extent.y
                vertices.append((horizontal, forward, cloth_height(horizontal, forward)))
        for row in range(64):
            for column in range(48):
                vertex = row * 49 + column
                faces.append((vertex, vertex + 1, vertex + 50, vertex + 49))
        cloth = builder.cloth('patched tensioned canvas canopy', vertices, faces, 'olive' if canopy_index % 2 else 'linen_blue', .004)
        for edge in (vertices[:49], vertices[-49:], vertices[::49], vertices[48::49]):
            builder.seam('canvas canopy double stitched bound hem', edge, .007, 'rug_binding')
        for target in supports:
            horizontal, forward = target.x, target.y
            roof = cloth_height(horizontal, forward)
            builder.rod('canopy steel bearing post', (horizontal, forward, .01), (horizontal, forward, roof - .048), .034, 'steel', 48)
            builder.box('post ground bolted foot', (horizontal, forward, .025), (.16, .16, .05), 'steel', .006)
        for forward in (center.y - post_length / 2, center.y, center.y + post_length / 2):
            first, last = center.x - post_width / 2, center.x + post_width / 2
            builder.rod('canopy undercloth transverse support', (first, forward, cloth_height(first, forward) - .033),
                        (last, forward, cloth_height(last, forward) - .033), .028, 'steel', 40)
        for horizontal in (center.x - post_width / 2, center.x + post_width / 2):
            first, last = center.y - post_length / 2, center.y + post_length / 2
            builder.rod('canopy undercloth longitudinal support', (horizontal, first, cloth_height(horizontal, first) - .033),
                        (horizontal, last, cloth_height(horizontal, last) - .033), .028, 'steel', 40)
        for patch_index, (fraction_x, fraction_y) in enumerate(((.26, .32), (.72, .78))):
            patch_vertices = []
            for row in range(13):
                for column in range(13):
                    horizontal = low.x + fraction_x * extent.x + (column / 12 - .5) * .34
                    forward = low.y + fraction_y * extent.y + (row / 12 - .5) * .43
                    patch_vertices.append((horizontal, forward, cloth_height(horizontal, forward) + .004))
            patch_faces = [(row * 13 + column, row * 13 + column + 1, (row + 1) * 13 + column + 1, (row + 1) * 13 + column) for row in range(12) for column in range(12)]
            builder.cloth('canopy sewn rectangular field repair', patch_vertices, patch_faces, 'olive' if patch_index else 'linen_blue', .002)
            for edge in (patch_vertices[:13], patch_vertices[-13:], patch_vertices[::13], patch_vertices[12::13]):
                builder.seam('field repair hand sewn edge', edge, .0012, 'rug_binding')
        for target in supports:
            horizontal = low.x if target.x < center.x else high.x
            forward = low.y if target.y < center.y else high.y
            roof = cloth_height(horizontal, forward)
            ring = [(horizontal + .024 * math.cos(section * math.tau / 32), forward + .024 * math.sin(section * math.tau / 32), roof + .004) for section in range(33)]
            builder.seam('canvas reinforced corner eyelet', ring, .005, 'steel')
            builder.seam('canopy corner tie to bearing post', [(horizontal, forward, roof - .006), (target.x, target.y, cloth_height(target.x, target.y) - .20)], .005, 'rug_binding')
        source.hide_render = True
        source['replaced_by'] = COLLECTION
        report.append({'source': source.name, 'span': [extent.x, extent.y], 'replaced_source_posts': len(supports), 'support_surface_nominal_gap_m': .005})
    return report


def _street_surface(scene, builder, helpers):
    sources = [instance for instance in scene.objects if instance.get('offline_role') == 'wasteland-courtyard-ground']
    if len(sources) != 1:
        raise ValueError('Expected one explicitly tagged settlement courtyard')
    source = sources[0]
    ground_extensions = []
    for instance in scene.objects:
        if instance == source or instance.type != 'MESH' or instance.hide_render:
            continue
        center, extent, low, high = helpers['bounds'](instance)
        if extent.x > 100 and extent.y > 100 and abs(center.z) < .05 and extent.z < .01:
            ground_extensions.append(instance)
    material = _library_material(builder, 'asphalt', 'asphalt_03', (.78, .82, .84), 1 / 1.65)
    material.name = 'Wasteland/weathered asphalt with mineral aggregate'
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    photographed_color = shader.inputs['Base Color'].links[0].from_socket
    neutral = nodes.new('ShaderNodeHueSaturation')
    neutral.inputs['Saturation'].default_value = .06
    neutral.inputs['Value'].default_value = .82
    links.new(photographed_color, neutral.inputs['Color'])
    coordinates = nodes.new('ShaderNodeNewGeometry')
    broad = nodes.new('ShaderNodeTexNoise')
    broad.inputs['Scale'].default_value = .17
    broad.inputs['Detail'].default_value = 5
    links.new(coordinates.outputs['Position'], broad.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .24
    ramp.color_ramp.elements[0].color = (.33, .40, .46, 1)
    ramp.color_ramp.elements[1].position = .75
    ramp.color_ramp.elements[1].color = (.92, .95, .98, 1)
    links.new(broad.outputs['Fac'], ramp.inputs[0])
    variation = nodes.new('ShaderNodeMixRGB')
    variation.blend_type = 'MULTIPLY'
    variation.inputs[0].default_value = 1
    links.new(neutral.outputs['Color'], variation.inputs[1])
    links.new(ramp.outputs[0], variation.inputs[2])
    position = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coordinates.outputs['Position'], position.inputs[0])
    across = nodes.new('ShaderNodeMath')
    across.operation = 'ABSOLUTE'
    links.new(position.outputs['X'], across.inputs[0])
    curb_distance = nodes.new('ShaderNodeMath')
    curb_distance.operation = 'SUBTRACT'
    curb_distance.inputs[1].default_value = 7.2
    links.new(across.outputs[0], curb_distance.inputs[0])
    curb_absolute = nodes.new('ShaderNodeMath')
    curb_absolute.operation = 'ABSOLUTE'
    links.new(curb_distance.outputs[0], curb_absolute.inputs[0])
    deposit = nodes.new('ShaderNodeMapRange')
    deposit.inputs['From Max'].default_value = 2.4
    deposit.inputs['To Min'].default_value = .64
    deposit.inputs['To Max'].default_value = 0
    links.new(curb_absolute.outputs[0], deposit.inputs[0])
    breakup = nodes.new('ShaderNodeMath')
    breakup.operation = 'MULTIPLY'
    links.new(deposit.outputs[0], breakup.inputs[0])
    links.new(broad.outputs['Fac'], breakup.inputs[1])
    dust = nodes.new('ShaderNodeMixRGB')
    links.new(breakup.outputs[0], dust.inputs[0])
    links.new(variation.outputs[0], dust.inputs[1])
    dust.inputs[2].default_value = (.145, .132, .107, 1)
    links.new(dust.outputs[0], shader.inputs['Base Color'])
    micro = nodes.new('ShaderNodeTexNoise')
    micro.inputs['Scale'].default_value = 95
    micro.inputs['Detail'].default_value = 3
    links.new(coordinates.outputs['Position'], micro.inputs['Vector'])
    bump = nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .20
    bump.inputs['Distance'].default_value = .003
    links.new(micro.outputs['Fac'], bump.inputs['Height'])
    links.new(shader.inputs['Normal'].links[0].from_socket, bump.inputs['Normal'])
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    for ground in [source, *ground_extensions]:
        ground.data = ground.data.copy()
        ground.data.materials.clear()
        ground.data.materials.append(material)
        helpers['physical_uv'](ground)
    randomizer = random.Random(56278)
    rubble = helpers['batch'](builder.collection, 'Wasteland/scattered fractured brick and aggregate',
                              [builder.materials[name] for name in ('concrete', 'masonry', 'rust')])
    for index in range(900):
        side = -1 if index % 2 else 1
        horizontal = side * (7.65 + abs(randomizer.gauss(0, .83)))
        forward = randomizer.gauss((-10.7, 7.5, 22.0, 36.0)[index % 4], 3.2)
        if randomizer.random() > .20 + .70 * math.exp(-((abs(horizontal) - 7.7) / .95) ** 2):
            continue
        size = .014 + .19 * randomizer.random() ** 2.7
        angle = randomizer.uniform(0, math.tau)
        def transform(local_x, local_y, elevation):
            return (horizontal + math.cos(angle) * local_x - math.sin(angle) * local_y,
                    forward + math.sin(angle) * local_x + math.cos(angle) * local_y, elevation - .025)
        ring = [(math.cos(section * math.tau / 5) * size * randomizer.uniform(.65, 1.25),
                 math.sin(section * math.tau / 5) * size * randomizer.uniform(.55, 1)) for section in range(5)]
        rubble.prism([transform(across, along, size * randomizer.uniform(.18, .70)) for across, along in ring],
                     [transform(across, along, -.001) for across, along in ring], index % 3)
    instance = rubble.finish(bevel=.009)
    helpers['physical_uv'](instance)
    for side in (-1, 1):
        for index in range(17):
            forward = -11.5 + index * 1.32
            builder.box('salvaged street curb stone', (side * 7.05, forward, .10), (.34, 1.27, .20), 'concrete', .032)


def _hearth(builder):
    char = builder.materials['charcoal'] = builder.materials['bark'].copy()
    char.name = 'Wasteland/charred firewood with ember fissures'
    nodes, links = char.node_tree.nodes, char.node_tree.links
    shader = nodes.get('Principled BSDF')
    coordinates = nodes.new('ShaderNodeTexCoord')
    cells = nodes.new('ShaderNodeTexVoronoi')
    cells.feature = 'DISTANCE_TO_EDGE'
    cells.inputs['Scale'].default_value = 24
    links.new(coordinates.outputs['Object'], cells.inputs['Vector'])
    fissure = nodes.new('ShaderNodeValToRGB')
    fissure.color_ramp.elements[0].position = .003
    fissure.color_ramp.elements[0].color = (1, .062, .002, 1)
    fissure.color_ramp.elements[1].position = .021
    fissure.color_ramp.elements[1].color = (.001, .0002, 0, 1)
    links.new(cells.outputs['Distance'], fissure.inputs[0])
    links.new(fissure.outputs[0], shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value = 1.7
    charcoal = nodes.new('ShaderNodeRGB')
    charcoal.outputs[0].default_value = (.009, .007, .005, 1)
    links.new(charcoal.outputs[0], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = .98
    for index in range(4):
        angle = index * 1.23
        axis = Vector((math.cos(angle), math.sin(angle), .08 * math.sin(index)))
        center = Vector((-2, 3, .16 + index * .034))
        builder.rod('fire pit crossed charred split log', center - axis * .31, center + axis * .31, .047, 'charcoal', 40)
    flame = bpy.data.materials.new('Wasteland/soft volumetric fire tongues')
    flame.use_nodes = True
    nodes, links = flame.node_tree.nodes, flame.node_tree.links
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    volume = nodes.new('ShaderNodeVolumePrincipled')
    volume.inputs['Color'].default_value = (.22, .18, .14, 1)
    volume.inputs['Anisotropy'].default_value = .15
    coordinates = nodes.new('ShaderNodeTexCoord')
    height = nodes.new('ShaderNodeSeparateXYZ')
    links.new(coordinates.outputs['Generated'], height.inputs[0])
    object_info = nodes.new('ShaderNodeObjectInfo')
    seed = nodes.new('ShaderNodeMath')
    seed.operation = 'MULTIPLY'
    seed.inputs[1].default_value = 19
    links.new(object_info.outputs['Random'], seed.inputs[0])
    eddies = nodes.new('ShaderNodeTexNoise')
    eddies.noise_dimensions = '4D'
    eddies.inputs['Scale'].default_value = 3.2
    eddies.inputs['Detail'].default_value = 3
    eddies.inputs['Roughness'].default_value = .67
    links.new(coordinates.outputs['Generated'], eddies.inputs['Vector'])
    links.new(seed.outputs[0], eddies.inputs['W'])
    drift = nodes.new('ShaderNodeVectorMath')
    drift.operation = 'SUBTRACT'
    drift.inputs[1].default_value = (.5, .5, .5)
    links.new(eddies.outputs['Color'], drift.inputs[0])
    drift_scale = nodes.new('ShaderNodeVectorMath')
    drift_scale.operation = 'MULTIPLY'
    drift_scale.inputs[1].default_value = (.29, .25, 0)
    links.new(drift.outputs[0], drift_scale.inputs[0])
    centered = nodes.new('ShaderNodeVectorMath')
    centered.operation = 'SUBTRACT'
    centered.inputs[1].default_value = (.5, .5, 0)
    links.new(coordinates.outputs['Generated'], centered.inputs[0])
    displaced = nodes.new('ShaderNodeVectorMath')
    displaced.operation = 'ADD'
    links.new(centered.outputs[0], displaced.inputs[0])
    links.new(drift_scale.outputs[0], displaced.inputs[1])
    transverse = nodes.new('ShaderNodeVectorMath')
    transverse.operation = 'MULTIPLY'
    transverse.inputs[1].default_value = (1, 1, 0)
    links.new(displaced.outputs[0], transverse.inputs[0])
    distance = nodes.new('ShaderNodeVectorMath')
    distance.operation = 'LENGTH'
    links.new(transverse.outputs[0], distance.inputs[0])
    width = nodes.new('ShaderNodeMapRange')
    width.interpolation_type = 'SMOOTHSTEP'
    width.inputs['To Min'].default_value = .34
    width.inputs['To Max'].default_value = .07
    links.new(height.outputs['Z'], width.inputs['Value'])
    radial = nodes.new('ShaderNodeMath')
    radial.operation = 'DIVIDE'
    links.new(distance.outputs['Value'], radial.inputs[0])
    links.new(width.outputs['Result'], radial.inputs[1])
    edge = nodes.new('ShaderNodeMapRange')
    edge.name = 'Density vanishes before invisible volume boundary'
    edge.interpolation_type = 'SMOOTHSTEP'
    edge.inputs['From Min'].default_value = .32
    edge.inputs['From Max'].default_value = 1
    edge.inputs['To Min'].default_value = 1
    edge.inputs['To Max'].default_value = 0
    edge.clamp = True
    links.new(radial.outputs[0], edge.inputs['Value'])
    base = nodes.new('ShaderNodeMapRange')
    base.interpolation_type = 'SMOOTHSTEP'
    base.inputs['From Min'].default_value = 0
    base.inputs['From Max'].default_value = .16
    base.clamp = True
    links.new(height.outputs['Z'], base.inputs['Value'])
    tip = nodes.new('ShaderNodeMapRange')
    tip.interpolation_type = 'SMOOTHSTEP'
    tip.inputs['From Min'].default_value = .67
    tip.inputs['From Max'].default_value = .98
    tip.inputs['To Min'].default_value = 1
    tip.inputs['To Max'].default_value = 0
    tip.clamp = True
    links.new(height.outputs['Z'], tip.inputs['Value'])
    envelope = nodes.new('ShaderNodeMath')
    envelope.operation = 'MULTIPLY'
    links.new(edge.outputs['Result'], envelope.inputs[0])
    links.new(base.outputs['Result'], envelope.inputs[1])
    envelope_tip = nodes.new('ShaderNodeMath')
    envelope_tip.operation = 'MULTIPLY'
    links.new(envelope.outputs[0], envelope_tip.inputs[0])
    links.new(tip.outputs['Result'], envelope_tip.inputs[1])
    noise = nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '4D'
    noise.inputs['Scale'].default_value = 6.5
    noise.inputs['Detail'].default_value = 3
    noise.inputs['Roughness'].default_value = .65
    links.new(coordinates.outputs['Generated'], noise.inputs['Vector'])
    links.new(seed.outputs[0], noise.inputs['W'])
    combustion = nodes.new('ShaderNodeMapRange')
    combustion.name = 'Turbulent intermittent combustion with transparent pockets'
    combustion.interpolation_type = 'SMOOTHSTEP'
    combustion.inputs['From Min'].default_value = .37
    combustion.inputs['From Max'].default_value = .66
    combustion.clamp = True
    links.new(noise.outputs['Fac'], combustion.inputs['Value'])
    active = nodes.new('ShaderNodeMath')
    active.operation = 'MULTIPLY'
    links.new(envelope_tip.outputs[0], active.inputs[0])
    links.new(combustion.outputs['Result'], active.inputs[1])
    density = nodes.new('ShaderNodeMath')
    density.operation = 'MULTIPLY'
    density.inputs[1].default_value = .12
    links.new(active.outputs[0], density.inputs[0])
    emission = nodes.new('ShaderNodeMath')
    emission.operation = 'MULTIPLY'
    emission.inputs[1].default_value = 24
    links.new(active.outputs[0], emission.inputs[0])
    temperature = nodes.new('ShaderNodeMapRange')
    temperature.name = 'Cool fading edges and hotter irregular yellow cores'
    temperature.inputs['To Min'].default_value = 1250
    temperature.inputs['To Max'].default_value = 2150
    links.new(active.outputs[0], temperature.inputs['Value'])
    blackbody = nodes.new('ShaderNodeBlackbody')
    links.new(temperature.outputs['Result'], blackbody.inputs['Temperature'])
    links.new(blackbody.outputs['Color'], volume.inputs['Emission Color'])
    links.new(density.outputs[0], volume.inputs['Density'])
    links.new(emission.outputs[0], volume.inputs['Emission Strength'])
    links.new(volume.outputs[0], output.inputs['Volume'])
    flame['boundary_density'] = 0
    flame['temperature_kelvin'] = [1250, 2150]
    flame['volume_only_no_surface'] = True
    builder.materials['flame'] = flame
    domains = [(-.135, -.045, .30, .29, .35), (.092, .068, .29, .31, .44),
               (-.018, .015, .33, .30, .53), (.14, -.11, .27, .25, .29),
               (-.073, .13, .28, .27, .34), (.015, -.135, .29, .26, .39)]
    for across, north, width, length, altitude in domains:
        vertices = [(-2 + across + x * width / 2, 3 + north + y * length / 2,
                     .17 + z * altitude) for z in (0, 1) for y in (-1, 1) for x in (-1, 1)]
        faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4),
                 (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
        builder.mesh('bounded turbulent fire volume with invisible domain', vertices, faces, 'flame', False)


def _windbreak(builder):
    vertices, faces = [], []
    for row in range(49):
        height = .62 + row / 48 * 2.31
        for column in range(49):
            along = column / 48
            vertices.append((6.55 + .042 * math.sin(along * math.pi * 14),
                             1.99 + along * .64, height + .008 * math.sin(column * .3)))
    for row in range(48):
        for column in range(48):
            vertex = row * 49 + column
            faces.append((vertex, vertex + 1, vertex + 50, vertex + 49))
    builder.cloth('galley gathered side windbreak canvas', vertices, faces, 'olive', .004)
    builder.rod('windbreak hanging side rail', (6.55, 1.9, 2.97), (6.55, 2.74, 2.97), .018, 'steel', 40)
    for forward in (2.0, 2.12, 2.24, 2.36, 2.48, 2.60):
        builder.seam('windbreak rail suspension ring', [(6.55 + .023 * math.cos(step * math.tau / 32), forward,
                     2.953 + .037 * math.sin(step * math.tau / 32)) for step in range(33)], .004, 'steel')


def _strings(builder):
    for side in (-1, 1):
        for forward in (-8.7, 3.8):
            builder.rod('string light timber mast', (side * 3.28, forward, 0), (side * 3.28, forward, 3.66), .05, 'wood')
        points = [(side * 3.28, -8.7 + step / 128 * 12.5,
                   3.60 - .38 * math.sin(step / 128 * math.pi)) for step in range(129)]
        builder.seam('sagging exterior lamp supply cable', points, .009, 'dark')
        for lamp in range(9):
            fraction = (lamp + .5) / 9
            forward = -8.7 + fraction * 12.5
            height = 3.60 - .38 * math.sin(fraction * math.pi)
            builder.rod('weatherproof festoon lamp socket', (side * 3.28, forward, height), (side * 3.28, forward, height - .075), .027, 'dark')
            builder.lathe('warm frosted festoon globe', (side * 3.28, forward, height - .18),
                          [(.001, 0), (.026, .009), (.043, .034), (.046, .064), (.027, .108), (.018, .115)], 'amber', 48)
            builder.area('festoon ground light', (side * 3.28, forward, height - .21), (side * 2.5, forward, 0), 12, .08)


def refine(scene, descriptor):
    if descriptor.get('scene') != 'shelter' or descriptor.get('artRevision') != 'street-settlement-v1':
        raise ValueError('Outdoor settlement refinement requires the street-level descriptor')
    if bpy.data.collections.get(COLLECTION):
        raise ValueError('Settlement is already refined')
    domestic = runpy.run_path(str(ROOT / 'refine-shelter.py'))
    geometry = runpy.run_path(str(ROOT / 'refine-landscapes.py'))
    helpers = {**domestic, 'batch': geometry['_Batch'], 'library_material': _library_material}

    class StreetBuilder(domestic['Builder']):
        def pendant(self, role, horizontal, forward, height, power, radius=.25):
            start = len(self.objects)
            super().pendant(role, horizontal, forward, height, power, radius)
            conduit = self.objects[start]
            for vertex in conduit.data.vertices:
                world = conduit.matrix_world @ vertex.co
                if world.z > 2.99:
                    world.z = 2.99
                    vertex.co = conduit.matrix_world.inverted() @ world

    contacts = domestic['seat_props'](scene)
    builder = StreetBuilder(scene)
    builder.collection.name = COLLECTION
    _library_material(builder, 'masonry', 'old_stone_wall', (.72, .69, .61), 1 / 3.5)
    for instance in list(scene.objects):
        if instance.get('offline_role') in ('wasteland-galley-proxy', 'wasteland-lounge-proxy', 'wasteland-canopy-frame-proxy', 'wasteland-fire-proxy', 'wasteland-shutter-proxy'):
            instance.hide_render = True
    domestic['existing_surface_refinement'](scene, builder)
    domestic['sleeping_nook'](builder)
    domestic['bed_linens'](builder)
    domestic['lounge'](builder)
    domestic['supplies_and_work'](builder)
    for instance in builder.objects:
        if instance.get('shelter_role') in ('work wall cork backing', 'pinned personal page'):
            instance.location.x -= .25
    for forward in (-4.55, -3.0):
        builder.box('work board bearing timber cleat', (6.014, forward, 2.23), (.10, .10, 1.24), 'wood', .008)
    domestic['receiver_assembly'](scene, builder)
    galley = domestic['galley'](builder)
    for forward in (-.42, 2.70):
        builder.box('galley independent pantry support stile', (6.245, forward, 1.11), (.08, .075, 2.22), 'wood', .008)
    for surface in builder.materials.values():
        if surface.name.endswith('lamp opal glass'):
            surface.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 3.5
    city = _ruins(scene, builder, helpers)
    canopies = _canopies(scene, builder, helpers)
    _street_surface(scene, builder, helpers)
    _strings(builder)
    _hearth(builder)
    _windbreak(builder)
    close_range = runpy.run_path(str(ROOT / 'refine-city-details.py'))['refine'](scene, builder, helpers)
    builder.area('workbench task light', (4.5, -3.1, 2.625), (4.7, -4, .8), 105, .53, '#e1e9e5')
    bpy.context.view_layer.update()
    observer = Vector((descriptor['observation']['position'][0], -descriptor['observation']['position'][2], descriptor['observation']['position'][1]))
    graph = bpy.context.evaluated_depsgraph_get()
    overhead_hits = []
    for instance in scene.objects:
        if instance.type != 'MESH' or instance.hide_render:
            continue
        inverse = instance.matrix_world.inverted()
        direction = (inverse.to_3x3() @ Vector((0, 0, 1))).normalized()
        surface = BVHTree.FromObject(instance, graph)
        if surface.ray_cast(inverse @ observer, direction, 200)[0] is not None:
            overhead_hits.append(instance.name)
    if overhead_hits:
        raise ValueError('The street-level observation point must have open sky: ' + repr(overhead_hits))
    report = {'scene': 'wasteland city settlement', 'default_overhead_occluders': 0,
              'city': city, 'canopies': canopies, 'galley': galley, 'contacts': contacts, 'close_range': close_range,
              'objects': len(builder.collection.objects), 'preserved_observation': descriptor['observation'],
              'photorealistic_approval': False}
    scene['wasteland_refinement_report'] = json.dumps(report)
    print('WASTELAND_REFINEMENT', json.dumps(report), flush=True)
    return report
