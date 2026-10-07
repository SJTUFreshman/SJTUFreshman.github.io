import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SPEC = importlib.util.spec_from_file_location('climate_assembly', Path(__file__).with_name('assemble-celestial-climate.py'))
ASSEMBLY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ASSEMBLY)


class ClimateAssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='climate-assembly-')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.master, self.climate, self.output = (root / name for name in ('master', 'climate', 'output'))
        for path in (self.master, self.climate):
            path.mkdir()
        body = self.master / 'earth'
        (body / 'e0').mkdir(parents=True)
        for column in range(2):
            image = Image.new('RGBA', (4, 4))
            image.paste((100, 150, 220, 180), (1, 1, 3, 3))
            image.save(body / f'e0/a{column:03d}.webp', 'WEBP', lossless=True)
        package = {'version': 1, 'body': 'earth', 'width': 8, 'height': 8, 'azimuthCount': 2,
                   'elevations': [0], 'presentation': {'framing': 'full-sphere',
                   'sphereRect': {'x': 0, 'y': 0, 'width': 1, 'height': 1}, 'transparent': True}}
        frames = []
        for column in range(2):
            relative = f'earth/e0/a{column:03d}.webp'
            path = self.master / relative
            frames.append({'path': relative, 'sha256': ASSEMBLY.PACKAGER.checksum(path), 'bytes': path.stat().st_size})
        package.update({'frames': frames, 'poster': {'path': 'earth/poster.webp', 'source': 'earth/e0/a000.webp',
                       'sha256': frames[0]['sha256']}, 'resolutions': []})
        (self.master / 'earth/poster.webp').write_bytes((self.master / 'earth/e0/a000.webp').read_bytes())
        (body / 'package.json').write_text(json.dumps(package), encoding='utf-8')
        climate_body = self.climate / 'earth'
        for time in range(2):
            for column in range(2):
                path = climate_body / f'clouds/t{time:03d}/e0/a{column:03d}.webp'
                path.parent.mkdir(parents=True, exist_ok=True)
                image = Image.new('RGBA', (4, 4))
                image.paste((120, 170, 220, 160), (1, 1, 3, 3))
                image.save(path, 'WEBP', lossless=True)
            report = {'body': 'earth', 'width': 4, 'height': 4, 'azimuthCount': 2, 'elevations': [0],
                      'climate': {'model': 'climate-v6', 'modelVersion': '2.1', 'timeIndex': time,
                                  'frameCount': 2, 'timePad': 3, 'timeStepSeconds': 21600,
                                  'loopSeconds': 43200, 'timeUnit': 'hours', 'surfaceReuse': 'v5'},
                      'presentation': {'framing': 'full-sphere', 'sphereRect': {'x': 0, 'y': 0, 'width': 1, 'height': 1},
                                      'transparent': True, 'cloudFramePattern': 'earth/clouds/e{elevation}/a{azimuth}.webp',
                                      'cloudWidth': 4, 'cloudHeight': 4, 'cloudTransparent': True}}
            (climate_body / f'render-t{time:03d}.json').write_text(json.dumps(report), encoding='utf-8')

    def test_assembly_hardlinks_and_replaces_static_cloud_metadata(self):
        ASSEMBLY.assemble(self.master, self.climate, self.output, frame_count=2, resolution_widths=(), bodies=('earth',))
        self.assertEqual((self.output / 'earth/e0/a000.webp').stat().st_ino,
                         (self.master / 'earth/e0/a000.webp').stat().st_ino)
        self.assertEqual((self.output / 'earth/clouds/t001/e0/a001.webp').stat().st_ino,
                         (self.climate / 'earth/clouds/t001/e0/a001.webp').stat().st_ino)
        report = json.loads((self.output / 'earth/render-assembled.json').read_text())
        self.assertEqual(report['width'], 8)
        self.assertIn('{time}', report['presentation']['cloudFramePattern'])
        self.assertEqual(report['presentation']['climate']['timeIndices'], [0, 1])
        self.assertTrue((self.output / 'earth/source-metadata/v6/render-t001.json').exists())

    def test_missing_time_or_view_never_leaves_output(self):
        (self.climate / 'earth/clouds/t001/e0/a001.webp').unlink()
        with self.assertRaisesRegex(ValueError, 'Incomplete or unexpected climate cloud grid'):
            ASSEMBLY.assemble(self.master, self.climate, self.output, frame_count=2, resolution_widths=(), bodies=('earth',))
        self.assertFalse(self.output.exists())

    def test_existing_output_and_nested_input_are_rejected(self):
        self.output.mkdir()
        with self.assertRaisesRegex(ValueError, 'already exists'):
            ASSEMBLY.assemble(self.master, self.climate, self.output, frame_count=2, resolution_widths=(), bodies=('earth',))
        with self.assertRaisesRegex(ValueError, 'separate'):
            ASSEMBLY.assemble(self.master, self.climate, self.master / 'nested', frame_count=2, resolution_widths=(), bodies=('earth',))


if __name__ == '__main__':
    unittest.main()
