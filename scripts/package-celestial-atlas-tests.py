import contextlib
import copy
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
RELEASE_SPEC = importlib.util.spec_from_file_location('celestial_release', Path(__file__).with_name('manage-celestial-release.py'))
RELEASE = importlib.util.module_from_spec(RELEASE_SPEC)
RELEASE_SPEC.loader.exec_module(RELEASE)


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

    def write_full_sphere(self, body='earth', cloud=True):
        presentation = {'framing': 'full-sphere', 'sphereRect': {'x': 0.25, 'y': 0.25, 'width': 0.5, 'height': 0.5}, 'transparent': True}
        if cloud:
            presentation.update({'cloudFramePattern': f'{body}/clouds/e{{elevation}}/a{{azimuth}}.webp',
                                 'cloudWidth': 16, 'cloudHeight': 8, 'cloudTransparent': True})
        for directory in ([body, f'{body}/clouds'] if cloud else [body]):
            for column in range(2):
                image = Image.new('RGBA', (16, 8))
                image.paste((80, column * 80, 200, 180), (4, 2, 12, 6))
                destination = self.source / directory / 'e0' / f'a{column:03d}.webp'
                destination.parent.mkdir(parents=True, exist_ok=True)
                image.save(destination, 'WEBP', lossless=True)
        (self.source / body / 'render.json').write_text(json.dumps({'body': body, 'presentation': presentation}))
        return presentation

    def test_full_sphere_and_cloud_layer_roundtrip_and_hosted_export(self):
        self.write_grid()
        presentation = self.write_full_sphere()
        hosted = self.root / 'hosted'
        self.run_package('--manifest', '--frame-base-url', 'https://cdn.example.test/full-sphere/', '--hosted-output', str(hosted))
        earth = self.read_manifest()['bodies']['earth']
        self.assertEqual(earth['sphereRect'], presentation['sphereRect'])
        self.assertTrue(earth['transparent'])
        self.assertEqual(earth['cloudFramePattern'], presentation['cloudFramePattern'])
        self.assertEqual(earth['cloudPoster'], 'earth/clouds/poster.webp')
        deployed = json.loads((hosted / 'manifest.json').read_text())['bodies']['earth']
        self.assertEqual(deployed['cloudFramePattern'], 'https://cdn.example.test/full-sphere/earth/clouds/e{elevation}/a{azimuth}.webp')
        self.assertEqual((hosted / deployed['cloudPoster']).read_bytes(), (self.output / earth['cloudPoster']).read_bytes())
        self.run_package('--verify-only', '--manifest')
        self.run_package('--verify-only', '--manifest', '--hash-only')
        sums = (self.output / 'SHA256SUMS').read_text()
        self.assertIn('earth/clouds/e0/a001.webp', sums)
        self.assertIn('earth/clouds/poster.webp', sums)

    def test_climate_cloud_time_grid_roundtrip_and_manifest_metadata(self):
        self.write_grid()
        presentation = self.write_full_sphere(cloud=False)
        presentation.update({
            'cloudFramePattern': 'earth/clouds/t{time}/e{elevation}/a{azimuth}.webp',
            'cloudWidth': 16, 'cloudHeight': 8, 'cloudTransparent': True,
            'climate': {'model': 'earth-weather-v6', 'frameCount': 2,
                        'timeStepSeconds': 3600, 'loopSeconds': 7200,
                        'timeUnit': 'seconds'}
        })
        for time in range(2):
            for column in range(2):
                image = Image.new('RGBA', (16, 8))
                image.paste((80, 100 + time * 30, 200, 180), (4, 2, 12, 6))
                destination = self.source / 'earth/clouds' / f't{time:03d}' / 'e0' / f'a{column:03d}.webp'
                destination.parent.mkdir(parents=True, exist_ok=True)
                image.save(destination, 'WEBP', lossless=True)
        (self.source / 'earth/render.json').write_text(json.dumps({'body': 'earth', 'presentation': presentation}))
        hosted = self.root / 'hosted'
        self.run_package('--manifest', '--resolution-widths', '8',
                         '--frame-base-url', 'https://cdn.example.test/climate/', '--hosted-output', str(hosted))
        package = json.loads((self.output / 'earth/package.json').read_text())
        cloud_records = package['layers']['cloud']['frames']
        self.assertEqual(len(cloud_records), 4)
        self.assertIn('earth/clouds/t001/e0/a001.webp', {record['path'] for record in cloud_records})
        self.assertEqual(package['presentation']['climate']['frameCount'], 2)
        self.assertEqual(package['presentation']['climate']['timePad'], 3)
        self.assertEqual(len(package['resolutions'][0]['layers']['cloud']['frames']), 4)
        tier_path = 'earth/resolutions/8/clouds/t001/e0/a001.webp'
        with Image.open(self.output / tier_path) as image:
            self.assertEqual(image.size, (8, 4))
        earth = self.read_manifest()['bodies']['earth']
        self.assertEqual(earth['climate']['model'], 'earth-weather-v6')
        self.assertEqual(earth['cloudFramePattern'], 'earth/clouds/t{time}/e{elevation}/a{azimuth}.webp')
        deployed = json.loads((hosted / 'manifest.json').read_text())['bodies']['earth']
        self.assertEqual(deployed['climate']['frameCount'], 2)
        self.assertEqual(deployed['resolutions'][0]['cloudFramePattern'],
                         'https://cdn.example.test/climate/earth/resolutions/8/clouds/t{time}/e{elevation}/a{azimuth}.webp')
        self.run_package('--verify-only', '--manifest', '--hash-only')
        with contextlib.redirect_stdout(io.StringIO()):
            RELEASE.prepare(self.output, self.root / 'release', '20261005-climate-multires-test')
            installed = RELEASE.install(self.root / 'release', self.root / 'host')
        self.assertEqual((installed / 'public' / tier_path).read_bytes(), (self.output / tier_path).read_bytes())
        previous = (self.output / 'manifest.json').read_bytes()
        (self.output / tier_path).unlink()
        with self.assertRaisesRegex(ValueError, 'cloud frame grid'):
            self.run_package('--verify-only', '--manifest', '--hash-only')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)

    def test_renderer_climate_reports_infer_time_pattern(self):
        self.write_grid()
        presentation = self.write_full_sphere(cloud=False)
        presentation.update({'cloudFramePattern': 'earth/clouds/e{elevation}/a{azimuth}.webp',
                             'cloudWidth': 16, 'cloudHeight': 8, 'cloudTransparent': True})
        for time in range(2):
            for column in range(2):
                image = Image.new('RGBA', (16, 8))
                image.paste((100, 120 + time * 20, 220, 180), (4, 2, 12, 6))
                destination = self.source / 'earth/clouds' / f't{time:03d}' / 'e0' / f'a{column:03d}.webp'
                destination.parent.mkdir(parents=True, exist_ok=True)
                image.save(destination, 'WEBP', lossless=True)
        (self.source / 'earth/render.json').write_text(json.dumps({'body': 'earth', 'presentation': presentation}))
        for time in range(2):
            (self.source / 'earth' / f'render-climate-{time}.json').write_text(json.dumps({
                'body': 'earth', 'climate': {'model': 'advected-noise-v1', 'timeIndex': time,
                                               'surfaceReuse': 'v5', 'interpolation': 'crossfade'}
            }))
        self.run_package('--body', 'earth')
        package = json.loads((self.output / 'earth/package.json').read_text())
        self.assertEqual(package['presentation']['cloudFramePattern'],
                         'earth/clouds/t{time}/e{elevation}/a{azimuth}.webp')
        self.assertEqual(package['presentation']['climate']['timeIndices'], [0, 1])
        self.assertEqual(len(package['layers']['cloud']['frames']), 4)

    def test_climate_time_pad_is_bounded(self):
        args = PACKAGER.parse_args(self.arguments())
        presentation = self.write_full_sphere(cloud=False)
        presentation.update({'cloudFramePattern': 'earth/clouds/t{time}/e{elevation}/a{azimuth}.webp',
                             'climate': {'frameCount': 2, 'timePad': 7}})
        with self.assertRaisesRegex(ValueError, 'timePad'):
            PACKAGER.validate_presentation('earth', presentation, args)

    def test_climate_requires_complete_time_indices_and_timed_clouds(self):
        args = PACKAGER.parse_args(self.arguments())
        presentation = self.write_full_sphere(cloud=False)
        presentation.update({'cloudFramePattern': 'earth/clouds/t{time}/e{elevation}/a{azimuth}.webp',
                             'climate': {'frameCount': 2, 'timeIndices': [0], 'interpolation': 'step'}})
        with self.assertRaisesRegex(ValueError, 'timeIndices'):
            PACKAGER.validate_presentation('earth', presentation, args)
        presentation['climate']['timeIndices'] = [0, 1]
        presentation['cloudFramePattern'] = 'earth/clouds/e{elevation}/a{azimuth}.webp'
        with self.assertRaisesRegex(ValueError, 'timed cloud'):
            PACKAGER.validate_presentation('earth', presentation, args)

    def test_climate_interpolation_and_cycle_seconds_are_bounded(self):
        args = PACKAGER.parse_args(self.arguments())
        presentation = self.write_full_sphere(cloud=False)
        presentation.update({'cloudFramePattern': 'earth/clouds/t{time}/e{elevation}/a{azimuth}.webp',
                             'climate': {'frameCount': 2, 'timeIndices': [0, 1], 'interpolation': 'motion',
                                         'cycleSeconds': 7200}})
        self.assertEqual(PACKAGER.validate_presentation('earth', presentation, args)['climate']['cycleSeconds'], 7200)
        presentation['climate']['interpolation'] = 'teleport'
        with self.assertRaisesRegex(ValueError, 'interpolation'):
            PACKAGER.validate_presentation('earth', presentation, args)

    def test_full_sphere_layer_cannot_publish_missing_or_tampered_frames(self):
        self.write_grid()
        self.write_full_sphere()
        self.run_package('--manifest')
        previous = (self.output / 'manifest.json').read_bytes()
        cloud = self.output / 'earth/clouds/e0/a001.webp'
        original = cloud.read_bytes()
        cloud.unlink()
        with self.assertRaisesRegex(ValueError, 'cloud frame grid'):
            self.run_package('--verify-only', '--manifest')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)
        cloud.write_bytes(original + b'changed')
        with self.assertRaisesRegex(ValueError, 'Frame changed after packaging'):
            self.run_package('--verify-only', '--manifest', '--hash-only')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)

    def test_full_sphere_rejects_opaque_and_clipped_images(self):
        self.write_full_sphere(cloud=False)
        target = self.source / 'earth/e0/a001.webp'
        Image.new('RGB', (16, 8), 'black').save(target, 'WEBP')
        with self.assertRaisesRegex(ValueError, 'no transparent pixels'):
            self.run_package('--body', 'earth')
        image = Image.new('RGBA', (16, 8))
        image.paste((80, 120, 200, 255), (0, 2, 12, 6))
        image.save(target, 'WEBP', lossless=True)
        with self.assertRaisesRegex(ValueError, 'clipped at the frame boundary'):
            self.run_package('--body', 'earth')

    def test_full_sphere_rejects_invalid_rect_and_external_layer_path(self):
        args = PACKAGER.parse_args(self.arguments())
        presentation = self.write_full_sphere()
        presentation['sphereRect']['width'] = 1
        with self.assertRaisesRegex(ValueError, 'outside the complete source'):
            PACKAGER.validate_presentation('earth', presentation, args)
        presentation['sphereRect']['width'] = 0.5
        presentation['cloudFramePattern'] = '../outside/e{elevation}/a{azimuth}.webp'
        with self.assertRaisesRegex(ValueError, 'Unexpected cloud layer asset path'):
            PACKAGER.validate_presentation('earth', presentation, args)

    def test_full_sphere_shards_and_package_must_agree(self):
        presentation = self.write_full_sphere(cloud=False)
        other = {**presentation, 'sphereRect': {**presentation['sphereRect'], 'width': 0.4}}
        (self.source / 'earth/render-other.json').write_text(json.dumps({'body': 'earth', 'presentation': other}))
        with self.assertRaisesRegex(ValueError, 'shards disagree'):
            self.run_package('--body', 'earth')
        (self.source / 'earth/render-other.json').unlink()
        self.run_package('--body', 'earth')
        package_path = self.output / 'earth/package.json'
        package = json.loads(package_path.read_text())
        package['presentation']['sphereRect']['width'] = 0.4
        package_path.write_text(json.dumps(package))
        with self.assertRaisesRegex(ValueError, 'presentation differs'):
            self.run_package('--verify-only', '--body', 'earth')

    def test_full_sphere_spin_axes_require_unit_vectors_and_named_coordinates(self):
        args = PACKAGER.parse_args(self.arguments())
        presentation = self.write_full_sphere()
        presentation.update({'projection': 'orthographic', 'spinAxes': [[0, 1, 0]],
                             'spinAxisCoordinates': 'right-up-toward-camera', 'angularVelocity': 0.24,
                             'cloudAngularVelocity': 0.27, 'cloudSphereRect': dict(presentation['sphereRect'])})
        self.assertEqual(PACKAGER.validate_presentation('earth', presentation, args)['spinAxes'], [[0, 1, 0]])
        presentation['spinAxes'] = [[0, 2, 0]]
        with self.assertRaisesRegex(ValueError, 'normalized spin axis'):
            PACKAGER.validate_presentation('earth', presentation, args)
        presentation['spinAxes'] = [[0, 1, 0]]
        presentation['spinAxisCoordinates'] = 'world'
        with self.assertRaisesRegex(ValueError, 'Unknown spin axis coordinates'):
            PACKAGER.validate_presentation('earth', presentation, args)

    def test_ring_layer_uses_one_azimuth_frame_per_elevation(self):
        self.write_grid()
        presentation = self.write_full_sphere(cloud=False)
        presentation.update({'ringFramePattern': 'earth/rings/e{elevation}/a000.webp',
                             'ringWidth': 16, 'ringHeight': 8, 'ringTransparent': True,
                             'ringSphereRect': {'x': 0.375, 'y': 0.375, 'width': 0.25, 'height': 0.25}})
        ring = self.source / 'earth/rings/e0/a000.webp'
        ring.parent.mkdir(parents=True, exist_ok=True)
        image = Image.new('RGBA', (16, 8))
        image.paste((220, 180, 90, 180), (1, 3, 15, 5))
        image.save(ring, 'WEBP', lossless=True)
        (self.source / 'earth/render.json').write_text(json.dumps({'body': 'earth', 'presentation': presentation}))
        self.run_package('--manifest', '--frame-base-url', 'https://cdn.example.test/rings/')
        earth = self.read_manifest()['bodies']['earth']
        self.assertEqual(earth['ringFramePattern'], 'https://cdn.example.test/rings/earth/rings/e{elevation}/a000.webp')
        self.assertEqual(earth['ringPoster'], 'https://cdn.example.test/rings/earth/rings/poster.webp')
        self.assertEqual(earth['ringSphereRect'], presentation['ringSphereRect'])
        package = json.loads((self.output / 'earth/package.json').read_text())
        self.assertEqual(package['layers']['ring']['poster']['azimuth'], 0)
        self.run_package('--verify-only', '--manifest', '--hash-only')

    def test_independent_ring_geometry_requires_complete_layer_and_valid_rectangle(self):
        args = PACKAGER.parse_args(self.arguments())
        presentation = self.write_full_sphere(cloud=False)
        presentation['ringSphereRect'] = {'x': 0.375, 'y': 0.375, 'width': 0.25, 'height': 0.25}
        with self.assertRaisesRegex(ValueError, 'Ring geometry requires a ring layer'):
            PACKAGER.validate_presentation('earth', presentation, args)
        presentation.update({'ringFramePattern': 'earth/rings/e{elevation}/a000.webp', 'ringTransparent': True})
        presentation['ringSphereRect']['width'] = 0.75
        with self.assertRaisesRegex(ValueError, 'ringSphereRect lies outside'):
            PACKAGER.validate_presentation('earth', presentation, args)
        presentation['ringSphereRect']['width'] = float('nan')
        with self.assertRaisesRegex(ValueError, 'Invalid normalized ringSphereRect'):
            PACKAGER.validate_presentation('earth', presentation, args)

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

    def test_multiresolution_derives_tiers_from_master_and_uses_lowest_preview(self):
        self.write_grid()
        hosted = self.root / 'hosted'
        self.run_package('--manifest', '--resolution-widths', '8,12',
                         '--frame-base-url', 'https://cdn.example.test/multi/',
                         '--hosted-output', str(hosted))
        package = json.loads((self.output / 'earth/package.json').read_text())
        self.assertEqual([tier['width'] for tier in package['resolutions']], [8, 12])
        for tier in package['resolutions']:
            frame = self.output / tier['frames'][0]['path']
            with Image.open(frame) as image:
                self.assertEqual(image.size, (tier['width'], tier['height']))
            self.assertEqual(tier['frames'][0]['source'], 'earth/e0/a000.webp')
            self.assertEqual(tier['frames'][0]['sourceSha256'], package['frames'][0]['sha256'])
            self.assertEqual(tier['frames'][0]['sha256'], hashlib.sha256(frame.read_bytes()).hexdigest())
            self.assertEqual(tier['poster']['source'], f'earth/resolutions/{tier["width"]}/e0/a000.webp')
            self.assertEqual((self.output / tier['poster']['path']).read_bytes(), frame.read_bytes())
        self.assertEqual((self.source / 'earth/e0/a000.webp').read_bytes(), (self.output / 'earth/e0/a000.webp').read_bytes())
        self.assertEqual(package['poster']['sha256'], package['frames'][0]['sha256'])
        manifest = self.read_manifest()['bodies']['earth']
        self.assertEqual([tier['width'] for tier in manifest['resolutions']], [8, 12, 16])
        self.assertEqual(manifest['poster'], 'earth/resolutions/8/poster.webp')
        self.assertEqual((manifest['posterWidth'], manifest['posterHeight']), (8, 4))
        deployed = json.loads((hosted / 'manifest.json').read_text())['bodies']['earth']
        self.assertEqual(deployed['resolutions'][0]['width'], 8)
        self.assertTrue(deployed['poster'].startswith('posters/earth-'))
        self.assertNotEqual(deployed['poster'], 'earth/resolutions/8/poster.webp')
        self.run_package('--verify-only', '--manifest', '--resolution-widths', '8,12', '--hash-only')

    def test_multiresolution_full_sphere_layers_scale_and_verify(self):
        self.write_grid()
        presentation = self.write_full_sphere()
        presentation.update({'ringFramePattern': 'earth/rings/e{elevation}/a000.webp',
                             'ringWidth': 32, 'ringHeight': 16, 'ringTransparent': True,
                             'ringSphereRect': dict(presentation['sphereRect'])})
        ring = self.source / 'earth/rings/e0/a000.webp'
        ring.parent.mkdir(parents=True)
        image = Image.new('RGBA', (32, 16))
        image.paste((120, 180, 220, 200), (8, 4, 24, 12))
        image.save(ring, 'WEBP', lossless=True)
        (self.source / 'earth/render.json').write_text(json.dumps({'body': 'earth', 'presentation': presentation}))
        hosted = self.root / 'hosted'
        self.run_package('--manifest', '--resolution-widths', '8', '--poster-frame', 'earth:0:1',
                         '--frame-base-url', 'https://cdn.example.test/tiers/', '--hosted-output', str(hosted))
        package = json.loads((self.output / 'earth/package.json').read_text())
        tier = package['resolutions'][0]
        self.assertEqual(tier['layers']['cloud']['poster']['width'], 8)
        self.assertEqual(tier['layers']['cloud']['poster']['height'], 4)
        self.assertEqual(tier['layers']['cloud']['width'], 8)
        self.assertEqual(tier['layers']['ring']['width'], 16)
        self.assertEqual(tier['layers']['ring']['height'], 8)
        self.assertEqual(tier['layers']['ring']['poster']['azimuth'], 0)
        self.assertEqual(tier['layers']['cloud']['poster']['azimuth'], 1)
        self.assertTrue((self.output / 'earth/resolutions/8/clouds/e0/a000.webp').is_file())
        self.run_package('--verify-only', '--manifest', '--resolution-widths', '8')
        earth = json.loads((hosted / 'manifest.json').read_text())['bodies']['earth']
        self.assertEqual(earth['cloudPosterWidth'], 8)
        self.assertEqual(earth['ringPosterWidth'], 16)
        for variant in earth['resolutions']:
            for field in ('framePattern', 'cloudFramePattern', 'ringFramePattern'):
                path = variant[field].replace('{elevation}', '0').replace('{azimuth}', '001')
                self.assertNotIn('{', path)
                self.assertNotIn('}', path)
                relative = path.removeprefix('https://cdn.example.test/tiers/')
                self.assertTrue((self.output / relative).is_file(), relative)
            for field in ('poster', 'cloudPoster', 'ringPoster'):
                self.assertTrue((hosted / variant[field]).is_file())
            self.assertEqual(variant['ringSphereRect'], presentation['sphereRect'])
        with contextlib.redirect_stdout(io.StringIO()):
            release = RELEASE.prepare(self.output, self.root / 'release', '20261004-multires-test')
            destination = RELEASE.install(self.root / 'release', self.root / 'host')
        self.assertEqual(release['grid']['width'], 16)
        for name, digest in RELEASE.read_checksums(self.output / 'SHA256SUMS').items():
            self.assertEqual(RELEASE.checksum(RELEASE.installed_path(destination, name)), digest)

    def test_multiresolution_missing_or_tampered_frames_preserve_manifest(self):
        self.write_grid()
        self.run_package('--manifest', '--resolution-widths', '8,12')
        previous = (self.output / 'manifest.json').read_bytes()
        target = self.output / 'earth/resolutions/8/e0/a001.webp'
        original = target.read_bytes()
        target.unlink()
        with self.assertRaisesRegex(ValueError, 'Incomplete or unexpected 8px frame grid'):
            self.run_package('--verify-only', '--manifest', '--hash-only')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)
        target.write_bytes(original + b'tampered')
        with self.assertRaisesRegex(ValueError, 'Frame changed after packaging'):
            self.run_package('--verify-only', '--manifest', '--hash-only')
        self.assertEqual((self.output / 'manifest.json').read_bytes(), previous)

    def test_multiresolution_rejects_invalid_records_and_posters(self):
        self.write_full_sphere()
        self.run_package('--body', 'earth', '--resolution-widths', '8,12')
        path = self.output / 'earth/package.json'
        original = json.loads(path.read_text())
        cases = [
            ('source', lambda package: package['resolutions'][0]['frames'][0].update(source='earth/e0/a001.webp')),
            ('source', lambda package: package['resolutions'][0]['layers']['cloud']['frames'][0].update(sourceSha256='0' * 64)),
            ('selected viewpoint', lambda package: package['resolutions'][0]['poster'].update(source='earth/resolutions/8/e0/a001.webp')),
            ('selected viewpoint', lambda package: package['resolutions'][0]['layers']['cloud']['poster'].update(azimuth=1)),
            ('order', lambda package: package['resolutions'].reverse()),
            ('order', lambda package: package['resolutions'].append(copy.deepcopy(package['resolutions'][0]))),
            ('Invalid derived resolution', lambda package: package['resolutions'][0].update(width=0)),
            ('Invalid derived resolution', lambda package: package['resolutions'][0].update(width=True)),
            ('dimensions', lambda package: package['resolutions'][0].update(height=5)),
            ('dimensions', lambda package: package['resolutions'][0]['layers']['cloud'].update(width=16)),
            ('frame records', lambda package: package['resolutions'][0]['frames'].pop()),
        ]
        for message, mutate in cases:
            with self.subTest(message=message):
                package = copy.deepcopy(original)
                mutate(package)
                path.write_text(json.dumps(package))
                with self.assertRaisesRegex(ValueError, message):
                    self.run_package('--verify-only', '--body', 'earth', '--hash-only')
        path.write_text(json.dumps(original))
        with self.assertRaisesRegex(ValueError, 'requested tiers'):
            self.run_package('--verify-only', '--body', 'earth', '--resolution-widths', '8', '--hash-only')
        poster_path = self.output / original['resolutions'][0]['poster']['path']
        other_frame = self.output / 'earth/resolutions/8/e0/a001.webp'
        poster_path.write_bytes(other_frame.read_bytes())
        original['resolutions'][0]['poster']['sha256'] = PACKAGER.checksum(poster_path)
        path.write_text(json.dumps(original))
        with self.assertRaisesRegex(ValueError, 'poster differs from its selected frame'):
            self.run_package('--verify-only', '--body', 'earth', '--hash-only')

    def test_multiresolution_argument_validation(self):
        for widths in ('', '8,8', '0,8', '8,16', '4k', '-1,8'):
            with self.subTest(widths=widths), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    PACKAGER.parse_args(self.arguments(f'--resolution-widths={widths}'))
        self.assertEqual(PACKAGER.parse_args(self.arguments('--resolution-widths', '12,8')).resolution_widths, [8, 12])

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
