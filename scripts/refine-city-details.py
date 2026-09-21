"""Authored close-range street wear and reused settlement construction."""
import math
import random

import bpy
from mathutils import Matrix, Vector


def _ground_occupied(horizontal, north):
    rectangles = [(-5.65, -3.1, -7.85, -5.00), (3.55, 6.25, -6.05, -1.8),
                  (4.50, 6.35, -.28, 2.79), (-4.4, -2.75, -1.45, -.52),
                  (-2.88, -2.03, -.41, .47), (-5.12, -.98, -10.1, -8.94),
                  (2.42, 5.65, -10.12, -9.37), (-6.55, -5.03, 2.86, 4.35),
                  (-3.57, -2.13, -6.90, -5.80)]
    return any(left <= horizontal <= right and lower <= north <= upper for left, right, lower, upper in rectangles)


def _weathered_materials(builder, helpers):
    for name in ('wood', 'plywood'):
        material = builder.materials[name]
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = nodes.get('Principled BSDF')
        original = shader.inputs['Base Color'].links[0].from_socket
        desaturate = nodes.new('ShaderNodeHueSaturation')
        desaturate.inputs['Saturation'].default_value = .18
        links.new(original, desaturate.inputs['Color'])
        silver = nodes.new('ShaderNodeMixRGB')
        silver.blend_type = 'MIX'
        silver.inputs[0].default_value = .15
        silver.inputs[2].default_value = (.20, .22, .20, 1)
        links.new(desaturate.outputs['Color'], silver.inputs[1])
        links.new(silver.outputs[0], shader.inputs['Base Color'])
    for index, tint in enumerate(((.39, .43, .42), (.43, .40, .34), (.34, .38, .32), (.52, .50, .43))):
        material = builder.materials[f'reclaimed_board_{index}'] = builder.materials['wood'].copy()
        material.name = f'Wasteland/silvered reclaimed board finish {index}'
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = nodes.get('Principled BSDF')
        original = shader.inputs['Base Color'].links[0].from_socket
        coordinates = nodes.new('ShaderNodeNewGeometry')
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 2.9
        noise.inputs['Detail'].default_value = 3
        links.new(coordinates.outputs['Position'], noise.inputs['Vector'])
        blend = nodes.new('ShaderNodeMapRange')
        blend.inputs['To Min'].default_value = .16
        blend.inputs['To Max'].default_value = .38
        links.new(noise.outputs['Fac'], blend.inputs['Value'])
        gray = nodes.new('ShaderNodeMixRGB')
        gray.blend_type = 'MIX'
        gray.inputs[2].default_value = (*tint, 1)
        links.new(blend.outputs['Result'], gray.inputs[0])
        links.new(original, gray.inputs[1])
        links.new(gray.outputs[0], shader.inputs['Base Color'])
        for link in list(shader.inputs['Roughness'].links):
            links.remove(link)
        shader.inputs['Roughness'].default_value = .91
        material['weathering'] = 'desaturated original CC0 wood with restrained silvering; metre-space mottling'
    for name, tint in (('salvaged_sheet_cool', (.65, .74, .74)), ('salvaged_sheet_olive', (.69, .70, .53)),
                       ('salvaged_sheet_pale', (.88, .84, .71))):
        helpers['library_material'](builder, name, 'painted_metal_shutter', tint, .48)
        shader = builder.materials[name].node_tree.nodes.get('Principled BSDF')
        shader.inputs['Metallic'].default_value = .22
    builder.materials['utility_glass'] = helpers['material']('aged utility lamp cover', '#d1e3da', .36)
    shader = builder.materials['utility_glass'].node_tree.nodes.get('Principled BSDF')
    shader.inputs['Emission Color'].default_value = (.66, .82, .80, 1)
    shader.inputs['Emission Strength'].default_value = 2


