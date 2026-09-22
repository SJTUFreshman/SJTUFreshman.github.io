"""Exercise render-input preflight using temporary files and the standard library."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location('render_input_validation', Path(__file__).with_name('validate-render-inputs.py'))
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class RenderInputTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='render-input-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.scene = {'materials': [], 'assets': []}
        self.entry = ['--scene', 'scene.json', '--output', 'renders/review.png', '--blend', 'renders/review.blend']
        self.write_json('scene.json', self.scene)
        self.write_json('queue.json', [self.entry])

    def write_file(self, path, content='fixture'):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding='utf-8')
        return target

    def write_json(self, path, content):
        return self.write_file(path, json.dumps(content))

    def validate(self, queues=('queue.json',), **options):
        return VALIDATOR.validate_queues(queues, workdir=self.root, **options)

    def use_model(self, description):
        self.scene['assets'] = [{'id': 'test_model'}]
        self.write_json('scene.json', self.scene)
        self.write_json('assets/life/models/test_model/test_model_1k.gltf', description)

    def test_valid_queue_requires_no_output_or_unused_assets(self):
        result = self.validate()
        self.assertEqual(result.errors, [])
        self.assertEqual(result.entries, 1)
        self.assertFalse((self.root / 'renders').exists())

    def test_missing_hdri_and_texture_are_reported_together(self):
        self.scene['materials'] = [{'textures': {'baseColor': {'path': 'missing.jpg'}}}]
        self.write_json('scene.json', self.scene)
        self.entry.extend(['--hdri', 'missing.hdr'])
        self.write_json('queue.json', [self.entry])
        result = self.validate()
        self.assertEqual(len(result.errors), 2)
        self.assertIn('--hdri', result.errors[0])
        self.assertIn('missing.hdr', result.errors[0])
        self.assertIn('textures.baseColor', result.errors[1])

    def test_nasa_branch_requires_source_but_not_replaced_proxy_assets(self):
        self.scene.update({'scene': 'spaceship', 'materials': [{'textures': {'normal': 'unused.jpg'}}]})
        self.write_json('scene.json', self.scene)
        self.entry.extend(['--nasa-interior', 'source.fbx'])
        self.write_json('queue.json', [self.entry])
        self.assertIn('--nasa-interior', '\n'.join(self.validate().errors))
        self.write_file('source.fbx')
        self.assertEqual(self.validate().errors, [])

    def test_nasa_branch_rejects_other_scenes_and_proxy_mode(self):
        self.write_file('source.fbx')
        self.entry.extend(['--nasa-interior', 'source.fbx'])
        self.write_json('queue.json', [self.entry])
        self.assertIn('spaceship descriptor', '\n'.join(self.validate().errors))
        self.scene['scene'] = 'spaceship'
        self.write_json('scene.json', self.scene)
        self.entry.append('--proxy-only')
        self.write_json('queue.json', [self.entry])
        self.assertIn('cannot replace the proxy', '\n'.join(self.validate().errors))

    def test_multiple_queues_and_additional_inputs(self):
        self.write_json('second.json', [self.entry])
        result = self.validate(('queue.json', 'second.json'), required_files=['missing-refinement.json'])
        self.assertEqual(result.entries, 2)
        self.assertEqual(len(result.errors), 1)
        self.assertIn('--required-file', result.errors[0])

    def test_invalid_json_and_non_object_scene(self):
        for content in ('{broken', '[]', 'null'):
            with self.subTest(content=content):
                self.write_file('scene.json', content)
                result = self.validate()
                self.assertTrue(result.errors)
        self.write_file('queue.json', '{broken')
        self.assertIn('invalid JSON', self.validate().errors[0])

    def test_malformed_queue_entries_and_required_arguments(self):
        self.write_json('queue.json', [None, ['--scene', 10], [], ['--scene', 'scene.json'], ['--scene', '--output', 'a', '--blend', 'b']])
        result = self.validate()
        self.assertGreaterEqual(len(result.errors), 6)
        self.assertIn('missing required argument --output', '\n'.join(result.errors))
        self.assertIn('--scene requires a value', '\n'.join(result.errors))

    def test_empty_and_non_list_queues_fail(self):
        for queue in ([], {}, 'queue'):
            with self.subTest(queue=queue):
                self.write_json('queue.json', queue)
                self.assertTrue(self.validate().errors)

    def test_asset_root_override_and_cwd_relative_scene_hdri(self):
        self.scene['materials'] = [{'textures': {'normal': 'surface.jpg'}}]
        self.write_json('scene.json', self.scene)
        self.write_file('specific/surface.jpg')
        self.write_file('sky.hdr')
        self.entry.extend(['--asset-root=specific', '--hdri=sky.hdr', '--samples', '192'])
        self.write_json('nested/queue.json', [self.entry])
        result = self.validate(('nested/queue.json',), asset_root='wrong-root')
        self.assertEqual(result.errors, [])

    def test_default_asset_root_and_absolute_texture(self):
        absolute = str(self.write_file('absolute.jpg'))
        self.scene['materials'] = [{'textures': {'normal': absolute, 'baseColor': 'local.jpg'}}]
        self.write_json('scene.json', self.scene)
        self.write_file('selected/local.jpg')
        self.assertEqual(self.validate(asset_root='selected').errors, [])

    def test_offline_material_checks_selected_sources_only(self):
        self.scene['materials'] = [{'offlineMaterial': 'surface', 'textures': {'baseColor': 'unused-missing.jpg'}}]
        self.write_json('scene.json', self.scene)
        self.write_file('.render-work/library/surface/surface_diff_4k.jpg')
        self.assertEqual(self.validate().errors, [])
        self.scene['materials'] = [{'offlineMaterial': 'unavailable-optional'}]
        self.write_json('scene.json', self.scene)
        self.assertEqual(self.validate().errors, [])

    def test_gltf_external_and_embedded_resources(self):
        self.use_model({'buffers': [{'uri': 'geometry.bin'}], 'images': [{'uri': 'textures/diffuse%20color.jpg'}, {'uri': 'data:image/png;base64,AA=='}, {'bufferView': 0}]})
        self.write_file('assets/life/models/test_model/geometry.bin')
        self.write_file('assets/life/models/test_model/textures/diffuse color.jpg')
        self.assertEqual(self.validate().errors, [])

    def test_gltf_missing_dependencies_are_aggregated(self):
        self.use_model({'buffers': [{'uri': 'geometry.bin'}], 'images': [{'uri': 'texture.jpg'}]})
        result = self.validate()
        self.assertEqual(len(result.errors), 2)
        self.assertIn('buffers[0]', result.errors[0])
        self.assertIn('images[0]', result.errors[1])

    def test_gltf_remote_and_file_uris_are_rejected(self):
        for uri in ('https://example.invalid/asset.bin', '//example.invalid/asset.bin', 'file:///tmp/asset.bin'):
            with self.subTest(uri=uri):
                self.use_model({'buffers': [{'uri': uri}]})
                self.assertIn('URI is not allowed', self.validate().errors[0])

    def test_invalid_gltf_and_missing_model(self):
        self.use_model({})
        model_path = 'assets/life/models/test_model/test_model_1k.gltf'
        self.write_file(model_path, '{broken')
        self.assertIn('invalid JSON', self.validate().errors[0])
        (self.root / model_path).unlink()
        self.assertIn('missing file', self.validate().errors[0])

    def test_asset_id_and_texture_shapes_fail_cleanly(self):
        self.scene['assets'] = [{'id': '../outside'}]
        self.scene['materials'] = [{'textures': {'baseColor': {}}}]
        self.write_json('scene.json', self.scene)
        result = self.validate()
        self.assertEqual(len(result.errors), 2)
        self.assertIn('asset id', result.errors[1])

    def test_cli_has_nonzero_exit_and_clear_errors(self):
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            status = VALIDATOR.main(['--queue', str(self.root / 'missing-queue.json')])
        self.assertEqual(status, 1)
        self.assertIn('RENDER_INPUTS_FAILED', output.getvalue())
        self.assertIn('missing-queue.json', output.getvalue())


if __name__ == '__main__':
    unittest.main()
