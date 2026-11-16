"""Collect named urban landmarks for cross-border/island units and Lhasa.

The map geometry still decides whether each real point is in a viewport.
Photos retain their Commons license and subject; no city centroid photo proxy.
"""
from pathlib import Path
import concurrent.futures, importlib.util, json
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('admin_content',ROOT/'scripts/build-administrative-content.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
b=a.base
SITES={
'540100':['Potala Palace'],
'MNG':['Gandantegchinlen Monastery','Sükhbaatar Square'],
'RUS:Tuva':['Centre of Asia (monument)','National Museum of Tuva'],
'NPL':['Swayambhunath','Kathmandu Durbar Square'],
'BTN':['Tashichho Dzong'],
'IND:Ladakh':['Leh Palace'],
'IND:Sikkim':['Enchey Monastery'],
'IND:LahaulSpiti':['Kardang Monastery','Shashur Monastery'],
'TW-ILA':['Yilan Distillery'],
'TW-CHA':['Changhua Confucian Temple'],
'TW-NAN':['Zhongxing New Village'],
'TW-YUN':['House of Citizen-Memorial Hall of Attendance'],
'TW-KEE':['Heping Island Park'],
'TW-TPE':['Chiang Kai-shek Memorial Hall'],
'TW-NWT':['Lin Family Mansion and Garden'],
'TW-TXG':['National Taichung Theater'],
'TW-TNN':['Fort Zeelandia (Taiwan)'],
'TW-TAO':['Taoyuan Confucian Temple'],
'TW-MIA':['Miaoli Wenchang Temple','Miaoli Railway Museum'],
'TW-CYI':['Hinoki Village'],
'TW-CYQ':['Southern Branch of the National Palace Museum'],
'TW-KHH':['Lotus Pond','Dragon and Tiger Pagodas'],
'TW-TTT':['Taitung Forest Park'],
'TW-HUA':['Pine Garden'],
'TW-PEN':['Penghu Tianhou Temple'],
'TW-HSZ':['Hsinchu Chenghuang Temple'],
'TW-HSQ':['Hsinwawu Hakka Culture Conservation Area'],
'TW-PIF':['Pingtung Tutorial Academy'],
'TW-KIN':['Juguang Tower'],
'TW-LIE':['Matsu Tianhou Temple'],
'TWN:Wuqiu':['Wuqiu Lighthouse'],
'TWN:Dongsha':['Pratas Island'],
'TWN:Taiping':['Taiping Island']}
CHINESE = {'TW-HSQ':'新瓦屋客家文化保存區','TW-LIE':'馬祖境天后宮','TW-TNN':'安平古堡'}
CN_TRANSLATIONS = {
 'IND:Sikkim':('恩切寺','恩切寺始建于1909年，坐落在锡金首府甘托克上方的山坡，属于金刚乘佛教宁玛派。'),
 'TW-KEE':('和平岛公园','和平岛公园位于基隆市中正区的和平岛上。海边岩石长期受到风浪侵蚀，形成形态各异的海蚀景观。')}
EN_TRANSLATIONS = {
 'TW-HSQ':'Hsinwawu is a historic Hakka settlement of the Lin family in Zhubei. Its traditional houses became a Hakka cultural conservation area in 2005.',
 'TW-LIE':'Matsu Tianhou Temple faces the sea beside Matsu Harbour in Nangan. Its main hall contains the Mazu tomb shrine, an important focus of local religious tradition.'}

def main():
    (a.OUT/'photos').mkdir(parents=True,exist_ok=True)
    ep=b.pages([v for values in SITES.values() for v in values],'en')
    zh_titles={title:next((l['*'] for l in page.get('langlinks',[]) if l['lang']=='zh'),None) for title,page in ep.items()}
    zp=b.pages([*zh_titles.values(),*CHINESE.values()],'zh')
    qids=a.article_entities(ep.keys());entities=a.entities(qids.values())
    candidates={};issues=[];focus=a.read(a.OUT/'focus.json')['units']
    for unit,titles in SITES.items():
        for title in titles:
            e=ep.get(title,{});z=zp.get(zh_titles.get(title),{})
            if unit in CHINESE:z=zp.get(CHINESE[unit],z)
            if unit in CN_TRANSLATIONS and not z.get('extract'):
                name,text=CN_TRANSLATIONS[unit];z={'title':name,'extract':text,'fullurl':e['fullurl']}
            if unit in EN_TRANSLATIONS and not e.get('extract'):
                e={'title':title,'extract':EN_TRANSLATIONS[unit],'fullurl':z['fullurl']}
            coord=(e.get('coordinates') or z.get('coordinates') or [None])[0]
            point=[coord['lon'],coord['lat']] if coord else a.coordinate(entities.get(qids.get(title),{}))
            if unit=='TW-HSQ':point=[121.0271,24.8115] # Wikidata Q120499232, original Hakka settlement
            if unit=='TWN:Wuqiu':point=[119.4520405,24.9923118]
            if unit=='TWN:Taiping':point=[114.3663888889,10.3772222222]
            photo=next((p for p in ((z,e) if unit=='TW-TNN' else (e,z)) if b.acceptable_image(p)),None)
            if unit=='TW-LIE':photo={'pageimage':'Mazu Tomb.jpg','title':z['title']}
            if unit=='TW-HSQ':photo={'pageimage':'新瓦屋 林礽固家 2023-07-10.jpg','title':z['title']}
            if not point or not photo or not e.get('extract') or not z.get('extract'):
                issues.append({'unit':unit,'title':title,'point':point,'photo':bool(photo),'english':bool(e.get('extract')),'chinese':bool(z.get('extract'))});continue
            if a.distance(point,focus[unit]['lngLat'])>focus[unit]['extentKm']*.48:
                issues.append({'unit':unit,'title':title,'distance':a.distance(point,focus[unit]['lngLat'])});continue
            candidates[unit]=(title,e,z,point,photo);break
    metadata=b.image_metadata([row[4]['pageimage'] for row in candidates.values()])
    def build(item):
        unit,(title,e,z,point,p)=item;pid='poi:admin:'+unit+':urban'
        photo=b.licensed_photograph(p,metadata)
        labels=a.label(e['title'],z['title'])
        entry={'id':pid,'label':labels,'description':a.label(b.excerpt(e['extract']),b.excerpt(z['extract'])),
         'source':z['fullurl'],'textSources':[z['fullurl'],e['fullurl']],
         'textLicense':'CC BY-SA 4.0; adapted excerpts','textLicenseUrl':'https://creativecommons.org/licenses/by-sa/4.0/',
         'photo':photo,'lngLat':point,'coordinateSource':e['fullurl'],'kind':'landmark','parentCity':unit}
        if unit in ('TWN:Wuqiu','TWN:Taiping'):entry['coordinateSource']=focus[unit]['coordinateSource']
        if unit=='TW-HSQ':entry['coordinateSource']='https://www.wikidata.org/wiki/Q120499232'
        if unit in CN_TRANSLATIONS or unit in EN_TRANSLATIONS:entry['textLicense']='CC BY-SA 4.0; translated and shortened excerpt'
        place={'id':pid,'parentUnit':unit,'label':labels,'lngLat':point,'coordinateSource':entry['coordinateSource'],'role':'landmark'}
        return pid,entry,place
    entries={};places=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        jobs={pool.submit(build,item):item[0] for item in candidates.items()}
        for job in concurrent.futures.as_completed(jobs):
            try:
                pid,entry,place=job.result();entries[pid]=entry;places.append(place);print('OK',place['parentUnit'],flush=True)
            except Exception as error:issues.append({'unit':jobs[job],'error':str(error)})
    overrides=a.read(ROOT/'scripts/admin-external-landmark-overrides.json')
    entries.update(overrides['entries'])
    places={place['id']:place for place in [*places,*overrides['places']]}
    places=list(places.values())
    b.normalize_display_names(entries)
    target=ROOT/'.render-work/region-content/admin-external-landmarks.json';a.write(target,{'entries':entries,'places':places})
    a.write(target.with_name('admin-external-landmark-issues.json'),issues)
    print(json.dumps({'landmarks':len(entries),'missing':[u for u in SITES if not any(p['parentUnit']==u for p in places)],'issues':issues},ensure_ascii=False))
if __name__=='__main__':main()
