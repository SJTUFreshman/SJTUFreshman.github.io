import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main():
    root = Path(__file__).resolve().parent
    scene_reports = json.loads((root / 'logs' / 'scene_lighting_report.json').read_text(encoding='utf-8'))
    sizes = {'shengsi': (2400, 1600), 'china': (2480, 2000), 'hainan': (2000, 2400), 'fujian_taiwan': (2000, 2300)}
    results = {}
    for map_id, expected_size in sizes.items():
        composed_path = root / 'outputs' / (map_id + '.png')
        blender_path = root / 'outputs' / (map_id + '_blender.png')
        scene_path = root / 'scenes' / (map_id + '.blend')
        labels_path = root / 'outputs' / (map_id + '_labels.png')
        with Image.open(composed_path) as composed, Image.open(blender_path) as rendered, Image.open(labels_path) as labels:
            assert composed.size == expected_size, (map_id, composed.size)
            assert rendered.size == expected_size, (map_id, rendered.size)
            assert labels.size == expected_size and labels.mode == 'RGBA'
            difference = np.abs(np.asarray(composed.convert('RGB'), dtype=np.float32) - np.asarray(rendered.convert('RGB'), dtype=np.float32))
            assert difference.mean() < 1, (map_id, float(difference.mean()))
            comparison = {'mean_absolute_difference_8bit': float(difference.mean()), 'p99_difference_8bit': float(np.percentile(difference, 99))}
        assert scene_path.stat().st_size > 1000000
        data = np.load(root / 'data' / (map_id + '.npz'))
        assert data['mask'].shape == data['elevation'].shape
        assert np.isfinite(data['elevation']).all()
        assert np.all(np.diff(data['x']) > 0) and np.all(np.diff(data['y']) < 0)
        scene_sha256 = hashlib.sha256(scene_path.read_bytes()).hexdigest()
        labels_sha256 = hashlib.sha256(labels_path.read_bytes()).hexdigest()
        lighting_report = scene_reports[map_id]
        assert lighting_report['status'] == 'passed'
        assert lighting_report['scene_sha256'] == scene_sha256, map_id
        assert lighting_report['packed_labels_sha256'] == labels_sha256, map_id
        assert abs(lighting_report['sun_elevation_degrees'] - 32.0) < 0.001, map_id
        results[map_id] = {
            'size': expected_size,
            'scene_bytes': scene_path.stat().st_size,
            'scene_sha256': scene_sha256,
            'output_sha256': hashlib.file_digest(composed_path.open('rb'), 'sha256').hexdigest(),
            'blender_re_render_comparison': comparison,
            'scene_lighting': lighting_report,
            'status': 'passed',
        }
    (root / 'qa_report.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
