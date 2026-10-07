import argparse
import bisect
import contextlib
import hashlib
import io
import json
import math
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
MAX_ASSET_BYTES = 1900 * 1024 * 1024
LAYERS = {'cloud': 'clouds', 'starfield': 'starfield', 'ring': 'rings'}


def climate_frame_count(presentation, body):
    pattern = presentation.get('cloudFramePattern', '') if isinstance(presentation, dict) else ''
    if '{time}' not in pattern:
        return 1
    climate = presentation.get('climate')
    if not isinstance(climate, dict) or type(climate.get('frameCount')) is not int or not 1 <= climate['frameCount'] <= 4096:
        raise ValueError(f'Time-varying cloud frames require climate.frameCount between 1 and 4096 for {body}.')
    return climate['frameCount']


def climate_time_pad(presentation):
    climate = presentation.get('climate') if isinstance(presentation, dict) else None
    return climate.get('timePad', 3) if isinstance(climate, dict) else 3


def validate_climate_metadata(presentation, body):
    if 'climate' not in presentation:
        return None
    climate = presentation['climate']
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
    if 'timeIndex' in climate and (type(climate['timeIndex']) is not int or not 0 <= climate['timeIndex'] <= 4095):
        raise ValueError(f'Invalid climate timeIndex for {body}.')
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
    return climate


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


