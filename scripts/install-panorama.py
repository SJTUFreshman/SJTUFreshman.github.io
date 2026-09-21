"""Install offline panorama review assets without inflating their resolution."""
import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path

from PIL import Image


SCENES = ('spaceship', 'shelter', 'hogwarts', 'snowmountain')
PHASES = ('night', 'clear', 'dusk')
TIER_WIDTHS = (('low', 2048), ('medium', 4096), ('high', 8192))


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def finite_vector(value, size, name):
    if not isinstance(value, list) or len(value) != size or not all(isinstance(item, (float, int)) and not isinstance(item, bool) and math.isfinite(item) for item in value):
        raise ValueError(f'{name} must contain {size} finite numbers')
    return value


def observation_metadata(exported, scene):
    if exported.get('scene') != scene or exported.get('coordinateSystem') != 'three-y-up-right-handed':
        raise ValueError('Exported scene ID or coordinate system does not match the installation')
    observation = copy.deepcopy(exported.get('observation'))
    if not isinstance(observation, dict):
        raise ValueError('Exported scene must contain observation metadata')
    finite_vector(observation.get('position'), 3, 'observation.position')
    for name in ('yaw', 'pitch'):
        value = observation.get(name)
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            raise ValueError(f'observation.{name} must be finite')
    return observation


