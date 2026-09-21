"""Deterministic close-range cockpit geometry for the offline Cycles scene.

Load this file with importlib.util.spec_from_file_location, then call
refine(bpy.context.scene, exported_descriptor) after importing its geometry,
labels and screens. The function does not render or configure the camera.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


COLLECTION_NAME = 'Frontier hero assemblies v4'
FORWARD = Vector((0, -1, 0))
TEXTURES = Path(__file__).resolve().parents[1] / 'assets' / 'life' / 'textures'


def linear_color(hexadecimal):
    number = int(hexadecimal.lstrip('#'), 16)
    channels = [(number >> shift & 255) / 255 for shift in (16, 8, 0)]
    return tuple(value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4 for value in channels)


def make_material(name, hexadecimal, roughness, metalness, grain=0, coat=0):
    material = bpy.data.materials.new('Frontier/' + name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = linear_color(hexadecimal) + (1,)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metalness
    shader.inputs['Coat Weight'].default_value = coat
    shader.inputs['Coat Roughness'].default_value = .24
    coordinates = nodes.new('ShaderNodeTexCoord')
    geometry = nodes.new('ShaderNodeNewGeometry')
    geometry.name = 'Actual surface position and curvature'
    finish_noise = nodes.new('ShaderNodeTexNoise')
    finish_noise.name = 'Subtle manufactured finish at physical 65mm scale'
    finish_noise.inputs['Scale'].default_value = 15.4
    finish_noise.inputs['Detail'].default_value = 2
    finish_noise.inputs['Roughness'].default_value = .45
    links.new(geometry.outputs['Position'], finish_noise.inputs['Vector'])
    finish = nodes.new('ShaderNodeMapRange')
    finish.name = 'Controlled manufacturing roughness tolerance'
    finish.inputs['From Min'].default_value = 0
    finish.inputs['From Max'].default_value = 1
    finish.inputs['To Min'].default_value = max(.04, roughness - .018)
    finish.inputs['To Max'].default_value = min(1, roughness + .022)
    links.new(finish_noise.outputs['Fac'], finish.inputs['Value'])
    micro_noise = nodes.new('ShaderNodeTexNoise')
    micro_noise.name = 'Multi-scale powder coat and machining micro-variation'
    micro_noise.noise_dimensions = '3D'
    micro_noise.inputs['Scale'].default_value = 178
    micro_noise.inputs['Detail'].default_value = 3.2
    micro_noise.inputs['Roughness'].default_value = .62
    links.new(geometry.outputs['Position'], micro_noise.inputs['Vector'])
    micro_range = nodes.new('ShaderNodeMapRange')
    micro_range.name = 'Sub-five-millimetre roughness variation'
    micro_range.inputs['From Min'].default_value = .24
    micro_range.inputs['From Max'].default_value = .76
    micro_range.inputs['To Min'].default_value = -.012
    micro_range.inputs['To Max'].default_value = .018
    micro_range.clamp = True
    links.new(micro_noise.outputs['Fac'], micro_range.inputs['Value'])
    micro_roughness = nodes.new('ShaderNodeMath')
    micro_roughness.name = 'Manufactured surface micro-roughness'
    micro_roughness.operation = 'ADD'
    links.new(finish.outputs['Result'], micro_roughness.inputs[0])
    links.new(micro_range.outputs['Result'], micro_roughness.inputs[1])
    links.new(micro_roughness.outputs['Value'], shader.inputs['Roughness'])
    if grain and coat:
        coating_noise = nodes.new('ShaderNodeTexNoise')
        coating_noise.name = 'Broad variation in applied ceramic coating'
        coating_noise.inputs['Scale'].default_value = 3.1
        coating_noise.inputs['Detail'].default_value = 3
        coating_noise.inputs['Roughness'].default_value = .57
        links.new(geometry.outputs['Position'], coating_noise.inputs['Vector'])
        coating_tone = nodes.new('ShaderNodeMapRange')
        coating_tone.inputs['To Min'].default_value = .975
        coating_tone.inputs['To Max'].default_value = 1.012
        links.new(coating_noise.outputs['Fac'], coating_tone.inputs['Value'])
        coating_color = nodes.new('ShaderNodeMixRGB')
        coating_color.blend_type = 'MULTIPLY'
        coating_color.inputs[0].default_value = 1
        coating_color.inputs[1].default_value = linear_color(hexadecimal) + (1,)
        links.new(coating_tone.outputs['Result'], coating_color.inputs[2])
        links.new(coating_color.outputs[0], shader.inputs['Base Color'])
        coating_roughness = nodes.new('ShaderNodeMapRange')
        coating_roughness.inputs['To Min'].default_value = -.01
        coating_roughness.inputs['To Max'].default_value = .022
        links.new(coating_noise.outputs['Fac'], coating_roughness.inputs['Value'])
        applied_roughness = nodes.new('ShaderNodeMath')
        applied_roughness.operation = 'ADD'
        links.new(micro_roughness.outputs[0], applied_roughness.inputs[0])
        links.new(coating_roughness.outputs['Result'], applied_roughness.inputs[1])
        links.new(applied_roughness.outputs[0], shader.inputs['Roughness'])
    manufactured = grain > 0 and metalness > .1
    if manufactured:
        batch = nodes.new('ShaderNodeObjectInfo')
        batch.name = 'Small component coating batch variation'
        color_variance = nodes.new('ShaderNodeMapRange')
        color_variance.inputs['To Min'].default_value = .95
        color_variance.inputs['To Max'].default_value = 1.035
        links.new(batch.outputs['Random'], color_variance.inputs['Value'])
        base_tint = nodes.new('ShaderNodeMixRGB')
        base_tint.blend_type = 'MULTIPLY'
        base_tint.inputs[0].default_value = 1
        base_tint.inputs[1].default_value = linear_color(hexadecimal) + (1,)
        links.new(color_variance.outputs['Result'], base_tint.inputs[2])
        wear = nodes.new('ShaderNodeMapRange')
        wear.name = 'Convex manufactured edge curvature only'
        wear.inputs['From Min'].default_value = .518
        wear.inputs['From Max'].default_value = .595
        wear.inputs['To Min'].default_value = 0
        wear.inputs['To Max'].default_value = 1
        wear.clamp = True
        links.new(geometry.outputs['Pointiness'], wear.inputs['Value'])
        patch = nodes.new('ShaderNodeTexNoise')
        patch.name = 'Sparse edge contact patches at physical 22mm scale'
        patch.inputs['Scale'].default_value = 46
        patch.inputs['Detail'].default_value = 2
        links.new(geometry.outputs['Position'], patch.inputs['Vector'])
        select = nodes.new('ShaderNodeMapRange')
        select.inputs['From Min'].default_value = .57
        select.inputs['From Max'].default_value = .76
        select.inputs['To Min'].default_value = 0
        select.inputs['To Max'].default_value = .12 if coat else .055
        select.clamp = True
        links.new(patch.outputs['Fac'], select.inputs['Value'])
        contact = nodes.new('ShaderNodeMath')
        contact.operation = 'MULTIPLY'
        contact.name = 'Curvature gated sparse coating burnish'
        links.new(wear.outputs['Result'], contact.inputs[0])
        links.new(select.outputs['Result'], contact.inputs[1])
        tint = nodes.new('ShaderNodeMixRGB')
        tint.name = 'Restrained exposed anodized alloy on handled edges'
        links.new(base_tint.outputs[0], tint.inputs[1])
        tint.inputs[2].default_value = linear_color('#a6aca7') + (1,)
        links.new(contact.outputs[0], tint.inputs[0])
        links.new(tint.outputs[0], shader.inputs['Base Color'])
        scratches = nodes.new('ShaderNodeMapping')
        scratches.name = 'Physical fine edge scuff dimensions 0.8mm by 35mm'
        scratches.inputs['Rotation'].default_value = (0, 0, .31)
        scratches.inputs['Scale'].default_value = (1250, 28.5, 1)
        links.new(coordinates.outputs['UV'], scratches.inputs['Vector'])
        fine = nodes.new('ShaderNodeTexNoise')
        fine.name = 'Short interrupted contact scuffs not global stripes'
        fine.noise_dimensions = '2D'
        fine.inputs['Scale'].default_value = 1
        fine.inputs['Detail'].default_value = 2
        fine.inputs['Roughness'].default_value = .6
        links.new(scratches.outputs['Vector'], fine.inputs['Vector'])
        sparse = nodes.new('ShaderNodeMapRange')
        sparse.inputs['From Min'].default_value = .64
        sparse.inputs['From Max'].default_value = .81
        sparse.inputs['To Min'].default_value = 0
        sparse.inputs['To Max'].default_value = .09
        sparse.clamp = True
        links.new(fine.outputs['Fac'], sparse.inputs['Value'])
        edge_scratches = nodes.new('ShaderNodeMath')
        edge_scratches.operation = 'MULTIPLY'
        links.new(sparse.outputs['Result'], edge_scratches.inputs[0])
        links.new(wear.outputs['Result'], edge_scratches.inputs[1])
        final_roughness = nodes.new('ShaderNodeMath')
        final_roughness.name = 'Edge scuffs affect reflected light only'
        final_roughness.operation = 'ADD'
        links.new(micro_roughness.outputs['Value'], final_roughness.inputs[0])
        links.new(edge_scratches.outputs[0], final_roughness.inputs[1])
        links.new(final_roughness.outputs[0], shader.inputs['Roughness'])
        material['manufactured_finish'] = 'Pointiness-gated edge burnishing and 0.8mm by 35mm roughness-only scuffs'
    material['microfinish_scale_metres'] = 0.0056
    if grain:
        noise = nodes.new('ShaderNodeTexNoise')
        noise.name = 'Submillimeter manufacturing microfinish in world meters'
        noise.inputs['Scale'].default_value = 320 if coat or 'anodized instrument' in name else 950
        noise.inputs['Detail'].default_value = 2
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .16
        bump.inputs['Distance'].default_value = grain * (3 if coat else 1)
        links.new(geometry.outputs['Position'], noise.inputs['Vector'])
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    if name in ('brushed aluminum', 'pressure vessel titanium'):
        shader.inputs['Anisotropic'].default_value = .42
        brushing = nodes.new('ShaderNodeVectorMath')
        brushing.operation = 'MULTIPLY'
        brushing.inputs[1].default_value = (1, 1600, 1)
        links.new(coordinates.outputs['UV'], brushing.inputs[0])
        brushed_noise = nodes.new('ShaderNodeTexNoise')
        brushed_noise.inputs['Scale'].default_value = 1
        brushed_noise.inputs['Detail'].default_value = 2
        links.new(brushing.outputs[0], brushed_noise.inputs['Vector'])
        brushed_finish = nodes.new('ShaderNodeMapRange')
        brushed_finish.inputs['To Min'].default_value = roughness - .07
        brushed_finish.inputs['To Max'].default_value = roughness + .12
        links.new(brushed_noise.outputs['Fac'], brushed_finish.inputs['Value'])
        links.new(brushed_finish.outputs['Result'], shader.inputs['Roughness'])
    return material


def glass_material():
    material = bpy.data.materials.new('Frontier/coated instrument glass')
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.97, .99, 1, 1)
    shader.inputs['Roughness'].default_value = .055
    shader.inputs['Transmission Weight'].default_value = 1
    shader.inputs['IOR'].default_value = 1.22
    return material


def woven_material(name, tint, repeat):
    material = make_material(name, tint, .85, 0)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    coordinates = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeVectorMath')
    mapping.operation = 'SCALE'
    mapping.inputs['Scale'].default_value = repeat
    links.new(coordinates.outputs['UV'], mapping.inputs[0])
    for channel, filename in [('color', 'fabric_pattern_07_col_03_1k.jpg'),
                              ('roughness', 'fabric_pattern_07_rough_1k.jpg'),
                              ('normal', 'fabric_pattern_07_nor_gl_1k.jpg')]:
        source = TEXTURES / filename
        if not source.is_file():
            raise FileNotFoundError(source)
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(source), check_existing=True)
        texture.image.colorspace_settings.name = 'sRGB' if channel == 'color' else 'Non-Color'
        links.new(mapping.outputs['Vector'], texture.inputs['Vector'])
        if channel == 'color':
            tint_node = nodes.new('ShaderNodeMixRGB')
            tint_node.blend_type = 'MULTIPLY'
            tint_node.inputs[0].default_value = .98
            tint_node.inputs[2].default_value = linear_color(tint) + (1,)
            links.new(texture.outputs['Color'], tint_node.inputs[1])
            links.new(tint_node.outputs['Color'], shader.inputs['Base Color'])
        elif channel == 'roughness':
            roughness = nodes.new('ShaderNodeMapRange')
            roughness.inputs['To Min'].default_value = .70
            roughness.inputs['To Max'].default_value = .94
            links.new(texture.outputs['Color'], roughness.inputs['Value'])
            links.new(roughness.outputs['Result'], shader.inputs['Roughness'])
        else:
            normal = nodes.new('ShaderNodeNormalMap')
            normal.inputs['Strength'].default_value = .55
            links.new(texture.outputs['Color'], normal.inputs['Color'])
            links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    shader.inputs['Sheen Weight'].default_value = .3
    shader.inputs['Sheen Roughness'].default_value = .72
    material['public_texture_source'] = 'Poly Haven fabric_pattern_07 / CC0'
    if name == 'quilted thermal acoustic lining':
        geometry = nodes.new('ShaderNodeNewGeometry')
        fold_mapping = nodes.new('ShaderNodeVectorMath')
        fold_mapping.operation = 'MULTIPLY'
        fold_mapping.inputs[1].default_value = (19, 3, 11)
        links.new(geometry.outputs['Position'], fold_mapping.inputs[0])
        fold_noise = nodes.new('ShaderNodeTexNoise')
        fold_noise.inputs['Scale'].default_value = 1
        fold_noise.inputs['Detail'].default_value = 2.6
        links.new(fold_mapping.outputs[0], fold_noise.inputs['Vector'])
        creases = nodes.new('ShaderNodeBump')
        creases.name = 'Millimetre fabric creases between quilt seams'
        creases.inputs['Strength'].default_value = .27
        creases.inputs['Distance'].default_value = .0018
        links.new(fold_noise.outputs['Fac'], creases.inputs['Height'])
        links.new(normal.outputs['Normal'], creases.inputs['Normal'])
        links.new(creases.outputs['Normal'], shader.inputs['Normal'])
    return material


def physical_uv(instance):
    layer = instance.data.uv_layers.active or instance.data.uv_layers.new(name='UVMap')
    for polygon in instance.data.polygons:
        dominant = max(range(3), key=lambda axis: abs(polygon.normal[axis]))
        axes = (1, 2) if dominant == 0 else (0, 2) if dominant == 1 else (0, 1)
        for loop_index in polygon.loop_indices:
            point = instance.matrix_world @ instance.data.vertices[instance.data.loops[loop_index].vertex_index].co
            layer.data[loop_index].uv = (point[axes[0]], point[axes[1]])


class Assemblies:
    def __init__(self, scene):
        self.scene = scene
        self.collection = bpy.data.collections.new(COLLECTION_NAME)
        scene.collection.children.link(self.collection)
        self.objects = []
        self.materials = {
            'ivory': make_material('ceramic powder coat', '#d5d2c5', .38, .02, .000035, .10),
            'green': make_material('anodized instrument blue gray', '#394748', .34, .55, .000022),
            'aluminum': make_material('brushed aluminum', '#b2b9bc', .28, .88, .000018),
            'titanium': make_material('pressure vessel titanium', '#8b979c', .31, .91, .000012),
            'paper': make_material('ivory gauge printing', '#dfddd1', .67, 0),
            'dark_ink': make_material('graphite gauge printing', '#182327', .71, 0),
            'rubber': make_material('neoprene seals', '#17221f', .84, 0, .00003),
            'cable': make_material('braided cable jacket', '#37453e', .73, .04, .00007),
            'orange': make_material('safety orange enamel', '#bc6635', .44, .12, .000035),
            'ink': make_material('warm-gray typography', '#bac4ad', .74, 0),
            'glass': glass_material(),
            'fabric': woven_material('woven slate flight upholstery', '#66717a', 27),
            'harness': woven_material('seat restraint webbing', '#8d9078', 22),
            'thermal': woven_material('quilted thermal acoustic lining', '#cfcec2', 24),
            'stitch': make_material('aramid upholstery thread', '#a4a38c', .91, 0),
            'diffuser': make_material('warm ivory light diffuser', '#e1ddc0', .51, 0),
            'amber': make_material('amber status lens', '#e5b464', .3, 0),
            'cyan': make_material('blue white status lens', '#acd4de', .27, 0),
        }
        diffuser = self.materials['diffuser'].node_tree.nodes.get('Principled BSDF')
        diffuser.inputs['Emission Color'].default_value = linear_color('#ffe3b4') + (1,)
        diffuser.inputs['Emission Strength'].default_value = 1.35
        for material, color in [('amber', '#e5b464'), ('cyan', '#acd4de')]:
            shader = self.materials[material].node_tree.nodes.get('Principled BSDF')
            shader.inputs['Emission Color'].default_value = linear_color(color) + (1,)
            shader.inputs['Emission Strength'].default_value = .5

    def register(self, instance, role):
        for collection in list(instance.users_collection):
            collection.objects.unlink(instance)
        self.collection.objects.link(instance)
        instance['hero_role'] = role
        instance['modeling_version'] = 4
        self.objects.append(instance)
        return instance

    def mesh(self, name, vertices, faces, material, smooth=False):
        geometry = bpy.data.meshes.new('Frontier/' + name)
        geometry.from_pydata(vertices, [], faces)
        geometry.update()
        geometry.materials.append(self.materials[material])
        for polygon in geometry.polygons:
            polygon.use_smooth = smooth
        instance = bpy.data.objects.new('Frontier/' + name, geometry)
        self.collection.objects.link(instance)
        instance['hero_role'] = name
        instance['modeling_version'] = 4
        self.objects.append(instance)
        return instance

    def bevel_box(self, name, center, dimensions, material, radius=.003, segments=5):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        instance = self.register(bpy.context.object, name)
        instance.name = 'Frontier/' + name
        instance.dimensions = dimensions
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        instance.data.materials.append(self.materials[material])
        modifier = instance.modifiers.new('Manufactured corner radius', 'BEVEL')
        modifier.width = min(radius, min(dimensions) * .35)
        modifier.segments = segments
        modifier.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        for polygon in instance.data.polygons:
            polygon.use_smooth = True
        normal = instance.modifiers.new('Flat faces and round edge normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=normal.name)
        return instance

    def cylinder(self, name, start, end, radius, material, vertices=48):
        start, end = Vector(start), Vector(end)
        direction = end - start
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length,
                                           location=(start + end) * .5)
        instance = self.register(bpy.context.object, name)
        instance.name = 'Frontier/' + name
        instance.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
        instance.data.materials.append(self.materials[material])
        for polygon in instance.data.polygons:
            polygon.use_smooth = len(polygon.vertices) == 4
        return instance

    def tube(self, name, coordinates, radius, material, resolution=8):
        geometry = bpy.data.curves.new('Frontier/' + name, 'CURVE')
        geometry.dimensions = '3D'
        geometry.resolution_u = resolution
        geometry.bevel_depth = radius
        geometry.bevel_resolution = 5
        geometry.resolution_u = 16
        geometry.use_fill_caps = True
        spline = geometry.splines.new('BEZIER')
        spline.bezier_points.add(len(coordinates) - 1)
        for control, position in zip(spline.bezier_points, coordinates):
            control.co = position
            control.handle_left_type = 'AUTO'
            control.handle_right_type = 'AUTO'
        instance = bpy.data.objects.new('Frontier/' + name, geometry)
        self.collection.objects.link(instance)
        instance.data.materials.append(self.materials[material])
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = instance
        instance.select_set(True)
        bpy.ops.object.convert(target='MESH')
        instance = bpy.context.view_layer.objects.active
        for polygon in instance.data.polygons:
            polygon.use_smooth = True
        instance['hero_role'] = name
        self.objects.append(instance)
        instance.select_set(False)
        return instance

    def text(self, name, body, position, size, material='ink'):
        curve = bpy.data.curves.new('Frontier/' + name, 'FONT')
        curve.body = body
        curve.size = size
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.resolution_u = 8
        curve.extrude = .00045
        curve.bevel_depth = .00012
        curve.bevel_resolution = 3
        instance = bpy.data.objects.new('Frontier/' + name, curve)
        self.collection.objects.link(instance)
        instance.location = position
        instance.rotation_euler = (math.pi / 2, 0, 0)
        instance.data.materials.append(self.materials[material])
        instance['hero_role'] = name
        self.objects.append(instance)
        return instance

    def ring(self, name, center, width, height, aperture_width, aperture_height, depth, material):
        horizontal, forward, vertical = center
        sections = [
            (width - .006, height - .006, -.5 * depth),
            (width, height, -.5 * depth + .004),
            (width, height, .5 * depth - .004),
            (width - .006, height - .006, .5 * depth),
            (aperture_width + .006, aperture_height + .006, .5 * depth),
            (aperture_width, aperture_height, .5 * depth - .003),
            (aperture_width, aperture_height, -.5 * depth + .003),
            (aperture_width + .006, aperture_height + .006, -.5 * depth),
        ]
        vertices = []
        for section_width, section_height, offset in sections:
            radius = min(.023, section_height * .1)
            for corner in range(4):
                center_horizontal = (section_width / 2 - radius) * (1 if corner in [0, 3] else -1)
                center_vertical = (section_height / 2 - radius) * (1 if corner in [0, 1] else -1)
                for step in range(17):
                    angle = corner * math.pi / 2 + step * math.pi / 32
                    vertices.append((horizontal + center_horizontal + radius * math.cos(angle),
                                     forward + offset,
                                     vertical + center_vertical + radius * math.sin(angle)))
        points = 68
        faces = []
        for section in range(len(sections)):
            following = (section + 1) % len(sections)
            for point in range(points):
                next_point = (point + 1) % points
                faces.append((section * points + point, following * points + point,
                              following * points + next_point, section * points + next_point))
        instance = self.mesh(name, vertices, faces, material, True)
        return instance

    def fastener(self, name, center, radius=.0055):
        horizontal, forward, vertical = center
        self.cylinder(name + ' captive head', (horizontal, forward, vertical),
                      (horizontal, forward - .0025, vertical), radius, 'aluminum', 32)
        self.cylinder(name + ' dark socket', (horizontal, forward - .0026, vertical),
                      (horizontal, forward - .0028, vertical), radius * .43, 'rubber', 6)

    def area_light(self, name, center, direction, width, height, power, tint='#ffe5c0'):
        light = bpy.data.lights.new('Frontier/' + name, 'AREA')
        light.shape = 'RECTANGLE'
        light.size = width
        light.size_y = height
        light.energy = power
        light.color = linear_color(tint)
        instance = bpy.data.objects.new('Frontier/' + name, light)
        self.collection.objects.link(instance)
        instance.location = center
        instance.rotation_euler = Vector(direction).to_track_quat('-Z', 'Y').to_euler()
        instance['hero_role'] = name
        self.objects.append(instance)
        return instance

    def cushion(self, name, center, dimensions, material, lumbar=0):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=40, radius=1, location=center)
        instance = self.register(bpy.context.object, name)
        instance.name = 'Frontier/' + name
        for vertex in instance.data.vertices:
            source = vertex.co.copy()
            softened = [math.copysign(abs(value) ** .4, value) for value in source]
            horizontal = softened[0] * dimensions[0] * .5
            forward = softened[1] * dimensions[1] * .5
            vertical = softened[2] * dimensions[2] * .5
            forward += lumbar * math.exp(-((softened[2] + .4) * 2) ** 2) * max(0, softened[1])
            vertex.co = (horizontal, forward, vertical)
        instance.data.materials.append(self.materials[material])
        for polygon in instance.data.polygons:
            polygon.use_smooth = True
        return instance

    def webbing(self, name, points, width):
        vertices = []
        controls = [Vector(point) for point in points]
        samples = []
        for segment in range(len(controls) - 1):
            previous = controls[max(0, segment - 1)]
            start = controls[segment]
            end = controls[segment + 1]
            following = controls[min(len(controls) - 1, segment + 2)]
            for step in range(16):
                progress = step / 16
                samples.append((2 * start + (end - previous) * progress
                                + (2 * previous - 5 * start + 4 * end - following) * progress ** 2
                                + (3 * start - previous - 3 * end + following) * progress ** 3) * .5)
        samples.append(controls[-1])
        for point in samples:
            vertices.extend([(point.x - width / 2, point.y, point.z),
                             (point.x + width / 2, point.y, point.z),
                             (point.x + width / 2, point.y - .0025, point.z),
                             (point.x - width / 2, point.y - .0025, point.z)])
        faces = []
        for segment in range(len(samples) - 1):
            for edge in range(4):
                following = (edge + 1) % 4
                faces.append((segment * 4 + edge, segment * 4 + following,
                              (segment + 1) * 4 + following, (segment + 1) * 4 + edge))
        faces.extend([(3, 2, 1, 0), tuple((len(samples) - 1) * 4 + edge for edge in range(4))])
        return self.mesh(name, vertices, faces, 'harness', True)


def world_bounds(instance):
    corners = [instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
    minimum = Vector(tuple(min(corner[axis] for corner in corners) for axis in range(3)))
    maximum = Vector(tuple(max(corner[axis] for corner in corners) for axis in range(3)))
    return (minimum + maximum) * .5, maximum - minimum


def move_side_displays(scene, descriptor):
    basis = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    reports = []
    for display in descriptor.get('screens', []):
        values = display['matrix']
        if not (2.3 < abs(values[12]) < 3 and 10 < -values[14] < 11 and 1.5 < values[13] < 2):
            continue
        original = Matrix(tuple(tuple(values[column * 4 + row] for column in range(4)) for row in range(4)))
        placement = basis @ original @ basis.inverted()
        inverse = placement.inverted()
        side = 1 if values[12] > 0 else -1
        offset = Vector((-side * .20, 0, 0))
        moved = []
        roles = {'frame': 0, 'text': 0, 'fill': 0, 'trace': 0}
        for instance in scene.objects:
            if instance.hide_render or instance.type not in ['MESH', 'FONT', 'CURVE']:
                continue
            if instance.name.startswith('NightWorld/mesh'):
                role = 'frame'
            elif instance.name.startswith('NightWorld/instrument text'):
                role = 'text'
            elif instance.name.startswith('NightWorld/screen fill'):
                role = 'fill'
            elif instance.name.startswith('NightWorld/screen trace'):
                role = 'trace'
            else:
                continue
            corners = [inverse @ instance.matrix_world @ Vector(corner) for corner in instance.bound_box]
            minimum = Vector(tuple(min(corner[axis] for corner in corners) for axis in range(3)))
            maximum = Vector(tuple(max(corner[axis] for corner in corners) for axis in range(3)))
            if minimum.x < -display['width'] / 2 - .08 or maximum.x > display['width'] / 2 + .08:
                continue
            if minimum.z < -display['height'] / 2 - .08 or maximum.z > display['height'] / 2 + .08:
                continue
            if minimum.y < -.06 or maximum.y > .13:
                continue
            instance.matrix_world.translation += offset
            instance['hero_side_display_translation'] = list(offset)
            moved.append(instance.name)
            roles[role] += 1
        if any(count == 0 for count in roles.values()):
            raise RuntimeError(f'Side display {side} translation did not capture every component category: {roles}')
        reports.append({'side': side, 'translation': list(offset), 'objects': moved, 'categories': roles})
    if len(reports) != 2:
        raise RuntimeError(f'Expected two complete side-display assemblies, found {len(reports)}.')
    bpy.context.view_layer.update()
    return reports


def front_displays(descriptor):
    displays = []
    for entry in descriptor.get('screens', []):
        matrix = entry['matrix']
        position = Vector((matrix[12], -matrix[14], matrix[13]))
        if 11.85 < position.y < 12.0 and .8 < position.z < 1.2 and abs(position.x) < 2:
            displays.append({'entry': entry, 'position': position, 'width': entry['width'], 'height': entry['height']})
    if len(displays) != 3:
        raise RuntimeError(f'Cockpit refinement expected three exported forward displays; found {len(displays)}.')
    return sorted(displays, key=lambda display: display['position'].x)


def old_display_frames(scene, displays):
    replacements = []
    for display in displays:
        target = display['position'] + Vector((0, .041, 0))
        dimensions = Vector((display['width'] + .085, .075, display['height'] + .085))
        matches = []
        for instance in scene.objects:
            if instance.type != 'MESH' or not instance.name.startswith('NightWorld/mesh') or instance.hide_render:
                continue
            center, extent = world_bounds(instance)
            if (center - target).length < .004 and (extent - dimensions).length < .008:
                matches.append(instance)
        if len(matches) != 1:
            raise RuntimeError(f'Expected one legacy bezel by exact position/dimensions at {tuple(target)}; found {len(matches)}.')
        replacements.append(matches[0])
    for horizontal, width in [(-1.48, 1.25), (0, 1.52), (1.48, 1.25)]:
        target = Vector((horizontal, 11.91, 1.36))
        matches = []
        for instance in scene.objects:
            if instance.type != 'MESH' or not instance.name.startswith('NightWorld/mesh') or instance.hide_render:
                continue
            center, extent = world_bounds(instance)
            if (center - target).length < .004 and abs(extent.x - width) < .006 and .265 < extent.y < .275 and .055 < extent.z < .07:
                matches.append(instance)
        if len(matches) != 1:
            raise RuntimeError(f'Expected one legacy glare hood at {tuple(target)}; found {len(matches)}.')
        replacements.append(matches[0])
    return replacements


def structural_replacements(scene):
    specifications = []
    for side in [-1, 1]:
        specifications.extend([
            (f'lower sidewall {side}', (side * 2.87, 10.04, 1.23), (.21, 6.24, 2.46)),
            (f'upper sidewall {side}', (side * 2.86, 9.36, 2.92), (.22, 4.86, 1.46)),
            (f'large system rack {side}', (side * 2.2, 8.18, 1.08), (.94, 1.13, 1.52)),
            (f'side low shelf {side}', (side * 2.55, 9.55, .54), (.3, 5.1, .11)),
        ])
        for station in range(5):
            forward = 11.6 - station * 1.12
            specifications.append((f'side upright {side} {station}', (side * 2.72, forward, 1.53), (.11, .09, 2.85)))
        for drawer in range(3):
            specifications.append((f'old drawer {side} {drawer}',
                                   (side * 2.2, 7.597, .58 + drawer * .42), (.77, .035, .34)))
            specifications.append((f'old drawer handle {side} {drawer}',
                                   (side * 2.2, 7.558, .57 + drawer * .42), (.23, .048, .022)))
    specifications.extend([
        ('inner cockpit roof', (0, 9.35, 4.28), (5.52, 5.9, .23)),
        ('outer cockpit roof', (0, 9.4, 4.49), (6.35, 6.05, .2)),
        ('continuous proxy flight console', (0, 11.75, .62), (7, 1.35, .35)),
    ])
    candidates = [(instance, *world_bounds(instance)) for instance in scene.objects
                  if instance.type == 'MESH' and instance.name.startswith('NightWorld/mesh') and not instance.hide_render]
    replacements = []
    for name, center, extent in specifications:
        matches = [instance for instance, actual_center, actual_extent in candidates
                   if (actual_center - Vector(center)).length < .004 and (actual_extent - Vector(extent)).length < .009]
        if len(matches) != 1:
            raise RuntimeError(f'Structural replacement {name} expected one position-and-size match, found {len(matches)}.')
        replacements.append(matches[0])
    for instance, center, extent in candidates:
        if instance in replacements:
            continue
        if 2.60 < abs(center.x) < 2.73 and 7.08 < center.y < 11.7 and max(extent) < .052:
            replacements.append(instance)
        if abs(abs(center.x) - 2.2) < .42 and 7.55 < center.y < 7.61 and .37 < center.z < 1.62 and max(extent) < .06:
            replacements.append(instance)
        if abs(abs(center.x) - 2.73) < .01 and abs(center.y - 9.39) < .01 and abs(center.z - 3.9) < .01:
            replacements.append(instance)
        if abs(abs(center.x) - 2.8) < .01 and abs(center.y - 9.75) < .01 and abs(center.z - 3.76) < .01:
            replacements.append(instance)
        if abs(abs(center.x) - 2.13) < .01 and 10.4 < center.y < 10.5 and 1.1 < center.z < 1.3 and max(extent) < 1:
            replacements.append(instance)
        if abs(center.x) < .38 and 9.1 < center.y < 9.96 and .39 < center.z < 1.85 and extent.x > .35:
            replacements.append(instance)
        if .17 < abs(center.x) < .37 and 9.28 < center.y < 9.65 and .64 < center.z < 1.52 and max(extent) < .95:
            replacements.append(instance)
    for instance in scene.objects:
        if instance.type != 'LIGHT' or instance.data.type != 'POINT':
            continue
        if (instance.location - Vector((0, 8.1, 3.58))).length < .03 or (instance.location - Vector((0, 10, 3.8))).length < .01 or abs(abs(instance.location.x) - 2.38) < .03 and abs(instance.location.y - 10.42) < .03:
            replacements.append(instance)
    return list(dict.fromkeys(replacements))


def legacy_console_controls(scene):
    specifications = []
    for horizontal in (-1.48, 0, 1.48):
        specifications.append(((horizontal, 11.5, .807), (1.18 if horizontal else 1.42, .42, .035)))
        for control in range(5):
            position = horizontal - .58 + control * .28
            specifications.append(((position, 11.49, .85), (.104, .104, .075)))
            specifications.append(((position, 11.472, .892), (.008, .025, .006)))
            for depth in (-.11, .11):
                specifications.append(((horizontal - .75 + control * .34, 11.5 - depth, .832), (.018, .018, .018)))
    candidates = [(instance, *world_bounds(instance)) for instance in scene.objects
                  if instance.type == 'MESH' and instance.name.startswith('NightWorld/mesh') and not instance.hide_render]
    matched = []
    for center, dimensions in specifications:
        matches = [instance for instance, actual_center, actual_dimensions in candidates
                   if (actual_center - Vector(center)).length < .003 and (actual_dimensions - Vector(dimensions)).length < .004]
        if len(matches) != 1:
            raise RuntimeError(f'Original console control at {center} expected one mesh, found {len(matches)}')
        matched.append(matches[0])
    if len(set(matched)) != 63:
        raise RuntimeError('Original console replacement must contain 63 unique components')
    return matched


def pressure_shell(builder):
    cross_section = []
    for step in range(17):
        ratio = step / 16
        cross_section.append((-2.60 - math.sin(ratio * math.pi / 2) * .21, .10 + ratio * 2.4))
    for step in range(1, 25):
        angle = step * math.pi / 48
        cross_section.append((-1.56 - 1.25 * math.cos(angle), 2.50 + 1.32 * math.sin(angle)))
    for step in range(1, 17):
        horizontal = -1.56 + step * 3.12 / 16
        cross_section.append((horizontal, 3.82 + .08 * (1 - (horizontal / 1.56) ** 2)))
    for step in range(1, 25):
        angle = math.pi / 2 - step * math.pi / 48
        cross_section.append((1.56 + 1.25 * math.cos(angle), 2.50 + 1.32 * math.sin(angle)))
    for step in range(1, 17):
        ratio = 1 - step / 16
        cross_section.append((2.60 + math.sin(ratio * math.pi / 2) * .21, .10 + ratio * 2.4))
    intervals = [(6.9 + index * 1.07 + .011, 6.9 + (index + 1) * 1.07 - .011) for index in range(5)]
    coating_batches = [('#d5d2c5', .38), ('#cfcec4', .405), ('#d9d4c8', .395),
                       ('#ced1ca', .37), ('#d7d2c6', .41)]
    for bay, (tint, roughness) in enumerate(coating_batches):
        builder.materials[f'pressure_coat_{bay}'] = make_material(
            f'pressure shell ceramic powder coat batch {bay}', tint, roughness, .02, .000035, .10)
        roof_coat = make_material(f'roof cassette matte powder coat batch {bay}', tint,
                                 roughness + .13, .045, .000065, .025)
        roof_shader = roof_coat.node_tree.nodes.get('Principled BSDF')
        roof_shader.inputs['Coat Roughness'].default_value = .55
        roof_shader.inputs['Specular IOR Level'].default_value = .26
        roof_coat['finish_scope'] = 'Roof cassettes only; low-gloss mineral powder coat'
        builder.materials[f'roof_coat_{bay}'] = roof_coat
    for bay, (start, end) in enumerate(intervals):
        vertices = [(horizontal, depth, vertical) for depth in [start, end] for horizontal, vertical in cross_section]
        count = len(cross_section)
        faces = [(index, index + count, index + count + 1, index + 1) for index in range(count - 1)]
        panel = builder.mesh(f'pressure shell bay {bay}', vertices, faces, f'pressure_coat_{bay}', True)
        bpy.ops.object.select_all(action='DESELECT')
        panel.select_set(True)
        bpy.context.view_layer.objects.active = panel
        thickness = panel.modifiers.new('Pressure shell panel thickness', 'SOLIDIFY')
        thickness.thickness = .045
        thickness.offset = 1
        bpy.ops.object.modifier_apply(modifier=thickness.name)
        panel.select_set(False)
    for seam in range(6):
        center = 6.9 + seam * 1.07
        count = len(cross_section)
        vertices = [(horizontal * 1.005, center + offset, vertical + .012)
                    for offset in (-.070, .070) for horizontal, vertical in cross_section]
        faces = [(index, index + count, index + count + 1, index + 1) for index in range(count - 1)]
        seal = builder.mesh(f'continuous pressure shell joint backing {seam}', vertices, faces, 'rubber', True)
        modifier = seal.modifiers.new('Opaque overlapping pressure joint', 'SOLIDIFY')
        modifier.thickness = .025
        modifier.offset = 1
    for station in [6.92, 9.04, 11.18]:
        rib = [(horizontal * .992, station, vertical - .026) for horizontal, vertical in cross_section[::4]]
        builder.tube(f'continuous curved pressure rib {station}', rib, .045, 'green')
    for side in [-1, 1]:
        for index in range(5):
            forward = 7.43 + index * 1.07
            builder.bevel_box(f'roof maintainable cassette {side} {index}', (side * .71, forward, 3.758),
                              (1.28, 1.01, .036), f'roof_coat_{(index + (1 if side > 0 else 0)) % 5}', .005, 4)
        builder.bevel_box(f'overhead recessed light channel {side}', (side * 1.63, 9.24, 3.58),
                          (.24, 4.77, .10), 'green', .025, 6)
        builder.bevel_box(f'overhead opal light guide {side}', (side * 1.63, 9.24, 3.522),
                          (.122, 4.54, .012), 'diffuser', .004)
        for separator in range(4):
            builder.bevel_box(f'light guide joint {side} {separator}', (side * 1.63, 7.94 + separator * .89, 3.509),
                              (.144, .026, .014), 'green', .003)
        builder.area_light(f'continuous task light {side}', (side * 1.62, 9.27, 3.493),
                           (-side * .26, 0, -1), .10, 4.4, 132, '#f4f3e9')
        builder.tube(f'upper forward pressure transition {side}',
                     [(side * 2.80, 11.23, 2.56), (side * 2.53, 11.57, 3.25),
                      (side * 1.85, 12.04, 3.67)], .045, 'green')


def roof_cassette_supports(builder):
    bpy.context.view_layer.update()
    shells = [instance for instance in builder.objects
              if instance.get('hero_role', '').startswith('pressure shell bay ')]
    cassettes = [instance for instance in builder.objects
                 if instance.get('hero_role', '').startswith('roof maintainable cassette ')]
    if len(shells) != 5 or len(cassettes) != 10:
        raise RuntimeError('Expected five pressure shell bays and ten service cassettes')
    graph = bpy.context.evaluated_depsgraph_get()

    def surface(instance):
        evaluated = instance.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        vertices = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
        polygons = [tuple(polygon.vertices) for polygon in mesh.polygons]
        tree = BVHTree.FromPolygons(vertices, polygons)
        evaluated.to_mesh_clear()
        return tree

    shell_surfaces = {instance: surface(instance) for instance in shells}
    contacts = []
    lengths = []
    for cassette in cassettes:
        bounds = [cassette.matrix_world @ vertex.co for vertex in cassette.data.vertices]
        top = max(point.z for point in bounds)
        center = cassette.matrix_world.translation
        for across in (-.50, .50):
            for along in (-.35, .35):
                origin = Vector((center.x + across, center.y + along, top + .001))
                hits = [(tree.ray_cast(origin, Vector((0, 0, 1)), .25)[0], shell)
                        for shell, tree in shell_surfaces.items()]
                hits = [(point, shell) for point, shell in hits if point is not None]
                if not hits:
                    raise RuntimeError(f'Roof cassette support has no overhead shell: {cassette.name}')
                point, shell = min(hits, key=lambda item: item[0].z)
                lower, upper = top - .004, point.z + .008
                support = builder.bevel_box(f'{cassette["hero_role"]} shell mounting block {across} {along}',
                                            (origin.x, origin.y, (lower + upper) / 2),
                                            (.032, .046, upper - lower), 'aluminum', .002)
                contacts.extend(((support, cassette), (support, shell)))
                lengths.append(upper - lower)
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    trees = {instance: surface(instance) for pair in contacts for instance in pair}
    for first, last in contacts:
        if not trees[first].overlap(trees[last]):
            raise RuntimeError(f'Roof support lacks actual mesh contact: {first.name}, {last.name}')
    return {'cassettes': len(cassettes), 'mounting_blocks': len(lengths),
            'verified_contact_pairs': len(contacts), 'minimum_block_height_m': min(lengths),
            'maximum_block_height_m': max(lengths)}


def flight_console_structure(builder):
    def casting(name, outline, bottom, top, material, inset=0, depth_inset=None):
        center_horizontal = sum(point[0] for point in outline) / len(outline)
        center_forward = sum(point[1] for point in outline) / len(outline)
        forward_inset = inset if depth_inset is None else depth_inset
        vertices = [(horizontal + (center_horizontal - horizontal) * inset,
                     forward + (center_forward - forward) * forward_inset, bottom)
                    for horizontal, forward in outline]
        vertices.extend((horizontal, forward, top) for horizontal, forward in outline)
        count = len(outline)
        faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
        faces.extend((index, (index + 1) % count, (index + 1) % count + count, index + count)
                     for index in range(count))
        instance = builder.mesh(name, vertices, faces, material)
        bpy.context.view_layer.objects.active = instance
        modifier = instance.modifiers.new('Cast console edge radii', 'BEVEL')
        modifier.width = .012
        modifier.segments = 5
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        for polygon in instance.data.polygons:
            polygon.use_smooth = True
        modifier = instance.modifiers.new('Machined console face normals', 'WEIGHTED_NORMAL')
        modifier.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        return instance

    outline = [(-2.64, 11.45), (-2.14, 11.10), (-.83, 11.045), (.83, 11.045),
               (2.14, 11.10), (2.64, 11.45), (2.64, 11.735), (-2.64, 11.735)]
    casting('flight console front control deck casting', outline, .57, .817, 'green', .055)
    rear_outline = [(-2.64, 12.025), (2.64, 12.025), (2.64, 12.37), (-2.64, 12.37)]
    casting('flight console rear display bearing casting', rear_outline, .57, .805, 'green', .025)
    for side in (-1, 1):
        pedestal = [(side * 1.26, 11.46), (side * 2.19, 11.46),
                    (side * 2.35, 12.24), (side * 1.26, 12.24)]
        if side < 0:
            pedestal.reverse()
        casting(f'flight console tapered equipment pedestal {side}', pedestal,
                .014, .58, 'ivory', .16, 0)
        builder.bevel_box(f'flight console pedestal rubber toe {side}',
                          (side * 1.75, 11.87, .0405), (.68, .66, .053), 'rubber', .01)
        builder.bevel_box(f'flight console service fascia gasket {side}',
                          (side * 1.72, 11.457, .306), (.69, .018, .376), 'rubber', .008)
        builder.bevel_box(f'flight console service fascia {side}',
                          (side * 1.72, 11.444, .306), (.66, .012, .347), 'green', .005)
        builder.text(f'flight console pedestal function {side}',
                     'POWER CONDITIONING' if side < 0 else 'FLIGHT PROCESSOR',
                     (side * 1.72, 11.436, .419), .023)
        for horizontal in (-.284, .284):
            for elevation in (.17, .44):
                builder.fastener(f'flight console fascia lock {side} {horizontal} {elevation}',
                                 (side * 1.72 + horizontal, 11.435, elevation), .006)
        builder.tube(f'flight console rounded pilot edge {side}',
                     [(side * .84, 11.045, .775), (side * 2.12, 11.10, .775),
                      (side * 2.63, 11.45, .775), (side * 2.64, 12.32, .775)], .019, 'rubber')
        for elevation in (.24, .277, .314):
            builder.bevel_box(f'flight console fascia recessed vent {side} {elevation}',
                              (side * 1.72, 11.436, elevation), (.46, .006, .011), 'rubber', .001)
    builder.bevel_box('flight console underdeck crossbeam', (0, 12.18, .43),
                      (4.42, .16, .22), 'aluminum', .024)
    builder.bevel_box('flight console central knee impact pad', (0, 11.061, .686),
                      (1.59, .052, .168), 'rubber', .018)
    pedals = pedal_assemblies(builder)
    return {'structural_width_metres': 5.28, 'front_control_deck_height_metres': .817,
            'rear_display_bearing_height_metres': .805,
            'tapered_pedestals': 2, 'clear_knee_width_metres': 2.52,
            'display_recess_depth_interval_metres': [11.735, 12.025],
            'pedestal_deck_contact_metres': .014,
            'pedal_assemblies': pedals,
            'original_display_positions_preserved': True}


def pedal_assemblies(builder):
    builder.materials['pedal_body'] = make_material('pedal load-bearing anodized alloy', '#656e68', .51, .58, .000035)
    builder.materials['pedal_grip'] = make_material('pedal dark abrasive coating', '#454c46', .81, .12, .00012)
    builder.materials['pedal_rib'] = make_material('pedal worn traction ridges', '#717970', .56, .57, .000045)
    surface = builder.materials['pedal_grip']
    nodes, links = surface.node_tree.nodes, surface.node_tree.links
    shader = nodes.get('Principled BSDF')
    original_color = shader.inputs['Base Color'].links[0].from_socket
    original_roughness = shader.inputs['Roughness'].links[0].from_socket
    coordinates = nodes.new('ShaderNodeTexCoord')
    centered = nodes.new('ShaderNodeVectorMath')
    centered.operation = 'SUBTRACT'
    centered.inputs[1].default_value = (.5, .59, 0)
    links.new(coordinates.outputs['Generated'], centered.inputs[0])
    footprint = nodes.new('ShaderNodeVectorMath')
    footprint.operation = 'MULTIPLY'
    footprint.inputs[1].default_value = (3.1, 2.0, 0)
    links.new(centered.outputs[0], footprint.inputs[0])
    radius = nodes.new('ShaderNodeVectorMath')
    radius.operation = 'LENGTH'
    links.new(footprint.outputs[0], radius.inputs[0])
    wear = nodes.new('ShaderNodeMapRange')
    wear.inputs['From Min'].default_value = .12
    wear.inputs['From Max'].default_value = .68
    wear.inputs['To Min'].default_value = .27
    wear.inputs['To Max'].default_value = 0
    wear.clamp = True
    links.new(radius.outputs['Value'], wear.inputs[0])
    burnish = nodes.new('ShaderNodeMixRGB')
    links.new(wear.outputs[0], burnish.inputs[0])
    links.new(original_color, burnish.inputs[1])
    burnish.inputs[2].default_value = linear_color('#7c847b') + (1,)
    links.new(burnish.outputs[0], shader.inputs['Base Color'])
    rubbed_roughness = nodes.new('ShaderNodeMath')
    rubbed_roughness.operation = 'SUBTRACT'
    links.new(original_roughness, rubbed_roughness.inputs[0])
    links.new(wear.outputs[0], rubbed_roughness.inputs[1])
    links.new(rubbed_roughness.outputs[0], shader.inputs['Roughness'])
    bpy.context.view_layer.update()
    floor_candidates = []
    for instance in builder.scene.objects:
        if instance.type != 'MESH' or instance.hide_render or not instance.name.startswith('NightWorld/mesh'):
            continue
        center, extent = world_bounds(instance)
        if (center - Vector((0, 10.5, .007))).length < .003 and (extent - Vector((2.94, 1.46, .018))).length < .004:
            floor_candidates.append(instance)
    if len(floor_candidates) != 1:
        raise RuntimeError('Pedals require one exact existing 2.94 by 1.46 m cockpit floor panel')
    floor = floor_candidates[0]
    graph = bpy.context.evaluated_depsgraph_get()
    floor_tree = BVHTree.FromObject(floor, graph)
    floor_inverse = floor.matrix_world.inverted()
    contacts, assemblies, mounts = [], [], []
    floor_samples = []
    angle = math.radians(31)
    for horizontal in (-.28, .28):
        start_index = len(builder.objects)
        ray_origin = Vector((horizontal, 10.92, .45))
        hit = floor_tree.ray_cast(floor_inverse @ ray_origin,
                                  (floor_inverse.to_3x3() @ Vector((0, 0, -1))).normalized())[0]
        if hit is None:
            raise RuntimeError('Pedal floor mounting point has no actual deck intersection')
        ground = (floor.matrix_world @ hit).z
        frame = Matrix.Translation((horizontal, 10.92, .149)) @ Matrix.Rotation(angle, 4, 'X')

        def position(across, along, normal):
            return frame @ Vector((across, along, normal))

        def plate_box(role, center, dimensions, material, bevel=.002):
            instance = builder.bevel_box(f'flight console pedal {horizontal} {role}', (0, 0, 0), dimensions, material, bevel)
            instance.matrix_world = frame @ Matrix.Translation(center)
            return instance

        base_top = ground + .0215
        mount = builder.bevel_box(f'flight console pedal {horizontal} deck mounting shoe',
                                  (horizontal, 10.90, ground + .0105), (.30, .46, .022), 'green', .004)
        mounts.append(mount)
        contacts.append((mount, floor, 'mount to existing cockpit floor'))
        backing = plate_box('formed alloy backing', (0, 0, 0), (.225, .33, .018), 'pedal_body', .004)
        tread = plate_box('abrasive shoe contact insert', (0, 0, .012), (.206, .304, .008), 'pedal_grip', .003)
        contacts.append((backing, tread, 'grit-coated insert to backing'))
        heel = plate_box('retaining heel lip', (0, -.137, .025), (.193, .018, .024), 'pedal_body', .003)
        contacts.append((heel, tread, 'heel lip to tread'))
        for row in range(10):
            rib = plate_box(f'transverse traction rib {row}', (0, -.104 + row * .024, .01725),
                            (.184, .0065, .0035), 'pedal_rib', .0008)
            contacts.append((rib, tread, 'raised traction rib to tread'))
        for across in (-.091, .091):
            for along in (-.136, .136):
                screw = builder.cylinder(f'flight console pedal {horizontal} captive tread fixing {across} {along}',
                                         position(across, along, .006), position(across, along, .019),
                                         .0045, 'pedal_body', 24)
                contacts.append((screw, backing, 'tread fixing to backing'))
        hinge_center = position(0, -.119, -.023)
        hinge = builder.cylinder(f'flight console pedal {horizontal} continuous lower hinge axle',
                                 position(-.149, -.119, -.023), position(.149, -.119, -.023),
                                 .017, 'aluminum', 48)
        contacts.append((hinge, backing, 'lower hinge axle to pedal backing'))
        upper_axle = builder.cylinder(f'flight console pedal {horizontal} upper linkage pin',
                                      position(-.112, .095, -.022), position(.112, .095, -.022),
                                      .018, 'pedal_body', 40)
        contacts.append((upper_axle, backing, 'upper linkage pin to backing'))
        for side in (-1, 1):
            bracket_top = hinge_center.z + .013
            bracket = builder.bevel_box(f'flight console pedal {horizontal} hinge bearing block {side}',
                                        (horizontal + side * .119, hinge_center.y, (base_top - .001 + bracket_top) / 2),
                                        (.032, .065, bracket_top - base_top + .001), 'pedal_body', .003)
            contacts.extend(((bracket, mount, 'hinge bearing to deck shoe'), (hinge, bracket, 'hinge axle through bearing')))
            lower = Vector((horizontal + side * .077, 11.065, ground + .047))
            upper = position(side * .077, .095, -.022)
            anchor = builder.bevel_box(f'flight console pedal {horizontal} linkage deck clevis {side}',
                                       (lower.x, lower.y, base_top + .020), (.035, .050, .042), 'pedal_body', .003)
            link = builder.cylinder(f'flight console pedal {horizontal} force transfer link {side}',
                                    lower, upper, .012, 'aluminum', 40)
            lower_pin = builder.cylinder(f'flight console pedal {horizontal} deck clevis pivot {side}',
                                         lower + Vector((-.026, 0, 0)), lower + Vector((.026, 0, 0)),
                                         .010, 'aluminum', 32)
            contacts.extend(((anchor, mount, 'linkage clevis to deck shoe'), (link, anchor, 'load link to deck clevis'),
                             (link, upper_axle, 'load link to upper hinge'), (lower_pin, anchor, 'lower pivot through clevis')))
        assemblies.append({'horizontal_metres': horizontal, 'tilt_degrees': 31,
                           'backing_dimensions_metres': [.225, .33, .018], 'tread_dimensions_metres': [.206, .304, .008],
                           'actual_deck_height_metres': ground, 'hinge_axis_center_metres': list(hinge_center),
                           'traction_ribs': 10, 'force_transfer_links': 2,
                           'components': len(builder.objects) - start_index})
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    surfaces = {}
    for instance in {component for contact in contacts for component in contact[:2]}:
        evaluated = instance.evaluated_get(graph)
        geometry = evaluated.to_mesh()
        vertices = [evaluated.matrix_world @ vertex.co for vertex in geometry.vertices]
        polygons = [tuple(polygon.vertices) for polygon in geometry.polygons]
        surfaces[instance] = BVHTree.FromPolygons(vertices, polygons)
        evaluated.to_mesh_clear()
    for first, last, role in contacts:
        if not surfaces[first].overlap(surfaces[last]):
            raise RuntimeError(f'Pedal assembly lacks actual mesh contact: {role}, {first.name}, {last.name}')
    for mount in mounts:
        points = [mount.matrix_world @ vertex.co for vertex in mount.data.vertices]
        minimum = min(point.z for point in points)
        for point in points:
            if point.z > minimum + .00001:
                continue
            hit = surfaces[floor].ray_cast(point + Vector((0, 0, .1)), Vector((0, 0, -1)), .2)[0]
            if hit is None or not -.001 <= point.z - hit.z <= .001:
                raise RuntimeError('Pedal mounting shoe is not seated on its actual deck mesh')
            floor_samples.append(point.z - hit.z)
    pedal_objects = [instance for instance in builder.objects if instance.get('hero_role', '').startswith('flight console pedal ')]
    maximum_height = max((instance.matrix_world @ vertex.co).z for instance in pedal_objects for vertex in instance.data.vertices)
    if maximum_height > .28:
        raise RuntimeError('Pedal assembly exceeds the protected lower footwell envelope')
    return {'assemblies': assemblies, 'verified_contact_pairs': len(contacts), 'missing_contact_pairs': 0,
            'floor_contact_samples': len(floor_samples), 'maximum_floor_clearance_metres': max(floor_samples),
            'maximum_component_height_metres': maximum_height, 'camera_and_display_positions_preserved': True}


def pressure_gauge(builder, name, horizontal, vertical, angle):
    builder.cylinder(name + ' rolled bezel', (horizontal, -.279, vertical),
                     (horizontal, -.324, vertical), .070, 'aluminum', 64)
    builder.cylinder(name + ' gasket', (horizontal, -.325, vertical),
                     (horizontal, -.329, vertical), .061, 'rubber', 64)
    builder.cylinder(name + ' printed dial', (horizontal, -.330, vertical),
                     (horizontal, -.331, vertical), .057, 'paper', 64)
    for division in range(31):
        bearing = math.radians(-130 + division * 260 / 30)
        outer = .050
        inner = .039 if division % 5 == 0 else .045
        builder.cylinder(name + f' graduation {division}',
                         (horizontal + math.sin(bearing) * inner, -.332, vertical + math.cos(bearing) * inner),
                         (horizontal + math.sin(bearing) * outer, -.332, vertical + math.cos(bearing) * outer),
                         .00065, 'dark_ink', 8)
    direction = math.radians(angle)
    builder.cylinder(name + ' pressure needle', (horizontal, -.335, vertical),
                     (horizontal + math.sin(direction) * .043, -.335, vertical + math.cos(direction) * .043),
                     .0013, 'orange', 12)
    builder.cylinder(name + ' needle hub', (horizontal, -.333, vertical),
                     (horizontal, -.338, vertical), .005, 'green', 24)
    builder.text(name + ' unit', 'MPa', (horizontal, -.334, vertical - .024), .010, 'dark_ink')


def rear_vessel_plaque(builder):
    body = 'CONSTELLATION  /  EXPLORATION VESSEL'
    original_position = Vector((0, 6.294, 3.17))
    labels = [instance for instance in builder.scene.objects
              if instance.type == 'FONT' and not instance.hide_render
              and instance.name.startswith('NightWorld/label') and instance.data.body == body
              and (instance.matrix_world.translation - original_position).length < .002]
    lintels = []
    for instance in builder.scene.objects:
        if instance.type != 'MESH' or instance.hide_render or not instance.name.startswith('NightWorld/mesh'):
            continue
        center, extent = world_bounds(instance)
        if (center - Vector((0, 6.3, 3.4))).length < .002 and (extent - Vector((2.42, .24, .15))).length < .003:
            lintels.append(instance)
    if len(labels) != 1 or len(lintels) != 1:
        raise RuntimeError(f'Expected one original rear vessel label and its door lintel: {len(labels)}, {len(lintels)}')
    label, lintel = labels[0], lintels[0]
    plate = builder.bevel_box('rear vessel plaque metal backing', (0, 6.425, 3.4),
                              (1.9, .018, .112), 'green', .003)
    label.data = label.data.copy()
    label.data.extrude = .0003
    label.data.bevel_depth = 0
    label.data.materials.clear()
    label.data.materials.append(builder.materials['ink'])
    label.matrix_world = (Matrix.Translation((0, 6.4339, 3.4))
                          @ Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    label['offline_rear_plaque_original_position'] = list(original_position)
    bpy.context.view_layer.update()
    _, text_extent = world_bounds(label)
    fit = min(1, 1.72 / max(.001, text_extent.x), .072 / max(.001, text_extent.z))
    label.data.size *= fit
    screws = []
    for horizontal in (-.893, .893):
        screws.append(builder.cylinder(f'rear vessel plaque captive fixing {horizontal}',
                                        (horizontal, 6.431, 3.4), (horizontal, 6.437, 3.4),
                                        .005, 'aluminum', 24))
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    surfaces = {}
    for instance in [label, lintel, plate] + screws:
        evaluated = instance.evaluated_get(graph)
        geometry = evaluated.to_mesh()
        surfaces[instance] = BVHTree.FromPolygons([evaluated.matrix_world @ vertex.co for vertex in geometry.vertices],
                                                 [tuple(polygon.vertices) for polygon in geometry.polygons])
        evaluated.to_mesh_clear()
    contacts = [(plate, lintel), (label, plate)] + [(screw, plate) for screw in screws]
    for first, last in contacts:
        if not surfaces[first].overlap(surfaces[last]):
            raise RuntimeError(f'Rear vessel plaque lacks physical backing contact: {first.name}, {last.name}')
    plate_center, plate_extent = world_bounds(plate)
    lintel_center, lintel_extent = world_bounds(lintel)
    for axis in (0, 2):
        if abs(plate_center[axis] - lintel_center[axis]) + plate_extent[axis] / 2 > lintel_extent[axis] / 2:
            raise RuntimeError('Rear vessel plaque extends past the existing lintel into an aperture')
    normal = (label.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    if normal.dot(Vector((0, 1, 0))) < .999:
        raise RuntimeError('Rear vessel plaque does not face the cockpit')
    return {'text': body, 'original_position_metres': list(original_position),
            'new_position_metres': list(label.matrix_world.translation),
            'backing_dimensions_metres': [1.9, .018, .112],
            'support_lintel': lintel.name, 'verified_contact_pairs': len(contacts),
            'backing_within_existing_lintel_projection': True, 'cockpit_facing_normal': list(normal),
            'runtime_descriptor_and_rear_sky_opening_preserved': True}


def life_support_modules(builder):
    builder.bevel_box('environment rack equipment tray', (0, -.17, -.46),
                      (1.35, .32, .038), 'aluminum', .009)
    for index, horizontal in enumerate((-.43, -.10, .23)):
        name = f'environment cartridge {index}'
        vessel_material = 'titanium' if index != 1 else 'ivory'
        builder.cylinder(name + ' drawn canister', (horizontal, -.20, -.28),
                         (horizontal, -.20, .17), .111, vessel_material, 64)
        for elevation, direction in ((-.28, -1), (.17, 1)):
            cap_vertices, cap_faces = [], []
            for ring in range(25):
                angle = ring / 24 * math.pi / 2
                radius = .111 * math.cos(angle)
                height = elevation + direction * .043 * math.sin(angle)
                for section in range(64):
                    bearing = section * math.tau / 64
                    cap_vertices.append((horizontal + radius * math.cos(bearing),
                                         -.20 + radius * math.sin(bearing), height))
            for ring in range(24):
                for section in range(64):
                    following = (section + 1) % 64
                    face = (ring * 64 + section, ring * 64 + following,
                            (ring + 1) * 64 + following, (ring + 1) * 64 + section)
                    cap_faces.append(face if direction > 0 else tuple(reversed(face)))
            builder.mesh(name + f' dished end {elevation}', cap_vertices, cap_faces, vessel_material, True)
        for elevation in (-.23, .12):
            builder.cylinder(name + f' mounting band {elevation}', (horizontal, -.20, elevation - .014),
                             (horizontal, -.20, elevation + .014), .116, 'green', 64)
            builder.bevel_box(name + f' band attachment {elevation}', (horizontal, .039, elevation),
                              (.16, .248, .05), 'aluminum', .007)
        builder.cylinder(name + ' outlet stem', (horizontal, -.20, .20),
                         (horizontal, -.20, .27), .018, 'aluminum', 32)
        builder.bevel_box(name + ' valve body', (horizontal, -.20, .276),
                          (.088, .09, .047), 'titanium', .007)
        builder.tube(name + ' connected gas line', [(horizontal, -.20, .298),
                     (horizontal, -.20, .37), (horizontal + .067, -.20, .418),
                     (horizontal + .10, -.15, .43)], .010, 'aluminum')
        label_vertices, label_faces = [], []
        for column in range(17):
            across = (column / 16 - .5) * .139
            back = -.20 - math.sqrt(.109 ** 2 - across ** 2)
            label_vertices.extend([(horizontal + across, -.311, -.091),
                                   (horizontal + across, -.311, .023),
                                   (horizontal + across, back, .023),
                                   (horizontal + across, back, -.091)])
        for column in range(16):
            for edge in range(4):
                following = (edge + 1) % 4
                label_faces.append((column * 4 + edge, (column + 1) * 4 + edge,
                                    (column + 1) * 4 + following, column * 4 + following))
        label_faces.extend([(3, 2, 1, 0), (64, 65, 66, 67)])
        builder.mesh(name + ' conforming identification saddle', label_vertices, label_faces, 'aluminum')
        builder.bevel_box(name + ' identification band', (horizontal, -.312, -.034),
                          (.135, .003, .107), 'paper', .003)
        builder.text(name + ' identification', ('O2 / 01', 'SCRUB / 02', 'N2 / 03')[index],
                     (horizontal, -.315, -.015), .017, 'dark_ink')
        builder.text(name + ' service stamp', '32A-7  /  TESTED',
                     (horizontal, -.315, -.048), .008, 'dark_ink')
    builder.bevel_box('environment isolation manifold', (0, -.15, .43),
                      (1.22, .13, .093), 'green', .012)
    for index, horizontal in enumerate((-.51, .04)):
        builder.tube(f'environment gauge {index} manifold takeoff',
                     [(horizontal, -.15, .40), (horizontal, -.15, .345),
                      (horizontal, -.24, .345), (horizontal, -.285, .345)], .012, 'aluminum')
        pressure_gauge(builder, f'environment gauge {index}', horizontal, .345, 22 + index * 19)
    for index in range(5):
        elevation = -.26 + index * .11
        builder.bevel_box(f'environment service connector block {index}', (.55, -.155, elevation),
                          (.10, .12, .071), 'ivory', .009)
        builder.cylinder(f'environment connector socket {index}', (.55, -.217, elevation),
                         (.55, -.246, elevation), .021, 'aluminum', 32)
        builder.cylinder(f'environment connector insulated core {index}', (.55, -.247, elevation),
                         (.55, -.25, elevation), .011, 'rubber', 24)
    builder.bevel_box('environment rack identifier plate', (0, -.229, .515),
                      (.83, .016, .060), 'green', .004)
    for horizontal in (-.38, .38):
        builder.bevel_box(f'environment rack identifier bracket {horizontal}', (horizontal, -.161, .530),
                          (.026, .153, .032), 'aluminum', .003)
    builder.text('environment rack identifier', 'ECLSS / REGENERATIVE AIR',
                 (0, -.239, .514), .024)


def avionics_modules(builder):
    for rail in (-.65, .65):
        builder.bevel_box(f'avionics vertical mounting rail {rail}', (rail, -.24, 0),
                          (.044, .033, 1.07), 'aluminum', .003)
    for module, elevation in enumerate((-.36, -.12, .12, .36)):
        name = f'avionics tray {module}'
        builder.bevel_box(name + ' extraction gasket', (0, -.213, elevation),
                          (1.26, .024, .214), 'rubber', .009)
        builder.bevel_box(name + ' folded faceplate', (0, -.238, elevation),
                          (1.23, .035, .195), 'ivory' if module in (0, 2) else 'green', .009)
        builder.bevel_box(name + ' screenprinted legend', (-.29, -.257, elevation + .047),
                          (.48, .002, .049), 'green', .002)
        builder.text(name + ' equipment function', ('DC / POWER CONVERSION', 'RCS / ACTUATOR CONTROL',
                     'COMMS / NAVIGATION', 'FLIGHT / REDUNDANT CPU')[module],
                     (-.29, -.26, elevation + .047), .014)
        for vent in range(13):
            builder.bevel_box(name + f' inlet aperture {vent}', (-.53 + vent * .036, -.258, elevation - .036),
                              (.020, .003, .044), 'rubber', .004)
        for connector in range(3):
            horizontal = .075 + connector * .127
            builder.ring(name + f' connector rim {connector}', (horizontal, -.268, elevation - .016),
                         .085, .060, .061, .039, .023, 'aluminum')
            builder.bevel_box(name + f' connector recess {connector}', (horizontal, -.263, elevation - .016),
                              (.064, .009, .043), 'rubber', .002)
            for pin in range(5):
                builder.cylinder(name + f' pin {connector} {pin}',
                                 (horizontal - .020 + pin * .01, -.266, elevation - .016),
                                 (horizontal - .020 + pin * .01, -.277, elevation - .016), .001, 'aluminum', 8)
            for lock_side in (-1, 1):
                lock_horizontal = horizontal + lock_side * .032
                builder.bevel_box(name + f' connector mounting ear {connector} {lock_side}',
                                  (lock_horizontal, -.2675, elevation + .018),
                                  (.014, .026, .024), 'aluminum', .0012, 5)
                builder.fastener(name + f' connector captive lock {connector} {lock_side}',
                                 (lock_horizontal, -.2804, elevation + .022), .0032)
            builder.bevel_box(name + f' connector polarization key {connector}',
                              (horizontal, -.280, elevation + .0086), (.018, .006, .004), 'ivory', .0005, 3)
        for indicator in range(2):
            builder.cylinder(name + f' status bezel {indicator}', (.49 + indicator * .053, -.254, elevation + .043),
                             (.49 + indicator * .053, -.266, elevation + .043), .011, 'rubber', 24)
            builder.cylinder(name + f' status lamp {indicator}', (.49 + indicator * .053, -.265, elevation + .043),
                             (.49 + indicator * .053, -.27, elevation + .043), .006, 'cyan' if indicator == 0 else 'amber', 24)
        for side in (-1, 1):
            builder.tube(name + f' extraction handle {side}', [(side * .568, -.261, elevation - .057),
                         (side * .568, -.308, elevation - .044), (side * .568, -.308, elevation + .044),
                         (side * .568, -.261, elevation + .057)], .007, 'aluminum')
            builder.fastener(name + f' rack lock {side}', (side * .65, -.26, elevation), .007)


def embedded_equipment(builder, side):
    start_index = len(builder.objects)
    builder.bevel_box(f'embedded systems {side} structural backpan', (0, .17, 0),
                      (1.48, .024, 1.14), 'green', .008, 6)
    for horizontal in (-.724, .724):
        builder.bevel_box(f'embedded systems {side} folded enclosure cheek {horizontal}',
                          (horizontal, -.016, 0), (.032, .39, 1.14), 'green', .008)
    for elevation in (-.554, .554):
        builder.bevel_box(f'embedded systems {side} folded enclosure shelf {elevation}',
                          (0, -.016, elevation), (1.42, .39, .032), 'green', .008)
    builder.ring(f'embedded systems {side} perimeter flange', (0, -.206, 0),
                 1.53, 1.2, 1.40, 1.06, .035, 'ivory')
    life_support_modules(builder) if side < 0 else avionics_modules(builder)
    bpy.context.view_layer.update()
    placement = Matrix.Translation((side * 2.55, 8.2, 1.19)) @ Matrix.Rotation(-side * math.pi / 2, 4, 'Z')
    for instance in builder.objects[start_index:]:
        instance.matrix_world = placement @ instance.matrix_world
    builder.bevel_box(f'embedded systems {side} kick protector', (side * 2.45, 8.2, .54),
                      (.21, 1.46, .068), 'green', .015)
    display_origin = Vector((side * (2.67 - .041 * math.sin(.8) - .20),
                             10.5 - .041 * math.cos(.8), 1.77))
    display_frame = Matrix.Translation(display_origin) @ Matrix.Rotation(-side * .8, 4, 'Z')
    plate = builder.bevel_box(f'side display {side} rear conforming mounting plate', (0, .098, 0),
                              (.32, .024, .27), 'green', .012, 7)
    bpy.context.view_layer.update()
    plate.matrix_world = display_frame @ plate.matrix_world
    rear_joint = display_frame @ Vector((0, .145, -.055))
    wall_joint = Vector((side * 2.745, 10.67, 1.715))
    builder.cylinder(f'side display {side} rear swivel bearing',
                     display_frame @ Vector((0, .100, -.055)), rear_joint, .055, 'aluminum', 48)
    builder.cylinder(f'side display {side} load-bearing rear arm', rear_joint, wall_joint, .032, 'green', 48)
    builder.bevel_box(f'side display {side} wall attachment foot', (side * 2.767, 10.67, 1.715),
                      (.062, .24, .26), 'ivory', .012, 7)
    for forward in [10.594, 10.746]:
        for elevation in [1.633, 1.797]:
            builder.cylinder(f'side display {side} wall attachment bolt {forward} {elevation}',
                             (side * 2.728, forward, elevation), (side * 2.738, forward, elevation), .008, 'aluminum', 24)
    builder.bevel_box(f'embedded systems {side} lower distribution enclosure', (side * 2.48, 9.67, .61),
                      (.15, .43, .26), 'ivory', .016)
    for channel in range(2):
        forward = 8.20 + channel * .23
        destination_forward = 9.55 + channel * .21
        source = (side * 2.50, forward, .604)
        destination = (side * 2.385, destination_forward, .61)
        conduit = builder.tube(f'embedded systems {side} connected lower conduit {channel}',
                     [source, (side * 2.50, forward + .20, .55),
                      (side * 2.50, 8.90 + channel * .10, .38),
                      (side * 2.34, 9.25 + channel * .07, .40),
                      (side * 2.33, destination_forward - .08, .55),
                      (side * 2.33, destination_forward, .61), destination], .018, 'cable')
        clearance = []
        for vertex in conduit.data.vertices:
            ratio = max(0, min(1, (vertex.co.z - .10) / 2.4))
            inner_shell = 2.60 + math.sin(ratio * math.pi / 2) * .21 - .050
            clearance.append(inner_shell - abs(vertex.co.x))
        if min(clearance) < .030:
            raise RuntimeError(f'Lower conduit {side}/{channel} violates pressure-shell clearance: {min(clearance)}')
        conduit['minimum_inner_shell_clearance'] = min(clearance)
        for vertex in conduit.data.vertices:
            if 9.455 <= vertex.co.y <= 9.885 and .48 <= vertex.co.z <= .74 and 2.405 <= abs(vertex.co.x) <= 2.555:
                raise RuntimeError(f'Lower conduit {side}/{channel} enters the distribution enclosure before its front gland')
        conduit['distribution_enclosure_vertex_intrusions'] = 0
        builder.cylinder(f'embedded systems {side} lower conduit source gland {channel}',
                         (side * 2.50, forward, .652), (side * 2.50, forward, .587), .028, 'aluminum', 32)
        builder.cylinder(f'embedded systems {side} lower conduit destination gland {channel}',
                         (side * 2.37, destination_forward, .61),
                         (side * 2.421, destination_forward, .61), .029, 'aluminum', 32)
        builder.bevel_box(f'embedded systems {side} lower conduit fixed clip {channel}',
                          (side * 2.553, 8.90 + channel * .10, .38), (.16, .07, .061), 'green', .006)


def flight_seat(builder):
    builder.cushion('pilot rigid back shell', (0, 9.43, 1.045), (.73, .105, .98), 'green')
    builder.cushion('pilot lower lumbar cushion', (0, 9.548, .833), (.568, .17, .34), 'fabric', .028)
    builder.cushion('pilot upper thoracic cushion', (0, 9.541, 1.20), (.565, .15, .34), 'fabric', .016)
    builder.cushion('pilot seat pan shell', (0, 9.90, .477), (.72, .80, .092), 'green')
    for side in [-1, 1]:
        builder.cushion(f'pilot leg cushion {side}', (side * .148, 9.95, .574), (.277, .65, .145), 'fabric')
        builder.cushion(f'pilot side bolster {side}', (side * .311, 9.55, 1.06), (.115, .19, .81), 'fabric')
        builder.cylinder(f'pilot headrest mount {side}', (side * .17, 9.43, 1.36),
                         (side * .17, 9.43, 1.59), .018, 'aluminum', 32)
        builder.tube(f'pilot rear load-bearing seat rail {side}',
                     [(side * .29, 9.46, .50), (side * .30, 9.365, .90),
                      (side * .27, 9.345, 1.42)], .022, 'aluminum')
        builder.webbing(f'pilot shoulder restraint {side}',
                     [(side * .22, 9.60, 1.46), (side * .21, 9.675, 1.15),
                      (side * .18, 9.72, .82), (side * .11, 9.76, .68)], .045)
        builder.bevel_box(f'pilot floor slide {side}', (side * .30, 9.88, .14),
                          (.08, .95, .07), 'green', .014)
        builder.cylinder(f'pilot seat suspension {side}', (side * .28, 9.58, .18),
                         (side * .28, 9.78, .43), .025, 'aluminum')
    builder.cushion('pilot headrest shell', (0, 9.425, 1.654), (.49, .105, .262), 'green')
    builder.cushion('pilot shaped headrest pad', (0, 9.505, 1.654), (.416, .114, .203), 'fabric')
    builder.bevel_box('pilot harness central buckle', (0, 9.771, .67), (.098, .034, .072), 'aluminum', .012)
    builder.bevel_box('pilot harness orange release', (0, 9.793, .674), (.046, .01, .034), 'orange', .006)
    for elevation, width, height in [(1.20, .51, .29), (.833, .51, .29), (1.654, .37, .17)]:
        forward = 9.564 if elevation > 1.5 else 9.623
        points = []
        for step in range(129):
            angle = step * math.tau / 128
            horizontal = math.copysign(abs(math.cos(angle)) ** .36, math.cos(angle)) * width / 2
            vertical = math.copysign(abs(math.sin(angle)) ** .36, math.sin(angle)) * height / 2
            points.append((horizontal, forward, elevation + vertical))
        builder.tube(f'upholstery tailored piping {elevation}', points, .0018, 'stitch')
    for side in (-1, 1):
        for seam in (-1, 1):
            horizontal = side * .148 + seam * .11
            builder.tube(f'seat pan bound seam {side} {seam}',
                         [(horizontal, 9.69, .621), (horizontal, 9.83, .648),
                          (horizontal, 10.08, .648), (horizontal, 10.23, .621)], .0016, 'stitch')


def thermal_lining(builder):
    for side in (-1, 1):
        for bay in range(4):
            forward_start = 7.07 + bay * 1.07
            vertices, faces = [], []
            for across in range(41):
                fraction = across / 40
                angle = .20 + fraction * .98
                for along in range(49):
                    progress = along / 48
                    edge = math.sin(math.pi * fraction) * math.sin(math.pi * progress)
                    across_cell = fraction * 3
                    along_cell = progress * 3
                    quilt = abs(math.sin(across_cell * math.pi)) * abs(math.sin(along_cell * math.pi))
                    cell_variation = .75 + .25 * math.sin(math.floor(across_cell) * 3.7 + math.floor(along_cell) * 4.3 + bay * 1.9 + side)
                    drape = math.sin(progress * math.pi) * math.sin(fraction * math.pi * 2 + bay * .71) * .008
                    depth = .082 + edge * .010 + quilt * (.023 + .014 * cell_variation) + drape * edge
                    horizontal = side * (1.56 + (1.25 - depth) * math.cos(angle))
                    vertical = 2.50 + (1.32 - depth) * math.sin(angle)
                    vertices.append((horizontal, forward_start + progress * .83, vertical))
            for across in range(40):
                for along in range(48):
                    start = across * 49 + along
                    face = (start, start + 1, start + 50, start + 49)
                    faces.append(tuple(reversed(face)) if side > 0 else face)
            lining = builder.mesh(f'quilted removable acoustic liner {side} {bay}', vertices, faces, 'thermal', True)
            modifier = lining.modifiers.new('Liner thickness', 'SOLIDIFY')
            modifier.thickness = .006
            modifier.offset = -1
            for row in (0, 13, 27, 40):
                points = vertices[row * 49:(row + 1) * 49]
                builder.tube(f'thermal liner stitched channel {side} {bay} {row}', points, .0017, 'stitch')
            for column in (0, 16, 32, 48):
                builder.tube(f'thermal liner transverse seam {side} {bay} {column}',
                             vertices[column::49], .0017, 'stitch')
            for across, along in ((1, 1), (1, 47), (39, 1), (39, 47)):
                point = Vector(vertices[across * 49 + along])
                normal = Vector((-side * math.cos(.20 + across / 40 * .98), 0,
                                 -math.sin(.20 + across / 40 * .98)))
                builder.cylinder(f'liner captive snap {side} {bay} {across} {along}',
                                 point, point + normal * .004, .012, 'aluminum', 32)


def environmental_hardware(builder):
    for side in (-1, 1):
        start = len(builder.objects)
        builder.bevel_box(f'air return {side} recessed surround', (0, 0, 0),
                          (.97, .035, .30), 'green', .016)
        builder.ring(f'air return {side} removable trim', (0, -.025, 0),
                     1.01, .34, .90, .23, .018, 'ivory')
        for slat in range(9):
            fin = builder.bevel_box(f'air return {side} formed louver {slat}',
                                    (0, -.03, -.10 + slat * .025), (.90, .045, .006), 'aluminum', .002, 3)
            fin.rotation_euler.x = -.4
        builder.text(f'air return {side} embossed safety legend', 'CABIN RETURN  /  DO NOT COVER',
                     (0, -.039, .21), .026)
        for horizontal in (-.46, .46):
            builder.fastener(f'air return {side} service lock {horizontal}', (horizontal, -.039, 0), .008)
        bpy.context.view_layer.update()
        placement = Matrix.Translation((side * 2.725, 9.50, 1.80)) @ Matrix.Rotation(-side * math.pi / 2, 4, 'Z')
        for instance in builder.objects[start:]:
            instance.matrix_world = placement @ instance.matrix_world
    for panel in range(4):
        forward = 7.38 + panel * .73
        builder.bevel_box(f'walkway removable rubber tread {panel}', (0, forward, .035),
                          (1.25, .70, .037), 'rubber', .018)
        vertices, faces = [], []
        for strip in range(17):
            horizontal = -.57 + strip * .071
            for row in range(7):
                depth = forward - .28 + row * .084
                start = len(vertices)
                vertices.extend([(horizontal - .008, depth - .027, .055),
                                 (horizontal + .016, depth + .021, .055),
                                 (horizontal + .008, depth + .027, .059),
                                 (horizontal - .016, depth - .021, .059)])
                faces.append(tuple(start + offset for offset in range(4)))
        builder.mesh(f'walkway molded anti-slip chevrons {panel}', vertices, faces, 'green')
    builder.bevel_box('emergency breathing kit bracket', (-2.65, 7.22, .94), (.11, .35, .68), 'green', .025)
    builder.cylinder('emergency breathing oxygen cylinder', (-2.53, 7.22, .68),
                     (-2.53, 7.22, 1.14), .112, 'orange', 64)
    for elevation in (.69, 1.13):
        builder.cushion(f'breathing cylinder spun end {elevation}', (-2.53, 7.22, elevation),
                        (.223, .223, .12), 'orange')
    builder.cylinder('breathing cylinder valve', (-2.53, 7.22, 1.19),
                     (-2.53, 7.22, 1.26), .024, 'aluminum', 32)
    builder.tube('breathing kit stowed hose', [(-2.53, 7.22, 1.23), (-2.34, 7.26, 1.17),
                 (-2.35, 7.44, .93), (-2.40, 7.46, .71), (-2.48, 7.34, .80)], .012, 'rubber')


def instrument_assembly(builder, display, index):
    position = display['position']
    horizontal, forward, vertical = position
    width, height = display['width'], display['height']
    label = ('POWER / ENVIRONMENT', 'ATTITUDE / FLIGHT DIRECTOR', 'NAVIGATION / RCS')[index]
    builder.ring(f'display {index} load-bearing housing', (horizontal, forward + .042, vertical),
                 width + .132, height + .136, width - .005, height - .005, .13, 'ivory')
    builder.ring(f'display {index} front anodized bezel', (horizontal, forward - .018, vertical),
                 width + .102, height + .102, width - .008, height - .008, .018, 'green')
    builder.ring(f'display {index} elastomer seal', (horizontal, forward - .009, vertical),
                 width + .015, height + .015, width - .008, height - .008, .009, 'rubber')
    builder.bevel_box(f'display {index} optical cover', (horizontal, forward - .012, vertical),
                      (width - .014, .0008, height - .014), 'glass', .00015, 3)
    builder.text(f'display {index} engraved module name', label,
                 (horizontal, forward - .029, vertical + height / 2 + .033), .014)
    for side in [-1, 1]:
        for top in [-1, 1]:
            builder.fastener(f'display {index} quarter-turn {side} {top}',
                             (horizontal + side * (width / 2 + .036), forward - .028,
                              vertical + top * (height / 2 + .032)))
        support_x = horizontal + side * width * .32
        upper_mount = vertical + .035
        builder.bevel_box(f'display {index} rear pedestal {side}', (support_x, forward + .141, (.818 + upper_mount) / 2),
                          (.055, .069, upper_mount - .818), 'green', .004)
        builder.bevel_box(f'display {index} mounting foot {side}', (support_x, forward + .12, .808),
                          (.095, .22, .025), 'aluminum', .003)
    builder.bevel_box(f'display {index} glare hood', (horizontal, forward - .009, vertical + height / 2 + .078),
                      (width + .145, .205, .038), 'green', .009)
    for vent in range(9):
        builder.bevel_box(f'display {index} underside cooling slot {vent}',
                          (horizontal - width * .32 + vent * width * .08, forward - .027,
                           vertical - height / 2 - .04), (.027, .0012, .009), 'rubber', .001)


def controller_bellows(builder, side):
    horizontal, forward, bottom = side * .68, 10.45, .966
    builder.bevel_box(f'controller {side} gimbal flange', (horizontal, forward, bottom),
                      (.18, .23, .027), 'aluminum', .013)
    vertices = []
    steps = 241
    circumference = 64
    for level in range(steps):
        ratio = level / (steps - 1)
        fold = (1 + math.cos(ratio * math.tau * 12)) * .5
        radius = .074 * (1 - ratio) + .041 * ratio + .003 * fold ** .65
        for section in range(circumference):
            angle = section * math.pi * 2 / circumference
            vertices.append((horizontal + math.cos(angle) * radius,
                             forward + ratio * .135 + math.sin(angle) * radius,
                             bottom + .016 + ratio * .17))
    faces = []
    for level in range(steps - 1):
        for section in range(circumference):
            following = (section + 1) % circumference
            faces.append((level * circumference + section, level * circumference + following,
                          (level + 1) * circumference + following, (level + 1) * circumference + section))
    builder.mesh(f'controller {side} molded bellows', vertices, faces, 'rubber', True)
    builder.cylinder(f'controller {side} top clamp', (horizontal, forward + .118, 1.131),
                     (horizontal, forward + .135, 1.155), .047, 'green')
    for vertical_side in [-1, 1]:
        builder.cylinder(f'controller {side} flange screw {vertical_side}',
                         (horizontal + side * .065, forward + vertical_side * .078, .981),
                         (horizontal + side * .065, forward + vertical_side * .078, .985), .005, 'aluminum', 24)



def legacy_controller_grips(scene):
    candidates = [(instance, *world_bounds(instance)) for instance in scene.objects
                  if instance.type == 'MESH' and instance.name.startswith('NightWorld/mesh') and not instance.hide_render]
    matches = []
    for side in (-1, 1):
        target = Vector((side * .68, 10.55, 1.1))
        dimensions = Vector((.11, .29152554, .36101703))
        found = [instance for instance, center, extent in candidates
                 if (center - target).length < .002 and (extent - dimensions).length < .004]
        if len(found) != 1:
            raise RuntimeError(f'Expected one exact legacy controller grip for side {side}, found {len(found)}')
        matches.extend(found)
    return matches


def ergonomic_controller_grips(builder, side):
    horizontal, forward = side * .68, 10.585
    start_index = len(builder.objects)
    if side > 0:
        builder.cylinder('right attitude stick internal metal neck', (horizontal, forward, 1.145),
                         (horizontal, forward + .009, 1.186), .021, 'aluminum', 48)
        profile = [(1.166, .024, .024), (1.178, .030, .030), (1.194, .029, .035),
                   (1.223, .031, .036), (1.252, .034, .039), (1.276, .040, .043),
                   (1.297, .044, .045), (1.309, .040, .041), (1.314, .025, .029)]
        vertices, faces = [], []

        def grip_point(elevation, angle):
            elevation = min(profile[-1][0], max(profile[0][0], elevation))
            radius_x, radius_y = profile[-1][1:]
            for first, last in zip(profile[:-1], profile[1:]):
                if first[0] <= elevation <= last[0]:
                    progress = (elevation - first[0]) / (last[0] - first[0])
                    progress = progress * progress * (3 - 2 * progress)
                    radius_x = first[1] + (last[1] - first[1]) * progress
                    radius_y = first[2] + (last[2] - first[2]) * progress
                    break
            lean = (elevation - 1.166) * .15
            indentation = sum(.006 * math.exp(-((elevation - center) / .009) ** 2)
                              for center in (1.196, 1.221, 1.247))
            fingertip = max(0, math.sin(angle)) ** 3
            return (horizontal + math.cos(angle) * radius_x,
                    forward + lean + math.sin(angle) * (radius_y - indentation * fingertip), elevation)

        for row in range(97):
            elevation = 1.166 + row / 96 * .148
            for section in range(64):
                vertices.append(grip_point(elevation, section * math.tau / 64))
        for row in range(96):
            for section in range(64):
                following = (section + 1) % 64
                faces.append((row * 64 + section, row * 64 + following,
                              (row + 1) * 64 + following, (row + 1) * 64 + section))
        faces.extend((tuple(reversed(range(64))), tuple(range(96 * 64, 97 * 64))))
        builder.mesh('right attitude stick contoured finger-channel overmold', vertices, faces, 'rubber', True)
        for angle in (0, math.pi):
            seam = [grip_point(1.176 + row / 24 * .128, angle) for row in range(25)]
            builder.tube(f'right attitude stick molded shell parting line {angle}', seam, .0007, 'green', 2)
        builder.cylinder('right attitude stick retaining collar', (horizontal, forward + .002, 1.164),
                         (horizontal, forward + .003, 1.180), .032, 'green', 64)
        for offset in (-.013, .013):
            builder.fastener(f'right attitude stick collar screw {offset}', (horizontal + offset, forward - .027, 1.172), .003)
        builder.bevel_box('right attitude stick thumb-switch bezel', (horizontal - .008, forward + .018, 1.312),
                          (.041, .037, .011), 'green', .008, 6)
        builder.cylinder('right attitude stick four-way hat boot', (horizontal - .013, forward + .009, 1.315),
                         (horizontal - .013, forward + .009, 1.324), .010, 'rubber', 40)
        builder.bevel_box('right attitude stick four-way thumb hat', (horizontal - .013, forward + .009, 1.325),
                          (.025, .023, .009), 'green', .004, 5)
        builder.cylinder('right attitude stick thumb auxiliary bezel', (horizontal + .017, forward + .028, 1.309),
                         (horizontal + .017, forward + .028, 1.316), .008, 'green', 40)
        builder.cylinder('right attitude stick thumb auxiliary cap', (horizontal + .017, forward + .028, 1.315),
                         (horizontal + .017, forward + .028, 1.320), .006, 'orange', 40)
        builder.cylinder('right attitude stick trigger hinge', (horizontal - .022, forward + .056, 1.278),
                         (horizontal + .022, forward + .056, 1.278), .007, 'aluminum', 40)
        builder.tube('right attitude stick curved index trigger',
                     [(horizontal, forward + .056, 1.281), (horizontal, forward + .068, 1.274),
                      (horizontal, forward + .070, 1.259), (horizontal, forward + .062, 1.246)], .007, 'green', 6)
    else:
        builder.cylinder('left throttle internal lever neck', (horizontal, forward, 1.145),
                         (horizontal, forward + .017, 1.220), .022, 'aluminum', 48)
        builder.cylinder('left throttle lower clamping collar', (horizontal, forward + .009, 1.178),
                         (horizontal, forward + .013, 1.201), .031, 'green', 48)
        vertices, faces = [], []
        for section in range(81):
            across = -.091 + section / 80 * .182
            taper = max(.16, 1 - (abs(across) / .102) ** 6) ** .5
            finger = sum(.003 * math.exp(-((across - center) / .008) ** 2)
                         for center in (-.059, -.029, .003, .034))
            for around in range(64):
                angle = around * math.tau / 64
                lower_finger = max(0, -math.sin(angle)) ** 2
                vertices.append((horizontal + across,
                                 forward + .021 + math.cos(angle) * .046 * taper,
                                 1.236 + math.sin(angle) * (.035 * taper - finger * lower_finger)))
        for section in range(80):
            for around in range(64):
                following = (around + 1) % 64
                faces.append((section * 64 + around, section * 64 + following,
                              (section + 1) * 64 + following, (section + 1) * 64 + around))
        faces.extend((tuple(reversed(range(64))), tuple(range(80 * 64, 81 * 64))))
        builder.mesh('left throttle transverse palm grip with finger channels', vertices, faces, 'rubber', True)
        builder.tube('left throttle joined palm shell parting line',
                     [(horizontal + across, forward + .021 - .046 * max(.16, 1 - (abs(across) / .102) ** 6) ** .5, 1.236)
                      for across in [-.086 + step / 32 * .172 for step in range(33)]],
                     .0008, 'green', 2)
        builder.bevel_box('left throttle inboard thumb-switch mounting saddle',
                          (horizontal + .067, forward + .010, 1.266), (.055, .044, .017), 'green', .008, 6)
        builder.cylinder('left throttle thumb roller bearing', (horizontal + .047, forward + .006, 1.277),
                         (horizontal + .076, forward + .006, 1.277), .009, 'aluminum', 48)
        for ring in range(9):
            across = horizontal + .049 + ring * .003
            builder.cylinder(f'left throttle fine knurled thumb roller {ring}', (across, forward + .006, 1.277),
                             (across + .0014, forward + .006, 1.277), .010, 'green', 40)
        builder.cylinder('left throttle cutoff trigger hinge', (horizontal - .025, forward + .064, 1.227),
                         (horizontal + .025, forward + .064, 1.227), .006, 'aluminum', 40)
        builder.tube('left throttle guarded index detent trigger',
                     [(horizontal, forward + .064, 1.231), (horizontal, forward + .078, 1.221),
                      (horizontal, forward + .073, 1.207)], .006, 'orange', 6)
        for offset in (-.016, .016):
            builder.fastener(f'left throttle lever clamp screw {offset}', (horizontal + offset, forward - .019, 1.190), .003)
    bpy.context.view_layer.update()
    for instance in builder.objects[start_index:]:
        center, extent = world_bounds(instance)
        if center.z + extent.z / 2 > 1.334 or abs(center.x) + extent.x / 2 > .785:
            raise RuntimeError(f'Ergonomic controller exceeds the compact pilot sightline envelope: {instance.name}')
    return {'side': side, 'new_components': len(builder.objects) - start_index, 'maximum_allowed_height_m': 1.334,
            'bellows_anchor': [horizontal, forward, 1.145]}


def validate_controller_sightlines(scene, builder, displays, descriptor):
    camera = Vector((descriptor['observation']['position'][0], -descriptor['observation']['position'][2],
                     descriptor['observation']['position'][1]))
    targets = [instance for instance in builder.objects if instance.get('hero_role', '').startswith(('right attitude stick', 'left throttle'))]
    if len(targets) < 25:
        raise RuntimeError('Expected complete right attitude and left throttle assemblies before visibility validation')
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    surfaces = []
    for instance in targets:
        evaluated = instance.evaluated_get(graph)
        geometry = evaluated.to_mesh()
        surfaces.append(BVHTree.FromPolygons([evaluated.matrix_world @ vertex.co for vertex in geometry.vertices],
                                           [tuple(polygon.vertices) for polygon in geometry.polygons]))
        evaluated.to_mesh_clear()
    tested = 0
    for display in displays:
        center = display['position']
        for column in range(25):
            for row in range(17):
                point = center + Vector(((column / 24 - .5) * (display['width'] - .008), -.015,
                                         (row / 16 - .5) * (display['height'] - .008)))
                ray = point - camera
                if any(surface.ray_cast(camera, ray.normalized(), ray.length - .001)[0] is not None for surface in surfaces):
                    raise RuntimeError(f'Ergonomic controller obstructs a forward display at {tuple(point)}')
                tested += 1
    return {'screen_rays_checked': tested, 'blocked_screen_rays': 0, 'controller_objects': len(targets)}


def side_service_assemblies(builder, side):
    horizontal = side * 2.70
    builder.bevel_box(f'service {side} cable exit enclosure', (horizontal, 10.4, .99),
                      (.18, .65, .48), 'ivory', .015)
    builder.bevel_box(f'service {side} forward loom junction', (side * 2.105, 11.976, .48),
                      (.32, .112, .21), 'ivory', .014)
    for cable in range(3):
        offset = cable * .042
        points = [(side * (2.05 + offset), 11.92, .46),
                  (side * (2.18 + offset), 11.73, .40),
                  (side * (2.45 + offset), 11.15, .39),
                  (side * (2.57 + offset), 10.86, .71),
                  (side * 2.565, 10.51 - cable * .12, .91)]
        builder.tube(f'service {side} routed loom {cable}', points, .012 if cable else .016, 'cable')
        builder.cylinder(f'service {side} forward loom gland {cable}',
                         (side * (2.05 + offset), 11.937, .46),
                         (side * (2.05 + offset), 11.906, .46), .021, 'aluminum', 32)
        builder.cylinder(f'service {side} connector {cable}', (side * 2.55, 10.51 - cable * .12, .91),
                         (side * 2.62, 10.51 - cable * .12, .91), .023, 'aluminum', 32)
        connector_forward = 10.51 - cable * .12
        for band in range(3):
            band_start = side * (2.563 + band * .019)
            band_end = side * (2.574 + band * .019)
            builder.cylinder(f'service {side} connector strain boot {cable} {band}',
                             (band_start, connector_forward, .91),
                             (band_end, connector_forward, .91), .026, 'rubber', 32)
        builder.cylinder(f'service {side} connector crimp ring {cable}',
                         (side * 2.619, connector_forward, .91),
                         (side * 2.628, connector_forward, .91), .0275, 'aluminum', 32)
    for support in [0, 1]:
        forward = 10.96 + support * .54
        builder.bevel_box(f'service {side} loom support {support}', (side * 2.68, forward, .62),
                          (.24, .044, .034), 'green', .004)
        for offset in (-.072, .072):
            builder.fastener(f'service {side} loom support captive bolt {support} {offset}',
                             (side * (2.68 + offset), forward - .0219, .62), .0042)
    builder.tube(f'service {side} grab handle', [(side * 2.54, 9.62, 1.32),
                 (side * 2.37, 9.7, 1.39), (side * 2.37, 10.16, 1.39),
                 (side * 2.54, 10.24, 1.32)], .023, 'orange')
    for forward in [9.62, 10.24]:
        builder.bevel_box(f'service {side} grab foot {forward}', (side * 2.665, forward, 1.32),
                          (.29, .09, .07), 'green', .012)
    for index in range(4):
        forward = 8.05 + index * .77
        builder.bevel_box(f'service {side} flush trim {index}', (side * 2.746, forward, 2.57),
                          (.065, .65, .028), 'aluminum', .003)


def maintenance_panels(builder, side):
    for panel, forward in enumerate((7.49, 9.52, 11.32)):
        start = len(builder.objects)
        width, height = (.79, .60) if panel != 1 else (.78, .43)
        builder.bevel_box(f'access {side} {panel} recessed gasket', (0, .008, 0),
                          (width + .022, .014, height + .022), 'rubber', .009)
        builder.bevel_box(f'access {side} {panel} folded service cover', (0, -.008, 0),
                          (width, .019, height), 'ivory', .008)
        builder.ring(f'access {side} {panel} perimeter hem', (0, -.021, 0),
                     width - .019, height - .019, width - .044, height - .044, .003, 'aluminum')
        for horizontal in (-width / 2 + .035, width / 2 - .035):
            for vertical in (-height / 2 + .035, height / 2 - .035):
                builder.fastener(f'access {side} {panel} captive screw {horizontal} {vertical}',
                                 (horizontal, -.023, vertical), .0065)
        label = ('OXYGEN / ISOLATION', 'DATA / DISTRIBUTION', 'PITOT / HEATER')[panel]
        builder.bevel_box(f'access {side} {panel} label plate', (0, -.022, height / 2 - .09),
                          (.48, .002, .057), 'green', .003)
        builder.text(f'access {side} {panel} function', label, (0, -.024, height / 2 - .087), .023)
        builder.text(f'access {side} {panel} service number', f'FD-{31 + panel}  /  ISOLATE BEFORE OPENING',
                     (0, -.025, -height / 2 + .069), .011, 'green')
        builder.bevel_box(f'access {side} {panel} quarter turn latch', (width / 2 - .13, -.026, -.03),
                          (.032, .01, .088), 'aluminum', .005)
        bpy.context.view_layer.update()
        placement = Matrix.Translation((side * 2.736, forward, 2.15)) @ Matrix.Rotation(-side * math.pi / 2, 4, 'Z')
        for instance in builder.objects[start:]:
            instance.matrix_world = placement @ instance.matrix_world
    builder.tube(f'service {side} marked cable raceway',
                 [(side * 2.697, 7.61, 2.77), (side * 2.705, 8.53, 2.77),
                  (side * 2.705, 9.34, 2.77), (side * 2.70, 10.15, 2.77)], .012, 'cable')
    for clamp, forward in enumerate((7.86, 8.84, 9.82)):
        builder.bevel_box(f'service {side} raceway clamp {clamp}', (side * 2.693, forward, 2.77),
                          (.032, .048, .045), 'aluminum', .004)
    for panel, forward in enumerate((7.43, 9.57, 11.71)):
        for horizontal in (-.52, .52):
            builder.cylinder(f'overhead access {side} {panel} captive bolt {horizontal}',
                             (side * .71 + horizontal, forward - .36, 3.744),
                             (side * .71 + horizontal, forward - .36, 3.735), .007, 'aluminum', 24)


def console_instrument_groups(builder):
    names = [('ELECTRICAL', ['BUS A', 'BUS B', 'AUX', 'CABIN', 'LIGHT']),
             ('FLIGHT CONTROL', ['TRIM', 'DAMP', 'HOLD', 'RCS', 'GAIN']),
             ('NAVIGATION', ['RANGE', 'MODE', 'COMM', 'SCAN', 'GATE'])]
    for module, horizontal in enumerate((-1.48, 0, 1.48)):
        start = len(builder.objects)
        width = 1.42 if module == 1 else 1.28
        builder.bevel_box(f'console {module} isolation gasket', (0, .008, 0),
                          (width + .017, .014, .445), 'rubber', .009)
        builder.bevel_box(f'console {module} replaceable instrument face', (0, -.002, 0),
                          (width, .011, .43), 'green', .006)
        builder.text(f'console {module} system legend', names[module][0],
                     (0, -.010, .175), .026)
        builder.text(f'console {module} part identifier', 'FD-' + str(210 + module) + '  /  REV C',
                     (width / 2 - .14, -.012, -.177), .011)
        for control in range(5):
            position = -.58 + control * .28
            builder.cylinder(f'console {module} {control} dial base ring',
                             (position, -.010, -.010), (position, -.016, -.010), .058, 'aluminum', 48)
            builder.cylinder(f'console {module} {control} knurled collar',
                             (position, -.027, -.010), (position, -.054, -.010), .048,
                             'rubber' if module == 0 else 'green', 48)
            pointer_angle = math.radians(((-42, 36, -88, 18, 65), (11, -25, 0, 45, -60),
                                          (69, 0, -45, 24, -16))[module][control])
            pointer = builder.bevel_box(f'console {module} {control} inset pointer',
                                        (position + math.sin(pointer_angle) * .026, -.0545,
                                         -.010 + math.cos(pointer_angle) * .026),
                                        (.0035, .0015, .028), 'paper', .0003, 2)
            pointer.rotation_euler.y = pointer_angle
            for grip in range(18):
                angle = grip * math.tau / 18
                builder.cylinder(f'console {module} {control} grip flute {grip}',
                                 (position + math.cos(angle) * .048, -.031, -.010 + math.sin(angle) * .048),
                                 (position + math.cos(angle) * .048, -.051, -.010 + math.sin(angle) * .048), .0015, 'aluminum', 8)
            builder.text(f'console {module} {control} control legend', names[module][1][control],
                         (position, -.015, -.112), .020)
            builder.text(f'console {module} {control} scale endpoints', 'MIN        MAX',
                         (position, -.015, .098), .009)
            for tick in range(7):
                angle = math.radians(-135 + tick * 45)
                tick_x = position + math.sin(angle) * .071
                tick_z = -.010 + math.cos(angle) * .071
                line = builder.bevel_box(f'console {module} {control} graduated mark {tick}',
                                         (tick_x, -.015, tick_z), (.0025, .001, .009), 'ink', .0003, 2)
                line.rotation_euler.y = angle
        for corner in (-1, 1):
            for vertical in (-1, 1):
                builder.fastener(f'console {module} retaining screw {corner} {vertical}',
                                 (corner * (width / 2 - .024), -.013, vertical * .190), .0045)
        bpy.context.view_layer.update()
        placement = Matrix.Translation((horizontal, 11.5, .831)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
        for instance in builder.objects[start:]:
            instance.matrix_world = placement @ instance.matrix_world
    for button, label in enumerate(('ARM', 'AUX', 'HOLD', 'RCS', 'TRIM', 'COMM', 'NAV', 'ACK')):
        start = len(builder.objects)
        builder.ring(f'annunciator {button} molded button surround', (0, 0, 0),
                     .094, .143, .071, .121, .009, 'green')
        builder.text(f'annunciator {button} label', label, (0, -.006, -.092), .013)
        bpy.context.view_layer.update()
        placement = Matrix.Translation((-.72 + button * .205, 11.15, .820)) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
        for instance in builder.objects[start:]:
            instance.matrix_world = placement @ instance.matrix_world
    builder.area_light('instrument-panel broad reflected fill', (0, 10.70, 2.68),
                       (0, .55, -1), 2.2, .45, 36, '#d6e6ec')


def readable_screens(scene):
    adjusted = set()
    objects = 0
    for instance in scene.objects:
        if not instance.name.startswith(('NightWorld/instrument text', 'NightWorld/screen trace', 'NightWorld/screen fill')):
            continue
        if instance.hide_render or instance.type not in ('FONT', 'MESH', 'CURVE'):
            continue
        center, extent = world_bounds(instance)
        if not (6.8 < center.y < 12.2 and abs(center.x) < 3 and .7 < center.z < 2.3):
            continue
        for material in instance.data.materials:
            if not material or material in adjusted or not material.use_nodes:
                continue
            shader = material.node_tree.nodes.get('Principled BSDF')
            if shader and shader.inputs['Emission Strength'].default_value > 0:
                shader.inputs['Emission Strength'].default_value = 1.7
                shader.inputs['Roughness'].default_value = .42
                adjusted.add(material)
        objects += 1
    if objects < 10:
        raise RuntimeError('Expected exported cockpit screen content before emissive calibration')
    return {'screen_components': objects, 'materials': len(adjusted), 'emission_strength': 1.7}


def validate_lower_conduit_clearance(scene, builder):
    shells = [instance for instance in builder.objects if instance.get('hero_role', '').startswith('pressure shell bay')]
    backing = [instance for instance in builder.objects if instance.get('hero_role', '').startswith('continuous pressure shell joint backing')]
    targets = [instance for instance in builder.objects
               if any(role in instance.get('hero_role', '') for role in
                      ['connected lower conduit', 'lower distribution enclosure', 'lower conduit source gland', 'lower conduit destination gland'])]
    if len(shells) != 5 or len(backing) != 6 or len(targets) != 14:
        raise RuntimeError('Expected five pressure-shell bays, six sealed joints and fourteen lower conduit assembly objects')
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    surfaces = []
    for instance in shells + backing:
        evaluated = instance.evaluated_get(graph)
        geometry = evaluated.to_mesh()
        vertices = [evaluated.matrix_world @ vertex.co for vertex in geometry.vertices]
        polygons = [tuple(polygon.vertices) for polygon in geometry.polygons]
        surfaces.append(BVHTree.FromPolygons(vertices, polygons))
        evaluated.to_mesh_clear()
    report = []
    for instance in targets:
        minimum = math.inf
        for vertex in instance.data.vertices:
            world = instance.matrix_world @ vertex.co
            direction = Vector((1 if world.x > 0 else -1, 0, 0))
            distances = [result[3] for surface in surfaces
                         if (result := surface.ray_cast(world, direction, .5))[0] is not None]
            if not distances:
                raise RuntimeError(f'Lower conduit has no outward shell hit at {tuple(world)}: {instance.name}')
            minimum = min(minimum, min(distances))
        if minimum < .030:
            raise RuntimeError(f'{instance.name} actual shell clearance is only {minimum:.6f} m')
        instance['minimum_actual_shell_clearance'] = minimum
        report.append({'object': instance.name, 'minimum_actual_shell_clearance_metres': minimum})
    return report


def validate_equipment_sightlines(scene, builder, descriptor):
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    targets = [instance for instance in builder.objects if instance.type == 'MESH'
               and instance.get('hero_role', '').startswith(('environment ', 'avionics ', 'embedded systems ',
                                                              'flight console '))]
    vertices, polygons = [], []
    for instance in targets:
        evaluated = instance.evaluated_get(graph)
        geometry = evaluated.to_mesh()
        offset = len(vertices)
        vertices.extend(evaluated.matrix_world @ vertex.co for vertex in geometry.vertices)
        polygons.extend(tuple(offset + vertex for vertex in polygon.vertices) for polygon in geometry.polygons)
        evaluated.to_mesh_clear()
    if len(targets) < 100:
        raise RuntimeError('Expected independent life-support and avionics equipment meshes')
    surface = BVHTree.FromPolygons(vertices, polygons)
    position = descriptor['observation']['position']
    camera = Vector((position[0], -position[2], position[1]))
    basis = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    tested = 0
    displays = 0
    for display in descriptor['screens']:
        values = display['matrix']
        if -values[14] < 10:
            continue
        original = Matrix(tuple(tuple(values[column * 4 + row] for column in range(4)) for row in range(4)))
        transform = basis @ original @ basis.inverted()
        if abs(values[12]) > 2.3:
            transform.translation.x -= math.copysign(.20, values[12])
        displays += 1
        for column in range(25):
            for row in range(17):
                point = transform @ Vector(((column / 24 - .5) * (display['width'] - .008), -.016,
                                             (row / 16 - .5) * (display['height'] - .008)))
                ray = point - camera
                if surface.ray_cast(camera, ray.normalized(), ray.length - .001)[0] is not None:
                    raise RuntimeError(f'New systems equipment blocks display {displays} at {tuple(point)}')
                tested += 1
    if displays != 5:
        raise RuntimeError(f'Expected five cockpit display apertures, found {displays}')
    return {'equipment_meshes': len(targets), 'display_apertures': displays,
            'rays_tested': tested, 'blocked_rays': 0}


def refine(scene, descriptor):
    if descriptor.get('scene') != 'spaceship':
        return {'applied': False, 'reason': 'Not the spaceship descriptor.'}
    if bpy.data.collections.get(COLLECTION_NAME):
        raise RuntimeError('Cockpit hero refinement has already run for this Blender scene.')
    bpy.context.view_layer.update()
    displays = front_displays(descriptor)
    replacements = old_display_frames(scene, displays)
    structural = structural_replacements(scene)
    console_controls = legacy_console_controls(scene)
    controller_grips = legacy_controller_grips(scene)
    moved_displays = move_side_displays(scene, descriptor)
    screen_report = readable_screens(scene)
    builder = Assemblies(scene)
    for instance in replacements + structural + console_controls + controller_grips:
        instance.hide_render = True
        instance.hide_viewport = True
        instance['replaced_by'] = COLLECTION_NAME
    for index, display in enumerate(displays):
        instrument_assembly(builder, display, index)
    controller_report = []
    for side in [-1, 1]:
        controller_bellows(builder, side)
        controller_report.append(ergonomic_controller_grips(builder, side))
        side_service_assemblies(builder, side)
        embedded_equipment(builder, side)
    pressure_shell(builder)
    roof_supports = roof_cassette_supports(builder)
    console_structure = flight_console_structure(builder)
    rear_plaque = rear_vessel_plaque(builder)
    flight_seat(builder)
    thermal_lining(builder)
    environmental_hardware(builder)
    for side in (-1, 1):
        maintenance_panels(builder, side)
    console_instrument_groups(builder)
    controller_sightlines = validate_controller_sightlines(scene, builder, displays, descriptor)
    conduit_clearance = validate_lower_conduit_clearance(scene, builder)
    equipment_sightlines = validate_equipment_sightlines(scene, builder, descriptor)
    bpy.context.view_layer.update()
    mesh_objects = [instance for instance in builder.objects if instance.type == 'MESH']
    for instance in mesh_objects:
        physical_uv(instance)
        if not all(math.isfinite(value) for row in instance.matrix_world for value in row):
            raise RuntimeError(f'Non-finite refined transform: {instance.name}')
        if not all(math.isfinite(value) for vertex in instance.data.vertices for value in vertex.co):
            raise RuntimeError(f'Non-finite refined geometry: {instance.name}')
    triangles = sum(sum(max(0, len(polygon.vertices) - 2) for polygon in instance.data.polygons)
                    for instance in mesh_objects)
    report = {'applied': True, 'collection': COLLECTION_NAME, 'objects': len(builder.objects),
              'mesh_objects': len(mesh_objects), 'triangles': triangles,
              'replaced_legacy_frames': [instance.name for instance in replacements],
              'replaced_structure_count': len(structural),
              'replaced_console_controls': len(console_controls),
              'replaced_controller_grips': [instance.name for instance in controller_grips],
              'ergonomic_controllers': controller_report,
              'controller_display_sightlines': controller_sightlines,
              'replaced_structure': [instance.name for instance in structural],
              'translated_side_displays': moved_displays,
              'screen_readability': screen_report,
              'lower_conduit_shell_clearance': conduit_clearance,
              'equipment_display_sightlines': equipment_sightlines,
              'flight_console_structure': console_structure,
              'rear_vessel_plaque': rear_plaque,
              'roof_cassette_supports': roof_supports,
              'display_centers_blender': [list(display['position']) for display in displays],
              'preserved_apertures': [{'width': display['width'] - .008, 'height': display['height'] - .008}
                                      for display in displays],
              'coordinate_system': 'Blender x=Three x, y=-Three z, z=Three y'}
    scene['cockpit_refinement_report'] = json.dumps(report)
    print('COCKPIT_REFINEMENT', json.dumps(report), flush=True)
    return report
