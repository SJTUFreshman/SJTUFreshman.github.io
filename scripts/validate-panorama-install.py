"""Exercise review-resource installation in temporary directories only."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image


SPEC = importlib.util.spec_from_file_location('panorama_install', Path(__file__).with_name('install-panorama.py'))
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class PanoramaInstallationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='panorama-install-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.foreground = self.root / 'foreground.png'
        image = Image.new('RGBA', (128, 64), (90, 100, 110, 255))
        image.paste((0, 0, 0, 0), (0, 0, 128, 32))
        image.save(self.foreground)
        self.export = self.root / 'scene.json'
        self.observation = {'position': [1, 2, 3], 'yaw': .2, 'pitch': .05}
        self.export.write_text(json.dumps({'scene': 'spaceship', 'coordinateSystem': 'three-y-up-right-handed', 'observation': self.observation}), encoding='utf-8')
        self.args = argparse.Namespace(scene='spaceship', phase='night', foreground=str(self.foreground), scene_json=str(self.export), sky=None, sky_metadata=None, manifest=str(self.root / 'assets/life/panoramas/manifest.json'), output_dir=None, site_root=str(self.root), orientation=[0, 0, 0, 1], dry_run=False)

    def test_small_source_is_native_low_not_upscaled(self):
        result = INSTALLER.install(self.args)
        self.assertEqual(list(result['tiers']), ['low'])
        entry = result['tiers']['low']
        self.assertEqual((entry['width'], entry['height']), (128, 64))
        with Image.open(self.root / entry['src']) as image:
            self.assertEqual(image.size, (128, 64))
            self.assertEqual(image.getchannel('A').getextrema(), (0, 255))
        catalog = json.loads(Path(self.args.manifest).read_text(encoding='utf-8'))
        scene = catalog['scenes']['spaceship']
        self.assertEqual(scene['observation'], self.observation)
        self.assertEqual(scene['pilot']['seat'], self.observation['position'])
        self.assertEqual(scene['variants']['night']['production'], 'review')
        self.assertNotIn('approved', json.dumps(catalog))
        self.assertEqual(INSTALLER.install(self.args)['tiers'], result['tiers'])

    def test_tiers_only_include_real_source_resolution(self):
        self.assertEqual(INSTALLER.tier_dimensions(4096, 2048), [('low', 2048, 1024), ('medium', 4096, 2048)])
        self.assertEqual(INSTALLER.tier_dimensions(8192, 4096)[-1], ('high', 8192, 4096))
        self.assertEqual(INSTALLER.tier_dimensions(16384, 8192),
                         [('low', 2048, 1024), ('medium', 4096, 2048),
                          ('high', 8192, 4096), ('ultra', 12288, 6144)])
        self.assertTrue(all(width < 16384 for _, width, _ in INSTALLER.tier_dimensions(32768, 16384)))

    def test_reject_opaque_foreground(self):
        Image.new('RGB', (128, 64), 'black').save(self.foreground)
        with self.assertRaisesRegex(ValueError, 'transparent sky'):
            INSTALLER.install(self.args)
        self.assertFalse(Path(self.args.manifest).exists())

    def test_authored_sky_preserves_complete_opaque_scene(self):
        Image.new('RGB', (128, 64), (50, 100, 150)).save(self.foreground)
        self.args.authored_sky = True
        result = INSTALLER.install(self.args)
        variant = json.loads(Path(self.args.manifest).read_text())['scenes']['spaceship']['variants']['night']
        self.assertEqual(variant['background'], 'authored-sky')
        self.assertNotIn('sky', variant)
        with Image.open(self.root / result['tiers']['low']['src']) as image:
            self.assertEqual(image.convert('RGBA').getchannel('A').getextrema(), (255, 255))
        self.args.sky = str(self.foreground)
        with self.assertRaisesRegex(ValueError, 'separate --sky'):
            INSTALLER.install(self.args)

    def test_authored_sky_rejects_transparency_without_changing_manifest(self):
        INSTALLER.install(self.args)
        before = Path(self.args.manifest).read_bytes()
        self.args.authored_sky = True
        with self.assertRaisesRegex(ValueError, 'fully opaque'):
            INSTALLER.install(self.args)
        self.assertEqual(Path(self.args.manifest).read_bytes(), before)

    def test_reject_camera_mismatch(self):
        INSTALLER.install(self.args)
        exported = json.loads(self.export.read_text())
        exported['observation']['position'] = [4, 5, 6]
        self.export.write_text(json.dumps(exported), encoding='utf-8')
        before = Path(self.args.manifest).read_bytes()
        with self.assertRaisesRegex(ValueError, 'observation differs'):
            INSTALLER.install(self.args)
        self.assertEqual(Path(self.args.manifest).read_bytes(), before)

    def test_reject_scene_or_aspect_mismatch(self):
        self.args.scene = 'shelter'
        with self.assertRaisesRegex(ValueError, 'scene ID'):
            INSTALLER.install(self.args)
        self.args.scene = 'spaceship'
        Image.new('RGBA', (128, 60)).save(self.foreground)
        with self.assertRaisesRegex(ValueError, '2:1'):
            INSTALLER.install(self.args)

    def test_dry_run_writes_nothing(self):
        self.args.dry_run = True
        result = INSTALLER.install(self.args)
        self.assertTrue(result['dryRun'])
        self.assertFalse(Path(self.args.manifest).exists())

    def test_authored_phases_override_legacy_city_policy(self):
        self.args.scene, self.args.phase = 'shelter', 'clear'
        exported = {'scene': 'shelter', 'coordinateSystem': 'three-y-up-right-handed',
                    'observation': self.observation, 'supportedPhases': ['clear', 'dusk'],
                    'defaultPhase': 'dusk'}
        self.export.write_text(json.dumps(exported))
        INSTALLER.install(self.args)
        entry = json.loads(Path(self.args.manifest).read_text())['scenes']['shelter']
        self.assertEqual(entry['supportedPhases'], ['clear', 'dusk'])
        self.assertEqual(entry['sky'], 'dusk')
        self.args.phase = 'night'
        with self.assertRaisesRegex(ValueError, 'supportedPhases'):
            INSTALLER.install(self.args)

    def test_fontaine_requires_explicit_phase_metadata(self):
        self.assertIn('fontainesaintmichel', INSTALLER.SCENES)
        self.args.scene, self.args.phase = 'fontainesaintmichel', 'clear'
        exported = {'scene': self.args.scene, 'coordinateSystem': 'three-y-up-right-handed',
                    'observation': self.observation}
        self.export.write_text(json.dumps(exported))
        with self.assertRaisesRegex(ValueError, 'supportedPhases'):
            INSTALLER.install(self.args)
        exported['supportedPhases'] = ['clear']
        self.export.write_text(json.dumps(exported))
        self.assertEqual(INSTALLER.install(self.args)['supportedPhases'], ['clear'])

    def test_replace_scene_discards_stale_metadata_and_variants(self):
        INSTALLER.install(self.args)
        catalog = json.loads(Path(self.args.manifest).read_text())
        catalog['scenes']['shelter'] = {'sentinel': 'keep other scenes'}
        old = catalog['scenes']['spaceship']
        old['pilot']['exit'] = [8, 9, 10]
        old['source'] = {'name': 'old source'}
        old['legacyExtra'] = True
        old['variants']['clear'] = {'tiers': {}}
        Path(self.args.manifest).write_text(json.dumps(catalog))
        exported = json.loads(self.export.read_text())
        exported['observation']['position'] = [4, 5, 6]
        self.export.write_text(json.dumps(exported))
        self.args.replace_scene = True
        self.args.dry_run = True
        before = Path(self.args.manifest).read_bytes()
        self.assertEqual(INSTALLER.install(self.args)['removedVariants'], ['night', 'clear'])
        self.assertEqual(Path(self.args.manifest).read_bytes(), before)
        self.args.dry_run = False
        INSTALLER.install(self.args)
        catalog = json.loads(Path(self.args.manifest).read_text())
        entry = catalog['scenes']['spaceship']
        self.assertEqual(list(entry['variants']), ['night'])
        self.assertEqual(entry['pilot'], {'seat': [4, 5, 6]})
        self.assertNotIn('source', entry)
        self.assertNotIn('legacyExtra', entry)
        self.assertEqual(catalog['scenes']['shelter'], {'sentinel': 'keep other scenes'})
        self.args.replace_scene = False
        exported['supportedPhases'] = ['night', 'clear']
        exported['source'] = {'name': 'fresh source'}
        self.export.write_text(json.dumps(exported))
        self.args.phase = 'clear'
        INSTALLER.install(self.args)
        entry = json.loads(Path(self.args.manifest).read_text())['scenes']['spaceship']
        self.assertEqual(list(entry['variants']), ['night', 'clear'])
        self.assertEqual(entry['source'], {'name': 'fresh source'})

    def test_phase_removal_needs_explicit_replacement(self):
        self.args.scene, self.args.phase = 'snowmountain', 'dusk'
        exported = {'scene': self.args.scene, 'coordinateSystem': 'three-y-up-right-handed',
                    'observation': self.observation}
        self.export.write_text(json.dumps(exported))
        INSTALLER.install(self.args)
        exported['supportedPhases'] = ['clear']
        self.export.write_text(json.dumps(exported))
        self.args.phase = 'clear'
        with self.assertRaisesRegex(ValueError, 'replace-scene'):
            INSTALLER.install(self.args)

    def test_replacement_failure_leaves_existing_manifest_unchanged(self):
        INSTALLER.install(self.args)
        before = Path(self.args.manifest).read_bytes()
        self.args.replace_scene = True
        with patch.object(INSTALLER, 'encode_tiers', side_effect=OSError('fixture encoder failure')):
            with self.assertRaisesRegex(OSError, 'encoder failure'):
                INSTALLER.install(self.args)
        self.assertEqual(Path(self.args.manifest).read_bytes(), before)

    def test_sky_tiers_and_metadata(self):
        sky = self.root / 'sky.png'
        metadata = self.root / 'sky.json'
        Image.new('RGB', (256, 128), 'blue').save(sky)
        metadata.write_text(json.dumps({'kind': 'art-direction-calibration', 'coordinateSystem': 'sky-y-up-plus-z', 'sunDirection': [0, 3, 4], 'source': {'name': 'test fixture'}}), encoding='utf-8')
        self.args.sky, self.args.sky_metadata = str(sky), str(metadata)
        self.args.sky_orientation = [0, 2, 0, 2]
        INSTALLER.install(self.args)
        variant = json.loads(Path(self.args.manifest).read_text())['scenes']['spaceship']['variants']['night']
        self.assertEqual(variant['sky']['tiers']['low']['width'], 256)
        self.assertEqual(variant['sky']['observation']['sunDirection'], [0, .6, .8])
        self.assertEqual(variant['sky']['observation']['source']['name'], 'test fixture')
        self.assertEqual(variant['orientation'], [0, 0, 0, 1])
        self.assertAlmostEqual(variant['sky']['orientation'][1], 2 ** -.5)

    def test_reject_ambiguous_sky_calibration(self):
        for metadata in [None, {}, {'date': '2026-09-09T03:54:07Z'}, {'kind': 'art-direction-calibration', 'coordinateSystem': 'wrong', 'sunDirection': [0, 1, 0]}]:
            with self.subTest(metadata=metadata), self.assertRaisesRegex(ValueError, 'art-direction-calibration'):
                INSTALLER.sky_calibration_metadata(metadata)
        calibration = {'kind': 'art-direction-calibration', 'coordinateSystem': 'sky-y-up-plus-z', 'sunDirection': [0, 1, 0]}
        for direction in [[0, 0, 0], [0, True, 0], [0, float('inf'), 0], [0, 1]]:
            with self.subTest(direction=direction), self.assertRaisesRegex(ValueError, 'sunDirection'):
                INSTALLER.sky_calibration_metadata({**calibration, 'sunDirection': direction})
        with self.assertRaisesRegex(ValueError, 'must not claim'):
            INSTALLER.sky_calibration_metadata({**calibration, 'date': '2026-09-09T03:54:07Z'})
        with self.assertRaisesRegex(ValueError, 'requires --sky'):
            self.args.sky_orientation = [0, 0, 0, 1]
            INSTALLER.install(self.args)

    def test_sky_calibration_is_bound_to_image(self):
        sky = self.root / 'sky.png'
        metadata = self.root / 'sky.json'
        Image.new('RGB', (128, 64), 'blue').save(sky)
        calibration = {'kind': 'art-direction-calibration', 'coordinateSystem': 'sky-y-up-plus-z',
                       'sunDirection': [0, 1, 0], 'source': {'renderedImageSha256': '0' * 64}}
        metadata.write_text(json.dumps(calibration), encoding='utf-8')
        self.args.sky, self.args.sky_metadata = str(sky), str(metadata)
        with self.assertRaisesRegex(ValueError, 'calibration hash'):
            INSTALLER.install(self.args)
        self.assertFalse(Path(self.args.manifest).exists())
        calibration['source']['renderedImageSha256'] = hashlib.sha256(sky.read_bytes()).hexdigest()
        metadata.write_text(json.dumps(calibration), encoding='utf-8')
        self.assertIn('skyTiers', INSTALLER.install(self.args))


if __name__ == '__main__':
    unittest.main()
