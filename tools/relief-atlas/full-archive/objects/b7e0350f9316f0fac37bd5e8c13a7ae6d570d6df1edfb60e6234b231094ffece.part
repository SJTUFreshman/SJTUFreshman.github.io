import argparse
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))

from render_atlas import setup_lighting


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--map', default='hainan')
    parser.add_argument('--elevations', type=float, nargs='+', default=[32.0, 24.0])
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.ops.wm.open_mainfile(filepath=str(arguments.root / 'scenes' / (arguments.map + '.blend')))
    scene = bpy.context.scene
    preferences = bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type = 'CUDA'
    preferences.get_devices()
    gpu_devices = []
    for device in preferences.devices:
        device.use = device.type == 'CUDA'
        if device.use:
            gpu_devices.append(device.name)
    if not gpu_devices:
        raise RuntimeError('CUDA GPU unavailable')
    scene.cycles.device = 'GPU'
    scene.cycles.samples = 48
    scene.render.resolution_percentage = 50
    scene.use_nodes = False
    destination = arguments.root / 'lighting_review'
    destination.mkdir(exist_ok=True)
    for elevation in arguments.elevations:
        for light in list(bpy.data.objects):
            if light.type == 'LIGHT':
                bpy.data.objects.remove(light, do_unlink=True)
        lighting = setup_lighting(elevation)
        filename = arguments.map + '_sun_' + format(elevation, 'g')
        scene.render.filepath = str(destination / (filename + '.png'))
        bpy.ops.render.render(write_still=True)
        (destination / (filename + '.json')).write_text(json.dumps(lighting, indent=2), encoding='utf-8')
        print('PREVIEW COMPLETE', filename, gpu_devices, flush=True)


if __name__ == '__main__':
    main()
