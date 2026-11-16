"""Bake independently lit whole-unit and settlement relief plates.

The 401 units are the complete de-duplicated membership of the cultural atlas,
not its visited subset. Urban viewports use sourced focus coordinates supplied
by build-administrative-content.py. No viewport is centred on an administrative
polygon centroid. Compact DEM/mask scenes support offline image reproduction.
"""
from __future__ import annotations

import argparse
import concurrent.futures
from functools import lru_cache
import gzip
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import time
import uuid
import zipfile

import numpy as np
from PIL import Image
from pyproj import Transformer
from rasterio.features import rasterize
from scipy.ndimage import gaussian_filter
from shapely import make_valid
from shapely.geometry import Point, box, mapping, shape
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/maps/administrative'
ARCHIVE = ROOT / 'tools/relief-atlas/administrative'
WIDTH, HEIGHT = 1280, 1000
DEM_WIDTH, DEM_HEIGHT = 960, 750
LIGHT = {'azimuth':315, 'elevation':42, 'vertical_exaggeration':2.8}
MATERIAL = {'style':'warm-plaster','base_color':'#eeeae0','surface_texture':None}
DATAV_SOURCE = 'https://datav.aliyun.com/portal/school/atlas/area_selector'
DATAV_CRS_SOURCE = 'https://help.aliyun.com/en/datav/datav-7-0/user-guide/map-data-format-1'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    os.replace(temporary, path)


def slug(identifier):
    return identifier.lower().replace(':', '-')