def _settlement_enclosures(scene, builder, helpers):
    sources = []
    for horizontal, north, width, length in ((-4.8, -6.5, 2.5, 5.1), (4.8, -4, 2.7, 5.55), (5.4, 1.25, 3.3, 3.75)):
        side = -1 if horizontal < 0 else 1
        sources.extend(((Vector((horizontal + side * (width / 2 - .08), north, 1.488)), Vector((.16, length, 2.976))),
                        (Vector((horizontal, north - length / 2 + .07, 1.395)), Vector((width, .14, 2.79)))))
    candidates = [(instance, *helpers['bounds'](instance)[:2]) for instance in scene.objects
                  if instance.type == 'MESH' and not instance.hide_render]
    randomizer = random.Random(34119)
    reports = []
    for wall_index, (target, dimensions) in enumerate(sources):
        matched = [instance for instance, center, extent in candidates
                   if (center - target).length < .006 and (extent - dimensions).length < .016]
        if len(matched) != 1:
            raise ValueError(f'Expected exactly one legacy settlement wall {wall_index}, found {len(matched)}')
        source = matched[0]
        center, extent, low, high = helpers['bounds'](source)
        along_axis = 1 if extent.y > extent.x else 0
        normal_axis = 1 - along_axis
        inside = -1 if center[normal_axis] > 0 else 1
        width = extent[along_axis]
        sheet_width = .83 if wall_index % 3 else .69
        sheet_count = max(2, math.ceil(width / sheet_width))
        for sheet in range(sheet_count):
            first = low[along_axis] + width * sheet / sheet_count
            last = low[along_axis] + width * (sheet + 1) / sheet_count
            sheet_is_metal = (sheet + wall_index) % 4 in (0, 1)
            if sheet_is_metal:
                vertices, faces = [], []
                for row in range(145):
                    elevation = .045 + row / 144 * (extent.z - .085)
                    corrugation = .009 * math.cos(elevation * math.tau / .082)
                    for column in range(9):
                        along = first - .012 + column / 8 * (last - first + .024)
                        dent = .014 * math.exp(-((along - (first + last) / 2) / .15) ** 2
                                               - ((elevation - 1.13 - .21 * sheet) / .31) ** 2)
                        point = [0, 0, elevation]
                        point[along_axis] = along
                        point[normal_axis] = center[normal_axis] + inside * (.006 + corrugation + dent)
                        vertices.append(point)
                for row in range(144):
                    for column in range(8):
                        vertex = row * 9 + column
                        faces.append((vertex, vertex + 1, vertex + 10, vertex + 9))
                surface = ('salvaged_sheet_cool', 'salvaged_sheet_olive', 'salvaged_sheet_pale')[(sheet + wall_index) % 3]
                builder.cloth('settlement reused corrugated shutter wall section', vertices, faces, surface, .0015)
            else:
                board_count = max(3, round((last - first) / .17))
                for board in range(board_count):
                    position = list(center)
                    position[along_axis] = first + (board + .5) * (last - first) / board_count
                    height = extent.z - randomizer.uniform(.028, .075)
                    position[2] = height / 2 + .015
                    position[normal_axis] += inside * randomizer.uniform(-.008, .008)
                    size = [.028, .028, height]
                    size[along_axis] = (last - first) / board_count - .004
                    builder.box('settlement mismatched silvered vertical plank', position, size,
                                f'reclaimed_board_{(board + sheet + wall_index) % 4}', .0025)
            for altitude in (.23, 1.33, extent.z - .16):
                for edge in (first + .045, last - .045):
                    first_point = list(center)
                    first_point[along_axis], first_point[2] = edge, altitude
                    first_point[normal_axis] += inside * .020
                    last_point = first_point.copy()
                    last_point[normal_axis] += inside * .006
                    builder.rod('reused wall sheet washer and screw', first_point, last_point, .009, 'steel', 24)
        for altitude in (.22, 1.33, extent.z - .14):
            position = list(center)
            position[normal_axis] -= inside * .040
            position[2] = altitude
            size = [.045, .045, .074]
            size[along_axis] = width + .02
            builder.box('reused wall continuous rear bearer', position, size, 'reclaimed_board_2', .005)
        for end in (-1, 1):
            position = list(center)
            position[along_axis] += end * (width / 2 - .028)
            position[normal_axis] -= inside * .032
            builder.box('reused wall load bearing steel edge post', position, (.045, .045, extent.z), 'steel', .004)
        source.hide_render = True
        source['replaced_by'] = 'street settlement mixed salvaged cladding'
        reports.append({'source': source.name, 'mixed_sections': sheet_count, 'height_m': round(extent.z, 3)})
    return reports


