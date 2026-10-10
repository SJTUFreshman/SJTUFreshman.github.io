import argparse
import sys
from pathlib import Path

import bpy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--only', nargs='+', default=['shengsi', 'china', 'hainan', 'fujian_taiwan'])
    parser.add_argument('--verify', action='store_true')
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.context.preferences.filepaths.save_version = 0
    for map_id in arguments.only:
        scene_path = arguments.root / 'scenes' / (map_id + '.blend')
        bpy.ops.wm.open_mainfile(filepath=str(scene_path))
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
        print('CUDA DEVICES', gpu_devices, flush=True)
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        render_layer = tree.nodes.new('CompositorNodeRLayers')
        render_layer.location = (-320, 100)
        overlay = tree.nodes.new('CompositorNodeImage')
        overlay.location = (-320, -160)
        overlay.label = 'Chinese typography / labels / map furniture (packed)'
        overlay.image = bpy.data.images.load(str(arguments.root / 'outputs' / (map_id + '_labels.png')), check_existing=False)
        overlay.image.pack()
        alpha_over = tree.nodes.new('CompositorNodeAlphaOver')
        alpha_over.location = (0, 100)
        alpha_over.inputs[0].default_value = 1
        exposure = tree.nodes.new('CompositorNodeExposure')
        exposure.location = (-90, -150)
        exposure.inputs['Exposure'].default_value = -scene.view_settings.exposure
        tree.links.new(overlay.outputs['Image'], exposure.inputs['Image'])
        tree.links.new(render_layer.outputs['Image'], alpha_over.inputs[1])
        tree.links.new(exposure.outputs['Image'], alpha_over.inputs[2])
        composite = tree.nodes.new('CompositorNodeComposite')
        composite.location = (240, 100)
        tree.links.new(alpha_over.outputs['Image'], composite.inputs['Image'])
        scene.render.filepath = '//../outputs/' + map_id + '_blender.png'
        scene['labels'] = 'Packed transparent overlay. Edit compose_atlas.py and regenerate the PNG to change text.'
        bpy.ops.wm.save_as_mainfile(filepath=str(scene_path), compress=True)
        if arguments.verify:
            bpy.ops.wm.open_mainfile(filepath=str(scene_path))
            scene = bpy.context.scene
            scene.render.filepath = str(arguments.root / 'outputs' / (map_id + '_blender.png'))
            bpy.ops.render.render(write_still=True)
        print('PACKED', map_id, flush=True)


if __name__ == '__main__':
    main()
