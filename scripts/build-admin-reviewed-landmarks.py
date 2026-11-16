"""Apply the small, visually reviewed set of remaining Gansu scene references.

Coordinates are the photographers' published locations. The older photograph
is explicitly dated; it is not presented as a current street condition.
"""
from pathlib import Path
import importlib.util
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('a',ROOT/'scripts/build-administrative-content.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
RECORDS=[
 ('620300','street-2006','20060423105630.jpg',[102+10.9/60,38+31.1/60],
  '金昌街景 · 2006','Jinchang streetscape · 2006',
  '这张2006年4月23日的照片记录了金昌市区金川职工大厦前的街景。道路、广场与公共建筑呈现了当时的城市面貌。',
  'A streetscape in front of the Jinchuan workers’ building, photographed in Jinchang on 23 April 2006. The road, forecourt and public buildings record the city as it appeared at that time.',
  'Photographer explicitly published 38°31.1′ N, 102°10.9′ E on the original Commons file page; approximate to 0.1 arcminute.'),
 ('621200','hanwang-2019','陇南市汉王镇 - Mapillary (jCkYdXcqFvPFf4e6EoWBI5).jpg',[105.0196639,33.3429508],
  '武都汉王河谷 · 2019','Hanwang valley, Wudu · 2019',
  '汉王镇位于武都城区东南的白龙江河谷。2019年的实景照片记录了山坡、聚落与河谷田地相邻的景观。',
  'Hanwang lies in the Bailong River valley southeast of central Wudu. This 2019 photograph shows the closely spaced hillsides, settlements and valley fields.',
  'Public Mapillary camera location, retained in the Commons file GeoData.'),
 ('621200','liangshui-2019','陇南市两水镇 - Mapillary (rhnhbTrMKW852EKUjylBkO).jpg',[104.804060,33.423210],
  '武都两水山城 · 2019','Liangshui, Wudu · 2019',
  '两水镇位于武都西北的河谷地带。这张2019年5月的照片展示了坡地聚落、交通设施与山地共同构成的地方景观。',
  'Liangshui occupies a valley northwest of central Wudu. This photograph from May 2019 shows its hillside settlement and transport infrastructure framed by mountains.',
  'Public Mapillary camera location, retained in the Commons file GeoData.')]

def main():
    metadata=a.base.image_metadata([row[2] for row in RECORDS]);entries={}
    for unit,suffix,filename,point,cn,en,zhtext,entext,derivation in RECORDS:
        photo=a.base.licensed_photograph({'pageimage':filename,'title':en},metadata)
        photo.update(type='field-photograph',publishedLocation={'lngLat':point,'source':photo['source']})
        pid=f'poi:admin:{unit}:{suffix}'
        entries[pid]={'label':a.label(en,cn),'description':a.label(entext,zhtext),'source':photo['source'],
          'textSources':[photo['source']],'textKind':'editorial-locality',
          'textLicense':'Original editorial caption of the linked dated scene photograph.',
          'photo':photo,'lngLat':point,'coordinateSource':photo['source'],'coordinateDerivation':derivation,
          'kind':'landmark','role':'photo-location','parentUnit':unit}
    target=ROOT/'tools/relief-atlas/administrative/content-sources/reviewed-gansu-landmarks.json'
    a.write(target,{'entries':entries});a.import_curated([target]);print('Reviewed Gansu scenes:',len(entries))

if __name__=='__main__':main()
