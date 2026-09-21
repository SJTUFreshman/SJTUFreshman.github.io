"""Original expedition equipment and non-repeating offline summit outcrops."""
import math
import random

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


def _material(name, color, roughness, metallic=0, textile=False):
    material = bpy.data.materials.new('Refinement/summit ' + name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = color + (1,)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    if textile:
        geometry = nodes.new('ShaderNodeNewGeometry')
        wear = nodes.new('ShaderNodeTexNoise')
        wear.inputs['Scale'].default_value = 14
        wear.inputs['Detail'].default_value = 3
        links.new(geometry.outputs['Position'], wear.inputs['Vector'])
        fading = nodes.new('ShaderNodeValToRGB')
        fading.color_ramp.elements[0].color = tuple(channel * .72 for channel in color) + (1,)
        fading.color_ramp.elements[1].color = tuple(min(1, channel * 1.16) for channel in color) + (1,)
        links.new(wear.outputs['Fac'], fading.inputs['Fac'])
        links.new(fading.outputs['Color'], shader.inputs['Base Color'])
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 1250
        noise.inputs['Detail'].default_value = 2
        links.new(geometry.outputs['Position'], noise.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .27
        bump.inputs['Distance'].default_value = .0006
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], shader.inputs['Normal'])
        shader.inputs['Sheen Weight'].default_value = .16
    return material


class Equipment:
    def __init__(self, collection):
        self.collection = collection
        self.transform = Matrix.Translation((-6.8, -10, -.017)) @ Matrix.Rotation(-1.02, 4, 'Z')
        self.skin_meshes = []

    def mesh(self, name, vertices, faces, material, smooth=True):
        mesh = bpy.data.meshes.new('Refinement/' + name)
        mesh.from_pydata(vertices, [], faces)
        mesh.materials.append(material)
        mesh.update()
        for polygon in mesh.polygons:
            polygon.use_smooth = smooth
        instance = bpy.data.objects.new('Refinement/' + name, mesh)
        self.collection.objects.link(instance)
        instance.matrix_world = self.transform
        self.skin_meshes.append(mesh)
        return instance

    def tube(self, name, points, radius, material, closed=False):
        curve = bpy.data.curves.new('Refinement/' + name, 'CURVE')
        curve.dimensions = '3D'
        curve.resolution_u = 12
        curve.bevel_depth = radius
        curve.bevel_resolution = 3
        spline = curve.splines.new('POLY')
        spline.points.add(len(points) - 1)
        for target, source in zip(spline.points, points):
            target.co = tuple(source) + (1,)
        spline.use_cyclic_u = closed
        curve.materials.append(material)
        instance = bpy.data.objects.new('Refinement/' + name, curve)
        self.collection.objects.link(instance)
        instance.matrix_world = self.transform
        return instance

    def cushion(self, name, center, dimensions, material):
        vertices, faces = [], []
        segments, rings = 64, 32
        for ring in range(rings + 1):
            latitude = math.pi * ring / rings
            for segment in range(segments):
                longitude = math.tau * segment / segments
                values = (math.sin(latitude) * math.cos(longitude), math.sin(latitude) * math.sin(longitude), math.cos(latitude))
                gather = .0035 * math.sin(longitude * 7 + latitude * 2.3) * math.sin(latitude) ** 2
                vertices.append(tuple(center[axis] + math.copysign(abs(value) ** .68, value) * dimensions[axis] * .5
                                      + gather * value for axis, value in enumerate(values)))
        for ring in range(rings):
            for segment in range(segments):
                following = (segment + 1) % segments
                faces.append(((ring + 1) * segments + segment, (ring + 1) * segments + following,
                              ring * segments + following, ring * segments + segment))
        return self.mesh(name, vertices, faces, material)

    def build_skin(self):
        vertices, faces = [], []
        for mesh in self.skin_meshes:
            start = len(vertices)
            vertices.extend(tuple(vertex.co) for vertex in mesh.vertices)
            faces.extend(tuple(start + index for index in polygon.vertices) for polygon in mesh.polygons)
        self.skin = BVHTree.FromPolygons(vertices, faces)

    def surface(self, point, side=None, offset=.0015):
        horizontal, depth, height = point
        outward = Vector((0, side, 0)) if side else Vector((horizontal, depth, 0)).normalized()
        origin = Vector((horizontal, depth, height)) + outward * 3
        location, normal, face, distance = self.skin.ray_cast(origin, -outward, 6)
        if location is None:
            raise ValueError('Expedition accessory has no underlying fabric surface: ' + str(point))
        if normal.dot(outward) < 0:
            normal = -normal
        return tuple(location + normal * offset)

    def strap(self, name, points, width, material, width_axis=(1, 0, 0), projector=None):
        vertices, faces = [], []
        for index, point in enumerate(points):
            edge_points = [tuple(point[axis] + side * width_axis[axis] * width / 2 for axis in range(3))
                           for side in (-1, 1)]
            vertices.extend([projector(edge) if projector else edge for edge in edge_points])
            if index:
                faces.append((index * 2 - 2, index * 2 - 1, index * 2 + 1, index * 2))
        instance = self.mesh(name, vertices, faces, material)
        modifier = instance.modifiers.new('Real webbing thickness', 'SOLIDIFY')
        modifier.thickness = .0025
        return instance


