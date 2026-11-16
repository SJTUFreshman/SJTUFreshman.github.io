"""Archive and verify one explicitly named Zhongwei map project before removal.

Default is a read-only inventory. --archive-and-remove snapshots all current
files, verifies the repository archive, then rechecks remote hashes and removes
only that exact project. The Blender installation and unrelated projects stay.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import re
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PARENT = '/data/run01/scwb515/yangrunde'
PROJECTS = (
    'relief-atlas-20261008', 'footprint-atlas-20261009',
    'footprints-material-white-20261012', 'footprints-administrative-20261016',
    'footprints-sectional-20261105', 'footprints-selected-cultural-20261106',
    'footprints-culture-regions-20261107', 'footprints-east-asia-cultural-20261108',
)

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

REMOVE = r'''
import hashlib, json, os, re, shutil, subprocess, sys
from pathlib import Path
expected=json.load(sys.stdin)
root=Path(sys.argv[1]); parent=Path(sys.argv[2]).resolve()
if root.is_symlink() or not root.is_dir() or root.resolve().parent!=parent:
    raise ValueError('Project must be a direct, real child of the explicit archive parent')
# Other projects share this account. Only jobs referencing this project block it.
jobs=subprocess.run(['squeue','-h','-u',os.environ['USER'],'-o','%i'],check=True,capture_output=True,text=True)
for job in jobs.stdout.split():
    if not re.fullmatch(r'[0-9_+.-]+',job):raise ValueError('Unrecognized job ID')
    info=subprocess.run(['scontrol','show','job',job,'-o'],check=True,capture_output=True,text=True).stdout
    fields=dict(re.findall(r'(WorkDir|Command|StdOut|StdErr)=([^ ]+)',info))
    if 'WorkDir' not in fields:raise ValueError('Cannot verify running job directory')
    if any(str(root)==value or value.startswith(str(root)+'/') for value in fields.values()):
        raise ValueError('Slurm job uses this project; wait until it finishes')
actual=[]
for p in sorted(root.rglob('*')):
    if p.is_symlink(): raise ValueError('Unexpected symlink: '+str(p))
    if p.is_file():
        digest=hashlib.sha256()
        with p.open('rb') as f:
            for block in iter(lambda:f.read(1024*1024),b''): digest.update(block)
        digest=digest.hexdigest()
        actual.append({'path':p.relative_to(root).as_posix(),'bytes':p.stat().st_size,'sha256':digest})
    elif not p.is_dir(): raise ValueError('Unexpected file type: '+str(p))
expected=sorted(expected,key=lambda x:x['path'])
actual=sorted(actual,key=lambda x:x['path'])
if actual!=expected: raise ValueError('Remote project changed since verified archive; keep all files')
shutil.rmtree(root)
if root.exists(): raise ValueError('Removal did not finish')
print(json.dumps({'removed':str(root),'verified_files':len(actual),'bytes':sum(x['bytes'] for x in actual)}))
'''

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',default='paracloud-Zhongwei1')
    parser.add_argument('--project',choices=PROJECTS,required=True)
    parser.add_argument('--archive-and-remove',action='store_true')
    args=parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._@-]*',args.host):
        raise ValueError('Use an SSH config alias')
    source=PARENT+'/'+args.project
    snapshot=module('remote_snapshot','snapshot-relief-project.py')
    archive=module('project_archive','archive-relief-projects.py')
    if not args.archive_and_remove:
        data=snapshot.remote_inventory(args.host,source)
        print(json.dumps({'source':source,'files':len(data['files']),'bytes':sum(x['bytes'] for x in data['files'])}))
        return
    stamp=datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    name='retired-'+args.project+'-'+stamp
    output=ROOT/'.render-work/retired-relief'/name
    provenance=ROOT/'tools/relief-atlas/full-archive/provenance'/f'{name}.json'
    snapshot.snapshot(args.host,source,output,[ROOT/'tools/relief-atlas'],provenance)
    archive.archive([name+'='+str(output)])
    manifest=ROOT/'tools/relief-atlas/full-archive'/f'{name}.json'
    subprocess.run([__import__('sys').executable,str(ROOT/'scripts/archive-relief-projects.py'),'verify',str(manifest),'--compare-source',str(output)],check=True)
    records=json.loads(provenance.read_text(encoding='utf-8'))['files']
    expected=[{k:r[k] for k in ('path','bytes','sha256')} for r in records]
    command='python3 -c '+shlex.quote(REMOVE)+' '+shlex.quote(source)+' '+shlex.quote(PARENT)
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',args.host,command],input=json.dumps(expected),text=True,capture_output=True)
    if result.returncode:
        raise SystemExit('Remote cleanup did not complete; verified archive is retained.\n'+result.stderr.strip())
    receipt=json.loads(result.stdout)
    receipt.update({'host':args.host,'archive':manifest.relative_to(ROOT).as_posix(),'verified_at':datetime.now(timezone.utc).isoformat()})
    target=provenance.with_name(name+'-removal.json')
    target.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt,ensure_ascii=False))

if __name__=='__main__': main()
