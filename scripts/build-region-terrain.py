"""Build isolated warm-plaster regional relief plates and hit geometry.

python scripts/build-region-terrain.py [--inventory-only] [--only CHN:wuyue]
Requires numpy, Pillow, scipy, shapely, rasterio, pyproj and requests.
Source geometry is archived in the repository. Elevation tiles are
cached in .render-work/region-sources; only per-region assets ship to browsers.
"""
from __future__ import annotations
import argparse, concurrent.futures, gzip, hashlib, json, math, re, time
from pathlib import Path
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from shapely import make_valid, prepare
from shapely.geometry import shape, box, Polygon, Point
from shapely.ops import unary_union, transform
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling, transform as raster_transform
import requests
import geopandas as gpd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/maps/regions'
CACHE = ROOT / '.render-work/region-sources'
TILE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
MATERIAL = {'style':'warm-plaster','base_color':'#eeeae0','surface_texture':None}
EASTERN_SECTOR = (90,26,99,31)
Image.MAX_IMAGE_PIXELS = 400_000_000

def read(p): return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def write(p, d):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
def label(en, cn=None, tw=None): return {'en':en, 'zh-CN':cn or en, 'zh-TW':tw or cn or en}
def polygonal(geometry):
    if geometry.geom_type in ('Polygon','MultiPolygon'):return geometry
    if hasattr(geometry,'geoms'):return unary_union([polygonal(g) for g in geometry.geoms if g.geom_type not in ('LineString','MultiLineString','Point','MultiPoint')])
    return Polygon()
