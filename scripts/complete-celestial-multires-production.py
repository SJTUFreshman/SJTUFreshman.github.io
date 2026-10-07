import argparse
import contextlib
import json
import os
import shlex
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_REMAINING = (18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 34, 35, 36, 37, 38, 39)
FIRST_INDICES = (0, 10, 20, 30)
FOLLOWUP_INDICES = (*range(1, 10), *range(11, 18))
BODY_COUNT = 10
TERMINAL_FAILURES = {'FAILED', 'TIMEOUT', 'CANCELLED', 'OUT_OF_MEMORY', 'NODE_FAIL', 'BOOT_FAIL', 'DEADLINE', 'REVOKED'}


def save(path, state):
    state['updatedAt'] = datetime.now(timezone.utc).isoformat()
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


@contextlib.contextmanager
def status_lock(path):
    with path.with_suffix(path.suffix + '.lock').open('a+b') as stream:
        stream.seek(0, 2)
        if not stream.tell():
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            acquire = lambda: msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            release = lambda: msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            acquire = lambda: fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            release = lambda: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        try:
            acquire()
        except OSError as error:
            raise RuntimeError('Another continuation process is using this status file.') from error
        try:
            yield
        finally:
            release()


def states(host, jobs):
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', host,
               f'sacct -n -X -j {",".join(str(job) for job in jobs)} --format=JobID%64,State%24 -P']
    result = subprocess.run(command, check=True, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=180)
    found = {}
    for line in result.stdout.splitlines():
        fields = line.strip().split('|')
        if len(fields) < 2 or not fields[1].strip():
            continue
        identifier, state = fields[0].strip(), fields[1].split()[0].rstrip('+')
        if any(identifier == str(job) or identifier.startswith(f'{job}_') for job in jobs):
            found[identifier] = state
    return found


def complete(states_by_id, arrays):
    return bool(arrays) and all(indices and all(states_by_id.get(f'{job}_{index}') == 'COMPLETED'
                                              for index in indices) for job, indices in arrays.items())


def failures(states_by_id, arrays):
    expected = {f'{job}_{index}' for job, indices in arrays.items() for index in indices}
    return {identifier: state for identifier, state in states_by_id.items()
            if state in TERMINAL_FAILURES and identifier in expected}


def retry_connection(args, state, operation):
    while True:
        try:
            result = operation()
            state.pop('lastConnectionError', None)
            return result
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            if isinstance(error, subprocess.CalledProcessError) and error.returncode != 255:
                raise
            state.update(phase='waiting-for-connection', lastConnectionError=str(error))
            save(args.status, state)
            time.sleep(args.poll_seconds)


def wait_arrays(args, state, arrays, phase):
    while True:
        current = retry_connection(args, state, lambda: states(args.host, arrays))
        failed = failures(current, arrays)
        if failed:
            state['jobs'] = current
            raise RuntimeError(f'{phase} failed: {failed}')
        state.update(phase=phase, jobs=current)
        state.pop('error', None)
        save(args.status, state)
        if complete(current, arrays):
            return
        time.sleep(args.poll_seconds)


def submit(args, state, status_path, kind, command, indices):
    if state.get('pendingSubmission'):
        raise RuntimeError('A previous submission has an unknown outcome. Adopt its job ID before resuming.')
    state['pendingSubmission'] = {'kind': kind, 'command': command, 'indices': list(indices)}
    save(status_path, state)
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', args.host, command],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
    if result.returncode:
        if 'AssocMaxSubmitJobLimit' in result.stderr:
            state.pop('pendingSubmission')
            state['phase'] = f'waiting-for-{kind}-submit-quota'
            state['lastSubmissionError'] = result.stderr.strip()
            save(status_path, state)
            return None
        raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)
    identifier = result.stdout.strip().split(';')[0]
    if not identifier.isdecimal() or int(identifier) < 1:
        raise ValueError(f'Unexpected sbatch response: {result.stdout.strip()}')
    if kind == 'remaining':
        state['remainingJobs'][identifier] = list(indices)
    else:
        state['packageJob'] = int(identifier)
    state.pop('pendingSubmission')
    state.pop('lastSubmissionError', None)
    state['phase'] = f'{kind}-submitted'
    state[f'{kind}Command'] = command
    save(status_path, state)
    return int(identifier)


