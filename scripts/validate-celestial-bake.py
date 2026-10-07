import importlib.util
import contextlib
import io
import math
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch


SOURCE = Path(__file__).with_name('render-celestial-model.py')
SPEC = importlib.util.spec_from_file_location('celestial_bake', SOURCE)
BAKE = importlib.util.module_from_spec(SPEC)
with patch.dict(sys.modules, {'bpy': Mock(), 'mathutils': Mock()}):
    SPEC.loader.exec_module(BAKE)


class FrameSelectionTests(unittest.TestCase):
    def test_climate_report_files_never_overwrite_other_times_or_static_reports(self):
        args = SimpleNamespace(frames=[(3, 0)], climate_time=None, climate_time_pad=3)
        output = Path('earth')
        static = BAKE.render_report_path(output, args)
        self.assertEqual(static, output / 'render-3-0.json')
        reports = {static}
        for time_index in range(8):
            args.climate_time = time_index
            report = BAKE.render_report_path(output, args)
            self.assertTrue(report.match('render*.json'))
            reports.add(report)
        self.assertEqual(len(reports), 9)
        self.assertIn(output / 'render-t007-3-0.json', reports)

    def test_climate_directories_and_reports_respect_time_padding(self):
        for padding, expected in ((0, 't7'), (1, 't7'), (3, 't007'), (6, 't000007')):
            with self.subTest(padding=padding):
                self.assertEqual(BAKE.climate_time_directory(7, padding), expected)
                args = SimpleNamespace(frames=[(3, 0)], climate_time=7, climate_time_pad=padding)
                self.assertEqual(BAKE.render_report_path(Path('earth'), args), Path('earth') / f'render-{expected}-3-0.json')

    def test_resolution_tier_flag_is_explicit_and_validated(self):
        with patch.object(BAKE.sys, 'argv', ['blender', '--', '--models', 'models', '--body', 'saturn', '--output', 'out', '--tier', '8k']):
            args = BAKE.arguments()
        self.assertEqual(args.tier, '8k')
        with patch.object(BAKE.sys, 'argv', ['blender', '--', '--models', 'models', '--body', 'saturn', '--output', 'out', '--tier', '5k']), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                BAKE.arguments()

    def test_dense_sample_selects_real_neighboring_angles(self):
        frames = BAKE.parse_frame_selection('3:0-239', 7, 90000)
        self.assertEqual(frames[0], (3, 0))
        self.assertEqual(frames[-1], (3, 239))
        self.assertEqual(len(frames), 240)
        self.assertAlmostEqual(360 / 90000 * 60, 0.24)

    def test_out_of_grid_and_overlapping_samples_fail(self):
        for selection in ('3:2-1', '3:0-2,3:2', '7:0', '0:180', '-1:0'):
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                BAKE.parse_frame_selection(selection, 7, 180)


