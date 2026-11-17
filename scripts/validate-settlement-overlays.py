"""Validate atlas coverage, real geographic anchors, limits and GHSL controls."""
import hashlib,json,re
from pathlib import Path
import rasterio
from pyproj import Transformer
ROOT=Path(__file__).resolve().parents[1]
def read(path):return json.loads(path.read_text(encoding='utf-8'))
manifest=read(ROOT/'assets/maps/settlements/manifest.json')
provenance=read(ROOT/'tools/relief-atlas/settlements/provenance.json')
mask=ROOT/'tools/relief-atlas/settlements/ghsl-2020-builtup-5pct.tif'
assert hashlib.sha256(mask.read_bytes()).hexdigest()==provenance['mask_sha256']
assert manifest['note']['zh-CN'] and '1' in manifest['note']['en']
checks=0;empty=0
def check_view(data):
    global checks,empty
    w,h=data['width'],data['height'];assert w>0 and h>0
    if not data['paths']:empty+=1
    for path in data['paths']:
        assert path and re.fullmatch(r'[MLZ0-9.,\-]+',path)
        points=re.findall(r'(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)',path)
        for x,y in points:
            assert -.11<=float(x)<=w+.11,(x,w)
            assert -.11<=float(y)<=h+.11,(y,h)
        checks+=1
    for part in data.get('meshOverlays',{}).values():check_view(part)
    for part in data.get('insets',[]):check_view(part)
def entries(kind):
    for source in (ROOT/'assets/maps'/kind).glob('*.json'):
        d=read(source)
        if not isinstance(d,dict):continue
        if kind=='regions' and not all(k in d for k in ['id','projection','extent_m','outline']):continue
        if kind=='administrative' and not isinstance(d.get('views'),dict):continue
        yield source,d
total={}
for kind in ['regions','administrative']:
    total[kind]=0
    for source,record in entries(kind):
        assert record['id'] in manifest[kind],f'Missing {kind}: {source.name}'
        overlay=read(ROOT/manifest[kind][record['id']]['file'])
        assert overlay['id']==record['id']
        assert overlay['version']==manifest['version'],f'Stale geometry build: {source.name}'
        if kind=='regions':
            check_view(overlay)
            for city in overlay.get('visitedCities',[]):
                assert len(city['lngLat'])==2 and len(city['point'])==2
                assert 0<=city['point'][0]<=overlay['width'] and 0<=city['point'][1]<=overlay['height']
                assert city['id']==city['unitId']
        else:
            for key,view in record['views'].items():
                check_view(overlay['views'][key])
                for inset in view.get('insets',[]):
                    assert inset['mesh']['file'] in overlay['views'][key]['meshOverlays'],f'Missing island mask {inset["id"]}'
        total[kind]+=1
# Rounded self-touching outlines once silently lost the Wuyue mainland while
# retaining its islands. These independent city anchors guard that regression.
wuyue=read(ROOT/manifest['regions']['CHN:wuyue']['file'])
assert {'310000','320500','330100'}.issubset({c['id'] for c in wuyue['visitedCities']})
assert wuyue['mappedAreaPixels']>50000,'Yangtze delta built-up mask lost its mainland'
checks+=2
# Independent geographic controls: globally separated urban cores and remote
# ice/desert must agree with the archived satellite-derived source mask.
forward=Transformer.from_crs('EPSG:4326','ESRI:54009',always_xy=True)
controls=[('Beijing',116.40,39.91,1),('Shanghai',121.47,31.23,1),('Tokyo',139.75,35.68,1),('London',-.12,51.50,1),('Paris',2.35,48.86,1),('New York',-73.99,40.75,1),('Singapore',103.85,1.30,1),('Greenland ice',-40,75,0),('Sahara desert',10,25,0)]
with rasterio.open(mask) as src:
    for name,lon,lat,expected in controls:
        value=int(next(src.sample([forward.transform(lon,lat)]))[0]);assert value==expected,(name,value,expected)
        checks+=1
print(f'Settlement validation passed: {total}, {checks} geometry/control checks, {empty} explicitly empty view/part masks.')