def submit_remaining(args, state, status_path, indices):
    array = ','.join(str(index) for index in indices)
    command = (f'cd {shlex.quote(args.remote_root)} && '
               f'ATLAS_ROOT={shlex.quote(args.remote_root)} BLENDER_BIN={shlex.quote(args.blender)} '
               f'sbatch --parsable --array={array}%4 {shlex.quote(args.slurm)}')
    return submit(args, state, status_path, 'remaining', command, indices)


def sync_package_scripts(args, state, status_path):
    sources = [Path(__file__).with_name(name) for name in
               ('package-celestial-atlas.py', 'package-celestial-multires.slurm', 'package-celestial-multires-array.slurm')]
    retry_connection(args, state, lambda: subprocess.run(
        ['scp', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', *map(str, sources),
         f'{args.host}:{args.remote_root}/'], check=True, timeout=180))
    state['packageScriptsSynced'] = True
    save(status_path, state)


def submit_package(args, state, status_path):
    command = (f'cd {shlex.quote(args.remote_root)} && '
               f'ATLAS_ROOT={shlex.quote(args.remote_root)} '
               f'sbatch --parsable --array=0-{BODY_COUNT - 1}%4 '
               f'{shlex.quote("package-celestial-multires-array.slurm")}')
    return submit(args, state, status_path, 'package', command, range(BODY_COUNT))


def parse_remaining_job(value):
    identifier, separator, expression = value.partition(':')
    if not identifier.isdecimal() or int(identifier) < 1:
        raise argparse.ArgumentTypeError('Remaining jobs must use JOB_ID[:INDEX,START-END,...].')
    indices = []
    if separator:
        for part in expression.split(','):
            bounds = part.split('-')
            if len(bounds) not in (1, 2) or not all(bound.isdecimal() for bound in bounds):
                raise argparse.ArgumentTypeError('Invalid remaining array indices.')
            start, end = int(bounds[0]), int(bounds[-1])
            if start > end or end >= BODY_COUNT * 4:
                raise argparse.ArgumentTypeError('Remaining array indices must be between 0 and 39.')
            indices.extend(range(start, end + 1))
    else:
        indices = list(DEFAULT_REMAINING)
    if not indices or len(indices) != len(set(indices)) or not set(indices) <= set(DEFAULT_REMAINING):
        raise argparse.ArgumentTypeError('Remaining indices must be distinct members of the final 20 shards.')
    return str(int(identifier)), sorted(indices)


def load_state(args):
    state = json.loads(args.status.read_text(encoding='utf-8')) if args.status.exists() else {
        'firstJob': args.first_job, 'followupJob': args.followup_job, 'remaining': list(DEFAULT_REMAINING)}
    if state.get('firstJob') != args.first_job or state.get('followupJob') != args.followup_job:
        raise ValueError('Saved status belongs to different production jobs.')
    configuration = {'host': args.host, 'remoteRoot': args.remote_root, 'blender': args.blender, 'slurm': args.slurm}
    if 'configuration' in state and state['configuration'] != configuration:
        raise ValueError('Saved status belongs to a different production configuration.')
    if state.get('remaining', list(DEFAULT_REMAINING)) != list(DEFAULT_REMAINING):
        raise ValueError('Saved status has different remaining shards.')
    state['configuration'] = configuration
    remaining = state.setdefault('remainingJobs', {})
    if state.get('remainingJob'):
        remaining.setdefault(str(state['remainingJob']), list(DEFAULT_REMAINING))
    for identifier, indices in args.remaining_job:
        if identifier in remaining and remaining[identifier] != indices:
            raise ValueError(f'Remaining job {identifier} has conflicting array indices.')
        remaining[identifier] = indices
    seen = set()
    for identifier, indices in remaining.items():
        parse_remaining_job(f'{identifier}:' + ','.join(str(index) for index in indices))
        if int(identifier) in (args.first_job, args.followup_job) or seen.intersection(indices):
            raise ValueError('Remaining render jobs overlap existing shards or job IDs.')
        seen.update(indices)
    if args.package_job:
        if state.get('packageJob') not in (None, args.package_job):
            raise ValueError('Saved status belongs to a different package job.')
        state['packageJob'] = args.package_job
    if state.get('packageJob'):
        if set(DEFAULT_REMAINING) != seen:
            raise ValueError('Cannot adopt packaging before all remaining render jobs are identified.')
        if state['packageJob'] in (args.first_job, args.followup_job) or str(state['packageJob']) in remaining:
            raise ValueError('The package job must be distinct from render jobs.')
    pending = state.get('pendingSubmission')
    if pending:
        adopted = (args.package_job and pending['kind'] == 'package') or (
            pending['kind'] == 'remaining' and any(indices == pending['indices'] for _, indices in args.remaining_job))
        if not adopted:
            raise RuntimeError('A previous submission has an unknown outcome. Adopt its job ID before resuming.')
        state.pop('pendingSubmission')
    save(args.status, state)
    return state


