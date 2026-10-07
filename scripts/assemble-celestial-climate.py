import argparse
import copy
import importlib.util
import json
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PACKAGER = load_module('climate_packager', 'package-celestial-atlas.py')
RELEASE = load_module('climate_release', 'manage-celestial-release.py')
CLIMATE_BODIES = ('earth', 'mars')


def read_json(path):
    with path.open(encoding='utf-8') as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError(f'Metadata must be an object: {path}')
    return value


def regular_file(root, relative):
    relative = RELEASE.safe_path(relative)
    path = root.joinpath(*relative.parts)
    if not path.is_file() or path.is_symlink() or path.resolve() != path.absolute():
        raise ValueError(f'Missing regular file or unsupported symlink: {path}')
    return path


def link_file(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError as error:
        raise ValueError(f'Hard-link failed: {source}. Assembly and inputs must share a filesystem; no copy fallback is allowed.') from error


def package_args(root, package, workers=2):
    return PACKAGER.parse_args(['--input', str(root), '--output', str(root), '--body', package['body'],
                               '--width', str(package['width']), '--height', str(package['height']),
                               '--azimuth-count', str(package['azimuthCount']),
                               '--elevations=' + ','.join(str(value) for value in package['elevations']),
                               '--workers', str(workers), '--input-format', 'webp'])


def climate_plan(root, body, package, frame_count):
    args = package_args(root, package)
    reports = []
    base_climate = None
    cloud_presentation = None
    time_indices = set()
    sources = sorted((root / body).glob('render*.json'))
    if not sources:
        raise ValueError(f'Missing climate render metadata for {body}.')
    for source in sources:
        relative = source.relative_to(root).as_posix()
        source = regular_file(root, relative)
        report = read_json(source)
        report_presentation = report.get('presentation') if isinstance(report.get('presentation'), dict) else {}
        expected_dimensions = {'width': package['width'], 'height': package['height']}
        if report_presentation.get('cloudWidth') and report_presentation.get('cloudHeight'):
            expected_dimensions = {'width': report_presentation['cloudWidth'], 'height': report_presentation['cloudHeight']}
        for key in ('body', 'azimuthCount', 'elevations'):
            if report.get(key) != package[key]:
                raise ValueError(f'Climate render {key} differs from v5 for {body}: {source.name}')
        for key, expected in expected_dimensions.items():
            if report.get(key) != expected:
                raise ValueError(f'Climate render {key} differs from its cloud layer for {body}: {source.name}')
        climate = PACKAGER.climate_metadata({'climate': report.get('climate')}, body)
        if climate is None or type(climate.get('timeIndex')) is not int or not 0 <= climate['timeIndex'] < frame_count:
            raise ValueError(f'Climate metadata lacks a valid timeIndex for {body}.')
        if climate['frameCount'] != frame_count:
            raise ValueError(f'Climate frameCount differs from the requested {frame_count} for {body}.')
        time_indices.add(climate.pop('timeIndex'))
        if base_climate is not None and climate != base_climate:
            raise ValueError(f'Climate metadata differs between render shards for {body}.')
        base_climate = climate
        presentation = PACKAGER.validate_presentation(body, report.get('presentation'), args)
        if 'cloudFramePattern' not in presentation:
            raise ValueError(f'Climate renderer did not declare a cloud layer for {body}.')
        if cloud_presentation is not None and presentation != cloud_presentation:
            raise ValueError(f'Climate geometry differs between render shards for {body}.')
        cloud_presentation = presentation
        reports.append({'source': relative, 'sha256': PACKAGER.checksum(source), 'parameters': report})
    if time_indices != set(range(frame_count)):
        raise ValueError(f'Incomplete climate time metadata for {body}.')
    master = package['presentation']
    for key in ('framing', 'transparent', 'sphereRect', 'projection', 'spinAxes', 'spinAxisCoordinates'):
        if master.get(key) != cloud_presentation.get(key):
            raise ValueError(f'Climate and v5 {key} geometry differs for {body}.')
    presentation = {key: copy.deepcopy(value) for key, value in master.items()
                    if not key.startswith('cloud') and key != 'climate'}
    presentation.update({key: value for key, value in cloud_presentation.items() if key.startswith('cloud')})
    presentation['cloudFramePattern'] = f'{body}/clouds/t{{time}}/e{{elevation}}/a{{azimuth}}.webp'
    presentation['climate'] = {**base_climate, 'timeIndices': sorted(time_indices)}
    presentation = PACKAGER.validate_presentation(body, presentation, args)
    expected = {relative.as_posix() for _, _, relative in PACKAGER.frame_paths(body, args, 'cloud', presentation)}
    actual = {path.relative_to(root).as_posix() for path in (root / body / 'clouds').rglob('*') if path.is_file()}
    if actual != expected:
        raise ValueError(f'Incomplete or unexpected climate cloud grid for {body}: missing={len(expected - actual)}, unexpected={len(actual - expected)}')
    for relative in expected:
        regular_file(root, relative)
    return {'presentation': presentation, 'reports': reports, 'frames': sorted(expected)}


def assembly_plan(master, climate, frame_count, resolution_widths, bodies=None):
    result = {}
    grid = None
    for body in bodies or PACKAGER.BODIES:
        package = read_json(regular_file(master, f'{body}/package.json'))
        records = RELEASE.package_records(package, body, grid)
        grid = RELEASE.validated_grid(package)
        if [tier['width'] for tier in package.get('resolutions', [])] != resolution_widths:
            raise ValueError(f'v5 {body} requires completed resolution tiers {resolution_widths}.')
        for relative, record in records.items():
            source = regular_file(master, relative)
            if 'bytes' in record and source.stat().st_size != record['bytes']:
                raise ValueError(f'v5 byte count differs from package: {relative}')
        entry = {'package': package, 'records': records}
        if body in CLIMATE_BODIES:
            entry['climate'] = climate_plan(climate, body, package, frame_count)
        result[body] = entry
    return result


def assemble(master, climate, output, frame_count=8, resolution_widths=(2048, 4096), bodies=None):
    master, climate, output = (Path(path).resolve() for path in (master, climate, output))
    if any(output.is_relative_to(source) or source.is_relative_to(output) for source in (master, climate)):
        raise ValueError('Assembly output must be separate from both input trees.')
    if output.exists():
        raise ValueError('Assembly output already exists; use package or publish to resume it.')
    if not 1 <= frame_count <= 4096:
        raise ValueError('Climate frame count must be between 1 and 4096.')
    plan = assembly_plan(master, climate, frame_count, list(resolution_widths), bodies)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f'.{output.name}-assembly-', dir=output.parent) as temporary:
        staging = Path(temporary)
        for body, entry in plan.items():
            package = entry['package']
            for relative in entry['records']:
                if body in CLIMATE_BODIES and 'clouds' in Path(relative).parts:
                    continue
                link_file(regular_file(master, relative), staging / relative)
            if body not in CLIMATE_BODIES:
                link_file(regular_file(master, f'{body}/package.json'), staging / body / 'package.json')
                continue
            dynamic = entry['climate']
            link_file(regular_file(master, f'{body}/package.json'), staging / body / 'source-metadata/v5-package.json')
            for relative in dynamic['frames']:
                link_file(regular_file(climate, relative), staging / relative)
            for report in dynamic['reports']:
                link_file(regular_file(climate, report['source']),
                          staging / body / 'source-metadata/v6' / Path(report['source']).name)
            report = {'body': body, 'width': package['width'], 'height': package['height'],
                      'azimuthCount': package['azimuthCount'], 'elevations': package['elevations'],
                      'presentation': dynamic['presentation'],
                      'assemblySources': {'v5PackageSha256': PACKAGER.checksum(master / body / 'package.json'),
                                          'v5RenderMetadata': package.get('renderMetadata', []),
                                          'v6RenderMetadata': dynamic['reports']}}
            PACKAGER.atomic_json(staging / body / 'render-assembled.json', report)
        selected_bodies = list(bodies or PACKAGER.BODIES)
        configuration = {'schema': 1, 'master': str(master), 'climate': str(climate),
                         'frameCount': frame_count, 'bodies': selected_bodies,
                         'climateBodies': [body for body in selected_bodies if body in CLIMATE_BODIES],
                         'resolutionWidths': list(resolution_widths)}
        PACKAGER.atomic_json(staging / 'climate-assembly.json', configuration)
        staging.rename(output)
    return configuration


