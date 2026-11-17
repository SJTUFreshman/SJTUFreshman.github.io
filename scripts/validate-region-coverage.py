"""Check that every displayed region opens a real, self-contained landscape."""
import json, math, re
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/maps/regions'
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
atlas=read(ROOT/'assets/maps/relief/atlas.json')['maps']
manifest=read(OUT/'manifest.json')['regions']
checks=0;files=set();images=set()
for mapid,m in atlas.items():
    views=[('detail',m['regions']),('overview',m['overview']['regions'])]
    if m.get('cultural'):views.append(('cultural',m['cultural']['regions']))
    views += [(view,i['regions']) for i in m.get('insets',[]) for view in ('overview','detail')]
    for view,regions in views:
        for r in regions:
            key=f'{mapid}:{view}:{r["id"]}'
            assert key in manifest,key
            p=OUT/manifest[key]['file'];d=read(p)
            assert d['visited']==bool(r.get('visited')),key
            assert d['outline'] and d['projection'] and len(d['extent_m'])==4,key
            assert all(math.isfinite(v) for v in d['extent_m']),key
            content=read(OUT/'content'/p.name)['entries']
            ids={d['id']}|{s['id'] for s in d.get('subregions',[])}|{s['id'] for s in d.get('places',[])}
            assert ids<=content.keys(),(key,ids-content.keys())
            if d.get('terrain_provenance'):
                for entry_id in {d['id']}|{s['id'] for s in d['subregions']}:
                    entry=content[entry_id]
                    assert entry.get('source'),(key,entry_id,'source')
                    for lang in ['en','zh-CN','zh-TW']:
                        text=entry.get('description',{}).get(lang,'')
                        assert text and not re.search(r'(?:may|might|can) refer to|most commonly refers to',text,re.I),(key,entry_id,lang)
                photo=content[d['id']]['photo']
                assert (ROOT/photo['src']).is_file() and photo.get('license') and photo.get('source'),key
            for s in d.get('subregions',[]):
                if s.get('explore'):
                    e=s['explore'];target=f'{e["map"]}:{e["view"]}:{e["region"]["id"]}'
                    assert target in manifest,(key,target)
            image=ROOT/d['image']
            if image not in images:
                with Image.open(image) as im:
                    assert im.size==(d['width'],d['height']),key
                    assert im.mode=='RGBA' and im.getchannel('A').getbbox(),key
                    assert not im.info.get('exif') and not im.info.get('xmp'),key
                images.add(image)
            files.add(p);checks+=1
print(f'Complete atlas coverage: {checks} map/view entries, {len(files)} landscapes, {len(images)} relief images; visits unchanged, sources and navigation verified.')
