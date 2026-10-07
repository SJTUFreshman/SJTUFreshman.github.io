import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
BODIES = ('sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune')
GRID = {'width': 3840, 'height': 2160, 'azimuthCount': 180, 'elevations': [-90, -60, -30, 0, 30, 60, 90]}
PUBLIC_ROOTS = {'assets', 'documents', 'fonts', 'images'}
ROOT_FILES = {'index.html', 'life.html', 'pet-cache-worker.js', 'me_at_dorm.jpg', 'official_portray.png'}
STATIC_SUFFIXES = {'.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
                   '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.md', '.txt'}
MAX_FILES = 20000
MAX_BYTES = 25 * 1024 * 1024
MANIFEST_PATH = 'assets/celestial/hosted/manifest.json'


def source_file(root, relative):
    relative_path = PurePosixPath(relative)
    if (not relative or relative_path.is_absolute() or '\\' in relative or ':' in relative or
            any(part in ('.', '..') for part in relative.split('/'))):
        raise ValueError(f'Unsafe source path: {relative}')
    source = root.joinpath(*relative_path.parts)
    if source.resolve() != source or not source.is_file():
        raise ValueError(f'Source must be a regular file without symlinks: {relative}')
    if source.stat().st_size > MAX_BYTES:
        raise ValueError(f'File exceeds the Pages 25 MiB limit: {relative}')
    return source


def read_json(path):
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError(f'Expected a JSON object: {path}')
    return value


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def public_files(root):
    tracked = subprocess.run(['git', 'ls-files', '-z'], cwd=root, check=True, capture_output=True)
    paths = tracked.stdout.decode('utf-8').split('\0')
    entries = {}
    for relative in paths:
        parts = PurePosixPath(relative).parts
        if not parts or (relative not in ROOT_FILES and parts[0] not in PUBLIC_ROOTS):
            continue
        if (any(part.startswith('.') or part in {'__pycache__', 'render-metadata'} for part in parts) or
                PurePosixPath(relative).suffix.lower() not in STATIC_SUFFIXES or
                relative.startswith(('assets/celestial/baked/', 'assets/celestial/releases/')) or
                parts[-1] == 'package.json'):
            continue
        entries[relative] = {'source': source_file(root, relative)}
    if not ROOT_FILES.issubset(entries) or MANIFEST_PATH not in entries:
        raise ValueError('Tracked website entry points or hosted atlas manifest are missing.')
    return entries


def atlas_files(root, version):
    baked = root / 'assets' / 'celestial' / 'baked'
    manifest = read_json(source_file(root, 'assets/celestial/baked/manifest.json'))
    if (manifest.get('version') != 1 or manifest.get('width') != GRID['width'] or
            manifest.get('height') != GRID['height'] or set(manifest.get('bodies', {})) != set(BODIES)):
        raise ValueError('The local atlas must contain the complete legacy 4K ten-body release.')
    prefix = f'assets/celestial/releases/{version}'
    entries = {}
    public_manifest = {'version': 1, 'width': GRID['width'], 'height': GRID['height'], 'bodies': {}}
    for body in BODIES:
        descriptor = manifest['bodies'][body]
        package = read_json(source_file(baked, f'{body}/package.json'))
        if (not isinstance(descriptor, dict) or package.get('version') != 1 or package.get('body') != body or
                any(descriptor.get(key) != value or package.get(key) != value for key, value in GRID.items()) or
                any(package.get(key) for key in ('presentation', 'layers', 'resolutions')) or
                set(descriptor) - set(GRID) - {'framePattern', 'poster', 'defaultAzimuth', 'defaultElevation', 'metadata'}):
            raise ValueError(f'Unsupported or inconsistent legacy atlas description: {body}')
        pattern = f'{body}/e{{elevation}}/a{{azimuth}}.webp'
        if (descriptor.get('framePattern') != pattern or descriptor.get('poster') != f'{body}/poster.webp' or
                descriptor.get('metadata') != f'{body}/package.json'):
            raise ValueError(f'Unexpected atlas paths: {body}')
        expected = {f'{body}/e{row}/a{column:03d}.webp'
                    for row in range(len(GRID['elevations'])) for column in range(GRID['azimuthCount'])}
        records = package.get('frames', [])
        if (not isinstance(records, list) or len(records) != len(expected) or
                any(not isinstance(record, dict) for record in records) or
                {record.get('path') for record in records} != expected):
            raise ValueError(f'Incomplete or duplicate frame records: {body}')
        actual = {path.relative_to(baked).as_posix() for path in (baked / body).glob('e*/a*.webp')}
        if actual != expected:
            raise ValueError(f'Local files do not match the complete frame grid: {body}')
        records_by_path = {record['path']: record for record in records}
        poster = package.get('poster', {})
        row, column = poster.get('elevation'), poster.get('azimuth')
        if (type(row) is not int or type(column) is not int or not 0 <= row < len(GRID['elevations']) or
                not 0 <= column < GRID['azimuthCount'] or poster.get('path') != f'{body}/poster.webp' or
                poster.get('source') != f'{body}/e{row}/a{column:03d}.webp' or
                descriptor.get('defaultElevation') != row or descriptor.get('defaultAzimuth') != column or
                poster.get('sha256') != records_by_path[poster['source']].get('sha256')):
            raise ValueError(f'Poster does not match its selected viewpoint: {body}')
        for record in [*records, poster]:
            relative = record['path']
            source = source_file(baked, relative)
            if (not re.fullmatch(r'[0-9a-f]{64}', str(record.get('sha256', ''))) or
                    'bytes' in record and record['bytes'] != source.stat().st_size):
                raise ValueError(f'Invalid frame checksum or byte count: {relative}')
            entries[f'{prefix}/{relative}'] = {'source': source, 'sha256': record['sha256'], 'webp': True}
        public_manifest['bodies'][body] = {
            **GRID, 'framePattern': f'/{prefix}/{pattern}', 'poster': f'/{prefix}/{body}/poster.webp',
            'defaultAzimuth': column, 'defaultElevation': row,
        }
    return entries, public_manifest


