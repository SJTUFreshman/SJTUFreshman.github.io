import argparse
import copy
import hashlib
import importlib.util
import json
import re
import tarfile
from pathlib import Path, PurePosixPath


BODIES = ('sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune')
MAX_BYTES = 25 * 1024 * 1024


def selected_files(manifest):
    if manifest.get('version') != 1 or set(manifest.get('bodies', {})) != set(BODIES):
        raise ValueError('Expected the complete ten-body manifest.')
    selected = {}
    for body, descriptor in manifest['bodies'].items():
        row = descriptor['defaultElevation']
        count = descriptor['azimuthCount']
        if type(row) is not int or not 0 <= row < len(descriptor['elevations']) or type(count) is not int or count < 2:
            raise ValueError(f'Invalid fixed viewpoint: {body}')
        climate = descriptor.get('climate', {})
        times = climate.get('frameCount', 1)
        if type(times) is not int or not 1 <= times <= 4096:
            raise ValueError(f'Invalid climate time grid: {body}')
        paths = set()
        for variant in [descriptor, *descriptor.get('resolutions', [])]:
            for column in range(count):
                values = {'elevation': row, 'azimuth': f'{column:03d}'}
                paths.add(variant['framePattern'].format(**values))
                if variant.get('cloudFramePattern'):
                    for time_index in range(times):
                        paths.add(variant['cloudFramePattern'].format(**values, time=f'{time_index:0{climate.get("timePad", 3)}d}'))
            if variant.get('ringFramePattern'):
                paths.add(variant['ringFramePattern'].format(elevation=row, azimuth='000'))
            for key in ('poster', 'cloudPoster', 'ringPoster'):
                if variant.get(key):
                    paths.add(variant[key])
        for relative in paths:
            path = PurePosixPath(relative)
            if (path.is_absolute() or '\\' in relative or ':' in relative or
                    any(part in ('.', '..', '') for part in relative.split('/')) or
                    path.parts[0] != body or path.suffix != '.webp'):
                raise ValueError(f'Unsafe public frame path: {relative}')
        selected[body] = sorted(paths)
    return selected


def public_manifest(manifest, version, base_url=None):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}', version):
        raise ValueError('Invalid release version.')
    selected_files(manifest)
    result = copy.deepcopy(manifest)
    prefix = base_url or f'/assets/celestial/releases/{version}/'

    def rewrite(descriptor):
        descriptor.pop('metadata', None)
        for key, value in list(descriptor.items()):
            if key == 'poster' or key == 'framePattern' or key.endswith(('Poster', 'FramePattern')):
                descriptor[key] = prefix.rstrip('/') + '/' + value

    for descriptor in result['bodies'].values():
        descriptor['availableElevations'] = [descriptor['defaultElevation']]
        rewrite(descriptor)
        for variant in descriptor.get('resolutions', []):
            rewrite(variant)
    result['playbackMode'] = 'autoplay'
    result['releaseVersion'] = version
    return result


def checksum(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def export(source, output, version):
    source, output = source.resolve(), output.resolve()
    if output.exists() or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('Use a new output directory separate from the source atlas.')
    specification = importlib.util.spec_from_file_location('release', Path(__file__).with_name('manage-celestial-release.py'))
    release = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(release)
    manifest = json.loads((source / 'manifest.json').read_text())
    selected = selected_files(manifest)
    public_manifest(manifest, version)
    sums = release.read_checksums(source / 'SHA256SUMS')
    records = {}
    for body, paths in selected.items():
        package_path = source / body / 'package.json'
        if checksum(package_path) != sums[f'{body}/package.json']:
            raise ValueError(f'Package changed: {body}')
        package = json.loads(package_path.read_text())
        package_records = release.package_records(package, body)
        for relative in paths:
            record = package_records[relative]
            path = release.source_file(source, relative)
            size = path.stat().st_size
            if sums.get(relative) != record['sha256'] or size > MAX_BYTES or 'bytes' in record and record['bytes'] != size:
                raise ValueError(f'Invalid frame size or checksum declaration: {relative}')
            records[relative] = {'bytes': size, 'sha256': record['sha256']}
    output.mkdir(parents=True)
    archives = {}
    for body, paths in selected.items():
        archive_path = output / f'{body}.tar'
        with tarfile.open(archive_path, 'w', format=tarfile.PAX_FORMAT) as archive:
            for relative in paths:
                path = release.source_file(source, relative)
                member = tarfile.TarInfo(relative)
                member.size = records[relative]['bytes']
                member.mode = 0o644
                with path.open('rb') as stream:
                    hashing = release.HashingReader(stream)
                    archive.addfile(member, hashing)
                if hashing.digest.hexdigest() != records[relative]['sha256']:
                    raise ValueError(f'Frame changed: {relative}')
        archives[archive_path.name] = {'bytes': archive_path.stat().st_size, 'sha256': checksum(archive_path)}
        print(f'EXPORTED {body} {len(paths)} files {archive_path.stat().st_size} bytes', flush=True)
    (output / 'manifest.json').write_bytes((source / 'manifest.json').read_bytes())
    inventory = {'schema': 1, 'version': version, 'sourceManifestSha256': checksum(source / 'manifest.json'),
                 'sourceChecksumsSha256': checksum(source / 'SHA256SUMS'), 'files': records, 'archives': archives}
    (output / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
    print(f'READY {len(records)} verified files {sum(record["bytes"] for record in records.values())} bytes', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Export fixed-view, all-azimuth and all-time frames from a verified celestial atlas.')
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--version', required=True)
    options = parser.parse_args()
    export(options.input, options.output, options.version)
