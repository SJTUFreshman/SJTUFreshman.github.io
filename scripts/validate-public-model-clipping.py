"""Check world-space mountain clipping in a disposable Blender Slurm process."""
import json
import math
import os
from pathlib import Path
import runpy
import tempfile
import unittest

import bpy
from mathutils import Euler, Matrix, Vector


CLIP = runpy.run_path(str(Path(__file__).with_name('render-public-model-study.py')))['clip_meshes_above']
CASTLE = runpy.run_path(str(Path(__file__).with_name('filter-hohenzollern-skirt.py')))
TOLERANCE = 5e-5
VERTICES = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
            (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def transform(translation=(0, 0, 0), rotation=(0, 0, 0), scale=(1, 1, 1)):
    return (Matrix.Translation(Vector(translation))
            @ Euler(rotation).to_matrix().to_4x4()
            @ Matrix.Diagonal((*scale, 1)))


def expected_uv(position, face_index):
    return Vector((face_index * 2 + 1.7 + .25 * position.x - .4 * position.y + .15 * position.z,
                   -face_index * 3 - .2 + .35 * position.x + .2 * position.y + .1 * position.z))


def clipped_polygon(points, threshold):
    retained = []
    for previous, current in zip(points[-1:] + points[:-1], points):
        previous_inside = previous.z >= threshold
        current_inside = current.z >= threshold
        if previous_inside != current_inside:
            fraction = (threshold - previous.z) / (current.z - previous.z)
            retained.append(previous.lerp(current, fraction))
        if current_inside:
            retained.append(current.copy())
    return retained


def polygon_area(points):
    origin = points[0]
    return sum((points[index] - origin).cross(points[index + 1] - origin).length * .5
               for index in range(1, len(points) - 1))


class MountainClippingTests(unittest.TestCase):
    def setUp(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)

    def make_cube(self, parent_matrix=None, local_matrix=None):
        mesh = bpy.data.meshes.new('Clipping regression mesh')
        mesh.from_pydata(VERTICES, [], FACES)
        instance = bpy.data.objects.new('Clipping regression cube', mesh)
        bpy.context.collection.objects.link(instance)
        if parent_matrix is not None:
            parent = bpy.data.objects.new('Clipping regression parent', None)
            bpy.context.collection.objects.link(parent)
            parent.matrix_world = parent_matrix
            instance.parent = parent
        instance.matrix_basis = local_matrix if local_matrix is not None else Matrix.Identity(4)
        bpy.context.view_layer.update()
        uv_layer = mesh.uv_layers.new(name='Seamed source UV')
        for polygon in mesh.polygons:
            mesh.materials.append(bpy.data.materials.new(f'Source face {polygon.index}'))
            polygon.material_index = polygon.index
            for loop_index in polygon.loop_indices:
                vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
                position = instance.matrix_world @ vertex.co
                uv_layer.data[loop_index].uv = expected_uv(position, polygon.index)
        mesh.update()
        return instance

    def assert_vector_close(self, actual, expected):
        self.assertLessEqual((actual - expected).length, TOLERANCE,
                             f'{tuple(actual)} differs from {tuple(expected)}')

    def check_clip(self, instance, threshold, intersects=True):
        original_matrix = instance.matrix_world.copy()
        original_materials = list(instance.data.materials)
        expected = {}
        for polygon in instance.data.polygons:
            points = [instance.matrix_world @ instance.data.vertices[index].co
                      for index in polygon.vertices]
            points = clipped_polygon(points, threshold)
            if len(points) >= 3:
                expected[polygon.material_index] = points
        self.assertTrue(expected)
        CLIP([instance, instance.parent] if instance.parent else [instance], threshold)
        self.assertGreater(len(instance.data.polygons), 0)
        self.assertEqual(len(instance.data.polygons), len(expected))
        self.assertEqual(list(instance.data.materials), original_materials)
        self.assertEqual([layer.name for layer in instance.data.uv_layers], ['Seamed source UV'])
        for row_index in range(4):
            self.assert_vector_close(instance.matrix_world[row_index], original_matrix[row_index])
        positions = [instance.matrix_world @ vertex.co for vertex in instance.data.vertices]
        self.assertGreaterEqual(min(position.z for position in positions), threshold - TOLERANCE)
        if intersects:
            self.assertAlmostEqual(min(position.z for position in positions), threshold,
                                   delta=TOLERANCE)
        uv_layer = instance.data.uv_layers['Seamed source UV']
        visited_faces = set()
        for polygon in instance.data.polygons:
            face_index = polygon.material_index
            self.assertIn(face_index, expected)
            self.assertNotIn(face_index, visited_faces)
            visited_faces.add(face_index)
            points = [instance.matrix_world @ instance.data.vertices[index].co
                      for index in polygon.vertices]
            self.assertEqual(len(points), len(expected[face_index]))
            for point in points:
                self.assertLessEqual(min((point - candidate).length
                                         for candidate in expected[face_index]), TOLERANCE)
            self.assertAlmostEqual(polygon_area(points), polygon_area(expected[face_index]),
                                   delta=TOLERANCE * max(1, polygon_area(expected[face_index])))
            for loop_index in polygon.loop_indices:
                vertex = instance.data.vertices[instance.data.loops[loop_index].vertex_index]
                position = instance.matrix_world @ vertex.co
                self.assert_vector_close(uv_layer.data[loop_index].uv,
                                         expected_uv(position, face_index))

    def test_world_halfspace_and_uv_under_transformations(self):
        cases = [
            ('identity', Matrix.Identity(4), Matrix.Identity(4)),
            ('translation', transform((8, -3, 4)), transform((-.4, .9, -1.1))),
            ('rotated_parent', transform((8, -3, 4), (.37, -.61, .52)),
             transform((-.4, .9, -1.1), (.21, .46, -.31))),
            ('nonuniform_parent', transform((8, -3, 4), (.37, -.61, .52), (1.6, .7, 2.3)),
             transform((-.4, .9, -1.1), (.21, .46, -.31), (.8, 1.4, .55))),
            ('negative_parent', transform((-5, 7, -2), (.48, .73, -.29), (-1.2, 2, .6)),
             transform((1.3, -.6, 2.1), (-.34, .56, .41), (.7, 1.5, 1.1))),
            ('negative_child', transform((3, -8, 6), (-.62, .17, .93), (1.4, .8, 1.9)),
             transform((-.8, 1.2, -.5), (.28, -.49, .65), (1.3, -.9, .6))),
        ]
        for name, parent_matrix, local_matrix in cases:
            with self.subTest(transform=name):
                instance = self.make_cube(parent_matrix, local_matrix)
                heights = [(instance.matrix_world @ vertex.co).z for vertex in instance.data.vertices]
                threshold = min(heights) + .43 * (max(heights) - min(heights))
                self.check_clip(instance, threshold)

    def test_entirely_above_plane_preserves_geometry_and_uv(self):
        instance = self.make_cube(transform((3, -4, 8), (.3, -.7, .6), (-.8, 1.3, 1.7)))
        minimum = min((instance.matrix_world @ vertex.co).z for vertex in instance.data.vertices)
        self.check_clip(instance, minimum - 1, intersects=False)

    def test_entirely_below_plane_raises(self):
        instance = self.make_cube(transform((3, -4, 8), (.3, -.7, .6), (-.8, 1.3, 1.7)))
        maximum = max((instance.matrix_world @ vertex.co).z for vertex in instance.data.vertices)
        with self.assertRaisesRegex(ValueError, 'all source faces'):
            CLIP([instance], maximum + 1)
        self.assertEqual(len(instance.data.polygons), 0)

    def test_empty_member_does_not_discard_retained_member(self):
        lower = self.make_cube(local_matrix=transform((0, 0, -4)))
        upper = self.make_cube(local_matrix=transform((0, 0, 4)))
        CLIP([lower, upper], 0)
        self.assertEqual(len(lower.data.polygons), 0)
        self.assertEqual(len(upper.data.polygons), 6)
        self.assertGreaterEqual(min(vertex.co.z + upper.location.z
                                    for vertex in upper.data.vertices), 0)

    def test_nonfinite_threshold_is_rejected(self):
        for threshold in (math.nan, math.inf, -math.inf):
            with self.subTest(threshold=threshold):
                instance = self.make_cube()
                with self.assertRaisesRegex(ValueError, 'Invalid clip_below_z'):
                    CLIP([instance], threshold)
                self.assertEqual(len(instance.data.polygons), 6)

    def test_castle_cut_boundary_matches_transformed_world_intersections(self):
        cases = [
            (Matrix.Identity(4), Matrix.Identity(4)),
            (transform((8, -3, 4), (.37, -.61, .52), (1.6, .7, 2.3)),
             transform((-.4, .9, -1.1), (.21, .46, -.31), (.8, 1.4, .55))),
            (transform((-5, 7, -2), (.48, .73, -.29), (-1.2, 2, .6)),
             transform((1.3, -.6, 2.1), (-.34, .56, .41), (.7, 1.5, 1.1))),
        ]
        for parent_matrix, local_matrix in cases:
            with self.subTest(parent_matrix=tuple(parent_matrix)):
                instance = self.make_cube(parent_matrix, local_matrix)
                world = [instance.matrix_world @ vertex.co for vertex in instance.data.vertices]
                threshold = min(point.z for point in world) + .43 * (max(point.z for point in world)
                                                                     - min(point.z for point in world))
                expected = []
                for polygon in instance.data.polygons:
                    expected.extend(point for point in clipped_polygon([world[index] for index in polygon.vertices],
                                                                        threshold)
                                    if abs(point.z - threshold) < TOLERANCE)
                mesh, loops, report = CASTLE['_clip_boundary'](instance, threshold)
                try:
                    self.assertEqual(len(loops), 1)
                    self.assertEqual(report['retained_source_open_edges'], 0)
                    self.assertTrue(report['all_cut_boundary_edges_consumed'])
                    self.assertEqual(sum(len(loop) for loop in loops), report['cut_boundary_edges'])
                    self.assertGreaterEqual(min((instance.matrix_world @ vertex.co).z for vertex in mesh.verts),
                                            threshold - TOLERANCE)
                    for point in loops[0]:
                        self.assertAlmostEqual(point[2], threshold, delta=TOLERANCE)
                        self.assertLessEqual(min((Vector(point) - candidate).length for candidate in expected),
                                             TOLERANCE)
                    for point in expected:
                        self.assertLessEqual(min((point - Vector(candidate)).length for candidate in loops[0]),
                                             TOLERANCE)
                    self.assertEqual(len(instance.data.polygons), 6)
                finally:
                    mesh.free()

    def test_castle_closed_component_cannot_hide_open_or_branch_component(self):
        points = {0: (0, 0, 0), 1: (2, 0, 0), 2: (2, 2, 0), 3: (0, 2, 0),
                  4: (5, 0, 0), 5: (6, 0, 0), 6: (6, 1, 0), 7: (7, 0, 0)}
        closed = [(0, 1), (1, 2), (2, 3), (3, 0)]
        for remainder in ([(4, 5)], [(4, 5), (5, 6), (6, 4), (5, 7)]):
            with self.subTest(remainder=remainder):
                with self.assertRaisesRegex(ValueError, 'open or branched'):
                    CASTLE['_boundary_loops'](points, closed + remainder)
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            CASTLE['_boundary_loops'](points, closed + [(1, 0)])

    def test_castle_multiple_loops_account_for_every_edge(self):
        points = {0: (0, 0, 0), 1: (2, 0, 0), 2: (2, 2, 0), 3: (0, 2, 0),
                  4: (5, 0, 0), 5: (6, 0, 0), 6: (6, 1, 0)}
        edges = [(1, 0), (4, 5), (2, 1), (5, 6), (3, 2), (6, 4), (0, 3)]
        loops = CASTLE['_boundary_loops'](points, edges)
        self.assertEqual(sorted(map(len, loops)), [3, 4])
        self.assertEqual(sum(map(len, loops)), len(edges))
        self.assertEqual({point for loop in loops for point in loop}, set(points.values()))

    def test_castle_actual_open_cut_is_rejected_without_mutating_source(self):
        instance = self.make_cube()
        instance.data.clear_geometry()
        instance.data.from_pydata(VERTICES, [], FACES[:-1])
        with self.assertRaisesRegex(ValueError, 'open or branched'):
            CASTLE['_clip_boundary'](instance, 0)
        self.assertEqual(len(instance.data.polygons), 5)
        self.assertEqual(min(vertex.co.z for vertex in instance.data.vertices), -1)

    def test_castle_source_holes_are_reported_separately_from_cut_loops(self):
        instance = self.make_cube()
        instance.data.clear_geometry()
        instance.data.from_pydata(VERTICES, [], [face for index, face in enumerate(FACES) if index != 1])
        mesh, loops, report = CASTLE['_clip_boundary'](instance, 0)
        try:
            self.assertEqual(len(loops), 1)
            self.assertEqual(report['cut_boundary_edges'], 4)
            self.assertEqual(report['retained_source_open_edges'], 4)
        finally:
            mesh.free()

    def test_castle_empty_cut_and_obsolete_options_leave_source_unchanged(self):
        instance = self.make_cube()
        with self.assertRaisesRegex(ValueError, 'all source faces'):
            CASTLE['_clip_boundary'](instance, 2)
        with self.assertRaisesRegex(ValueError, 'no real'):
            CASTLE['apply']({instance}, {'clip_source_below_z': -2, 'lower_z': -3})
        with self.assertRaisesRegex(ValueError, 'Obsolete'):
            CASTLE['apply']({instance}, {'clip_source_below_z': 0, 'segments': 96})
        self.assertEqual(len(instance.data.polygons), 6)
        self.assertEqual(min(vertex.co.z for vertex in instance.data.vertices), -1)

    def test_castle_diagnostic_uvs_share_normal_map_and_physical_scale(self):
        instance = self.make_cube()
        objects = {instance}
        with tempfile.TemporaryDirectory(prefix='life-castle-boundary-') as directory:
            image_paths = {}
            for name, color in [('diffuse', (.4, .3, .2, 1)), ('normal', (.5, .5, 1, 1))]:
                image = bpy.data.images.new(f'Boundary test {name}', width=2, height=2)
                image.pixels = color * 4
                image.file_format = 'PNG'
                image.filepath_raw = str(Path(directory) / f'{name}.png')
                image.save()
                image_paths[name] = image.filepath_raw
            report = CASTLE['apply'](objects, {'clip_source_below_z': 0, 'lower_z': -2,
                                              'texture_tile_size': 2, **image_paths})
            walls = next(item for item in objects if item != instance)
            self.assertEqual(report['real_boundary_edges'], 4)
            self.assertEqual(report['diagnostic_bottom_open_edges'], 4)
            self.assertEqual(report['retained_source_open_edges'], 0)
            self.assertEqual(report['top_caps_added'], 0)
            self.assertFalse(report['source_surface_closed'])
            self.assertFalse(report['photographic_acceptance'])
            self.assertEqual(len(walls.data.polygons), 4)
            uv_name = CASTLE['UV_NAME']
            uv_layer = walls.data.uv_layers[uv_name]
            nodes = walls.data.materials[0].node_tree.nodes
            self.assertEqual([node.uv_map for node in nodes if node.type == 'NORMAL_MAP'], [uv_name])
            self.assertEqual([node.uv_map for node in nodes if node.type == 'UVMAP'], [uv_name])
            for polygon in walls.data.polygons:
                self.assertAlmostEqual(polygon.normal.z, 0, delta=TOLERANCE)
                coordinates = [uv_layer.data[index].uv for index in polygon.loop_indices]
                self.assertAlmostEqual(max(point.x for point in coordinates) - min(point.x for point in coordinates),
                                       1, delta=TOLERANCE)
                self.assertAlmostEqual(max(point.y for point in coordinates) - min(point.y for point in coordinates),
                                       1, delta=TOLERANCE)


if __name__ == '__main__':
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('Run this Blender regression in a Slurm compute allocation')
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(MountainClippingTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print('PUBLIC_MODEL_CLIPPING_REGRESSION', json.dumps({
        'job_id': os.environ['SLURM_JOB_ID'],
        'blender_version': bpy.app.version_string,
        'tests_run': result.testsRun,
        'failures': len(result.failures),
        'errors': len(result.errors),
        'passed': result.wasSuccessful(),
        'renders_performed': False,
    }), flush=True)
    if not result.wasSuccessful():
        raise RuntimeError('World-space public model clipping regression failed')
