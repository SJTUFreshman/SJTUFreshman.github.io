import contextlib
import hashlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location('pages', Path(__file__).with_name('prepare-cloudflare-pages.py'))
PAGES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PAGES)


class PreparePagesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='prepare-pages-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.output = self.root / '.render-work' / 'pages' / 'site'
        self.baked = self.root / 'assets' / 'celestial' / 'baked'
        self.grid = {'width': 3840, 'height': 2160, 'azimuthCount': 2, 'elevations': [0, 30]}
        for attribute, value in [('BODIES', ('earth',)), ('GRID', self.grid)]:
            patch = mock.patch.object(PAGES, attribute, value)
            patch.start()
            self.addCleanup(patch.stop)
        for relative in PAGES.ROOT_FILES:
            self.write(relative, b'website')
        self.write('images/千島湖.jpg', b'photo')
        self.write('documents/证书.pdf', b'certificate')
        self.write('assets/mochi/frames/idle/idle-00.png', b'pet frame')
        self.write('assets/mochi/build.py', b'private build source')
        self.write('assets/.env', b'PRIVATE=value')
        self.hosted_bytes = b'{"remote": "https://example.test/frames/"}\n'
        self.write(PAGES.MANIFEST_PATH, self.hosted_bytes)
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True, capture_output=True)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True, capture_output=True)
        self.write('assets/untracked.png', b'not part of the website')
        self.make_atlas()

    def write(self, relative, data):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return path

    def make_atlas(self):
        records = []
        for row in range(2):
            for column in range(2):
                relative = f'earth/e{row}/a{column:03d}.webp'
                data = b'RIFF\x10\x00\x00\x00WEBP' + bytes([row, column]) + b'test-frame'
                self.write(f'assets/celestial/baked/{relative}', data)
                records.append({'path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        self.write('assets/celestial/baked/earth/poster.webp', (self.baked / records[0]['path']).read_bytes())
        self.package = {
            'version': 1, 'body': 'earth', **self.grid, 'frames': records,
            'poster': {'path': 'earth/poster.webp', 'source': records[0]['path'],
                       'sha256': records[0]['sha256'], 'elevation': 0, 'azimuth': 0},
            'renderMetadata': [{'privateSource': '/private/source.blend'}],
        }
        self.save_package()
        descriptor = {**self.grid, 'framePattern': 'earth/e{elevation}/a{azimuth}.webp',
                      'poster': 'earth/poster.webp', 'defaultAzimuth': 0, 'defaultElevation': 0,
                      'metadata': 'earth/package.json'}
        self.write('assets/celestial/baked/manifest.json', PAGES.json_bytes({
            'version': 1, 'width': 3840, 'height': 2160, 'bodies': {'earth': descriptor}}))
        self.write('assets/celestial/baked/earth/render-metadata/render.json', b'private render metadata')
        self.write('.render-work/original.blend', b'private source')

    def save_package(self):
        self.write('assets/celestial/baked/earth/package.json', PAGES.json_bytes(self.package))

    def prepare(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return PAGES.prepare(self.root, self.output, **kwargs)

    def test_same_origin_release_preserves_all_public_assets_and_excludes_sources(self):
        original = (self.baked / 'manifest.json').read_bytes()
        report = self.prepare()
        hosted = json.loads((self.output / PAGES.MANIFEST_PATH).read_text(encoding='utf-8'))
        descriptor = hosted['bodies']['earth']
        prefix = '/assets/celestial/releases/20261002-4k-v1/'
        self.assertEqual(descriptor['framePattern'], prefix + 'earth/e{elevation}/a{azimuth}.webp')
        self.assertEqual(descriptor['poster'], prefix + 'earth/poster.webp')
        self.assertNotIn('metadata', descriptor)
        self.assertEqual(report['verifiedAtlasFiles'], 5)
        for relative in ['images/千島湖.jpg', 'documents/证书.pdf', 'assets/mochi/frames/idle/idle-00.png', '404.html', '_headers']:
            self.assertTrue((self.output / relative).is_file(), relative)
        for relative in ['assets/.env', 'assets/mochi/build.py', 'assets/untracked.png', 'assets/celestial/baked', '.render-work']:
            self.assertFalse((self.output / relative).exists(), relative)
        self.assertFalse(list(self.output.rglob('package.json')))
        self.assertFalse(list(self.output.rglob('render-metadata')))
        self.assertEqual((self.baked / 'manifest.json').read_bytes(), original)
        self.assertEqual((self.root / PAGES.MANIFEST_PATH).read_bytes(), self.hosted_bytes)
        self.assertTrue(self.output.with_name('site-report.json').is_file())
        target_frame = self.output / prefix.lstrip('/') / 'earth/e0/a000.webp'
        expected_bytes = target_frame.read_bytes()
        (self.baked / 'earth/e0/a000.webp').write_bytes(b'changed source')
        self.assertEqual(target_frame.read_bytes(), expected_bytes)

    def test_external_mode_preserves_hosted_manifest_without_reading_baked(self):
        (self.baked / 'manifest.json').unlink()
        report = self.prepare(external_atlas=True)
        self.assertEqual((self.output / PAGES.MANIFEST_PATH).read_bytes(), self.hosted_bytes)
        self.assertEqual(report['atlasMode'], 'external')
        self.assertEqual(report['verifiedAtlasFiles'], 0)
        self.assertFalse((self.output / 'assets/celestial/releases').exists())

    def test_corrupted_frame_aborts_without_success_report(self):
        frame = self.baked / 'earth/e0/a000.webp'
        frame.write_bytes(frame.read_bytes()[:-1] + b'!')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            self.prepare()
        self.assertFalse(self.output.with_name('site-report.json').exists())

    def test_incomplete_grid_rejected_before_output_creation(self):
        (self.baked / 'earth/e1/a001.webp').unlink()
        with self.assertRaisesRegex(ValueError, 'complete frame grid'):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_duplicate_records_rejected(self):
        self.package['frames'][-1] = self.package['frames'][0]
        self.save_package()
        with self.assertRaisesRegex(ValueError, 'duplicate frame records'):
            self.prepare()

    def test_poster_hash_must_match_selected_frame(self):
        self.package['poster']['sha256'] = '0' * 64
        self.save_package()
        with self.assertRaisesRegex(ValueError, 'selected viewpoint'):
            self.prepare()

    def test_nonempty_output_and_existing_report_are_never_overwritten(self):
        sentinel = self.write('.render-work/pages/site/sentinel.txt', b'keep me')
        with self.assertRaisesRegex(ValueError, 'new or empty'):
            self.prepare(external_atlas=True)
        self.assertEqual(sentinel.read_bytes(), b'keep me')
        sentinel.unlink()
        report = self.write('.render-work/pages/site-report.json', b'old report')
        with self.assertRaisesRegex(ValueError, 'Report already exists'):
            self.prepare(external_atlas=True)
        self.assertEqual(report.read_bytes(), b'old report')

    def test_outputs_outside_work_directory_and_root_itself_are_rejected(self):
        for output in [self.root / 'assets', self.root / '.render-work', self.root.parent / 'outside']:
            with self.subTest(output=output), self.assertRaises(ValueError):
                PAGES.validate_output(self.root, output)

    def test_release_and_source_path_traversal_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'release name'):
            self.prepare(version='../escape')
        for relative in ['../escape', '/escape', 'earth\\secret', 'C:secret', 'earth/../secret']:
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                PAGES.source_file(self.root, relative)

    def test_file_size_and_count_limits_are_enforced_before_copy(self):
        with mock.patch.object(PAGES, 'MAX_BYTES', 1), self.assertRaisesRegex(ValueError, '25 MiB'):
            self.prepare(external_atlas=True)
        with mock.patch.object(PAGES, 'MAX_FILES', 1), self.assertRaisesRegex(ValueError, 'file limit'):
            self.prepare(external_atlas=True)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