def _road_repair_material(builder):
    if 'asphalt' not in builder.materials:
        raise ValueError('Road repairs require the installed physical asphalt surface first')
    asphalt = builder.materials['road_patch'] = builder.materials['asphalt'].copy()
    asphalt.name = 'Wasteland/cold asphalt repair with shared mineral aggregate'
    nodes, links = asphalt.node_tree.nodes, asphalt.node_tree.links
    shader = nodes.get('Principled BSDF')
    color = shader.inputs['Base Color'].links[0].from_socket
    roughness = shader.inputs['Roughness'].links[0].from_socket
    repair = nodes.new('ShaderNodeAttribute')
    repair.attribute_name = 'roadRepairWeight'
    repair.name = 'Physical repair perimeter transition'
    tint = nodes.new('ShaderNodeMath')
    tint.operation = 'MULTIPLY_ADD'
    tint.inputs[1].default_value = -.19
    tint.inputs[2].default_value = 1
    links.new(repair.outputs['Fac'], tint.inputs[0])
    blend = nodes.new('ShaderNodeMixRGB')
    blend.blend_type = 'MULTIPLY'
    blend.inputs[0].default_value = 1
    links.new(color, blend.inputs[1])
    links.new(tint.outputs[0], blend.inputs[2])
    links.new(blend.outputs[0], shader.inputs['Base Color'])
    roughness_delta = nodes.new('ShaderNodeMath')
    roughness_delta.operation = 'MULTIPLY'
    roughness_delta.inputs[1].default_value = .018
    links.new(repair.outputs['Fac'], roughness_delta.inputs[0])
    repaired_roughness = nodes.new('ShaderNodeMath')
    repaired_roughness.operation = 'ADD'
    repaired_roughness.use_clamp = True
    links.new(roughness, repaired_roughness.inputs[0])
    links.new(roughness_delta.outputs[0], repaired_roughness.inputs[1])
    links.new(repaired_roughness.outputs[0], shader.inputs['Roughness'])
    asphalt['road_repair_shared_source'] = builder.materials['asphalt'].name
    asphalt['road_repair_edge_transition_metres'] = .08
    asphalt['road_repair_core_albedo_multiplier'] = .81
    return asphalt


def _road_repair_geometry(horizontal, north, width, length, patch_index):
    segments = 192
    fractions = (.08, .18, .30, .44, .58, .70, .80, .86, .90, .93, .95, .97, .985, 1)
    vertices, weights = [(horizontal, north, .00225)], [1]
    generator = random.Random(75031 + patch_index * 79)
    defects = [(generator.uniform(0, math.tau), generator.uniform(.022, .060), generator.uniform(.007, .024))
               for unused in range(17)]
    for fraction in fractions:
        for section in range(segments):
            angle = section * math.tau / segments
            edge = 1 + .056 * math.sin(angle * 3 + patch_index * .87) + .028 * math.sin(angle * 9 - patch_index)
            defect = 0
            for center, spread, depth in defects:
                delta = (angle - center + math.pi) % math.tau - math.pi
                defect += depth * math.exp(-(delta / spread) ** 2)
            radius_x = width * edge - defect
            radius_y = length * edge - defect
            across = math.cos(angle) * radius_x
            along = math.sin(angle) * radius_y
            perimeter_distance = (1 - fraction) * math.hypot(across, along)
            transition = max(0, min(1, perimeter_distance / .08))
            transition = transition * transition * (3 - 2 * transition)
            height = .00015 + .00210 * transition
            height += .00050 * math.sin(angle * 7 + fraction * 12 + patch_index) * fraction * transition
            vertices.append((horizontal + fraction * across, north + fraction * along, height))
            weights.append(transition)
    faces = [(0, 1 + section, 1 + (section + 1) % segments) for section in range(segments)]
    for ring in range(len(fractions) - 1):
        for section in range(segments):
            following = (section + 1) % segments
            first = 1 + ring * segments
            last = first + segments
            faces.append((first + section, last + section, last + following, first + following))
    if min(point[2] for point in vertices) < .00014 or max(point[2] for point in vertices) > .003:
        raise ValueError('Asphalt repair exceeded the 0.15 to 3 mm physical contact envelope')
    if any(abs(weight) > .000001 for weight in weights[-segments:]):
        raise ValueError('Asphalt repair edge must match the underlying road material exactly')
    return vertices, faces, weights


