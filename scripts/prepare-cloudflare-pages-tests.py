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
        for relative in PAGES.ROOT_FILES:
            self.write(relative, b'website')
        self.write('images/千島湖.jpg', b'photo')
        self.write('documents/证书.pdf', b'certificate')
        self.write('assets/mochi/frames/idle/idle-00.png', b'pet frame')
        self.write('assets/mochi/build.py', b'private build source')
        self.write('assets/.env', b'PRIVATE=value')
        self.write('assets/celestial/hosted/manifest.json', b'old manifest')
        self.write('assets/celestial/releases/old/earth.webp', b'old frame')
        self.write('assets/celestial/baked/earth/poster.webp', b'old poster')
        self.write('assets/mochi/package.json', b'private package')
        self.write('assets/mochi/render-metadata/render.json', b'private metadata')
        self.write('.render-work/original.blend', b'private source')
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True, capture_output=True)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True, capture_output=True)
        self.write('assets/untracked.png', b'not part of the website')

    def write(self, relative, data):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return target

    def prepare(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return PAGES.prepare(self.root, self.output)

    def test_public_website_preserves_assets_and_excludes_retired_atlas_and_sources(self):
        report = self.prepare()
        for relative in [*PAGES.ROOT_FILES, 'images/千島湖.jpg', 'documents/证书.pdf',
                         'assets/mochi/frames/idle/idle-00.png', '404.html', '_headers']:
            self.assertTrue((self.output / relative).is_file(), relative)
        for relative in ['assets/.env', 'assets/mochi/build.py', 'assets/untracked.png',
                         'assets/celestial', 'assets/mochi/package.json',
                         'assets/mochi/render-metadata', '.render-work']:
            self.assertFalse((self.output / relative).exists(), relative)
        self.assertEqual(report['fileCount'], len(report['files']))
        self.assertEqual(report['totalBytes'], sum(record['bytes'] for record in report['files'].values()))
        for relative, record in report['files'].items():
            data = (self.output / relative).read_bytes()
            self.assertEqual(record, {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        saved_report = json.loads(self.output.with_name('site-report.json').read_text(encoding='utf-8'))
        self.assertEqual(saved_report, report)
        self.write('images/千島湖.jpg', b'changed source')
        self.assertEqual((self.output / 'images/千島湖.jpg').read_bytes(), b'photo')

    def test_missing_website_entry_is_rejected(self):
        (self.root / 'life.html').unlink()
        with self.assertRaisesRegex(ValueError, 'regular file'):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_corrupt_copy_cannot_produce_success_report(self):
        original_copy = PAGES.copy_entry
        def corrupt_copy(entry, destination):
            return original_copy({**entry, 'sha256': '0' * 64}, destination)
        with mock.patch.object(PAGES, 'copy_entry', corrupt_copy), self.assertRaisesRegex(ValueError, 'SHA256 mismatch'):
            self.prepare()
        self.assertFalse(self.output.with_name('site-report.json').exists())

    def test_nonempty_output_and_existing_report_are_never_overwritten(self):
        sentinel = self.write('.render-work/pages/site/sentinel.txt', b'keep me')
        with self.assertRaisesRegex(ValueError, 'new or empty'):
            self.prepare()
        self.assertEqual(sentinel.read_bytes(), b'keep me')
        sentinel.unlink()
        report = self.write('.render-work/pages/site-report.json', b'old report')
        with self.assertRaisesRegex(ValueError, 'Report already exists'):
            self.prepare()
        self.assertEqual(report.read_bytes(), b'old report')

    def test_outputs_outside_work_directory_and_root_itself_are_rejected(self):
        for output in [self.root / 'assets', self.root / '.render-work', self.root.parent / 'outside']:
            with self.subTest(output=output), self.assertRaises(ValueError):
                PAGES.validate_output(self.root, output)

    def test_source_path_traversal_is_rejected(self):
        for relative in ['../escape', '/escape', 'images\\secret', 'C:secret', 'images/../secret']:
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                PAGES.source_file(self.root, relative)

    def test_file_size_and_count_limits_are_enforced_before_copy(self):
        with mock.patch.object(PAGES, 'MAX_BYTES', 1), self.assertRaisesRegex(ValueError, '25 MiB'):
            self.prepare()
        with mock.patch.object(PAGES, 'MAX_FILES', 1), self.assertRaisesRegex(ValueError, 'file limit'):
            self.prepare()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
