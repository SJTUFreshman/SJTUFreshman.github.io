"""Publish an explorable plate for every region displayed by the three atlases.

Existing independent administrative bakes are reused at their native scale.
Previously unbaked foreign regions are clipped from the archived real-DEM atlas
in its original projection; no invented elevations or borders are introduced.
These contextual plates explicitly retain that provenance (they are not new
independent lighting bakes). Run after build-region-terrain/content, then run
build-footprint-previews and build-settlement-overlays if applicable.
"""
from __future__ import annotations
import argparse, concurrent.futures, gzip, hashlib, importlib.util, json, re
from copy import deepcopy
from pathlib import Path
from urllib.parse import quote, urlencode
import numpy as np
from PIL import Image, ImageChops, ImageDraw
from pyproj import Transformer
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/maps/regions'
RELIEF=ROOT/'assets/maps/relief'
VERSION='20261117-open-atlas'
def read(p): return json.loads(Path(p).read_text(encoding='utf-8'))
def write(p,d):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def label(r):return r.get('label') or r.get('title') or {l:r.get('name',r['id']) for l in ['en','zh-CN','zh-TW']}
def rings(path):
    for r in re.findall(r'M([^M]+)',path):
        n=list(map(float,re.findall(r'[-+]?(?:\d*\.)?\d+',r)))
        if len(n)>=6:yield list(zip(n[::2],n[1::2]))
def shape_of(path):
    result=Polygon()
    for p in rings(path):
        g=Polygon(p).buffer(0)
        result=result.symmetric_difference(g)
    return result
def transform_path(path,x0,y0,scale):
    return ''.join('M'+'L'.join(f'{(x-x0)*scale:.2f},{(y-y0)*scale:.2f}' for x,y in ring)+'Z' for ring in rings(path))
def path_of(g):
    if g.is_empty:return ''
    if g.geom_type=='Polygon':return ''.join('M'+'L'.join(f'{x:.2f},{y:.2f}' for x,y in r.coords)+'Z' for r in [g.exterior,*g.interiors])
    return ''.join(path_of(p) for p in getattr(g,'geoms',[]))
def explore(mapid,r):return {'map':mapid,'view':'detail','region':{k:r[k] for k in ['id','name','label','visited','country'] if k in r}}