def _tire_scuff_material(builder):
    material = builder.materials['tire_scuff'] = builder.materials['asphalt'].copy()
    material.name = 'Wasteland/faint tire residue sharing road aggregate'
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    original = shader.inputs['Base Color'].links[0].from_socket
    coverage = nodes.new('ShaderNodeAttribute')
    coverage.attribute_name = 'tireResidueWeight'
    position = nodes.new('ShaderNodeNewGeometry')
    wear = nodes.new('ShaderNodeTexNoise')
    wear.inputs['Scale'].default_value = 38
    wear.inputs['Detail'].default_value = 3
    links.new(position.outputs['Position'], wear.inputs['Vector'])
    mask = nodes.new('ShaderNodeMath')
    mask.operation = 'MULTIPLY'
    links.new(coverage.outputs['Fac'], mask.inputs[0])
    links.new(wear.outputs['Fac'], mask.inputs[1])
    attenuation = nodes.new('ShaderNodeMath')
    attenuation.operation = 'MULTIPLY_ADD'
    attenuation.inputs[1].default_value = -.24
    attenuation.inputs[2].default_value = 1
    links.new(mask.outputs[0], attenuation.inputs[0])
    tint = nodes.new('ShaderNodeMixRGB')
    tint.blend_type = 'MULTIPLY'
    tint.inputs[0].default_value = 1
    links.new(original, tint.inputs[1])
    links.new(attenuation.outputs[0], tint.inputs[2])
    links.new(tint.outputs[0], shader.inputs['Base Color'])


def _tire_scuff_geometry(side, offset, heading):
    vertices, faces, weights = [], [], []
    lanes = (-1, -.5, 0, .5, 1)
    for step in range(97):
        fraction = step / 96
        horizontal = side * (1.82 + offset * .08) + .10 * math.sin(fraction * 5.2) + heading * fraction
        north = -8.25 + fraction * 3.15 + (3.95 if offset > .5 else 0)
        taper = min(1, fraction * 12, (1 - fraction) * 12)
        taper = taper * taper * (3 - 2 * taper)
        for lane in lanes:
            vertices.append((horizontal + lane * .085, north, .00015))
            weights.append((1 - lane * lane) ** 2 * taper)
        if step:
            first = (step - 1) * len(lanes)
            following = step * len(lanes)
            for lane_index in range(len(lanes) - 1):
                faces.append((first + lane_index, first + lane_index + 1,
                              following + lane_index + 1, following + lane_index))
    if any(abs(point[2] - .00015) > 1e-9 for point in vertices):
        raise ValueError('Tire residue must remain at the road contact plane')
    return vertices, faces, weights