def validate_output(root, output):
    output = output if output.is_absolute() else root / output
    absolute = output.absolute()
    resolved = output.resolve()
    work = root / '.render-work'
    if (resolved != absolute or not resolved.is_relative_to(work) or resolved == work or
            resolved.exists() and (not resolved.is_dir() or any(resolved.iterdir()))):
        raise ValueError('Output must be a new or empty directory inside this workspace .render-work, without symlinks.')
    report = resolved.with_name(resolved.name + '-report.json')
    if report.exists() or report.is_symlink():
        raise ValueError(f'Report already exists; choose a new output directory: {report}')
    return resolved, report


def copy_entry(entry, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    source = entry.get('source')
    if source:
        if source.resolve() != source:
            raise ValueError(f'Source became a symlink: {source}')
        with source.open('rb') as incoming, destination.open('xb') as outgoing:
            first = True
            for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                if first and entry.get('webp') and (chunk[:4] != b'RIFF' or chunk[8:12] != b'WEBP'):
                    raise ValueError(f'Invalid WebP container: {source}')
                first = False
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError(f'File exceeds 25 MiB: {source}')
                digest.update(chunk)
                outgoing.write(chunk)
    else:
        data = entry['data']
        with destination.open('xb') as outgoing:
            outgoing.write(data)
        size = len(data)
        digest.update(data)
    checksum = digest.hexdigest()
    if size != entry['bytes'] or entry.get('sha256', checksum) != checksum:
        raise ValueError(f'Size or SHA256 mismatch after copy: {source or destination}')
    return {'bytes': size, 'sha256': checksum}


def prepare(root, output, version='20261002-4k-v1', external_atlas=False):
    root = root.resolve()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', version):
        raise ValueError('Version must be a simple release name of at most 80 characters.')
    output, report_path = validate_output(root, output)
    entries = public_files(root)
    frame_count = 0
    if not external_atlas:
        frames, manifest = atlas_files(root, version)
        if set(frames) & set(entries):
            raise ValueError('Release frame paths collide with tracked website files.')
        entries.update(frames)
        frame_count = len(frames)
        entries[MANIFEST_PATH] = {'data': json_bytes(manifest)}
    entries['404.html'] = {'data': (
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found</title>'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<h1>Page not found</h1><p><a href="/">Return home</a></p></html>\n').encode('utf-8')}
    entries['_headers'] = {'data': (
        '/assets/celestial/releases/*\n  Cache-Control: public, max-age=31536000, immutable\n'
        '/assets/celestial/hosted/manifest.json\n  Cache-Control: public, max-age=0, must-revalidate\n'
        '/pet-cache-worker.js\n  Cache-Control: no-cache\n').encode('utf-8')}
    for relative, entry in entries.items():
        entry['bytes'] = entry['source'].stat().st_size if 'source' in entry else len(entry['data'])
        if entry['bytes'] > MAX_BYTES:
            raise ValueError(f'File exceeds the Pages 25 MiB limit: {relative}')
    if len(entries) > MAX_FILES:
        raise ValueError(f'Pages file limit exceeded: {len(entries)} > {MAX_FILES}')
    output.mkdir(parents=True, exist_ok=True)
    records = {}
    for index, (relative, entry) in enumerate(sorted(entries.items()), 1):
        records[relative] = copy_entry(entry, output / relative)
        if index % 1000 == 0:
            print(f'Copied and verified {index}/{len(entries)} files.', flush=True)
    report = {
        'preparedAt': datetime.now(timezone.utc).isoformat(), 'output': str(output),
        'atlasMode': 'external' if external_atlas else 'same-origin',
        'releaseVersion': None if external_atlas else version,
        'fileCount': len(records), 'totalBytes': sum(record['bytes'] for record in records.values()),
        'verifiedAtlasFiles': frame_count, 'limits': {'files': MAX_FILES, 'fileBytes': MAX_BYTES},
        'files': records,
    }
    with report_path.open('xb') as destination:
        destination.write(json_bytes(report))
    print(f'Prepared {len(records)} public files in {output}\nPrivate verification report: {report_path}')
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description='Prepare a verified static Cloudflare Pages upload directory.')
    parser.add_argument('--output', type=Path, default=Path('.render-work/cloudflare-pages/site'))
    parser.add_argument('--version', default='20261002-4k-v1')
    parser.add_argument('--external-atlas', action='store_true', help='Keep the existing Tencent-hosted atlas manifest.')
    args = parser.parse_args(argv)
    try:
        prepare(ROOT, args.output, args.version, args.external_atlas)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Preparation failed: {error}\nDo not deploy a partially prepared directory. Use a new empty output for retry.\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
