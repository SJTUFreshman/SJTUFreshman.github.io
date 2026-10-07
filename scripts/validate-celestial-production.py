import contextlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SPEC = importlib.util.spec_from_file_location('atlas_production', Path(__file__).with_name('complete-celestial-production.py'))
PRODUCTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCTION)


class CelestialProductionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='atlas-production-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.staging = self.root / 'staging'
        self.output = self.root / 'output'
        self.argv = ['--initial-job', '111', '--remote-root', '/fake/atlas', '--blender', '/fake/blender',
                     '--staging', str(self.staging), '--output', str(self.output)]

    def state(self):
        return json.loads((self.staging / 'production-status.json').read_text())

    def completed(self, job, indices):
        return {f'{job}_{index}': 'COMPLETED' for index in indices}

    def test_partial_arrays_wait_before_next_render_packaging_and_sync(self):
        timeline = []
        responses = iter([
            self.completed(111, range(19)), self.completed(111, range(20)),
            self.completed(222, range(20, 39)), self.completed(222, range(20, 40)),
            self.completed(333, range(9)), self.completed(333, range(10))
        ])

        def states(args):
            result = next(responses)
            timeline.append(('states', args.job, len(result)))
            return result

        def submit(args, script, extra):
            timeline.append(('submit', script, extra))
            return 222 if script.startswith('render-') else 333

        with mock.patch.object(PRODUCTION.SYNC, 'job_states', side_effect=states), \
                mock.patch.object(PRODUCTION, 'submit', side_effect=submit), \
                mock.patch.object(PRODUCTION.SYNC, 'run', side_effect=lambda command, **kwargs: timeline.append(('command', command))), \
                mock.patch.object(PRODUCTION.time, 'sleep', side_effect=lambda seconds: timeline.append(('sleep', seconds))), \
                contextlib.redirect_stdout(io.StringIO()):
            PRODUCTION.main(self.argv)
        self.assertEqual(timeline[:4], [('states', 111, 19), ('sleep', 30), ('states', 111, 20),
            ('submit', 'render-celestial-full-sphere-production.slurm', '--array=20-39%8')])
        package_index = next(index for index, event in enumerate(timeline) if event[:2] == ('submit', 'package-celestial-full-sphere.slurm'))
        self.assertEqual(timeline[package_index - 2], ('states', 222, 20))
        sync_index = next(index for index, event in enumerate(timeline) if event[0] == 'command' and 'sync-celestial-atlas.py' in event[1][1])
        self.assertEqual(timeline[sync_index - 1], ('states', 333, 10))
        command = timeline[sync_index][1]
        self.assertEqual([command[index + 1] for index, value in enumerate(command) if value == '--job'], ['111', '222'])
        self.assertIn('--verified-remote', command)
        self.assertEqual(self.state()['phase'], 'complete')

    def test_remaining_render_failure_persists_and_never_packages(self):
        with mock.patch.object(PRODUCTION.SYNC, 'job_states', side_effect=[self.completed(111, range(20)), RuntimeError('render failed')]), \
                mock.patch.object(PRODUCTION, 'submit', return_value=222) as submit, \
                mock.patch.object(PRODUCTION.SYNC, 'run') as run, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'render failed'):
                PRODUCTION.main(self.argv)
        submit.assert_called_once()
        run.assert_not_called()
        state = self.state()
        self.assertEqual(state['phase'], 'failed')
        self.assertEqual(state['remainingJob'], 222)
        self.assertNotIn('packageJob', state)
        self.assertEqual(state['error'], 'render failed')

    def test_resume_reuses_saved_render_and_package_jobs(self):
        self.staging.mkdir()
        state = {'configuration': {'initialJob': 111, 'host': 'paracloud-Zhongwei1', 'remoteRoot': '/fake/atlas',
            'blender': '/fake/blender', 'output': str(self.output.resolve())}, 'remainingJob': 222, 'packageJob': 333,
            'phase': 'failed', 'error': 'old interrupted sync'}
        (self.staging / 'production-status.json').write_text(json.dumps(state))
        with mock.patch.object(PRODUCTION.SYNC, 'job_states', side_effect=[self.completed(111, range(20)),
                self.completed(222, range(20, 40)), self.completed(333, range(10))]), \
                mock.patch.object(PRODUCTION, 'submit') as submit, mock.patch.object(PRODUCTION.SYNC, 'run') as run, \
                contextlib.redirect_stdout(io.StringIO()):
            PRODUCTION.main(self.argv)
        submit.assert_not_called()
        run.assert_called_once()
        self.assertIn('sync-celestial-atlas.py', run.call_args.args[0][1])
        self.assertEqual(self.state()['phase'], 'complete')
        self.assertNotIn('error', self.state())

    def test_explicit_submission_quota_rejection_can_retry_without_duplicate_job(self):
        args = SimpleNamespace(remote_root='/fake/atlas', blender='/fake/blender', host='fake-host')
        rejected = subprocess.CompletedProcess(['ssh'], 1, '', 'sbatch: error: AssocMaxSubmitJobLimit')
        accepted = subprocess.CompletedProcess(['ssh'], 0, '444;cluster\n', '')
        with mock.patch.object(PRODUCTION.subprocess, 'run', side_effect=[rejected, accepted]) as run, \
                mock.patch.object(PRODUCTION.time, 'sleep') as sleep, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(PRODUCTION.submit(args, 'render.slurm', '--array=20-39%8'), 444)
        self.assertEqual(run.call_count, 2)
        sleep.assert_called_once_with(30)

    def test_unknown_submission_transport_failure_never_retries(self):
        args = SimpleNamespace(remote_root='/fake/atlas', blender='/fake/blender', host='fake-host')
        failed = subprocess.CompletedProcess(['ssh'], 255, '', 'Connection reset after submission')
        with mock.patch.object(PRODUCTION.subprocess, 'run', return_value=failed) as run, \
                mock.patch.object(PRODUCTION.time, 'sleep') as sleep:
            with self.assertRaises(subprocess.CalledProcessError):
                PRODUCTION.submit(args, 'render.slurm', '--array=20-39%8')
        run.assert_called_once()
        sleep.assert_not_called()


if __name__ == '__main__':
    unittest.main()
