#!/usr/bin/env python3
"""Run a bounded review render queue in one allocated Blender process."""
import argparse
import json
import os
import runpy
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue', required=True)
    options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if not os.environ.get('SLURM_JOB_ID'):
        raise RuntimeError('Run the review queue inside a Slurm compute allocation.')
    queue = json.loads(Path(options.queue).read_text(encoding='utf-8'))
    renderer = Path(__file__).with_name('render-world-panorama.py')
    results = []
    for entry in queue:
        if not isinstance(entry, list) or not all(isinstance(argument, str) for argument in entry):
            raise ValueError('Each queue entry must contain renderer argument strings.')
        sys.argv = [str(renderer), '--', *entry]
        print('REVIEW_QUEUE_START', json.dumps(entry), flush=True)
        runpy.run_path(str(renderer), run_name='__main__')
        results.append(entry)
        print('REVIEW_QUEUE_COMPLETED', len(results), flush=True)


if __name__ == '__main__':
    main()
