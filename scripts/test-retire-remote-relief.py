"""Deletion guards exercised only in isolated workspace temporary directories."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('retire',ROOT/'scripts/retire-remote-relief.py')
retire=importlib.util.module_from_spec(spec);spec.loader.exec_module(retire)

class RemovalGuards(unittest.TestCase):
    def run_case(self, *, mismatch=False, wrong_parent=False, jobs=False):
        with tempfile.TemporaryDirectory(dir=ROOT/'.render-work',prefix='retire-guard-') as temp:
            parent=Path(temp).resolve();project=parent/'map-project';project.mkdir()
            (project/'scene.py').write_bytes(b'archived source')
            records=[{'path':'scene.py','bytes':15,'sha256':hashlib.sha256(b'archived source').hexdigest()}]
            (project/'cultural').mkdir()
            for filename in ('cultural-results.tar.gz', 'cultural/data.json'):
                (project/filename).write_bytes(b'fixture')
                records.append({'path':filename,'bytes':7,'sha256':hashlib.sha256(b'fixture').hexdigest()})
            if mismatch: (project/'scene.py').write_bytes(b'new work, preserve')
            args=['cleanup',str(project),str(parent/'different' if wrong_parent else parent)]
            def command(args, **kwargs):
                return types.SimpleNamespace(stdout=('123' if jobs else '') if args[0]=='squeue' else 'WorkDir='+str(project))
            with patch('sys.argv',args),patch('sys.stdin',io.StringIO(json.dumps(records))),patch.dict(os.environ,{'USER':'test'}),patch('subprocess.run',side_effect=command),contextlib.redirect_stdout(io.StringIO()):
                if mismatch or wrong_parent or jobs:
                    with self.assertRaises(ValueError):exec(retire.REMOVE,{})
                    self.assertTrue((project/'scene.py').exists())
                else:
                    exec(retire.REMOVE,{})
                    self.assertFalse(project.exists())
    def test_verified_archive_is_removed(self):self.run_case()
    def test_changed_file_is_kept(self):self.run_case(mismatch=True)
    def test_outside_project_parent_is_kept(self):self.run_case(wrong_parent=True)
    def test_running_jobs_keep_project(self):self.run_case(jobs=True)

if __name__=='__main__':unittest.main()