def _asphalt_repairs(builder, helpers):
    surfaces = ['concrete', 'masonry', 'dark']
    randomizer = random.Random(482917)
    batch = helpers['batch'](builder.collection, 'Wasteland/authored foreground fragments', [builder.materials[name] for name in surfaces])
    fragments = 0
    for index in range(1900):
        horizontal, north = randomizer.uniform(-7.2, 7.2), randomizer.uniform(-10.4, 6.8)
        if _ground_occupied(horizontal, north) or math.hypot(horizontal + 2, north - 3) < .54:
            continue
        if abs(horizontal) < 1.65 and -10.2 < north < 5.7:
            continue
        edge_deposit = math.exp(-((abs(horizontal) - 6.72) / .40) ** 2)
        edge_deposit *= .55 + .45 * math.sin(north * .47 + horizontal) ** 2
        local_deposit = .7 * math.exp(-((horizontal + 4.1) / .65) ** 2 - ((north - 3.7) / .68) ** 2)
        if randomizer.random() > .045 + edge_deposit * .75 + local_deposit:
            continue
        size = randomizer.uniform(.009, .072)
        angle = randomizer.uniform(0, math.tau)
        radius = [size * randomizer.uniform(.55, 1) for unused in range(5)]
        lower, upper = [], []
        for section in range(5):
            around = angle + section * math.tau / 5
            lower.append((horizontal + radius[section] * math.cos(around), north + radius[section] * math.sin(around), .001))
            upper.append((horizontal + radius[section] * .8 * math.cos(around), north + radius[section] * .8 * math.sin(around), .003 + size * .32))
        batch.prism(upper, lower, index % 3)
        fragments += 1
    instance = batch.finish(bevel=.0015)
    helpers['physical_uv'](instance)
    _road_repair_material(builder)
    patches = [(-1.5, .95, .85, .55), (1.95, -.15, .62, 1.05), (.55, -5.9, .71, .39),
               (-.7, 4.3, .87, .51), (2.8, -7.2, .43, .60)]
    for patch_index, (horizontal, north, width, length) in enumerate(patches):
        vertices, faces, weights = _road_repair_geometry(horizontal, north, width, length, patch_index)
        repair = builder.mesh('irregular feathered asphalt repair', vertices, faces, 'road_patch')
        attribute = repair.data.attributes.new('roadRepairWeight', 'FLOAT', 'POINT')
        for target, weight in zip(attribute.data, weights):
            target.value = weight
        repair['repair_height_maximum_metres'] = max(point[2] for point in vertices)
        repair['repair_edge_contact_metres'] = .00015
        repair['repair_perimeter_blend_metres'] = .08
    crack_count = 0
    for start_x, start_y, angle, length in [(-1.0, -4.9, .7, 3.4), (1.0, -.1, -.6, 3.6),
                                         (-2.8, 1.2, 1.05, 2.9), (.6, 2.6, 1.7, 2.7),
                                         (1.2, -7.6, -.8, 3.0)]:
        points = []
        for step in range(51):
            fraction = step / 50
            meander = .063 * math.sin(step * .47) + .019 * math.sin(step * 1.11)
            horizontal = start_x + math.cos(angle) * fraction * length - math.sin(angle) * meander
            north = start_y + math.sin(angle) * fraction * length + math.cos(angle) * meander
            if _ground_occupied(horizontal, north):
                break
            points.append((horizontal, north, .0008))
        if len(points) > 2:
            builder.seam('hairline settled asphalt joint', points, .0027, 'dark')
            crack_count += 1
    scuff_count = 0
    _tire_scuff_material(builder)
    for side, offset, heading in ((-1, 0.0, .025), (1, .34, -.018), (-1, .68, .012), (1, 1.02, -.010)):
        vertices, faces, weights = _tire_scuff_geometry(side, offset, heading)
        scuff = builder.mesh('faded surface-contact tire residue', vertices, faces, 'tire_scuff')
        attribute = scuff.data.attributes.new('tireResidueWeight', 'FLOAT', 'POINT')
        for target, weight in zip(attribute.data, weights):
            target.value = weight
        helpers['physical_uv'](scuff)
        scuff['residue_contact_offset_metres'] = .00015
        scuff_count += 1
    builder.box('drain frame set flush into paving', (2.53, .88, .004), (.57, .85, .012), 'dark', .012)
    for bar in range(13):
        builder.box('cast iron drain parallel bars', (2.53, .505 + bar * .062, .010), (.53, .022, .011), 'steel', .003)
    for side in (-1, 1):
        builder.box('drain bearing perimeter', (2.53 + side * .272, .88, .008), (.020, .83, .016), 'rust', .004)
    ash = builder.materials['hearth_ash'] = builder.materials['asphalt'].copy()
    ash.name = 'Wasteland/wood ash and soot'
    nodes, links = ash.node_tree.nodes, ash.node_tree.links
    shader = nodes.get('Principled BSDF')
    original = shader.inputs['Base Color'].links[0].from_socket
    coverage = nodes.new('ShaderNodeAttribute')
    coverage.attribute_name = 'roadRepairWeight'
    soot = nodes.new('ShaderNodeMixRGB')
    links.new(coverage.outputs['Fac'], soot.inputs[0])
    links.new(original, soot.inputs[1])
    soot.inputs[2].default_value = (.035, .034, .031, 1)
    links.new(soot.outputs[0], shader.inputs['Base Color'])
    vertices, faces, weights = _road_repair_geometry(-2, 3, .87, .71, 29)
    footprint = builder.mesh('feathered soot and ash contact with existing asphalt', vertices, faces, 'hearth_ash')
    attribute = footprint.data.attributes.new('roadRepairWeight', 'FLOAT', 'POINT')
    for target, weight in zip(attribute.data, weights):
        target.value = weight * .86
    return {'foreground_fragments': fragments, 'patches': len(patches), 'crack_paths': crack_count,
            'tire_scuff_paths': scuff_count}


