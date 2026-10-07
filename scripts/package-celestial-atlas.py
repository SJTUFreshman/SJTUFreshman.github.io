import argparse
import copy
import hashlib
import json
import math
import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from PIL import Image


BODIES = ('sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune')
LAYERS = {'cloud': 'clouds', 'starfield': 'starfield', 'ring': 'rings'}


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Validate and package complete offline celestial image grids.')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--body', choices=BODIES)
    parser.add_argument('--azimuth-count', type=int, default=180)
    parser.add_argument('--elevations', default='-90,-60,-30,0,30,60,90')
    parser.add_argument('--width', type=int, default=3840)
    parser.add_argument('--height', type=int, default=2160)
    parser.add_argument('--quality', type=int, default=90, help='PNG conversion quality; existing WebP bytes are preserved.')
    parser.add_argument('--resolution-widths', help='Comma-separated smaller widths derived directly from each packaged master, for example 2048,4096.')
    parser.add_argument('--workers', type=int, default=8, help='Concurrent frame decoders, from 1 to 16.')
    parser.add_argument('--input-format', choices=('auto', 'png', 'webp'), default='auto')
    parser.add_argument('--poster-frame', action='append', default=[], metavar='BODY:ROW:COLUMN')
    parser.add_argument('--frame-base-url', help='Absolute HTTP(S) CDN directory; posters remain local.')
    parser.add_argument('--hosted-output', type=Path, help='Export only the HTTPS deployment manifest and posters here; keep the full output locally usable.')
    parser.add_argument('--manifest', action='store_true', help='Publish only after all ten packaged grids pass validation.')
    parser.add_argument('--verify-only', action='store_true', help='With --body or --manifest, validate existing packages without repackaging frames.')
    parser.add_argument('--hash-only', action='store_true', help='With --verify-only, check headers and hashes of packages already fully decoded on a trusted machine.')
    args = parser.parse_args(argv)
    if args.verify_only and bool(args.manifest) == bool(args.body):
        parser.error('--verify-only requires exactly one of --manifest or --body.')
    if args.hash_only and not args.verify_only:
        parser.error('--hash-only requires --verify-only on an existing verified package.')
    try:
        args.elevations = [float(value) for value in args.elevations.split(',')]
    except ValueError:
        parser.error('--elevations must contain comma-separated numbers.')
    if not args.elevations or any(not math.isfinite(value) or abs(value) > 90 for value in args.elevations) or any(first >= second for first, second in zip(args.elevations, args.elevations[1:])):
        parser.error('--elevations must be strictly increasing and between -90 and 90 degrees.')
    if args.azimuth_count < 2 or min(args.width, args.height) < 1 or not 1 <= args.quality <= 100:
        parser.error('At least two azimuths, positive dimensions and quality from 1 to 100 are required.')
    if not 1 <= args.workers <= 16:
        parser.error('--workers must be between 1 and 16.')
    if args.resolution_widths is not None:
        try:
            widths = [int(value) for value in args.resolution_widths.split(',')]
        except ValueError:
            parser.error('--resolution-widths must contain comma-separated integers.')
        if len(set(widths)) != len(widths) or any(width <= 0 or width >= args.width for width in widths):
            parser.error('--resolution-widths must contain unique positive widths smaller than the master width.')
        args.resolution_widths = sorted(widths)
    args.poster_frames = {}
    for specification in args.poster_frame:
        try:
            body, row, column = specification.split(':')
            row, column = int(row), int(column)
        except ValueError:
            parser.error('--poster-frame must use BODY:ROW:COLUMN.')
        if body not in BODIES or not 0 <= row < len(args.elevations) or not 0 <= column < args.azimuth_count:
            parser.error(f'Poster frame is outside the grid: {specification}')
        args.poster_frames[body] = (row, column)
    if args.frame_base_url:
        parsed = urlsplit(args.frame_base_url)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.query or parsed.fragment or parsed.username or parsed.password:
            parser.error('--frame-base-url must be an HTTP(S) directory URL without credentials, query or fragment.')
        args.frame_base_url = args.frame_base_url.rstrip('/') + '/'
    args.input = args.input.resolve()
    args.output = args.output.resolve()
    if args.hosted_output:
        args.hosted_output = args.hosted_output.resolve()
        if not args.manifest or not args.frame_base_url or urlsplit(args.frame_base_url).scheme != 'https':
            parser.error('--hosted-output requires --manifest and an HTTPS --frame-base-url.')
        if args.hosted_output.is_relative_to(args.output) or args.output.is_relative_to(args.hosted_output):
            parser.error('--hosted-output must be separate from the full atlas directory.')
    return args


def checksum(filename):
    digest = hashlib.sha256()
    with filename.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def climate_frame_count(presentation, layer='cloud'):
    if not presentation or layer != 'cloud' or '{time}' not in presentation.get('cloudFramePattern', ''):
        return 1
    climate = presentation.get('climate')
    if not isinstance(climate, dict) or type(climate.get('frameCount')) is not int or not 1 <= climate['frameCount'] <= 4096:
        raise ValueError('Time-varying cloud frames require climate.frameCount between 1 and 4096.')
    return climate['frameCount']


def climate_time_pad(presentation):
    climate = presentation.get('climate') if isinstance(presentation, dict) else None
    return climate.get('timePad', 3) if isinstance(climate, dict) else 3