@lru_cache(maxsize=1)
def regional():
    spec = importlib.util.spec_from_file_location('administrative_region_builder', ROOT/'scripts/build-region-terrain.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original_download = module.download
    old_cache = module.CACHE
    module.CACHE = ROOT/'.render-work/admin-sources'

    def atomic_download(url, path):
        path = Path(path)
        if path.exists():
            return path
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_relative_to(module.CACHE):
            previous = old_cache/path.relative_to(module.CACHE)
            if previous.exists():
                try:
                    os.link(previous,path)
                except FileExistsError:
                    pass
                except OSError:
                    shutil.copyfile(previous,path)
                return path
        temporary = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
        try:
            original_download(url, temporary)
            try:
                os.replace(temporary, path)
            except PermissionError:
                # A concurrent worker may already have installed the complete
                # tile and opened it in Pillow (Windows disallows replacement).
                if not path.exists():
                    raise
        finally:
            if temporary.exists():
                temporary.unlink()
        return path

    module.download = atomic_download
    archive = ROOT/'tools/relief-atlas/regions/international-borders.geojson.gz'
    if archive.exists():
        features = module.read_gzip(archive)['features']
        module.boundary_lines = lambda: features
    return module


def gcj_offset(longitude, latitude):
    """The standard GCJ offset, in angular degrees; vectorised for coastlines."""
    lon, lat = np.asarray(longitude), np.asarray(latitude)
    x, y = lon - 105.0, lat - 35.0
    dlat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*np.sqrt(np.abs(x))
    dlat += (20*np.sin(6*x*np.pi) + 20*np.sin(2*x*np.pi))*2/3
    dlat += (20*np.sin(y*np.pi) + 40*np.sin(y/3*np.pi))*2/3
    dlat += (160*np.sin(y/12*np.pi) + 320*np.sin(y*np.pi/30))*2/3
    dlon = 300 + x + 2*y + .1*x*x + .1*x*y + .1*np.sqrt(np.abs(x))
    dlon += (20*np.sin(6*x*np.pi) + 20*np.sin(2*x*np.pi))*2/3
    dlon += (20*np.sin(x*np.pi) + 40*np.sin(x/3*np.pi))*2/3
    dlon += (150*np.sin(x/12*np.pi) + 300*np.sin(x/30*np.pi))*2/3
    rad = np.deg2rad(lat)
    magic = 1 - .00669342162296594323*np.sin(rad)**2
    root = np.sqrt(magic)
    dlat = dlat*180/((6378245.0*(1-.00669342162296594323))/(magic*root)*np.pi)
    dlon = dlon*180/(6378245.0/root*np.cos(rad)*np.pi)
    inside = (lon>=72.004)&(lon<=137.8347)&(lat>=.8293)&(lat<=55.8271)
    return np.where(inside,dlon,0), np.where(inside,dlat,0)


def gcj_to_wgs(longitude, latitude, z=None):
    """Iteratively invert the source convention; preserve fractional degrees."""
    x, y = np.asarray(longitude,dtype=float), np.asarray(latitude,dtype=float)
    lon, lat = x.copy(), y.copy()
    for _ in range(6):
        dx, dy = gcj_offset(lon,lat)
        lon, lat = x-dx, y-dy
    return lon, lat


def inventory():
    units, memberships = {}, {}
    for group in regional().geography():
        if group['mode'] != 'cultural':
            continue
        memberships[group['id']] = [member['id'] for member in group['members']]
        for member in group['members']:
            identifier = member['id']
            if identifier in units:
                units[identifier]['cultures'].append(group['id'])
                continue
            item = {key:value for key,value in member.items() if key!='geometry'}
            geometry = member['geometry']
            source_crs = 'EPSG:4326'
            if member.get('country') == 'CHN':
                geometry = regional().polygonal(make_valid(transform(gcj_to_wgs,geometry)))
                source_crs = 'GCJ-02'
            item.update(geometry=geometry, cultures=[group['id']], source_crs=source_crs)
            units[identifier] = item
    # Cultural guides deliberately list these islands separately. A county/city
    # administrative whole view must also retain its actual-administered islands.
    for identifier,children in {'TW-KIN':['TWN:Wuqiu'],'TW-KHH':['TWN:Dongsha','TWN:Taiping']}.items():
        units[identifier]['inset_units']=[units[child] for child in children]
    sansha_source=ARCHIVE/'sansha-controlled-land.geojson'
    if sansha_source.exists():
        features=read(sansha_source)['features']
        land=[shape(feature['geometry']) for feature in features]
        assert all(g.is_valid and not g.is_empty for g in land), 'Invalid sourced island coastline'
        unit=units['460300']
        unit.update(geometry=unary_union(land),source_crs='EPSG:4326',
                    geometry_sources=[feature['properties'] for feature in features],inset_units=[])
        translations={
            'SCS:Xisha':('Yongxing & Shi islands','永兴岛与石岛','永興島與石島'),
            'SCS:Yongshu':('Fiery Cross principal island','永暑礁主岛','永暑礁主島'),
            'SCS:Meiji':('Mischief Reef','美济礁','美濟礁'),
            'SCS:Zhubi':('Subi Reef','渚碧礁','渚碧礁'),
            'SCS:Huayang':('Cuarteron Reef','华阳礁','華陽礁'),
            'SCS:Chigua':('Johnson South Reef','赤瓜礁','赤瓜礁'),
            'SCS:Nanxun':('Gaven Reef','南薰礁','南薰礁'),
            'SCS:Dongmen':('Hughes Reef','东门礁','東門礁'),
        }
        for feature,g in zip(features,land):
            identifier=feature['properties']['id']
            if identifier=='SCS:Xisha':
                # The overview retains every Xisha island. Its representative
                # close-up shows the inhabited Yongxing/Shi connected coast.
                g=next(part for part in g.geoms if part.covers(Point(112.333681944,16.832698889)))
            elif identifier=='SCS:Yongshu':
                # Four minute detached patches remain in the true overview.
                # The labelled close-up frames the principal inhabited island.
                g=max(g.geoms,key=lambda part:part.area)
            title=regional().label(*translations[identifier])
            unit['inset_units'].append({'id':identifier,'name':title['en'],'label':title,
                'geometry':g,'source_crs':'EPSG:4326','country':'CHN',
                'geometry_sources':[feature['properties']]})
    return units, memberships


def focus_geometry(unit, focus):
    """A documented settlement landscape viewport, not an urban legal boundary."""
    lon,lat = map(float,focus['lngLat'])
    assert -180<=lon<=180 and -85<lat<85, (unit['id'],focus['lngLat'])
    distance = focus['extentKm']
    if isinstance(distance,(list,tuple)):
        horizontal,vertical=map(float,distance)
    else:
        horizontal=float(distance)
        vertical=horizontal*HEIGHT/WIDTH
    assert 0<horizontal<=300 and 0<vertical<=300, (unit['id'],distance)
    crs=f'+proj=eqc +lat_ts={lat} +lon_0={lon} +R=6378137 +units=m +no_defs'
    forward=Transformer.from_crs('EPSG:4326',crs,always_xy=True)
    inverse=Transformer.from_crs(crs,'EPSG:4326',always_xy=True)
    cx,cy=forward.transform(lon,lat)
    window=transform(inverse.transform,box(cx-horizontal*500,cy-vertical*500,cx+horizontal*500,cy+vertical*500))
    # Daxing'anling's real administrative seat, Jiagedaqi, lies outside this
    # source's territorial polygon. The editorial exception is explicit: show
    # that settlement's landscape without changing the whole-unit boundary.
    independent=focus.get('kind')=='administrative-seat-outside-display-outline'
    result=window if independent else regional().polygonal(make_valid(unit['geometry'].intersection(window)))
    if result.is_empty:
        raise ValueError(f"{unit['id']}: sourced settlement viewport does not intersect its unit")
    return result,window


def geometry_scene(unit,view,focus=None):
    coastal_source=None
    if unit['id']=='460300' and view=='urban':
        # The DataV South China Sea drawing is a cartographic symbol layer,
        # not the true coast at Sansha's inhabited seat on Yongxing Island.
        source=ARCHIVE/'sansha-controlled-land.geojson'
        if source.exists():
            coastal_source=next(feature for feature in read(source)['features'] if feature['properties']['id']=='SCS:Xisha')
        else:
            coastal_source=read(ARCHIVE/'yongxing-coastline.geojson')
        unit={**unit,'geometry':shape(coastal_source['geometry']),'source_crs':'EPSG:4326'}
    geometry=unit['geometry']
    framing=geometry
    if view=='urban':
        geometry,framing=focus_geometry(unit,focus)
    west,south,east,north=framing.bounds
    lat=(south+north)/2;lon=(west+east)/2
    crs=f'+proj=eqc +lat_ts={lat} +lon_0={lon} +R=6378137 +units=m +no_defs'
    forward=Transformer.from_crs('EPSG:4326',crs,always_xy=True)
    rx,ry=regional().raster_transform('EPSG:4326',crs,[lon],[lat])
    px,py=forward.transform(lon,lat)
    assert abs(rx[0]-px)<.001 and abs(ry[0]-py)<.001, 'Administrative raster/vector CRS mismatch'
    projected=transform(forward.transform,framing)
    x0,y0,x1,y1=projected.bounds
    margin=110 if view=='whole' else 48
    main_width=(640 if unit['id']=='460300' else 920) if view=='whole' and unit.get('inset_units') else WIDTH
    scale=max((x1-x0)/(main_width-margin),(y1-y0)/(HEIGHT-margin))
    cx,cy=(x0+x1)/2,(y0+y1)/2
    left=cx-main_width*scale/2
    extent=(left,cy-HEIGHT*scale/2,left+WIDTH*scale,cy+HEIGHT*scale/2)

    def pixels(lng,lat,z=None):
        x,y=forward.transform(lng,lat)
        return (np.asarray(x)-extent[0])/scale,(extent[3]-np.asarray(y))/scale

    pixel_outline=transform(pixels,geometry)
    mask=rasterize([(pixel_outline,1)],out_shape=(HEIGHT,WIDTH),fill=0,dtype='uint8')
    # Quarter-metre quantisation is finer than the terrain source's vertical
    # accuracy. Bake from these same archived samples for exact offline reruns.
    elevation,zoom=regional().dem((west-.01,south-.01,east+.01,north+.01),crs,extent,DEM_WIDTH,DEM_HEIGHT)
    elevation_qm=np.rint(np.clip(elevation,0,16383.75)*4).astype(np.uint16)
    borders=[]
    for feature in regional().visible_boundary_lines():
        line=shape(feature['geometry'])
        if not line.intersects(geometry):
            continue
        line=line.intersection(geometry.buffer(.002))
        if not line.is_empty:
            borders.append({'kind':regional().border_kind(feature),'path':regional().path(transform(pixels,line).simplify(.55))})
    metadata={
        'id':unit['id'],'view':view,'width':WIDTH,'height':HEIGHT,
        'outline':regional().path(pixel_outline.simplify(.45,preserve_topology=True)),
        'borders':borders,'projection':crs,'extent_m':list(extent),'dem_zoom':zoom,
        'dem_width':DEM_WIDTH,'dem_height':DEM_HEIGHT,'elevation_quantum_m':.25,
        'light':LIGHT,'material':MATERIAL,'geographic_bounds':list(geometry.bounds),
        'source_crs':unit['source_crs'],'geographic_crs':'EPSG:4326',
        'source_transform':'Iterative GCJ-02 inverse (6 iterations)' if unit['source_crs']=='GCJ-02' else None,
    }
    if not np.any(elevation_qm):
        metadata['elevation_status']='no-resolved-relief'
        metadata['elevation_note']=regional().label('Elevation detail unavailable','公开高程未解析起伏','公開高程未解析起伏')
    if unit.get('geometry_sources'):
        metadata['geometry_sources']=unit['geometry_sources']
    if unit['id']=='460300' and view=='whole':
        metadata['title']=regional().label('Administered islands','实际岛礁导览','實際島礁導覽')
        metadata['description']=regional().label(
            'A guide to actual island land in the Paracels and seven administered Spratly reefs. Maritime symbols are not rendered as land; this is not the full statutory extent of Sansha. Some low islands show their real coastlines without resolved terrain relief in the available elevation data.',
            '展示西沙群岛及南沙七处实际管辖岛礁的真实陆地。海域示意线不作为陆地烤制；这不是三沙完整法定范围图。部分低平岛礁以真实岸线呈现，公开高程未解析其地表起伏。',
            '展示西沙群島及南沙七處實際管轄島礁的真實陸地。海域示意線不作為陸地烤製；這不是三沙完整法定範圍圖。部分低平島礁以真實岸線呈現，公開高程未解析其地表起伏。')
    if focus:
        metadata['focus']=focus
        metadata['title']=focus['label']
        metadata['description']=focus['definition']
        metadata['mask_scope']='independent-settlement-window' if focus.get('kind')=='administrative-seat-outside-display-outline' else 'administrative-outline-within-settlement-window'
    if coastal_source:
        metadata['geometry_source']=coastal_source['properties']
    return elevation_qm,mask,metadata


def render(elevation_qm,mask,metadata):
    elevation=np.asarray(Image.fromarray(elevation_qm.astype(np.float32)*.25).resize((metadata['width'],metadata['height']),Image.Resampling.BILINEAR))
    scale=(metadata['extent_m'][2]-metadata['extent_m'][0])/metadata['width']
    light=metadata['light'];exaggeration=light['vertical_exaggeration']
    gy,gx=np.gradient(gaussian_filter(elevation,.7)*exaggeration,scale)
    normal=np.sqrt(gx*gx+gy*gy+1)
    sun_el=math.radians(light['elevation']);az=math.radians(light['azimuth'])
    diffuse=(-gx*math.sin(az)*math.cos(sun_el)+gy*math.cos(az)*math.cos(sun_el)+math.sin(sun_el))/normal
    z=np.where(mask,elevation*exaggeration,-100000);occlusion=np.zeros_like(z)
    for distance in (1,2,3,5,8,12,18,26,38):
        shifted=np.full_like(z,-100000)
        shifted[distance:,distance:]=z[:-distance,:-distance]
        occlusion=np.maximum(occlusion,(shifted-z)/(distance*scale*math.sqrt(2)))
    shadow=np.clip((occlusion-math.tan(sun_el))*.35,0,.48)
    shading=np.clip(.74+.26*np.clip(diffuse,0,1)-shadow*.6,.35,1)
    pigment=np.array([int(metadata['material']['base_color'][i:i+2],16) for i in (1,3,5)],dtype=np.float32)/255
    colour=pigment[None,None,:]*shading[:,:,None]
    image=Image.fromarray(np.dstack([(colour*255).astype(np.uint8),mask.astype(np.uint8)*255]),'RGBA')
    for inset in metadata.get('insets',[]):
        inset_elevation,inset_mask,inset_metadata=rehydrate_scene(ROOT/inset['source_archive'])
        small=render(inset_elevation,inset_mask,inset_metadata).resize((inset['frame']['width'],inset['frame']['height']),Image.Resampling.LANCZOS)
        image.alpha_composite(small,(inset['frame']['x'],inset['frame']['y']))
    return image


@lru_cache(maxsize=1)
def place_inventory():
    filename=OUT/'places.json'
    if not filename.exists():
        return {}
    places=read(filename)
    if isinstance(places,dict):
        places=places.get('places',[])
    indexed={}
    for place in places:
        indexed.setdefault(place.get('parentUnit'),[]).append(place)
    return indexed


def photo_points(metadata,unit_id):
    indexed=place_inventory()
    transformer=Transformer.from_crs('EPSG:4326',metadata['projection'],always_xy=True)
    x0,y0,x1,y1=metadata['extent_m'];result=[]
    included_units=dict.fromkeys([unit_id,*metadata.get('included_units',[])])
    places=[place for identifier in included_units for place in indexed.get(identifier,[])]
    alpha=None
    if metadata.get('image'):
        with Image.open(ROOT/metadata['image']) as picture:
            alpha=np.asarray(picture.getchannel('A'))
    for place in places:
        if not place.get('lngLat'):
            continue
        x,y=transformer.transform(*place['lngLat'])
        point=[round((x-x0)/(x1-x0)*metadata['width'],2),round((y1-y)/(y1-y0)*metadata['height'],2)]
        for inset in metadata.get('insets',[]):
            if box(*inset['geographic_bounds']).covers(Point(*place['lngLat'])):
                p=Transformer.from_crs('EPSG:4326',inset['projection'],always_xy=True)
                ix,iy=p.transform(*place['lngLat']);ix0,iy0,ix1,iy1=inset['extent_m'];frame=inset['frame']
                point=[round(frame['x']+(ix-ix0)/(ix1-ix0)*frame['width'],2),round(frame['y']+(iy1-iy)/(iy1-iy0)*frame['height'],2)]
                break
        if not (0<=point[0]<=metadata['width'] and 0<=point[1]<=metadata['height']):
            continue
        if alpha is not None:
            px=min(alpha.shape[1]-1,int(point[0]));py=min(alpha.shape[0]-1,int(point[1]))
            if not alpha[py,px]:
                continue  # Padding, another unit, or water outside this terrain.
        result.append({**place,'point':point})
    return result


def build_view(unit,view,focus,skip_existing):
    name=slug(unit['id'])+'-'+view
    source=ARCHIVE/(name+'.npz');image_file=OUT/(name+'.webp')
    if skip_existing and source.exists() and image_file.exists():
        try:
            with np.load(source,allow_pickle=False) as archive:
                metadata=json.loads(str(archive['metadata']))
                assert archive['elevation_qm'].shape==(DEM_HEIGHT,DEM_WIDTH)
            with Image.open(image_file) as existing:
                existing.load()
            # Focus updates must never silently reuse a crop of the old seat.
            expected_insets=[item['id'] for item in unit.get('inset_units',[])] if view=='whole' else []
            if (view=='whole' or metadata.get('focus')==focus) and metadata.get('included_units',[])==expected_insets:
                result={**metadata,'image':image_file.relative_to(ROOT).as_posix(),
                        'source_archive':source.relative_to(ROOT).as_posix()}
                result['places']=photo_points(result,unit['id'])
                return result
        except (OSError,ValueError,EOFError,zipfile.BadZipFile,AssertionError):
            pass  # An interrupted scene/image is rebuilt, never published as ready.
    elevation,mask,metadata=geometry_scene(unit,view,focus)
    source.parent.mkdir(parents=True,exist_ok=True)
    if view=='whole' and unit.get('inset_units'):
        metadata['insets']=[]
        metadata['inset_frames']=[]
        metadata['included_units']=[item['id'] for item in unit['inset_units']]
        metadata['inset_sources']=[]
        metadata['administrative_bounds']=list(unary_union([unit['geometry'],*[item['geometry'] for item in unit['inset_units']]]).bounds)
        for index,inset_unit in enumerate(unit['inset_units']):
            ie,im,imd=geometry_scene(inset_unit,'whole')
            child_name=name+'-inset-'+slug(inset_unit['id'])
            child_source=ARCHIVE/(child_name+'.npz')
            np.savez_compressed(child_source,elevation_qm=ie,mask_bits=np.packbits(im),
                                mask_shape=np.array(im.shape,dtype=np.uint16),
                                metadata=np.array(json.dumps(imd,ensure_ascii=False,separators=(',',':'))))
            child_image=OUT/(child_name+'.webp')
            render(ie,im,imd).save(child_image,'WEBP',quality=88,method=6)
            frame={'id':inset_unit['id'],'x':940,'y':460+index*270,'width':300,'height':234,
                   'title':inset_unit.get('label') or regional().label(inset_unit['name'])}
            if imd.get('elevation_note'):
                frame['note']=imd['elevation_note']
            if unit['id']=='460300':
                frame.update(x=680+300*(index%2),y=55+230*(index//2),width=260,height=203,index=index+1)
                anchor=inset_unit['geometry'].representative_point()
                converter=Transformer.from_crs('EPSG:4326',metadata['projection'],always_xy=True)
                ax,ay=converter.transform(anchor.x,anchor.y);x0,y0,x1,y1=metadata['extent_m']
                metadata.setdefault('guide_points',[]).append({'id':inset_unit['id'],'index':index+1,
                    'label':frame['title'],'lngLat':[anchor.x,anchor.y],
                    'point':[(ax-x0)/(x1-x0)*WIDTH,(y1-ay)/(y1-y0)*HEIGHT]})
            imd.update(frame=frame,image=child_image.relative_to(ROOT).as_posix(),
                       source_archive=child_source.relative_to(ROOT).as_posix())
            imd['places']=photo_points(imd,inset_unit['id'])
            metadata['insets'].append(imd)
            metadata['inset_frames'].append(frame)
            metadata['inset_sources'].append(imd['source_archive'])
            # Retain the full geographic footprint in the parent image's hit
            # coordinates; frame labels make the displacement explicit.
            from footprint_web_geometry import rings
            for ring in rings(imd['outline']):
                transformed=[(frame['x']+x*frame['width']/WIDTH,frame['y']+y*frame['height']/HEIGHT) for x,y in ring]
                metadata['outline']+='M'+'L'.join(f'{x:.1f},{y:.1f}' for x,y in transformed)+'Z'
    np.savez_compressed(source,elevation_qm=elevation,mask_bits=np.packbits(mask),
                        mask_shape=np.array(mask.shape,dtype=np.uint16),
                        metadata=np.array(json.dumps(metadata,ensure_ascii=False,separators=(',',':'))))
    image_file.parent.mkdir(parents=True,exist_ok=True)
    render(elevation,mask,metadata).save(image_file,'WEBP',quality=88,method=6)
    result={**metadata,'image':image_file.relative_to(ROOT).as_posix(),
            'source_archive':source.relative_to(ROOT).as_posix()}
    result['places']=photo_points(result,unit['id'])
    return result


def build_unit(task):
    unit,views,focus,skip_existing=task
    target=OUT/(slug(unit['id'])+'.json')
    document=read(target) if target.exists() else {}
    document.update({'id':unit['id'],'title':unit.get('label') or regional().label(unit.get('name',unit['id'])),
        'width':WIDTH,'height':HEIGHT,'country':unit.get('country'),
        'cultures':unit['cultures'],'visited':bool(unit.get('visited')),
        'content_file':f'assets/maps/administrative/content/{slug(unit["id"])}.json'})
    content_file=ROOT/document['content_file']
    if content_file.exists():
        entry=read(content_file).get('entries',{}).get(unit['id'],{})
        document['title']=entry.get('label') or document['title']
    document.setdefault('views',{})
    for view in views:
        if view=='urban' and not focus:
            continue
        document['views'][view]=build_view(unit,view,focus if view=='urban' else None,skip_existing)
    if focus:
        document['urbanFocus']=focus
    write(target,document)
    print(unit['id'],','.join(document['views']),flush=True)
    return unit['id']


def rehydrate_scene(filename):
    with np.load(filename,allow_pickle=False) as archive:
        elevation=archive['elevation_qm'];metadata=json.loads(str(archive['metadata']))
        mask=np.unpackbits(archive['mask_bits'])[:int(np.prod(archive['mask_shape']))].reshape(archive['mask_shape'])
    return elevation,mask,metadata


def sync_focus_labels(document,focus):
    view=document['views'].get('urban')
    if not view or view.get('focus')==focus:return
    before=view['focus']
    assert before['lngLat']==focus['lngLat'] and before['extentKm']==focus['extentKm'], f"{document['id']}: focus moved; rebuild its urban terrain"
    source=ROOT/view['source_archive'];old_hash=hashlib.sha256(source.read_bytes()).hexdigest()
    if view.get('mesh'):assert view['mesh']['source_sha256']==old_hash, 'Mesh/source mismatch before editorial update'
    with np.load(source,allow_pickle=False) as scene:
        arrays={key:scene[key] for key in scene.files}
    metadata=json.loads(str(arrays['metadata']))
    metadata.update(focus=focus,title=focus['label'],description=focus['definition'])
    arrays['metadata']=np.array(json.dumps(metadata,ensure_ascii=False,separators=(',',':')))
    temporary=source.with_name(source.name+'.tmp-'+uuid.uuid4().hex)
    with temporary.open('wb') as stream:np.savez_compressed(stream,**arrays)
    os.replace(temporary,source)
    view.update(focus=focus,title=focus['label'],description=focus['definition'])
    document['urbanFocus']=focus
    if view.get('mesh'):view['mesh']['source_sha256']=hashlib.sha256(source.read_bytes()).hexdigest()


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only',help='Comma-separated stable administrative IDs')
    parser.add_argument('--exclude',default='',help='Temporarily exclude IDs still under editorial review')
    parser.add_argument('--views',default='whole,urban')
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--priority',default='320500,370800,110000,320200,320400,TW-KIN,MNG,TWN:Dongsha')
    parser.add_argument('--skip-existing',action='store_true')
    parser.add_argument('--inventory-only',action='store_true')
    parser.add_argument('--refresh-places',action='store_true')
    parser.add_argument('--from-scene',type=Path,help='Render one archived NPZ without network')
    parser.add_argument('--output',type=Path,help='Output WebP for --from-scene')
    args=parser.parse_args()
    if args.from_scene:
        elevation,mask,metadata=rehydrate_scene(args.from_scene)
        output=args.output or OUT/(slug(metadata['id'])+'-'+metadata['view']+'.webp')
        render(elevation,mask,metadata).save(output,'WEBP',quality=88,method=6)
        print(output)
        return
    units,memberships=inventory()
    manifest={'version':1,'units':{identifier:{'file':f'assets/maps/administrative/{slug(identifier)}.json'} for identifier in units},
        'cultures':memberships,'material':MATERIAL,
        'credits':[{'name':'AWS Terrain Tiles','url':'https://registry.opendata.aws/terrain-tiles/'},
                   {'name':'DataV administrative source','url':DATAV_SOURCE},
                   {'name':'DataV coordinate convention','url':DATAV_CRS_SOURCE},
                   {'name':'Natural Earth','url':'https://www.naturalearthdata.com/'},
                   {'name':'National Land Surveying and Mapping Center','url':'https://maps.nlsc.gov.tw/pro/download.jsp'},
                   {'name':'geoBoundaries — Lahaul and Spiti','url':'https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/'},
                   {'name':'OpenStreetMap contributors — island coastlines (ODbL)','url':'https://www.openstreetmap.org/copyright'}]}
    write(OUT/'manifest.json',manifest)
    ARCHIVE.mkdir(parents=True,exist_ok=True)
    source_features={'type':'FeatureCollection','features':[{'type':'Feature',
        'properties':{key:unit[key] for key in ('id','cultures','source_crs')},
        'geometry':mapping(unary_union([unit['geometry'],*[child['geometry'] for child in unit.get('inset_units',[])]]))} for unit in units.values()]}
    geometry_archive=ARCHIVE/'units-wgs84.geojson.gz'
    temporary=geometry_archive.with_name(geometry_archive.name+'.tmp-'+uuid.uuid4().hex)
    temporary.write_bytes(gzip.compress(json.dumps(source_features,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    os.replace(temporary,geometry_archive)
    if args.inventory_only:
        print(json.dumps({'cultures':len(memberships),'memberships':sum(map(len,memberships.values())),'units':len(units)},indent=2))
        return
    selected=set(args.only.split(',')) if args.only else None
    excluded=set(args.exclude.split(','))
    units={identifier:unit for identifier,unit in units.items() if (not selected or identifier in selected) and identifier not in excluded}
    if selected:
        assert set(units)==selected, selected-set(units)
    if args.refresh_places:
        focuses=read(OUT/'focus.json')['units']
        for identifier in units:
            target=OUT/(slug(identifier)+'.json')
            if target.exists():
                document=read(target)
                sync_focus_labels(document,focuses[identifier])
                content_file=ROOT/document['content_file']
                if content_file.exists():
                    entry=read(content_file).get('entries',{}).get(identifier,{})
                    document['title']=entry.get('label') or document['title']
                for metadata in document['views'].values():
                    metadata['places']=photo_points(metadata,identifier)
                    for inset in metadata.get('insets',[]):
                        inset['places']=photo_points(inset,inset['id'])
                write(target,document)
        return
    views=args.views.split(',')
    assert set(views)<={'whole','urban'}
    focus=read(OUT/'focus.json').get('units',{}) if (OUT/'focus.json').exists() else {}
    tasks=[(unit,views,focus.get(identifier),args.skip_existing) for identifier,unit in units.items()]
    priority={identifier:i for i,identifier in enumerate(args.priority.split(','))}
    tasks.sort(key=lambda task:priority.get(task[0]['id'],len(priority)))
    started=time.monotonic();failures=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures={pool.submit(build_unit,task):task[0]['id'] for task in tasks}
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as error:
                failures.append({'id':futures[future],'error':str(error)})
                print('ERROR',futures[future],repr(error),flush=True)
    print(json.dumps({'units':len(tasks),'seconds':round(time.monotonic()-started,1),'failures':failures},ensure_ascii=False),flush=True)
    if failures:
        raise SystemExit(1)


if __name__=='__main__':
    main()
