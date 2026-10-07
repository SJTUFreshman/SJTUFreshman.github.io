import argparse
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SPEC = importlib.util.spec_from_file_location('multires_production', Path(__file__).with_name('complete-celestial-multires-production.py'))
PRODUCTION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRODUCTION)


class MultiresProductionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='multires-production-test-')
        self.addCleanup(self.temporary.cleanup)
        self.status = Path(self.temporary.name) / 'status.json'
        self.args = SimpleNamespace(host='fake-host', remote_root='/fake/atlas', blender='/fake/blender',
                                    slurm='render.slurm', first_job=111, followup_job=222,
                                    remaining_job=[], package_job=None, status=self.status, poll_seconds=1)
        self.initial = {**self.completed(111, PRODUCTION.FIRST_INDICES),
                        **self.completed(222, PRODUCTION.FOLLOWUP_INDICES)}

    def completed(self, job, indices):
        return {f'{job}_{index}': 'COMPLETED' for index in indices}

    def saved(self):
        return json.loads(self.status.read_text(encoding='utf-8'))

    def test_every_explicit_shard_is_required(self):
        arrays = {111: PRODUCTION.FIRST_INDICES, 222: PRODUCTION.FOLLOWUP_INDICES}
        self.assertTrue(PRODUCTION.complete(self.initial, arrays))
        for identifier in self.initial:
            partial = dict(self.initial)
            partial.pop(identifier)
            self.assertFalse(PRODUCTION.complete(partial, arrays))
            partial[identifier] = 'RUNNING'
            self.assertFalse(PRODUCTION.complete(partial, arrays))
        self.assertFalse(PRODUCTION.complete({'111': 'COMPLETED', '222_[1-17]': 'COMPLETED'}, arrays))
        self.assertFalse(PRODUCTION.complete({}, {}))

    def test_all_stages_wait_for_last_shard(self):
        state = PRODUCTION.load_state(self.args)
        remaining = self.completed(333, PRODUCTION.DEFAULT_REMAINING)
        package = self.completed(444, range(PRODUCTION.BODY_COUNT))
        timeline = []
        replies = [dict(self.initial, **{'222_17': 'RUNNING'}), self.initial,
                   dict(remaining, **{'333_39': 'RUNNING'}), remaining,
                   dict(package, **{'444_9': 'RUNNING'}), package]

        def read_states(host, jobs):
            reply = replies.pop(0)
            timeline.append(('states', sum(value == 'COMPLETED' for value in reply.values())))
            return reply

        def run(command, **kwargs):
            if command[0] == 'scp':
                timeline.append(('sync', None))
                return subprocess.CompletedProcess(command, 0)
            timeline.append(('submit', command[-1]))
            job = 444 if 'package-' in command[-1] else 333
            return subprocess.CompletedProcess(command, 0, f'{job};cluster\n', '')

        with mock.patch.object(PRODUCTION, 'states', side_effect=read_states), \
                mock.patch.object(PRODUCTION.subprocess, 'run', side_effect=run), \
                mock.patch.object(PRODUCTION.time, 'sleep') as sleep:
            PRODUCTION.continue_production(self.args, state)
        self.assertEqual(sleep.call_count, 3)
        self.assertEqual(timeline[:2], [('states', 19), ('states', 20)])
        self.assertEqual(timeline[3:6], [('states', 19), ('states', 20), ('sync', None)])
        self.assertTrue(all('--dependency=' not in command for kind, command in timeline if kind == 'submit'))
        self.assertEqual(self.saved()['phase'], 'package-complete')
        self.assertEqual(self.saved()['remainingJobs'], {'333': list(PRODUCTION.DEFAULT_REMAINING)})

    def test_resume_adopts_split_arrays_and_ignores_replaced_cancelled_shard(self):
        self.args.remaining_job = [PRODUCTION.parse_remaining_job('333:18,19,21-29,31-38'),
                                   PRODUCTION.parse_remaining_job('334:39')]
        self.args.package_job = 444
        state = PRODUCTION.load_state(self.args)
        remaining = self.completed(333, PRODUCTION.DEFAULT_REMAINING[:-1])
        remaining.update({'333_39': 'CANCELLED', '333': 'CANCELLED', '334_39': 'COMPLETED'})
        with mock.patch.object(PRODUCTION, 'states', side_effect=[self.initial, remaining, self.completed(444, range(10))]), \
                mock.patch.object(PRODUCTION.subprocess, 'run') as run:
            PRODUCTION.continue_production(self.args, state)
        run.assert_not_called()
        self.assertEqual(self.saved()['phase'], 'package-complete')
        self.args.remaining_job = []
        self.args.package_job = None
        self.assertEqual(PRODUCTION.load_state(self.args)['remainingJobs'], state['remainingJobs'])

    def test_saved_single_remaining_job_migrates_without_resubmission(self):
        self.status.write_text(json.dumps({'firstJob': 111, 'followupJob': 222, 'remainingJob': 333}))
        state = PRODUCTION.load_state(self.args)
        self.assertEqual(state['remainingJobs'], {'333': list(PRODUCTION.DEFAULT_REMAINING)})

    def test_failed_shard_blocks_packaging_and_persists_failure(self):
        self.args.remaining_job = [PRODUCTION.parse_remaining_job('333')]
        state = PRODUCTION.load_state(self.args)
        failed = dict(self.completed(333, PRODUCTION.DEFAULT_REMAINING), **{'333_39': 'TIMEOUT'})
        with mock.patch.object(PRODUCTION, 'states', side_effect=[self.initial, failed]), \
                mock.patch.object(PRODUCTION.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'TIMEOUT'):
                PRODUCTION.continue_production(self.args, state)
        run.assert_not_called()
        self.assertEqual(self.saved()['phase'], 'failed')
        self.assertNotIn('packageJob', self.saved())

    def test_four_connection_failures_recover_without_ending_runner(self):
        state = PRODUCTION.load_state(self.args)
        failures = [subprocess.CalledProcessError(255, ['ssh']) for _ in range(4)]
        with mock.patch.object(PRODUCTION, 'states', side_effect=[*failures, self.initial]), \
                mock.patch.object(PRODUCTION.time, 'sleep') as sleep:
            PRODUCTION.wait_arrays(self.args, state, {111: PRODUCTION.FIRST_INDICES, 222: PRODUCTION.FOLLOWUP_INDICES}, 'waiting')
        self.assertEqual(sleep.call_count, 4)
        self.assertEqual(self.saved()['phase'], 'waiting')
        self.assertNotIn('lastConnectionError', self.saved())

    def test_non_transport_query_errors_fail_without_retry(self):
        state = PRODUCTION.load_state(self.args)
        with mock.patch.object(PRODUCTION, 'states', side_effect=subprocess.CalledProcessError(1, ['ssh'])), \
                mock.patch.object(PRODUCTION.time, 'sleep') as sleep:
            with self.assertRaises(subprocess.CalledProcessError):
                PRODUCTION.wait_arrays(self.args, state, {111: PRODUCTION.FIRST_INDICES}, 'waiting')
        sleep.assert_not_called()

    def test_uncertain_submission_blocks_retry_and_can_adopt_job(self):
        state = PRODUCTION.load_state(self.args)
        with mock.patch.object(PRODUCTION.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['ssh'], 180)) as run:
            with self.assertRaises(subprocess.TimeoutExpired):
                PRODUCTION.submit_remaining(self.args, state, self.status, PRODUCTION.DEFAULT_REMAINING)
            with self.assertRaisesRegex(RuntimeError, 'unknown outcome'):
                PRODUCTION.submit_remaining(self.args, state, self.status, PRODUCTION.DEFAULT_REMAINING)
        run.assert_called_once()
        with self.assertRaisesRegex(RuntimeError, 'unknown outcome'):
            PRODUCTION.load_state(self.args)
        self.args.remaining_job = [PRODUCTION.parse_remaining_job('333')]
        resumed = PRODUCTION.load_state(self.args)
        self.assertNotIn('pendingSubmission', resumed)
        self.assertIn('333', resumed['remainingJobs'])

    def test_explicit_quota_rejection_can_retry(self):
        state = PRODUCTION.load_state(self.args)
        rejected = subprocess.CompletedProcess(['ssh'], 1, '', 'sbatch: error: AssocMaxSubmitJobLimit')
        accepted = subprocess.CompletedProcess(['ssh'], 0, '333\n', '')
        with mock.patch.object(PRODUCTION.subprocess, 'run', side_effect=[rejected, accepted]):
            self.assertIsNone(PRODUCTION.submit_remaining(self.args, state, self.status, PRODUCTION.DEFAULT_REMAINING))
            self.assertNotIn('pendingSubmission', self.saved())
            self.assertEqual(PRODUCTION.submit_remaining(self.args, state, self.status, PRODUCTION.DEFAULT_REMAINING), 333)
        self.assertNotIn('pendingSubmission', self.saved())

    def test_adoption_rejects_duplicate_shards_and_changed_configuration(self):
        self.args.remaining_job = [PRODUCTION.parse_remaining_job('333:18,19'), PRODUCTION.parse_remaining_job('334:19')]
        with self.assertRaisesRegex(ValueError, 'overlap'):
            PRODUCTION.load_state(self.args)
        self.args.remaining_job = []
        PRODUCTION.load_state(self.args)
        self.args.remote_root = '/different/atlas'
        with self.assertRaisesRegex(ValueError, 'configuration'):
            PRODUCTION.load_state(self.args)

    def test_invalid_adopted_arrays_are_rejected(self):
        for value in ('0', '333:0', '333:19-18', '333:18,18', '333:39-999999999', '333:'):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                PRODUCTION.parse_remaining_job(value)

    def test_lock_blocks_second_runner_and_releases_after_exception(self):
        with self.assertRaisesRegex(RuntimeError, 'test interruption'):
            with PRODUCTION.status_lock(self.status):
                with self.assertRaisesRegex(RuntimeError, 'Another continuation'):
                    with PRODUCTION.status_lock(self.status):
                        self.fail('Second runner acquired the same status lock')
                raise RuntimeError('test interruption')
        with PRODUCTION.status_lock(self.status):
            pass


if __name__ == '__main__':
    unittest.main()