def climate_metadata(presentation, body):
    climate = presentation.get('climate') if isinstance(presentation, dict) else None
    if climate is None:
        return None
    if not isinstance(climate, dict):
        raise ValueError(f'Invalid climate metadata for {body}.')
    allowed = {'model', 'modelVersion', 'body', 'simulation', 'seed', 'source', 'timeOrigin', 'timeUnit', 'timePad',
               'timeStepSeconds', 'loopSeconds', 'frameCount', 'description', 'timeIndex', 'timeIndices',
               'stepHours', 'periodHours', 'surfaceReuse', 'interpolation', 'windModel', 'densityModel',
               'moistureModel', 'convergenceModel', 'cloudLifecycle', 'periodicity', 'noiseScaleUnit', 'shadowMode', 'cycleSeconds',
               'allowTemporalBlend', 'localWarp', 'width', 'height'}
    unknown = set(climate) - allowed
    if unknown:
        raise ValueError(f'Unknown climate metadata for {body}: {sorted(unknown)}')
    if type(climate.get('frameCount')) is not int or not 1 <= climate['frameCount'] <= 4096:
        raise ValueError(f'Climate frameCount must be between 1 and 4096 for {body}.')
    for field in ('timeStepSeconds', 'loopSeconds', 'cycleSeconds'):
        if field in climate and (type(climate[field]) not in (int, float) or not math.isfinite(climate[field]) or climate[field] <= 0):
            raise ValueError(f'Invalid climate {field} for {body}.')
    for field in ('model', 'modelVersion', 'body', 'simulation', 'source', 'timeOrigin', 'timeUnit', 'description',
                  'surfaceReuse', 'interpolation', 'windModel', 'densityModel', 'moistureModel',
                  'convergenceModel', 'cloudLifecycle', 'periodicity', 'noiseScaleUnit', 'shadowMode'):
        if field in climate and (not isinstance(climate[field], str) or not climate[field].strip() or len(climate[field]) > 512):
            raise ValueError(f'Invalid climate {field} for {body}.')
    if 'seed' in climate and ((type(climate['seed']) is not int and not isinstance(climate['seed'], str)) or
                              isinstance(climate['seed'], str) and (not climate['seed'].strip() or len(climate['seed']) > 128)):
        raise ValueError(f'Invalid climate seed for {body}.')
    for field in ('timeIndex',):
        if field in climate and (type(climate[field]) is not int or not 0 <= climate[field] <= 4095):
            raise ValueError(f'Invalid climate {field} for {body}.')
    if 'timePad' in climate and (type(climate['timePad']) is not int or not 0 <= climate['timePad'] <= 6):
        raise ValueError(f'Invalid climate timePad for {body}.')
    if 'timeIndices' in climate and (not isinstance(climate['timeIndices'], list) or
                                     any(type(index) is not int or not 0 <= index <= 4095 for index in climate['timeIndices']) or
                                     climate['timeIndices'] != sorted(set(climate['timeIndices']))):
        raise ValueError(f'Invalid climate timeIndices for {body}.')
    for field in ('stepHours', 'periodHours'):
        if field in climate and (type(climate[field]) not in (int, float) or not math.isfinite(climate[field]) or climate[field] <= 0):
            raise ValueError(f'Invalid climate {field} for {body}.')
    if 'interpolation' in climate and climate['interpolation'] not in ('step', 'crossfade', 'motion'):
        raise ValueError(f'Invalid climate interpolation for {body}.')
    if 'allowTemporalBlend' in climate and type(climate['allowTemporalBlend']) is not bool:
        raise ValueError(f'Invalid climate allowTemporalBlend for {body}.')
    if 'localWarp' in climate and (type(climate['localWarp']) not in (bool, int, float) or
                                   (type(climate['localWarp']) is not bool and
                                    (not math.isfinite(climate['localWarp']) or climate['localWarp'] < 0 or climate['localWarp'] > 4))):
        raise ValueError(f'Invalid climate localWarp for {body}.')
    if 'timeIndices' in climate and climate['timeIndices'] != list(range(climate['frameCount'])):
        raise ValueError(f'Climate timeIndices must cover every frame for {body}.')
    for field in ('width', 'height'):
        if field in climate and (type(climate[field]) is not int or not 1 <= climate[field] <= 16384):
            raise ValueError(f'Invalid climate {field} for {body}.')
    if 'timeStepSeconds' in climate and 'loopSeconds' in climate:
        expected = climate['timeStepSeconds'] * climate['frameCount']
        if abs(climate['loopSeconds'] - expected) > max(1, expected * 0.0001):
            raise ValueError(f'Climate loopSeconds does not match frameCount and timeStepSeconds for {body}.')
    result = copy.deepcopy(climate)
    result.setdefault('timePad', 3)
    return result


def frame_paths(body, args, layer=None, presentation=None):
    directory = Path(body) / LAYERS[layer] if layer else Path(body)
    azimuth_count = 1 if layer == 'ring' else args.azimuth_count
    pattern = presentation.get(f'{layer}FramePattern') if layer and presentation else None
    time_count = climate_frame_count(presentation, layer)
    for time in range(time_count):
        for row in range(len(args.elevations)):
            for column in range(azimuth_count):
                if pattern and '{time}' in pattern:
                    relative = Path(pattern.replace('{time}', str(time).zfill(climate_time_pad(presentation)))
                                    .replace('{elevation}', str(row))
                                    .replace('{azimuth}', f'{column:03d}'))
                else:
                    relative = directory / f'e{row}' / f'a{column:03d}.webp'
                yield row, column, relative


def source_frame(relative, args):
    formats = ('webp', 'png') if args.input_format == 'auto' else (args.input_format,)
    candidates = [args.input / relative.with_suffix('.' + extension) for extension in formats]
    existing = [candidate for candidate in candidates if candidate.is_file()]
    if not existing:
        raise ValueError(f'Missing source frame: {relative.with_suffix("")} ({", ".join(formats)})')
    if len(existing) > 1:
        raise ValueError(f'Ambiguous source frame: {relative.with_suffix("")}; choose --input-format png or webp.')
    return existing[0]


def resolution_id(width):
    return f'{width // 1024}k' if width % 1024 == 0 else f'{width}px'


def resolution_path(relative, width):
    relative = Path(relative)
    return Path(relative.parts[0]) / 'resolutions' / str(width) / Path(*relative.parts[1:])


def resolution_arguments(args, master_args, width):
    result = copy.copy(master_args)
    result.width = max(1, round(master_args.width * width / args.width))
    result.height = max(1, round(master_args.height * width / args.width))
    return result


def resolution_encoding(width):
    return {'format': 'WebP', 'quality': 94 if width <= 2048 else 96, 'method': 6,
            'alphaQuality': 100, 'resampling': 'LANCZOS', 'alphaResampling': 'premultiplied',
            'source': 'packaged master decoded pixels'}


