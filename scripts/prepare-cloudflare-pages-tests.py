import contextlib
import hashlib
import importlib.util
import io
import json
import subprocess
import tarfile
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

    def make_autoplay(self):
        patch = mock.patch.object(PAGES.AUTOPLAY, 'BODIES', ('earth',))
        patch.start()
        self.addCleanup(patch.stop)
        self.autoplay_root = self.root / '.render-work' / 'autoplay'
        self.autoplay_version = 'test-autoplay-v1'
        descriptor = {**self.grid, 'defaultElevation': 1, 'defaultAzimuth': 0,
                      'framePattern': 'earth/e{elevation}/a{azimuth}.webp',
                      'cloudFramePattern': 'earth/clouds/t{time}/e{elevation}/a{azimuth}.webp',
                      'poster': 'earth/resolutions/2048/poster.webp',
                      'metadata': 'earth/package.json',
                      'climate': {'frameCount': 2, 'timeStepSeconds': 43200, 'loopSeconds': 86400}}
        descriptor['resolutions'] = [{**self.grid, 'width': 2048, 'height': 2048,
                                      'framePattern': 'earth/resolutions/2048/e{elevation}/a{azimuth}.webp',
                                      'cloudFramePattern': 'earth/resolutions/2048/clouds/t{time}/e{elevation}/a{azimuth}.webp',
                                      'poster': descriptor['poster'], 'metadata': 'earth/private.json'}]
        self.autoplay_manifest = {'version': 1, 'bodies': {'earth': descriptor}}
        manifest_bytes = PAGES.json_bytes(self.autoplay_manifest)
        self.write('.render-work/autoplay/manifest.json', manifest_bytes)
        paths = [descriptor['poster']]
        for prefix in ['earth', 'earth/resolutions/2048']:
            for column in range(2):
                paths.append(f'{prefix}/e1/a{column:03d}.webp')
                for time_index in range(2):
                    paths.append(f'{prefix}/clouds/t{time_index:03d}/e1/a{column:03d}.webp')
        records = {}
        for relative in paths:
            data = b'RIFF\x10\x00\x00\x00WEBP' + relative.encode()
            self.write('.render-work/autoplay/' + relative, data)
            records[relative] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.autoplay_inventory = {'schema': 1, 'version': self.autoplay_version,
                                   'sourceManifestSha256': hashlib.sha256(manifest_bytes).hexdigest(), 'files': records}
        self.write('.render-work/autoplay/inventory.json', PAGES.json_bytes(self.autoplay_inventory))

    def test_autoplay_preserves_all_rotations_cloud_times_and_resolutions(self):
        self.make_autoplay()
        report = self.prepare(autoplay_root=self.autoplay_root, version=self.autoplay_version)
        self.assertEqual(report['atlasMode'], 'autoplay')
        self.assertEqual(report['verifiedAtlasFiles'], 13)
        manifest = json.loads((self.output / PAGES.MANIFEST_PATH).read_text())
        self.assertEqual(manifest['playbackMode'], 'autoplay')
        self.assertEqual(manifest['bodies']['earth']['availableElevations'], [1])
        self.assertNotIn('metadata', json.dumps(manifest))
        for relative, record in self.autoplay_inventory['files'].items():
            destination = self.output / 'assets/celestial/releases' / self.autoplay_version / relative
            self.assertEqual(hashlib.sha256(destination.read_bytes()).hexdigest(), record['sha256'])
        self.assertFalse(list(self.output.rglob('e0')))
        self.assertFalse(list(self.output.rglob('inventory.json')))
        self.assertEqual(manifest['bodies']['earth']['climate']['frameCount'], 2)

    def test_autoplay_missing_cloud_time_is_rejected_before_copy(self):
        self.make_autoplay()
        del self.autoplay_inventory['files']['earth/clouds/t001/e1/a001.webp']
        self.write('.render-work/autoplay/inventory.json', PAGES.json_bytes(self.autoplay_inventory))
        with self.assertRaisesRegex(ValueError, 'every selected frame'):
            self.prepare(autoplay_root=self.autoplay_root, version=self.autoplay_version)
        self.assertFalse(self.output.exists())

    def test_autoplay_corrupt_frame_cannot_produce_success_report(self):
        self.make_autoplay()
        frame = self.autoplay_root / 'earth/clouds/t001/e1/a001.webp'
        frame.write_bytes(frame.read_bytes()[:-1] + b'!')
        with self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            self.prepare(autoplay_root=self.autoplay_root, version=self.autoplay_version)
        self.assertFalse(self.output.with_name('site-report.json').exists())

    def test_autoplay_manifest_changes_and_wrong_versions_are_rejected(self):
        self.make_autoplay()
        with self.assertRaisesRegex(ValueError, 'inventory must match'):
            self.prepare(autoplay_root=self.autoplay_root, version='another-release')
        self.autoplay_manifest['bodies']['earth']['defaultAzimuth'] = 1
        self.write('.render-work/autoplay/manifest.json', PAGES.json_bytes(self.autoplay_manifest))
        with self.assertRaisesRegex(ValueError, 'inventory must match'):
            self.prepare(autoplay_root=self.autoplay_root, version=self.autoplay_version)

    def test_autoplay_public_paths_cannot_escape_the_release(self):
        self.make_autoplay()
        for path in ['../private.webp', 'earth/../private.webp', 'earth\\private.webp', 'https://invalid/frame.webp']:
            with self.subTest(path=path):
                self.autoplay_manifest['bodies']['earth']['poster'] = path
                with self.assertRaisesRegex(ValueError, 'Unsafe public frame path'):
                    PAGES.AUTOPLAY.selected_files(self.autoplay_manifest)

    def test_autoplay_export_verifies_source_and_preserves_manifest_bytes(self):
        self.package['renderMetadata'] = []
        self.save_package()
        manifest_path = self.baked / 'manifest.json'
        manifest_bytes = json.dumps(json.loads(manifest_path.read_text()), separators=(',', ':')).encode()
        manifest_path.write_bytes(manifest_bytes)
        records = [*self.package['frames'], self.package['poster']]
        sums = ''.join(f'{record["sha256"]}  {record["path"]}\n' for record in records)
        package_hash = hashlib.sha256((self.baked / 'earth/package.json').read_bytes()).hexdigest()
        self.write('assets/celestial/baked/SHA256SUMS', (sums + f'{package_hash}  earth/package.json\n').encode())
        exported = self.root / '.render-work' / 'exported'
        with mock.patch.object(PAGES.AUTOPLAY, 'BODIES', ('earth',)), contextlib.redirect_stdout(io.StringIO()):
            PAGES.AUTOPLAY.export(self.baked, exported, 'export-test')
        self.assertEqual((exported / 'manifest.json').read_bytes(), manifest_bytes)
        inventory = json.loads((exported / 'inventory.json').read_text())
        self.assertEqual(inventory['sourceManifestSha256'], hashlib.sha256(manifest_bytes).hexdigest())
        with tarfile.open(exported / 'earth.tar') as archive:
            self.assertEqual(set(archive.getnames()), {'earth/e0/a000.webp', 'earth/e0/a001.webp', 'earth/poster.webp'})
            for member in archive:
                self.assertEqual(hashlib.sha256(archive.extractfile(member).read()).hexdigest(), inventory['files'][member.name]['sha256'])

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
