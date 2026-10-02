import argparse
import hashlib
import json
import os
import re
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


BODIES = ('sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune')
GRID = {'width': 3840, 'height': 2160, 'azimuthCount': 180, 'elevations': [-90, -60, -30, 0, 30, 60, 90]}
VERSION = '20261002-4k-v1'
MAX_MEMBER_BYTES = 64 * 1024 * 1024


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def safe_path(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value or '\x00' in value:
        raise ValueError(f'Unsafe asset path: {value!r}')
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError(f'Unsafe asset path: {value!r}')
    return relative


def valid_hash(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
        raise ValueError('Expected a lowercase SHA256 checksum.')
    return value


def source_file(root, relative):
    relative = safe_path(relative)
    candidate = root.joinpath(*relative.parts)
    for ancestor in (candidate, *candidate.parents):
        if ancestor == root:
            break
        if ancestor.is_symlink():
            raise ValueError(f'Symbolic links are not supported: {candidate}')
    if not candidate.is_file():
        raise ValueError(f'Missing regular file: {candidate}')
    return candidate


def read_checksums(path):
    records = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        digest, separator, name = line.partition('  ')
        valid_hash(digest)
        safe_path(name)
        if not separator or name in records:
            raise ValueError('Malformed or duplicate source checksum entry.')
        records[name] = digest
    return records


def package_records(package, body):
    if not isinstance(package, dict) or package.get('version') != 1 or package.get('body') != body:
        raise ValueError(f'Invalid package for {body}.')
    if any(package.get(key) != value for key, value in GRID.items()):
        raise ValueError(f'Unexpected production grid for {body}.')
    expected = {f'{body}/e{row}/a{column:03d}.webp'
                for row in range(len(GRID['elevations'])) for column in range(GRID['azimuthCount'])}
    frames = package.get('frames', [])
    if len(frames) != len(expected) or {record.get('path') for record in frames} != expected:
        raise ValueError(f'Incomplete frame records for {body}.')
    records = {}
    for frame in frames:
        if type(frame.get('bytes')) is not int or not 0 < frame['bytes'] <= MAX_MEMBER_BYTES:
            raise ValueError(f'Invalid frame byte count for {body}.')
        records[frame['path']] = {'sha256': valid_hash(frame.get('sha256')), 'bytes': frame['bytes']}
    poster = package.get('poster', {})
    if poster.get('path') != f'{body}/poster.webp' or poster.get('source') not in expected:
        raise ValueError(f'Invalid poster selection for {body}.')
    if poster.get('sha256') != records[poster['source']]['sha256']:
        raise ValueError(f'Poster differs from the selected frame for {body}.')
    records[poster['path']] = records[poster['source']].copy()
    for metadata in package.get('renderMetadata', []):
        relative = safe_path(metadata.get('path'))
        if relative.parent.as_posix() != f'{body}/render-metadata' or relative.suffix != '.json':
            raise ValueError(f'Unexpected metadata path for {body}.')
        if relative.as_posix() in records:
            raise ValueError(f'Duplicate metadata path for {body}.')
        records[relative.as_posix()] = {'sha256': valid_hash(metadata.get('sha256'))}
    return records


def checked_copy(source, destination, expected, expected_bytes=None):
    digest = hashlib.sha256()
    count = 0
    with destination.open('xb') as output:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            output.write(block)
            count += len(block)
            digest.update(block)
    if digest.hexdigest() != expected or expected_bytes is not None and count != expected_bytes:
        raise ValueError(f'File checksum or byte count mismatch: {destination.name}')


class HashingReader:
    def __init__(self, source):
        self.source = source
        self.digest = hashlib.sha256()

    def read(self, size=-1):
        block = self.source.read(size)
        self.digest.update(block)
        return block


def validate_release(release):
    if not isinstance(release, dict) or release.get('schema') != 1:
        raise ValueError('Unsupported release manifest.')
    version = release.get('version', '')
    if not isinstance(version, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,79}', version):
        raise ValueError('Invalid release version.')
    total = len(BODIES) * GRID['azimuthCount'] * len(GRID['elevations'])
    if release.get('grid') != GRID or release.get('frames') != total:
        raise ValueError('Release is not the complete production atlas.')
    assets = release.get('assets', [])
    if len(assets) != len(BODIES) or {asset.get('body') for asset in assets} != set(BODIES):
        raise ValueError('Release must include exactly one archive per body.')
    for asset in assets:
        if asset.get('name') != f'{asset["body"]}-{version}.tar' or asset.get('frames') != total // len(BODIES):
            raise ValueError('Unexpected archive name or frame count.')
    sums = release.get('sourceChecksums', {})
    if sums.get('name') != 'source-SHA256SUMS':
        raise ValueError('Missing source checksum asset.')
    for asset in [*assets, sums]:
        valid_hash(asset.get('sha256'))
        if type(asset.get('bytes')) is not int or asset['bytes'] <= 0:
            raise ValueError('Invalid release asset byte count.')
    return release


def verify_asset(directory, asset):
    path = source_file(directory, asset['name'])
    if path.stat().st_size != asset['bytes'] or checksum(path) != asset['sha256']:
        raise ValueError(f'Release asset checksum mismatch: {asset["name"]}')
    return path


def prepare(source, output, version):
    source, output = source.resolve(), output.resolve()
    if output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('Release output must be separate from source images.')
    release = {'schema': 1, 'version': version, 'grid': GRID,
               'frames': len(BODIES) * GRID['azimuthCount'] * len(GRID['elevations']), 'assets': []}
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,79}', version):
        raise ValueError('Invalid release version.')
    source_sums = source_file(source, 'SHA256SUMS')
    sums = read_checksums(source_sums)
    existing = output / 'release.json'
    if existing.exists():
        published = validate_release(read_json(existing))
        if published['version'] != version or published['sourceChecksums']['sha256'] != checksum(source_sums):
            raise ValueError('An immutable release already exists with different input or version.')
        for asset in [*published['assets'], published['sourceChecksums']]:
            verify_asset(output, asset)
        print(f'ALREADY PREPARED {version}', flush=True)
        return published
    output.mkdir(parents=True, exist_ok=True)
    expected_paths = set()
    for body in BODIES:
        package_path = source_file(source, f'{body}/package.json')
        records = package_records(read_json(package_path), body)
        records[f'{body}/package.json'] = {'sha256': checksum(package_path)}
        for name, record in records.items():
            if sums.get(name) != record['sha256']:
                raise ValueError(f'Package does not match source SHA256SUMS: {name}')
        expected_paths.update(records)
        name = f'{body}-{version}.tar'
        descriptor, temporary_name = tempfile.mkstemp(prefix=f'.{body}-', suffix='.tar', dir=output)
        os.close(descriptor)
        temporary = Path(temporary_name)
        try:
            with tarfile.open(temporary, 'w', format=tarfile.PAX_FORMAT) as archive:
                for relative, record in sorted(records.items()):
                    path = source_file(source, relative)
                    size = path.stat().st_size
                    if size > MAX_MEMBER_BYTES or 'bytes' in record and size != record['bytes']:
                        raise ValueError(f'Unexpected source size: {relative}')
                    member = tarfile.TarInfo(relative)
                    member.size = size
                    member.mode = 0o644
                    with path.open('rb') as stream:
                        hashing = HashingReader(stream)
                        archive.addfile(member, hashing)
                    if hashing.digest.hexdigest() != record['sha256']:
                        raise ValueError(f'Source changed after validation: {relative}')
            if temporary.stat().st_size >= 2 * 1024 ** 3:
                raise ValueError(f'{body} exceeds the GitHub Release per-file limit; split the archive before publishing.')
            os.replace(temporary, output / name)
        finally:
            temporary.unlink(missing_ok=True)
        asset = {'body': body, 'name': name, 'frames': GRID['azimuthCount'] * len(GRID['elevations']),
                 'bytes': (output / name).stat().st_size, 'sha256': checksum(output / name)}
        release['assets'].append(asset)
        print(f'PREPARED {body} {asset["bytes"]} bytes', flush=True)
    if set(sums) != expected_paths:
        raise ValueError('Unexpected files in source SHA256SUMS.')
    shutil.copyfile(source_sums, output / 'source-SHA256SUMS')
    release['sourceChecksums'] = {'name': 'source-SHA256SUMS', 'bytes': source_sums.stat().st_size,
                                'sha256': checksum(source_sums)}
    validate_release(release)
    temporary_manifest = output / '.release.json.tmp'
    write_json(temporary_manifest, release)
    os.replace(temporary_manifest, existing)
    return release


def installed_path(root, relative):
    area = 'public' if relative.endswith('.webp') else 'private'
    return root / area / relative


def verify_installed(root, release):
    if read_json(root / 'private/release.json') != release:
        raise ValueError('An immutable version exists with a different release manifest.')
    verify_asset(root / 'private', release['sourceChecksums'])
    sums = read_checksums(root / 'private/source-SHA256SUMS')
    expected_paths = set()
    for body in BODIES:
        package_path = source_file(root / 'private', f'{body}/package.json')
        if checksum(package_path) != sums.get(f'{body}/package.json'):
            raise ValueError(f'Installed package checksum mismatch: {body}')
        records = package_records(read_json(package_path), body)
        expected_paths.add(f'{body}/package.json')
        for relative, record in records.items():
            area = 'public' if relative.endswith('.webp') else 'private'
            path = source_file(root / area, relative)
            if sums.get(relative) != record['sha256'] or checksum(path) != record['sha256']:
                raise ValueError(f'Installed file checksum mismatch: {relative}')
            if 'bytes' in record and path.stat().st_size != record['bytes']:
                raise ValueError(f'Installed file size mismatch: {relative}')
            expected_paths.add(relative)
    if set(sums) != expected_paths:
        raise ValueError('Installed source checksums do not match the release.')
    actual_public = {path.relative_to(root / 'public').as_posix() for path in (root / 'public').rglob('*') if path.is_file()}
    if actual_public != {relative for relative in expected_paths if relative.endswith('.webp')}:
        raise ValueError('Unexpected public files in installed release.')


def extract_body(archive_path, asset, sums, stage):
    body = asset['body']
    with tarfile.open(archive_path, 'r:') as archive:
        members = {}
        for member in archive:
            relative = safe_path(member.name)
            if relative.parts[0] != body or not member.isfile() or member.name in members:
                raise ValueError(f'Unsafe, duplicate or unexpected archive member: {member.name}')
            if not 0 <= member.size <= MAX_MEMBER_BYTES or member.sparse is not None:
                raise ValueError(f'Unsupported archive member: {member.name}')
            members[member.name] = member
        package_name = f'{body}/package.json'
        if package_name not in members:
            raise ValueError(f'Archive has no package metadata: {body}')
        package_bytes = archive.extractfile(members[package_name]).read()
        if hashlib.sha256(package_bytes).hexdigest() != sums.get(package_name):
            raise ValueError(f'Package checksum mismatch: {body}')
        records = package_records(json.loads(package_bytes), body)
        records[package_name] = {'sha256': sums[package_name]}
        if set(records) != set(members):
            raise ValueError(f'Archive file inventory does not match package metadata: {body}')
        for relative, record in records.items():
            if sums.get(relative) != record['sha256']:
                raise ValueError(f'Source checksum mismatch: {relative}')
            member = members[relative]
            if 'bytes' in record and member.size != record['bytes']:
                raise ValueError(f'Archive member size mismatch: {relative}')
            destination = installed_path(stage, relative)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if relative.endswith('.webp'):
                for directory in destination.parents:
                    if directory == stage:
                        break
                    directory.chmod(0o755)
            with archive.extractfile(member) as stream:
                checked_copy(stream, destination, record['sha256'], member.size)
            destination.chmod(0o644)
        print(f'INSTALLED {body} {asset["frames"]} frames', flush=True)
        return set(records)


def install(source, root):
    source, root = source.resolve(), root.resolve()
    release = validate_release(read_json(source_file(source, 'release.json')))
    releases = root / 'releases'
    releases.mkdir(parents=True, exist_ok=True)
    root.chmod(0o755)
    releases.chmod(0o755)
    version = release['version']
    destination = releases / version
    lock_path = releases / f'.{version}.lock'
    descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        if destination.exists():
            verify_installed(destination, release)
            print(f'ALREADY INSTALLED {destination / "public"}', flush=True)
            return destination
        sums_path = verify_asset(source, release['sourceChecksums'])
        sums = read_checksums(sums_path)
        for asset in release['assets']:
            verify_asset(source, asset)
        with tempfile.TemporaryDirectory(prefix=f'.{version}-', dir=releases) as temporary:
            stage = Path(temporary)
            (stage / 'private').mkdir(mode=0o700)
            (stage / 'public').mkdir(mode=0o755)
            expected_paths = set()
            for asset in release['assets']:
                expected_paths.update(extract_body(source / asset['name'], asset, sums, stage))
            if set(sums) != expected_paths:
                raise ValueError('Source checksums contain unexpected files.')
            shutil.copyfile(sums_path, stage / 'private/source-SHA256SUMS')
            write_json(stage / 'private/release.json', release)
            stage.chmod(0o755)
            os.replace(stage, destination)
        print(f'READY {destination / "public"}', flush=True)
        return destination
    finally:
        lock_path.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Prepare immutable GitHub release assets or install verified celestial frames.')
    commands = parser.add_subparsers(dest='command', required=True)
    prepare_parser = commands.add_parser('prepare')
    prepare_parser.add_argument('--input', type=Path, default=Path('assets/celestial/baked'))
    prepare_parser.add_argument('--output', type=Path, default=Path('.render-work/hosting-release'))
    prepare_parser.add_argument('--version', default=VERSION)
    install_parser = commands.add_parser('install')
    install_parser.add_argument('--input', type=Path, required=True)
    install_parser.add_argument('--root', type=Path, default=Path('/data/life-celestial-assets'))
    args = parser.parse_args(argv)
    if args.command == 'prepare':
        prepare(args.input, args.output, args.version)
    else:
        install(args.input, args.root)


if __name__ == '__main__':
    main()