def _replace_pack(scene, collection):
    originals = [instance for instance in scene.objects if instance.type == 'MESH'
                 and instance.name.startswith('NightWorld/mesh')
                 and -7.1 < instance.location.x < -6.1 and -10.4 < instance.location.y < -9.8
                 and len(instance.data.vertices) in (216, 24, 148)]
    if len(originals) != 5:
        raise ValueError('Expected five exact original expedition pack and pole pieces, got ' + str(len(originals)))
    for instance in originals:
        instance.hide_render = True
        instance['replaced_expedition_equipment'] = True
    orange = _material('sun-faded ripstop nylon', (.28, .075, .031), .79, textile=True)
    dark = _material('reinforced charcoal canvas', (.025, .032, .035), .91, textile=True)
    seam = _material('ochre bound seams', (.13, .043, .02), .92, textile=True)
    metal = _material('scratched anodized aluminium', (.24, .28, .29), .37, .75)
    rubber = _material('matte black molded hardware', (.015, .021, .022), .72)
    rope = _material('weathered climbing rope', (.46, .31, .11), .9, textile=True)
    maker = Equipment(collection)
    vertices, faces = [], []
    segments, rings = 96, 48
    def body_point(ring, segment):
        fraction, angle = ring / rings, segment / segments * math.tau
        bulge = .84 + .18 * math.sin(fraction * math.pi)
        pleat = (.009 * math.sin(angle * 9 + fraction * 10)
                 + .004 * math.sin(angle * 17 - fraction * 24)) * math.sin(fraction * math.pi) ** 2
        horizontal = math.copysign(abs(math.cos(angle)) ** .66, math.cos(angle)) * (.255 * bulge + pleat)
        depth = math.copysign(abs(math.sin(angle)) ** .71, math.sin(angle)) * (.18 * bulge + pleat)
        return (horizontal + .025 * fraction ** 2, depth - .017 * fraction, .045 + fraction * .665)
    for ring in range(rings + 1):
        for segment in range(segments):
            vertices.append(body_point(ring, segment))
    for ring in range(rings):
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((ring * segments + segment, ring * segments + following,
                          (ring + 1) * segments + following, (ring + 1) * segments + segment))
    faces.extend([tuple(reversed(range(segments))), tuple(rings * segments + segment for segment in range(segments))])
    maker.mesh('tailored alpine rucksack body', vertices, faces, orange)
    maker.cushion('abrasion-resistant pack base', (0, 0, .077), (.48, .36, .12), dark)
    maker.cushion('overstuffed roll-top lid', (.025, -.014, .714), (.48, .365, .15), orange)
    maker.cushion('gusseted front pocket', (.006, .206, .35), (.405, .13, .37), orange)
    maker.build_skin()
    for segment in (5, 43, 53, 91):
        maker.tube('bound vertical pack seam', [body_point(ring, segment) for ring in range(rings + 1)], .0029, seam)
    for side in (-1, 1):
        for elevation in (.27, .5):
            maker.strap('compression webbing', [(side * .25 * math.cos(-.62 + step / 40 * 1.85),
                        .25 * math.sin(-.62 + step / 40 * 1.85), elevation) for step in range(41)],
                        .025, dark, (0, 0, 1), maker.surface)
        strap_x = side * .125
        def shoulder_surface(point):
            horizontal, depth, height = maker.surface(point, -1)
            fraction = max(0, min(1, (.645 - height) / .49))
            return (horizontal, depth - .10 * math.sin(fraction * math.pi) ** 1.2, height)
        maker.strap('shaped padded shoulder harness', [(strap_x + side * .065 * math.sin(step / 40 * math.pi),
                     -.177, .645 - step / 40 * .49) for step in range(41)], .055, dark, projector=shoulder_surface)
        maker.strap('lid fastening strap', [(strap_x, .2, .72 - step / 60 * .31)
                                           for step in range(61)], .024, dark, projector=lambda point: maker.surface(point, 1))
        maker.tube('rectangular side-release buckle', [maker.surface(point, 1, .006) for point in
                   [(strap_x - .020, .255, .455), (strap_x + .020, .255, .455),
                    (strap_x + .020, .255, .410), (strap_x - .020, .255, .410)]], .005, rubber, True)
        maker.tube('front pocket zipper pull', [maker.surface(point, 1, .004 + index * .003) for index, point in enumerate(
                   [(side * .05, .273, .51), (side * .05 + .016, .284, .497),
                    (side * .05 + .009, .283, .484)])], .003, metal)
    maker.tube('woven top carrying loop', [(-.072 + step / 30 * .144, -.046, .79 + .045 * math.sin(step / 30 * math.pi))
                                         for step in range(31)], .0065, dark)
    maker.tube('front pocket waterproof zipper', [maker.surface((-.17 + step / 70 * .34, .271,
               .48 + .03 * math.sin(step / 70 * math.pi)), 1, .002) for step in range(71)], .0028, rubber)
    maker.tube('telescopic trekking pole shaft', [(.37, .12, .023), (.43, .1, .50), (.49, .07, .94)], .007, metal)
    maker.tube('textured trekking pole grip', [(.49, .07, .94), (.50, .067, 1.10)], .016, dark)
    maker.tube('hanging pole wrist loop', [(.50, .067, 1.09), (.565, .07, 1.04), (.56, .06, .92), (.493, .067, .98)], .005, dark)
    maker.tube('snow basket', [(.379 + .041 * math.cos(step / 48 * math.tau), .118 + .041 * math.sin(step / 48 * math.tau), .084)
                              for step in range(48)], .0035, rubber, True)
    for strand in range(8):
        maker.tube('coiled expedition rope', [(.36 + (.105 + strand * .002) * math.cos(step / 160 * math.tau),
                   -.26 + (.15 + strand * .001) * math.sin(step / 160 * math.tau),
                   .0263 + strand * .008 + .004 * math.sin(step / 160 * math.tau * 3)) for step in range(160)], .0053, rope, True)
    maker.tube('loose rope tail', [(.36, -.40, .032), (.18, -.47, .0223), (.055, -.40, .0223), (-.1, -.44, .0223)], .0053, rope)
    return len(originals)


