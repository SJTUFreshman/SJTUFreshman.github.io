import argparse
import importlib.util
import json
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('celestial_sync', ROOT / 'scripts/sync-celestial-atlas.py')
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


def save(args, state, phase, **updates):
    state.update(updates)
    state.update(phase=phase, updatedAt=datetime.now(timezone.utc).isoformat())
    destination = args.staging / 'production-status.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
    temporary.replace(destination)
    print(json.dumps(state), flush=True)


def wait_array(args, state, job, indices, phase):
    previous = None
    args.job = job
    args.job_ids = [job]
    while True:
        states = SYNC.job_states(args)
        if states != previous:
            save(args, state, phase, currentJob=job, jobs=states)
            previous = states
        if all(states.get(f'{job}_{index}') == 'COMPLETED' for index in indices):
            return
        time.sleep(30)


def submit(args, script, extra):
    command = f'cd {shlex.quote(args.remote_root)} && '
    command += f'ATLAS_ROOT={shlex.quote(args.remote_root)} BLENDER_BIN={shlex.quote(args.blender)} '
    command += 'sbatch --parsable ' + extra + ' ' + shlex.quote(script)
    for attempt in range(20):
        result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', args.host, command],
                                capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
        if result.returncode:
            if 'AssocMaxSubmitJobLimit' in result.stderr and attempt < 19:
                print('Submission quota is full; retrying the rejected submission in 30 seconds.', flush=True)
                time.sleep(30)
                continue
            raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)
        identifier = result.stdout.strip().split(';')[0]
        if not identifier.isdecimal():
            raise ValueError(f'Unexpected sbatch response: {result.stdout.strip()}')
        return int(identifier)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Finish a split 40-shard celestial bake and stage verified assets locally.')
    parser.add_argument('--host', default='paracloud-Zhongwei1')
    parser.add_argument('--initial-job', type=int, required=True)
    parser.add_argument('--remote-root', required=True)
    parser.add_argument('--blender', required=True)
    parser.add_argument('--staging', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    if args.initial_job < 1 or any(not value.startswith('/') or any(character in value for character in '\r\n:')
                                   for value in (args.remote_root, args.blender)):
        parser.error('Use a positive job ID and absolute remote paths without newlines or colons.')
    args.remote_root = args.remote_root.rstrip('/')
    args.staging = args.staging.resolve()
    args.output = args.output.resolve()
    args.staging.mkdir(parents=True, exist_ok=True)
    configuration = {'initialJob': args.initial_job, 'host': args.host, 'remoteRoot': args.remote_root,
                     'blender': args.blender, 'output': str(args.output)}
    state = {'configuration': configuration}
    status_path = args.staging / 'production-status.json'
    if status_path.exists():
        state = json.loads(status_path.read_text(encoding='utf-8'))
        if state.get('configuration') != configuration:
            raise ValueError('This staging directory belongs to a different production run.')
        if state.get('phase') == 'complete':
            print('ALREADY COMPLETE', flush=True)
            return
    state.pop('error', None)
    try:
        wait_array(args, state, args.initial_job, range(20), 'first-render-array')
        if 'remainingJob' not in state:
            job = submit(args, 'render-celestial-full-sphere-production.slurm', '--array=20-39%8')
            save(args, state, 'remaining-render-submitted', remainingJob=job)
        wait_array(args, state, state['remainingJob'], range(20, 40), 'remaining-render-array')
        if 'packageJob' not in state:
            source_files = [ROOT / 'scripts/package-celestial-atlas.py', ROOT / 'scripts/package-celestial-full-sphere.slurm']
            SYNC.run(['scp', '-o', 'BatchMode=yes', *map(str, source_files), f'{args.host}:{args.remote_root}/'], timeout=180)
            job = submit(args, 'package-celestial-full-sphere.slurm', '--array=0-9%4')
            save(args, state, 'package-submitted', packageJob=job)
        wait_array(args, state, state['packageJob'], range(10), 'remote-packaging')
        save(args, state, 'local-sync')
        SYNC.run([sys.executable, str(ROOT / 'scripts/sync-celestial-atlas.py'), '--host', args.host,
                  '--job', str(args.initial_job), '--job', str(state['remainingJob']),
                  '--remote-root', args.remote_root + '/baked-full-sphere-v4',
                  '--remote-archive-root', args.remote_root + '/delivery-full-sphere-v4',
                  '--staging', str(args.staging / 'receive'), '--output', str(args.output),
                  '--layout', 'full-sphere', '--verified-remote', '--remove-downloaded-archives'], timeout=86400)
        save(args, state, 'complete', manifest=str(args.output / 'manifest.json'))
    except Exception as error:
        save(args, state, 'failed', error=str(error))
        raise


if __name__ == '__main__':
    main()
