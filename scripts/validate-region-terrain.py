"""Verify published regional plates against source visits and explicit scopes."""
import json, math, re, importlib.util
from pathlib import Path
from PIL import Image
from shapely.geometry import Point
from shapely.ops import unary_union
from pyproj import Transformer
from rasterio.warp import transform as raster_transform
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/maps/regions'
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
atlas=read(ROOT/'assets/maps/relief/atlas.json')['maps']['china']
manifest=read(OUT/'manifest.json');registry=manifest['regions']
assert manifest['material']=={'style':'warm-plaster','base_color':'#eeeae0','surface_texture':None}
expected={f"china:cultural:{r['id']}":r for r in atlas['cultural']['regions']}
expected.update({f"china:overview:{r['id']}":r for r in atlas['overview']['regions']})
expected.update({f"china:detail:{r['id']}":r for r in atlas['regions'] if r.get('visited')})
assert expected, 'No source regions found'
files=set();bytes_total=0;point_count=0
for key,source in expected.items():
    assert key in registry,key
    doc=read(OUT/registry[key]['file'])
    px,py=Transformer.from_crs('EPSG:4326',doc['projection'],always_xy=True).transform(110,30)
    rx,ry=raster_transform('EPSG:4326',doc['projection'],[110],[30])
    assert abs(px-rx[0])<.001 and abs(py-ry[0])<.001,('Raster/vector projection mismatch',key)
    assert doc['id']==source['id'],key
    assert doc['visited']==source['visited'],key
    assert doc['outline'] and doc['subregions'],key
    image_path=ROOT/doc['image'];assert image_path.exists(),str(image_path)
    with Image.open(image_path) as image:
        assert image.size==(doc['width'],doc['height'])==(1280,1000),key
        assert image.mode=='RGBA' and image.getextrema()[3]==(0,255),key
        assert not image.info.get('exif') and not image.info.get('xmp'),key
    assert doc['light']['azimuth']==315 and doc['light']['elevation']==42,key
    for p in doc['places']:
        assert p['id'].startswith('poi:') or re.fullmatch(r'\d{6}',p['id']), (key,p['id'])
        assert all(math.isfinite(n) for n in p['point']), (key,p)
        assert 0<=p['point'][0]<=1280 and 0<=p['point'][1]<=1000,(key,p)
        assert len(p['lngLat'])==2,(key,p)
        point_count+=1
    if image_path not in files:bytes_total+=image_path.stat().st_size
    files.add(image_path)

def detail(ident):return read(OUT/registry['china:cultural:'+ident]['file'])
def members(ident):return {s['id'] for s in detail(ident)['subregions']}
assert {'MNG','RUS:Tuva'}<=members('CHN:mongolian-steppe')
assert {'NPL','BTN','IND:Ladakh','IND:Sikkim','IND:LahaulSpiti'}<=members('CHN:qingzang')
assert {'TW-KIN','TW-LIE','TW-PEN','TWN:Wuqiu','TWN:Dongsha','TWN:Taiping'}<=members('CHN:taiwan')
assert 'TW-KIN' in members('CHN:min-south')
assert 'TW-LIE' in members('CHN:min-east')
assert 'TWN:Wuqiu' in members('CHN:puxian')
for ident in ('CHN:mongolian-steppe','CHN:qingzang'):
    assert detail(ident)['borders'],ident
frames=detail('CHN:taiwan')['inset_frames']
assert {f['id'] for f in frames}=={'TWN:Dongsha','TWN:Taiping'}
units=read(OUT/'units.json')['units']
assert units['TW-ILA']['bounds'][2]<123, 'Actual-control view must omit the Senkaku/Diaoyu claim'
assert units['TW-KIN']['bounds'][0]<118.16 and units['TW-KIN']['bounds'][1]<24.17, 'Missing Dadan/Erdan or Dongding'
assert units['TW-KEE']['bounds'][3]>25.6, 'Missing Keelung offshore islands'
spec=importlib.util.spec_from_file_location('regional_source',ROOT/'scripts/build-region-terrain.py')
source_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(source_module)
source_regions=source_module.geography()
himalaya=next(r for r in source_regions if r['id']=='CHN:qingzang')
historic_places={
    'IND:Ladakh':[(77.583,34.167),(76.133,34.55),(76.883,33.466)], # Leh, Kargil/Purig, Zanskar
    'IND:LahaulSpiti':[(77.033,32.566),(78.071,32.222)], # Keylong and Kaza
    '542500':[(79.806,31.483),(81.17,30.29),(79.8,33.4)], # Guge, Purang, Rutog
    'BTN':[(89.633,27.467)],'IND:Sikkim':[(88.61,27.33)]}
for ident,points in historic_places.items():
    unit=next(m for m in himalaya['members'] if m['id']==ident)
    assert all(unit['geometry'].covers(Point(*p)) for p in points),('Missing historical Himalayan coverage',ident)
raw_borders=source_module.boundary_lines();visible_borders=source_module.visible_boundary_lines()
hidden=[f for f in raw_borders if source_module.hidden_eastern_sector_border(f)]
assert len(hidden)==1 and len(visible_borders)==len(raw_borders)-1,'Unexpected eastern-sector filter scope'
assert all(not source_module.hidden_eastern_sector_border(f) for f in visible_borders)
assert any({f['properties'].get('ADM0_A3_L'),f['properties'].get('ADM0_A3_R')}=={'CHN','IND'} and source_module.border_kind(f)=='disputed' for f in visible_borders),'Western disputed lines must remain'
for region in source_regions:
    key=f"china:{region['mode']}:{region['id']}"
    doc=read(OUT/registry[key]['file'])
    assert {m['id'] for m in region['members']}=={s['id'] for s in doc['subregions']},key
    if region['id'] in ('CHN:qingzang','540000'):
        assert doc['borders']==source_module.borders_for(doc,region),('Stale eastern-sector border overlay',key)
    coverage=unary_union([m['geometry'] for m in region['members']])
    for p in doc['places']:
        assert coverage.covers(Point(*p['lngLat'])),('Anchor outside source geography',key,p['id'])
        frame=next((f for f in doc.get('inset_frames',[]) if next(m['geometry'] for m in region['members'] if m['id']==f['id']).covers(Point(*p['lngLat']))),None)
        space=frame or doc
        x0,y0,x1,y1=space['extent_m'];x,y=Transformer.from_crs('EPSG:4326',space['projection'],always_xy=True).transform(*p['lngLat'])
        expected_x=(x-x0)/(x1-x0)*space['width']+space.get('x',0)
        expected_y=(y1-y)/(y1-y0)*space['height']+space.get('y',0)
        assert abs(expected_x-p['point'][0])<=.06 and abs(expected_y-p['point'][1])<=.06,(key,p['id'])
print(f'Regional terrain validated: {len(expected)} entries, {len(files)} images, {bytes_total:,} image bytes, {point_count} true geographic anchors. Explicit cross-border and island scopes passed.')
