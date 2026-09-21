"""Projection and seeded calibration tests with generated test images."""
import math
import runpy
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

MODULE = runpy.run_path(str(Path(__file__).with_name('calibrate-rendered-sky.py')))


class SkyCalibrationTests(unittest.TestCase):
    def test_cardinal_projection(self):
        directions = [((.5, .5), (0, 0, 1)), ((.75, .5), (1, 0, 0)),
                      ((.25, .5), (-1, 0, 0)), ((0, .5), (0, 0, -1)),
                      ((.5, 0), (0, 1, 0)), ((.5, 1), (0, -1, 0))]
        for uv, expected in directions:
            actual = MODULE['direction_from_uv'](*uv)
            for component, target in zip(actual, expected):
                self.assertAlmostEqual(component, target, places=12)
            self.assertAlmostEqual(math.hypot(*actual), 1, places=12)

    def test_roundtrip_and_seam(self):
        for uv in ((.83, .24), (.99, .5), (.01, .7), (.42, .1)):
            direction = MODULE['direction_from_uv'](*uv)
            actual = MODULE['uv_from_direction'](direction)
            self.assertAlmostEqual(actual[0], uv[0], places=12)
            self.assertAlmostEqual(actual[1], uv[1], places=12)
        self.assertLess(MODULE['angular_distance'](MODULE['direction_from_uv'](0, .5), MODULE['direction_from_uv'](1, .5)), .000001)

    def test_invalid_coordinates(self):
        for uv in ((-.1, .5), (.5, 1.1), (float('nan'), .3)):
            with self.assertRaises(ValueError):
                MODULE['direction_from_uv'](*uv)

    def test_explicit_seed_ignores_brighter_remote_cloud(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'sky.png'
            pixels = np.full((256, 512, 3), 50, dtype=np.uint8)
            pixels[35:50, 100:120] = 255
            pixels[76:80, 420:424] = 200
            Image.fromarray(pixels).save(source)
            seed = (422 / 512, 78 / 256)
            result = MODULE['calibrate'](source, seed, uncertainty_degrees=1.2)
            self.assertEqual(result['source']['sunUV'], list(seed))
            self.assertEqual(result['source']['method'], 'explicit-uv')
            self.assertNotIn('date', result)
            self.assertNotIn('location', result)
            refined = MODULE['calibrate'](source, seed, radius_degrees=3)
            self.assertLess(MODULE['angular_distance'](result['sunDirection'], refined['sunDirection']), .8)
            self.assertEqual(refined['source']['method'], 'explicit-seeded-local-luminance-centroid')

    def test_transparent_foreground_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'foreground.png'
            Image.new('RGBA', (100, 50), (255, 255, 255, 0)).save(source)
            with self.assertRaises(ValueError):
                MODULE['calibrate'](source, (.5, .25))

    def test_seeded_refinement_wraps_seam(self):
        pixels = np.full((180, 360, 3), 20, dtype=np.uint8)
        pixels[89:91, :2] = 240
        pixels[89:91, -2:] = 240
        refined, metadata = MODULE['refine_in_seed_region'](Image.fromarray(pixels), (0, .5), 5)
        self.assertTrue(refined[0] < .01 or refined[0] > .99)
        self.assertLess(metadata['seedShiftDegrees'], .6)


if __name__ == '__main__':
    unittest.main()