def validate_image(filename, args, expected_format):
    try:
        with Image.open(filename) as image:
            if image.format != expected_format or getattr(image, 'n_frames', 1) != 1:
                raise ValueError(f'Expected one {expected_format} image: {filename}')
            if image.size != (args.width, args.height):
                raise ValueError(f'Frame dimensions {image.size} differ from {(args.width, args.height)}: {filename}')
            if not args.hash_only:
                image.load()
                if getattr(args, 'required_alpha', False):
                    if 'A' not in image.getbands() or image.getchannel('A').getextrema()[0] == 255:
                        raise ValueError(f'Transparent celestial layer has no transparent pixels: {filename}')
                    if getattr(args, 'full_sphere', False):
                        bounds = image.getchannel('A').point(lambda value: 255 if value > 3 else 0).getbbox()
                        if (not bounds and not getattr(args, 'allow_empty', False)) or bounds and (min(bounds[:2]) <= 0 or bounds[2] >= image.width or bounds[3] >= image.height):
                            raise ValueError(f'Full sphere is empty or clipped at the frame boundary: {filename}')
    except (OSError, SyntaxError) as error:
        raise ValueError(f'Undecodable frame: {filename}: {error}') from error


def atomic_write(destination, writer):
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f'.{destination.name}.', suffix='.tmp', dir=destination.parent)
    os.close(descriptor)
    temporary = Path(name)
    try:
        writer(temporary)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(destination, value):
    text = json.dumps(value, indent=2, ensure_ascii=False) + '\n'
    atomic_write(destination, lambda temporary: temporary.write_text(text, encoding='utf-8'))


def copy_file(source, destination):
    if source.resolve() != destination.resolve():
        atomic_write(destination, lambda temporary: shutil.copyfile(source, temporary))


def poster_frame(body, args):
    if body in args.poster_frames:
        return args.poster_frames[body]
    target = 30 if body in ('saturn', 'uranus') else 0
    return min(range(len(args.elevations)), key=lambda row: abs(args.elevations[row] - target)), 0