def _reclaimed_partitions(builder, helpers):
    targets = [instance for instance in builder.objects if instance.get('shelter_role') in
               ('bed alcove rear privacy screen', 'bed alcove foot partition')]
    if len(targets) != 2:
        raise ValueError('Expected exactly two authored sleeping alcove partitions')
    randomizer = random.Random(2258)
    for panel_index, source in enumerate(targets):
        center, extent, low, high = helpers['bounds'](source)
        axis = 0 if extent.x > extent.y else 1
        depth_axis = 1 - axis
        count = 10
        board_width = extent[axis] / count
        for board in range(count):
            position = list(center)
            position[axis] = low[axis] + (board + .5) * board_width
            position[depth_axis] += randomizer.uniform(-.009, .009)
            height = extent.z - randomizer.uniform(0, .045)
            position[2] = height / 2
            dimensions = [extent.x, extent.y, height]
            dimensions[axis] = board_width - .007
            dimensions[depth_axis] = .048
            plank = builder.box('reclaimed individual alcove plank', position, dimensions,
                                f'reclaimed_board_{board % 4}', .003)
            plank.rotation_euler[depth_axis] = randomizer.uniform(-.004, .004)
            for elevation in (.22, 1.19, 2.16):
                first = list(position)
                first[2] = elevation
                first[depth_axis] += .027
                last = first.copy()
                last[depth_axis] += .008
                builder.rod('alcove plank visible nail head', first, last, .0037, 'rust', 12)
        for elevation in (.22, 1.19, 2.16):
            position = list(center)
            position[2] = elevation
            position[depth_axis] -= .038
            dimensions = [.045, .045, .075]
            dimensions[axis] = extent[axis] - .04
            builder.box('alcove rear horizontal bearer', position, dimensions, 'wood', .005)
        source.hide_render = True
    rug_parts = [instance for instance in builder.objects if any(term in instance.get('shelter_role', '')
                 for term in ('central runner', 'runner bound', 'runner worn'))]
    bpy.context.view_layer.update()
    transform = Matrix.Translation((-2.85, -6.35, 0)) @ Matrix.Diagonal((.39, .30, 1, 1)) @ Matrix.Translation((-.10, 2.93, 0))
    for instance in rug_parts:
        instance.matrix_world = transform @ instance.matrix_world
        if instance.type == 'MESH':
            helpers['physical_uv'](instance)
    return {'replaced_panels': len(targets), 'relocated_rug_components': len(rug_parts)}