def tier_dimensions(width, height):
    if width < 2 or width != height * 2:
        raise ValueError('Panoramas must be exactly 2:1 equirectangular images')
    result = [(name, target, target // 2) for name, target in TIER_WIDTHS if target <= width]
    return result or [('low', width, height)]


def normalized_orientation(value, name):
    orientation = finite_vector(value, 4, name)
    length = math.hypot(*orientation)
    if not math.isfinite(length) or length < .00001:
        raise ValueError(f'{name} quaternion must have a finite nonzero length')
    return [component / length for component in orientation]


def sky_calibration_metadata(value):
    if not isinstance(value, dict) or value.get('kind') != 'art-direction-calibration' or value.get('coordinateSystem') != 'sky-y-up-plus-z':
        raise ValueError('Sky metadata must explicitly identify art-direction-calibration in sky-y-up-plus-z coordinates')
    direction = finite_vector(value.get('sunDirection'), 3, 'sunDirection')
    length = math.hypot(*direction)
    if not math.isfinite(length) or length < .00001:
        raise ValueError('sunDirection must have a finite nonzero length')
    if value.get('source') is not None and not isinstance(value['source'], dict):
        raise ValueError('Sky metadata source must be a JSON object')
    if 'date' in value or 'location' in value:
        raise ValueError('Art-direction calibration must not claim an astronomical observation date or location')
    metadata = copy.deepcopy(value)
    metadata['sunDirection'] = [component / length for component in direction]
    return metadata


def source_image(path, foreground=False):
    with Image.open(path) as source:
        source.load()
        image = source.convert('RGBA' if foreground else 'RGB')
        tier_dimensions(*source.size)
        if foreground:
            if 'A' not in source.getbands() and 'transparency' not in source.info:
                raise ValueError('Foreground must preserve transparent sky pixels')
            alpha = image.getchannel('A').getextrema()
            if alpha[0] >= 32 or alpha[1] <= 223:
                raise ValueError('Foreground needs both transparent sky and opaque scenery')
        return image


def encode_tiers(image, scene, phase, layer, output, site_root):
    tiers = {}
    for tier, width, height in tier_dimensions(*image.size):
        resized = image if image.size == (width, height) else image.resize((width, height), Image.Resampling.LANCZOS)
        from io import BytesIO
        stream = BytesIO()
        resized.save(stream, format='WEBP', quality=95, method=6, exact=True)
        data = stream.getvalue()
        digest = hashlib.sha256(data).hexdigest()
        filename = f'{scene}-{phase}-{layer}-{tier}-{digest[:12]}.webp'
        target = output / filename
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError(f'Existing content-addressed asset differs: {target}')
        if not target.exists():
            with target.open('xb') as handle:
                handle.write(data)
        tiers[tier] = {'src': target.relative_to(site_root).as_posix(), 'width': width, 'height': height, 'bytes': len(data), 'sha256': digest}
    return tiers


def install(args):
    root = Path(args.site_root).resolve()
    manifest_path = Path(args.manifest).resolve()
    output = Path(args.output_dir).resolve() if args.output_dir else manifest_path.parent
    if not manifest_path.is_relative_to(root) or not output.is_relative_to(root):
        raise ValueError('Manifest and output directory must remain inside the site root')
    if args.scene in ('spaceship', 'shelter') and args.phase != 'night':
        raise ValueError('Ship and shelter use night resources')
    if args.scene in ('hogwarts', 'snowmountain') and args.phase == 'night':
        raise ValueError('Mountain scenes require clear or dusk resources')
    exported = read_json(args.scene_json)
    observation = observation_metadata(exported, args.scene)
    catalog = read_json(manifest_path) if manifest_path.exists() else {'version': 1, 'projection': 'equirectangular', 'alpha': 'straight', 'scenes': {}}
    if catalog.get('version') != 1 or catalog.get('projection') != 'equirectangular':
        raise ValueError('Unsupported panorama manifest')
    entry = copy.deepcopy(catalog.get('scenes', {}).get(args.scene, {}))
    if entry.get('observation') and entry['observation'] != observation:
        raise ValueError('Existing scene observation differs from the exported camera; re-render all variants consistently')
    if args.sky_metadata and not args.sky:
        raise ValueError('--sky-metadata requires --sky')
    sky_metadata = sky_calibration_metadata(read_json(args.sky_metadata)) if args.sky_metadata else None
    if sky_metadata:
        expected_digest = sky_metadata.get('source', {}).get('renderedImageSha256')
        if expected_digest is not None and expected_digest != hashlib.sha256(Path(args.sky).read_bytes()).hexdigest():
            raise ValueError('Sky calibration hash does not match the supplied rendered sky')
    if getattr(args, 'sky_orientation', None) is not None and not args.sky:
        raise ValueError('--sky-orientation requires --sky')
    foreground = source_image(args.foreground, foreground=True)
    sky = source_image(args.sky) if args.sky else None
    orientation = normalized_orientation(args.orientation, 'orientation')
    sky_orientation = normalized_orientation(getattr(args, 'sky_orientation', None) or args.orientation, 'sky-orientation')
    if args.dry_run:
        return {'scene': args.scene, 'phase': args.phase, 'production': 'review', 'observation': observation, 'tiers': tier_dimensions(*foreground.size), 'skyTiers': tier_dimensions(*sky.size) if sky else [], 'dryRun': True}
    output.mkdir(parents=True, exist_ok=True)
    variant = {'production': 'review', 'orientation': orientation, 'tiers': encode_tiers(foreground, args.scene, args.phase, 'scene', output, root)}
    if sky:
        variant['sky'] = {'production': 'review', 'orientation': sky_orientation, 'tiers': encode_tiers(sky, args.scene, args.phase, 'sky', output, root)}
        if sky_metadata is not None:
            variant['sky']['observation'] = sky_metadata
    entry.update({'observation': observation, 'production': 'review', 'sky': args.phase if args.scene not in ('hogwarts', 'snowmountain') else 'clear'})
    if args.scene == 'spaceship':
        pilot = copy.deepcopy(exported.get('pilot') or entry.get('pilot') or {})
        pilot['seat'] = observation['position'].copy()
        if 'exit' in pilot:
            finite_vector(pilot['exit'], 3, 'pilot.exit')
        entry['pilot'] = pilot
    entry.setdefault('variants', {})[args.phase] = variant
    catalog.setdefault('scenes', {})[args.scene] = entry
    catalog['quality'] = 'review'
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = manifest_path.with_name(manifest_path.name + f'.{os.getpid()}.tmp')
    try:
        with temporary.open('x', encoding='utf-8', newline='\n') as handle:
            json.dump(catalog, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        os.replace(temporary, manifest_path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return {'scene': args.scene, 'phase': args.phase, 'production': 'review', 'manifest': str(manifest_path), 'tiers': variant['tiers'], 'skyTiers': variant.get('sky', {}).get('tiers', {})}


def parse_args():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', choices=SCENES, required=True)
    parser.add_argument('--phase', choices=PHASES, required=True)
    parser.add_argument('--foreground', required=True)
    parser.add_argument('--scene-json', required=True)
    parser.add_argument('--sky')
    parser.add_argument('--sky-metadata')
    parser.add_argument('--manifest', default=str(root / 'assets/life/panoramas/manifest.json'))
    parser.add_argument('--output-dir')
    parser.add_argument('--site-root', default=str(root))
    parser.add_argument('--orientation', nargs=4, type=float, default=[0, 0, 0, 1])
    parser.add_argument('--sky-orientation', nargs=4, type=float)
    parser.add_argument('--dry-run', action='store_true')
    return parser.parse_args()


if __name__ == '__main__':
    try:
        print(json.dumps(install(parse_args()), ensure_ascii=False))
    except (ValueError, OSError, KeyError) as failure:
        raise SystemExit(str(failure)) from failure