def package_body(output, body, workers=2):
    output = Path(output).resolve()
    configuration = read_json(output / 'climate-assembly.json')
    if body not in configuration['climateBodies']:
        raise ValueError('Only the assembled climate bodies need repackaging.')
    package = copy.deepcopy(read_json(regular_file(output, f'{body}/source-metadata/v5-package.json')))
    args = package_args(output, package, workers)
    if (output / body / 'package.json').exists():
        PACKAGER.verify_body(body, args)
        return
    provenance = PACKAGER.render_metadata(body, args)
    presentation = PACKAGER.presentation_metadata(body, provenance, args)
    package['renderMetadata'] = provenance
    package['presentation'] = presentation
    package.setdefault('layers', {})
    package['layers'].pop('cloud', None)
    cloud_args = PACKAGER.image_arguments(args, presentation, 'cloud')
    sources = [(row, column, relative, regular_file(output, relative.as_posix()))
               for row, column, relative in PACKAGER.frame_paths(body, args, 'cloud', presentation)]
    with ThreadPoolExecutor(max_workers=workers) as executor:
        frames = list(executor.map(lambda source: PACKAGER.package_frame(source, cloud_args), sources))
    row, column = package['poster']['elevation'], package['poster']['azimuth']
    time_pad = PACKAGER.climate_time_pad(presentation)
    source = f'{body}/clouds/t{0:0{time_pad}d}/e{row}/a{column:03d}.webp'
    poster_path = f'{body}/clouds/poster.webp'
    if not (output / poster_path).exists():
        link_file(regular_file(output, source), output / poster_path)
    cloud = {'frames': frames, 'poster': {'path': poster_path, 'source': source, 'time': 0,
                                        'elevation': row, 'azimuth': column, 'sha256': PACKAGER.checksum(output / source)}}
    package['layers']['cloud'] = cloud
    for tier in package['resolutions']:
        layer_args = PACKAGER.resolution_arguments(args, cloud_args, tier['width'])
        layer_args.full_sphere = False
        with ThreadPoolExecutor(max_workers=workers) as executor:
            tier_frames = list(executor.map(lambda record: PACKAGER.derive_frame(record, layer_args, tier['width']), frames))
        tier['layers']['cloud'] = {'frames': tier_frames, 'width': layer_args.width, 'height': layer_args.height,
                                   'poster': PACKAGER.derive_poster(cloud['poster'], tier['width'], layer_args)}
    PACKAGER.atomic_json(output / body / 'package.json', package)
    PACKAGER.verify_body(body, args)