def _outcrops(scene, descriptor):
    assets = [asset for asset in descriptor.get('assets', []) if asset['id'] == 'rock_07']
    candidates = [instance for instance in scene.objects if instance.type == 'MESH'
                  and len(instance.data.vertices) == 7914
                  and any(material and material.name.startswith('Refinement/dry exposed summit rock') for material in instance.data.materials)]
    if len(candidates) != len(assets):
        raise ValueError('Exact dry summit rock set missing before silhouette refinement')
    retain = {0, 2, 3, 6, 8, 11, 13, 16, 18, 20}
    for index, asset in enumerate(assets):
        center = Vector((asset['matrix'][12], -asset['matrix'][14], 0))
        def match_score(instance):
            corners = [instance.matrix_world @ Vector(point) for point in instance.bound_box]
            low = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
            high = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
            midpoint = (low + high) * .5
            height = asset['options']['height']
            if abs(high.z - low.z - height) > .003:
                return float('inf')
            return math.hypot(midpoint.x - center.x, midpoint.y - center.y)
        matches = [instance for instance in candidates if match_score(instance) < asset['options']['height'] * .55]
        if len(matches) != 1:
            raise ValueError('Rock bounds differ from descriptor; refusing unmatched reshaping')
        instance = matches[0]
        candidates.remove(instance)
        if index not in retain:
            instance.hide_render = True
            instance['summit_outcrop_repetition_removed'] = True
            continue
        generator = random.Random(99810 + index)
        mesh = instance.data.copy()
        matrix = instance.matrix_world.copy()
        world = [matrix @ vertex.co for vertex in mesh.vertices]
        base = min(point.z for point in world)
        height = max(point.z for point in world) - base
        scale_x, scale_y, scale_z = generator.uniform(.8, 1.18), generator.uniform(.60, 1.15), generator.uniform(.60, .94)
        bury = generator.uniform(.055, .15)
        tilt_x, tilt_y = generator.uniform(-.13, .13), generator.uniform(-.12, .12)
        for vertex, point in zip(mesh.vertices, world):
            relative = point - center
            normalized = (point.z - base) / max(.1, height)
            warp = 1 + .10 * math.sin(relative.x * 2.6 + index) * math.sin(relative.y * 2.2 + normalized * 2)
            vertex.co = (center.x + relative.x * scale_x * warp,
                         center.y + relative.y * scale_y * warp,
                         base + (point.z - base) * scale_z + relative.x * tilt_x + relative.y * tilt_y - bury)
        mesh.update()
        mesh.normals_split_custom_set_from_vertices([(0, 0, 0)] * len(mesh.vertices))
        instance.data = mesh
        instance.matrix_world = Matrix.Identity(4)
        instance['unique_eroded_summit_outcrop'] = index
    patches = [instance for instance in scene.objects if instance.type == 'MESH'
               and instance.name.startswith('NightWorld/mesh') and len(instance.data.vertices) == 693]
    if len(patches) != 7:
        raise ValueError('Expected seven legacy oval snow pads')
    for instance in patches:
        instance.hide_render = True
    return {'original_rocks': len(assets), 'retained_unique_outcrops': len(retain), 'oval_snow_pads_removed': len(patches)}


