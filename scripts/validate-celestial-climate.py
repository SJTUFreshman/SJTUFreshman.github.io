import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

import importlib.util


SPEC = importlib.util.spec_from_file_location('celestial_climate', Path(__file__).with_name('generate-celestial-climate.py'))
CLIMATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLIMATE)


class CelestialClimateTests(unittest.TestCase):
    def source(self, directory):
        height, width = 48, 96
        rows = np.linspace(0, 1, height)[:, None]
        columns = np.linspace(0, 1, width, endpoint=False)[None, :]
        values = (0.5 + 0.5 * np.sin(columns * 11 + rows * 7)) * 255
        path = directory / 'clouds.png'
        Image.fromarray(values.astype('uint8'), 'L').save(path)
        return path

    def test_arguments_reject_invalid_time_axis(self):
        with self.assertRaises(SystemExit):
            CLIMATE.arguments(['--input', 'cloud.png', '--output', 'out', '--frames', '1'])
        with self.assertRaises(SystemExit):
            CLIMATE.arguments(['--input', 'cloud.png', '--output', 'out', '--step-hours', '0'])
        with self.assertRaises(SystemExit):
            CLIMATE.arguments(['--input', 'cloud.png', '--output', 'out', '--chunk-rows', '0'])
        with self.assertRaises(SystemExit):
            CLIMATE.arguments(['--input', 'cloud.png', '--output', 'out', '--frames', '4',
                               '--step-hours', '6', '--period-hours', '30'])

    def test_default_playback_is_a_24_hour_single_frame_loop(self):
        args = CLIMATE.arguments(['--input', 'cloud.png', '--output', 'out'])
        self.assertEqual(args.frames, 8)
        self.assertEqual(args.step_hours, 3)
        self.assertEqual(args.period_hours, 24)
        self.assertEqual(args.interpolation, 'step')

    def test_keyframes_are_deterministic_and_evolve_density(self):
        with tempfile.TemporaryDirectory(prefix='celestial-climate-') as temporary:
            root = Path(temporary)
            source = self.source(root)
            first = root / 'first'
            second = root / 'second'
            CLIMATE.main(['--input', str(source), '--output', str(first), '--frames', '4', '--step-hours', '6', '--width', '96', '--height', '48'])
            CLIMATE.main(['--input', str(source), '--output', str(second), '--frames', '4', '--step-hours', '6', '--width', '96', '--height', '48'])
            first_frames = [np.asarray(Image.open(path)) for path in sorted(first.glob('t*.png'))]
            second_frames = [np.asarray(Image.open(path)) for path in sorted(second.glob('t*.png'))]
            self.assertEqual(len(first_frames), 4)
            self.assertTrue(any(np.any(left != right) for left, right in zip(first_frames, first_frames[1:])))
            self.assertTrue(all(np.array_equal(left, right) for left, right in zip(first_frames, second_frames)))
            means = [float(frame.mean()) for frame in first_frames]
            self.assertGreater(max(means) - min(means), 0.005,
                               'Lifecycle should change total cloud coverage over time')
            adjacent_change = float(np.mean(np.abs(first_frames[1].astype(np.float32) - first_frames[0])))
            self.assertGreater(adjacent_change, 2.0,
                               'Moisture transport and cloud lifecycle should change adjacent frames')
            metadata = json.loads((first / 'climate.json').read_text(encoding='utf-8'))
            self.assertEqual(metadata['surfaceReuse'], 'v5')
            self.assertEqual(metadata['interpolation'], 'step')
            self.assertEqual(metadata['frameCount'], 4)
            self.assertEqual(metadata['timeStepSeconds'], 21600)
            self.assertEqual(metadata['loopSeconds'], 86400)
            self.assertEqual(metadata['source'], source.name)
            self.assertEqual(metadata['modelVersion'], '2.1')
            self.assertEqual(metadata['model'], 'moisture-lifecycle-v2.1')
            self.assertEqual(metadata['body'], 'earth')
            self.assertEqual(metadata['timePad'], 3)
            self.assertIn('single-frame evaluation', metadata['simulation'])
            self.assertIn('no temporal accumulation', metadata['simulation'])
            self.assertIn('premultiplied-alpha', metadata['description'])
            self.assertIn('sampled every 6 hours', metadata['description'])
            self.assertEqual(metadata['periodHours'], 24.0)
            self.assertIn('condensation', metadata['cloudLifecycle'])
            self.assertIn('rainout', metadata['densityModel'])

    def test_longitude_wrap_is_continuous(self):
        source = np.arange(24, dtype=np.float32).reshape(4, 6)
        x = np.array([[5.8, 0.2]], dtype=np.float32)
        y = np.array([[1.0, 1.0]], dtype=np.float32)
        values = CLIMATE.bilinear_wrap(source, x, y)
        self.assertAlmostEqual(float(values[0, 0]), float(values[0, 1]), delta=1.5)

    def test_transport_returns_exactly_after_whole_periods(self):
        args = CLIMATE.arguments(['--input', 'cloud.png', '--output', 'out', '--frames', '8', '--step-hours', '3'])
        first_x, first_y, *unused = CLIMATE.transport_coordinates(2048, 1024, 0, args)
        for frame in (-8, 8, 800):
            with self.subTest(frame=frame):
                wrapped_x, wrapped_y, *unused = CLIMATE.transport_coordinates(2048, 1024, frame, args)
                self.assertTrue(np.array_equal(first_x, wrapped_x))
                self.assertTrue(np.array_equal(first_y, wrapped_y))

    def test_chunked_frame_matches_single_chunk_evaluation(self):
        with tempfile.TemporaryDirectory(prefix='celestial-climate-chunks-') as temporary:
            root = Path(temporary)
            source_path = self.source(root)
            args = CLIMATE.arguments([
                '--input', str(source_path), '--output', str(root / 'out'),
                '--frames', '4', '--step-hours', '6', '--width', '96', '--height', '48',
                '--chunk-rows', '7',
            ])
            source = CLIMATE.resize_source(Image.open(source_path), 96, 48)
            noise_fields, storm_field = self.climate_inputs(args, source)
            chunked = CLIMATE.climate_frame(source, 2, args, noise_fields, storm_field)
            args.chunk_rows = source.shape[0]
            whole = CLIMATE.climate_frame(source, 2, args, noise_fields, storm_field)
            self.assertTrue(np.array_equal(chunked, whole))

    def climate_inputs(self, args, source):
        noise_fields = (CLIMATE.smooth_noise(96, 48, args.seed + 11, 42),
                        CLIMATE.smooth_noise(96, 48, args.seed + 23, 11))
        storm_field = CLIMATE.smooth_noise(96, 48, args.seed + 37, 68)
        return noise_fields, storm_field

    def test_lifecycle_is_phase_periodic_and_smooth(self):
        with tempfile.TemporaryDirectory(prefix='celestial-climate-period-') as temporary:
            root = Path(temporary)
            source_path = self.source(root)
            args = CLIMATE.arguments([
                '--input', str(source_path), '--output', str(root / 'out'),
                '--frames', '6', '--step-hours', '5', '--width', '96', '--height', '48',
            ])
            source = CLIMATE.resize_source(Image.open(source_path), 96, 48)
            noise_fields, storm_field = self.climate_inputs(args, source)
            for body in ('earth', 'mars'):
                with self.subTest(body=body):
                    args.body = body
                    first = CLIMATE.climate_frame(source, 0, args, noise_fields, storm_field)
                    wrapped = CLIMATE.climate_frame(source, args.frames, args, noise_fields, storm_field)
                    self.assertTrue(np.array_equal(first, wrapped),
                                    'The climate sequence should return exactly to its initial phase')
                    near_start = CLIMATE.climate_frame(source, 0.01, args, noise_fields, storm_field, quantize=False)
                    near_end = CLIMATE.climate_frame(source, args.frames - 0.01, args, noise_fields, storm_field, quantize=False)
                    self.assertLess(float(np.mean(np.abs(near_start - near_end))), 0.01,
                                    'The closed loop should have a continuous seam before quantization')

    def test_mars_metadata_uses_the_mars_profile(self):
        with tempfile.TemporaryDirectory(prefix='celestial-climate-mars-') as temporary:
            root = Path(temporary)
            source = self.source(root)
            output = root / 'mars'
            CLIMATE.main(['--input', str(source), '--output', str(output), '--body', 'mars', '--frames', '8', '--step-hours', '3'])
            metadata = json.loads((output / 'climate.json').read_text(encoding='utf-8'))
            self.assertEqual(metadata['body'], 'mars')
            self.assertEqual(metadata['frameCount'], 8)
            self.assertEqual(metadata['timeStepSeconds'], 10800)
            self.assertEqual(metadata['loopSeconds'], 86400)
            self.assertEqual(metadata['moistureModel'], 'cold-belt-sparse-vapor-proxy')
            self.assertEqual(metadata['convergenceModel'], 'frontal-wave-lift')

    def test_metadata_describes_single_frame_playback_without_accumulation(self):
        with tempfile.TemporaryDirectory(prefix='celestial-climate-playback-') as temporary:
            root = Path(temporary)
            source = self.source(root)
            output = root / 'earth'
            CLIMATE.main(['--input', str(source), '--output', str(output), '--body', 'earth',
                          '--frames', '8', '--step-hours', '3'])
            metadata = json.loads((output / 'climate.json').read_text(encoding='utf-8'))
            self.assertEqual(metadata['frameCount'], 8)
            self.assertEqual(metadata['timeStepSeconds'], 10800)
            self.assertEqual(metadata['loopSeconds'], 86400)
            self.assertEqual(metadata['interpolation'], 'step')
            self.assertIn('single-frame', metadata['simulation'])
            self.assertIn('no temporal blending or frame accumulation', metadata['description'])

    def test_body_profiles_are_distinct_and_retain_source_detail(self):
        with tempfile.TemporaryDirectory(prefix='celestial-climate-body-') as temporary:
            root = Path(temporary)
            source_path = self.source(root)
            source = CLIMATE.resize_source(Image.open(source_path), 96, 48)
            earth_args = CLIMATE.arguments(['--input', str(source_path), '--output', str(root / 'earth'), '--body', 'earth'])
            mars_args = CLIMATE.arguments(['--input', str(source_path), '--output', str(root / 'mars'), '--body', 'mars'])
            earth_noise, earth_storm = self.climate_inputs(earth_args, source)
            mars_noise, mars_storm = self.climate_inputs(mars_args, source)
            earth = CLIMATE.climate_frame(source, 2, earth_args, earth_noise, earth_storm, quantize=False)
            mars = CLIMATE.climate_frame(source, 2, mars_args, mars_noise, mars_storm, quantize=False)
            self.assertGreater(float(np.corrcoef(source.ravel(), earth.ravel())[0, 1]), 0.70)
            self.assertGreater(float(np.mean(np.abs(earth - mars))), 0.002)


if __name__ == '__main__':
    unittest.main()