class FullSphereFramingTests(unittest.TestCase):
    def test_complete_globe_and_rings_fit_all_aspect_ratios(self):
        for width, height in ((4096, 4096), (3840, 2160), (2160, 3840), (5120, 1440)):
            for extent in (1.026, 2.4):
                with self.subTest(width=width, height=height, extent=extent):
                    scale, rect = BAKE.full_sphere_projection(1, extent, width, height, 0.06)
                    radius_x = extent / scale
                    radius_y = radius_x * width / height
                    self.assertGreaterEqual(0.5 - radius_x, 0.06 - 1e-12)
                    self.assertGreaterEqual(0.5 - radius_y, 0.06 - 1e-12)
                    self.assertAlmostEqual(rect['width'] * width, rect['height'] * height)
                    self.assertAlmostEqual(rect['x'] + rect['width'] / 2, 0.5)
                    self.assertAlmostEqual(rect['y'] + rect['height'] / 2, 0.5)

    def test_invalid_geometry_is_rejected(self):
        for radius, extent in ((0, 1), (2, 1), (math.nan, 1)):
            with self.subTest(radius=radius, extent=extent), self.assertRaises(ValueError):
                BAKE.full_sphere_projection(radius, extent, 4096, 4096, 0.06)

    def test_independent_surface_keeps_ring_world_scale(self):
        surface_scale, surface_rect, ring_scale, ring_rect = BAKE.full_sphere_layer_projections(
            1, 1.026, 2.4, 4096, 4096, 0.06)
        self.assertGreater(surface_rect['width'], ring_rect['width'] * 2)
        self.assertAlmostEqual(surface_scale * surface_rect['width'], 2)
        self.assertAlmostEqual(ring_scale * ring_rect['width'], 2)
        self.assertAlmostEqual(surface_scale * surface_rect['width'] / ring_rect['width'], ring_scale)
        self.assertGreaterEqual(ring_rect['x'], 0)
        self.assertLessEqual(ring_rect['x'] + ring_rect['width'], 1)
        original_scale, original_rect = BAKE.full_sphere_projection(1, 2.4, 4096, 4096, 0.06)
        self.assertEqual((ring_scale, ring_rect), (original_scale, original_rect))

    def test_camera_ignores_rings_only_when_independent_mode_is_enabled(self):
        primary, atmosphere, ring = [Mock(type='MESH', hide_render=False) for _ in range(3)]
        scene = SimpleNamespace(objects=[primary, atmosphere, ring])
        radii = {primary: 1, atmosphere: 1.026, ring: 2.4}
        args = SimpleNamespace(width=4096, height=4096, frame_margin=0.06, independent_ring_framing=False)
        camera = MagicMock()
        camera.data.clip_end = 1000
        center = MagicMock()
        with patch.object(BAKE, 'geometry_radius', side_effect=lambda obj, origin: radii[obj]), patch.object(BAKE, 'Vector', MagicMock()):
            legacy = BAKE.frame_full_sphere(scene, camera, primary, center, args, [ring])
            legacy_scale = camera.data.ortho_scale
            args.independent_ring_framing = True
            independent = BAKE.frame_full_sphere(scene, camera, primary, center, args, [ring])
        self.assertNotIn('ringSphereRect', legacy)
        self.assertEqual(independent['ringSphereRect'], legacy['sphereRect'])
        self.assertLess(camera.data.ortho_scale, legacy_scale / 2)
        self.assertGreater(independent['sphereRect']['width'], legacy['sphereRect']['width'] * 2)


