"""Project real GHSL built-up footprints into every atlas view.

The derived, lossless 1 km threshold mask is archived in tools/relief-atlas/
settlements, so all website assets can be rebuilt offline. Use --prepare-source
to download the official raster and recreate that mask. It denotes cells with
at least 5% building coverage in 2020, not administrative/planning boundaries.
Requires numpy, rasterio, pyproj, shapely. No terrain rebake is required.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, re, urllib.request, zipfile
from pathlib import Path
import numpy as np
import rasterio
from rasterio.features import shapes
from rasterio.windows import from_bounds, Window
from pyproj import Transformer
from shapely import build_area, make_valid
from shapely.geometry import shape, box, Polygon, Point
from shapely.ops import transform, unary_union

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/maps/settlements'
ARCHIVE=ROOT/'tools/relief-atlas/settlements'
CACHE=ROOT/'.render-work/settlement-sources'
NAME='GHS_BUILT_S_E2020_GLOBE_R2023A_54009_1000_V1_0'
SOURCE='https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_S_GLOBE_R2023A/GHS_BUILT_S_E2020_GLOBE_R2023A_54009_1000/V1-0/'+NAME+'.zip'
MASK=ARCHIVE/'ghsl-2020-builtup-5pct.tif'
THRESHOLD=50_000
VERSION='20261117-ghsl2020-v2'
NOTE={'en':'Built-up reference: GHSL 2020, 1 km cells with at least 5% building coverage. This generalized satellite-derived extent is not a planning or administrative boundary; small or sparse settlements may be absent.', 'zh-CN':'建成区参考：GHSL 2020，1 公里网格内建筑覆盖率至少 5%。这是遥感数据概化范围，不是规划或行政边界；小型、稀疏聚落可能未显示。', 'zh-TW':'建成區參考：GHSL 2020，1 公里網格內建築覆蓋率至少 5%。這是遙感資料概化範圍，不是規劃或行政邊界；小型、稀疏聚落可能未顯示。'}

def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))
def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')

def compact(data,primary_mesh=None):
    """Share the main 2D mask with the 3D shader and limit SVG DOM nodes."""
    if 'paths' in data:
        chunks=[]
        for path in data['paths']:
            path=re.sub(r'-?\d+\.\d+',lambda m:f'{float(m[0]):.1f}',path)
            if not chunks or len(chunks[-1])+len(path)>24000:chunks.append(path)
            else:chunks[-1]+=path
        data['paths']=chunks
    if primary_mesh:data.get('meshOverlays',{}).pop(primary_mesh,None)
    for overlay in data.get('meshOverlays',{}).values():compact(overlay)
    for inset in data.get('insets',[]):compact(inset)
    return data

def prepare_source():
    CACHE.mkdir(parents=True,exist_ok=True);ARCHIVE.mkdir(parents=True,exist_ok=True)
    tif=CACHE/(NAME+'.tif');archive=CACHE/(NAME+'.zip')
    if not tif.exists():
        if not archive.exists():urllib.request.urlretrieve(SOURCE,archive)
        with zipfile.ZipFile(archive) as z:
            with z.open(NAME+'.tif') as incoming,tif.open('wb') as outgoing:
                while block:=incoming.read(1024*1024):outgoing.write(block)
    with rasterio.open(tif) as src:
        profile=src.profile.copy();profile.update(dtype='uint8',nodata=0,compress='deflate',predictor=1,tiled=True,blockxsize=512,blockysize=512)
        with rasterio.open(MASK,'w',**profile) as dst:
            for _,window in dst.block_windows(1):
                values=src.read(1,window=window)
                dst.write(((values>=THRESHOLD)&(values!=src.nodata)).astype('uint8'),1,window=window)
    write(ARCHIVE/'provenance.json',{'source':SOURCE,'sourcePage':'https://human-settlement.emergency.copernicus.eu/ghs_buS2023.php','doi':'10.2905/9F06F36F-4B11-47EC-ABB0-4F8B7B1D72EA','citation':'Pesaresi M., Politis P. (2023), GHS-BUILT-S R2023A, European Commission Joint Research Centre','epoch':2020,'resolution_m':1000,'crs':'ESRI:54009','threshold_m2':THRESHOLD,'threshold_fraction':0.05,'source_tif_sha256':hashlib.sha256(tif.read_bytes()).hexdigest(),'mask_sha256':hashlib.sha256(MASK.read_bytes()).hexdigest(),'definition':'Binary cell selection: 2020 building-covered surface >= 50000 square metres per 1000000-square-metre cell. Residential and non-residential buildings included. No smoothing or invented expansion.','limitations':'Generalized satellite-derived reference, not a legal urban boundary or individual building footprints. Small/sparse settlements may not meet the threshold. 2020 values are modelled from the multitemporal GHSL series.'})
    with urllib.request.urlopen(SOURCE.rsplit('/',1)[0]+'/copyright.txt') as response:
        notice=response.read().decode('utf-8')
    (ARCHIVE/'copyright.txt').write_text('\n'.join(line.rstrip() for line in notice.splitlines()).rstrip()+'\n',encoding='utf-8')
    print('Prepared archived built-up mask:',MASK.stat().st_size,flush=True)

def outline_geometry(d):
    rings=[]
    for ring in re.findall(r'M([^MZ]+)Z',d or ''):
        coords=[tuple(map(float,p.split(','))) for p in ring.split('L')]
        if len(coords)>2:rings.append(coords+[coords[0]] if coords[-1]!=coords[0] else coords)
    # SVG rounding can make an otherwise valid mainland ring self-touch.
    # build_area(raw lines) may silently drop that entire mainland. Repair each
    # ring as an area first, then node its valid boundaries before reconstructing
    # holes. Filling a union of raw rings would incorrectly fill lake holes.
    boundaries=[]
    def collect(geometry):
        if geometry.geom_type=='Polygon':boundaries.append(geometry.boundary)
        else:
            for part in getattr(geometry,'geoms',[]):collect(part)
    for coords in rings:collect(make_valid(Polygon(coords)))
    return make_valid(build_area(unary_union(boundaries))) if boundaries else None

def svg_path(geom):
    if geom.is_empty:return ''
    if geom.geom_type=='Polygon':
        return ''.join('M'+'L'.join(f'{x:.1f},{y:.1f}' for x,y in ring.coords)+'Z' for ring in [geom.exterior,*geom.interiors])
    return ''.join(svg_path(part) for part in getattr(geom,'geoms',[]))

def project_view(view):
    width,height=view.get('width',1280),view.get('height',1000)
    x0,y0,x1,y1=view['extent_m']
    forward=Transformer.from_crs('ESRI:54009',view['projection'],always_xy=True)
    inverse=Transformer.from_crs(view['projection'],'ESRI:54009',always_xy=True)
    # Densified boundary prevents clipping a curved projected source window.
    xs=np.linspace(x0,x1,65);ys=np.linspace(y0,y1,65)
    bx=np.concatenate([xs,xs,np.full(65,x0),np.full(65,x1)])
    by=np.concatenate([np.full(65,y0),np.full(65,y1),ys,ys])
    gx,gy=inverse.transform(bx,by)
    gx=np.asarray(gx);gy=np.asarray(gy)
    valid=np.isfinite(gx)&np.isfinite(gy)
    with rasterio.open(MASK) as src:
        window=from_bounds(gx[valid].min()-2000,gy[valid].min()-2000,gx[valid].max()+2000,gy[valid].max()+2000,src.transform).round_offsets().round_lengths()
        window=window.intersection(Window(0,0,src.width,src.height))
        values=src.read(1,window=window)
        source_transform=src.window_transform(window)
    clip=outline_geometry(view.get('outline'))
    if clip is None:clip=box(0,0,width,height)
    def pixels(x,y,z=None):
        px,py=forward.transform(x,y)
        return (np.asarray(px)-x0)/(x1-x0)*width,(y1-np.asarray(py))/(y1-y0)*height
    paths=[];area=0
    for geom,value in shapes(values,mask=values.astype(bool),transform=source_transform):
        if not value:continue
        projected=transform(pixels,shape(geom))
        if not projected.intersects(clip):continue
        clipped=make_valid(projected).intersection(clip).simplify(.18,preserve_topology=True)
        if clipped.is_empty or clipped.area<.015:continue
        path=svg_path(clipped)
        if path:paths.append(path);area+=clipped.area
    chunks=[]
    for path in paths:
        if not chunks or len(chunks[-1])+len(path)>24000:chunks.append(path)
        else:chunks[-1]+=path
    return {'paths':chunks,'polygonCount':len(paths),'width':width,'height':height,'mappedAreaPixels':round(area,2)}

def visited_places():
    content=read(ROOT/'site_content.json')['life']['footprints']
    names=set(content.get('visited_china',[]))
    units=read(ROOT/'assets/maps/regions/units.json')['units']
    places={p['id']:p for p in read(ROOT/'assets/maps/regions/places.json')}
    result=[]
    for ident,unit in units.items():
        if unit.get('name') not in names:continue
        place=places.get(ident)
        if place and place.get('lngLat'):
            result.append({'id':ident,'unitId':ident,'label':place.get('label') or unit.get('label') or unit['name'],'lngLat':place['lngLat']})
    # Overseas records must be explicit city visits; country/region visits are
    # deliberately never converted to invented city visits.
    return result

def region_markers(doc,cities):
    clip=outline_geometry(doc.get('outline'))
    if clip is None:return []
    fwd=Transformer.from_crs('EPSG:4326',doc['projection'],always_xy=True)
    x0,y0,x1,y1=doc['extent_m'];w,h=doc.get('width',1280),doc.get('height',1000)
    result=[]
    for city in cities:
        x,y=fwd.transform(*city['lngLat']);point=[(x-x0)/(x1-x0)*w,(y1-y)/(y1-y0)*h]
        if clip.covers(Point(*point)):
            result.append({**city,'point':[round(v,2) for v in point]})
    return result

def build_region(path,cities):
    doc=read(path)
    if not all(k in doc for k in ['id','projection','extent_m','outline']):return None
    output=OUT/'regions'/path.name
    # Content-only changes do not require recomputing the geographical mask.
    key=hashlib.sha256((VERSION+json.dumps({k:doc.get(k) for k in ['id','projection','extent_m','outline','inset_frames']},sort_keys=True)).encode()).hexdigest()
    existing=read(output) if output.exists() else {}
    if existing.get('geometryKey')==key:data=existing
    else:
        data={'id':doc['id'],'version':VERSION,'geometryKey':key,**project_view(doc)}
        for frame in doc.get('inset_frames',[]):
            # Frame extents describe an independently projected inset. Source
            # cell selection is exact; normal page-layout coordinates are not
            # treated as geographic coordinates.
            local=frame if 'extent_m' in frame else next(part for part in doc.get('insets',[]) if part['id']==frame['id'])
            inset=project_view(local)
            if inset['paths']:
                data.setdefault('insets',[]).append({'id':frame['id'],'frame':frame,**inset})
    data['visitedCities']=region_markers(doc,cities)
    write(output,compact(data))
    return doc['id'],{'file':output.relative_to(ROOT).as_posix(),'pathCount':len(data['paths']),'visitedCities':len(data['visitedCities'])}

def build_admin(path):
    doc=read(path)
    if not isinstance(doc,dict) or not isinstance(doc.get('views'),dict):return None
    output=OUT/'administrative'/path.name
    key=hashlib.sha256((VERSION+json.dumps(doc['views'],sort_keys=True)).encode()).hexdigest()
    existing=read(output) if output.exists() else {}
    if existing.get('geometryKey')==key:return doc['id'],{'file':output.relative_to(ROOT).as_posix()}
    data={'id':doc['id'],'version':VERSION,'geometryKey':key,'views':{}}
    def view_overlay(view):
        overlay=project_view(view)
        overlay['meshOverlays']={}
        if view.get('mesh',{}).get('file'):
            overlay['meshOverlays'][view['mesh']['file']]={k:overlay[k] for k in ['paths','width','height']}
        for inset in view.get('insets',[]):
            part=view_overlay(inset)
            overlay['meshOverlays'].update(part['meshOverlays'])
            overlay.setdefault('insets',[]).append({'id':inset['id'],'frame':inset['frame'],**part})
        return overlay
    for name,view in doc['views'].items():data['views'][name]=compact(view_overlay(view),view.get('mesh',{}).get('file'))
    write(output,data)
    return doc['id'],{'file':output.relative_to(ROOT).as_posix()}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--prepare-source',action='store_true');parser.add_argument('--only');parser.add_argument('--workers',type=int,default=4);parser.add_argument('--regions-only',action='store_true');parser.add_argument('--index-only',action='store_true');args=parser.parse_args()
    if args.prepare_source or not MASK.exists():prepare_source()
    OUT.mkdir(parents=True,exist_ok=True)
    manifest={'version':VERSION,'source':read(ARCHIVE/'provenance.json'),'regions':{},'administrative':{}}
    if (OUT/'manifest.json').exists():manifest=read(OUT/'manifest.json')
    manifest['version']=VERSION
    manifest['note']=NOTE
    manifest['credits']=[{'name':'GHSL built-up surface 2020 · European Commission JRC','url':'https://human-settlement.emergency.copernicus.eu/ghs_buS2023.php'}]
    if args.index_only:
        for kind in ['regions','administrative']:
            for path in (OUT/kind).glob('*.json'):
                doc=read(path)
                if kind=='administrative':
                    original=read(ROOT/'assets/maps/administrative'/path.name)
                    for name,view in doc['views'].items():compact(view,original['views'][name].get('mesh',{}).get('file'))
                else:compact(doc)
                write(path,doc)
                manifest[kind][doc['id']]={'file':path.relative_to(ROOT).as_posix()}
        write(OUT/'manifest.json',manifest)
        print('Indexed',len(manifest['regions']),'regions and',len(manifest['administrative']),'administrative units',flush=True)
        return
    cities=visited_places()
    tasks=[]
    for path in sorted((ROOT/'assets/maps/regions').glob('*.json')):
        if not args.only or args.only in path.stem:tasks.append(('regions',path))
    if not args.regions_only:
        for path in sorted((ROOT/'assets/maps/administrative').glob('*.json')):
            if not args.only or args.only in path.stem:tasks.append(('administrative',path))
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        jobs={pool.submit(build_region,path,cities) if kind=='regions' else pool.submit(build_admin,path):(kind,path) for kind,path in tasks}
        count=0
        for job in concurrent.futures.as_completed(jobs):
            kind,path=jobs[job]
            try:result=job.result()
            except Exception as error:raise RuntimeError(f'Cannot build settlement overlay: {path.name}') from error
            if result:manifest[kind][result[0]]=result[1]
            count+=1
            if count%50==0:print('Processed',count,'/',len(tasks),flush=True)
    write(OUT/'manifest.json',manifest)
    print('Settlements:',len(manifest['regions']),'regions;',len(manifest['administrative']),'administrative units',flush=True)

if __name__=='__main__':main()
