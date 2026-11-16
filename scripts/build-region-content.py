#!/usr/bin/env python3
"""Cache sourced encyclopedic text and licensed locality photographs for the atlas.

Dependencies: pillow, opencc-python-reimplemented. API responses are cached in
.render-work/region-content; published images are resized WebP, with attribution
and the original Commons description/license preserved in content.json.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, html, io, json, math, re, time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from PIL import Image, ImageOps
from opencc import OpenCC

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/maps/regions'
CACHE = ROOT / '.render-work/region-content'
UA = 'RundeFootprintAtlas/1.0 (https://sjtufreshman.github.io; educational geography)'
SIMP, TRAD = OpenCC('t2s'), OpenCC('s2t')

# A locality photograph is a reference image, never a claim that the author took
# it or visited that particular attraction. These overrides favor landscapes
# over flags, locator maps and government buildings.
PHOTO_ARTICLES = {
 '110000':'Forbidden City', '130300':'Shanhai Pass', '130800':'Chengde Mountain Resort',
 '140100':'Jinci', '141000':'Hukou Waterfall', '150400':'Hexigten Global Geopark',
 '210700':'Bijia Mountain', '211400':'Xingcheng', '230100':'Saint Sophia Cathedral, Harbin',
 '230900':'Qitaihe', '231000':'Jingpo Lake', '310000':'The Bund',
 '320100':'Purple Mountain', '320200':'Lake Tai', '320500':"Humble Administrator's Garden",
 '321000':'Slender West Lake', '330100':'West Lake', '330400':'Wuzhen', '330600':'East Lake (Shaoxing)',
 '360200':'Jingdezhen', '360400':'Mount Lu', '370200':'Laoshan', '410200':'Iron Pagoda',
 '410300':'Longmen Grottoes', '420100':'Yellow Crane Tower', '500000':'Hongya Cave',
 '510100':'Dujiangyan', '610100':'Giant Wild Goose Pagoda', '610400':'Qianling Mausoleum',
 '610600':"Yan'an", '610800':'Zhenbeitai', '620100':'Zhongshan Bridge', '630100':'Kumbum Monastery',
 '630200':'Qutan Monastery', '632200':'Qilian Mountains', '632500':'Qinghai Lake',
 '632800':'Chaka Salt Lake', '640100':'Western Xia mausoleums',
 'MNG':'Orkhon Valley', 'RUS:Tuva':'Ubsunur Hollow', 'NPL':'Kathmandu Durbar Square',
 'IND:Ladakh':'Thikse Monastery', 'IND:Sikkim':'Lake Tsomgo',
 'TW-KIN':'Juguang Tower', 'TW-LIE':'Qinbi Village', 'TW-PEN':'Twin-Hearts Stone Weir',
 'TWN:Dongsha':'Pratas Island', 'TWN:Taiping':'Taiping Island',
 'TWN:Wuqiu':'Wuqiu, Kinmen', 'TWN:Zhongzhou':'Zhongzhou Reef',
 '810000':'Victoria Harbour','820000':'Senado Square',
 '220600':'Heaven Lake','220700':'Chagan Lake',
 'poi:TW-NAN:1':'Sun Moon Lake',
}
CULTURE_ARTICLES = dict(zip([
 'yanzhao','jin','dongbei-mongdong','mongolian-steppe','liaodong','wuyue','jianghuai','huaihai',
 'huizhou','wanjiang','min-north','min-central','puxian','min-south','min-east','gan','qilu',
 'zhongyuan','jingchu','huxiang','xiangxi','guangfu','hakka','chaoshan','hailufeng','gaoliang',
 'qiong','guiliu','zhuang','qinlian','bashu','panxi','qian','dian','dian-south','dian-west',
 'qingzang','guanzhong','shanbei','shannan','hexi','hehuang','ningxia','xinjiang-north',
 'xinjiang-east','xinjiang-south','taiwan'],[
 '河北省','山西省','满洲','蒙古高原','胶东半岛','江南','江淮','淮海地区',
 '徽州','安徽省','闽北','三明市','莆田市','闽南','福州市','江西省','山东省',
 '中原','楚文化','湖湘文化','武陵山脉','广府文化','客家文化','潮汕文化','海陆丰','高州市',
 '雷州半岛','桂林市','壮族','北海市','巴蜀文化','攀西地区','贵州省','昆明市','西双版纳傣族自治州','大理白族自治州',
 '青藏高原','关中','陕北','秦岭','河西走廊','河湟','宁夏回族自治区','准噶尔盆地',
 '吐鲁番市','塔里木盆地','台灣']))
EXTRA = {
 'MNG':('蒙古国','Mongolia'), 'RUS:Tuva':('图瓦共和国','Tuva'), 'NPL':('尼泊尔','Nepal'),
 'IND:Ladakh':('拉达克','Ladakh'), 'IND:Sikkim':('锡金邦','Sikkim'),
 'TWN:Dongsha':('东沙岛','Pratas Island'), 'TWN:Taiping':('太平岛','Taiping Island'),
 'TWN:Wuqiu':('烏坵鄉','Wuqiu, Kinmen'), 'TWN:Zhongzhou':('中洲礁','Zhongzhou Reef'),
}
SECONDARY_POIS = {
 '110000':'Temple of Heaven','130300':'Beidaihe District','130800':'Putuo Zongcheng Temple',
 '140100':'Twin Pagoda Temple','141000':'Guangsheng Temple','150400':'Dali Lake',
 '210700':'Fengguo Temple','211400':'Jiumenkou','230100':'Harbin Grand Theatre',
 '230900':'Qitaihe railway station','231000':'Xuexiang','310000':'Yu Garden',
 '320100':'Sun Yat-sen Mausoleum','320200':'Lingshan Grand Buddha','320500':'Tiger Hill',
 '321000':'Daming Temple','330100':'Lingyin Temple','330400':'Xitang','330600':'Orchid Pavilion',
 '360200':'Yaoli, Jiangxi','360400':'Donglin Temple','370200':'Zhanqiao',
 '410200':'Dragon Pavilion','410300':'White Horse Temple','420100':'East Lake (Wuhan)',
 '500000':'Dazu Rock Carvings','510100':'Mount Qingcheng','610100':'Terracotta Army',
 '610400':'Han Yang Ling','610600':'Huangdi Mausoleum','610800':'Hongjiannao Lake',
 '620100':'Five Springs Mountain','630100':'Dongguan Mosque','630200':'Lijiaxia Dam',
 '632200':'Qinghai Lake','632500':'Longyangxia Dam','632800':'Qaidam Basin','640100':'Haibao Pagoda',
}
CHINESE_POIS = {
 '110000':('故宫','天坛'),'130300':('山海关','北戴河区'),'130800':('承德避暑山庄','普陀宗乘之庙'),
 '140100':('晋祠','永祚寺'),'141000':('壶口瀑布','广胜寺'),'150400':('克什克腾世界地质公园','达里诺尔湖'),
 '210700':('笔架山 (锦州)','奉国寺'),'211400':('兴城市','九门口'),'230100':('圣索菲亚教堂 (哈尔滨)','哈尔滨大剧院'),
 '230900':('七台河市','七台河站'),'231000':('镜泊湖','中国雪乡'),'310000':('外滩','豫园'),
 '320100':('紫金山','中山陵'),'320200':('太湖','灵山大佛'),'320500':('拙政园','虎丘'),
 '321000':('瘦西湖','大明寺 (扬州)'),'330100':('西湖','灵隐寺'),'330400':('乌镇','西塘镇'),
 '330600':('东湖 (绍兴)','兰亭'),'360200':('景德镇市','瑶里镇'),'360400':('庐山','东林寺'),
 '370200':('崂山','青岛栈桥'),'410200':('铁塔 (开封)','龙亭'),'410300':('龙门石窟','白马寺'),
 '420100':('黄鹤楼','东湖 (武汉)'),'500000':('洪崖洞','大足石刻'),'510100':('都江堰','青城山'),
 '610100':('大雁塔','秦始皇兵马俑'),'610400':('乾陵','汉阳陵'),'610600':('延安市','黄帝陵 (黄陵县)'),
 '610800':('镇北台','红碱淖'),'620100':('中山桥 (兰州)','五泉山'),'630100':('塔尔寺','东关清真大寺'),
 '630200':('瞿昙寺','李家峡水电站'),'632200':('祁连山','青海湖'),'632500':('青海湖','龙羊峡水电站'),
 '632800':('茶卡盐湖','柴达木盆地'),'640100':('西夏王陵','海宝塔'),
}
EXTRA_POIS = {
 'MNG':('鄂尔浑河谷','Orkhon Valley'), 'RUS:Tuva':('乌布苏盆地','Ubsunur Hollow'),
 'NPL':('加德满都杜巴广场','Kathmandu Durbar Square'),
 'IND:Ladakh':('提克西寺','Thikse Monastery'), 'IND:Sikkim':('徐古湖','Lake Tsomgo'),
 'TW-KIN':('莒光楼','Juguang Tower'), 'TW-LIE':('芹壁村','Qinbi Village'),
 'TW-PEN':('双心石沪','Twin-Hearts Stone Weir'),
 'TW-TPE':('台北101','Taipei 101'), 'TW-HUA':('太鲁阁国家公园','Taroko National Park'),
 'TW-NAN':('日月潭','Sun Moon Lake'),
}
ZH_DESCRIPTIONS = {
 'TW-PEN':'澎湖群岛位于台湾海峡，由众多岛屿和小岛组成，隔澎湖水道与台湾本岛相望。各岛之间的海湾、渔港与水道，构成了这里的海洋聚落景观。',
 'poi:321000:2':'大明寺位于江苏扬州蜀冈中峰。鉴真曾在这里研习佛典、受戒，寺院也因此与中日佛教交流的历史相连。',
 'poi:410200:1':'铁塔位于河南开封的佑国寺，建于1049年。塔名来自砖面呈现的铁色，建筑本体并非铸铁结构。',
 'poi:IND:Sikkim:1':'徐古湖（Tsomgo Lake）是锡金甘托克地区的一座冰川湖，距甘托克约40公里，湖面海拔约3753米。',
}
PHOTO_FILES = {'poi:TW-NAN:1':('Sun-Moon-Lake-Taiwan.jpg','Sun Moon Lake')}
PHOTO_REUSE = {'320200':'poi:320200:2'}
ARTIST_OVERRIDES = {'LinShanDaFo.jpg':'Phoebus~commonswiki'}
COORDINATES = {
 '320200':([120.283333,31.566667],'Q42651'),
 'poi:230900:2':([130.894736,45.809387],'Q28409197'),
 'poi:500000:1':([106.574222517975,29.564780030167],'Q32171478'),
 'poi:610800:1':([109.7259445,38.3356428],'Q126951091'),
 'poi:TW-LIE:1':([119.98142,26.22283],'Q18658268'),
}

def fetch(url: str, binary=False):
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / (hashlib.sha256(url.encode()).hexdigest() + ('.bin' if binary else '.json'))
    if key.exists():
        value = key.read_bytes()
    else:
        for attempt in range(4):
            try:
                with urlopen(Request(url, headers={'User-Agent':UA}), timeout=45) as response:
                    value=response.read()
                key.write_bytes(value)
                break
            except Exception:
                if attempt == 3: raise
                time.sleep(1 + attempt * 2)
    return value if binary else json.loads(value)

def pages(titles, lang='zh'):
    titles = sorted(set(t for t in titles if t))
    result = {}
    article_cache=CACHE/'articles'/lang
    article_cache.mkdir(parents=True,exist_ok=True)
    def article_path(title): return article_cache/(hashlib.sha256(title.encode()).hexdigest()+'.json')
    remaining=[]
    for title in titles:
        path=article_path(title)
        if path.exists():
            value=json.loads(path.read_text(encoding='utf-8'))
            if value: result[title]=value
            else: remaining.append(title)
        else: remaining.append(title)
    titles=remaining
    for start in range(0, len(titles), 15):
        batch = titles[start:start+15]
        args = dict(action='query', format='json', redirects=1, titles='|'.join(batch),
                    prop='extracts|pageimages|coordinates|langlinks|info', inprop='url',
                    exintro=1, explaintext=1, exsentences=2, exlimit='max',
                    piprop='name|thumbnail', pithumbsize=640, pilimit='max',
                    coprimary='primary', colimit='max', lllang='en' if lang=='zh' else 'zh', lllimit='max')
        if lang=='zh': args['converttitles']=1
        data = fetch(f'https://{lang}.wikipedia.org/w/api.php?' + urlencode(args)).get('query', {})
        aliases = {x['from']:x['to'] for k in ('normalized','converted','redirects') for x in data.get(k,[])}
        found = {x['title']:x for x in data.get('pages',{}).values() if 'missing' not in x}
        for title in batch:
            target=title
            for _ in range(5): target=aliases.get(target,target)
            if target in found: result[title]=found[target]
            article_path(title).write_text(json.dumps(found.get(target),ensure_ascii=False),encoding='utf-8')
        print(f'{lang}: {min(start+15,len(titles))}/{len(titles)} articles', flush=True)
    return result

def plain(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', '', value or ''))).strip()

def excerpt(value):
    value=plain(value)
    # Pronunciation/transliteration parentheses overwhelm short geographic notes.
    for _ in range(3): value=re.sub(r'（[^（）]*）|\([^()]*\)', '', value)
    value=re.sub(r'\s+', ' ', value).strip()
    if len(value)>550:
        parts=re.split(r'(?<=[。.!?])\s*',value)
        value=parts[0]
        if len(value)>550: value=value[:547].rsplit(' ',1)[0]+'…'
    return value

def acceptable_image(page):
    name=page.get('pageimage','')
    return name and not re.search(r'\.svg$|\b(?:flag|logo|map|locator|location|emblem|coat|seal|montage|collage)\b|China.*\.png$|行政区|位置图|位置圖|区划|區劃|拼贴|拼貼',name.replace('_',' '),re.I)

def image_metadata(names):
    result={}
    names=sorted(set(names))
    for start in range(0,len(names),40):
        args=dict(action='query',format='json',titles='|'.join('File:'+n for n in names[start:start+40]),
                  prop='imageinfo',iiprop='url|extmetadata',iiurlwidth=640)
        data=fetch('https://commons.wikimedia.org/w/api.php?'+urlencode(args)).get('query',{})
        for p in data.get('pages',{}).values():
            if p.get('imageinfo'): result[p['title'][5:].replace('_',' ')]=p['imageinfo'][0]
    return result

def article_photograph(title,lang):
    args=dict(action='query',format='json',redirects=1,titles=title,prop='images',imlimit='max')
    data=fetch(f'https://{lang}.wikipedia.org/w/api.php?'+urlencode(args)).get('query',{})
    for page in data.get('pages',{}).values():
        for image in page.get('images',[]):
            name=image['title'][5:]
            candidate={'pageimage':name,'title':title}
            if re.search(r'\.(?:jpg|jpeg|webp)$',name,re.I) and acceptable_image(candidate):
                return candidate
    return None

def satellite_photograph(key, entry):
    """Actual georeferenced imagery for places lacking a licensed ground photo."""
    lon,lat=entry['lngLat'];dy=.08;dx=dy*1.6/max(.1,math.cos(math.radians(lat)))
    args=dict(SERVICE='WMS',REQUEST='GetMap',VERSION='1.1.1',
              LAYERS='Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual',STYLES='',
              FORMAT='image/jpeg',SRS='EPSG:4326',BBOX=f'{lon-dx},{lat-dy},{lon+dx},{lat+dy}',
              WIDTH=640,HEIGHT=400,TIME='2000-12-01')
    url='https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?'+urlencode(args)
    data=fetch(url,binary=True)
    target=OUT/'photos'/('landsat-'+hashlib.sha256(key.encode()).hexdigest()[:16]+'.webp')
    with Image.open(io.BytesIO(data)) as image:
        image.convert('RGB').save(target,format='WEBP',quality=82,method=6)
    return {'src':target.relative_to(ROOT).as_posix(),
            'credit':'NASA / USGS · Landsat WELD · 2000 · Public domain',
            'source':url,'license':'Public domain (NASA / USGS)','licenseUrl':'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
            'alt':{'en':entry['label']['en']+' surroundings: Landsat true-color satellite mosaic, 2000.',
                   'zh-CN':entry['label']['zh-CN']+'周边地表，2000年Landsat真彩卫星合成影像。',
                   'zh-TW':entry['label']['zh-TW']+'周邊地表，2000年Landsat真彩衛星合成影像。'},
            'place':entry['label'],'date':'2000','type':'satellite',
            'modifications':'Geographic crop and WebP encoding; archival landscape reference, not a current city photograph.'}

def licensed_photograph(page, metadata):
    """Cache a single licensed scene with its complete Commons attribution."""
    name=page['pageimage']; meta=metadata.get(name.replace('_',' '),{})
    ext=meta.get('extmetadata',{})
    license=plain(ext.get('LicenseShortName',{}).get('value',''))
    if not re.search(r'CC|public domain|PD|GFDL|FAL',license,re.I):
        raise ValueError('Unverified photo license: '+name)
    target=OUT/'photos'/(hashlib.sha256(name.encode()).hexdigest()[:16]+'.webp')
    if not target.exists():
        with Image.open(io.BytesIO(fetch(meta.get('thumburl') or meta['url'],binary=True))) as im:
            im=ImageOps.exif_transpose(im).convert('RGB')
            im.thumbnail((720,560),Image.Resampling.LANCZOS)
            im.save(target,format='WEBP',quality=80,method=6)
    artist=ARTIST_OVERRIDES.get(name) or plain(ext.get('Artist',{}).get('value',''))
    if not artist: raise ValueError('Photo creator missing: '+name)
    return {'src':target.relative_to(ROOT).as_posix(),'credit':artist+' · '+license,
            'source':meta['descriptionurl'],'license':license,
            'licenseUrl':ext.get('LicenseUrl',{}).get('value') or meta['descriptionurl']+'#Licensing',
            'alt':plain(ext.get('ImageDescription',{}).get('value','')) or page['title'],
            'place':page['title'],'originalFile':name,
            'modifications':'Resized and converted to WebP; no content edits.'}

def apply_cultural_content(entries):
    """Culture cards use original cultural prose and deliberately selected scenes."""
    curated=json.loads((ROOT/'scripts/region-culture-content.json').read_text(encoding='utf-8'))
    if len(curated)!=47: raise ValueError('All 47 cultural regions require an editorial record')
    photos=pages([r['photoArticle'] for r in curated.values() if not r.get('photoFile')],'en')
    chosen={}
    for key,r in curated.items():
        page=({'pageimage':r['photoFile'],'title':r['photoArticle']} if r.get('photoFile') else photos.get(r['photoArticle'],{}))
        if not acceptable_image(page): page=article_photograph(r['photoArticle'],'en')
        if not page: raise ValueError(f'No cultural photograph: {key} / {r["photoArticle"]}')
        chosen[key]=page
    metadata=image_metadata([p['pageimage'] for p in chosen.values()])
    for key,r in curated.items():
        entry=entries[key]
        entry.update(description={'zh-CN':r['chinese'],'zh-TW':TRAD.convert(r['chinese']),'en':r['english']},
                     source=r['sources'][0],textSources=r['sources'],textKind='editorial-cultural',
                     textLicense='Original editorial cultural summary; sources linked for further reading.',
                     photo=licensed_photograph(chosen[key],metadata))
        entry.pop('textLicenseUrl',None)
        if r.get('photoSubject'):
            subject=dict(r['photoSubject']);subject['zh-TW']=TRAD.convert(subject['zh-CN'])
            entry['photo']['alt']=subject
            entry['photo']['place']=subject
    print(f'Cultural briefs and photographs: {len(curated)}',flush=True)

def display_name(value, taiwan_context=False):
    """Apply the requested display terminology without modifying source URLs."""
    value=value.replace('中華民國','中華臺北').replace('中华民国','中华台北')
    value=re.sub(r'\bTaiwan\s*[,/\-]?\s*\(?R\.?O\.?C\.?\)?', 'Chinese Taipei',value,flags=re.I)
    value=re.sub(r"(?<!People's )(?<!People’s )\bRepublic of China\b",'Chinese Taipei',value,flags=re.I)
    if taiwan_context or re.search(r'\bTaiwan\b|台[湾灣]|臺灣|Chinese Taipei',value,re.I):
        value=re.sub(r'\bROC\b','Chinese Taipei',value)
    return value

def normalize_display_names(entries):
    skip={'source','sources','textSources','src','licenseUrl','textLicenseUrl','coordinateSource','originalFile'}
    def walk(value,key='',context=False):
        if key in skip: return value
        if isinstance(value,dict): return {k:walk(v,k,context) for k,v in value.items()}
        if isinstance(value,list): return [walk(v,key,context) for v in value]
        if isinstance(value,str): return display_name(value,context)
        return value
    for key in entries:
        context=bool(re.match(r'(?:poi:)?TW[N-]|CHN:taiwan|710000',key))
        entries[key]=walk(entries[key],context=context)

def write_places(entries):
    fields=['label','lngLat','parentCity','coordinateSource','coordinateRole']
    (OUT/'places.json').write_text(json.dumps([dict(id=k,**{f:v for f,v in e.items() if f in fields})
        for k,e in entries.items() if e.get('lngLat')],ensure_ascii=False,separators=(',',':')),encoding='utf-8')

def refresh_cultural_content():
    document=json.loads((OUT/'content.json').read_text(encoding='utf-8'))
    apply_cultural_content(document['entries'])
    extensions=ROOT/'scripts/region-extension-content.json'
    if extensions.exists(): document['entries'].update(json.loads(extensions.read_text(encoding='utf-8'))['entries'])
    normalize_display_names(document['entries'])
    document['version']='20261116-cultural-editorial'
    document['provenance']['culturalText']='Original editorial cultural notes; UNESCO, cultural heritage institutions and museums are linked per entry. Culture boundaries are editorial, not administrative definitions.'
    write_places(document['entries'])
    (OUT/'content.json').write_text(json.dumps(document,ensure_ascii=False,separators=(',',':')),encoding='utf-8')

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'photos').mkdir(exist_ok=True)
    atlas=json.loads((ROOT/'assets/maps/relief/atlas.json').read_text(encoding='utf-8'))['maps']['china']
    records={r['id']:{'name':r['name'],'kind':'city','visited':r.get('visited',False)} for r in atlas['regions']}
    for r in atlas['overview']['regions']:
        records.setdefault(r['id'],{'name':r['name'],'kind':'province','visited':r.get('visited',False)})
    cultures={r['id']:r for r in atlas['cultural']['regions']}
    for key,r in cultures.items(): records[key]={'name':CULTURE_ARTICLES[key[4:]],'kind':'culture','label':r['label']}
    for key,(zh,en) in EXTRA.items(): records[key]={'name':zh,'english':en,'kind':'extension'}
    taiwan=json.loads((ROOT/'tools/relief-atlas/reference/cache/taiwan_admin1.geojson').read_text(encoding='utf-8'))
    for feature in taiwan['features']:
        p=feature['properties']; records[p['shapeISO']]={'name':'','english':p['shapeName'],'kind':'extension'}
    records['TW-TAO']['english']='Taoyuan, Taiwan'
    records['TW-ILA']['english']='Yilan County, Taiwan'
    for city in sorted(SECONDARY_POIS):
        for i,title in enumerate([PHOTO_ARTICLES[city],SECONDARY_POIS[city]],1):
            records[f'poi:{city}:{i}']={'name':CHINESE_POIS[city][i-1],'english':title,'kind':'landmark','parentCity':city}
    for region,(zhname,enname) in EXTRA_POIS.items():
        records[f'poi:{region}:1']={'name':zhname,'english':enname,'kind':'landmark','parentCity':region}
    for key,title in {'220600':'白山市 (吉林省)','220700':'松原市 (吉林省)',
                      'CHN:dongbei-mongdong':'满洲 (地名)','CHN:guanzhong':'关中平原',
                      'poi:330400:2':'西塘镇 (嘉善县)'}.items():
        records[key]['displayName']=records[key]['name']
        records[key]['name']=title
    zh=pages(r['name'] for r in records.values())
    english={next((x['*'] for x in zh.get(r['name'],{}).get('langlinks',[]) if x['lang']=='en'),None) or r.get('english') for r in records.values()}
    en=pages(english | set(PHOTO_ARTICLES.values()), 'en')
    # Taiwan ISO names are authoritative in the geometry; use their linked
    # Chinese page rather than guessing an administrative name translation.
    more_zh=[]
    for r in records.values():
        if not r['name']:
            r['name']=next((x['*'] for x in en.get(r['english'],{}).get('langlinks',[]) if x['lang']=='zh'),'')
            more_zh.append(r['name'])
    zh.update(pages(more_zh))
    entries={}; choices={}
    for key,r in records.items():
        zp=zh.get(r['name'],{})
        english=next((x['*'] for x in zp.get('langlinks',[]) if x['lang']=='en'),None) or r.get('english')
        ep=en.get(english,{})
        display=r.get('displayName',r['name'])
        label=r.get('label') or {'en':ep.get('title') or english or display,'zh-CN':SIMP.convert(display),'zh-TW':TRAD.convert(display).replace('七臺河','七台河')}
        ztext=excerpt(zp.get('extract','')); etext=excerpt(ep.get('extract',''))
        if key in ZH_DESCRIPTIONS: ztext=ZH_DESCRIPTIONS[key]
        if not ztext and etext: ztext=label['zh-CN']+'。'+etext
        if not etext: etext=f"{label['en']}. " + ('A cultural region in the atlas; its extent follows the regional guide.' if r['kind']=='culture' else 'Explore the local landscape and follow the linked encyclopedia entry for further reading.')
        entry={'label':label,'description':{'en':etext,'zh-CN':SIMP.convert(ztext),'zh-TW':TRAD.convert(ztext)},
               'source':zp.get('fullurl') or ep.get('fullurl'), 'textSources':list(dict.fromkeys(p['fullurl'] for p in [zp,ep] if p.get('fullurl'))),
               'textLicense':'CC BY-SA 4.0; excerpt adapted by shortening and script conversion',
               'textLicenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/', 'kind':r['kind']}
        coord=(ep.get('coordinates') or zp.get('coordinates') or [None])[0]
        if coord: entry['lngLat']=[coord['lon'],coord['lat']]
        if key in COORDINATES:
            entry['lngLat']=COORDINATES[key][0]
            entry['coordinateSource']='https://www.wikidata.org/wiki/'+COORDINATES[key][1]
        if key=='320200': entry['coordinateRole']='city-anchor'
        if key in cultures:
            basis=cultures[key].get('basis','')
            entry['editorialBasis']={'zh-CN':basis,'zh-TW':TRAD.convert(basis)}
        entries[key]=entry
        if r.get('parentCity'): entry['parentCity']=r['parentCity']
        photo_page=en.get(PHOTO_ARTICLES.get(key),{})
        for p in [photo_page,zp,ep]:
            if acceptable_image(p):
                choices[key]=p
                break
        if key not in choices:
            for p,lang in [(zp,'zh'),(ep,'en')]:
                if p.get('title'):
                    candidate=article_photograph(p['title'],lang)
                    if candidate:
                        choices[key]=candidate
                        break
    for key,(filename,title) in PHOTO_FILES.items():
        choices[key]={'pageimage':filename,'title':title}
    for parent in EXTRA_POIS:
        if f'poi:{parent}:1' in choices: choices[parent]=choices[f'poi:{parent}:1']
    # Culture cards use a photograph of a named locality inside the grouping.
    for key,r in cultures.items():
        candidates=r.get('visited_members',[]) + r.get('members',[])
        member=next((str(k) for k in candidates if str(k) in choices),None)
        if member: choices[key]=choices[member]
    # Provincial cards likewise retain a truthful, named local photograph.
    for key,r in records.items():
        if r['kind']=='province':
            city=next((x['id'] for x in atlas['regions'] if str(x.get('province'))==key and x['id'] in choices and x.get('visited')),None)
            if city: choices[key]=choices[city]
    (OUT/'places.json').write_text(json.dumps([dict(id=k,**{f:v for f,v in e.items() if f in ['label','lngLat','parentCity','coordinateSource','coordinateRole']}) for k,e in entries.items() if e.get('lngLat')],ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(f'Coordinates published: {sum(bool(x.get("lngLat")) for x in entries.values())}',flush=True)
    metadata=image_metadata([p['pageimage'] for p in choices.values()])
    errors=[]
    def photograph(item):
        key,page=item; name=page['pageimage']; meta=metadata.get(name.replace('_',' '),{})
        ext=meta.get('extmetadata',{})
        if re.search(r'locator map|location map|administrative map|地理位置|区划图|區劃圖|地图|地圖',plain(ext.get('ImageDescription',{}).get('value','')),re.I):
            return key,None,'map excluded: '+name
        license=plain(ext.get('LicenseShortName',{}).get('value',''))
        if not re.search(r'CC|public domain|PD|GFDL|FAL',license,re.I): return key,None,'unverified license: '+name
        remote=meta.get('thumburl') or meta.get('url')
        slug=hashlib.sha256(name.encode()).hexdigest()[:16]
        target=OUT/'photos'/f'{slug}.webp'
        try:
            if not target.exists():
                data=fetch(remote,binary=True)
                with Image.open(io.BytesIO(data)) as image:
                    image=ImageOps.exif_transpose(image).convert('RGB')
                    image.thumbnail((720,560),Image.Resampling.LANCZOS)
                    image.save(target,format='WEBP',quality=80,method=6)
            artist=ARTIST_OVERRIDES.get(name) or plain(ext.get('Artist',{}).get('value',''))
            credit=' · '.join(v for v in [artist,license] if v)
            return key,{'src':target.relative_to(ROOT).as_posix(),'credit':credit,
              'source':meta.get('descriptionurl'),'license':license,'licenseUrl':ext.get('LicenseUrl',{}).get('value') or meta.get('descriptionurl','')+'#Licensing',
              'alt':plain(ext.get('ImageDescription',{}).get('value','')) or page['title'],
              'place':page['title'],'originalFile':name,'modifications':'Resized and converted to WebP; no content edits.'},None
        except Exception as exc: return key,None,f'{name}: {exc}'
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for n,(key,photo,error) in enumerate(pool.map(photograph,choices.items()),1):
            if photo: entries[key]['photo']=photo
            if error: errors.append({'id':key,'error':error})
            if n%25==0: print(f'Photographs: {n}/{len(choices)}',flush=True)
    for key,entry in entries.items():
        if 'photo' not in entry and entry.get('lngLat'):
            try: entry['photo']=satellite_photograph(key,entry)
            except Exception as exc: errors.append({'id':key,'error':str(exc)})
    for key,source in PHOTO_REUSE.items():
        entries[key]['photo']=dict(entries[source]['photo'])
    apply_cultural_content(entries)
    extensions=ROOT/'scripts/region-extension-content.json'
    if extensions.exists(): entries.update(json.loads(extensions.read_text(encoding='utf-8'))['entries'])
    normalize_display_names(entries)
    write_places(entries)
    output={'version':'20261116-region-content','entries':entries,'provenance':{
        'text':'Wikipedia contributors; linked page histories identify authors. Short excerpts, shortened and script-converted.',
        'textLicense':'https://creativecommons.org/licenses/by-sa/4.0/',
        'culturalText':'Original editorial cultural notes; UNESCO, cultural heritage institutions and museums are linked per entry. Culture boundaries are editorial, not administrative definitions.',
        'photos':'Wikimedia Commons locality references; each record identifies creator, original file, license and modifications. These are not personal travel photographs.'}}
    (OUT/'content.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    report={'entries':len(entries),'photographs':sum('photo' in e for e in entries.values()),'missingPhotos':[k for k,e in entries.items() if 'photo' not in e],
            'missingDescriptions':[k for k,e in entries.items() if not e['description']['zh-CN']], 'errors':errors}
    (CACHE/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False),flush=True)

def package_content():
    """Emit one small content bundle per plate after refreshing its place list."""
    source=json.loads((OUT/'content.json').read_text(encoding='utf-8'))
    manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    destination=OUT/'content';destination.mkdir(exist_ok=True)
    files=sorted({r['file'] if isinstance(r,dict) else r for r in manifest['regions'].values()})
    sizes=[]
    for filename in files:
        document=json.loads((OUT/filename).read_text(encoding='utf-8'))
        ids={document['id']} | {r['id'] for r in document.get('subregions',[])} | {r['id'] for r in document.get('places',[])}
        missing=ids-source['entries'].keys()
        if missing: raise SystemExit(f'{filename}: missing content {sorted(missing)}')
        target=destination/Path(filename).name
        target.write_text(json.dumps({'version':source['version'],'entries':{key:source['entries'][key] for key in sorted(ids)}},ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        sizes.append(target.stat().st_size)
    # Remove only this builder's obsolete encoded photos, after the new content
    # bundles are written. The API/raw-image cache remains available for rebuilds.
    used={Path(e['photo']['src']).name for e in source['entries'].values() if e.get('photo')}
    photo_root=(OUT/'photos').resolve()
    for candidate in photo_root.glob('*.webp'):
        if candidate.name not in used and re.fullmatch(r'(?:landsat-)?[0-9a-f]{16}\.webp',candidate.name):
            if candidate.resolve().parent != photo_root: raise RuntimeError('Unsafe photo cleanup path')
            candidate.unlink()
    print(f'Content bundles: {len(sizes)}; largest {max(sizes):,} bytes; total {sum(sizes):,} bytes.',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--package-content-only',action='store_true')
    parser.add_argument('--refresh-cultural-only',action='store_true')
    args=parser.parse_args()
    if args.package_content_only: package_content()
    elif args.refresh_cultural_only: refresh_cultural_content()
    else: main()
