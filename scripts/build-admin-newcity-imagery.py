"""Archive dated NASA/USGS imagery for city centres lacking licensed ground views.

Uses actual 2025 HLS L30 acquisitions from CMR; never relabels old imagery as a
present-day photograph. These are explicitly identified satellite references.
"""
from pathlib import Path
import concurrent.futures, hashlib, io, json, math
from urllib.parse import urlencode
from urllib.request import Request,urlopen
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
ARCHIVE=ROOT/'tools/relief-atlas/administrative/imagery'
OUT=ROOT/'assets/maps/administrative/photos'
IDS=['659003','659006','659007','659008','659009','659010','620800','469027','460300']
LAYER='HLS_L30_Nadir_BRDF_Adjusted_Reflectance'
def fetch(url,path):
 if path.exists():return path.read_bytes()
 for attempt in range(4):
  try:
   data=urlopen(Request(url,headers={'User-Agent':'RundeFootprintAtlas/1.0'}),timeout=45).read();path.write_bytes(data);return data
  except Exception:
   if attempt==3:raise

def main():
 ARCHIVE.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
 focus=json.loads((ROOT/'assets/maps/administrative/focus.json').read_text(encoding='utf-8'))['units']
 old=json.loads((ROOT/'assets/maps/regions/content.json').read_text(encoding='utf-8'))['entries']
 def job(key):
  lon,lat=focus[key]['lngLat']; tropical=key in ['469027','460300']; params={'short_name':'HLSL30','version':'2.0','point':f'{lon},{lat}','temporal':'2025-01-01T00:00:00Z,2025-12-31T23:59:59Z' if tropical else '2025-06-01T00:00:00Z,2025-09-01T23:59:59Z','cloud_cover':'0,25' if tropical else '0,10','page_size':'80' if tropical else '20'}
  cmr='https://cmr.earthdata.nasa.gov/search/granules.json?'+urlencode(params)
  records=json.loads(fetch(cmr,ARCHIVE/(key+('-'+hashlib.sha256(cmr.encode()).hexdigest()[:12]+'-cmr.json' if tropical else '-cmr.json'))))['feed']['entry']
  records.sort(key=lambda r:(float(r.get('cloud_cover',100)),r['time_start']))
  half_width,half_height=(3,2.25) if key=='460300' else (4,3) if key=='469027' else (8,6)
  dx=half_width/(111.32*math.cos(math.radians(lat)));dy=half_height/111.32;bbox=[lon-dx,lat-dy,lon+dx,lat+dy]
  for rec in records:
   date=rec['time_start'][:10];args={'SERVICE':'WMS','REQUEST':'GetMap','VERSION':'1.1.1','LAYERS':LAYER,'STYLES':'','FORMAT':'image/png','SRS':'EPSG:4326','BBOX':','.join(map(str,bbox)),'WIDTH':640,'HEIGHT':480,'TIME':date,'TRANSPARENT':'TRUE'}
   source='https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?'+urlencode(args)
   cache_name=key+'-'+date+('-'+hashlib.sha256(source.encode()).hexdigest()[:12] if tropical else '')+'.png'
   raw=fetch(source,ARCHIVE/cache_name);im=Image.open(io.BytesIO(raw)).convert('RGBA');pixels=np.asarray(im)
   fraction=float((pixels[:,:,3]>0).mean());valid=pixels[:,:,:3][pixels[:,:,3]>0]
   if fraction<.99 or valid.std()<8:continue
   photo_file=OUT/(key+'-landsat-'+date+'.webp');im.convert('RGB').save(photo_file,'WEBP',quality=87,method=6)
   label=({'en':'Yongxing Island','zh-CN':'永兴岛','zh-TW':'永興島'} if key=='460300' else
          {'en':'Baoyou, Ledong','zh-CN':'乐东抱由','zh-TW':'樂東抱由'} if key=='469027' else old[key]['label'])
   title={'en':label['en']+' · satellite view','zh-CN':label['zh-CN']+' · 遥感全景','zh-TW':label['zh-TW']+' · 遙感全景'}
   photo={'src':photo_file.relative_to(ROOT).as_posix(),'credit':'NASA / USGS · Landsat HLS L30 · '+date+' · Public domain','source':source,'license':'Public domain (NASA / USGS)','licenseUrl':'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits','alt':title,'place':title,'date':date,'type':'satellite','resolutionM':30,'bboxWgs84':bbox,'modifications':'Geographic window and WebP encoding; original observed colours retained.','granule':rec['title']}
   pid='poi:admin:'+key+':satellite'
   description={'en':f"A true-color Landsat observation of {label['en']} on {date}. The 30-metre imagery records the city and its surrounding land, and is labelled as a satellite reference rather than a ground-level travel photograph.",'zh-CN':f"这幅{date}的Landsat真彩遥感影像记录了{label['zh-CN']}及周边地表。影像分辨率为30米，可观察城区与周边地貌的空间关系；照片标明了实际观测日期。",'zh-TW':f"這幅{date}的Landsat真彩遙感影像記錄了{label['zh-TW']}及周邊地表。影像解析度為30公尺，可觀察城區與周邊地貌的空間關係；照片標明了實際觀測日期。"}
   entry={'id':pid,'label':title,'description':description,'source':old[key]['source'],'textSources':[old[key]['source'],'https://hls.gsfc.nasa.gov/data-access-and-tools/'],'photo':photo,'lngLat':[lon,lat],'coordinateSource':focus[key]['coordinateSource'],'kind':'landmark','role':'satellite-reference','parentUnit':key}
   place={'id':pid,'parentUnit':key,'label':title,'lngLat':[lon,lat],'coordinateSource':entry['coordinateSource'],'role':'satellite-reference'}
   (ARCHIVE/(key+'-provenance.json')).write_text(json.dumps({'cmrQuery':cmr,'granule':rec,'imageQuery':source,'bbox':bbox,'coverage':fraction,'sha256':hashlib.sha256(raw).hexdigest()},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
   print(key,date,fraction,flush=True);return pid,entry,place
  raise ValueError(key+': no complete clear contemporary image')
 entries={};places=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  for pid,entry,place in pool.map(job,IDS):entries[pid]=entry;places.append(place)
 output=ROOT/'.render-work/region-content/admin-newcity-imagery.json';output.write_text(json.dumps({'entries':entries,'places':places},ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(output)
if __name__=='__main__':main()