def continue_production(args, state):
    try:
        wait_arrays(args, state, {args.first_job: FIRST_INDICES, args.followup_job: FOLLOWUP_INDICES},
                    'waiting-for-renders')
        covered = {index for indices in state['remainingJobs'].values() for index in indices}
        missing = sorted(set(DEFAULT_REMAINING) - covered)
        while missing and submit_remaining(args, state, args.status, missing) is None:
            time.sleep(args.poll_seconds)
        wait_arrays(args, state, state['remainingJobs'], 'waiting-for-remaining-render')
        if not state.get('packageJob'):
            if not state.get('packageScriptsSynced'):
                sync_package_scripts(args, state, args.status)
            while submit_package(args, state, args.status) is None:
                time.sleep(args.poll_seconds)
        wait_arrays(args, state, {state['packageJob']: range(BODY_COUNT)}, 'waiting-for-package')
        state['phase'] = 'package-complete'
        save(args.status, state)
    except Exception as error:
        state.update(phase='failed', error=str(error))
        save(args.status, state)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description='Continue the split 8K multiresolution celestial bake safely.')
    parser.add_argument('--host', default='paracloud-Zhongwei1')
    parser.add_argument('--remote-root', required=True)
    parser.add_argument('--blender', required=True)
    parser.add_argument('--first-job', type=int, default=183017)
    parser.add_argument('--followup-job', type=int, default=183193)
    parser.add_argument('--remaining-job', type=parse_remaining_job, action='append', default=[], metavar='JOB[:INDICES]',
                        help='Adopt an existing array; repeat for split arrays. Omit indices for all 20 remaining shards.')
    parser.add_argument('--package-job', type=int, help='Adopt an existing packaging array.')
    parser.add_argument('--slurm', default='render-celestial-multires-production.slurm')
    parser.add_argument('--status', type=Path, required=True)
    parser.add_argument('--repository-root', type=Path, default=Path.cwd())
    parser.add_argument('--poll-seconds', type=int, default=30)
    args = parser.parse_args(argv)
    if any(not value.startswith('/') or any(character in value for character in '\r\n:') for value in (args.remote_root, args.blender)):
        parser.error('Remote paths must be absolute and contain no newlines or colons.')
    if args.first_job < 1 or args.followup_job < 1 or args.poll_seconds < 1:
        parser.error('Job IDs and poll interval must be positive.')
    if args.package_job is not None and args.package_job < 1:
        parser.error('Package job ID must be positive.')
    if args.first_job == args.followup_job:
        parser.error('Initial arrays must have distinct job IDs.')
    args.remote_root = args.remote_root.rstrip('/')
    args.status = args.status.resolve()
    args.status.parent.mkdir(parents=True, exist_ok=True)
    with status_lock(args.status):
        state = load_state(args)
        continue_production(args, state)


if __name__ == '__main__':
    main()