def download(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(4):
            try:
                response = requests.get(url, timeout=180); response.raise_for_status()
                path.write_bytes(response.content)
                break
            except requests.RequestException:
                if attempt==3:raise
                time.sleep(attempt+1)
    return path
def boundary_lines():
    filename=CACHE/'international-borders.geojson'
    download('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_boundary_lines_land.geojson',filename)
    return read(filename)['features']

def border_kind(feature):
    classification=feature['properties'].get('FEATURECLA',feature['properties'].get('featurecla',''))
    return 'international' if classification.startswith('International') else 'disputed'

def hidden_eastern_sector_border(feature):
    """Omit only the requested China/India eastern-sector undetermined line.

    This is a display rule, not a change to the archived source or sovereignty.
    The Sikkim sector and western Ladakh lines, and Nepal/Bhutan borders remain.
    """
    p=feature['properties']
    countries={p.get('ADM0_A3_L'),p.get('ADM0_A3_R')}
    return countries=={'CHN','IND'} and border_kind(feature)=='disputed' and box(*EASTERN_SECTOR).covers(shape(feature['geometry']))

def visible_boundary_lines():
    return [f for f in boundary_lines() if not hidden_eastern_sector_border(f)]

def lahaul_spiti_unit():
    """Real valley-district geometry, used as a cultural-guide approximation.

    The historic kingdom's extent is not the modern Ladakh admin-1 polygon:
    Spiti belonged to it, and Lahaul had periods of Ladakhi rule. Western Tibet
    (Guge/Purang/Rutog) is already covered by the Chinese Ngari member.
    """
    archive=ROOT/'tools/relief-atlas/regions/lahaul-spiti-geoboundaries.geojson.gz'
    feature=next(f for f in read_gzip(archive)['features'] if f['properties']['shapeID']=='76128533B75359793481950')
    return {'id':'IND:LahaulSpiti','name':'Lahaul and Spiti','label':label('Lahaul and Spiti','拉豪尔与斯皮提','拉豪爾與斯皮提'),'country':'IND','geometry':polygonal(make_valid(shape(feature['geometry'])))}

def taiwan_units():
    """Official NLSC county coastlines, filtered to the requested actual control.

    The source also contains the Senkaku/Diaoyu claim in Yilan. It is explicitly
    excluded: the detail represents actual administration rather than claims.
    """
    source=ROOT/'tools/relief-atlas/regions/taiwan-nlsc.zip'
    download('https://maps.nlsc.gov.tw/download/縣市界線(TWD97經緯度).zip',source)
    frame=gpd.read_file(source).to_crs('EPSG:4326')
    ids={'A':'TPE','B':'TXG','C':'KEE','D':'TNN','E':'KHH','F':'NWT','G':'ILA','H':'TAO','I':'CYI','J':'HSQ','K':'MIA','M':'NAN','N':'CHA','O':'HSZ','P':'YUN','Q':'CYQ','T':'PIF','U':'HUA','V':'TTT','W':'KIN','X':'PEN','Z':'LIE'}
    result=[]
    for _,r in frame.iterrows():
        ident='TW-'+ids[r['COUNTYID']];g=polygonal(make_valid(r['geometry']))
        if ident=='TW-ILA':g=g.intersection(box(119,21,123,26))
        if ident=='TW-KIN':
            wuqiu=g.intersection(box(119.4,24.9,119.6,25.1));g=g.difference(box(119.4,24.9,119.6,25.1))
            result.append({'id':'TWN:Wuqiu','name':'Wuqiu','label':label('Wuqiu','乌坵','烏坵'),'geometry':wuqiu,'country':'TWN'})
        if ident=='TW-KHH':
            for name,cn,tw,bbox in [('Dongsha','东沙','東沙',(116,20,117,21.5)),('Taiping','太平岛','太平島',(114,10,115,11))]:
                part=g.intersection(box(*bbox));g=g.difference(box(*bbox))
                result.append({'id':'TWN:'+name,'name':name,'label':label(name,cn,tw),'geometry':part,'country':'TWN','inset':True})
        result.append({'id':ident,'name':r['COUNTYENG'],'label':label(r['COUNTYENG'],r['COUNTYNAME'],r['COUNTYNAME']),'geometry':g,'country':'TWN'})
    return result

def geography():
    atlas=read(ROOT/'assets/maps/relief/atlas.json')['maps']
    provinces={str(f['properties']['adcode']): {**f['properties'], 'id':str(f['properties']['adcode']), 'geometry':make_valid(shape(f['geometry']))}
               for f in read(ROOT/'assets/maps/china_100000_full.json')['features'] if f['properties'].get('adcode')}
    cities={}
    for f in read(ROOT/'assets/maps/china_city_full.json')['features']:
        p=f['properties']; parent=p.get('parent',{}).get('adcode')
        if p.get('level')=='city':
            cities[str(p['adcode'])]={**p,'id':str(p['adcode']),'geometry':make_valid(shape(f['geometry']))}
        elif p.get('level')=='district' and parent in (110000,120000,310000,500000):
            cities[str(parent)]=provinces[str(parent)]
    # Source atlas supplies authoritative display translations and visits.
    for r in atlas['china']['regions']:
        if r['id'] in cities: cities[r['id']].update({k:v for k,v in r.items() if k not in ('path','boundary_path','center','geometry')})
    ne=read_gzip(ROOT/'tools/relief-atlas/footprints/administrative-20261016/cache/ne_10m_admin_1_states_provinces.geojson.gz')['features']
    ne=[{**f['properties'],'geometry':make_valid(shape(f['geometry']))} for f in ne]
    taiwan=taiwan_units()
    regions=[]
    tw_by={r['id']:r for r in taiwan}
    for r in atlas['china']['cultural']['regions']:
        members=[cities.get(str(i),provinces.get(str(i))) for i in r['members']]
        members=[dict(m, country='CHN') for m in members if m]
        if r['id']=='CHN:mongolian-steppe':
            members += [{'id':'MNG','name':'Mongolia','label':label('Mongolia','蒙古国','蒙古國'),'country':'MNG','geometry':unary_union([n['geometry'] for n in ne if n['adm0_a3']=='MNG'])},
                        {'id':'RUS:Tuva','name':'Tuva','label':label('Tuva','图瓦','圖瓦'),'country':'RUS','geometry':next(n['geometry'] for n in ne if n['adm0_a3']=='RUS' and n['name']=='Tuva')}]
        if r['id']=='CHN:qingzang':
            members += [{'id':'NPL','name':'Nepal','label':label('Nepal','尼泊尔','尼泊爾'),'country':'NPL','geometry':unary_union([n['geometry'] for n in ne if n['adm0_a3']=='NPL'])}]
            members += [{'id':'BTN','name':'Bhutan','label':label('Bhutan','不丹'),'country':'BTN','geometry':unary_union([n['geometry'] for n in ne if n['adm0_a3']=='BTN'])},lahaul_spiti_unit()]
            for name,cn in [('Ladakh','拉达克'),('Sikkim','锡金')]:
                members.append({'id':'IND:'+name,'name':name,'label':label(name,cn,'拉達克' if name=='Ladakh' else '錫金'),'country':'IND','geometry':next(n['geometry'] for n in ne if n['adm0_a3']=='IND' and n['name']==name)})
        if r['id']=='CHN:taiwan': members=taiwan
        if r['id']=='CHN:min-south':members += [tw_by['TW-KIN']]
        if r['id']=='CHN:min-east':members += [tw_by['TW-LIE']]
        if r['id']=='CHN:puxian':members += [tw_by['TWN:Wuqiu']]
        regions.append({'id':r['id'],'mode':'cultural','title':r['label'],'visited':r['visited'],'members':members,'description':label(r.get('basis',''),r.get('basis',''))})
    for r in atlas['china']['overview']['regions']:
        if r['id']=='710000':members=taiwan
        else:
            members=[dict(c,country='CHN') for c in cities.values() if str(c.get('province',c.get('parent',{}).get('adcode')))==r['id'] or c['id']==r['id']]
            if not members and r['id'] in provinces:members=[dict(provinces[r['id']],country='CHN')]
            if r['id']=='350000':members += [tw_by['TW-KIN'],tw_by['TW-LIE'],tw_by['TWN:Wuqiu']]
        if members:regions.append({'id':r['id'],'mode':'overview','title':r.get('label') or label(r['name']),'visited':r['visited'],'members':members})
    for r in atlas['china']['regions']:
        if r.get('visited') and r['id'] in cities:
            regions.append({'id':r['id'],'mode':'detail','title':r.get('label') or label(r['name']),'visited':True,'members':[dict(cities[r['id']],country='CHN')]})
    for r in regions:
        for m in r['members']:m['geometry']=polygonal(m['geometry'])
        r['members']=[m for m in r['members'] if not m['geometry'].is_empty]
    return regions

def read_gzip(p):return json.loads(gzip.decompress(p.read_bytes()))
def slug(r):return r['mode']+'-'+r['id'].lower().replace(':','-')
def path(geometry):
    if geometry.is_empty:return ''
    if geometry.geom_type=='Polygon':
        return ''.join('M'+'L'.join(f'{x:.1f},{y:.1f}' for x,y in ring.coords)+'Z' for ring in [geometry.exterior,*geometry.interiors])
    if geometry.geom_type in ('LineString','LinearRing'):return 'M'+'L'.join(f'{x:.1f},{y:.1f}' for x,y in geometry.coords)
    return ''.join(path(g) for g in geometry.geoms)

def dem(bounds, crs, extent, width, height):
    west,south,east,north=bounds
    # A view receives genuine new DEM samples at roughly its display resolution.
    zoom=min(12,max(6,math.ceil(math.log2(360/max(east-west,(north-south)*1.25)))+2))
    def tilexy(lon,lat):return (lon+180)/360*2**zoom,(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**zoom
    left,top=map(math.floor,tilexy(west,north));right,bottom=map(math.floor,tilexy(east,south))
    tiles=[(x,y) for y in range(top,bottom+1) for x in range(left,right+1)]
    mosaic=np.zeros(((bottom-top+1)*256,(right-left+1)*256),dtype=np.float32)
    def tile_fetch(xy):
        x,y=xy; filename=CACHE/f'terrarium/{zoom}/{x}/{y}.png'
        download(f'{TILE}/{zoom}/{x}/{y}.png',filename)
        a=np.asarray(Image.open(filename).convert('RGB'),dtype=np.float32)
        return x,y,a[:,:,0]*256+a[:,:,1]+a[:,:,2]/256-32768
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for x,y,a in pool.map(tile_fetch,tiles):mosaic[(y-top)*256:(y-top+1)*256,(x-left)*256:(x-left+1)*256]=a
    half=20037508.342789244;step=2*half/2**zoom
    source_extent=(-half+left*step,half-(bottom+1)*step,-half+(right+1)*step,half-top*step)
    elevation=np.zeros((height,width),dtype=np.float32)
    reproject(mosaic,elevation,src_transform=from_bounds(*source_extent,mosaic.shape[1],mosaic.shape[0]),src_crs='EPSG:3857',dst_transform=from_bounds(*extent,width,height),dst_crs=crs,resampling=Resampling.bilinear,num_threads=2)
    return elevation,zoom

def plate(members, width=1280, height=1000):
    outline=polygonal(make_valid(unary_union([m['geometry'] for m in members])))
    west,south,east,north=outline.bounds
    # Explicit sphere avoids PROJ-version differences in ellipsoidal eqc:
    # geometry (pyproj) and raster warping (GDAL) must use identical metres.
    crs=f'+proj=eqc +lat_ts={(south+north)/2} +lon_0={(west+east)/2} +R=6378137 +units=m +no_defs'
    forward=Transformer.from_crs('EPSG:4326',crs,always_xy=True)
    test_lon,test_lat=(west+east)/2,(south+north)/2
    gx,gy=raster_transform('EPSG:4326',crs,[test_lon],[test_lat])
    px,py=forward.transform(test_lon,test_lat)
    assert abs(gx[0]-px)<.001 and abs(gy[0]-py)<.001,'Raster/vector CRS mismatch'
    projected=transform(forward.transform,outline)
    x0,y0,x1,y1=projected.bounds; scale=max((x1-x0)/(width-110),(y1-y0)/(height-110))
    cx,cy=(x0+x1)/2,(y0+y1)/2
    extent=(cx-width*scale/2,cy-height*scale/2,cx+width*scale/2,cy+height*scale/2)
    def pixels(lon,lat,z=None):
        x,y=forward.transform(lon,lat)
        return (np.asarray(x)-extent[0])/scale,(extent[3]-np.asarray(y))/scale
    pixel_outline=transform(pixels,outline)
    mask=rasterize([(pixel_outline,1)],out_shape=(height,width),fill=0,dtype='uint8').astype(bool)
    elevation,zoom=dem((west-.01,south-.01,east+.01,north+.01),crs,extent,width,height)
    elevation=np.maximum(elevation,0)
    exaggeration=2.8
    gy,gx=np.gradient(gaussian_filter(elevation,.7)*exaggeration,scale)
    normal=np.sqrt(gx*gx+gy*gy+1)
    sun_el=math.radians(42); az=math.radians(315)
    diffuse=(-gx*math.sin(az)*math.cos(sun_el)+gy*math.cos(az)*math.cos(sun_el)+math.sin(sun_el))/normal
    # Horizon occlusion is recomputed with only the displayed region present.
    z=np.where(mask,elevation*exaggeration,-100000); occlusion=np.zeros_like(z)
    for distance in (1,2,3,5,8,12,18,26,38):
        shifted=np.full_like(z,-100000)
        shifted[distance:,distance:]=z[:-distance,:-distance]
        slope=(shifted-z)/(distance*scale*math.sqrt(2))
        occlusion=np.maximum(occlusion,slope)
    shadow=np.clip((occlusion-math.tan(sun_el))*.35,0,.48)
    # A single matte plaster pigment; only DEM normals and independent terrain
    # occlusion modulate it. No satellite imagery or land-cover tint is sampled.
    # Keep the brightest slope at the pigment value rather than clipping white.
    shading=np.clip(.74+.26*np.clip(diffuse,0,1)-shadow*.6,.35,1.0)
    pigment=np.array([int(MATERIAL['base_color'][i:i+2],16) for i in (1,3,5)],dtype=np.float32)/255
    colour=pigment[None,None,:]*shading[:,:,None]
    rgba=np.dstack([(colour*255).astype(np.uint8),mask.astype(np.uint8)*255])
    image=Image.fromarray(rgba,'RGBA')
    subregions=[]
    for m in members:
        pg=transform(pixels,m['geometry']); c=pg.representative_point()
        subregions.append({'id':m['id'],'name':m.get('name',m['id']),'label':m.get('label') or label(m.get('name',m['id'])),'path':path(pg.simplify(.55,preserve_topology=True)),'center':[round(c.x,1),round(c.y,1)],'visited':m.get('visited',False),'country':m.get('country','CHN')})
    borders=[]
    border_clip=outline.simplify(.00008,preserve_topology=True).buffer(.02)
    for feature in visible_boundary_lines():
        line=shape(feature['geometry'])
        if not line.intersects(outline):continue
        line=line.intersection(border_clip)
        if not line.is_empty:
            borders.append({'kind':border_kind(feature),'path':path(transform(pixels,line).simplify(.6))})
    return image,{'outline':path(pixel_outline.simplify(.55,preserve_topology=True)),'subregions':subregions,'borders':borders,'projection':crs,'extent_m':list(extent),'dem_zoom':zoom,'light':{'azimuth':315,'elevation':42,'vertical_exaggeration':exaggeration}},pixels

def build(region):
    name=slug(region);normal=[m for m in region['members'] if not m.get('inset')];insets=[m for m in region['members'] if m.get('inset')]
    image,data,pixels=plate(normal)
    frames=[]
    for i,m in enumerate(insets):
        small,sd,sp=plate([m],280,220);x,y=980,690+i*145
        small=small.resize((260,140),Image.Resampling.LANCZOS)
        image.alpha_composite(small,(x,y))
        def tr(xp,yp,z=None):return np.asarray(xp)*260/280+x,np.asarray(yp)*140/220+y
        # Preserve island geometry, its coordinates merely move into labelled insets.
        pg=transform(tr,transform(sp,m['geometry']));c=pg.representative_point()
        data['subregions'].append({'id':m['id'],'name':m['name'],'label':m['label'],'path':path(pg.simplify(.3)),'center':[round(c.x,1),round(c.y,1)],'country':'TWN','inset':True})
        data['outline']+=path(pg.simplify(.3))
        frames.append({'id':m['id'],'x':x,'y':y,'width':260,'height':140,'title':m['label'],'projection':sd['projection'],'extent_m':sd['extent_m']})
    image.save(OUT/f'{name}.webp','WEBP',quality=87,method=6)
    document={'id':region['id'],'mode':region['mode'],'title':region['title'],'visited':region['visited'],'description':region.get('description',{}),'image':f'assets/maps/regions/{name}.webp','width':1280,'height':1000,'inset_frames':frames,**data}
    document['places']=places_for(document,region)
    write(OUT/f'{name}.json',document)
    print(name,len(data['subregions']),'subregions',len(document['places']),'places',flush=True)
    return document

def places_for(document, region):
    places=[]
    # Content provides true geographic anchor locations, never polygon centroids
    # disguised as cities or sights. Coordinates remain explicit in the output.
    place_source=read(OUT/'places.json') if (OUT/'places.json').exists() else []
    if isinstance(place_source,list):place_source={p['id']:p for p in place_source}
    whole=unary_union([m['geometry'] for m in region['members']])
    # Prepare once outside the point loop. Use the actual source footprint;
    # nearby sites outside it must not receive an off-region photo leader.
    prepare(whole)
    forward=Transformer.from_crs('EPSG:4326',document['projection'],always_xy=True)
    x0,y0,x1,y1=document['extent_m']
    def pixels(lon,lat):
        x,y=forward.transform(lon,lat)
        return (x-x0)/(x1-x0)*document['width'],(y1-y)/(y1-y0)*document['height']
    for ident,p in place_source.items():
        # Leader lines anchor cities or actual sights, never a country's or
        # cultural area's cartographic representative point.
        if not (ident.startswith('poi:') or re.fullmatch(r'\d{6}',ident)):continue
        if ident.startswith('CHN:'):continue
        if re.fullmatch(r'\d{2}0000',ident) and ident not in ('110000','120000','310000','500000','810000','820000'):continue
        coords=p.get('lngLat') or p.get('coordinates') or p.get('location')
        if not coords or not isinstance(coords,list) or len(coords)!=2:continue
        if whole.covers(Point(*coords)):
            xy=pixels(*coords)
            for frame in document.get('inset_frames',[]):
                member=next((m for m in region['members'] if m['id']==frame.get('id')),None)
                if member and member['geometry'].buffer(.002).covers(Point(*coords)):
                    transform_inset=Transformer.from_crs('EPSG:4326',frame['projection'],always_xy=True)
                    ix,iy=transform_inset.transform(*coords);ix0,iy0,ix1,iy1=frame['extent_m']
                    xy=(frame['x']+(ix-ix0)/(ix1-ix0)*frame['width'],frame['y']+(iy1-iy)/(iy1-iy0)*frame['height'])
            places.append({'id':ident,'title':p.get('title',p.get('label',p.get('name',ident))),'point':[round(float(xy[0]),1),round(float(xy[1]),1)],'lngLat':coords})
    # Prioritise actual sights for a city; larger plates prioritise visited cities.
    places.sort(key=lambda p:(not p['id'].startswith('poi:') if region['mode']=='detail' else p['id'] not in {m['id'] for m in region['members'] if m.get('visited')},p['id']))
    return places

def borders_for(document,region):
    forward=Transformer.from_crs('EPSG:4326',document['projection'],always_xy=True)
    x0,y0,x1,y1=document['extent_m']
    def pixels(lon,lat,z=None):
        x,y=forward.transform(lon,lat)
        return (np.asarray(x)-x0)/(x1-x0)*document['width'],(y1-np.asarray(y))/(y1-y0)*document['height']
    outline=unary_union([m['geometry'] for m in region['members'] if not m.get('inset')]).simplify(.00008,preserve_topology=True)
    clipped=outline.buffer(.02);result=[]
    for f in visible_boundary_lines():
        g=shape(f['geometry'])
        if not g.intersects(outline):continue
        g=g.intersection(clipped)
        if not g.is_empty:result.append({'kind':border_kind(f),'path':path(transform(pixels,g).simplify(.6))})
    return result

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--only');parser.add_argument('--inventory-only',action='store_true');parser.add_argument('--refresh-content',action='store_true');parser.add_argument('--skip-existing',action='store_true');args=parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True);CACHE.mkdir(parents=True,exist_ok=True)
    regions=geography()
    inventory={}
    for r in regions:
        for m in r['members']:
            p=m['geometry'].representative_point()
            inventory[m['id']]={'id':m['id'],'name':m.get('name',m['id']),'label':m.get('label'), 'bounds':list(m['geometry'].bounds),'representativePoint':[p.x,p.y]}
    write(OUT/'units.json',{'regions':[{'id':r['id'],'title':r['title'],'members':[m['id'] for m in r['members']]} for r in regions],'units':inventory})
    if args.inventory_only:return
    index={}
    for r in regions:
        key=f"china:{r['mode']}:{r['id']}";name=slug(r)
        index[key]={'file':name+'.json','title':r['title'],'visited':r['visited']}
        index[f"east_asia:{'overview' if r['mode']=='cultural' else r['mode']}:{r['id']}"]=index[key]
        if args.only and r['id'] not in args.only.split(','):continue
        if args.refresh_content:
            file=OUT/f'{name}.json'
            if file.exists():
                document=read(file);document['places']=places_for(document,r);document['borders']=borders_for(document,r);write(file,document)
            continue
        if args.skip_existing and (OUT/f'{name}.json').exists():continue
        build(r)
    credits=[
        {'name':'AWS Terrain Tiles','url':'https://registry.opendata.aws/terrain-tiles/'},
        {'name':'Natural Earth','url':'https://www.naturalearthdata.com/'},
        {'name':'geoBoundaries / Pathways Data — Lahaul and Spiti district (2021), ODbL 1.0','url':'https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/'},
        {'name':'National Land Surveying and Mapping Center — county boundaries','url':'https://maps.nlsc.gov.tw/pro/download.jsp'}]
    boundary_display={'omit':'China–India disputed eastern-sector line','sector_bounds':list(EASTERN_SECTOR),'preserve':'Other international and disputed lines; raw source unchanged'}
    write(OUT/'manifest.json',{'version':'20261116-himalayan-scope','material':MATERIAL,'regions':index,'credits':credits,'boundary_display':boundary_display})
    archive=ROOT/'tools/relief-atlas/regions';archive.mkdir(parents=True,exist_ok=True)
    if (CACHE/'international-borders.geojson').exists():
        (archive/'international-borders.geojson.gz').write_bytes(gzip.compress((CACHE/'international-borders.geojson').read_bytes(),mtime=0))
    provenance={'generated':'2026-11-16','material':MATERIAL,'elevation':{'url':TILE+'/{z}/{x}/{y}.png','zooms':[6,12]},'boundary_display':boundary_display,'sources':{}}
    for source in [archive/'taiwan-nlsc.zip',archive/'international-borders.geojson.gz',archive/'lahaul-spiti-geoboundaries.geojson.gz',archive/'lahaul-spiti-geoboundaries-metadata.json']:
        if source.exists():provenance['sources'][source.name]={'bytes':source.stat().st_size,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
    write(archive/'provenance.json',provenance)

if __name__=='__main__':main()
