"""Archive the public-source API cache and editorial review inputs for rebuilding.

Photographs are already shipped as credited WebP assets; the archive excludes
duplicate raster downloads, contact sheets, terrain grids and local secrets.
"""
from pathlib import Path
import hashlib,json,zipfile
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.render-work/region-content'
TARGET=ROOT/'tools/relief-atlas/administrative/content-sources.zip'

def main():
    paths=sorted(CACHE.rglob('*.json'))
    paths += sorted(p for p in CACHE.glob('*.py') if p.name.startswith(('review-admin','repair-geo')))
    manifest=[]
    target=TARGET.with_suffix('.tmp.zip');target.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for path in paths:
            data=path.read_bytes();name=path.relative_to(ROOT).as_posix()
            info=zipfile.ZipInfo(name,date_time=(2026,11,16,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,data)
            manifest.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        archive.writestr('SOURCE-MANIFEST.json',json.dumps({'kind':'Public source API responses and editorial review inputs','files':manifest},ensure_ascii=False,indent=2))
    target.replace(TARGET)
    print(f'Archived {len(paths)} public source/review files: {TARGET.stat().st_size:,} bytes')

if __name__=='__main__':main()