def plate(mapid,view,r,meta,image,members):
    source_path=r.get('boundary_path') or r.get('path','')
    # Atlas paths already describe precisely the displayed map window.
    g=shape_of(source_path).intersection(box(0,0,meta['width'],meta['height']))
    if g.is_empty:raise ValueError('Empty displayed region '+r['id'])
    source_path=path_of(g)
    a,b,c,d=g.bounds;scale=min(1150/max(c-a,.01),870/max(d-b,.01))
    x0=(a+c)/2-640/scale;y0=(b+d)/2-500/scale
    outline=transform_path(source_path,x0,y0,scale)
    patch=image.transform((1280,1000),Image.Transform.EXTENT,(x0,y0,x0+1280/scale,y0+1000/scale),Image.Resampling.BICUBIC)
    # Neutral plaster only; retain the real baked terrain's luminance variation.
    light=np.asarray(patch.convert('L'),dtype=np.float32)/255
    rgba=np.empty((1000,1280,4),dtype=np.uint8)
    rgba[:,:,:3]=(np.minimum(light/.93,1)[:,:,None]*np.array([238,234,224])).astype('uint8')
    mask=Image.new('1',(1280,1000))
    for ring in rings(outline):
        ring_mask=Image.new('1',mask.size);ImageDraw.Draw(ring_mask).polygon(ring,fill=1)
        mask=ImageChops.logical_xor(mask,ring_mask)
    rgba[:,:,3]=np.asarray(mask,dtype='uint8')*255
    filename='coverage-'+hashlib.sha256(f'{mapid}:{view}:{r["id"]}'.encode()).hexdigest()[:16]
    Image.fromarray(rgba).save(OUT/(filename+'.webp'),quality=86,method=4)
    ex=meta['extent_km'];mw=meta['width'];mh=meta['height']
    def metres(x,y):return (ex[0]+x/mw*(ex[2]-ex[0]))*1000,(ex[3]-y/mh*(ex[3]-ex[1]))*1000
    left,top=metres(x0,y0);right,bottom=metres(x0+1280/scale,y0+1000/scale)
    subs=[]
    for m in members:
        mg=shape_of(m.get('boundary_path') or m.get('path','')).intersection(g)
        if mg.is_empty or mg.area<.00001:continue
        p=mg.representative_point()
        sub={'id':m['id'],'label':label(m),'name':m.get('name',m['id']),'path':transform_path(path_of(mg),x0,y0,scale),'center':[round((p.x-x0)*scale,2),round((p.y-y0)*scale,2)],'visited':bool(m.get('visited')),'country':m.get('country')}
        if m['id']!=r['id'] or view!='detail':sub['explore']=explore(mapid,m)
        subs.append(sub)
    ident=f'{mapid}:{view}:{r["id"]}'
    record={'id':ident,'source_id':r['id'],'mode':view,'title':label(r),'visited':bool(r.get('visited')),'width':1280,'height':1000,'image':f'assets/maps/regions/{filename}.webp','outline':outline,'subregions':subs,'places':[],'borders':[],'projection':meta['projection'],'extent_m':[left,bottom,right,top],'material':{'style':'warm-plaster','base_color':'#eeeae0','surface_texture':None},'terrain_provenance':{'method':'masked original atlas relief','source':f'assets/maps/relief/{meta["image"]}','source_archive':meta.get('source_archive'),'independent_lighting_bake':False,'scope':'Displayed source-atlas region; source projection and DEM shading retained.'}}
    return filename+'.json',record

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--content',action='store_true');ap.add_argument('--skip-images',action='store_true');args=ap.parse_args()
    atlas=read(RELIEF/'atlas.json');index=read(OUT/'manifest.json');entries=read(OUT/'content.json')['entries'];admin=read(ROOT/'assets/maps/administrative/manifest.json')['units']
    original={k:v for k,v in index['regions'].items() if not v['file'].startswith('coverage-')}
    index['regions']=original
    articles={};documents={};sources={}
    # Source inset geometry had been dropped by the previous publishing stage.
    for inset in atlas['maps']['east_asia'].get('insets',[]):
        source=ROOT/'tools/relief-atlas/footprints/selected-cultural-20261106/detail/data'/(inset['id']+'.json')
        geometry=read(source)
        for k in ['regions','projection','extent_km']:inset[k]=geometry[k]
        country='SGP' if inset['id']=='singapore' else 'USA'
        for r in inset['regions']:r['country']=country;r['label']=inset['title'] if inset['id']=='hawaii' else label(r)
    ne=json.loads(gzip.decompress((ROOT/'tools/relief-atlas/footprints/administrative-20261016/cache/ne_10m_admin_1_states_provinces.geojson.gz').read_bytes()))['features']
    aliases={f['properties']['adm1_code']:f['properties'].get('iso_3166_2') for f in ne}
    for mapid,meta in atlas['maps'].items():
        with Image.open(RELIEF/meta['image']) as im:image=im.convert('RGB')
        views=[('overview',meta['overview']['regions']),('detail',meta['regions'])]
        if meta.get('cultural'):views.append(('cultural',meta['cultural']['regions']))
        for view,regions in views:
            for r in regions:
                key=f'{mapid}:{view}:{r["id"]}'
                if key in original:continue
                filename='coverage-'+hashlib.sha256(key.encode()).hexdigest()[:16]+'.json'
                if r['id'] in admin:
                    a=read(ROOT/admin[r['id']]['file']);record=deepcopy(a['views']['whole'])
                    record.update(id=key,source_id=r['id'],mode=view,title=a['title'],visited=bool(r.get('visited')),subregions=[{'id':r['id'],'label':a['title'],'path':record['outline'],'visited':bool(r.get('visited'))}])
                    record.pop('mesh',None)
                    ae=read(ROOT/a['content_file'])['entries'];entries.update(ae);entries[key]=deepcopy(ae.get(r['id'],{}));entries[key]['label']=a['title']
                else:
                    members=[m for m in meta['regions'] if m['id'] in r.get('members',[]) or aliases.get(m['id']) in r.get('members',[]) or (r.get('unit')=='country' and m.get('country')==r['id'])] if view!='detail' else []
                    if args.skip_images and (OUT/filename).exists():record=read(OUT/filename)
                    else:filename,record=plate(mapid,view,r,meta,image,members)
                    articles[key]=r
                    for s in record['subregions']:articles.setdefault(s['id'],s)
                documents[filename]=record
                index['regions'][key]={'file':filename,'title':record['title'],'visited':record['visited']}
                if view=='overview':index['regions'].setdefault(f'{mapid}:{r["id"]}',index['regions'][key])
        for ins in meta.get('insets',[]):
            with Image.open(RELIEF/ins['image']) as im:inset_image=im.convert('RGB')
            for r in ins['regions']:
                filename,record=plate(mapid,'detail',r,ins,inset_image,[]);documents[filename]=record;articles[record['id']]=r
                for view in ['overview','detail','cultural']:
                    index['regions'][f'{mapid}:{view}:{r["id"]}']={'file':filename,'title':record['title'],'visited':record['visited']}
    if args.content or any(key not in entries for key in articles):
        content=load('coverage_content',ROOT/'scripts/build-region-content.py')
        # Atlas names are geographical names, not substituted province articles.
        titles={k:label(v).get('en',v.get('name',v['id'])) for k,v in articles.items()}
        replacements={'Republic of Serbia':'Serbia','Hokkaidō':'Hokkaido','Kyushu and Okinawa':'Kyushu','Capital region':'Seoul Capital Area','Gaza Strip':'State of Palestine',
          'Dhekelia Sovereign Base Area':'Akrotiri and Dhekelia','Akrotiri Sovereign Base Area':'Akrotiri and Dhekelia',
          'Georgia':'Georgia (U.S. state)','West Midlands':'West Midlands (region)','Eastern':'East of England','Gangwon':'Gangwon Province, South Korea','Jeju':'Jeju Province','Macedonia':'North Macedonia',
          'Normandie':'Normandy','Free Hanseatic Bremen':'Bremen (state)','New York':'New York (state)','Galicia':'Galicia (Spain)','Valenciana':'Valencian Community',
          'Washington':'Washington (state)','Bretagne':'Brittany','Canary Is.':'Canary Islands','Foral de Navarra':'Navarre'}
        titles={k:replacements.get(t,t) for k,t in titles.items()}
        precise={'GBR:North West':'North West England','GBR:North East':'North East England','GBR:South West':'South West England','GBR:South East':'South East England',
          'GBR:East':'Subdivisions of Scotland','GBR:South Western':'Subdivisions of Scotland','GBR:North Eastern':'Subdivisions of Scotland',
          'SGP-4873':'North West Community Development Council','JPN:kanto':'Kantō region'}
        titles={k:precise.get(articles[k]['id'],t) for k,t in titles.items()}
        en=content.pages(titles.values(),'en')
        ztitles={k:next((l['*'] for l in en.get(t,{}).get('langlinks',[]) if l['lang']=='zh'),None) for k,t in titles.items()}
        zh=content.pages(ztitles.values(),'zh')
        candidates={k:p for k,t in titles.items() if content.acceptable_image(p:=en.get(t,{})) and re.search(r'\.(?:jpg|jpeg|webp)$',p.get('pageimage',''),re.I)}
        # Prefer named landscape photographs already used in the region's
        # encyclopedia article. Do not select a flag, locator or portrait.
        missing_titles=sorted({titles[k] for k in articles if k not in candidates})
        def candidate(title):
            args=dict(action='query',format='json',redirects=1,titles=title,prop='images',imlimit='max')
            try:
                data=content.fetch('https://en.wikipedia.org/w/api.php?'+urlencode(args)).get('query',{})
                found=[]
                for page in data.get('pages',{}).values():
                    for item in page.get('images',[]):
                        name=item['title'][5:]
                        if not re.search(r'\.(?:jpg|jpeg|webp)$',name,re.I) or not content.acceptable_image({'pageimage':name}):continue
                        if re.search(r'portrait|president|prime.minister|king |queen |coat|logo|stamp|coin|poster|chart|diagram|graph|map|flag|passport|census|demograph|population|election|speaker|signature|monarch|politic|medal',name,re.I):continue
                        score=sum(bool(re.search(word,name,re.I)) for word in ['landscape|panorama|skyline|aerial','mountain|lake|river|valley|coast|forest|temple|castle|park|harbo[u]?r|beach','view|city|town|bridge'])
                        if score:found.append((score,name))
                return title,{'pageimage':sorted(found,key=lambda x:(-x[0],x[1]))[0][1],'title':title} if found else None
            except Exception:return title,None
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            alternatives=dict(pool.map(candidate,missing_titles))
        for k,t in titles.items():
            if k not in candidates and alternatives.get(t):candidates[k]=alternatives[t]
        metadata=content.image_metadata([p['pageimage'] for p in candidates.values()])
        photos={}
        def photo(item):
            k,p=item
            try:return k,content.licensed_photograph(p,metadata)
            except Exception:return k,None
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            for k,p in pool.map(photo,candidates.items()):
                if p:photos[k]=p
        for k,r in articles.items():
            ep=en.get(titles[k],{});zp=zh.get(ztitles[k],{});name=label(r)
            if zp.get('title') and (not name.get('zh-CN') or name.get('zh-CN')==name.get('en')):
                name={**name,'zh-CN':content.SIMP.convert(zp['title']),'zh-TW':content.TRAD.convert(zp['title'])}
            description={l:content.excerpt((ep if l=='en' else zp).get('extract','')) for l in ['en','zh-CN','zh-TW']}
            if description['zh-TW']:description['zh-TW']=content.TRAD.convert(description['zh-TW'])
            entry={'label':name,'description':description,'source':ep.get('fullurl') or 'https://en.wikipedia.org/wiki/'+quote(titles[k].replace(' ','_')),'textSources':[p['fullurl'] for p in [ep,zp] if p.get('fullurl')],'textLicense':'CC BY-SA 4.0; shortened encyclopedia extracts','textLicenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/'}
            if k in photos:entry['photo']=photos[k]
            entries[k]=entry
        # For the few regions lacking a licensed ground scene, use a real,
        # explicitly dated Landsat reference at an interior point of the plate.
        def satellite(item):
            filename,record=item;key=record['id']
            if not record.get('terrain_provenance') or entries[key].get('photo'):return key,None
            point=shape_of(record['outline']).representative_point();x0,y0,x1,y1=record['extent_m']
            xy=(x0+point.x/record['width']*(x1-x0),y1-point.y/record['height']*(y1-y0))
            lon,lat=Transformer.from_crs(record['projection'],'EPSG:4326',always_xy=True).transform(*xy)
            entry={**entries[key],'lngLat':[lon,lat]}
            try:return key,content.satellite_photograph(key,entry)
            except Exception:return key,None
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            for key,photo in pool.map(satellite,documents.items()):
                if photo:entries[key]['photo']=photo
    editorial=read(ROOT/'scripts/region-coverage-editorial.json')
    for k,r in articles.items():
        if r['id'] in editorial:
            entries[k].update(editorial[r['id']])
        entry=entries.get(k,{})
        for lang in ['en','zh-CN','zh-TW']:
            text=entry.get('description',{}).get(lang,'')
            if not text or re.search(r'(?:may|might|can) refer to|most commonly refers to',text,re.I):
                raise ValueError(f'{k}: missing or ambiguous {lang} article; add a sourced editorial entry before publishing')
    # A hovering subregion and its opened plate use the same sourced photograph.
    for record in documents.values():
        source_id=record.get('source_id')
        if source_id in entries and entries[record['id']].get('photo'):
            entries[source_id]['photo']=deepcopy(entries[record['id']]['photo'])
    for filename,record in documents.items():
        for sub in record.get('subregions',[]):
            if sub['id'] in admin:sub['administrative']=True
        write(OUT/filename,record)
        keys={record['id']}|{s['id'] for s in record.get('subregions',[])}|{p['id'] for p in record.get('places',[])}
        missing=keys-entries.keys()
        if missing:raise ValueError(f'{filename}: missing content {missing}')
        write(OUT/'content'/filename,{'version':VERSION,'entries':{k:entries[k] for k in keys}})
    index['version']=VERSION;write(OUT/'manifest.json',index)
    for filename in {entry['file'] for entry in original.values()}:
        record=read(OUT/filename)
        for sub in record.get('subregions',[]):
            if sub['id'] in admin:sub['administrative']=True
        write(OUT/filename,record)
    all_content=read(OUT/'content.json');all_content['entries']=entries;write(OUT/'content.json',all_content)
    write(RELIEF/'atlas.json',atlas)
    print('Published coverage:',len(documents),'additional plates;',len(index['regions']),'entry keys',flush=True)

if __name__=='__main__':main()
