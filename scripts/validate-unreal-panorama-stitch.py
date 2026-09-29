"""Numerical six-axis, camera-roll, alpha, depth and block-boundary calibration."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile

import cv2
import numpy as np


SCRIPT = Path(__file__).with_name('stitch-unreal-panorama.py')
SPEC = importlib.util.spec_from_file_location('stitch_unreal', SCRIPT)
STITCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STITCH)

AXES = [
    ('ue-minus-y-front', [0, -1, 0], [1, 0, 0], [0, 0, 1], [255, 0, 0, 255]),
    ('ue-plus-x-right', [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 255, 0, 255]),
    ('ue-minus-x-left', [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, 255, 255]),
    ('ue-plus-y-back', [0, 1, 0], [-1, 0, 0], [0, 0, 1], [255, 255, 0, 255]),
    ('ue-plus-z-up', [0, 0, 1], [1, 0, 0], [0, 1, 0], [255, 0, 255, 255]),
    ('ue-minus-z-down', [0, 0, -1], [1, 0, 0], [0, -1, 0], [0, 255, 255, 255]),
]


def write_face(path, rgba):
    assert cv2.imwrite(str(path), rgba[:, :, [2, 1, 0, 3]])


def read_output(path):
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    assert image is not None and image.shape[2] == 4
    return image[:, :, [2, 1, 0, 3]]


def config_fixture(directory, bits=8, size=32):
    faces = []
    for name, forward, right, up, color in AXES:
        data = np.broadcast_to(np.array(color, dtype=np.uint8), (size, size, 4)).copy()
        if bits == 16:
            data = data.astype(np.uint16) * 257
        write_face(directory / (name + '.png'), data)
        faces.append(dict(name=name, image=name + '.png', origin=[125, -350, 168],
                          forward=forward, right=right, up=up, horizontalFovDegrees=90,
                          verticalFovDegrees=90, colorSpace='srgb', alphaMode='straight'))
    config = dict(coordinateSystem='unreal-centimeters', faces=faces)
    path = directory / 'config.json'
    path.write_text(json.dumps(config), encoding='utf-8')
    return path, config


def save_config(path, config):
    path.write_text(json.dumps(config), encoding='utf-8')


def expect_rejected(action, phrase):
    try:
        action()
    except ValueError as error:
        assert phrase in str(error), str(error)
    else:
        raise AssertionError('Expected rejection: ' + phrase)


def main():
    with tempfile.TemporaryDirectory(prefix='stitch-calibration-') as temp:
        directory = Path(temp)
        path, config = config_fixture(directory)
        report = STITCH.stitch(path, directory / 'axes.png', 256, block_rows=7)
        output = read_output(directory / 'axes.png')
        axis_pixels = [(128, 64), (192, 64), (64, 64), (0, 64), (128, 0), (128, 127)]
        for face, (x, y) in zip(AXES, axis_pixels):
            np.testing.assert_array_equal(output[y, x], face[4], err_msg=face[0])
        np.testing.assert_array_equal(output[64, -1], AXES[3][4])
        assert report['originThreeMeters'] == [1.25, 1.68, -3.5]
        assert report['bitsPerChannel'] == 8
        STITCH.stitch(path, directory / 'axes-other-block.png', 256, block_rows=19)
        np.testing.assert_array_equal(output, read_output(directory / 'axes-other-block.png'))
        assert np.unique(output.reshape(-1, 4), axis=0).shape[0] == 6
        rotated_config = copy.deepcopy(config)
        for face in rotated_config['faces']:
            for key in ('forward', 'right', 'up'):
                x, y, z = face[key]
                face[key] = [-y, x, z]
        save_config(path, rotated_config)
        STITCH.stitch(path, directory / 'rotated-cube.png', 256)
        rotated_cube = read_output(directory / 'rotated-cube.png')
        for expected, (x, y) in zip([2, 0, 3, 1, 4, 5], axis_pixels):
            np.testing.assert_array_equal(rotated_cube[y, x], AXES[expected][4])
        save_config(path, config)

        front = np.zeros((32, 32, 4), dtype=np.uint8)
        front[:, :, 3] = 255
        front[:, :16, :3] = [255, 0, 0]
        front[:, 16:, :3] = [0, 255, 0]
        write_face(directory / config['faces'][0]['image'], front)
        config['faces'][0]['right'] = [0, 0, 1]
        config['faces'][0]['up'] = [-1, 0, 0]
        save_config(path, config)
        STITCH.stitch(path, directory / 'roll.png', 256)
        rolled = read_output(directory / 'roll.png')
        np.testing.assert_array_equal(rolled[44, 128], [0, 255, 0, 255], err_msg='rolled face right points toward UE +Z / panorama north')
        np.testing.assert_array_equal(rolled[84, 128], [255, 0, 0, 255], err_msg='rolled face left points south')

        front[:, :, :3] = [0, 0, 255]
        front[:16, :, :3] = [255, 255, 255]
        write_face(directory / config['faces'][0]['image'], front)
        STITCH.stitch(path, directory / 'roll-up.png', 256)
        rolled = read_output(directory / 'roll-up.png')
        np.testing.assert_array_equal(rolled[64, 108], [255, 255, 255, 255], err_msg='rolled image top points UE -X / panorama west')
        np.testing.assert_array_equal(rolled[64, 148], [0, 0, 255, 255])

        rgba = np.array([[[255, 0, 255, 0], [0, 255, 0, 255]],
                         [[255, 0, 255, 0], [0, 255, 0, 255]]], dtype=np.uint8)
        face = dict(size=2, pixels=rgba, bits=8, color_space='srgb', alpha_mode='straight')
        filtered = STITCH.sample_face(face, np.array([0.]), np.array([0.]))[0]
        np.testing.assert_allclose(filtered, [0, .5, 0, .5], atol=1e-7,
                                   err_msg='transparent magenta must not contaminate opaque green')
        opaque_bw = rgba.copy()
        opaque_bw[:, 0] = [0, 0, 0, 255]
        opaque_bw[:, 1] = [255, 255, 255, 255]
        face['pixels'] = opaque_bw
        filtered = STITCH.sample_face(face, np.array([0.]), np.array([0.]))[0]
        np.testing.assert_allclose(filtered, [.5, .5, .5, 1], atol=1e-7)
        np.testing.assert_allclose(STITCH.encode_srgb(filtered[:3]), [.73535698] * 3, atol=1e-7,
                                   err_msg='linear-light half black/white is sRGB 188/255, not 128/255')
        premult = np.full((2, 2, 4), [64, 32, 0, 128], dtype=np.uint8)
        face.update(pixels=premult, alpha_mode='premultiplied', color_space='linear')
        filtered = STITCH.sample_face(face, np.array([0.]), np.array([0.]))[0]
        np.testing.assert_allclose(filtered, np.array([64, 32, 0, 128]) / 255, atol=1e-7)
        face.update(pixels=np.full((2, 2, 4), [188, 137, 0, 128], dtype=np.uint8),
                    alpha_mode='premultiplied-linear', color_space='srgb')
        filtered = STITCH.sample_face(face, np.array([0.]), np.array([0.]))[0]
        np.testing.assert_allclose(filtered[:3] / filtered[3], [1, .5, 0], atol=.004,
                                   err_msg='sRGB-encoded linear premultiplication must be decoded before unassociation')
        face['alpha_mode'] = 'premultiplied'
        expect_rejected(lambda: STITCH.sample_face(face, np.array([0.]), np.array([0.])), 'exceeds alpha')
        face.update(pixels=np.full((2, 2, 4), [255, 255, 255, 128], dtype=np.uint8), alpha_mode='premultiplied-linear')
        expect_rejected(lambda: STITCH.sample_face(face, np.array([0.]), np.array([0.])), 'exceeds alpha')

        path, config = config_fixture(directory, bits=16)
        associated = np.array([.4, .125, .05])
        encoded = 1.055 * associated ** (1 / 2.4) - .055
        encoded_rgba = np.rint(np.append(encoded, .5) * 65535).astype(np.uint16)
        write_face(directory / config['faces'][0]['image'], np.broadcast_to(encoded_rgba, (32, 32, 4)))
        config['faces'][0]['alphaMode'] = 'premultiplied-linear'
        save_config(path, config)
        STITCH.stitch(path, directory / 'linear-premultiplied.png', 128, output_space='linear')
        np.testing.assert_allclose(read_output(directory / 'linear-premultiplied.png')[32, 64] / 65535,
                                   [.8, .25, .1, .5], atol=4 / 65535)
        precise = np.full((32, 32, 4), [10001, 20002, 30003, 45678], dtype=np.uint16)
        write_face(directory / config['faces'][0]['image'], precise)
        config['faces'][0]['colorSpace'] = 'linear'
        config['faces'][0]['alphaMode'] = 'straight'
        save_config(path, config)
        report = STITCH.stitch(path, directory / 'depth16.png', 128, output_space='linear')
        sixteen = read_output(directory / 'depth16.png')
        assert sixteen.dtype == np.uint16 and report['bitsPerChannel'] == 16
        np.testing.assert_allclose(sixteen[32, 64], precise[0, 0], atol=1)
        assert any(int(value) % 257 for value in sixteen[32, 64]), '16-bit precision must survive PNG write/read'
        expect_rejected(lambda: STITCH.stitch(path, directory / 'loss.png', 128, bits=8), 'precision-loss')
        reduced = STITCH.stitch(path, directory / 'explicit-loss.png', 128, bits=8, allow_precision_loss=True)
        assert reduced['precisionLossExplicitlyAllowed']
        expect_rejected(lambda: STITCH.stitch(path, directory / 'unsupported.exr', 128), 'PNG only')

        invalid = copy.deepcopy(config)
        invalid['faces'][1]['origin'][0] += 1
        save_config(path, invalid)
        expect_rejected(lambda: STITCH.load_config(path), 'origins')
        invalid = copy.deepcopy(config)
        invalid['faces'][0]['right'] = [-1, 0, 0]
        save_config(path, invalid)
        expect_rejected(lambda: STITCH.load_config(path), 'cross right')
        invalid = copy.deepcopy(config)
        invalid['faces'][0]['horizontalFovDegrees'] = 89
        save_config(path, invalid)
        expect_rejected(lambda: STITCH.load_config(path), '90 degrees')
        invalid = copy.deepcopy(config)
        invalid['faces'][0]['right'] = [2 ** -.5, 0, 2 ** -.5]
        invalid['faces'][0]['up'] = [-2 ** -.5, 0, 2 ** -.5]
        save_config(path, invalid)
        expect_rejected(lambda: STITCH.load_config(path), 'independently rolled')
        save_config(path, config)
        wrong_image = np.zeros((32, 32, 3), dtype=np.uint8)
        assert cv2.imwrite(str(directory / config['faces'][0]['image']), wrong_image)
        expect_rejected(lambda: STITCH.load_config(path), 'true RGBA')

    print('Unreal panorama stitch passed: six independent axis markers, seam wrap, real camera roll/up, block equivalence, linear alpha-safe interpolation, premultiplied input, RGBA16 preservation, explicit precision loss and invalid-calibration rejection.')


if __name__ == '__main__':
    main()