def publish(output, workers=2, frame_base_url=None, hosted_output=None):
    output = Path(output).resolve()
    configuration = read_json(output / 'climate-assembly.json')
    for body in configuration['climateBodies']:
        package = read_json(regular_file(output, f'{body}/package.json'))
        presentation = package['presentation']
        if '{time}' not in presentation.get('cloudFramePattern', ''):
            raise ValueError(f'Assembled {body} still has a static cloud layer.')
        climate = presentation.get('climate', {})
        if climate.get('frameCount') != configuration['frameCount'] or climate.get('timeIndices') != list(range(configuration['frameCount'])):
            raise ValueError(f'Assembled climate time metadata is incomplete for {body}.')
    package = read_json(output / PACKAGER.BODIES[0] / 'package.json')
    args = package_args(output, package, workers)
    args.body = None
    args.verify_only = True
    args.manifest = True
    args.frame_base_url = frame_base_url
    args.hosted_output = Path(hosted_output).resolve() if hosted_output else None
    if args.hosted_output:
        validated = PACKAGER.parse_args(['--input', str(output), '--output', str(output), '--manifest',
                                        '--frame-base-url', frame_base_url or '', '--hosted-output', str(args.hosted_output)])
        args.frame_base_url = validated.frame_base_url
    PACKAGER.publish_manifest(args)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Build an independent atlas with hard-linked v5 assets and complete v6 climate clouds.')
    commands = parser.add_subparsers(dest='command', required=True)
    assembly = commands.add_parser('assemble')
    assembly.add_argument('--master', type=Path, required=True)
    assembly.add_argument('--climate', type=Path, required=True)
    assembly.add_argument('--output', type=Path, required=True)
    assembly.add_argument('--frame-count', type=int, default=8)
    assembly.add_argument('--resolution-widths', default='2048,4096')
    package = commands.add_parser('package')
    package.add_argument('--output', type=Path, required=True)
    package.add_argument('--body', choices=CLIMATE_BODIES, required=True)
    package.add_argument('--workers', type=int, default=2)
    publication = commands.add_parser('publish')
    publication.add_argument('--output', type=Path, required=True)
    publication.add_argument('--workers', type=int, default=2)
    publication.add_argument('--frame-base-url')
    publication.add_argument('--hosted-output', type=Path)
    args = parser.parse_args(argv)
    if args.command == 'assemble':
        assemble(args.master, args.climate, args.output, args.frame_count,
                 tuple(int(value) for value in args.resolution_widths.split(',')))
    elif args.command == 'package':
        package_body(args.output, args.body, args.workers)
    else:
        publish(args.output, args.workers, args.frame_base_url, args.hosted_output)


if __name__ == '__main__':
    main()
