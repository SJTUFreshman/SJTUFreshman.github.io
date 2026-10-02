import contextlib
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image, WebPImagePlugin


SPEC = importlib.util.spec_from_file_location('celestial_packager', Path(__file__).with_name('package-celestial-atlas.py'))
PACKAGER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGER)


class CelestialPackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='celestial-package-test-')
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.output = self.root / 'output'

    def tearDown(self):
        self.temporary.cleanup()

    def arguments(self, *extra, source=None, output=None):
        return ['--input', str(source or self.source), '--output', str(output or self.output),
                '--azimuth-count', '2', '--elevations', '0', '--width', '16', '--height', '8', *extra]

    def run_package(self, *extra, **locations):
        with contextlib.redirect_stdout(io.StringIO()):
            PACKAGER.main(self.arguments(*extra, **locations))

    def write_grid(self, bodies=PACKAGER.BODIES, extension='webp'):
        for body_index, body in enumerate(bodies):
            for column in range(2):
                filename = self.source / body / 'e0' / f'a{column:03d}.{extension}'
                filename.parent.mkdir(parents=True, exist_ok=True)
                Image.new('RGB', (16, 8), (body_index * 20, column * 100, 80)).save(filename, extension.upper())

    def read_manifest(self):
        return json.loads((self.output / 'manifest.json').read_text(encoding='utf-8'))

    def test_production_defaults_and_poster_overrides(self):
        args = PACKAGER.parse_args(['--input', str(self.source), '--output', str(self.output)])
        self.assertEqual((args.width, args.height, args.azimuth_count, args.quality), (3840, 2160, 180, 90))
        self.assertEqual(args.workers, 8)
        self.assertEqual(len(args.elevations), 7)
        self.assertEqual(PACKAGER.poster_frame('earth', args), (3, 0))
        self.assertEqual(PACKAGER.poster_frame('saturn', args), (4, 0))
        self.assertEqual(PACKAGER.poster_frame('uranus', args), (4, 0))
        args = PACKAGER.parse_args(self.arguments('--poster-frame', 'saturn:0:1'))
        self.assertEqual(PACKAGER.poster_frame('saturn', args), (0, 1))

    def test_complete_small_fixture_preserves_webp_bytes_and_provenance(self):
        self.write_grid()
        metadata = {'body': 'earth', 'model': 'user-earth.blend', 'modelSha256': 'a' * 64,
                    'width': 16, 'height': 8, 'azimuthCount': 2, 'elevations': [0], 'samples': 64, 'quality': 90}
        (self.source / 'earth' / 'render.json').write_text(json.dumps(metadata), encoding='utf-8')
        self.run_package('--manifest', '--frame-base-url', 'https://cdn.example.test/planets/v1', '--poster-frame', 'earth:0:1')
        manifest = self.read_manifest()
        self.assertEqual(set(manifest['bodies']), set(PACKAGER.BODIES))
        earth = manifest['bodies']['earth']
        self.assertEqual(earth['framePattern'], 'https://cdn.example.test/planets/v1/earth/e{elevation}/a{azimuth}.webp')
        self.assertEqual(earth['poster'], 'earth/poster.webp')
        self.assertEqual((earth['defaultElevation'], earth['defaultAzimuth']), (0, 1))
        for body in PACKAGER.BODIES:
            for column in range(2):
                relative = Path(body) / 'e0' / f'a{column:03d}.webp'
                self.assertEqual((self.source / relative).read_bytes(), (self.output / relative).read_bytes())
        self.assertEqual((self.output / 'earth/poster.webp').read_bytes(), (self.source / 'earth/e0/a001.webp').read_bytes())
        package = json.loads((self.output / 'earth/package.json').read_text(encoding='utf-8'))
        self.assertEqual(package['renderMetadata'][0]['parameters'], metadata)
        self.assertEqual(package['frames'][0]['encoding'], 'preserved')
        for line in (self.output / 'SHA256SUMS').read_text().splitlines():
            digest, relative = line.split('  ', 1)
            self.assertEqual(digest, hashlib.sha256((self.output / relative).read_bytes()).hexdigest())

    def test_in_place_webp_validation_avoids_reencoding(self):
        self.write_grid()
        original = (self.source / 'earth/e0/a000.webp').read_bytes()
        self.run_package('--manifest', output=self.source)
        self.run_package('--manifest', output=self.source)
        self.assertEqual(original, (self.source / 'earth/e0/a000.webp').read_bytes())
        self.assertTrue((self.source / 'manifest.json').is_file())

    def test_hosted_export_preserves_local_grid_and_copies_only_verified_posters(self):
        self.write_grid()
        hosted = self.root / 'hosted'
        self.run_package('--manifest', '--frame-base-url', 'https://cdn.example.test/planets/v1/', '--hosted-output', str(hosted))
        deployed = json.loads((hosted / 'manifest.json').read_text(encoding='utf-8'))
        for body in PACKAGER.BODIES:
            self.assertEqual(self.read_manifest()['bodies'][body]['framePattern'], f'{body}/e{{elevation}}/a{{azimuth}}.webp')
            entry = deployed['bodies'][body]
            self.assertEqual(entry['framePattern'], f'https://cdn.example.test/planets/v1/{body}/e{{elevation}}/a{{azimuth}}.webp')
            self.assertNotIn('metadata', entry)
            self.assertEqual((hosted / entry['poster']).read_bytes(), (self.output / body / 'poster.webp').read_bytes())
            self.assertIn(PACKAGER.checksum(hosted / entry['poster'])[:16], entry['poster'])
        self.assertEqual(len([filename for filename in hosted.rglob('*') if filename.is_file()]), 11)
        previous = (hosted / 'manifest.json').read_bytes()
        (self.output / 'earth/e0/a001.webp').unlink()
        with self.assertRaisesRegex(ValueError, 'Incomplete or unexpected frame grid'):
            self.run_package('--verify-only', '--manifest', '--frame-base-url', 'https://cdn.example.test/planets/v2/', '--hosted-output', str(hosted))
        self.assertEqual((hosted / 'manifest.json').read_bytes(), previous)

    def test_hosted_export_requires_https_manifest_and_separate_output(self):
        hosted = str(self.root / 'hosted')
        for options in [('--hosted-output', hosted),
                        ('--manifest', '--hosted-output', hosted, '--frame-base-url', 'http://cdn.example.test/v1/'),
                        ('--manifest', '--hosted-output', str(self.output), '--frame-base-url', 'https://cdn.example.test/v1/')]:
            with self.subTest(options=options), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as failure:
                    PACKAGER.parse_args(self.arguments(*options))
                self.assertEqual(failure.exception.code, 2)

    def test_verify_only_publishes_existing_packages_without_repackaging(self):
        self.write_grid()
        self.run_package()
        package_path = self.output / 'earth/package.json'
        original_metadata = package_path.read_bytes()
        with mock.patch.object(PACKAGER, 'package_body', side_effect=AssertionError('Verification must not package frames')):
            self.run_package('--verify-only', '--manifest', source=self.root / 'unavailable-source')
        self.assertEqual(package_path.read_bytes(), original_metadata)
        self.assertEqual(set(self.read_manifest()['bodies']), set(PACKAGER.BODIES))

    def test_verify_only_requires_exactly_one_target_and_hash_only_requires_verification(self):
        for options in [('--verify-only',), ('--verify-only', '--manifest', '--body', 'earth'),
                        ('--hash-only',), ('--hash-only', '--manifest'), ('--hash-only', '--body', 'earth')]:
            with self.subTest(options=options), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as failure:
                    PACKAGER.parse_args(self.arguments(*options))
                self.assertEqual(failure.exception.code, 2)

    def test_verify_only_body_checks_installed_package_without_repackaging_or_publication(self):
        self.write_grid(('earth',))
        self.run_package('--body', 'earth')
        package_path = self.output / 'earth/package.json'
        original_metadata = package_path.read_bytes()
        with mock.patch.object(PACKAGER, 'package_body', side_effect=AssertionError('Verification must not package frames')):
            self.run_package('--verify-only', '--body', 'earth', source=self.root / 'unavailable-source')
        self.assertEqual(package_path.read_bytes(), original_metadata)
        self.assertFalse((self.output / 'manifest.json').exists())

    def test_hash_only_checks_headers_without_pixel_decoding_or_reencoding(self):
        self.write_grid()
        self.run_package()
        original = (self.output / 'earth/e0/a000.webp').read_bytes()
        with mock.patch.object(WebPImagePlugin.WebPImageFile, 'load', side_effect=AssertionError('Hash verification must not decode pixels')):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')
            self.assertFalse((self.output / 'manifest.json').exists())
            self.run_package('--verify-only', '--manifest', '--hash-only')
        self.assertEqual((self.output / 'earth/e0/a000.webp').read_bytes(), original)
        self.assertEqual(set(self.read_manifest()['bodies']), set(PACKAGER.BODIES))

    def test_hash_only_rejects_changed_frame_and_preserves_manifest(self):
        self.write_grid()
        self.run_package('--manifest')
        previous = (self.output / 'manifest.json').read_bytes()
        Image.new('RGB', (16, 8), (255, 0, 0)).save(self.output / 'moon/e0/a001.webp')
        with self.assertRaisesRegex(ValueError, 'Frame changed after packaging'):
            self.run_package('--verify-only', '--manifest', '--hash-only')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)

    def test_hash_only_rejects_bad_dimensions_even_with_matching_hash(self):
        self.write_grid(('earth',))
        self.run_package('--body', 'earth')
        frame = self.output / 'earth/e0/a001.webp'
        Image.new('RGB', (32, 8)).save(frame)
        package_path = self.output / 'earth/package.json'
        package = json.loads(package_path.read_text())
        package['frames'][1]['sha256'] = PACKAGER.checksum(frame)
        package_path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValueError, 'Frame dimensions'):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')

    def test_hash_only_rejects_wrong_format_even_with_matching_hash(self):
        self.write_grid(('earth',))
        self.run_package('--body', 'earth')
        frame = self.output / 'earth/e0/a001.webp'
        Image.new('RGB', (16, 8)).save(frame, 'PNG')
        package_path = self.output / 'earth/package.json'
        package = json.loads(package_path.read_text())
        package['frames'][1]['sha256'] = PACKAGER.checksum(frame)
        package_path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValueError, 'Expected one WEBP image'):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')

    def test_hash_only_rejects_missing_frame_and_partial_collection(self):
        self.write_grid(('earth',))
        self.run_package('--body', 'earth')
        with self.assertRaisesRegex(ValueError, 'Missing or invalid package metadata'):
            self.run_package('--verify-only', '--manifest', '--hash-only')
        (self.output / 'earth/e0/a001.webp').unlink()
        with self.assertRaisesRegex(ValueError, 'Incomplete or unexpected frame grid'):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')
        self.assertFalse((self.output / 'manifest.json').exists())

    def test_hash_only_checks_render_metadata_hash_and_parameters(self):
        self.write_grid(('earth',))
        (self.source / 'earth/render.json').write_text(json.dumps({'body': 'earth', 'samples': 64}))
        self.run_package('--body', 'earth')
        metadata_path = self.output / 'earth/render-metadata/render.json'
        metadata_path.write_text(json.dumps({'body': 'earth', 'samples': 32}))
        with self.assertRaisesRegex(ValueError, 'Render metadata changed after packaging'):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')
        package_path = self.output / 'earth/package.json'
        package = json.loads(package_path.read_text())
        package['renderMetadata'][0]['sha256'] = PACKAGER.checksum(metadata_path)
        package_path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValueError, 'Render metadata parameters differ'):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')

    def test_hash_only_checks_poster_hash_and_selected_grid_coordinates(self):
        self.write_grid(('earth',))
        self.run_package('--body', 'earth')
        poster_path = self.output / 'earth/poster.webp'
        original = poster_path.read_bytes()
        Image.new('RGB', (16, 8), (255, 0, 0)).save(poster_path)
        with self.assertRaisesRegex(ValueError, 'Poster differs from its selected frame'):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')
        poster_path.write_bytes(original)
        package_path = self.output / 'earth/package.json'
        package = json.loads(package_path.read_text())
        package['poster']['azimuth'] = 2
        package_path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValueError, 'Poster selection is outside the grid'):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')

    def test_worker_count_validation(self):
        for workers in ['0', '17']:
            with self.subTest(workers=workers), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as failure:
                    PACKAGER.parse_args(self.arguments('--workers', workers))
                self.assertEqual(failure.exception.code, 2)
        self.assertEqual(PACKAGER.parse_args(self.arguments('--workers', '1')).workers, 1)

    def test_webp_copy_decodes_source_once_and_final_verification_decodes_again(self):
        self.write_grid()
        with mock.patch.object(PACKAGER, 'validate_image', wraps=PACKAGER.validate_image) as validate:
            self.run_package('--body', 'earth')
        self.assertEqual(validate.call_count, 2)
        self.assertTrue(all(call.args[0].is_relative_to(self.source.resolve()) for call in validate.call_args_list))
        self.run_package()
        with mock.patch.object(PACKAGER, 'validate_image', wraps=PACKAGER.validate_image) as validate:
            self.run_package('--verify-only', '--manifest')
        self.assertEqual(validate.call_count, 30)
        self.assertTrue(all(call.args[0].is_relative_to(self.output.resolve()) for call in validate.call_args_list))

    def test_packaging_worker_error_blocks_metadata_and_manifest(self):
        self.write_grid()
        original = PACKAGER.package_frame

        def fail_frame(entry, args):
            if entry[1] == 1:
                raise RuntimeError('simulated packaging worker failure')
            return original(entry, args)

        with mock.patch.object(PACKAGER, 'package_frame', side_effect=fail_frame):
            with self.assertRaisesRegex(RuntimeError, 'packaging worker failure'):
                self.run_package('--manifest')
        self.assertFalse((self.output / 'manifest.json').exists())
        self.assertFalse((self.output / 'sun/package.json').exists())

    def test_verification_worker_error_preserves_previous_manifest(self):
        self.write_grid()
        self.run_package('--manifest')
        previous = (self.output / 'manifest.json').read_bytes()
        original = PACKAGER.verify_frame

        def fail_frame(record, args):
            if record['path'].endswith('a001.webp'):
                raise RuntimeError('simulated verification worker failure')
            return original(record, args)

        with mock.patch.object(PACKAGER, 'verify_frame', side_effect=fail_frame):
            with self.assertRaisesRegex(RuntimeError, 'verification worker failure'):
                self.run_package('--verify-only', '--manifest')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)

    def test_png_source_changes_replace_existing_output(self):
        self.write_grid(('earth',), 'png')
        self.run_package('--body', 'earth')
        destination = self.output / 'earth/e0/a000.webp'
        old_bytes = destination.read_bytes()
        Image.new('RGB', (16, 8), (250, 0, 0)).save(self.source / 'earth/e0/a000.png')
        self.run_package('--body', 'earth')
        self.assertNotEqual(old_bytes, destination.read_bytes())
        package = json.loads((self.output / 'earth/package.json').read_text())
        self.assertEqual(package['frames'][0]['quality'], 90)
        self.assertEqual(package['frames'][0]['sourceSha256'], PACKAGER.checksum(self.source / 'earth/e0/a000.png'))

    def test_missing_frame_does_not_publish_or_replace_manifest(self):
        self.write_grid()
        self.output.mkdir()
        previous = b'{"version":"previous-release"}\n'
        (self.output / 'manifest.json').write_bytes(previous)
        (self.source / 'earth/e0/a001.webp').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing source frame'):
            self.run_package('--manifest')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)

    def test_dimension_mismatch_is_rejected(self):
        self.write_grid(('earth',))
        Image.new('RGB', (32, 8)).save(self.source / 'earth/e0/a001.webp')
        with self.assertRaisesRegex(ValueError, 'Frame dimensions'):
            self.run_package('--body', 'earth', '--manifest')
        self.assertFalse((self.output / 'manifest.json').exists())

    def test_undecodable_frame_is_rejected(self):
        self.write_grid(('earth',))
        (self.source / 'earth/e0/a001.webp').write_bytes(b'not an image')
        with self.assertRaisesRegex(ValueError, 'Undecodable frame'):
            self.run_package('--body', 'earth')
        self.assertFalse((self.output / 'earth/package.json').exists())

    def test_body_packaging_cannot_publish_partial_manifest(self):
        self.write_grid(('earth',))
        self.run_package('--body', 'earth')
        with self.assertRaisesRegex(ValueError, 'Missing or invalid package metadata'):
            self.run_package('--body', 'earth', '--manifest')
        self.assertFalse((self.output / 'manifest.json').exists())

    def test_existing_other_body_tamper_blocks_publication(self):
        self.write_grid()
        self.run_package('--manifest')
        previous = (self.output / 'manifest.json').read_bytes()
        Image.new('RGB', (16, 8), (255, 0, 0)).save(self.output / 'moon/e0/a000.webp')
        with self.assertRaisesRegex(ValueError, 'Frame changed after packaging'):
            self.run_package('--body', 'earth', '--manifest')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)

    def test_unexpected_grid_frame_is_rejected(self):
        self.write_grid()
        self.run_package('--manifest')
        Image.new('RGB', (16, 8)).save(self.output / 'moon/e0/a002.webp')
        with self.assertRaisesRegex(ValueError, 'unexpected frame grid'):
            self.run_package('--body', 'earth', '--manifest')

    def test_ambiguous_source_requires_explicit_format(self):
        self.write_grid(('earth',))
        self.write_grid(('earth',), 'png')
        with self.assertRaisesRegex(ValueError, 'Ambiguous source frame'):
            self.run_package('--body', 'earth')
        self.run_package('--body', 'earth', '--input-format', 'webp')

    def test_renderer_metadata_grid_mismatch_is_rejected(self):
        self.write_grid(('earth',))
        (self.source / 'earth/render.json').write_text(json.dumps({'body': 'earth', 'width': 3840}))
        with self.assertRaisesRegex(ValueError, 'metadata width'):
            self.run_package('--body', 'earth')

    def test_concurrent_source_change_is_rejected(self):
        self.write_grid(('earth',))
        original_copy = PACKAGER.copy_file

        def change_during_copy(source, destination):
            original_copy(source, destination)
            if source.name == 'a000.webp':
                Image.new('RGB', (16, 8), (0, 255, 0)).save(source)

        with mock.patch.object(PACKAGER, 'copy_file', side_effect=change_during_copy):
            with self.assertRaisesRegex(ValueError, 'Source changed during packaging'):
                self.run_package('--body', 'earth')
        self.assertFalse((self.output / 'earth/package.json').exists())

    def test_atomic_manifest_failure_preserves_previous_file(self):
        target = self.root / 'manifest.json'
        target.write_text('previous')
        with mock.patch.object(PACKAGER.os, 'replace', side_effect=OSError('simulated interrupted replacement')):
            with self.assertRaises(OSError):
                PACKAGER.atomic_json(target, {'version': 1})
        self.assertEqual(target.read_text(), 'previous')
        self.assertEqual(list(self.root.glob('.*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
