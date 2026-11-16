"""Validate every published administrative ATM1 mesh against its DEM scene."""
from pathlib import Path
import hashlib
import json
import math
import struct
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/maps/administrative'


def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))


def main():
    checked={};camera_clips=[];flattened=[]
    def check(view):
        mesh=view['mesh'];file=ROOT/mesh['file'];payload=file.read_bytes()
        magic,nv,ni=struct.unpack_from('<4sII',payload)
        assert magic==b'ATM1' and 0<nv<65535 and ni>0 and ni%3==0,file
        assert 12+nv*24+ni*2==len(payload)<=250_000,file
        positions=np.frombuffer(payload,dtype='<f4',offset=12,count=nv*3).reshape((-1,3))
        normals=np.frombuffer(payload,dtype='<f4',offset=12+nv*12,count=nv*3).reshape((-1,3))
        indices=np.frombuffer(payload,dtype='<u2',offset=12+nv*24,count=ni).reshape((-1,3))
        assert np.isfinite(positions).all() and np.isfinite(normals).all(),file
        assert indices.max()<nv and np.all(np.diff(np.sort(indices,axis=1),axis=1)>0),file
        assert np.max(np.abs(positions[:,:2]))<=1.0001,file
        assert np.allclose(np.linalg.norm(normals,axis=1),1,atol=2e-4),file
        assert nv==mesh['vertices'] and len(indices)==mesh['triangles'],file
        source=ROOT/view['source_archive']
        assert hashlib.sha256(source.read_bytes()).hexdigest()==mesh['source_sha256'],source
        top=positions[:mesh['top_vertices']]
        assert top[:,2].min()>=-1e-6 and mesh['top_triangles']>0,file
        assert normals[:mesh['top_vertices'],2].min()>0,file
        with np.load(source,allow_pickle=False) as scene:
            dem=scene['elevation_qm'].astype(float)*.25
            shape=tuple(scene['mask_shape'])
            mask=np.unpackbits(scene['mask_bits'])[:int(np.prod(shape))].reshape(shape)
            small=np.asarray(Image.fromarray(mask).resize((dem.shape[1],dem.shape[0]),Image.Resampling.NEAREST)).astype(bool)
            land=dem[small]
            source_range=float(np.ptp(land)) if len(land) else 0
            if not np.any(dem):assert float(np.ptp(top[:,2]))<1e-7,file
            if source_range>.5 and float(np.ptp(top[:,2]))<=1e-7:flattened.append({'file':mesh['file'],'source_range_m':source_range})
        assert all(len(p)==3 and all(math.isfinite(v) for v in p) for p in mesh['points'].values()),file
        checked[mesh['file']]={'bytes':len(payload),'vertices':nv,'triangles':len(indices),'source_range_m':source_range,'top_z_range':float(np.ptp(top[:,2]))}
        # Exercise the fitted camera against the actual extremes that previously
        # clipped tall/narrow terrain in the default 1280:1000 viewport.
        yaw=-.12;pitch=-.58;c=math.cos(yaw);s=math.sin(yaw);a=math.cos(pitch);b=math.sin(pitch)
        rx=c*positions[:,0]-s*positions[:,1]
        ry=a*s*positions[:,0]+a*c*positions[:,1]-b*positions[:,2]
        cx=(rx.min()+rx.max())/2;cy=(ry.min()+ry.max())/2
        scale=.9/max(float(np.ptp(rx))/2,float(np.ptp(ry))/2*1.28,.01)
        if np.max(np.abs(rx-cx))*scale>0.9001 or np.max(np.abs(ry-cy))*scale*1.28>0.9001:camera_clips.append(mesh['file'])
        for inset in view.get('insets',[]):check(inset)
        if view.get('insets'):assert len(mesh['parts'])==len(view['insets'])
    manifest=read(OUT/'manifest.json')
    for entry in manifest['units'].values():
        document=read(ROOT/entry['file'])
        for view in document['views'].values():check(view)
    assert not flattened,flattened
    assert not camera_clips,camera_clips
    report={'units':len(manifest['units']),'meshes':len(checked),'total_bytes':sum(v['bytes'] for v in checked.values()),
        'maximum_bytes':max(v['bytes'] for v in checked.values()),'maximum_vertices':max(v['vertices'] for v in checked.values()),
        'maximum_triangles':max(v['triangles'] for v in checked.values()),'default_camera_clips':camera_clips,
        'source_variation_lost':flattened}
    target=ROOT/'.render-work/admin-explorer-validation/mesh-audit.json';target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps({'summary':report,'meshes':checked},indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))


if __name__=='__main__':main()
