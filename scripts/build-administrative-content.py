"""Sourced administrative-centre and place content for every cultural member.

Uses existing licensed text/photos, Wikidata's documented WGS84 coordinates,
and Wikipedia locality articles. Cultural essays remain a separate dataset.
"""
from __future__ import annotations
import argparse, concurrent.futures, copy, gzip, hashlib, importlib.util, json, math, re, threading, time
from pathlib import Path
from urllib.parse import urlencode, urlparse, unquote
from shapely.geometry import Point, shape
import requests

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/maps/administrative'
CACHE=ROOT/'.render-work/region-content/administrative'
spec=importlib.util.spec_from_file_location('content_builder',ROOT/'scripts/build-region-content.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
base.OUT=OUT
_network=threading.local()

def cached_fetch(url,binary=False):
    """Reuse TLS connections and resume the existing public-source cache."""
    path=base.CACHE/(hashlib.sha256(url.encode()).hexdigest()+('.bin' if binary else '.json'))
    if path.exists():data=path.read_bytes()
    else:
        if not hasattr(_network,'session'):
            _network.session=requests.Session();_network.session.headers['User-Agent']=base.UA
        for attempt in range(7):
            try:
                response=_network.session.get(url,timeout=(20,60))
                response.raise_for_status();data=response.content
                if not binary:json.loads(data)
                path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
                break
            except (requests.RequestException,ValueError):
                if attempt==6:raise
                time.sleep(min(30,3*(attempt+1)))
    return data if binary else json.loads(data)

base.fetch=cached_fetch

def read(p):return json.loads(Path(p).read_text(encoding='utf-8-sig'))
def write(p,value):
    p=Path(p);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def label(en,cn):return {'en':en,'zh-CN':base.SIMP.convert(cn),'zh-TW':base.TRAD.convert(cn)}
def slug(key):return key.lower().replace(':','-')

def inventory():
    manifest=read(ROOT/'assets/maps/regions/manifest.json');members={};units={}
    for key,r in manifest['regions'].items():
        if ':cultural:' not in key:continue
        detail=read(ROOT/'assets/maps/regions'/r['file'])
        members[detail['id']]=[u['id'] for u in detail.get('subregions',[])]
        for u in detail.get('subregions',[]):units[u['id']]={k:v for k,v in u.items() if k in ('id','name','label','country')}
    return units,members

def article_title(entry,language='en'):
    for source in entry.get('textSources',[]):
        if source.startswith('https://'+language+'.wikipedia.org/wiki/'):
            return unquote(source.split('/wiki/',1)[1]).replace('_',' ')
    return entry['label'].get(language,entry['label'].get('zh-CN'))

def article_entities(titles,language='en'):
    result={};titles=sorted(set(titles))
    for offset in range(0,len(titles),40):
        batch=titles[offset:offset+40]
        args=dict(action='query',format='json',redirects=1,titles='|'.join(batch),prop='pageprops',ppprop='wikibase_item')
        q=base.fetch(f'https://{language}.wikipedia.org/w/api.php?'+urlencode(args)).get('query',{})
        aliases={x['from']:x['to'] for key in ['normalized','converted','redirects'] for x in q.get(key,[])}
        found={p['title']:p.get('pageprops',{}).get('wikibase_item') for p in q.get('pages',{}).values()}
        for title in batch:
            target=title
            for _ in range(6):target=aliases.get(target,target)
            if found.get(target):result[title]=found[target]
    return result

def entities(qids):
    result={};qids=sorted(set(q for q in qids if q))
    for offset in range(0,len(qids),40):
        args=dict(action='wbgetentities',format='json',ids='|'.join(qids[offset:offset+40]),
                  props='claims|labels|sitelinks',languages='en|zh|zh-hans|zh-hant',sitefilter='enwiki|zhwiki')
        result.update(base.fetch('https://www.wikidata.org/w/api.php?'+urlencode(args)).get('entities',{}))
        print(f'Wikidata: {min(offset+40,len(qids))}/{len(qids)}',flush=True)
    return result

def values(entity,property):
    claims=[c for c in entity.get('claims',{}).get(property,[]) if c.get('rank')!='deprecated'
            and not c.get('qualifiers',{}).get('P582') and c.get('mainsnak',{}).get('snaktype')=='value']
    preferred=[c for c in claims if c.get('rank')=='preferred']
    return [c['mainsnak']['datavalue']['value'] for c in preferred or claims]

def coordinate(entity):
    for value in values(entity,'P625'):
        if value.get('globe','').endswith('/Q2'):
            return [value['longitude'],value['latitude']]

def entity_label(entity,fallback):
    ls=entity.get('labels',{});en=ls.get('en',{}).get('value') or fallback['en']
    cn=next((ls[l]['value'] for l in ['zh-hans','zh','zh-hant'] if l in ls),fallback['zh-CN'])
    return label(en,cn)

def distance(a,b):
    lat=math.radians((a[1]+b[1])/2)
    return math.hypot((a[0]-b[0])*111.32*math.cos(lat),(a[1]-b[1])*111.32)

def mainland_sources():
    features={}
    for p in ['china_city_full.json','china_100000_full.json']:
        for f in read(ROOT/'assets/maps'/p)['features']:
            features[str(f['properties']['adcode'])]=f
    return features

def build_focus(only=None):
    units,members=inventory();content=read(ROOT/'assets/maps/regions/content.json')['entries']
    selected={k:v for k,v in units.items() if k.isdigit() and (not only or k in only)}
    titles={k:article_title(content[k]) for k in selected};ids=article_entities(titles.values())
    missing=[k for k in selected if titles[k] not in ids]
    zh_ids=article_entities([article_title(content[k],'zh') for k in missing],'zh') if missing else {}
    qids={k:ids.get(titles[k]) or zh_ids.get(article_title(content[k],'zh')) for k in selected}
    es=entities(qids.values());seat_ids={}
    for k,q in qids.items():
        capitals=values(es.get(q,{}),'P36')
        if capitals:seat_ids[k]=capitals[0]['id']
    seats=entities(seat_ids.values());features=mainland_sources();focus={};issues=[]
    for key in selected:
        entry=content[key];entity=es.get(qids.get(key),{});seat=seats.get(seat_ids.get(key),{})
        # Municipal offices can move far from the principal urban core (e.g.
        # Beijing/Tongzhou). City entities take precedence; autonomous areas
        # and counties instead use a documented seat where one is available.
        is_city=entry['label']['zh-CN'].endswith('市') or key in ['810000','820000']
        chosen=entity if is_city and coordinate(entity) else seat if coordinate(seat) else entity
        point=coordinate(chosen)
        kind='administrative-seat' if chosen is seat else 'city-centre'
        if not point:
            issues.append({'id':key,'problem':'no documented WGS84 coordinate','qid':qids.get(key)})
            continue
        place=entity_label(chosen,entry['label']);source='https://www.wikidata.org/wiki/'+chosen['id']
        comparison=features.get(key,{}).get('properties',{}).get('center')
        geom=features.get(key,{}).get('geometry')
        deviation=distance(point,comparison) if comparison else None
        inside=shape(geom).buffer(.015).covers(Point(*point)) if geom else True
        if not inside or (deviation and deviation>35):
            issues.append({'id':key,'problem':'urban centre needs review','qid':chosen['id'],
                           'label':place,'lngLat':point,'inside':inside,'distanceFromDataVReferenceKm':deviation})
        extent=48 if key in ['110000','310000','500000'] else 36 if key in ['120000','440100','440300'] else 24
        definition=label(f'A {extent} km landscape window centred on {place["en"]}.',f'以{place["zh-CN"]}的地理坐标为中心，展示周边约{extent}公里宽的城区与地形。')
        focus[key]={'label':place,'lngLat':point,'kind':kind,'definition':definition,
                    'coordinateSource':source+'#P625','source':source,'extentKm':extent,
                    'coordinateSystem':'WGS84','selectionSource':'https://www.wikidata.org/wiki/'+qids[key]+('#P36' if chosen is seat else '#P625'),
                    'review':{'insideAdministrativeOutline':inside,'referenceDistanceKm':round(deviation,2) if deviation is not None else None}}
    path=OUT/'focus.json';previous=read(path) if path.exists() else {'version':'20261116-administrative','units':{}}
    previous['units'].update(focus);write(path,previous);write(CACHE/'focus-issues.json',issues)
    write(CACHE/'wikidata-unit-ids.json',qids)
    print(json.dumps({'focusUnits':len(focus),'issues':issues},ensure_ascii=False),flush=True)

EXTERNAL_CENTRES={
 'MNG':('Ulaanbaatar','乌兰巴托',40),'RUS:Tuva':('Kyzyl','克孜勒',24),
 'NPL':('Kathmandu','加德满都',24),'BTN':('Thimphu','廷布',16),
 'IND:Ladakh':('Leh','列城',16),'IND:Sikkim':('Gangtok','甘托克',16),
 'IND:LahaulSpiti':('Keylong','凯隆',12),
 'TW-ILA':('Yilan City','宜兰市',16),'TW-CHA':('Changhua','彰化市',16),
 'TW-NAN':('Nantou City','南投市',16),'TW-YUN':('Douliu','斗六市',16),
 'TW-KEE':('Keelung','基隆市',16),'TW-TPE':('Taipei','台北市',32),
 'TW-NWT':('Banqiao District','板桥区',24),'TW-TXG':('Taichung','台中市',32),
 'TW-TNN':('Anping District','安平区',24),'TW-TAO':('Taoyuan District','桃园区',24),
 'TW-MIA':('Miaoli','苗栗市',16),'TW-CYI':('Chiayi','嘉义市',16),
 'TW-CYQ':('Taibao','太保市',16),'TW-KHH':('Lingya District','苓雅区',32),
 'TW-TTT':('Taitung City','台东市',16),'TW-HUA':('Hualien City','花莲市',16),
 'TW-PEN':('Magong','马公市',12),'TW-HSZ':('Hsinchu','新竹市',24),
 'TW-HSQ':('Zhubei','竹北市',16),'TW-PIF':('Pingtung City','屏东市',16),
 'TW-KIN':('Jincheng, Kinmen','金城镇',12),'TW-LIE':('Nangan, Lienchiang','南竿乡',8),
 'TWN:Wuqiu':('Wuqiu, Kinmen','乌坵',3),'TWN:Dongsha':('Pratas Island','东沙岛',4),
 'TWN:Taiping':('Taiping Island','太平岛',2),
}

def external_focus():
    titles=[r[0] for r in EXTERNAL_CENTRES.values()];ids=article_entities(titles);es=entities(ids.values())
    existing=read(ROOT/'assets/maps/regions/content.json')['entries'];focus=read(OUT/'focus.json')
    for key,(title,chinese,extent) in EXTERNAL_CENTRES.items():
        entity=es.get(ids.get(title),{});point=coordinate(entity)
        if not point:raise ValueError('Missing external centre: '+key+' / '+title)
        island=key.startswith('TWN:');place=label(title,chinese);source='https://www.wikidata.org/wiki/'+entity['id']
        definition=label(f'A {extent} km landscape window around {title}.',
                         f'以{chinese}为中心，展示周边约{extent}公里宽的'+('岛屿地形。' if island else '主要聚落与地形。'))
        focus['units'][key]={'label':place,'lngLat':point,'kind':'island-detail' if island else 'principal-settlement',
            'definition':definition,'extentKm':extent,'coordinateSystem':'WGS84',
            'source':source,'coordinateSource':source+'#P625','selectionSource':existing[key]['source']}
    write(OUT/'focus.json',focus)
    print('External centres:',len(EXTERNAL_CENTRES),flush=True)

def apply_focus_overrides():
    path=ROOT/'scripts/administrative-focus-overrides.json'
    if not path.exists():return
    focus=read(OUT/'focus.json')
    for key,record in read(path).items():
        focus['units'][key].update(record)
        focus['units'][key].pop('review',None)
    write(OUT/'focus.json',focus)

def locality_markup(titles,language='zh'):
    result={};titles=sorted(set(titles))
    for offset in range(0,len(titles),15):
        batch=titles[offset:offset+15]
        args=dict(action='query',format='json',redirects=1,titles='|'.join(batch),
                  prop='revisions',rvprop='content',rvslots='main')
        q=base.fetch(f'https://{language}.wikipedia.org/w/api.php?'+urlencode(args)).get('query',{})
        aliases={x['from']:x['to'] for key in ['normalized','converted','redirects'] for x in q.get(key,[])}
        found={p['title']:p.get('revisions',[{}])[0].get('slots',{}).get('main',{}).get('*','') for p in q.get('pages',{}).values()}
        for title in batch:
            target=title
            for _ in range(6):target=aliases.get(target,target)
            if found.get(target):result[title]=found[target]
        print(f'{language} locality articles: {min(offset+15,len(titles))}/{len(titles)}',flush=True)
    return result

def discover_places():
    units,_=inventory();content=read(ROOT/'assets/maps/regions/content.json')['entries']
    titles={k:article_title(content[k],'zh') for k in units};texts=locality_markup(titles.values())
    candidates={}
    landmark=re.compile(r'山|湖|公园|公園|园林|園林|寺|古城|塔|博物馆|博物館|纪念馆|紀念館|遗址|遺址|古镇|古鎮|洞|瀑|峡|峽|祠|桥|橋|书院|書院|故居|长城|長城|樓|楼|湿地|濕地|城墙|城牆|陵|墓|堂|庙|廟|海滩|海灘|水库|水庫|风景|風景|保护区|保護區')
    exclude=re.compile(r'^(?:File|Image|Category|文件|檔案|图像|圖像|分类|分類|模板|Template):|省$|市$|县$|縣$|市辖区$|市轄區$|自治|大學|大学|铁路|鐵路|站$|公路|高速|战役|戰役|事件|奖$|獎$|委员会|委員會|列表|名录|名錄')
    for key,title in titles.items():
        text=texts.get(title,'');sections=list(re.finditer(r'(?m)^={2,5}\s*([^=]+?)\s*={2,5}\s*$',text));preferred=[]
        for n,m in enumerate(sections):
            if re.search('旅[游遊]|景[点點观觀]|名[胜勝]|古[迹蹟]|遺[產址]|遗[产址]|文化|觀光|观光',m.group(1)):
                preferred.append(text[m.end():sections[n+1].start() if n+1<len(sections) else len(text)])
        pool='\n'.join(preferred)+'\n'+text[:text.find('\n==') if '\n==' in text else len(text)]
        # A link in the locality's sightseeing/culture section is a candidate,
        # never a verified place: coordinates and photographs are checked later.
        found=[]
        for linked in re.findall(r'\[\[([^\[\]|#]+)',pool):
            linked=linked.strip()
            if linked not in found and 2<=len(linked)<=35 and landmark.search(linked) and not exclude.search(linked):found.append(linked)
        candidates[key]=found[:14]
    write(CACHE/'place-candidates.json',candidates)
    print('Candidates:',sum(map(len,candidates.values())),'units with candidates',sum(bool(v) for v in candidates.values()),flush=True)

def collect_candidate_articles():
    candidates=read(CACHE/'place-candidates.json')
    titles={title for values in candidates.values() for title in values}
    pages=base.pages(titles,'zh')
    write(CACHE/'candidate-articles.json',pages)
    print('Candidate article records:',len(pages),flush=True)

def build_candidate_places():
    candidates=read(CACHE/'place-candidates.json');zh=read(CACHE/'candidate-articles.json')
    english={title:next((l['*'] for l in page.get('langlinks',[]) if l['lang']=='en'),None) for title,page in zh.items()}
    en=base.pages([t for t in english.values() if t],'en')
    source=read(ROOT/'assets/maps/regions/content.json')['entries'];focus=read(OUT/'focus.json')['units']
    geometries={f['properties']['id']:shape(f['geometry']) for f in json.loads(gzip.decompress((ROOT/'tools/relief-atlas/administrative/units-wgs84.geojson.gz').read_bytes()))['features']}
    selected={};summaries={};needs_translation=[]
    for key,titles in candidates.items():
        eligible=[]
        for priority,title in enumerate(titles):
            zp=zh.get(title,{});ep=en.get(english.get(title),{})
            coords=(ep.get('coordinates') or zp.get('coordinates') or [None])[0]
            if not coords:continue
            point=[coords['lon'],coords['lat']]
            inside=geometries[key].covers(Point(*point))
            near=distance(point,focus[key]['lngLat'])<focus[key]['extentKm']*.38
            if not inside and not (focus[key]['kind']=='administrative-seat-outside-display-outline' and near):continue
            photograph=next((p for p in [zp,ep] if base.acceptable_image(p)),None)
            if not photograph:continue
            eligible.append((priority,title,zp,ep,point,near,inside,photograph))
        choices=[]
        for subset in [[r for r in eligible if r[5]],[r for r in eligible if r[6]],eligible]:
            candidate=next((r for r in subset if r[1] not in {c[1] for c in choices}),None)
            if candidate:choices.append(candidate)
        for _,title,zp,ep,point,near,inside,photo in choices:
            pid='poi:admin:'+key+':'+hashlib.sha256(title.encode()).hexdigest()[:8]
            cn=base.SIMP.convert(zp.get('title',title));enname=ep.get('title') or title
            en_text=base.excerpt(ep.get('extract',''))
            if not en_text:
                kind=next((english_type for pattern,english_type in [(r'寺|廟|庙','temple'),(r'公园|公園','park'),(r'湖|水库|水庫','lake'),(r'塔|楼|樓','historic structure'),(r'博物馆|博物館','museum'),(r'桥|橋','bridge'),(r'故居','historic residence'),(r'古城|古镇|古鎮','historic settlement'),(r'山','mountain landscape'),(r'遗址|遺址|墓|陵','historic site')] if re.search(pattern,title)),'local landmark')
                en_text=f'{enname} is a {kind} in {source[key]["label"]["en"]}.'
                needs_translation.append({'id':pid,'title':title,'chinese':base.excerpt(zp.get('extract',''))})
            ztext=base.excerpt(zp.get('extract',''))
            if not ztext:continue
            entry={'label':label(enname,cn),'description':{'en':en_text,'zh-CN':base.SIMP.convert(ztext),'zh-TW':base.TRAD.convert(ztext)},
                   'source':zp.get('fullurl') or ep.get('fullurl'),'textSources':list(dict.fromkeys(p['fullurl'] for p in [zp,ep] if p.get('fullurl'))),
                   'textLicense':'CC BY-SA 4.0; excerpt shortened and script-converted.','textLicenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/',
                   'lngLat':point,'coordinateSource':(ep if ep.get('coordinates') else zp).get('fullurl'),
                   'kind':'landmark','role':'landmark','parentUnit':key}
            selected[pid]=(entry,photo);summaries[pid]={'parentUnit':key,'urban':near,'whole':inside}
    (OUT/'photos').mkdir(parents=True,exist_ok=True)
    metadata=base.image_metadata([p['pageimage'] for e,p in selected.values()]);entries={};errors=[]
    def job(item):
        pid,(entry,photo)=item
        try:
            entry['photo']=base.licensed_photograph(photo,metadata)
            return pid,entry,None
        except Exception as exc:return pid,None,str(exc)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for n,(pid,entry,error) in enumerate(pool.map(job,selected.items()),1):
            if entry:entries[pid]=entry
            else:errors.append({'id':pid,'error':error})
            if n%30==0:print('Local landmark photographs:',n,'/',len(selected),flush=True)
    base.normalize_display_names(entries)
    write(OUT/'landmark-entries.json',{'entries':entries})
    write(CACHE/'landmark-review.json',{'selected':summaries,'needsTranslation':needs_translation,'errors':errors})
    print('Licensed named landmarks:',len(entries),'errors:',len(errors),flush=True)

def collect_geotagged_photos():
    """Find photographs with published camera/subject coordinates near each core."""
    focus=read(OUT/'focus.json')['units'];selected={k:v for k,v in focus.items() if k.isdigit()}
    result={};errors=[]
    def job(item):
        key,f=item;lon,lat=f['lngLat']
        radius=min(10000,int(f['extentKm']*350))
        args=dict(action='query',format='json',list='geosearch',gscoord=f'{lat}|{lon}',
                  gsradius=radius,gsnamespace=6,gslimit=50)
        try:
            response=cached_fetch('https://commons.wikimedia.org/w/api.php?'+urlencode(args))
            if response.get('error'):raise ValueError(response['error'])
            return key,[p for p in response.get('query',{}).get('geosearch',[]) if base.acceptable_image({'pageimage':p['title'][5:]})],None
        except Exception as exc:return key,[],str(exc)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for n,(key,photos,error) in enumerate(pool.map(job,selected.items()),1):
            result[key]=photos
            if error:errors.append({'id':key,'error':error})
            if n%25==0:print('Geotagged locality photos:',n,'/',len(selected),flush=True)
    write(CACHE/'geotagged-photos.json',result);write(CACHE/'geotagged-errors.json',errors)
    print('Geotagged photo coverage',sum(bool(v) for v in result.values()),'/',len(result),'errors',len(errors),flush=True)

def import_curated(paths):
    target=OUT/'curated-landmark-entries.json';document=read(target) if target.exists() else {'entries':{}}
    for path in paths:document['entries'].update(read(path)['entries'])
    base.normalize_display_names(document['entries']);write(target,document)

def all_entries():
    result=read(ROOT/'assets/maps/regions/content.json')['entries']
    for filename in ['landmark-entries.json','geotagged-landmark-entries.json','curated-landmark-entries.json']:
        p=OUT/filename
        if p.exists():result.update(read(p)['entries'])
    translations=ROOT/'scripts/administrative-landmark-translations.json'
    if translations.exists():
        for key,value in read(translations).items():
            if key not in result:continue
            result[key]['label']['en']=value['label_en']
            result[key]['description']['en']=value['description_en']
    rejected=ROOT/'scripts/administrative-rejected-photos.json'
    if rejected.exists():
        for key in read(rejected):result.pop(key,None)
    coordinates=ROOT/'scripts/administrative-place-coordinate-overrides.json'
    if coordinates.exists():
        for key,value in read(coordinates).items():
            if key in result:result[key].update(value)
    captions=ROOT/'scripts/administrative-caption-overrides.json'
    if captions.exists():
        for key,value in read(captions).items():
            if key in result:result[key].update(value)
    for entry in result.values():
        photo=entry.get('photo',{})
        if entry.get('kind')=='landmark' and photo.get('type')=='satellite':
            entry['textKind']='editorial-locality'
            entry['textLicense']='Original editorial description of the dated NASA/USGS satellite observation.'
            entry['source']='https://hls.gsfc.nasa.gov/data-access-and-tools/'
            entry['textSources']=[entry['source'],photo['source']]
            place=entry['label']['en'].split(' · ')[0]
            entry['description']['en']=f'A true-color Landsat observation of {place} on {photo["date"]}. Its 30-metre resolution shows the urban pattern and surrounding landforms.'
    return result


def import_translations(paths):
    target=ROOT/'scripts/administrative-landmark-translations.json'
    merged=read(target) if target.exists() else {}
    for filename in paths:merged.update(read(filename))
    write(target,merged)
    print(f'English editorial translations: {len(merged)}',flush=True)

def build_geotagged_places():
    """Fill an empty urban view with an actual, publicly located scene photograph.

    These are explicitly photograph locations, not invented named attractions.
    A photographed cityscape is never attached to an arbitrary city centroid.
    """
    units,_=inventory();entries=all_entries();focus=read(OUT/'focus.json')['units']
    manifest=read(OUT/'manifest.json')['units'];candidates=read(CACHE/'geotagged-photos.json')
    geometries={f['properties']['id']:shape(f['geometry']) for f in json.loads(gzip.decompress((ROOT/'tools/relief-atlas/administrative/units-wgs84.geojson.gz').read_bytes()))['features']}
    needed=[]
    for key,record in manifest.items():
        if not key.isdigit():continue
        document=read(ROOT/record['file'])
        if not document['views']['urban'].get('places'):needed.append(key)
    excluded=re.compile(r'ISS\d|STS\d|View of Earth|satellite|Landsat|SRTM|ASTER|earthquake|locator|地震|地图|地圖|示意|\bmap\b|\bplan\b|\broute\b|portrait|selfie|cosplay|肖像|合影|婚礼|婚禮|\.pdf$|\.tif',re.I)
    preferred=re.compile(r'公园|公園|寺|庙|廟|桥|橋|塔|城门|城門|博物馆|博物館|广场|廣場|街|湖|河|楼|樓|historic|temple|museum|pagoda|square|street|park|bridge|old town|cathedral',re.I)
    choices={}
    for key in needed:
        f=focus[key];pool=[]
        for item in candidates.get(key,[]):
            if excluded.search(item['title']):continue
            point=[item['lon'],item['lat']]
            if distance(point,f['lngLat'])>f['extentKm']*.35:continue
            if not geometries[key].covers(Point(*point)) and f['kind']!='administrative-seat-outside-display-outline':continue
            pool.append(item)
        pool.sort(key=lambda p:(not bool(preferred.search(p['title'])),p['dist']))
        choices[key]=pool[:6]
    metadata=base.image_metadata([p['title'][5:] for values in choices.values() for p in values])
    output={};missing=[];errors=[]
    for key,items in choices.items():
        accepted=None
        for p in items:
            name=p['title'][5:];meta=metadata.get(name.replace('_',' '),{})
            description=base.plain(meta.get('extmetadata',{}).get('ImageDescription',{}).get('value',''))
            if excluded.search(description) or re.search(r'inscription|plaque|poster|information board|标牌|標牌|介绍牌|介紹牌|説明板|说明牌|說明牌',description,re.I):continue
            try:photo=base.licensed_photograph({'pageimage':name,'title':name},metadata)
            except Exception as exc:errors.append({'id':key,'file':name,'error':str(exc)});continue
            pid=f'poi:admin:{key}:photo-{p["pageid"]}'
            title=re.sub(r'\.(?:jpe?g|png|webp)$','',name,flags=re.I).replace('_',' ')
            title=re.sub(r'\s*-?\s*panoramio|\s*\(\d{6,}\)|^\d{6,}[-_ ]*','',title,flags=re.I).strip()
            cn=base.SIMP.convert(title) if re.search('[\u3400-\u9fff]',title) and len(title)<40 else entries[key]['label']['zh-CN']+'城区景观'
            en=title if not re.search('[\u3400-\u9fff]',title) and len(title)<85 else entries[key]['label']['en']+' landscape view'
            text_cn=f'这张实景照片呈现{entries[key]["label"]["zh-CN"]}城区周边的地方景观，为观察当地的街巷、建筑与自然环境提供一个现场视角。'
            photo['type']='field-photograph';photo['publishedLocation']={'lngLat':[p['lon'],p['lat']],'source':photo['source']}
            accepted={'label':label(en,cn),'description':label(f'A local landscape view from the urban area of {entries[key]["label"]["en"]}, offering a closer look at its surroundings.',text_cn),
                'source':photo['source'],'textSources':[photo['source']],'textKind':'editorial-locality',
                'textLicense':'Original editorial scene caption. Photograph location and description documented on the linked Commons file page.',
                'photo':photo,'lngLat':[p['lon'],p['lat']],'coordinateSource':photo['source'],
                'coordinateDerivation':'Published Wikimedia Commons GeoData coordinate attached to this photograph; not a substituted city centre.',
                'kind':'landmark','role':'photo-location','parentUnit':key}
            output[pid]=accepted;break
        if accepted is None:missing.append(key)
    target=OUT/'geotagged-landmark-entries.json';old=read(target)['entries'] if target.exists() else {};old.update(output)
    base.normalize_display_names(old);write(target,{'entries':old})
    write(CACHE/'geotagged-selection-report.json',{'needed':needed,'added':len(output),'missing':missing,'errors':errors})
    print(json.dumps({'geotaggedPhotosAdded':len(output),'missing':missing,'errors':len(errors)},ensure_ascii=False),flush=True)

def emit_content():
    units,members=inventory();entries=all_entries()
    focus=read(OUT/'focus.json')['units'];all_places=[]
    for pid,entry in entries.items():
        parent=entry.get('parentUnit') or entry.get('parentCity')
        if entry.get('kind')=='landmark' and parent in units and entry.get('lngLat'):
            all_places.append({'id':pid,'parentUnit':parent,'label':entry['label'],'lngLat':entry['lngLat'],
                'coordinateSource':entry.get('coordinateSource') or entry.get('source'),'role':entry.get('role','landmark')})
    for key in units:
        if key not in focus:continue
        local={key:copy.deepcopy(entries[key])};local[key]['urbanFocus']=focus[key]
        children={'TW-KIN':['TWN:Wuqiu'],'TW-KHH':['TWN:Dongsha','TWN:Taiping']}.get(key,[])
        for child in children:local[child]=copy.deepcopy(entries[child])
        relevant=[p for p in all_places if p['parentUnit'] in [key,*children]]
        for point in relevant:local[point['id']]=copy.deepcopy(entries[point['id']])
        # A verified local scene replaces incidental images in an administrative
        # article's sidebar. In particular, northern Xinjiang scenery must never
        # be used as an unrelated southern Xinjiang city's hero photograph.
        own=[p for p in relevant if p['parentUnit']==key and entries[p['id']].get('photo')]
        own.sort(key=lambda p:(not p['id'].endswith(':satellite'),not p['id'].endswith(':urban'),
                              entries[p['id']].get('role')=='photo-location',
                              distance(p['lngLat'],focus[key]['lngLat'])))
        if own:local[key]['photo']=copy.deepcopy(entries[own[0]['id']]['photo']);local[key]['photoReference']=own[0]['id']
        base.normalize_display_names(local)
        write(OUT/'content'/(slug(key)+'.json'),{'version':'20261116-administrative','entries':local})
    write(OUT/'places.json',all_places)


def sync_region_photos():
    """Keep culture-member cards and the administrative article on the same image."""
    units,_=inventory();references={}
    for key in units:
        entry=read(OUT/'content'/(slug(key)+'.json'))['entries'][key]
        if not entry.get('photoReference'):raise ValueError('Unreviewed administrative hero: '+key)
        references[key]={'photo':entry['photo'],'photoReference':entry['photoReference']}
    write(ROOT/'scripts/administrative-unit-photo-overrides.json',references)
    master=ROOT/'assets/maps/regions/content.json';document=read(master)
    for key,fields in references.items():document['entries'][key].update(fields)
    base.normalize_display_names(document['entries'])
    master.write_text(json.dumps(document,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print('Administrative member hero photos synchronized:',len(references),flush=True)


def prune_unused_photos():
    """Remove only this pipeline's downloaded candidates absent from every page."""
    used=set()
    documents=[ROOT/'assets/maps/regions/content.json',*sorted((OUT/'content').glob('*.json'))]
    for path in documents:
        for entry in read(path).get('entries',{}).values():
            if entry.get('photo'):used.add((ROOT/entry['photo']['src']).resolve())
    photo_root=(OUT/'photos').resolve();removed=[]
    for path in photo_root.glob('*.webp'):
        resolved=path.resolve()
        if resolved.parent!=photo_root:raise ValueError('Photo cleanup escaped its directory')
        if resolved not in used:
            removed.append(path.relative_to(ROOT).as_posix());path.unlink()
    write(CACHE/'unused-photo-cleanup.json',{'removed':removed})
    print('Unused administrative photo candidates removed:',len(removed),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--focus',action='store_true');parser.add_argument('--only',nargs='*');parser.add_argument('--emit-content',action='store_true');parser.add_argument('--external-focus',action='store_true');parser.add_argument('--discover-places',action='store_true');parser.add_argument('--collect-candidates',action='store_true');parser.add_argument('--build-candidate-places',action='store_true');parser.add_argument('--collect-geotagged',action='store_true');parser.add_argument('--import-curated',nargs='*');parser.add_argument('--build-geotagged',action='store_true')
    parser.add_argument('--import-translations',nargs='*')
    parser.add_argument('--sync-region-photos',action='store_true')
    parser.add_argument('--prune-photos',action='store_true')
    args=parser.parse_args()
    if args.focus:build_focus(args.only)
    if args.external_focus:external_focus()
    if args.discover_places:discover_places()
    if args.collect_candidates:collect_candidate_articles()
    if args.build_candidate_places:build_candidate_places()
    if args.collect_geotagged:collect_geotagged_photos()
    if args.import_curated:import_curated(args.import_curated)
    if args.import_translations:import_translations(args.import_translations)
    if args.build_geotagged:build_geotagged_places()
    if args.focus or args.external_focus or args.emit_content:apply_focus_overrides()
    if args.emit_content:emit_content()
    if args.sync_region_photos:sync_region_photos()
    if args.prune_photos:prune_unused_photos()
