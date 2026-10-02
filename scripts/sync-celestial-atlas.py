import argparse
import json
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


BODIES = ('earth', 'sun', 'mercury', 'venus', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune')
ROOT = Path(__file__).resolve().parent.parent


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
    output = remote(args, f'sacct -n -X -j {args.job} --format=JobID,State%40 -P')
    states = {}
    failures = {}
    for line in output.splitlines():
        fields = line.strip().split('|')
        if len(fields) < 2 or not fields[1].strip():
            continue
        identifier = fields[0]
        state = fields[1].split()[0].rstrip('+')
        if identifier == str(args.job) or identifier.startswith(f'{args.job}_'):
            if state in ('FAILED', 'TIMEOUT', 'CANCELLED', 'OUT_OF_MEMORY', 'NODE_FAIL', 'BOOT_FAIL', 'DEADLINE', 'REVOKED'):
                failures[identifier] = state
            suffix = identifier.removeprefix(f'{args.job}_')
            if suffix.isdecimal() and identifier != str(args.job):
                states[identifier] = state
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
    remote_archive = f'{args.remote_root}/{body}.tar'
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
        save_status(args, status, 'packaging', currentBody=body)
        run([sys.executable, str(ROOT / 'scripts/package-celestial-atlas.py'),
             '--input', str(frames_root), '--output', str(args.output), '--input-format', 'webp', '--body', body], timeout=7200)


def main():
    parser = argparse.ArgumentParser(description='Receive one Slurm celestial bake and validate its local website assets.')
    parser.add_argument('--host', default='paracloud-Zhongwei1')
    parser.add_argument('--remote-root', required=True)
    parser.add_argument('--job', type=int, required=True)
    parser.add_argument('--staging', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/celestial/baked')
    parser.add_argument('--browser-check', action='store_true')
    args = parser.parse_args()
    if args.job <= 0 or not args.remote_root.startswith('/') or any(character in args.remote_root for character in '\n\r:'):
        parser.error('A positive job id and absolute remote directory are required.')
    args.remote_root = args.remote_root.rstrip('/')
    args.staging = args.staging.resolve()
    args.output = args.output.resolve()
    if args.browser_check and args.output != (ROOT / 'assets/celestial/baked').resolve():
        parser.error('--browser-check requires the website output assets/celestial/baked.')
    args.staging.mkdir(parents=True, exist_ok=True)
    status = {'job': args.job, 'remoteRoot': args.remote_root, 'output': str(args.output), 'completedBodies': []}
    status_file = args.staging / 'status.json'
    if status_file.exists():
        previous = json.loads(status_file.read_text(encoding='utf-8'))
        if previous.get('job') != args.job or previous.get('remoteRoot') != args.remote_root or previous.get('output') != str(args.output):
            raise ValueError('This staging directory belongs to a different bake; choose a new staging directory.')
        status = previous
    if not isinstance(status.get('completedBodies'), list) or len(set(status['completedBodies'])) != len(status['completedBodies']) or any(body not in BODIES for body in status['completedBodies']):
        raise ValueError('The saved completedBodies list is invalid.')
    status.pop('error', None)
    try:
        while len(status['completedBodies']) < len(BODIES):
            states = job_states(args)
            if states != status.get('jobs') or status.get('phase') != 'rendering':
                save_status(args, status, 'rendering', jobs=states, currentBody=None)
            for index, body in enumerate(BODIES):
                complete = all(states.get(f'{args.job}_{shard * len(BODIES) + index}') == 'COMPLETED' for shard in range(2))
                if complete and body not in status['completedBodies']:
                    receive_body(args, body, status)
                    status['completedBodies'].append(body)
                    save_status(args, status, 'received', currentBody=body)
            if len(status['completedBodies']) < len(BODIES):
                time.sleep(30)
        save_status(args, status, 'verifying', currentBody=None)
        run([sys.executable, str(ROOT / 'scripts/package-celestial-atlas.py'), '--input', str(args.output),
             '--output', str(args.output), '--manifest', '--verify-only'], timeout=14400)
        if args.browser_check:
            save_status(args, status, 'browser-check')
            run(['node', str(ROOT / 'scripts/validate-star-map.cjs'), '--serve', 'all'], timeout=1800)
        save_status(args, status, 'complete', manifest=str(args.output / 'manifest.json'), frames=12600)
    except Exception as error:
        save_status(args, status, 'failed', error=str(error))
        raise


if __name__ == '__main__':
    main()