def render_metadata(body, args):
    entries = []
    directory = args.input / body
    sources = sorted(set(directory.glob('render*.json')) | set(directory.glob('bake*.json')))
    for source in sources:
        try:
            metadata = json.loads(source.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise ValueError(f'Invalid renderer metadata: {source}') from error
        if not isinstance(metadata, dict) or metadata.get('body', body) != body:
            raise ValueError(f'Renderer metadata body differs from {body}: {source}')
        climate_presentation = metadata.get('presentation', {}) if isinstance(metadata.get('presentation'), dict) and 'climate' in metadata else {}
        expected_width = climate_presentation.get('cloudWidth', args.width) if climate_presentation else args.width
        expected_height = climate_presentation.get('cloudHeight', args.height) if climate_presentation else args.height
        expected = {'width': expected_width, 'height': expected_height, 'azimuthCount': args.azimuth_count, 'elevations': args.elevations, 'resolution': [expected_width, expected_height]}
        for key, value in expected.items():
            if key in metadata and metadata[key] != value:
                raise ValueError(f'Renderer metadata {key} does not match the requested grid: {source}')
        relative = Path(body) / 'render-metadata' / source.name
        copy_file(source, args.output / relative)
        entries.append({'path': relative.as_posix(), 'sha256': checksum(source), 'parameters': metadata})
    return entries


def validate_presentation(body, presentation, args):
    if not isinstance(presentation, dict):
        raise ValueError(f'Invalid presentation metadata for {body}.')
    allowed = {'framing', 'sphereRect', 'transparent', 'projection', 'spinAxes', 'spinAxisCoordinates',
               'cloudSphereRect', 'ringSphereRect', 'angularVelocity', 'cloudAngularVelocity', 'climate'}
    allowed.update(f'{layer}{field}' for layer in LAYERS for field in ('FramePattern', 'Poster', 'Width', 'Height', 'Transparent'))
    if set(presentation) - allowed:
        raise ValueError(f'Unknown presentation metadata for {body}: {sorted(set(presentation) - allowed)}')
    if presentation.get('framing') != 'full-sphere' or presentation.get('transparent') is not True:
        raise ValueError(f'Full-sphere presentation requires a transparent complete sphere for {body}.')
    for name in ('sphereRect', 'cloudSphereRect', 'ringSphereRect'):
        if name != 'sphereRect' and name not in presentation:
            continue
        rectangle = presentation.get(name, {})
        if not isinstance(rectangle, dict) or set(rectangle) != {'x', 'y', 'width', 'height'} or any(type(value) not in (int, float) or not math.isfinite(value) for value in rectangle.values()):
            raise ValueError(f'Invalid normalized {name} for {body}.')
        if not 0 <= rectangle['x'] < 1 or not 0 <= rectangle['y'] < 1 or min(rectangle['width'], rectangle['height']) <= 0 or rectangle['x'] + rectangle['width'] > 1.000001 or rectangle['y'] + rectangle['height'] > 1.000001:
            raise ValueError(f'{name} lies outside the complete source image for {body}.')
    if 'projection' in presentation and presentation['projection'] != 'orthographic':
        raise ValueError(f'Unsupported sphere projection for {body}.')
    if 'spinAxes' in presentation:
        axes = presentation['spinAxes']
        if not isinstance(axes, list) or len(axes) != len(args.elevations) or any(not isinstance(axis, list) or len(axis) != 3 or any(type(value) not in (int, float) or not math.isfinite(value) for value in axis) or abs(sum(value * value for value in axis) - 1) > 0.0001 for axis in axes):
            raise ValueError(f'Expected one normalized spin axis per elevation for {body}.')
        if presentation.get('spinAxisCoordinates') != 'right-up-toward-camera':
            raise ValueError(f'Unknown spin axis coordinates for {body}.')
    elif 'spinAxisCoordinates' in presentation:
        raise ValueError(f'Spin axis coordinates require spinAxes for {body}.')
    for name in ('angularVelocity', 'cloudAngularVelocity'):
        if name in presentation and (type(presentation[name]) not in (int, float) or not math.isfinite(presentation[name]) or abs(presentation[name]) > 30):
            raise ValueError(f'Invalid {name} for {body}.')
    normalized_climate = climate_metadata(presentation, body)
    result = copy.deepcopy(presentation)
    if normalized_climate is not None:
        result['climate'] = normalized_climate
    for layer, directory in LAYERS.items():
        supplied = {key for key in result if key in {f'{layer}{field}' for field in ('FramePattern', 'Poster', 'Width', 'Height', 'Transparent')}}
        if not supplied:
            continue
        expected_pattern = f'{body}/{directory}/e{{elevation}}/a000.webp' if layer == 'ring' else f'{body}/{directory}/e{{elevation}}/a{{azimuth}}.webp'
        if layer == 'cloud' and '{time}' in result.get('cloudFramePattern', ''):
            expected_pattern = f'{body}/{directory}/t{{time}}/e{{elevation}}/a{{azimuth}}.webp'
        expected_poster = f'{body}/{directory}/poster.webp'
        if result.get(f'{layer}FramePattern') != expected_pattern or result.get(f'{layer}Poster', expected_poster) != expected_poster:
            raise ValueError(f'Unexpected {layer} layer asset path for {body}.')
        for field, default in (('Width', args.width), ('Height', args.height)):
            value = result.setdefault(f'{layer}{field}', default)
            if type(value) is not int or value < 1:
                raise ValueError(f'Invalid {layer} layer dimensions for {body}.')
        if type(result.get(f'{layer}Transparent', layer == 'cloud')) is not bool:
            raise ValueError(f'Invalid {layer} transparency for {body}.')
        result.setdefault(f'{layer}Transparent', layer == 'cloud')
        if layer in ('cloud', 'ring') and result[f'{layer}Transparent'] is not True:
            raise ValueError(f'{layer.capitalize()} layer must retain transparency for {body}.')
        result[f'{layer}Poster'] = expected_poster
    if ('cloudSphereRect' in result or 'cloudAngularVelocity' in result or 'climate' in result) and 'cloudFramePattern' not in result:
        raise ValueError(f'Cloud geometry and motion require a cloud layer for {body}.')
    if 'cloudFramePattern' in result and '{time}' in result['cloudFramePattern']:
        climate_frame_count(result, 'cloud')
    if 'climate' in result and 'cloudFramePattern' in result and '{time}' not in result['cloudFramePattern']:
        raise ValueError(f'Climate metadata requires a timed cloud frame pattern for {body}.')
    if 'ringSphereRect' in result and 'ringFramePattern' not in result:
        raise ValueError(f'Ring geometry requires a ring layer for {body}.')
    return result


def presentation_metadata(body, provenance, args):
    presentations = [validate_presentation(body, entry['parameters']['presentation'], args)
                     for entry in provenance if 'presentation' in entry.get('parameters', {})]
    if presentations and any(presentation != presentations[0] for presentation in presentations):
        raise ValueError(f'Render shards disagree on presentation metadata for {body}.')
    climate_entries = [entry['parameters']['climate'] for entry in provenance
                       if isinstance(entry.get('parameters'), dict) and 'climate' in entry['parameters']]
    if not climate_entries:
        return presentations[0] if presentations else None
    if not presentations:
        raise ValueError(f'Climate metadata requires full-sphere presentation for {body}.')
    indices = sorted({entry.get('timeIndex') for entry in climate_entries if type(entry.get('timeIndex')) is int})
    first_raw = copy.deepcopy(climate_entries[0])
    for field in ('model', 'modelVersion', 'timePad'):
        if any(field in entry and field in first_raw and entry[field] != first_raw[field] for entry in climate_entries[1:]):
            raise ValueError(f'Climate metadata {field} differs between render shards for {body}.')
    if not indices and type(first_raw.get('frameCount')) is int:
        indices = list(range(first_raw['frameCount']))
    if 'frameCount' not in first_raw and indices:
        first_raw['frameCount'] = max(indices) + 1
    first = climate_metadata({'climate': first_raw}, body)
    if not indices:
        indices = first.get('timeIndices', []) if isinstance(first.get('timeIndices'), list) else []
    if not indices:
        raise ValueError(f'Climate metadata has no timeIndex for {body}.')
    climate = copy.deepcopy(first)
    climate['timeIndices'] = indices
    climate.setdefault('timePad', 3)
    climate['frameCount'] = max(climate.get('frameCount', 0), max(indices) + 1)
    result = copy.deepcopy(presentations[0])
    result['climate'] = climate
    if 'cloudFramePattern' in result and '{time}' not in result['cloudFramePattern']:
        result['cloudFramePattern'] = f'{body}/clouds/t{{time}}/e{{elevation}}/a{{azimuth}}.webp'
    return validate_presentation(body, result, args)


def image_arguments(args, presentation, layer=None):
    result = copy.copy(args)
    if presentation:
        result.required_alpha = presentation.get(f'{layer}Transparent' if layer else 'transparent', False)
        result.full_sphere = result.required_alpha and layer != 'starfield'
        result.allow_empty = layer == 'ring'
        if layer:
            result.width = presentation[f'{layer}Width']
            result.height = presentation[f'{layer}Height']
    return result


def package_frame(source_entry, args):
    row, column, relative, source = source_entry
    source_format = source.suffix[1:].upper()
    source_hash = checksum(source)
    validate_image(source, args, source_format)
    destination = args.output / relative
    if source_format == 'WEBP':
        copy_file(source, destination)
    else:
        def encode(temporary):
            with Image.open(source) as image:
                image.convert('RGBA' if 'A' in image.getbands() else 'RGB').save(temporary, 'WEBP', quality=args.quality, method=6)
        atomic_write(destination, encode)
        validate_image(destination, args, 'WEBP')
    destination_hash = checksum(destination)
    if (source_format == 'WEBP' and source_hash != destination_hash) or checksum(source) != source_hash:
        raise ValueError(f'Source changed during packaging: {source}')
    return {'path': relative.as_posix(), 'sha256': destination_hash, 'bytes': destination.stat().st_size,
            'source': source.relative_to(args.input).as_posix(), 'sourceSha256': source_hash,
            'sourceFormat': source_format, 'encoding': 'preserved' if source_format == 'WEBP' else 'PNG to WebP',
            'quality': None if source_format == 'WEBP' else args.quality}


def resize_image(source, destination, width, height, quality):
    def encode(temporary):
        with Image.open(source) as image:
            image.load()
            mode = 'RGBA' if 'A' in image.getbands() else 'RGB'
            image = image.convert(mode)
            image = image.resize((width, height), Image.Resampling.LANCZOS)
            image.save(temporary, 'WEBP', quality=quality, method=6,
                       lossless=quality >= 100)
    atomic_write(destination, encode)


def derive_frame(record, tier_args, width):
    source = tier_args.output / record['path']
    relative = resolution_path(record['path'], width)
    destination = tier_args.output / relative
    if checksum(source) != record['sha256']:
        raise ValueError(f'Master changed before deriving resolution: {source}')
    resize_image(source, destination, tier_args.width, tier_args.height,
                 resolution_encoding(width)['quality'])
    validate_image(destination, tier_args, 'WEBP')
    if checksum(source) != record['sha256']:
        raise ValueError(f'Master changed while deriving resolution: {source}')
    digest = checksum(destination)
    return {'path': relative.as_posix(), 'sha256': digest, 'bytes': destination.stat().st_size,
            'source': record['path'], 'sourceSha256': record['sha256'],
            'sourceFormat': 'WEBP', 'encoding': 'derived-resize',
            'quality': resolution_encoding(width)['quality']}


def derive_poster(master_poster, width, tier_args):
    relative = resolution_path(master_poster['path'], width)
    source_relative = resolution_path(master_poster['source'], width)
    source = tier_args.output / source_relative
    destination = tier_args.output / relative
    digest = checksum(source)
    copy_file(source, destination)
    if checksum(destination) != digest or checksum(source) != digest:
        raise ValueError(f'Derived poster changed during copy: {source}')
    return {'path': relative.as_posix(), 'source': source_relative.as_posix(),
            'sha256': digest, 'elevation': master_poster['elevation'],
            'azimuth': master_poster['azimuth'], 'width': tier_args.width,
            'height': tier_args.height}


def derive_resolution(body, width, args, presentation, master_metadata):
    tier_args = resolution_arguments(args, args, width)
    tier = {'id': resolution_id(width), 'width': tier_args.width, 'height': tier_args.height,
            'encoding': resolution_encoding(width), 'frames': [], 'layers': {}}
    image_args = resolution_arguments(args, image_arguments(args, presentation), width)
    image_args.full_sphere = False
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        entries = list(executor.map(lambda record: derive_frame(record, image_args, width), master_metadata['frames']))
    tier['frames'] = entries
    tier['poster'] = derive_poster(master_metadata['poster'], width, image_args)
    if presentation:
        for layer in LAYERS:
            if f'{layer}FramePattern' not in presentation:
                continue
            layer_master = master_metadata['layers'][layer]
            layer_args = resolution_arguments(args, image_arguments(args, presentation, layer), width)
            layer_args.full_sphere = False
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                records = list(executor.map(lambda record: derive_frame(record, layer_args, width), layer_master['frames']))
            tier['layers'][layer] = {'frames': records, 'width': layer_args.width, 'height': layer_args.height,
                                     'poster': derive_poster(layer_master['poster'], width, layer_args)}
    return tier


def package_body(body, args):
    provenance = render_metadata(body, args)
    presentation = presentation_metadata(body, provenance, args)
    image_args = image_arguments(args, presentation)
    sources = [(row, column, relative, source_frame(relative, args)) for row, column, relative in frame_paths(body, args)]
    records = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        for index, record in enumerate(executor.map(lambda entry: package_frame(entry, image_args), sources)):
            records.append(record)
            if (index + 1) % args.azimuth_count == 0:
                print(f'PACKAGED {body} e{index // args.azimuth_count}', flush=True)
    row, column = poster_frame(body, args)
    poster_source = args.output / body / f'e{row}' / f'a{column:03d}.webp'
    poster = args.output / body / 'poster.webp'
    copy_file(poster_source, poster)
    metadata = {'version': 1, 'body': body, 'width': args.width, 'height': args.height, 'azimuthCount': args.azimuth_count,
                'elevations': args.elevations, 'packagedAt': datetime.now(timezone.utc).isoformat(),
                'pngEncoding': {'format': 'WebP', 'quality': args.quality, 'method': 6},
                'webpEncoding': 'Original encoded bytes preserved', 'renderMetadataAvailable': bool(provenance),
                'renderMetadata': provenance, 'frames': records,
                'poster': {'path': f'{body}/poster.webp', 'source': f'{body}/e{row}/a{column:03d}.webp',
                           'sha256': checksum(poster), 'elevation': row, 'azimuth': column}}
    if presentation:
        metadata['presentation'] = presentation
        metadata['layers'] = {}
        for layer, directory in LAYERS.items():
            if f'{layer}FramePattern' not in presentation:
                continue
            layer_args = image_arguments(args, presentation, layer)
            sources = [(row, column, relative, source_frame(relative, args)) for row, column, relative in frame_paths(body, args, layer, presentation)]
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                layer_records = list(executor.map(lambda entry: package_frame(entry, layer_args), sources))
            layer_poster = f'{body}/{directory}/poster.webp'
            layer_column = 0 if layer == 'ring' else column
            layer_source = next(relative.as_posix() for layer_row, layer_col, relative in frame_paths(body, args, layer, presentation)
                                if layer_row == row and layer_col == layer_column)
            copy_file(args.output / layer_source, args.output / layer_poster)
            metadata['layers'][layer] = {'frames': layer_records, 'poster': {'path': layer_poster, 'source': layer_source,
                'sha256': checksum(args.output / layer_poster), 'elevation': row, 'azimuth': layer_column,
                **({'time': 0} if layer == 'cloud' and '{time}' in presentation.get('cloudFramePattern', '') else {})}}
    metadata['resolutions'] = []
    for width in args.resolution_widths or []:
        metadata['resolutions'].append(derive_resolution(body, width, args, presentation, metadata))
    atomic_json(args.output / body / 'package.json', metadata)


def verify_frame(record, args):
    frame = args.output / record['path']
    validate_image(frame, args, 'WEBP')
    digest = checksum(frame)
    if digest != record.get('sha256'):
        raise ValueError(f'Frame changed after packaging: {frame}')
    if record.get('bytes') != frame.stat().st_size:
        raise ValueError(f'Frame byte count differs from package: {frame}')
    return f'{digest}  {record["path"]}'


def verify_derived_sources(records, master_records, width, body):
    expected = {resolution_path(record['path'], width).as_posix(): record for record in master_records}
    for record in records:
        master = expected[record['path']]
        if record.get('source') != master['path'] or record.get('sourceSha256') != master['sha256']:
            raise ValueError(f'Derived resolution source differs from the master for {body}.')


def verify_derived_poster(poster, master_poster, width, image_args, body):
    expected_path = resolution_path(master_poster['path'], width).as_posix()
    expected_source = resolution_path(master_poster['source'], width).as_posix()
    expected = {'path': expected_path, 'source': expected_source, 'width': image_args.width,
                'height': image_args.height, 'elevation': master_poster['elevation'],
                'azimuth': master_poster['azimuth']}
    if not isinstance(poster, dict) or any(poster.get(key) != value for key, value in expected.items()):
        raise ValueError(f'Derived resolution poster differs from the selected viewpoint for {body}.')
    path = image_args.output / expected_path
    validate_image(path, image_args, 'WEBP')
    digest = checksum(path)
    if digest != poster.get('sha256') or digest != checksum(image_args.output / expected_source):
        raise ValueError(f'Derived resolution poster differs from its selected frame: {path}')
    return f'{digest}  {expected_path}'


def verify_resolution(body, tier, args, presentation, package):
    width = tier.get('width') if isinstance(tier, dict) else None
    if type(width) is not int or not 0 < width < args.width:
        raise ValueError(f'Invalid derived resolution for {body}.')
    expected_id = resolution_id(width)
    if tier.get('id') != expected_id or type(tier.get('height')) is not int or tier['height'] != max(1, round(args.height * width / args.width)):
        raise ValueError(f'Derived resolution dimensions do not match the master for {body}.')
    if tier.get('encoding') != resolution_encoding(width):
        raise ValueError(f'Derived resolution encoding differs from the declared pipeline for {body}.')
    tier_args = resolution_arguments(args, args, width)
    image_args = image_arguments(tier_args, presentation)
    image_args.full_sphere = False
    expected = {resolution_path(relative, width).as_posix() for _, _, relative in frame_paths(body, args, presentation=presentation)}
    actual = {frame.relative_to(args.output).as_posix() for frame in (args.output / body / 'resolutions' / str(width)).glob('e*/a*.webp')}
    if actual != expected:
        raise ValueError(f'Incomplete or unexpected {expected_id} frame grid for {body}.')
    records = tier.get('frames', [])
    if {record.get('path') for record in records} != expected or len(records) != len(expected):
        raise ValueError(f'Derived resolution frame records do not match the grid for {body}.')
    verify_derived_sources(records, package['frames'], width, body)
    checksums = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        checksums.extend(executor.map(lambda record: verify_frame(record, image_args), records))
    checksums.append(verify_derived_poster(tier.get('poster'), package['poster'], width, image_args, body))
    expected_layers = {layer for layer in LAYERS if presentation and f'{layer}FramePattern' in presentation}
    if set(tier.get('layers', {})) != expected_layers:
        raise ValueError(f'Derived resolution layers differ from presentation metadata for {body}.')
    for layer in expected_layers:
        layer_args = resolution_arguments(args, image_arguments(args, presentation, layer), width)
        layer_args.full_sphere = False
        layer_tier = tier['layers'][layer]
        if layer_tier.get('width') != layer_args.width or layer_tier.get('height') != layer_args.height:
            raise ValueError(f'Derived {layer} dimensions differ from the master for {body}.')
        expected_layer = {resolution_path(relative, width).as_posix() for _, _, relative in frame_paths(body, args, layer, presentation)}
        actual_layer = {frame.relative_to(args.output).as_posix() for frame in (args.output / body / 'resolutions' / str(width) / LAYERS[layer]).rglob('*.webp') if frame.name != 'poster.webp'}
        layer_records = layer_tier.get('frames', [])
        if actual_layer != expected_layer or {record.get('path') for record in layer_records} != expected_layer or len(layer_records) != len(expected_layer):
            raise ValueError(f'Incomplete or unexpected {layer} frame grid for {body}.')
        verify_derived_sources(layer_records, package['layers'][layer]['frames'], width, body)
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            checksums.extend(executor.map(lambda record: verify_frame(record, layer_args), layer_records))
        checksums.append(verify_derived_poster(layer_tier.get('poster'), package['layers'][layer]['poster'], width, layer_args, body))
    return checksums


def verify_body(body, args):
    checksums = []
    package_path = args.output / body / 'package.json'
    try:
        package = json.loads(package_path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise ValueError(f'Missing or invalid package metadata: {package_path}') from error
    if not isinstance(package, dict) or package.get('version') != 1:
        raise ValueError(f'Unsupported package metadata: {package_path}')
    for key, expected in {'body': body, 'width': args.width, 'height': args.height, 'azimuthCount': args.azimuth_count, 'elevations': args.elevations}.items():
        if package.get(key) != expected:
            raise ValueError(f'Package {body} has mismatched {key}.')
    presentation = presentation_metadata(body, package.get('renderMetadata', []), args)
    if package.get('presentation') != presentation:
        raise ValueError(f'Package presentation differs from the render metadata for {body}.')
    image_args = image_arguments(args, presentation)
    expected_paths = {relative.as_posix() for _, _, relative in frame_paths(body, args, presentation=presentation)}
    actual_paths = {frame.relative_to(args.output).as_posix() for frame in (args.output / body).glob('e*/a*.webp')}
    if actual_paths != expected_paths:
        raise ValueError(f'Incomplete or unexpected frame grid for {body}: missing={sorted(expected_paths - actual_paths)[:5]}, unexpected={sorted(actual_paths - expected_paths)[:5]}')
    records = package.get('frames', [])
    if len(records) != len(expected_paths) or {record.get('path') for record in records} != expected_paths:
        raise ValueError(f'Package frame records do not match the grid for {body}.')
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        checksums.extend(executor.map(lambda record: verify_frame(record, image_args), records))
    for entry in package.get('renderMetadata', []):
        relative = Path(entry['path'])
        if relative.parent != Path(body) / 'render-metadata':
            raise ValueError(f'Unexpected render metadata path: {relative}')
        metadata_path = args.output / relative
        if checksum(metadata_path) != entry['sha256']:
            raise ValueError(f'Render metadata changed after packaging: {metadata_path}')
        try:
            metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise ValueError(f'Invalid render metadata: {metadata_path}') from error
        if metadata != entry.get('parameters'):
            raise ValueError(f'Render metadata parameters differ from the package: {metadata_path}')
        checksums.append(f'{entry["sha256"]}  {entry["path"]}')
    poster = package['poster']
    row, column = poster['elevation'], poster['azimuth']
    if type(row) is not int or type(column) is not int or not 0 <= row < len(args.elevations) or not 0 <= column < args.azimuth_count:
        raise ValueError(f'Poster selection is outside the grid for {body}.')
    if poster['path'] != f'{body}/poster.webp' or poster['source'] != f'{body}/e{row}/a{column:03d}.webp':
        raise ValueError(f'Poster metadata does not match its selected frame for {body}.')
    poster_path = args.output / body / 'poster.webp'
    validate_image(poster_path, image_args, 'WEBP')
    poster_hash = checksum(poster_path)
    if poster_hash != poster['sha256'] or poster_hash != checksum(args.output / poster['source']):
        raise ValueError(f'Poster differs from its selected frame: {poster_path}')
    checksums.extend([f'{poster_hash}  {body}/poster.webp', f'{checksum(package_path)}  {body}/package.json'])
    expected_layers = {layer for layer in LAYERS if presentation and f'{layer}FramePattern' in presentation}
    if set(package.get('layers', {})) != expected_layers:
        raise ValueError(f'Package layers differ from presentation metadata for {body}.')
    for layer in expected_layers:
        layer_args = image_arguments(args, presentation, layer)
        layer_package = package['layers'][layer]
        expected = {relative.as_posix() for _, _, relative in frame_paths(body, args, layer, presentation)}
        actual = {frame.relative_to(args.output).as_posix() for frame in (args.output / body / LAYERS[layer]).rglob('*.webp') if frame.name != 'poster.webp'}
        layer_records = layer_package.get('frames', [])
        if actual != expected or len(layer_records) != len(expected) or {record.get('path') for record in layer_records} != expected:
            raise ValueError(f'Incomplete or unexpected {layer} frame grid for {body}.')
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            checksums.extend(executor.map(lambda record: verify_frame(record, layer_args), layer_records))
        layer_poster = layer_package.get('poster', {})
        layer_column = 0 if layer == 'ring' else column
        source = next(relative.as_posix() for layer_row, layer_col, relative in frame_paths(body, args, layer, presentation)
                      if layer_row == row and layer_col == layer_column)
        path = f'{body}/{LAYERS[layer]}/poster.webp'
        expected_time = 0 if layer == 'cloud' and '{time}' in presentation.get('cloudFramePattern', '') else None
        if (layer_poster.get('source') != source or layer_poster.get('path') != path or
                layer_poster.get('elevation') != row or layer_poster.get('azimuth') != layer_column or
                expected_time is not None and layer_poster.get('time') != expected_time):
            raise ValueError(f'{layer} poster differs from the selected viewpoint for {body}.')
        validate_image(args.output / path, layer_args, 'WEBP')
        digest = checksum(args.output / path)
        if digest != layer_poster.get('sha256') or digest != checksum(args.output / source):
            raise ValueError(f'{layer} poster differs from its selected frame for {body}.')
        checksums.append(f'{digest}  {path}')
    tiers = package.get('resolutions', [])
    if not isinstance(tiers, list) or any(not isinstance(tier, dict) or type(tier.get('width')) is not int or not 0 < tier['width'] < args.width for tier in tiers):
        raise ValueError(f'Invalid derived resolution records for {body}.')
    widths = [tier['width'] for tier in tiers]
    if len(set(widths)) != len(widths) or widths != sorted(widths):
        raise ValueError(f'Invalid derived resolution order for {body}.')
    if args.resolution_widths is not None and widths != args.resolution_widths:
        raise ValueError(f'Package derived resolutions do not match the requested tiers for {body}.')
    for tier in tiers:
        checksums.extend(verify_resolution(body, tier, args, presentation, package))
    return package, checksums


def manifest_path(path, args):
    return urljoin(args.frame_base_url, path) if args.frame_base_url and not args.hosted_output else path


def resolution_manifest_entry(body, package, tier, args, presentation):
    width, height = tier['width'], tier['height']
    entry = {'id': tier['id'], 'width': width, 'height': height,
             'azimuthCount': args.azimuth_count, 'elevations': args.elevations,
             'framePattern': manifest_path(f'{body}/resolutions/{width}/e{{elevation}}/a{{azimuth}}.webp', args),
             'poster': tier['poster']['path'], 'posterWidth': tier['poster']['width'],
             'posterHeight': tier['poster']['height']}
    if presentation:
        for name in ('sphereRect', 'cloudSphereRect', 'ringSphereRect', 'projection',
                     'spinAxes', 'spinAxisCoordinates', 'climate'):
            if name in presentation:
                entry[name] = copy.deepcopy(presentation[name])
        for layer, directory in LAYERS.items():
            if layer not in tier.get('layers', {}):
                continue
            layer_tier = tier['layers'][layer]
            prefix = f'{body}/resolutions/{width}/{directory}'
            layer_pattern = presentation.get(f'{layer}FramePattern')
            if layer_pattern and layer_pattern.startswith(f'{body}/{directory}/'):
                layer_pattern = f'{prefix}/' + layer_pattern.removeprefix(f'{body}/{directory}/')
            else:
                layer_pattern = f'{prefix}/e{{elevation}}/' + ('a000.webp' if layer == 'ring' else 'a{azimuth}.webp')
            entry[f'{layer}FramePattern'] = manifest_path(layer_pattern, args)
            entry[f'{layer}Poster'] = layer_tier['poster']['path']
            entry[f'{layer}Width'] = layer_tier['poster']['width']
            entry[f'{layer}Height'] = layer_tier['poster']['height']
            entry[f'{layer}PosterWidth'] = layer_tier['poster']['width']
            entry[f'{layer}PosterHeight'] = layer_tier['poster']['height']
    return entry


def publish_manifest(args):
    manifest = {'version': 1, 'width': args.width, 'height': args.height, 'bodies': {}}
    checksums = []
    packages = {}
    for body in BODIES:
        package, body_checksums = verify_body(body, args)
        packages[body] = package
        checksums.extend(body_checksums)
        poster = package['poster']
        pattern = f'{body}/e{{elevation}}/a{{azimuth}}.webp'
        body_entry = {'azimuthCount': args.azimuth_count, 'elevations': args.elevations,
                                  'width': args.width, 'height': args.height,
                                  'framePattern': urljoin(args.frame_base_url, pattern) if args.frame_base_url and not args.hosted_output else pattern,
                                  'poster': f'{body}/poster.webp', 'defaultAzimuth': poster['azimuth'],
                                  'defaultElevation': poster['elevation'], 'metadata': f'{body}/package.json'}
        manifest['bodies'][body] = body_entry
        if package.get('presentation'):
            for name, value in package['presentation'].items():
                body_entry[name] = copy.deepcopy(value)
            for layer in package.get('layers', {}):
                body_entry[f'{layer}FramePattern'] = package['presentation'][f'{layer}FramePattern']
                body_entry[f'{layer}Poster'] = package['presentation'][f'{layer}Poster']
            if args.frame_base_url and not args.hosted_output:
                for layer in package['layers']:
                    for field in ('FramePattern', 'Poster'):
                        key = f'{layer}{field}'
                        manifest['bodies'][body][key] = urljoin(args.frame_base_url, manifest['bodies'][body][key])
        tiers = []
        for tier in package.get('resolutions', []):
            tiers.append(resolution_manifest_entry(body, package, tier, args, package.get('presentation')))
        master_tier = {'id': resolution_id(args.width), 'width': args.width, 'height': args.height,
                       'azimuthCount': args.azimuth_count, 'elevations': args.elevations,
                       'framePattern': manifest_path(pattern, args), 'poster': f'{body}/poster.webp',
                       'posterWidth': args.width, 'posterHeight': args.height}
        if package.get('presentation'):
            master_tier.update({name: copy.deepcopy(value) for name, value in package['presentation'].items()
                                if not name.endswith('FramePattern') and not name.endswith('Poster')})
            for layer, layer_package in package.get('layers', {}).items():
                layer_poster = layer_package['poster']
                master_pattern = package['presentation'].get(f'{layer}FramePattern')
                if not master_pattern:
                    master_pattern = f'{body}/{LAYERS[layer]}/e{{elevation}}/' + ('a000.webp' if layer == 'ring' else 'a{azimuth}.webp')
                master_tier[f'{layer}FramePattern'] = manifest_path(master_pattern, args)
                master_tier[f'{layer}Poster'] = layer_poster['path']
                master_tier[f'{layer}Width'] = layer_poster.get('width', package['presentation'][f'{layer}Width'])
                master_tier[f'{layer}Height'] = layer_poster.get('height', package['presentation'][f'{layer}Height'])
                master_tier[f'{layer}PosterWidth'] = master_tier[f'{layer}Width']
                master_tier[f'{layer}PosterHeight'] = master_tier[f'{layer}Height']
        tiers.append(master_tier)
        tiers.sort(key=lambda tier: tier['width'])
        body_entry['resolutions'] = tiers
        if tiers and len(tiers) > 1:
            preview = tiers[0]
            body_entry['poster'] = preview['poster']
            body_entry['posterWidth'] = preview['posterWidth']
            body_entry['posterHeight'] = preview['posterHeight']
            for layer in LAYERS:
                if f'{layer}Poster' in preview:
                    body_entry[f'{layer}Poster'] = preview[f'{layer}Poster']
                    body_entry[f'{layer}PosterWidth'] = preview[f'{layer}PosterWidth']
                    body_entry[f'{layer}PosterHeight'] = preview[f'{layer}PosterHeight']
    checksum_text = '\n'.join(sorted(checksums)) + '\n'
    atomic_write(args.output / 'SHA256SUMS', lambda temporary: temporary.write_text(checksum_text, encoding='utf-8'))
    atomic_json(args.output / 'manifest.json', manifest)
    if args.hosted_output:
        hosted_manifest = {**manifest, 'bodies': {}}
        poster_names = {}
        def export_poster(body, path):
            if path in poster_names:
                return poster_names[path]
            source = args.output / path
            if not source.is_file():
                raise ValueError(f'Hosted poster source is missing: {source}')
            digest = checksum(source)
            name = f'posters/{body}-{digest[:16]}.webp'
            copy_file(source, args.hosted_output / name)
            if checksum(args.hosted_output / name) != digest:
                raise ValueError(f'Hosted poster changed during export: {body}')
            poster_names[path] = name
            return name
        def export_entry(body, value):
            result = {}
            for key, item in value.items():
                if key == 'metadata':
                    continue
                if key == 'resolutions':
                    result[key] = [export_entry(body, tier) for tier in item]
                elif key == 'poster' or key.endswith('Poster'):
                    result[key] = export_poster(body, item)
                elif key == 'framePattern' or key.endswith('FramePattern'):
                    result[key] = urljoin(args.frame_base_url, item)
                else:
                    result[key] = copy.deepcopy(item)
            return result
        for body, entry in manifest['bodies'].items():
            hosted_manifest['bodies'][body] = export_entry(body, entry)
        atomic_json(args.hosted_output / 'manifest.json', hosted_manifest)
    print(f'VERIFIED {len(BODIES) * len(args.elevations) * args.azimuth_count} frames', flush=True)


def main(argv=None):
    args = parse_args(argv)
    if not args.verify_only:
        for body in (args.body,) if args.body else BODIES:
            package_body(body, args)
    if args.manifest:
        publish_manifest(args)
    elif args.verify_only:
        verify_body(args.body, args)
        print(f'VERIFIED {args.body} {len(args.elevations) * args.azimuth_count} frames', flush=True)


if __name__ == '__main__':
    main()
