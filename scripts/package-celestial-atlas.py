import argparse
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


def frame_paths(body, args):
    for row in range(len(args.elevations)):
        for column in range(args.azimuth_count):
            yield row, column, Path(body) / f'e{row}' / f'a{column:03d}.webp'


def source_frame(relative, args):
    formats = ('webp', 'png') if args.input_format == 'auto' else (args.input_format,)
    candidates = [args.input / relative.with_suffix('.' + extension) for extension in formats]
    existing = [candidate for candidate in candidates if candidate.is_file()]
    if not existing:
        raise ValueError(f'Missing source frame: {relative.with_suffix("")} ({", ".join(formats)})')
    if len(existing) > 1:
        raise ValueError(f'Ambiguous source frame: {relative.with_suffix("")}; choose --input-format png or webp.')
    return existing[0]


def validate_image(filename, args, expected_format):
    try:
        with Image.open(filename) as image:
            if image.format != expected_format or getattr(image, 'n_frames', 1) != 1:
                raise ValueError(f'Expected one {expected_format} image: {filename}')
            if image.size != (args.width, args.height):
                raise ValueError(f'Frame dimensions {image.size} differ from {(args.width, args.height)}: {filename}')
            if not args.hash_only:
                image.load()
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
        expected = {'width': args.width, 'height': args.height, 'azimuthCount': args.azimuth_count, 'elevations': args.elevations, 'resolution': [args.width, args.height]}
        for key, value in expected.items():
            if key in metadata and metadata[key] != value:
                raise ValueError(f'Renderer metadata {key} does not match the requested grid: {source}')
        relative = Path(body) / 'render-metadata' / source.name
        copy_file(source, args.output / relative)
        entries.append({'path': relative.as_posix(), 'sha256': checksum(source), 'parameters': metadata})
    return entries


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


def package_body(body, args):
    sources = [(row, column, relative, source_frame(relative, args)) for row, column, relative in frame_paths(body, args)]
    provenance = render_metadata(body, args)
    records = []
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        for index, record in enumerate(executor.map(lambda entry: package_frame(entry, args), sources)):
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
    atomic_json(args.output / body / 'package.json', metadata)


def verify_frame(record, args):
    frame = args.output / record['path']
    validate_image(frame, args, 'WEBP')
    digest = checksum(frame)
    if digest != record.get('sha256'):
        raise ValueError(f'Frame changed after packaging: {frame}')
    return f'{digest}  {record["path"]}'


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
    expected_paths = {relative.as_posix() for _, _, relative in frame_paths(body, args)}
    actual_paths = {frame.relative_to(args.output).as_posix() for frame in (args.output / body).glob('e*/a*.webp')}
    if actual_paths != expected_paths:
        raise ValueError(f'Incomplete or unexpected frame grid for {body}: missing={sorted(expected_paths - actual_paths)[:5]}, unexpected={sorted(actual_paths - expected_paths)[:5]}')
    records = package.get('frames', [])
    if len(records) != len(expected_paths) or {record.get('path') for record in records} != expected_paths:
        raise ValueError(f'Package frame records do not match the grid for {body}.')
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        checksums.extend(executor.map(lambda record: verify_frame(record, args), records))
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
    validate_image(poster_path, args, 'WEBP')
    poster_hash = checksum(poster_path)
    if poster_hash != poster['sha256'] or poster_hash != checksum(args.output / poster['source']):
        raise ValueError(f'Poster differs from its selected frame: {poster_path}')
    checksums.extend([f'{poster_hash}  {body}/poster.webp', f'{checksum(package_path)}  {body}/package.json'])
    return package, checksums


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
        manifest['bodies'][body] = {'azimuthCount': args.azimuth_count, 'elevations': args.elevations,
                                  'width': args.width, 'height': args.height,
                                  'framePattern': urljoin(args.frame_base_url, pattern) if args.frame_base_url and not args.hosted_output else pattern,
                                  'poster': f'{body}/poster.webp', 'defaultAzimuth': poster['azimuth'],
                                  'defaultElevation': poster['elevation'], 'metadata': f'{body}/package.json'}
    checksum_text = '\n'.join(sorted(checksums)) + '\n'
    atomic_write(args.output / 'SHA256SUMS', lambda temporary: temporary.write_text(checksum_text, encoding='utf-8'))
    atomic_json(args.output / 'manifest.json', manifest)
    if args.hosted_output:
        hosted_manifest = {**manifest, 'bodies': {}}
        for body, entry in manifest['bodies'].items():
            poster = packages[body]['poster']
            poster_name = f'posters/{body}-{poster["sha256"][:16]}.webp'
            copy_file(args.output / poster['path'], args.hosted_output / poster_name)
            if checksum(args.hosted_output / poster_name) != poster['sha256']:
                raise ValueError(f'Hosted poster changed during export: {body}')
            hosted_manifest['bodies'][body] = {**{key: value for key, value in entry.items() if key != 'metadata'},
                'framePattern': urljoin(args.frame_base_url, entry['framePattern']),
                'poster': poster_name}
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
