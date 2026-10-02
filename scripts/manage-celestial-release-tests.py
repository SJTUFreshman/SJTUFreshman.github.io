import contextlib
import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location('celestial_release', Path(__file__).with_name('manage-celestial-release.py'))
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class CelestialReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='celestial-release-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'source'
        self.output = self.root / 'release'
        self.host = self.root / 'host'
        self.version = '20261002-test-v1'
        self.bodies = ('earth', 'moon')
        self.grid = {'width': 3840, 'height': 2160, 'azimuthCount': 2, 'elevations': [0]}
        body_patch = mock.patch.object(RELEASE, 'BODIES', self.bodies)
        grid_patch = mock.patch.object(RELEASE, 'GRID', self.grid)
        body_patch.start()
        grid_patch.start()
        self.addCleanup(body_patch.stop)
        self.addCleanup(grid_patch.stop)
        self.write_source()

    def write_source(self):
        sums = {}
        for body in self.bodies:
            records = []
            for column in range(2):
                relative = f'{body}/e0/a{column:03d}.webp'
                path = self.source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(f'previously-validated-webp:{body}:{column}'.encode())
                digest = RELEASE.checksum(path)
                sums[relative] = digest
                records.append({'path': relative, 'sha256': digest, 'bytes': path.stat().st_size})
            poster_name = f'{body}/poster.webp'
            (self.source / poster_name).write_bytes((self.source / records[0]['path']).read_bytes())
            sums[poster_name] = records[0]['sha256']
            metadata_name = f'{body}/render-metadata/render.json'
            metadata = self.source / metadata_name
            metadata.parent.mkdir(parents=True)
            metadata.write_text('{"privateSource":"/home/private/source.blend"}', encoding='utf-8')
            sums[metadata_name] = RELEASE.checksum(metadata)
            package = {'version': 1, 'body': body, **self.grid, 'frames': records,
                       'poster': {'path': poster_name, 'source': records[0]['path'], 'sha256': records[0]['sha256']},
                       'renderMetadata': [{'path': metadata_name, 'sha256': sums[metadata_name]}]}
            package_name = f'{body}/package.json'
            RELEASE.write_json(self.source / package_name, package)
            sums[package_name] = RELEASE.checksum(self.source / package_name)
        (self.source / 'SHA256SUMS').write_text('\n'.join(f'{digest}  {name}' for name, digest in sorted(sums.items())) + '\n')

    def prepare(self, output=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return RELEASE.prepare(self.source, output or self.output, self.version)

    def install(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return RELEASE.install(self.output, self.host)

    def rewrite_archive(self, body, modify):
        manifest = RELEASE.read_json(self.output / 'release.json')
        asset = next(asset for asset in manifest['assets'] if asset['body'] == body)
        archive_path = self.output / asset['name']
        with tarfile.open(archive_path, 'r:') as archive:
            entries = [(member, archive.extractfile(member).read()) for member in archive]
        modify(entries)
        with tarfile.open(archive_path, 'w') as archive:
            for member, data in entries:
                archive.addfile(member, io.BytesIO(data) if member.isfile() else None)
        asset['bytes'] = archive_path.stat().st_size
        asset['sha256'] = RELEASE.checksum(archive_path)
        RELEASE.write_json(self.output / 'release.json', manifest)

    def assert_not_installed(self):
        self.assertFalse((self.host / 'releases' / self.version).exists())
        self.assertEqual(list((self.host / 'releases').iterdir()), [])

    def test_roundtrip_preserves_bytes_hides_provenance_and_is_idempotent(self):
        release = self.prepare()
        self.assertEqual(release['frames'], 4)
        self.assertEqual(self.prepare(), release)
        destination = self.install()
        self.assertEqual(self.install(), destination)
        public_files = list((destination / 'public').rglob('*.*'))
        self.assertEqual(len(public_files), 6)
        self.assertTrue(all(path.suffix == '.webp' for path in public_files))
        self.assertTrue((destination / 'private/earth/render-metadata/render.json').is_file())
        self.assertNotIn('/home/private', (self.output / 'release.json').read_text())
        for name in RELEASE.read_checksums(self.source / 'SHA256SUMS'):
            self.assertEqual(RELEASE.installed_path(destination, name).read_bytes(), (self.source / name).read_bytes())

    def test_reproducible_archives(self):
        first = self.prepare()
        second = self.prepare(self.root / 'other-release')
        self.assertEqual(first, second)

    def test_corrupt_archive_rejected_before_installation(self):
        release = self.prepare()
        with (self.output / release['assets'][0]['name']).open('ab') as archive:
            archive.write(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'asset checksum'):
            self.install()
        self.assert_not_installed()

    def test_frame_tampering_rejected_even_with_updated_tar_checksum(self):
        self.prepare()
        def tamper(entries):
            for index, (member, data) in enumerate(entries):
                if member.name == 'moon/e0/a001.webp':
                    entries[index] = (member, bytes([data[0] ^ 1]) + data[1:])
        self.rewrite_archive('moon', tamper)
        with self.assertRaisesRegex(ValueError, 'checksum or byte count'):
            self.install()
        self.assert_not_installed()

    def test_path_traversal_and_absolute_archive_paths_are_rejected(self):
        for path in ('earth/../../escape', '/outside', 'C:/outside', 'earth\\..\\escape'):
            with self.subTest(path=path):
                output = self.root / hashlib.sha256(path.encode()).hexdigest()[:12]
                self.prepare(output)
                previous, self.output = self.output, output
                member = tarfile.TarInfo(path)
                self.rewrite_archive('earth', lambda entries: entries.append((member, b'')))
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    self.install()
                self.assert_not_installed()
                self.output = previous

    def test_symlinks_and_hardlinks_are_rejected(self):
        self.prepare()
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
            with self.subTest(kind=kind):
                member = tarfile.TarInfo('earth/link')
                member.type = kind
                member.linkname = '/outside'
                self.rewrite_archive('earth', lambda entries: entries.append((member, b'')))
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    self.install()
                self.assert_not_installed()
                (self.output / 'release.json').unlink()
                self.prepare()

    def test_duplicate_members_are_rejected(self):
        self.prepare()
        self.rewrite_archive('earth', lambda entries: entries.append(entries[0]))
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.install()
        self.assert_not_installed()

    def test_unlisted_files_and_missing_frames_are_rejected(self):
        self.prepare()
        self.rewrite_archive('earth', lambda entries: entries.pop(0))
        with self.assertRaisesRegex(ValueError, 'inventory'):
            self.install()
        self.assert_not_installed()

    def test_existing_version_cannot_be_overwritten(self):
        self.prepare()
        destination = self.install()
        package = destination / 'public/earth/e0/a000.webp'
        package.write_bytes(b'locally changed')
        with self.assertRaisesRegex(ValueError, 'Installed file checksum'):
            self.install()
        self.assertEqual(package.read_bytes(), b'locally changed')

    def test_failed_new_version_keeps_previous_version(self):
        self.prepare()
        previous = self.install()
        self.output = self.root / 'next-release'
        self.version = '20261002-test-v2'
        release = self.prepare()
        (self.output / release['assets'][1]['name']).write_bytes(b'broken')
        with self.assertRaises(ValueError):
            self.install()
        self.assertTrue((previous / 'public/earth/poster.webp').is_file())
        self.assertFalse((self.host / 'releases' / self.version).exists())

    def test_changed_source_blocks_release_publication(self):
        (self.source / 'moon/e0/a001.webp').write_bytes(b'changed source')
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse((self.output / 'release.json').exists())

    def test_incomplete_release_and_unsafe_version_are_rejected(self):
        release = self.prepare()
        for changed in ({**release, 'frames': 3}, {**release, 'version': '../escape'},
                        {**release, 'assets': release['assets'][:1]}):
            with self.subTest(changed=changed):
                RELEASE.write_json(self.output / 'release.json', changed)
                with self.assertRaises(ValueError):
                    self.install()


if __name__ == '__main__':
    unittest.main()