def _summit_fixed_line(scene, collection):
    originals = [instance for instance in scene.objects if instance.type == 'MESH'
                 and instance.name.startswith('NightWorld/mesh')
                 and (len(instance.data.vertices) == 91
                      or (len(instance.data.vertices) == 148 and 11.8 < abs(instance.location.x) < 13.1))]
    if len(originals) != 22:
        raise ValueError('Expected twelve proxy rail posts and ten uniform rail spans')
    for instance in originals:
        instance.hide_render = True
        instance['replaced_summit_railing'] = True
    equipment = Equipment(collection)
    equipment.transform = Matrix.Identity(4)
    metal = _material('weathered fixed-line ice screws', (.18, .20, .19), .51, .67)
    line = _material('faded fixed-line braid', (.15, .12, .063), .91, textile=True)
    anchors = [(-12.6, 1.4, .91), (-13.1, -2.3, .72), (-12.8, -7.1, .83),
               (-13.2, -11.6, .67), (-12.3, -17.2, .78)]
    line_points = []
    for index, (east, north, height) in enumerate(anchors):
        lean = (-.035 if index % 2 else .026, .023)
        equipment.tube('fixed-line anchor ' + str(index), [(east, north, -.11), (east + lean[0], north + lean[1], height)], .018, metal)
        eye = [(east + lean[0] + .038 * math.cos(step / 32 * math.tau), north + lean[1],
                height - .025 + .038 * math.sin(step / 32 * math.tau)) for step in range(32)]
        equipment.tube('closed anchor eye ' + str(index), eye, .005, metal, True)
        line_points.append((east + lean[0], north + lean[1], height - .025))
        loop = [(east + lean[0] + .031 * math.cos(step / 48 * math.tau),
                 north + lean[1] + .013 * math.sin(step / 48 * math.tau),
                 height - .054 + .023 * math.sin(step / 48 * math.tau)) for step in range(48)]
        equipment.tube('fixed line anchor hitch ' + str(index), loop, .008, line, True)
    for index, (first, second) in enumerate(zip(line_points[:-1], line_points[1:])):
        points = []
        for step in range(65):
            fraction = step / 64
            east = first[0] * (1 - fraction) + second[0] * fraction
            north = first[1] * (1 - fraction) + second[1] * fraction
            height = first[2] * (1 - fraction) + second[2] * fraction
            height -= (.16 + index * .015) * math.sin(fraction * math.pi)
            points.append((east, north, height))
        equipment.tube('irregular alpine fixed line ' + str(index), points, .008, line)
    return {'uniform_parts_removed': len(originals), 'new_anchors': len(anchors), 'outside_walk_bounds': True}


def refine(scene, descriptor):
    if descriptor.get('scene') != 'snowmountain':
        return {'skipped': True}
    collection = bpy.data.collections.new('NightWorld/offline summit equipment')
    scene.collection.children.link(collection)
    result = _outcrops(scene, descriptor)
    result['replaced_pack_parts'] = _replace_pack(scene, collection)
    result['summit_fixed_line'] = _summit_fixed_line(scene, collection)
    result['new_equipment_objects'] = len(collection.objects)
    print('SUMMIT_EQUIPMENT_REFINEMENT', result)
    return result