def _working_settlement(builder):
    utility_start = len(builder.objects)
    gutter_vertices, gutter_faces = [], []
    for station in range(33):
        north = -8.95 + station / 32 * 4.98
        for section in range(17):
            angle = math.pi + section * math.pi / 16
            gutter_vertices.append((-6.11 + math.cos(angle) * .048, north,
                                    3.025 - station / 32 * .022 + math.sin(angle) * .042))
    for station in range(32):
        for section in range(16):
            vertex = station * 17 + section
            gutter_faces.append((vertex, vertex + 1, vertex + 18, vertex + 17))
    builder.cloth('reclaimed half-round rain gutter on canopy edge', gutter_vertices, gutter_faces, 'steel', .0015)
    for north in (-8.6, -7.45, -6.3, -5.15, -4.16):
        builder.rod('canopy rain gutter bracket', (-6.11, north, 2.991), (-5.96, north, 2.945), .009, 'steel', 24)
    builder.lathe('rainwater storage reused steel drum', (-6.10, .91, .035),
                  [(.001, 0), (.27, 0), (.291, .032), (.289, .14), (.293, .17), (.291, .20),
                   (.288, .41), (.301, .425), (.301, .45), (.288, .47), (.288, .70),
                   (.299, .725), (.299, .747), (.287, .77), (.288, .94), (.299, .96),
                   (.299, .985), (.28, .997), (.001, .997)], 'salvaged_sheet_olive', 96)
    builder.lathe('rain drum top removable strainer collar', (-6.10, .91, 1.032),
                  [(.045, 0), (.16, .05), (.17, .068), (.166, .076), (.155, .055), (.04, .009)], 'steel', 64)
    builder.seam('rain collector elbow downpipe to drum',
                 [(-6.11, -3.97, 3.00), (-6.17, -3.95, 2.97), (-6.23, -3.91, 2.77),
                  (-6.23, -3.91, 1.31), (-6.23, .61, 1.31), (-6.10, .91, 1.26), (-6.10, .91, 1.081)], .028, 'steel')
    for north in (-3.68, -2.35, -1.04):
        builder.box('rain downpipe salvaged support angle', (-6.22, north, 1.252), (.09, .045, .12), 'steel', .004)
        builder.rod('rain collector pipe bearing stanchion', (-6.25, north, .025), (-6.25, north, 1.27), .022, 'steel', 32)
        builder.box('rain collector stanchion foot', (-6.25, north, .025), (.16, .15, .05), 'steel', .007)
    builder.rod('rainwater drum tap threaded boss', (-5.84, .91, .44), (-5.61, .91, .44), .025, 'copper', 48)
    builder.rod('rainwater drum tap outlet', (-5.61, .91, .45), (-5.61, .91, .365), .013, 'copper', 40)
    builder.rod('rainwater tap shutoff lever', (-5.825, .91, .468), (-5.755, .91, .468), .006, 'steel', 24)
    builder.lathe('rainwater collection galvanized pail', (-5.59, .91, .015),
                  [(.001, 0), (.13, 0), (.14, .01), (.182, .267), (.184, .282), (.175, .289),
                   (.168, .275), (.132, .020), (.001, .02)], 'salvaged_sheet_cool', 72)
    builder.seam('collection pail raised wire handle',
                 [(-5.765, .91, .253), (-5.778, .91, .39), (-5.67, .91, .475),
                  (-5.50, .91, .475), (-5.405, .91, .39), (-5.417, .91, .253)], .005, 'steel')
    builder.rod('utility light independent steel mast', (6.96, -8.1, 0), (6.96, -8.1, 3.91), .043, 'steel', 40)
    builder.box('utility light bolted mast foot', (6.96, -8.1, .033), (.25, .25, .066), 'steel', .012)
    builder.rod('utility light sidearm', (6.96, -8.1, 3.70), (6.65, -8.1, 3.74), .025, 'steel', 40)
    builder.box('salvaged rectangular utility luminaire housing', (6.53, -8.1, 3.74), (.35, .22, .095), 'steel', .025)
    builder.box('utility luminaire opal protective cover', (6.53, -8.1, 3.688), (.29, .175, .018), 'utility_glass', .018)
    builder.area('cool utility luminaire', (6.53, -8.1, 3.675), (3.8, -9.3, 0), 76, .21, '#c9e1df')
    builder.seam('utility luminaire protected supply lead',
                 [(6.96, -8.1, 3.72), (6.984, -8.1, 2.01), (6.984, -8.1, .19),
                  (6.89, -7.85, .055), (6.69, -5.36, .055)], .009, 'dark')
    for horizontal in (-4.73, -2.1):
        builder.rod('laundry rail salvaged support post', (horizontal, -10.70, 0), (horizontal, -10.70, 2.08), .028, 'steel', 40)
    builder.seam('laundry clothesline under tension',
                 [(-4.73 + step / 64 * 2.63, -10.70, 2.05 - .10 * math.sin(step / 64 * math.pi)) for step in range(65)], .003, 'rug_binding')
    for cloth_index, (horizontal, width, height) in enumerate(((-4.20, .46, .72), (-3.49, .62, .89))):
        vertices, faces = [], []
        for row in range(41):
            fraction = row / 40
            for column in range(41):
                across = (column / 40 - .5) * width
                rail_height = 2.05 - .10 * math.sin((horizontal + across + 4.73) / 2.63 * math.pi)
                vertices.append((horizontal + across, -10.70 + .018 * math.sin(column * .49) * fraction,
                                 rail_height - .015 - height * fraction + .009 * math.sin(column * .23) * fraction))
        for row in range(40):
            for column in range(40):
                start = row * 41 + column
                faces.append((start, start + 1, start + 42, start + 41))
        builder.cloth('washed hanging settlement linen', vertices, faces, 'linen_blue' if cloth_index else 'cloth', .003)
        for edge in (-1, 1):
            across = horizontal + edge * width * .39
            rail_height = 2.05 - .10 * math.sin((across + 4.73) / 2.63 * math.pi)
            builder.box('laundry spring wooden peg', (across, -10.70, rail_height - .025), (.025, .036, .065), 'reclaimed_board_3', .003)
    bpy.context.view_layer.update()
    checked = 0
    for instance in builder.objects[utility_start:]:
        if instance.type not in ('MESH', 'CURVE'):
            continue
        points = [instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
        if min(point.x for point in points) < 1.65 and max(point.x for point in points) > -1.65:
            raise ValueError('New settlement utility would intrude on the central walkway: ' + instance.name)
        checked += 1
    return {'rainwater_collection': True, 'utility_light': True, 'hung_linen': 2,
            'central_walkway_objects_checked': checked, 'central_walkway_intrusions': 0}


def _lighting(builder, helpers):
    changed = 0
    for instance in builder.objects:
        role = instance.get('shelter_role', '')
        if instance.type == 'LIGHT' and role == 'festoon ground light':
            instance.data.energy *= .24 if instance.location.y < -4 else .43
            instance.data.color = helpers['color']('#ffe2b7')
            changed += 1
        if instance.type == 'LIGHT' and 'sleep nook' in role:
            instance.data.energy *= .48
            instance.data.color = helpers['color']('#ffd7a4')
        if instance.type == 'LIGHT' and 'galley' in role:
            instance.data.color = helpers['color']('#e9eee2')
    return changed


def refine(scene, builder, helpers):
    _weathered_materials(builder, helpers)
    result = {'ground': _asphalt_repairs(builder, helpers),
              'settlement_walls': _settlement_enclosures(scene, builder, helpers),
              'partitions': _reclaimed_partitions(builder, helpers),
              'working_settlement': _working_settlement(builder),
              'practical_lights_adjusted': _lighting(builder, helpers)}
    print('STREET_CLOSE_RANGE_REFINEMENT', result, flush=True)
    return result
