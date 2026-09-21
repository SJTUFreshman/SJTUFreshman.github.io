"""Offline shelter architecture, inhabited furniture groups and practical lighting."""
import json
import math
import random
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector


COLLECTION = 'Shelter inhabited architecture v5'
TEXTURES = Path(__file__).resolve().parents[1] / 'assets' / 'life' / 'textures'


def color(value):
    number = int(value.lstrip('#'), 16)
    channels = [(number >> shift & 255) / 255 for shift in (16, 8, 0)]
    return tuple(value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in channels)


def material(name, tint, roughness=.8, metalness=0, grain=0):
    result = bpy.data.materials.new('Shelter/' + name)
    result.use_nodes = True
    nodes, links = result.node_tree.nodes, result.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = color(tint) + (1,)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metalness
    if grain:
        coordinates = nodes.new('ShaderNodeTexCoord')
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 145
        noise.inputs['Detail'].default_value = 4
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Distance'].default_value = grain
        bump.inputs['Strength'].default_value = .25
        links.new(coordinates.outputs['Object'], noise.inputs['Vector'])
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    return result


def textured_material(name, prefix, tint='#ffffff', repeat=1, saturation=1, normal_strength=.35, textile=False):
    result = material(name, tint)
    nodes, links = result.node_tree.nodes, result.node_tree.links
    shader = nodes.get('Principled BSDF')
    coordinates = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value = (repeat, repeat, repeat)
    links.new(coordinates.outputs['UV'], mapping.inputs['Vector'])
    paths = {
        'color': TEXTURES / (prefix + '_1k.jpg'),
        'normal': TEXTURES / (('fabric_pattern_07' if textile else prefix.removesuffix('_diff')) + '_nor_gl_1k.jpg'),
        'roughness': TEXTURES / (('fabric_pattern_07' if textile else prefix.removesuffix('_diff')) + '_rough_1k.jpg')
    }
    textures = {}
    for channel, source in paths.items():
        if not source.exists():
            raise FileNotFoundError(source)
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(source), check_existing=True)
        texture.image.colorspace_settings.name = 'sRGB' if channel == 'color' else 'Non-Color'
        texture.interpolation = 'Linear'
        links.new(mapping.outputs['Vector'], texture.inputs['Vector'])
        textures[channel] = texture
    hue = nodes.new('ShaderNodeHueSaturation')
    hue.inputs['Saturation'].default_value = saturation
    links.new(textures['color'].outputs['Color'], hue.inputs['Color'])
    multiply = nodes.new('ShaderNodeMixRGB')
    multiply.blend_type = 'MULTIPLY'
    multiply.inputs[0].default_value = 1
    multiply.inputs[2].default_value = color(tint) + (1,)
    links.new(hue.outputs['Color'], multiply.inputs[1])
    links.new(multiply.outputs['Color'], shader.inputs['Base Color'])
    roughness = nodes.new('ShaderNodeMapRange')
    roughness.inputs['To Min'].default_value = .73 if textile else .42
    roughness.inputs['To Max'].default_value = .99 if textile else .85
    links.new(textures['roughness'].outputs['Color'], roughness.inputs['Value'])
    links.new(roughness.outputs['Result'], shader.inputs['Roughness'])
    normal = nodes.new('ShaderNodeNormalMap')
    normal.inputs['Strength'].default_value = normal_strength
    links.new(textures['normal'].outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    if textile:
        shader.inputs['Sheen Weight'].default_value = .22
        shader.inputs['Sheen Roughness'].default_value = .8
    result['shelter_texture_source'] = prefix
    result['shelter_texture_repeat_per_meter'] = repeat
    return result


def physical_uv(instance):
    geometry = instance.data
    layer = geometry.uv_layers.active or geometry.uv_layers.new(name='UVMap')
    for polygon in geometry.polygons:
        dominant = max(range(3), key=lambda axis: abs(polygon.normal[axis]))
        axes = (1, 2) if dominant == 0 else (0, 2) if dominant == 1 else (0, 1)
        for loop_index in polygon.loop_indices:
            position = instance.matrix_world @ geometry.vertices[geometry.loops[loop_index].vertex_index].co
            layer.data[loop_index].uv = (position[axes[0]], position[axes[1]])


class Builder:
    def __init__(self, scene):
        self.collection = bpy.data.collections.new(COLLECTION)
        scene.collection.children.link(self.collection)
        self.objects = []
        self.materials = {
            'steel': material('salvaged painted steel', '#4c554d', .63, .48, .00018),
            'wood': textured_material('oiled reclaimed timber', 'wood_floor_diff', '#e8e1d6', .7, .68, .35),
            'plywood': textured_material('reclaimed oak panel faces', 'wood_floor_diff', '#ede6d4', .50, .35, .22),
            'plaster': textured_material('warm lime repair plaster', 'brushed_concrete_diff', '#c8c3b5', .45, .15, .18),
            'concrete': textured_material('board cast concrete', 'brushed_concrete_diff', '#bbb8ac', .65, .25, .4),
            'cloth': textured_material('undyed woven linen', 'fabric_pattern_07_col_03', '#c5bfa9', 4, .08, .46, True),
            'olive': textured_material('olive woven cushion', 'fabric_pattern_07_col_03', '#aab298', 3.5, .28, .5, True),
            'rug': textured_material('muted madder woven rug', 'fabric_pattern_07_col_1', '#a99b89', 1.45, .35, .65, True),
            'rug_binding': textured_material('rug reinforced binding', 'fabric_pattern_07_col_03', '#8d8776', 5, .03, .5, True),
            'canister': material('molded olive polyethylene', '#737c62', .54, 0, .00012),
            'rust': material('cast iron stove', '#373b35', .72, .55, .0004),
            'paper': material('creased stationery', '#c5bda3', .99),
            'dark': material('rubber and shadow', '#262e29', .91),
            'ceramic': material('enamel pale mug', '#cac7b4', .38, .12),
            'amber': material('lamp opal glass', '#e3d5b5', .43),
            'copper': material('aged brushed copper', '#96765a', .43, .83, .00008),
            'linen_blue': textured_material('faded blue kitchen linen', 'fabric_pattern_07_col_03', '#75888b', 4, .15, .48, True),
            'bark': textured_material('rough split firewood', 'wood_floor_diff', '#958274', .9, .25, .65),
        }
        shader = self.materials['amber'].node_tree.nodes.get('Principled BSDF')
        shader.inputs['Emission Color'].default_value = color('#ffe3b4') + (1,)
        shader.inputs['Emission Strength'].default_value = 2.3

    def attach(self, instance, role):
        for collection in list(instance.users_collection):
            collection.objects.unlink(instance)
        self.collection.objects.link(instance)
        instance.name = 'Shelter/' + role
        instance['shelter_role'] = role
        self.objects.append(instance)
        return instance

    def box(self, role, center, dimensions, surface, bevel=.008):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        instance = self.attach(bpy.context.object, role)
        instance.dimensions = dimensions
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        instance.data.materials.append(self.materials[surface])
        modifier = instance.modifiers.new('Physical edge radius', 'BEVEL')
        modifier.width = min(bevel, min(dimensions) * .3)
        modifier.segments = 4
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        for polygon in instance.data.polygons:
            polygon.use_smooth = True
        modifier = instance.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        modifier.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        physical_uv(instance)
        return instance

    def rod(self, role, first, last, radius, surface, vertices=40):
        first, last = Vector(first), Vector(last)
        direction = last - first
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length,
                                           location=(first + last) * .5)
        instance = self.attach(bpy.context.object, role)
        instance.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
        instance.data.materials.append(self.materials[surface])
        for polygon in instance.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4
        physical_uv(instance)
        return instance

    def mesh(self, role, vertices, faces, surface, smooth=True):
        geometry = bpy.data.meshes.new('Shelter/' + role)
        geometry.from_pydata(vertices, [], faces)
        geometry.update()
        topology = bmesh.new()
        topology.from_mesh(geometry)
        bmesh.ops.recalc_face_normals(topology, faces=list(topology.faces))
        topology.to_mesh(geometry)
        topology.free()
        for polygon in geometry.polygons:
            polygon.use_smooth = smooth
        geometry.materials.append(self.materials[surface])
        instance = bpy.data.objects.new('Shelter/' + role, geometry)
        self.collection.objects.link(instance)
        instance['shelter_role'] = role
        self.objects.append(instance)
        physical_uv(instance)
        return instance

    def cushion(self, role, center, dimensions, surface):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, radius=1, location=center)
        instance = self.attach(bpy.context.object, role)
        for vertex in instance.data.vertices:
            softened = [math.copysign(abs(value) ** .35, value) for value in vertex.co]
            vertex.co = tuple(softened[axis] * dimensions[axis] * .5 for axis in range(3))
        for polygon in instance.data.polygons:
            polygon.use_smooth = True
        instance.data.materials.append(self.materials[surface])
        physical_uv(instance)
        return instance

    def seam(self, role, points, radius, surface):
        geometry = bpy.data.curves.new('Shelter/' + role, 'CURVE')
        geometry.dimensions = '3D'
        geometry.resolution_u = 1
        geometry.bevel_depth = radius
        geometry.bevel_resolution = 2
        spline = geometry.splines.new('POLY')
        spline.points.add(len(points) - 1)
        for target, point in zip(spline.points, points):
            target.co = tuple(point) + (1,)
        geometry.materials.append(self.materials[surface])
        instance = bpy.data.objects.new('Shelter/' + role, geometry)
        self.collection.objects.link(instance)
        instance['shelter_role'] = role
        self.objects.append(instance)
        return instance

    def cloth(self, role, vertices, faces, surface, thickness=.005):
        instance = self.mesh(role, vertices, faces, surface)
        modifier = instance.modifiers.new('Fabric physical thickness', 'SOLIDIFY')
        modifier.thickness = thickness
        modifier.offset = 0
        return instance

    def lathe(self, role, center, profile, surface, segments=96):
        vertices, faces = [], []
        for radius, height in profile:
            for section in range(segments):
                angle = section * math.tau / segments
                vertices.append((center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle), center[2] + height))
        for row in range(len(profile) - 1):
            for section in range(segments):
                following = (section + 1) % segments
                faces.append((row * segments + section, row * segments + following,
                              (row + 1) * segments + following, (row + 1) * segments + section))
        return self.mesh(role, vertices, faces, surface)

    def area(self, role, center, target, power, size, tint='#ffdfb6'):
        data = bpy.data.lights.new('Shelter/' + role, 'AREA')
        data.energy = power
        data.shape = 'DISK'
        data.size = size
        data.color = color(tint)
        instance = bpy.data.objects.new('Shelter/' + role, data)
        self.collection.objects.link(instance)
        instance.location = center
        instance.rotation_euler = (Vector(target) - Vector(center)).to_track_quat('-Z', 'Y').to_euler()
        instance['shelter_role'] = role
        self.objects.append(instance)

    def pendant(self, role, horizontal, forward, height, power, radius=.25):
        self.rod(role + ' conduit', (horizontal, forward, height + .20), (horizontal, forward, 4.10), .013, 'dark', 24)
        vertices, faces = [], []
        profile = [(.07, .20), (.13, .16), (radius * .85, .065), (radius, 0),
                   (radius - .012, -.012), (radius * .82, .050), (.115, .145), (.057, .18)]
        for section_radius, elevation in profile:
            for section in range(64):
                angle = section * math.tau / 64
                vertices.append((horizontal + math.cos(angle) * section_radius,
                                 forward + math.sin(angle) * section_radius, height + elevation))
        for profile_index in range(len(profile)):
            following = (profile_index + 1) % len(profile)
            for section in range(64):
                next_section = (section + 1) % 64
                faces.append((profile_index * 64 + section, profile_index * 64 + next_section,
                              following * 64 + next_section, following * 64 + section))
        self.mesh(role + ' pressed steel shade', vertices, faces, 'steel')
        self.rod(role + ' opal diffuser', (horizontal, forward, height - .005),
                 (horizontal, forward, height - .025), radius * .83, 'amber', 64)
        self.area(role + ' practical area source', (horizontal, forward, height - .04),
                  (horizontal, forward, 0), power, radius * 1.65)