def validated_grid(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid atlas grid.')
    grid = {key: value.get(key) for key in GRID}
    if any(type(grid[key]) is not int or not 1 <= grid[key] <= 16384 for key in ('width', 'height')) or type(grid['azimuthCount']) is not int or not 2 <= grid['azimuthCount'] <= 36000:
        raise ValueError('Invalid atlas dimensions or azimuth count.')
    elevations = grid['elevations']
    if not isinstance(elevations, list) or not 1 <= len(elevations) <= 181 or any(type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 90 for value in elevations) or any(first >= second for first, second in zip(elevations, elevations[1:])):
        raise ValueError('Invalid atlas elevations.')
    return grid


def package_records(package, body, grid=None):
    if not isinstance(package, dict) or package.get('version') != 1 or package.get('body') != body:
        raise ValueError(f'Invalid package for {body}.')
    package_grid = validated_grid(package)
    if grid is not None and grid != package_grid:
        raise ValueError(f'Package grid differs from the release for {body}.')
    grid = package_grid
    expected = {f'{body}/e{row}/a{column:03d}.webp'
                for row in range(len(grid['elevations'])) for column in range(grid['azimuthCount'])}
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
    presentation = package.get('presentation', {})
    layers = package.get('layers', {})
    if not isinstance(presentation, dict) or not isinstance(layers, dict) or set(layers) - set(LAYERS):
        raise ValueError(f'Invalid auxiliary layers for {body}.')
    validate_climate_metadata(presentation, body)
    if 'climate' in presentation and 'cloudFramePattern' not in presentation:
        raise ValueError(f'Climate metadata requires a cloud layer for {body}.')
    if 'climate' in presentation and '{time}' not in presentation.get('cloudFramePattern', ''):
        raise ValueError(f'Climate metadata requires a timed cloud frame pattern for {body}.')
    if set(layers) != {layer for layer in LAYERS if f'{layer}FramePattern' in presentation}:
        raise ValueError(f'Layer records differ from presentation for {body}.')
    for layer, layer_package in layers.items():
        directory = f'{body}/{LAYERS[layer]}'
        pattern = f'{directory}/e{{elevation}}/a000.webp' if layer == 'ring' else f'{directory}/e{{elevation}}/a{{azimuth}}.webp'
        if layer == 'cloud' and '{time}' in presentation[f'{layer}FramePattern']:
            pattern = f'{directory}/t{{time}}/e{{elevation}}/a{{azimuth}}.webp'
        if presentation[f'{layer}FramePattern'] != pattern:
            raise ValueError(f'Unexpected {layer} frame pattern for {body}.')
        azimuth_count = 1 if layer == 'ring' else grid['azimuthCount']
        times = range(climate_frame_count(presentation, body)) if layer == 'cloud' and '{time}' in pattern else (0,)
        layer_expected = ({f'{directory}/t{time:0{climate_time_pad(presentation)}d}/e{row}/a{column:03d}.webp'
                           for time in times for row in range(len(grid['elevations'])) for column in range(azimuth_count)}
                          if layer == 'cloud' and '{time}' in pattern else
                          {f'{directory}/e{row}/a{column:03d}.webp'
                           for row in range(len(grid['elevations'])) for column in range(azimuth_count)})
        layer_frames = layer_package.get('frames', [])
        if len(layer_frames) != len(layer_expected) or {frame.get('path') for frame in layer_frames} != layer_expected:
            raise ValueError(f'Incomplete {layer} frame records for {body}.')
        for frame in layer_frames:
            if type(frame.get('bytes')) is not int or not 0 < frame['bytes'] <= MAX_MEMBER_BYTES:
                raise ValueError(f'Invalid {layer} frame byte count for {body}.')
            records[frame['path']] = {'sha256': valid_hash(frame.get('sha256')), 'bytes': frame['bytes']}
        layer_poster = layer_package.get('poster', {})
        selected = poster['source'].removeprefix(f'{body}/')
        if layer == 'ring':
            selected = selected.rsplit('/', 1)[0] + '/a000.webp'
        elif layer == 'cloud' and '{time}' in pattern:
            selected = f't{0:0{climate_time_pad(presentation)}d}/{selected}'
        if layer_poster.get('path') != f'{directory}/poster.webp' or layer_poster.get('source') != f'{directory}/{selected}' or presentation.get(f'{layer}Poster') != layer_poster['path']:
            raise ValueError(f'Invalid {layer} poster selection for {body}.')
        if layer_poster.get('sha256') != records[layer_poster['source']]['sha256']:
            raise ValueError(f'{layer} poster differs from the selected frame for {body}.')
        records[layer_poster['path']] = records[layer_poster['source']].copy()
    for metadata in package.get('renderMetadata', []):
        relative = safe_path(metadata.get('path'))
        if relative.parent.as_posix() != f'{body}/render-metadata' or relative.suffix != '.json':
            raise ValueError(f'Unexpected metadata path for {body}.')
        if relative.as_posix() in records:
            raise ValueError(f'Duplicate metadata path for {body}.')
        records[relative.as_posix()] = {'sha256': valid_hash(metadata.get('sha256'))}
    resolutions = package.get('resolutions', [])
    if not isinstance(resolutions, list) or any(not isinstance(resolution, dict) for resolution in resolutions):
        raise ValueError(f'Invalid resolution records for {body}.')
    previous_width = 0
    for resolution in resolutions:
        width, height = resolution.get('width'), resolution.get('height')
        if type(width) is not int or type(height) is not int or not previous_width < width < grid['width'] or height != max(1, round(grid['height'] * width / grid['width'])):
            raise ValueError(f'Invalid resolution dimensions or order for {body}.')
        previous_width = width
        identifier = f'{width // 1024}k' if width % 1024 == 0 else f'{width}px'
        if resolution.get('id') != identifier:
            raise ValueError(f'Invalid resolution identifier for {body}.')
        tier_root = f'{body}/resolutions/{width}'
        tier_layers = resolution.get('layers', {})
        if not isinstance(tier_layers, dict) or set(tier_layers) != set(layers):
            raise ValueError(f'Resolution layers differ from the master for {body}.')
        for layer, entry in [(None, resolution), *tier_layers.items()]:
            directory = f'{tier_root}/{LAYERS[layer]}' if layer else tier_root
            master_directory = f'{body}/{LAYERS[layer]}' if layer else body
            if layer:
                expected_width = max(1, round(presentation.get(f'{layer}Width', grid['width']) * width / grid['width']))
                expected_height = max(1, round(presentation.get(f'{layer}Height', grid['height']) * width / grid['width']))
                if entry.get('width') != expected_width or entry.get('height') != expected_height:
                    raise ValueError(f'Resolution layer dimensions differ from the master for {body}.')
            azimuth_count = 1 if layer == 'ring' else grid['azimuthCount']
            timed_cloud = layer == 'cloud' and '{time}' in presentation.get('cloudFramePattern', '')
            times = range(climate_frame_count(presentation, body)) if timed_cloud else (0,)
            expected_frames = ({f'{directory}/t{time:0{climate_time_pad(presentation)}d}/e{row}/a{column:03d}.webp'
                                for time in times for row in range(len(grid['elevations'])) for column in range(azimuth_count)}
                               if timed_cloud else
                               {f'{directory}/e{row}/a{column:03d}.webp'
                                for row in range(len(grid['elevations'])) for column in range(azimuth_count)})
            tier_frames = entry.get('frames', [])
            if len(tier_frames) != len(expected_frames) or {frame.get('path') for frame in tier_frames} != expected_frames:
                raise ValueError(f'Incomplete resolution frame records for {body}.')
            for frame in tier_frames:
                master_path = f'{master_directory}/{frame["path"].removeprefix(directory + "/")}'
                if frame.get('source') != master_path or frame.get('sourceSha256') != records[master_path]['sha256']:
                    raise ValueError(f'Resolution source differs from the master for {body}.')
                if type(frame.get('bytes')) is not int or not 0 < frame['bytes'] <= MAX_MEMBER_BYTES:
                    raise ValueError(f'Invalid resolution frame byte count for {body}.')
                records[frame['path']] = {'sha256': valid_hash(frame.get('sha256')), 'bytes': frame['bytes']}
            tier_poster = entry.get('poster', {})
            selected = poster['source'].removeprefix(f'{body}/')
            if layer == 'ring':
                selected = selected.rsplit('/', 1)[0] + '/a000.webp'
            elif timed_cloud:
                selected = f't{0:0{climate_time_pad(presentation)}d}/{selected}'
            source = f'{directory}/{selected}'
            if tier_poster.get('path') != f'{directory}/poster.webp' or tier_poster.get('source') != source or tier_poster.get('sha256') != records[source]['sha256']:
                raise ValueError(f'Resolution poster differs from the selected frame for {body}.')
            records[tier_poster['path']] = records[source].copy()
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


class SegmentedReader(io.RawIOBase):
    def __init__(self, paths):
        super().__init__()
        self.paths = paths
        self.offsets = [0]
        for path in paths:
            self.offsets.append(self.offsets[-1] + path.stat().st_size)
        self.position = 0
        self.stream = None
        self.part = -1

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        target = offset if whence == io.SEEK_SET else self.position + offset if whence == io.SEEK_CUR else self.offsets[-1] + offset if whence == io.SEEK_END else -1
        if target < 0:
            raise ValueError('Invalid archive seek.')
        self.position = target
        return target

    def read(self, size=-1):
        remaining = max(0, self.offsets[-1] - self.position)
        remaining = remaining if size < 0 else min(size, remaining)
        blocks = []
        while remaining:
            part = bisect.bisect_right(self.offsets, self.position) - 1
            if part != self.part:
                if self.stream:
                    self.stream.close()
                self.stream = self.paths[part].open('rb')
                self.part = part
            self.stream.seek(self.position - self.offsets[part])
            block = self.stream.read(min(remaining, self.offsets[part + 1] - self.position))
            if not block:
                raise ValueError('A release part changed during extraction.')
            blocks.append(block)
            self.position += len(block)
            remaining -= len(block)
        return b''.join(blocks)

    def close(self):
        if self.stream:
            self.stream.close()
        super().close()


@contextlib.contextmanager
def archive_stream(source):
    stream = SegmentedReader(source) if isinstance(source, list) else source.open('rb')
    with stream:
        yield stream


def validate_release(release):
    if not isinstance(release, dict) or release.get('schema') not in (1, 2):
        raise ValueError('Unsupported release manifest.')
    version = release.get('version', '')
    if not isinstance(version, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,79}', version):
        raise ValueError('Invalid release version.')
    grid = validated_grid(release.get('grid'))
    total = len(BODIES) * grid['azimuthCount'] * len(grid['elevations'])
    if release.get('frames') != total:
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
        if 'parts' in asset:
            parts = asset['parts']
            if release['schema'] != 2 or asset is sums or not isinstance(parts, list) or len(parts) < 2:
                raise ValueError('Invalid multipart release asset.')
            for index, part in enumerate(parts, 1):
                if not isinstance(part, dict) or part.get('name') != f'{asset["name"]}.part{index:03d}':
                    raise ValueError('Missing, reordered or unsafe release part.')
                valid_hash(part.get('sha256'))
                if type(part.get('bytes')) is not int or not 0 < part['bytes'] < 2 * 1024 ** 3:
                    raise ValueError('Invalid release part byte count.')
            if sum(part['bytes'] for part in parts) != asset['bytes']:
                raise ValueError('Release parts do not match the archive size.')
    return release


def verify_asset(directory, asset):
    if 'parts' in asset:
        paths = []
        archive_digest = hashlib.sha256()
        for part in asset['parts']:
            path = source_file(directory, part['name'])
            part_digest = hashlib.sha256()
            with path.open('rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    part_digest.update(block)
                    archive_digest.update(block)
            if path.stat().st_size != part['bytes'] or part_digest.hexdigest() != part['sha256']:
                raise ValueError(f'Release asset checksum mismatch: {part["name"]}')
            paths.append(path)
        if archive_digest.hexdigest() != asset['sha256']:
            raise ValueError(f'Release asset checksum mismatch: {asset["name"]}')
        return paths
    path = source_file(directory, asset['name'])
    if path.stat().st_size != asset['bytes'] or checksum(path) != asset['sha256']:
        raise ValueError(f'Release asset checksum mismatch: {asset["name"]}')
    return path


def prepare(source, output, version, max_asset_bytes=MAX_ASSET_BYTES):
    source, output = source.resolve(), output.resolve()
    if output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('Release output must be separate from source images.')
    if type(max_asset_bytes) is not int or not 1 <= max_asset_bytes < 2 * 1024 ** 3:
        raise ValueError('Release part size must be positive and below 2 GiB.')
    grid = validated_grid(read_json(source_file(source, f'{BODIES[0]}/package.json')))
    release = {'schema': 1, 'version': version, 'grid': grid,
               'frames': len(BODIES) * grid['azimuthCount'] * len(grid['elevations']), 'assets': []}
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
        records = package_records(read_json(package_path), body, grid)
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
            asset = {'body': body, 'name': name, 'frames': grid['azimuthCount'] * len(grid['elevations']),
                     'bytes': temporary.stat().st_size, 'sha256': checksum(temporary)}
            if asset['bytes'] > max_asset_bytes:
                asset['parts'] = []
                release['schema'] = 2
                with temporary.open('rb') as source_archive:
                    while source_archive.tell() < asset['bytes']:
                        part_name = f'{name}.part{len(asset["parts"]) + 1:03d}'
                        partial = output / f'.{part_name}.tmp'
                        part_digest = hashlib.sha256()
                        part_size = 0
                        try:
                            with partial.open('wb') as target:
                                while part_size < max_asset_bytes:
                                    block = source_archive.read(min(1024 * 1024, max_asset_bytes - part_size))
                                    if not block:
                                        break
                                    target.write(block)
                                    part_digest.update(block)
                                    part_size += len(block)
                            os.replace(partial, output / part_name)
                        finally:
                            partial.unlink(missing_ok=True)
                        asset['parts'].append({'name': part_name, 'bytes': part_size, 'sha256': part_digest.hexdigest()})
            else:
                os.replace(temporary, output / name)
        finally:
            temporary.unlink(missing_ok=True)
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
        records = package_records(read_json(package_path), body, release['grid'])
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


def extract_body(archive_path, asset, sums, stage, grid=None):
    body = asset['body']
    with archive_stream(archive_path) as stream, tarfile.open(fileobj=stream, mode='r:') as archive:
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
        records = package_records(json.loads(package_bytes), body, grid)
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
        archive_sources = {asset['body']: verify_asset(source, asset) for asset in release['assets']}
        with tempfile.TemporaryDirectory(prefix=f'.{version}-', dir=releases) as temporary:
            stage = Path(temporary)
            (stage / 'private').mkdir(mode=0o700)
            (stage / 'public').mkdir(mode=0o755)
            expected_paths = set()
            for asset in release['assets']:
                expected_paths.update(extract_body(archive_sources[asset['body']], asset, sums, stage, release['grid']))
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
    prepare_parser.add_argument('--max-asset-mib', type=int, default=1900)
    install_parser = commands.add_parser('install')
    install_parser.add_argument('--input', type=Path, required=True)
    install_parser.add_argument('--root', type=Path, default=Path('/data/life-celestial-assets'))
    args = parser.parse_args(argv)
    if args.command == 'prepare':
        prepare(args.input, args.output, args.version, args.max_asset_mib * 1024 * 1024)
    else:
        install(args.input, args.root)


if __name__ == '__main__':
    main()
