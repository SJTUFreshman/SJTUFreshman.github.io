import contextlib
import importlib.util
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location('atlas_sync', Path(__file__).with_name('sync-celestial-atlas.py'))
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class CelestialSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='atlas-sync-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.staging = self.root / 'staging'

    def arguments(self, *extra):
        return ['--job', '123', '--remote-root', '/fake/bake', '--staging', str(self.staging), *extra]

    def test_full_sphere_defaults_match_production_array(self):
        args = SYNC.parse_args(self.arguments('--layout', 'full-sphere'))
        self.assertEqual((args.width, args.height, args.shards_per_body), (4096, 4096, 4))
        self.assertEqual(SYNC.body_job_ids(args, 'earth'), ['123_0', '123_10', '123_20', '123_30'])
        self.assertEqual(SYNC.body_job_ids(args, 'neptune'), ['123_9', '123_19', '123_29', '123_39'])

    def test_multiple_job_split_array_requires_every_body_shard(self):
        args = SYNC.parse_args(self.arguments('--layout', 'full-sphere', '--job', '456'))
        self.assertEqual(args.job, 123)
        self.assertEqual(SYNC.job_ids(args), [123, 456])
        states = {'123_0': 'COMPLETED', '123_10': 'COMPLETED', '456_20': 'COMPLETED', '456_30': 'RUNNING'}
        self.assertFalse(SYNC.body_jobs_complete(args, 'earth', states))
        states['456_30'] = 'COMPLETED'
        self.assertTrue(SYNC.body_jobs_complete(args, 'earth', states))
        self.assertFalse(SYNC.body_jobs_complete(args, 'sun', states))

    def test_array_offset_and_custom_body_order_are_applied(self):
        args = SYNC.parse_args(self.arguments('--array-offset', '40', '--body-order', ','.join(reversed(SYNC.BODIES))))
        self.assertEqual(SYNC.body_job_ids(args, 'earth'), ['123_49', '123_59'])

    def test_accounting_queries_all_jobs_and_ignores_steps_and_ranges(self):
        args = SYNC.parse_args(self.arguments('--job', '456'))
        output = '123_0|COMPLETED|\n456_10|RUNNING|\n123_0.batch|COMPLETED|\n456_[11-19%7]|PENDING|\n789_1|FAILED|\n'
        with mock.patch.object(SYNC, 'remote', return_value=output) as remote:
            self.assertEqual(SYNC.job_states(args), {'123_0': 'COMPLETED', '456_10': 'RUNNING'})
        self.assertIn('-j 123,456 ', remote.call_args.args[1])

    def test_secondary_job_cancellation_fails(self):
        args = SYNC.parse_args(self.arguments('--job', '456'))
        with mock.patch.object(SYNC, 'remote', return_value='456_[10-19]|CANCELLED by 1520|\n'):
            with self.assertRaisesRegex(RuntimeError, 'CANCELLED'):
                SYNC.job_states(args)

    def test_explicit_cancelled_replacement_waits_for_the_same_shard(self):
        args = SYNC.parse_args(self.arguments('--layout', 'full-sphere', '--job', '456',
                                              '--replacement-task', '123_39:456_39'))
        base = ''.join(f'123_{index}|COMPLETED|\n' for index in range(39)) + '123_39|CANCELLED by 1520|\n'
        for replacement_state in ('PENDING', 'RUNNING', 'COMPLETED'):
            with self.subTest(state=replacement_state), mock.patch.object(SYNC, 'remote', return_value=base + f'456_39|{replacement_state}|\n'):
                states = SYNC.job_states(args)
                self.assertEqual(SYNC.body_jobs_complete(args, 'neptune', states), replacement_state == 'COMPLETED')
        self.assertEqual(SYNC.sync_configuration(args)['replacementTasks'], {'123_39': '456_39'})
        with mock.patch.object(SYNC, 'remote', return_value=base + '456_[39%1]|PENDING|\n'):
            states = SYNC.job_states(args)
            self.assertEqual(states['456_39'], 'PENDING')
            self.assertFalse(SYNC.body_jobs_complete(args, 'neptune', states))

    def test_replacement_never_masks_missing_failed_or_unrelated_shards(self):
        args = SYNC.parse_args(self.arguments('--layout', 'full-sphere', '--job', '456',
                                              '--replacement-task', '123_39:456_39'))
        outputs = ('123_39|CANCELLED|\n', '123_39|CANCELLED|\n456_39|FAILED|\n',
                   '123_39|FAILED|\n456_39|RUNNING|\n',
                   '123_39|CANCELLED|\n456_39|RUNNING|\n123_38|CANCELLED|\n')
        for output in outputs:
            with self.subTest(output=output), mock.patch.object(SYNC, 'remote', return_value=output):
                with self.assertRaises(RuntimeError):
                    SYNC.job_states(args)
        unmarked = SYNC.parse_args(self.arguments('--layout', 'full-sphere', '--job', '456'))
        with mock.patch.object(SYNC, 'remote', return_value='123_39|CANCELLED|\n456_39|COMPLETED|\n'):
            with self.assertRaisesRegex(RuntimeError, 'CANCELLED'):
                SYNC.job_states(unmarked)

    def test_invalid_replacement_mapping_is_rejected(self):
        for mapping in ('123_39:456_38', '123_39:789_39', '123_39:123_39', '123_40:456_40', '123:456'):
            with self.subTest(mapping=mapping), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    SYNC.parse_args(self.arguments('--layout', 'full-sphere', '--job', '456', '--replacement-task', mapping))

    def test_main_waits_for_last_split_shard_before_downloading(self):
        first = {'123_0': 'COMPLETED', '123_10': 'COMPLETED', '456_20': 'COMPLETED', '456_30': 'RUNNING'}
        complete = {f'{123 if index < 20 else 456}_{index}': 'COMPLETED' for index in range(40)}
        timeline = []
        with mock.patch.object(SYNC, 'job_states', side_effect=[first, complete]), \
                mock.patch.object(SYNC, 'receive_body', side_effect=lambda args, body, status: timeline.append(('receive', body))), \
                mock.patch.object(SYNC.time, 'sleep', side_effect=lambda seconds: timeline.append(('sleep', seconds))), \
                mock.patch.object(SYNC, 'run', side_effect=lambda command, **kwargs: timeline.append(('command', command))), \
                contextlib.redirect_stdout(io.StringIO()):
            SYNC.main(self.arguments('--layout', 'full-sphere', '--job', '456'))
        self.assertEqual(timeline[0], ('sleep', 30))
        self.assertEqual([entry[1] for entry in timeline if entry[0] == 'receive'], list(SYNC.BODIES))
        command = next(entry[1] for entry in timeline if entry[0] == 'command')
        self.assertIn('--verify-only', command)
        self.assertEqual(command[command.index('--width') + 1], '4096')
        status = json.loads((self.staging / 'status.json').read_text())
        self.assertEqual(status['phase'], 'complete')
        self.assertEqual(status['frames'], 12600)

    def test_duplicate_job_ids_are_collapsed_and_invalid_ids_fail(self):
        self.assertEqual(SYNC.job_ids(SYNC.parse_args(self.arguments('--job', '123'))), [123])
        for extra in (['--job', '0'], ['--job', '-1']):
            with self.subTest(extra=extra), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    SYNC.parse_args(self.arguments(*extra))

    def receive_verified(self, remove=False, fail=False):
        output = self.root / 'output'
        previous = output / 'earth/e0/a000.webp'
        previous.parent.mkdir(parents=True, exist_ok=True)
        previous.write_bytes(b'previous-verified-frame')
        self.staging.mkdir(exist_ok=True)
        extra = ['--verified-remote', '--remote-archive-root', '/fake/delivery', '--output', str(output)]
        if remove:
            extra.append('--remove-downloaded-archives')
        args = SYNC.parse_args(self.arguments(*extra))
        timeline = []

        def run(command, **kwargs):
            if command[0] == 'scp':
                with tarfile.open(command[-1], 'w') as archive:
                    member = tarfile.TarInfo('earth/e0/a000.webp')
                    data = b'new-verified-frame'
                    member.size = len(data)
                    archive.addfile(member, io.BytesIO(data))
                timeline.append('downloaded')
                return
            self.assertIn('--verify-only', command)
            self.assertIn('--hash-only', command)
            extracted = Path(command[command.index('--input') + 1])
            self.assertNotEqual(extracted, output)
            self.assertEqual(Path(command[command.index('--output') + 1]), extracted)
            self.assertEqual(previous.read_bytes(), b'previous-verified-frame')
            self.assertEqual((extracted / 'earth/e0/a000.webp').read_bytes(), b'new-verified-frame')
            timeline.append('verified')
            if fail:
                raise subprocess.CalledProcessError(1, command, stderr='Frame changed after packaging')

        with mock.patch.object(SYNC, 'run', side_effect=run), mock.patch.object(SYNC, 'remote') as remote, \
                contextlib.redirect_stdout(io.StringIO()):
            if fail:
                with self.assertRaises(subprocess.CalledProcessError):
                    SYNC.receive_body(args, 'earth', {'completedBodies': []})
            else:
                SYNC.receive_body(args, 'earth', {'completedBodies': []})
        remote.assert_not_called()
        return previous, timeline

    def test_verified_remote_checks_isolated_extract_before_copy_and_optional_cleanup(self):
        for remove in (False, True):
            with self.subTest(remove=remove):
                previous, timeline = self.receive_verified(remove=remove)
                self.assertEqual(timeline, ['downloaded', 'verified'])
                self.assertEqual(previous.read_bytes(), b'new-verified-frame')
                self.assertEqual((self.staging / 'earth.tar').exists(), not remove)

    def test_verified_remote_hash_failure_preserves_output_and_downloaded_archive(self):
        previous, timeline = self.receive_verified(remove=True, fail=True)
        self.assertEqual(timeline, ['downloaded', 'verified'])
        self.assertEqual(previous.read_bytes(), b'previous-verified-frame')
        self.assertTrue((self.staging / 'earth.tar').exists())
        self.assertFalse(list(self.staging.glob('earth-extract-*')))


if __name__ == '__main__':
    unittest.main()