class RenderLayerTests(unittest.TestCase):
    def test_cloud_texture_replacement_preserves_unrelated_texture_nodes(self):
        unrelated = SimpleNamespace(type='TEX_IMAGE', name='Albedo', image=SimpleNamespace(
            name='Earth color map.png', filepath='//Textures/Earth color map.png'))
        cloud = SimpleNamespace(type='TEX_IMAGE', name='Cloud density', image=SimpleNamespace(
            name='Earth clouds B map.png', filepath='//Textures/Earth clouds B map.png',
            colorspace_settings=SimpleNamespace(name='sRGB')))
        material = SimpleNamespace(use_nodes=True, node_tree=Mock(nodes=[unrelated, cloud]))
        mesh = SimpleNamespace(data=SimpleNamespace(materials=[material]))
        replacement = SimpleNamespace(colorspace_settings=SimpleNamespace(name='sRGB'))
        image_api = SimpleNamespace(load=Mock(return_value=replacement), remove=Mock())
        with patch.object(Path, 'is_file', return_value=True), patch.object(BAKE, 'bpy', SimpleNamespace(data=SimpleNamespace(images=image_api))):
            result = BAKE.replace_cloud_textures([mesh], Path('clouds.png'))
        self.assertIs(result, replacement)
        self.assertEqual(unrelated.image.name, 'Earth color map.png')
        self.assertIs(cloud.image, replacement)
        self.assertEqual(replacement.colorspace_settings.name, 'sRGB')

    def test_cloud_texture_replacement_requires_a_cloud_image_node(self):
        unrelated = SimpleNamespace(type='TEX_IMAGE', name='Albedo', image=SimpleNamespace(
            name='Earth color map.png', filepath='//Textures/Earth color map.png'))
        material = SimpleNamespace(use_nodes=True, node_tree=Mock(nodes=[unrelated]))
        mesh = SimpleNamespace(data=SimpleNamespace(materials=[material]))
        replacement = SimpleNamespace(colorspace_settings=SimpleNamespace(name='sRGB'))
        image_api = SimpleNamespace(load=Mock(return_value=replacement), remove=Mock())
        with patch.object(Path, 'is_file', return_value=True), patch.object(BAKE, 'bpy', SimpleNamespace(data=SimpleNamespace(images=image_api))):
            with self.assertRaisesRegex(RuntimeError, 'No cloud texture image node'):
                BAKE.replace_cloud_textures([mesh], Path('clouds.png'))
        image_api.load.assert_not_called()

    def test_nested_cloud_map_replacement_keeps_cloud_normal_map(self):
        normal_image = SimpleNamespace(name='Earth clouds normal map.png', filepath='//Textures/Earth clouds normal map.png')
        normal = SimpleNamespace(type='TEX_IMAGE', name='Cloud normal', image=normal_image)
        density = SimpleNamespace(type='TEX_IMAGE', name='Imagen', image=SimpleNamespace(
            name='Mars clouds map.png', filepath='//Textures/Mars clouds map.png',
            colorspace_settings=SimpleNamespace(name='Non-Color')))
        nested = Mock(nodes=[normal, density])
        tree = Mock(nodes=[SimpleNamespace(type='GROUP', node_tree=nested),
                           SimpleNamespace(type='GROUP', node_tree=nested)])
        material = SimpleNamespace(use_nodes=True, node_tree=tree)
        mesh = SimpleNamespace(data=SimpleNamespace(materials=[material]))
        replacement = SimpleNamespace(colorspace_settings=SimpleNamespace(name='sRGB'))
        image_api = SimpleNamespace(load=Mock(return_value=replacement))
        with patch.object(Path, 'is_file', return_value=True), patch.object(BAKE, 'bpy', SimpleNamespace(data=SimpleNamespace(images=image_api))):
            BAKE.replace_cloud_textures([mesh], Path('clouds.png'))
        self.assertIs(normal.image, normal_image)
        self.assertIs(density.image, replacement)
        self.assertEqual(replacement.colorspace_settings.name, 'Non-Color')
        image_api.load.assert_called_once()

    def test_cloud_texture_color_space_conflict_fails_before_mutation(self):
        nodes = [SimpleNamespace(type='TEX_IMAGE', image=SimpleNamespace(
            name='Earth clouds B map.png', filepath='//Textures/Earth clouds B map.png',
            colorspace_settings=SimpleNamespace(name=colorspace))) for colorspace in ('sRGB', 'Non-Color')]
        material = SimpleNamespace(use_nodes=True, node_tree=Mock(nodes=nodes))
        mesh = SimpleNamespace(data=SimpleNamespace(materials=[material]))
        image_api = SimpleNamespace(load=Mock())
        with patch.object(Path, 'is_file', return_value=True), patch.object(BAKE, 'bpy', SimpleNamespace(data=SimpleNamespace(images=image_api))):
            with self.assertRaisesRegex(RuntimeError, 'conflicting color spaces'):
                BAKE.replace_cloud_textures([mesh], Path('clouds.png'))
        image_api.load.assert_not_called()

    def test_clouds_use_surface_holdout_and_restore_scene(self):
        primary, cloud, atmosphere = [Mock(type='MESH', hide_render=False, is_holdout=False) for _ in range(3)]
        scene = SimpleNamespace(objects=[primary, cloud, atmosphere])
        states = []

        def capture(render_scene, destination):
            states.append([(obj.hide_render, obj.is_holdout) for obj in render_scene.objects])

        with patch.object(BAKE, 'render_frame', side_effect=capture):
            BAKE.render_layers(scene, primary, [cloud], Path('surface.webp'), Path('clouds.webp'), False)
        self.assertEqual(states[0], [(False, False), (True, False), (False, False)])
        self.assertEqual(states[1], [(False, True), (False, False), (True, False)])
        self.assertEqual([(obj.hide_render, obj.is_holdout) for obj in scene.objects], [(False, False)] * 3)

    def test_render_failure_restores_scene(self):
        primary, cloud = [Mock(type='MESH', hide_render=False, is_holdout=False) for _ in range(2)]
        scene = SimpleNamespace(objects=[primary, cloud])
        with patch.object(BAKE, 'render_frame', side_effect=RuntimeError('render failed')):
            with self.assertRaises(RuntimeError):
                BAKE.render_layers(scene, primary, [cloud], Path('surface.webp'), Path('clouds.webp'), False)
        self.assertFalse(primary.is_holdout)
        self.assertFalse(cloud.hide_render)

    def test_surface_and_cloud_passes_never_contain_rings(self):
        primary, cloud, atmosphere, ring = [Mock(type='MESH', hide_render=False, is_holdout=False) for _ in range(4)]
        scene = SimpleNamespace(objects=[primary, cloud, atmosphere, ring])
        states = []

        def capture(render_scene, destination):
            states.append([(obj.hide_render, obj.is_holdout) for obj in render_scene.objects])

        with patch.object(BAKE, 'render_frame', side_effect=capture):
            BAKE.render_layers(scene, primary, [cloud], Path('surface.webp'), Path('clouds.webp'), False, [ring])
        self.assertTrue(all(state[-1][0] for state in states))
        self.assertEqual(states[0][0], (False, False))
        self.assertEqual(states[1][0], (False, True))
        self.assertFalse(ring.hide_render)

    def test_ring_pass_uses_holdout_and_allows_empty_edge_on_ring(self):
        primary, cloud, atmosphere, ring = [Mock(type='MESH', hide_render=False, is_holdout=False) for _ in range(4)]
        scene = SimpleNamespace(objects=[primary, cloud, atmosphere, ring])
        states = []

        def capture(render_scene, destination, allow_empty=False):
            states.append(([(obj.hide_render, obj.is_holdout) for obj in render_scene.objects], allow_empty))

        with patch.object(BAKE, 'render_frame', side_effect=capture):
            BAKE.render_ring_layer(scene, primary, [cloud], [ring], Path('rings.webp'), False)
        self.assertEqual(states, [([(False, True), (True, False), (True, False), (False, False)], True)])
        self.assertEqual([(obj.hide_render, obj.is_holdout) for obj in scene.objects], [(False, False)] * 4)

    def test_ring_pass_changes_only_orthographic_scale_and_restores_it(self):
        primary, ring = [Mock(type='MESH', hide_render=False, is_holdout=False) for _ in range(2)]
        camera = SimpleNamespace(data=SimpleNamespace(ortho_scale=2.4), location=(0, -24, 0))
        scene = SimpleNamespace(objects=[primary, ring], camera=camera)
        scales = []
        with patch.object(BAKE, 'render_frame', side_effect=lambda *args, **kwargs: scales.append(camera.data.ortho_scale)):
            BAKE.render_ring_layer(scene, primary, [], [ring], Path('rings.webp'), False, 5.5)
        self.assertEqual(scales, [5.5])
        self.assertEqual(camera.data.ortho_scale, 2.4)
        self.assertEqual(camera.location, (0, -24, 0))
        self.assertFalse(primary.is_holdout)

    def test_ring_render_failure_restores_surface_camera_and_meshes(self):
        primary, atmosphere, ring = [Mock(type='MESH', hide_render=False, is_holdout=False) for _ in range(3)]
        camera = SimpleNamespace(data=SimpleNamespace(ortho_scale=2.4))
        scene = SimpleNamespace(objects=[primary, atmosphere, ring], camera=camera)
        with patch.object(BAKE, 'render_frame', side_effect=RuntimeError('render failed')):
            with self.assertRaisesRegex(RuntimeError, 'render failed'):
                BAKE.render_ring_layer(scene, primary, [], [ring], Path('rings.webp'), False, 5.5)
        self.assertEqual(camera.data.ortho_scale, 2.4)
        self.assertEqual([(obj.hide_render, obj.is_holdout) for obj in scene.objects], [(False, False)] * 3)


if __name__ == '__main__':
    unittest.main()
