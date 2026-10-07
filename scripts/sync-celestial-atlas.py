import argparse
import json
import math
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


BODIES = ('earth', 'sun', 'mercury', 'venus', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune')
ROOT = Path(__file__).resolve().parent.parent


def package_arguments(args):
    width = getattr(args, 'width', 3840)
    height = getattr(args, 'height', 2160)
    azimuth_count = getattr(args, 'azimuth_count', 180)
    elevations = getattr(args, 'elevations', [-90, -60, -30, 0, 30, 60, 90])
    return ['--width', str(width), '--height', str(height), '--azimuth-count', str(azimuth_count),
            '--elevations=' + ','.join(str(value) for value in elevations)]


def body_job_ids(args, body):
    index = args.body_order.index(body)
    return [f'{args.job}_{args.array_offset + shard * len(args.body_order) + index}' for shard in range(args.shards_per_body)]


def job_ids(args):
    return getattr(args, 'job_ids', [args.job])


def body_jobs_complete(args, body, states):
    index = args.body_order.index(body)
    return all(any(states.get(f'{job}_{args.array_offset + shard * len(args.body_order) + index}') == 'COMPLETED'
                   for job in job_ids(args)) for shard in range(args.shards_per_body))


def sync_configuration(args):
    configuration = {'width': args.width, 'height': args.height, 'azimuthCount': args.azimuth_count, 'elevations': args.elevations,
                     'bodyOrder': args.body_order, 'shardsPerBody': args.shards_per_body, 'arrayOffset': args.array_offset}
    if getattr(args, 'replacement_tasks', None):
        configuration['replacementTasks'] = args.replacement_tasks
    return configuration


def run(command, capture=False, timeout=None):
    result = subprocess.run(command, check=True, text=True, encoding='utf-8', errors='replace',
                            stdout=subprocess.PIPE if capture else None, timeout=timeout)
    return result.stdout if capture else None


def remote(args, command):
    for attempt in range(3):
        try:
            return run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', args.host, command], capture=True, timeout=180)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))


def job_states(args):
    identifiers = ','.join(str(job) for job in job_ids(args))
    output = remote(args, f'sacct -n -X -j {identifiers} --format=JobID%64,State%40 -P')
    states = {}
    failures = {}
    for line in output.splitlines():
        fields = line.strip().split('|')
        if len(fields) < 2 or not fields[1].strip():
            continue
        identifier = fields[0]
        state = fields[1].split()[0].rstrip('+')
        matching = next((job for job in job_ids(args) if identifier == str(job) or identifier.startswith(f'{job}_')), None)
        if matching is not None:
            if state in ('FAILED', 'TIMEOUT', 'CANCELLED', 'OUT_OF_MEMORY', 'NODE_FAIL', 'BOOT_FAIL', 'DEADLINE', 'REVOKED'):
                failures[identifier] = state
            suffix = identifier.removeprefix(f'{matching}_')
            if suffix.isdecimal() and identifier != str(matching):
                states[identifier] = state
            elif suffix.startswith('[') and suffix.endswith(']'):
                expression = suffix[1:-1].split('%', 1)[0]
                for replacement in getattr(args, 'replacement_tasks', {}).values():
                    replacement_job, replacement_shard = replacement.split('_')
                    if replacement_job != str(matching):
                        continue
                    for part in expression.split(','):
                        bounds = part.split('-')
                        if len(bounds) in (1, 2) and all(bound.isdecimal() for bound in bounds):
                            if int(bounds[0]) <= int(replacement_shard) <= int(bounds[-1]):
                                states[replacement] = state
    usable_replacement_states = {'COMPLETED', 'PENDING', 'RUNNING', 'CONFIGURING', 'COMPLETING', 'SUSPENDED', 'REQUEUED', 'RESIZING'}
    for original, replacement in getattr(args, 'replacement_tasks', {}).items():
        if failures.get(original) == 'CANCELLED' and states.get(replacement) in usable_replacement_states:
            failures.pop(original)
    if failures:
        raise RuntimeError(f'Render jobs did not complete: {failures}')
    return states


def save_status(args, status, phase, **details):
    status.update(details)
    status.update(phase=phase, updatedAt=datetime.now(timezone.utc).isoformat())
    temporary = args.staging / 'status.json.tmp'
    temporary.write_text(json.dumps(status, indent=2) + '\n', encoding='utf-8')
    temporary.replace(args.staging / 'status.json')
    print(f'{status["updatedAt"]} {phase} {details}', flush=True)


def receive_body(args, body, status):
    save_status(args, status, 'downloading', currentBody=body)
    remote_archive_root = getattr(args, 'remote_archive_root', None)
    remote_archive = f'{remote_archive_root or args.remote_root}/{body}.tar'
    if not remote_archive_root:
        remote(args, f'tar -cf {shlex.quote(remote_archive)} -C {shlex.quote(args.remote_root)} {shlex.quote(body)}')
    archive_path = args.staging / f'{body}.tar'
    partial = archive_path.with_suffix('.tar.partial')
    for attempt in range(3):
        try:
            run(['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
                 f'{args.host}:{remote_archive}', str(partial)], timeout=7200)
            break
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
    partial.replace(archive_path)
    with tempfile.TemporaryDirectory(prefix=f'{body}-extract-', dir=args.staging) as extraction:
        frames_root = Path(extraction)
        with tarfile.open(archive_path) as archive:
            members = archive.getmembers()
            names = set()
            for member in members:
                parts = Path(member.name).parts
                if not parts or parts[0] != body or '..' in parts or not (member.isfile() or member.isdir()) or member.name in names:
                    raise ValueError(f'Unexpected archive entry: {member.name}')
                names.add(member.name)
            archive.extractall(frames_root, members=members, filter='data')
        verified_remote = getattr(args, 'verified_remote', False)
        save_status(args, status, 'verifying' if verified_remote else 'packaging', currentBody=body)
        if verified_remote:
            run([sys.executable, str(ROOT / 'scripts/package-celestial-atlas.py'),
                 '--input', str(frames_root), '--output', str(frames_root), '--verify-only', '--hash-only', '--body', body,
                 *package_arguments(args)], timeout=7200)
            shutil.copytree(frames_root / body, args.output / body, dirs_exist_ok=True)
        else:
            run([sys.executable, str(ROOT / 'scripts/package-celestial-atlas.py'),
                 '--input', str(frames_root), '--output', str(args.output), '--input-format', 'webp', '--body', body,
                 *package_arguments(args)], timeout=7200)
    if getattr(args, 'remove_downloaded_archives', False):
        archive_path.unlink()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description='Receive one Slurm celestial bake and validate its local website assets.')
    parser.add_argument('--host', default='paracloud-Zhongwei1')
    parser.add_argument('--remote-root', required=True)
    parser.add_argument('--job', type=int, action='append', required=True, help='Slurm render array ID; repeat for split submissions.')
    parser.add_argument('--replacement-task', action='append', default=[], metavar='OLD_JOB_TASK:NEW_JOB_TASK',
                        help='A cancelled shard replaced by the same shard in another listed array; repeat as needed.')
    parser.add_argument('--staging', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/celestial/baked')
    parser.add_argument('--browser-check', action='store_true')
    parser.add_argument('--layout', choices=('legacy', 'full-sphere'), default='legacy')
    parser.add_argument('--width', type=int)
    parser.add_argument('--height', type=int)
    parser.add_argument('--azimuth-count', type=int, default=180)
    parser.add_argument('--elevations', default='-90,-60,-30,0,30,60,90')
    parser.add_argument('--shards-per-body', type=int)
    parser.add_argument('--array-offset', type=int, default=0)
    parser.add_argument('--body-order', default=','.join(BODIES))
    parser.add_argument('--remote-archive-root', help='Read existing body tar archives from this remote directory.')
    parser.add_argument('--verified-remote', action='store_true', help='Require remotely decoded packages and verify their hashes locally.')
    parser.add_argument('--remove-downloaded-archives', action='store_true')
    args = parser.parse_args(argv)
    args.width = args.width if args.width is not None else 4096 if args.layout == 'full-sphere' else 3840
    args.height = args.height if args.height is not None else 4096 if args.layout == 'full-sphere' else 2160
    args.shards_per_body = args.shards_per_body if args.shards_per_body is not None else 4 if args.layout == 'full-sphere' else 2
    args.job_ids = list(dict.fromkeys(args.job))
    args.job = args.job_ids[0]
    args.body_order = args.body_order.split(',')
    try:
        args.elevations = [float(value) for value in args.elevations.split(',')]
    except ValueError:
        parser.error('--elevations must contain comma-separated degrees.')
    if not args.elevations or any(not math.isfinite(value) or abs(value) > 90 for value in args.elevations) or any(first >= second for first, second in zip(args.elevations, args.elevations[1:])):
        parser.error('--elevations must be increasing degrees between -90 and 90.')
    if min(args.width, args.height, args.shards_per_body) < 1 or args.azimuth_count < 2 or args.array_offset < 0:
        parser.error('Dimensions and shard count must be positive, with at least two azimuths and nonnegative array offset.')
    args.replacement_tasks = {}
    for replacement in args.replacement_task:
        pair = replacement.split(':')
        parts = [task.split('_') for task in pair]
        if len(parts) != 2 or any(len(part) != 2 or not all(value.isdecimal() for value in part) for part in parts):
            parser.error('--replacement-task must use OLD_JOB_TASK:NEW_JOB_TASK.')
        original, target = pair
        original_job, original_shard = map(int, parts[0])
        target_job, target_shard = map(int, parts[1])
        if (original_job == target_job or original_job not in args.job_ids or target_job not in args.job_ids or
                original_shard != target_shard or not args.array_offset <= original_shard < args.array_offset + args.shards_per_body * len(args.body_order)):
            parser.error('Replacement tasks must use the same expected shard in two distinct listed arrays.')
        if original in args.replacement_tasks or original in args.replacement_tasks.values() or target in args.replacement_tasks:
            parser.error('Replacement tasks cannot repeat originals or form replacement chains.')
        args.replacement_tasks[original] = target
    if len(args.body_order) != len(BODIES) or set(args.body_order) != set(BODIES):
        parser.error('--body-order must list every supported body exactly once.')
    if any(job <= 0 for job in args.job_ids) or not args.remote_root.startswith('/') or any(character in args.remote_root for character in '\n\r:'):
        parser.error('A positive job id and absolute remote directory are required.')
    if args.remote_archive_root and (not args.remote_archive_root.startswith('/') or any(character in args.remote_archive_root for character in '\n\r:')):
        parser.error('--remote-archive-root must be an absolute remote directory.')
    args.remote_root = args.remote_root.rstrip('/')
    args.staging = args.staging.resolve()
    args.output = args.output.resolve()
    if args.browser_check and args.output != (ROOT / 'assets/celestial/baked').resolve():
        parser.error('--browser-check requires the website output assets/celestial/baked.')
    return args


def main(argv=None):
    args = parse_args(argv)
    args.staging.mkdir(parents=True, exist_ok=True)
    configuration = sync_configuration(args)
    status = {'job': args.job, 'jobIds': args.job_ids, 'remoteRoot': args.remote_root, 'output': str(args.output), 'configuration': configuration, 'completedBodies': []}
    status_file = args.staging / 'status.json'
    if status_file.exists():
        previous = json.loads(status_file.read_text(encoding='utf-8'))
        if previous.get('job') != args.job or previous.get('remoteRoot') != args.remote_root or previous.get('output') != str(args.output):
            raise ValueError('This staging directory belongs to a different bake; choose a new staging directory.')
        if previous.get('jobIds', [previous['job']]) != args.job_ids:
            raise ValueError('This staging directory uses different Slurm array IDs.')
        legacy_configuration = {'width': 3840, 'height': 2160, 'azimuthCount': 180, 'elevations': [-90, -60, -30, 0, 30, 60, 90],
                                'bodyOrder': list(BODIES), 'shardsPerBody': 2, 'arrayOffset': 0}
        if previous.get('configuration', legacy_configuration) != configuration:
            raise ValueError('This staging directory uses a different frame grid or Slurm array layout.')
        status = previous
        status['jobIds'] = args.job_ids
        status['configuration'] = configuration
    if not isinstance(status.get('completedBodies'), list) or len(set(status['completedBodies'])) != len(status['completedBodies']) or any(body not in BODIES for body in status['completedBodies']):
        raise ValueError('The saved completedBodies list is invalid.')
    status.pop('error', None)
    try:
        while len(status['completedBodies']) < len(BODIES):
            states = job_states(args)
            if states != status.get('jobs') or status.get('phase') != 'rendering':
                save_status(args, status, 'rendering', jobs=states, currentBody=None)
            for body in args.body_order:
                complete = body_jobs_complete(args, body, states)
                if complete and body not in status['completedBodies']:
                    receive_body(args, body, status)
                    status['completedBodies'].append(body)
                    save_status(args, status, 'received', currentBody=body)
            if len(status['completedBodies']) < len(BODIES):
                time.sleep(30)
        save_status(args, status, 'verifying', currentBody=None)
        run([sys.executable, str(ROOT / 'scripts/package-celestial-atlas.py'), '--input', str(args.output),
             '--output', str(args.output), '--manifest', '--verify-only', *(['--hash-only'] if getattr(args, 'verified_remote', False) else []),
             *package_arguments(args)], timeout=14400)
        if args.browser_check:
            save_status(args, status, 'browser-check')
            run(['node', str(ROOT / 'scripts/validate-star-map.cjs'), '--serve', 'all'], timeout=1800)
        save_status(args, status, 'complete', manifest=str(args.output / 'manifest.json'), frames=len(BODIES) * len(args.elevations) * args.azimuth_count)
    except Exception as error:
        save_status(args, status, 'failed', error=str(error))
        raise


if __name__ == '__main__':
    main()