def bounds(instance):
    corners = [instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
    low = Vector(tuple(min(corner[axis] for corner in corners) for axis in range(3)))
    high = Vector(tuple(max(corner[axis] for corner in corners) for axis in range(3)))
    return (low + high) * .5, high - low, low, high


def seat_props(scene):
    bpy.context.view_layer.update()
    expected = [('map', (4.8, -3.3, 1.02), (1.3, 1.6, .045)),
                ('mug', (5.36, -4.65, 1.12), (.28, .28, .25)),
                ('receiver', (4.55, -5.1, 1.19), (1, .55, .42))]
    existing = [(instance, *bounds(instance)) for instance in scene.objects
                if instance.type == 'MESH' and instance.name.startswith('NightWorld/mesh') and not instance.hide_render]
    report = []
    for name, center, extent in expected:
        matches = [(instance, low) for instance, actual_center, actual_extent, low, high in existing
                   if (actual_center - Vector(center)).length < .003 and (actual_extent - Vector(extent)).length < .01]
        if len(matches) != 1:
            raise RuntimeError(f'Shelter {name}: expected one exact object, found {len(matches)}.')
        target, low = matches[0]
        shift = .9605 - low.z
        group = [target]
        if name == 'receiver':
            for instance, actual_center, actual_extent, minimum, maximum in existing:
                if instance == target:
                    continue
                if 4.34 < actual_center.x < 5.17 and -5.46 < actual_center.y < -4.96 and 1.04 < actual_center.z < 2.4 and actual_extent.z < 1:
                    group.append(instance)
            if len(group) != 9:
                raise RuntimeError(f'Shelter receiver: expected nine assembly components, found {len(group)}.')
        for instance in group:
            instance.location.z += shift
            instance['shelter_contact_correction'] = shift
        report.append({'assembly': name, 'objects': len(group), 'vertical_adjustment': shift, 'contact_height': .9605})
    return report


def organize_crates(scene):
    report = []
    bpy.context.view_layer.update()
    existing = [(instance, *bounds(instance)) for instance in scene.objects
                if instance.type == 'MESH' and instance.name.startswith('NightWorld/mesh') and not instance.hide_render]
    for index in range(4):
        original_x = -2.8 + index * 1.8
        destination = Vector((-4.25 + (index % 2) * 1.75, -9.48, .45 + (index // 2) * .903))
        offset = destination - Vector((original_x, -9.6, .45))
        matches = []
        for instance, center, extent, minimum, maximum in existing:
            if abs(center.x - original_x) < .55 and -10.09 < center.y < -9.58 and .01 < center.z < .90:
                if extent.x < 1.51 and extent.y < .91 and extent.z <= .905:
                    matches.append(instance)
        if len(matches) != 3:
            raise RuntimeError(f'Shelter crate {index}: expected body and two straps, found {len(matches)}.')
        for instance in matches:
            instance.location += offset
        report.append({'crate': index, 'destination': list(destination), 'components': len(matches)})
    return report


def existing_surface_refinement(scene, builder):
    bpy.context.view_layer.update()
    report = []
    for instance in list(scene.objects):
        if instance.type != 'MESH' or not instance.name.startswith('NightWorld/mesh') or instance.hide_render:
            continue
        center, extent, minimum, maximum = bounds(instance)
        surface = None
        if (center - Vector((4.8, -4, .88))).length < .01 and abs(extent.x - 2.4) < .02:
            surface = 'wood'
        elif -5.1 < center.x < -1.4 and -10.0 < center.y < -9.0 and abs(extent.x - 1.5) < .02 and abs(extent.z - .9) < .02:
            surface = 'plywood'
        elif -5.4 < center.x < -4.2 and -7.6 < center.y < -5.4 and .46 < center.z < 1.0 and extent.x > .55:
            instance.hide_render = True
            report.append({'object': instance.name, 'replacement': 'tailored bed linens'})
            continue
        if surface:
            instance.data = instance.data.copy()
            instance.data.materials.clear()
            instance.data.materials.append(builder.materials[surface])
            physical_uv(instance)
            report.append({'object': instance.name, 'surface': surface})
    return report


def joinery(builder):
    for panel_x, panel_y, panel_width, panel_height, edge_axis in [
        (-4.8, -7.69, 1.48, 2.40, 0), (-3.64, -6.95, 1.54, 2.38, 1)
    ]:
        for side in [-1, 1]:
            position = [panel_x, panel_y, panel_height * .5]
            position[edge_axis] += side * (panel_width * .5 - .033)
            dimensions = [.075, .075, panel_height]
            builder.box('privacy screen oak edge stile', position, dimensions, 'wood', .006)
        for elevation in [.095, 1.17, panel_height - .095]:
            dimensions = [.055, .055, .13]
            dimensions[edge_axis] = panel_width - .11
            builder.box('privacy screen inset cross rail', (panel_x, panel_y + .066, elevation), dimensions, 'wood', .005)
    for height in [.055, .65]:
        builder.box('bedside trunk horizontal frame', (-3.67, -5.165, height), (.57, .04, .064), 'wood', .005)
    for horizontal in [-3.92, -3.42]:
        builder.box('bedside trunk corner joint', (horizontal, -5.166, .35), (.064, .045, .61), 'wood', .004)
    builder.box('bedside trunk hasp plate', (-3.67, -5.144, .61), (.047, .009, .095), 'steel', .003)
    builder.rod('bedside trunk brass latch pin', (-3.703, -5.133, .607), (-3.637, -5.133, .607), .009, 'steel', 24)
    for horizontal in [-3.90, -3.44]:
        for elevation in [.10, .62]:
            builder.rod('trunk recessed screw', (horizontal, -5.144, elevation), (horizontal, -5.133, elevation), .006, 'steel', 16)
    for horizontal in [-4.19, -3.01]:
        builder.box('bench mortised side stretcher', (horizontal, -.98, .20), (.048, .52, .07), 'wood', .004)
    builder.box('bench lower longitudinal stretcher', (-3.60, -1.20, .20), (1.18, .047, .07), 'wood', .004)
    for forward in [-1.20, -.76]:
        builder.box('bench seat apron', (-3.60, forward, .315), (1.3, .045, .10), 'wood', .005)
    for horizontal in [3.79, 5.81]:
        builder.box('workbench edge apron', (horizontal, -4, .765), (.07, 3.58, .16), 'wood', .008)
        for forward in [-2.35, -5.65]:
            builder.box('workbench leg corner bracket', (horizontal, forward, .79), (.10, .13, .11), 'steel', .004)
    for forward in [-2.03, -5.97]:
        builder.box('workbench breadboard end', (4.8, forward, .881), (2.38, .15, .158), 'wood', .009)
    for index in range(4):
        horizontal = -4.25 + (index % 2) * 1.75
        center_height = .45 + (index // 2) * .903
        for plank_index in range(5):
            height = center_height - .359 + plank_index * .178
            builder.box('supply chest front individual stave', (horizontal, -9.015, height),
                        (1.46, .032, .17), 'plywood', .006)
        for side in [-1, 1]:
            builder.box('supply chest face reinforcing batten', (horizontal + side * .53, -8.984, center_height),
                        (.09, .035, .845), 'wood', .006)
            for height in [center_height - .33, center_height + .33]:
                builder.rod('supply chest countersunk nail', (horizontal + side * .53, -8.961, height),
                            (horizontal + side * .53, -8.952, height), .009, 'steel', 20)
        builder.box('supply chest center clasp', (horizontal, -8.988, center_height + .27),
                    (.085, .02, .16), 'steel', .006)


def bed_linens(builder):
    builder.cushion('thick fitted linen mattress', (-4.8, -6.5, .59), (1.05, 1.92, .245), 'cloth')
    builder.cushion('settled linen pillow', (-4.8, -5.88, .80), (.80, .41, .22), 'cloth')
    for side in [-1, 1]:
        vertices, faces = [], []
        for row in range(25):
            depth = row / 24
            for column in range(97):
                along = column / 96
                forward = -7.43 + along * 1.86
                pleat = math.sin(along * math.pi * 18) * .015 + math.sin(along * math.pi * 34) * .004
                horizontal = -4.8 + side * (.525 + pleat * (depth ** .5))
                height = .62 - depth * .37 + .012 * math.sin(along * math.pi * 12) * depth
                vertices.append((horizontal, forward, height))
        for row in range(24):
            for column in range(96):
                start = row * 97 + column
                faces.append((start, start + 1, start + 98, start + 97))
        builder.cloth('gathered bed valance', vertices, faces, 'cloth', .003)
    vertices, faces = [], []
    for row in range(85):
        along = row / 84
        forward = -7.54 + along * 1.55
        for column in range(97):
            across = column / 96 * 1.44 - .72
            overhang = max(0, abs(across) - .48)
            drape = min(.27, overhang * 1.13)
            fold = .023 * math.sin(across * 17 + along * 4) * math.sin(along * math.pi)
            fold += .012 * math.sin(across * 39 - along * 9) * (overhang / .24)
            foot = max(0, .14 - along) * 1.08
            height = .739 - drape - foot + fold
            vertices.append((-4.8 + across, forward, height))
    for row in range(84):
        for column in range(96):
            start = row * 97 + column
            faces.append((start, start + 1, start + 98, start + 97))
    builder.cloth('olive wool blanket with hanging folds', vertices, faces, 'olive', .008)
    builder.seam('blanket reinforced hem', vertices[-97:], .004, 'rug_binding')


def architecture(builder):
    for forward in [-8.2, -3.0, 3.15]:
        builder.box(f'ceiling structural beam {forward}', (0, forward, 3.90), (12.6, .26, .40), 'concrete', .035)
        for side in [-1, 1]:
            builder.box(f'beam bearing pier {side} {forward}', (side * 6.17, forward, 1.9),
                        (.24, .37, 3.8), 'concrete', .025)
    for side in [-1, 1]:
        for index in range(6):
            forward = -8.7 + index * 2.2
            builder.box(f'wall repair wainscot {side} {index}', (side * 6.305, forward, .65),
                        (.025, 2.16, 1.18), 'plaster', .008)
            builder.box(f'wall board cast joint {side} {index}', (side * 6.288, forward + 1.065, 2.6),
                        (.008, .012, 2.64), 'dark', .001)
        builder.rod(f'ceiling power trunk {side}', (side * 4.1, -9.8, 3.80), (side * 4.1, 4.2, 3.80), .023, 'steel')
        for forward in [-8.2, -3, 3.15]:
            builder.box(f'conduit beam bracket {side} {forward}', (side * 4.1, forward, 3.82),
                        (.11, .065, .19), 'steel', .004)
    builder.box('rear entry seal', (0, -10.467, 1.20), (1.45, .055, 2.4), 'dark', .018)
    builder.box('rear reinforced entrance door', (0, -10.425, 1.17), (1.28, .065, 2.3), 'steel', .035)
    for side in [-1, 1]:
        builder.box(f'entry jamb {side}', (side * .72, -10.36, 1.23), (.14, .12, 2.46), 'steel', .008)
    builder.box('entry lintel', (0, -10.36, 2.48), (1.58, .12, .14), 'steel', .008)
    builder.rod('entrance pull handle', (.43, -10.33, .95), (.43, -10.33, 1.20), .021, 'steel')
    for elevation in [.95, 1.20]:
        builder.rod('entrance handle mounting boss', (.43, -10.40, elevation),
                    (.43, -10.33, elevation), .021, 'steel')
    builder.box('door threshold', (0, -10.30, .028), (1.56, .31, .056), 'steel', .008)


def sleeping_nook(builder):
    builder.box('bed alcove rear privacy screen', (-4.8, -7.69, 1.20), (1.48, .11, 2.40), 'plywood', .022)
    builder.box('bed alcove foot partition', (-3.64, -6.95, 1.19), (.09, 1.54, 2.38), 'plywood', .014)
    for horizontal in [-5.55, -3.69]:
        builder.rod('sleep nook curtain rail upright', (horizontal, -5.13, 0),
                    (horizontal, -5.13, 2.53), .024, 'steel')
    builder.rod('sleep nook curtain track', (-5.57, -5.13, 2.53), (-3.67, -5.13, 2.53), .022, 'steel')
    vertices, faces = [], []
    for row in range(65):
        elevation = .18 + row / 64 * 2.32
        for column in range(41):
            horizontal = -5.5 + column / 40 * .45
            forward = -5.13 + math.sin(column / 40 * math.pi * 10) * .045 + math.sin(row * .12) * .008
            vertices.append((horizontal, forward, elevation))
    for row in range(64):
        for column in range(40):
            start = row * 41 + column
            faces.append((start, start + 1, start + 42, start + 41))
    builder.cloth('gathered linen privacy curtain', vertices, faces, 'cloth', .003)
    builder.box('bedside trunk', (-3.67, -5.50, .34), (.57, .63, .68), 'wood', .023)
    builder.box('bedside trunk lid', (-3.67, -5.50, .70), (.59, .65, .055), 'plywood', .01)
    for index in range(3):
        builder.box(f'bedside stacked book {index}', (-3.72, -5.48, .746 + index * .044),
                    (.26, .36, .036), 'paper', .002)
    builder.box('sleep nook high shelf', (-4.81, -7.51, 1.96), (1.34, .37, .055), 'wood', .008)
    for index in range(4):
        builder.box(f'personal notebook {index}', (-5.29 + index * .12, -7.46, 2.123),
                    (.092, .24, .27), 'paper' if index % 2 else 'olive', .003)
    builder.pendant('sleep nook reading lamp', -4.01, -6.58, 2.42, 72, .15)


def lounge(builder):
    builder.box('stove sitting bench frame', (-3.60, -.98, .35), (1.52, .71, .085), 'wood', .017)
    for horizontal in [-4.19, -3.01]:
        for forward in [-1.23, -.73]:
            builder.box('bench tapered leg', (horizontal, forward, .17), (.075, .075, .34), 'wood')
    builder.cushion('bench lived-in seat cushion', (-3.60, -.98, .48), (1.42, .62, .18), 'olive')
    builder.box('bench back frame', (-3.6, -1.30, .805), (1.46, .07, .91), 'wood', .025)
    builder.cushion('bench soft back cushion', (-3.6, -1.20, .88), (1.36, .18, .61), 'cloth')
    builder.box('low reading table', (-2.45, .05, .55), (.75, .79, .065), 'wood', .026)
    for horizontal in [-2.73, -2.17]:
        for forward in [-.22, .32]:
            builder.rod('small table splayed leg', (horizontal, forward, .01),
                        (horizontal * .995, forward * .91, .52), .027, 'steel')
    builder.box('folded route map', (-2.47, .10, .588), (.45, .49, .004), 'paper', .0008)
    builder.rod('table candle jar', (-2.21, -.17, .584), (-2.21, -.17, .72), .058, 'ceramic', 48)
    vertices, faces = [], []
    for row in range(49):
        for column in range(73):
            across, along = column / 72, row / 48
            horizontal = -1.52 + across * 3.24 + math.sin(along * 23) * .007
            forward = -4.43 + along * 3.0 + math.sin(across * 27) * .006
            edge = min(across, 1 - across, along, 1 - along)
            compressed = .014 * math.exp(-((across - .16 - along * .08) / .025) ** 2) * math.sin(along * math.pi)
            curled = .022 * math.exp(-((across - .96) ** 2 + (along - .06) ** 2) / .008)
            height = .009 + .003 * math.sin(column * .31) * math.sin(row * .27) + compressed + curled
            height += .004 * math.exp(-edge * 45)
            vertices.append((horizontal, forward, height))
    for row in range(48):
        for column in range(72):
            start = row * 73 + column
            faces.append((start, start + 1, start + 74, start + 73))
    builder.cloth('reclaimed woven central runner', vertices, faces, 'rug', .007)
    edge_paths = [vertices[:73], vertices[-73:], vertices[::73], vertices[72::73]]
    for edge_index, points in enumerate(edge_paths):
        builder.seam(f'runner bound edge {edge_index}', points, .007, 'rug_binding')
    for edge_row, direction in [(0, -1), (48, 1)]:
        for column in range(2, 72):
            start = vertices[edge_row * 73 + column]
            length = .035 + .009 * math.sin(column * 1.71)
            points = [start, (start[0] + .004 * math.sin(column), start[1] + direction * length * .5, .008),
                      (start[0] + .008 * math.sin(column * .7), start[1] + direction * length, .006)]
            builder.seam('runner worn fringe bundle', points, .0018, 'rug_binding')


def supplies_and_work(builder):
    for horizontal in [2.52, 5.57]:
        for forward in [-10.06, -9.46]:
            builder.box('pantry rack upright', (horizontal, forward, 1.37), (.057, .057, 2.74), 'steel', .003)
    for elevation in [.18, .83, 1.49, 2.15]:
        builder.box('pantry usable shelf', (4.04, -9.76, elevation), (3.08, .70, .065), 'wood', .009)
    for index in range(6):
        horizontal = 2.83 + index * .46
        builder.rod('pantry enamel food tin', (horizontal, -9.74, 1.525),
                    (horizontal, -9.74, 1.78 + (index % 2) * .04), .115, 'ceramic', 48)
        builder.rod('pantry tin rolled lip', (horizontal, -9.74, 1.775 + (index % 2) * .04),
                    (horizontal, -9.74, 1.795 + (index % 2) * .04), .12, 'steel', 48)
    for index in range(3):
        horizontal = 3.0 + index * .85
        builder.box('water reserve canister', (horizontal, -9.75, .465), (.56, .42, .50), 'canister', .06)
        builder.box('water canister molded handle', (horizontal, -9.75, .75), (.27, .16, .08), 'dark', .02)
    builder.box('work wall cork backing', (6.282, -3.75, 2.23), (.06, 2.06, 1.24), 'wood', .012)
    for index in range(5):
        builder.box('pinned personal page', (6.24, -4.54 + index * .34, 2.28 + (index % 2) * .13),
                    (.003, .27, .41), 'paper', .0005)
    builder.box('work under-table open shelf', (4.82, -4, .37), (1.92, 3.58, .055), 'wood', .01)
    for index in range(3):
        builder.box('workbench supply case', (4.68, -5.19 + index * .79, .57), (1.23, .57, .35), 'canister', .035)
    builder.box('workshop stool seat', (3.00, -3.79, .55), (.52, .50, .063), 'wood', .035)
    for horizontal in [2.82, 3.18]:
        for forward in [-3.96, -3.62]:
            builder.rod('stool steel leg', (horizontal, forward, .01), (horizontal, forward, .52), .021, 'steel')


def chimney(builder):
    builder.rod('stove flue continuation', (-4.5, 2.2, 3.64), (-4.5, 2.2, 4.26), .10, 'rust', 64)
    builder.rod('stove flue slip joint', (-4.5, 2.2, 3.68), (-4.5, 2.2, 3.79), .112, 'steel', 64)
    builder.box('flue insulated ceiling thimble', (-4.5, 2.2, 4.062), (.64, .64, .075), 'steel', .015)
    builder.box('stove noncombustible hearth plate', (-4.5, 2.2, .011), (1.53, 1.46, .022), 'rust', .02)
    for elevation in [1.15, 2.35, 3.25]:
        builder.rod('flue wall stand-off', (-4.60, 2.20, elevation), (-6.27, 2.20, elevation), .014, 'steel', 24)


def receiver_assembly(scene, builder):
    legacy = []
    for instance in scene.objects:
        if instance.get('shelter_contact_correction') is None or instance.hide_render or instance.type != 'MESH':
            continue
        center, extent, minimum, maximum = bounds(instance)
        if 4.05 < center.x < 5.20 and -5.48 < center.y < -4.97:
            legacy.append(instance)
    if len(legacy) != 9:
        raise RuntimeError(f'Receiver hero replacement requires exactly nine original components, got {len(legacy)}')
    for instance in legacy:
        instance.hide_render = True
        instance['replaced_by'] = COLLECTION
    start = len(builder.objects)
    builder.box('receiver shock resistant shell', (0, 0, .229), (.72, .30, .42), 'steel', .032)
    builder.box('receiver recessed face gasket', (0, -.159, .229), (.685, .015, .38), 'dark', .021)
    builder.box('receiver aluminum control face', (0, -.169, .229), (.661, .015, .356), 'canister', .018)
    builder.box('receiver loudspeaker acoustic recess', (-.158, -.180, .24), (.28, .012, .266), 'dark', .017)
    for slat in range(16):
        builder.rod('receiver perforated speaker grille', (-.286, -.191, .119 + slat * .016),
                    (-.030, -.191, .119 + slat * .016), .003, 'steel', 12)
    for vertical in range(12):
        horizontal = -.279 + vertical * .022
        builder.rod('receiver speaker mesh crosswire', (horizontal, -.189, .113),
                    (horizontal, -.189, .368), .0015, 'steel', 8)
    builder.box('receiver analog dial dark bezel', (.155, -.182, .326), (.25, .023, .104), 'dark', .008)
    builder.box('receiver warm tuning scale', (.155, -.195, .326), (.226, .004, .079), 'paper', .004)
    for tick in range(23):
        builder.box('receiver engraved frequency scale', (.053 + tick * .0092, -.198, .332),
                    (.0016, .001, .026 if tick % 5 == 0 else .013), 'dark', .0001)
    builder.box('receiver tuning needle', (.186, -.199, .327), (.002, .001, .065), 'rust', .0002)
    for horizontal, radius in [(.069, .036), (.240, .052)]:
        builder.rod('receiver control collar', (horizontal, -.181, .165), (horizontal, -.19, .165), radius + .008, 'ceramic', 48)
        builder.rod('receiver knurled knob', (horizontal, -.19, .165), (horizontal, -.223, .165), radius, 'dark', 64)
        for flute in range(24):
            angle = flute * math.tau / 24
            builder.rod('receiver machined knob knurl',
                        (horizontal + math.cos(angle) * radius, -.196, .165 + math.sin(angle) * radius),
                        (horizontal + math.cos(angle) * radius, -.216, .165 + math.sin(angle) * radius), .0012, 'steel', 8)
        builder.box('receiver dial pointer', (horizontal, -.224, .165 + radius * .6), (.003, .001, .012), 'paper', .0003)
    for horizontal in (-.31, .31):
        for height in (.081, .377):
            builder.rod('receiver face countersunk screw', (horizontal, -.179, height),
                        (horizontal, -.185, height), .007, 'steel', 24)
        builder.box('receiver rubber isolation foot', (horizontal, 0, .012), (.065, .18, .024), 'dark', .007)
        builder.box('receiver carrying handle hinge', (horizontal, 0, .424), (.035, .07, .055), 'steel', .005)
    builder.seam('receiver folding leather carry handle', [(-.31, 0, .43), (-.29, 0, .49),
                 (-.22, 0, .52), (.22, 0, .52), (.29, 0, .49), (.31, 0, .43)], .023, 'dark')
    for section in range(4):
        builder.rod('receiver telescoping antenna section', (.27 + section * .015, .085, .44 + section * .15),
                    (.285 + section * .015, .085, .59 + section * .15), .0055 - section * .001, 'steel', 32)
    bpy.context.view_layer.update()
    placement = Matrix.Translation((4.55, -5.1, .9605)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
    for instance in builder.objects[start:]:
        instance.matrix_world = placement @ instance.matrix_world
    return [instance.name for instance in legacy]


def window_construction(builder):
    builder.box('deep window concrete sill', (0, 5.43, .71), (12.1, .53, .14), 'concrete', .025)
    for panel in range(10):
        horizontal = -5.44 + panel * 1.21
        builder.box('window sill stone joint', (horizontal, 5.30, .783), (.009, .37, .003), 'dark', .001)
    for side in (-1, 1):
        builder.box('shutter guide recessed seal', (side * 6.015, 5.56, 2.33), (.13, .055, 2.94), 'dark', .009)
        builder.box('shutter guide folded steel channel', (side * 6.035, 5.48, 2.33), (.095, .11, 2.94), 'steel', .008)
        for elevation in (1.0, 1.68, 2.36, 3.04, 3.67):
            builder.rod('shutter guide mounting bolt', (side * 6.035, 5.41, elevation),
                        (side * 6.035, 5.40, elevation), .012, 'steel', 32)
    builder.box('shutter overhead motor access housing', (0, 5.48, 3.88), (11.98, .25, .25), 'steel', .035)
    for horizontal in (-5.3, -2.65, 0, 2.65, 5.3):
        builder.box('motor housing access cover', (horizontal, 5.338, 3.89), (1.15, .032, .19), 'canister', .009)
        for side in (-1, 1):
            builder.rod('motor cover screw', (horizontal + side * .52, 5.32, 3.89),
                        (horizontal + side * .52, 5.312, 3.89), .006, 'dark', 24)
    points = []
    for step in range(97):
        angle = step * math.tau / 96
        points.append((5.87 + .047 * math.cos(angle), 5.385, 2.43 + .90 * math.sin(angle)))
    builder.seam('shutter continuous manual pull chain', points, .004, 'steel')
    for bead, point in enumerate(points[:-1:2]):
        builder.rod('shutter chain link', (point[0], point[1] -.005, point[2]),
                    (point[0], point[1] +.005, point[2]), .008, 'steel', 12)


def domestic_details(builder):
    for horizontal, forward, elevation in [(5.36, -4.65, .9605), (-2.21, -.17, .585)]:
        points = []
        for step in range(49):
            angle = -math.pi / 2 + step * math.pi / 48
            points.append((horizontal + .105 + math.cos(angle) * .05, forward,
                           elevation + .125 + math.sin(angle) * .075))
        builder.seam('enamel mug rolled loop handle', points, .012, 'ceramic')
    for index in range(3):
        horizontal = 3.0 + index * .85
        builder.rod('water reserve threaded neck', (horizontal + .18, -9.75, .72),
                    (horizontal + .18, -9.75, .79), .046, 'canister', 48)
        builder.rod('water reserve screw cap', (horizontal + .18, -9.75, .78),
                    (horizontal + .18, -9.75, .811), .052, 'dark', 48)
        for elevation in (.35, .48, .61):
            builder.box('water container molded reinforcement', (horizontal, -9.527, elevation), (.43, .022, .018), 'canister', .008)
    for bracket in (2.55, 5.55):
        for elevation in (.83, 1.49, 2.15):
            builder.rod('pantry diagonal shelf bracket', (bracket, -10.05, elevation - .25),
                        (bracket, -9.53, elevation - .04), .012, 'steel', 24)
    for index in range(7):
        horizontal = 3.02 + index * .23
        height = .16 + (index % 3) * .017
        builder.box('pantry stored notebook binding', (horizontal, -9.76, 2.24 + height / 2),
                    (.055 + .005 * (index % 2), .29, height), 'olive' if index % 3 else 'wood', .004)
        builder.box('pantry notebook paper edge', (horizontal, -9.60, 2.24 + height / 2), (.04, .02, height - .016), 'paper', .001)


def galley(builder):
    start = len(builder.objects)
    for horizontal in (4.69, 6.11):
        for forward in (-.09, 2.59):
            builder.box('galley floor bearing turned foot', (horizontal, forward, .072), (.10, .10, .144), 'wood', .016)
    builder.box('galley bottom carcass', (5.40, 1.25, .19), (1.51, 2.84, .11), 'wood', .013)
    for forward in (-.14, .70, 1.68, 2.64):
        builder.box('galley cabinet vertical divider', (5.40, forward, .532), (1.51, .065, .60), 'plywood', .006)
    builder.box('galley solid back panel', (6.135, 1.25, .535), (.06, 2.80, .59), 'plywood', .004)
    for forward in (.265, 2.16):
        builder.box('galley recessed cupboard door', (4.62, forward, .515), (.052, .745, .535), 'plywood', .009)
        for edge in (-1, 1):
            builder.box('galley door front inset stile', (4.582, forward + edge * .307, .515), (.032, .07, .515), 'wood', .004)
        for height in (.295, .735):
            builder.box('galley door mortised rail', (4.582, forward, height), (.032, .60, .07), 'wood', .004)
        builder.rod('galley drawer arched pull', (4.535, forward + .15, .61), (4.535, forward + .15, .74), .013, 'steel', 32)
        for height in (.61, .74):
            builder.rod('galley pull standoff', (4.535, forward + .15, height), (4.585, forward + .15, height), .01, 'steel', 24)
    for height in (.385, .645):
        builder.box('galley open crockery shelf', (5.37, 1.19, height), (1.47, .88, .042), 'wood', .007)
        for plate in range(5):
            builder.lathe('stacked enamel dinner plate', (4.93, 1.22, height + .029 + plate * .018),
                          [(.002, 0), (.14, 0), (.17, .008), (.185, .022), (.184, .027), (.169, .014), (.137, .007), (.002, .007)], 'ceramic', 64)
    builder.box('galley jointed timber worktop front', (4.85, 1.25, .872), (.56, 2.97, .075), 'wood', .014)
    builder.box('galley jointed timber worktop back', (6.02, 1.25, .872), (.33, 2.97, .075), 'wood', .014)
    for forward, length in ((.02, .50), (1.88, 1.64)):
        builder.box('galley worktop sink end', (5.49, forward, .872), (.72, length, .075), 'wood', .014)
    vertices, faces = [], []
    for level, half_width, half_length in ((.925, .365, .405), (.897, .327, .365), (.742, .278, .302), (.695, .22, .24)):
        for step in range(96):
            angle = step * math.tau / 96
            across = math.copysign(abs(math.cos(angle)) ** .46, math.cos(angle)) * half_width
            along = math.copysign(abs(math.sin(angle)) ** .46, math.sin(angle)) * half_length
            vertices.append((5.49 + across, .665 + along, level))
    for row in range(3):
        for step in range(96):
            following = (step + 1) % 96
            faces.append((row * 96 + step, row * 96 + following, (row + 1) * 96 + following, (row + 1) * 96 + step))
    faces.append(tuple(range(288, 384)))
    sink = builder.mesh('deep drawn metal wash basin', vertices, faces, 'steel')
    solidify = sink.modifiers.new('Pressed basin metal thickness', 'SOLIDIFY')
    solidify.thickness = .002
    builder.rod('sink drain rolled fitting', (5.49, .665, .696), (5.49, .665, .704), .041, 'dark', 64)
    builder.lathe('sink raised drain ring', (5.49, .665, .704), [(.026, 0), (.038, 0), (.04, .003), (.026, .003)], 'steel', 64)
    builder.rod('galley tap wall fitting', (5.97, .66, .91), (5.97, .66, 1.07), .035, 'steel', 48)
    tap = [(5.97, .66, 1.0), (5.97, .66, 1.19)]
    for step in range(49):
        angle = step / 48 * math.pi
        tap.append((5.815 + .155 * math.cos(angle), .66, 1.19 + .155 * math.sin(angle)))
    tap.append((5.66, .66, 1.13))
    builder.seam('galley curved swan neck tap', tap, .016, 'steel')
    builder.rod('galley water lever pivot', (5.97, .70, 1.035), (5.97, .75, 1.035), .017, 'steel', 40)
    builder.rod('galley water lever', (5.97, .75, 1.035), (5.97, .75, 1.145), .009, 'steel', 32)
    for height in (1.36, 1.62, 1.88):
        builder.box('galley splashback individual horizontal plank', (6.281, 1.15, height), (.05, 3.27, .245), 'wood', .012)
    builder.box('galley open overhead shelf', (6.04, 1.15, 2.20), (.49, 3.29, .065), 'wood', .01)
    for forward in (-.30, 2.58):
        builder.rod('galley shelf triangular brace', (6.25, forward, 1.91), (5.82, forward, 2.16), .012, 'steel', 24)
    for index, forward in enumerate((-.10, .38, .97, 1.66, 2.27)):
        height = (.29, .23, .32, .22, .27)[index]
        builder.lathe('glazed storage crock', (6.02, forward, 2.237),
                      [(.001, 0), (.103, 0), (.115, .025), (.123, height * .72), (.103, height),
                       (.091, height), (.109, height * .70), (.096, .017), (.001, .017)], 'ceramic')
        builder.lathe('storage crock fitted timber lid', (6.02, forward, 2.237 + height),
                      [(.001, 0), (.106, 0), (.116, .01), (.109, .022), (.042, .026), (.022, .047), (.001, .047)], 'wood', 64)
    builder.rod('galley hanging cookware rail', (6.06, -.37, 1.96), (6.06, 2.53, 1.96), .012, 'steel', 48)
    for forward, radius in ((1.46, .15), (2.18, .19)):
        pan_start = len(builder.objects)
        builder.lathe('hanging copper pan with hollow interior', (0, 0, 0),
                      [(.001, 0), (radius * .85, 0), (radius, .038), (radius, .086),
                       (radius - .005, .091), (radius - .008, .040), (radius * .84, .006), (.001, .006)], 'copper', 96)
        builder.box('pan riveted flat handle', (0, radius + .11, .014), (.033, .26, .016), 'steel', .007)
        for offset in (.01, .05):
            builder.rod('pan handle rivet', (0, radius - offset, .013), (0, radius - offset, .025), .007, 'steel', 24)
        bpy.context.view_layer.update()
        placement = Matrix.Translation((5.99, forward, 1.76 - radius)) @ Matrix.Rotation(-math.pi / 2, 4, 'Y') @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
        for instance in builder.objects[pan_start:]:
            instance.matrix_world = placement @ instance.matrix_world
        builder.seam('pan suspension hook', [(6.06, forward, 1.99), (6.09, forward, 1.96),
                     (6.01, forward, 1.94), (5.97, forward, 1.96)], .006, 'steel')
    kettle_center = (5.22, 1.83, .911)
    builder.lathe('hammered kettle rounded body', kettle_center,
                  [(.001, 0), (.128, 0), (.166, .025), (.186, .09), (.175, .185),
                   (.112, .247), (.094, .256), (.086, .25), (.108, .24), (.163, .177), (.172, .09), (.14, .019), (.001, .019)], 'copper', 128)
    builder.lathe('kettle fitted domed lid', (5.22, 1.83, 1.16),
                  [(.001, 0), (.097, 0), (.10, .009), (.079, .028), (.03, .040), (.001, .04)], 'steel', 64)
    builder.lathe('kettle insulating lid knob', (5.22, 1.83, 1.194),
                  [(.001, 0), (.018, 0), (.028, .022), (.021, .04), (.001, .043)], 'dark', 64)
    builder.seam('kettle insulated carrying bail', [(5.22 + .183 * math.cos(step * math.pi / 64),
                 1.83, 1.095 + .23 * math.sin(step * math.pi / 64)) for step in range(65)], .016, 'dark')
    spout_start = len(builder.objects)
    builder.lathe('kettle hollow pouring spout', (0, 0, 0),
                  [(.048, 0), (.042, .07), (.027, .15), (.025, .18), (.019, .18), (.021, .15), (.035, .07), (.041, 0)], 'copper', 64)
    bpy.context.view_layer.update()
    placement = Matrix.Translation((5.095, 1.83, 1.025)) @ Matrix.Rotation(-.82, 4, 'Y')
    for instance in builder.objects[spout_start:]:
        instance.matrix_world = placement @ instance.matrix_world
    builder.box('worn bread preparation board', (4.91, 2.33, .931), (.45, .40, .042), 'wood', .055)
    vertices, faces = [], []
    for row in range(81):
        along = row / 80
        horizontal = 4.57 + max(0, .47 - along) * .90
        height = .915 - max(0, along - .47) * .78
        for column in range(65):
            across = column / 64
            fold = math.sin(across * math.tau * 4 + along * 2) * .009 + math.sin(across * math.tau * 9) * .002
            vertices.append((horizontal + fold * max(0, along - .4), -.07 + across * .37,
                             height + fold * (1 - min(1, along * 2))))
    for row in range(80):
        for column in range(64):
            vertex = row * 65 + column
            faces.append((vertex, vertex + 1, vertex + 66, vertex + 65))
    builder.cloth('washed linen towel draped over counter edge', vertices, faces, 'linen_blue', .002)
    builder.seam('kitchen towel hand sewn hem', vertices[-65:], .002, 'cloth')
    builder.pendant('galley task pendant', 4.78, .82, 2.65, 160, .22)
    return {'objects': len(builder.objects) - start, 'countertop_height': .9095, 'sink_opening': True,
            'protected_central_corridor_half_width': 1.1}


def hearth_storage(builder):
    randomizer = random.Random(4821)
    for forward in (.66, 1.31):
        builder.seam('firewood rack bent steel cradle', [(-5.96, forward, .82), (-5.96, forward, .12),
                     (-5.05, forward, .12), (-5.05, forward, .82)], .018, 'steel')
    for horizontal in (-5.93, -5.08):
        builder.rod('firewood rack foot runner', (horizontal, .52, .025), (horizontal, 1.44, .025), .025, 'steel')
        builder.rod('firewood rack bearing strut', (horizontal, .66, .12), (horizontal, 1.31, .12), .018, 'steel')
    for row, count in ((0, 4), (1, 3), (2, 2)):
        for index in range(count):
            horizontal = -5.84 + row * .10 + index * .217
            elevation = .236 + row * .18
            radius = .088 + randomizer.random() * .017
            forward = .59 + randomizer.random() * .05
            length = .71 + randomizer.random() * .06
            vertices, faces = [], []
            radial = [radius * (.78 + randomizer.random() * .27) for unused in range(11)]
            for end in (forward, forward + length):
                for section in range(11):
                    angle = section * math.tau / 11
                    vertices.append((horizontal + radial[section] * math.cos(angle), end,
                                     elevation + radial[section] * math.sin(angle)))
            faces.extend((tuple(range(10, -1, -1)), tuple(range(11, 22))))
            for section in range(11):
                following = (section + 1) % 11
                faces.append((section, following, following + 11, section + 11))
            builder.mesh('irregular split seasoned firewood', vertices, faces, 'bark', False)
    builder.rod('hearth poker tool shaft', (-5.40, 2.53, .07), (-5.64, 2.53, 1.05), .009, 'rust')
    builder.seam('hearth poker curled handle', [(-5.64 + .025 * math.cos(step * math.tau / 32), 2.53,
                 1.076 + .045 * math.sin(step * math.tau / 32)) for step in range(33)], .008, 'rust')


def refine(scene, descriptor):
    if descriptor.get('scene') != 'shelter':
        return {'applied': False, 'reason': 'Not a shelter descriptor.'}
    if bpy.data.collections.get(COLLECTION):
        raise RuntimeError('Shelter refinement already exists.')
    contacts = seat_props(scene)
    organized_crates = organize_crates(scene)
    replaced = []
    for instance in list(scene.objects):
        if instance.type == 'LIGHT' and instance.data.type == 'POINT':
            if (instance.location - Vector((4.5, -3.1, 2.6))).length < .02 or (instance.location - Vector((-4.5, -6.9, 2.8))).length < .02:
                instance.hide_render = True
                replaced.append(instance.name)
    builder = Builder(scene)
    surface_refinements = existing_surface_refinement(scene, builder)
    architecture(builder)
    sleeping_nook(builder)
    lounge(builder)
    supplies_and_work(builder)
    joinery(builder)
    bed_linens(builder)
    chimney(builder)
    receiver_replacements = receiver_assembly(scene, builder)
    window_construction(builder)
    domestic_details(builder)
    galley_report = galley(builder)
    hearth_storage(builder)
    builder.area('existing desk pendant practical source', (4.5, -3.1, 2.625), (4.7, -4, .8), 185, .53)
    builder.rod('existing desk lamp luminous diffuser', (4.5, -3.1, 2.674), (4.5, -3.1, 2.664), .325, 'amber', 64)
    builder.pendant('central communal light', .35, -2.15, 3.22, 265, .31)
    builder.pendant('entry and pantry light', 1.27, -7.75, 3.18, 180, .27)
    builder.pendant('front sitting light', -2.74, 1.08, 3.26, 125, .22)
    bpy.context.view_layer.update()
    meshes = [instance for instance in builder.objects if instance.type == 'MESH']
    for instance in meshes:
        if not all(math.isfinite(value) for vertex in instance.data.vertices for value in vertex.co):
            raise RuntimeError(f'Non-finite shelter geometry: {instance.name}')
    report = {'applied': True, 'objects': len(builder.objects),
              'triangles': sum(sum(len(polygon.vertices) - 2 for polygon in instance.data.polygons) for instance in meshes),
              'practical_area_sources': sum(instance.type == 'LIGHT' for instance in builder.objects),
              'contact_corrections': contacts, 'replaced_point_lights': replaced,
              'organized_supply_crates': organized_crates,
              'original_surface_refinements': surface_refinements,
              'receiver_replacements': receiver_replacements,
              'galley': galley_report,
              'texture_sources': sorted({surface.get('shelter_texture_source') for surface in builder.materials.values() if surface.get('shelter_texture_source')}),
              'window_opening_modified': False, 'floor_dimensions_modified': False,
              'flue_top': 4.26, 'original_ceiling_bottom': 4.10}
    scene['shelter_refinement_report'] = json.dumps(report)
    print('SHELTER_REFINEMENT', json.dumps(report), flush=True)
    return report
