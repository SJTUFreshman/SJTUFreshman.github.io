"""Verify the completed Windows render without rendering or resaving its scene.

The original post-render check compared path separators literally. This checks
the existing .blend, its geometry/pigments, and completed native PNG in place.
"""
import bpy, hashlib, json, sys
from pathlib import Path
import numpy as np
ARCHIVE=Path(__file__).resolve().parent
ROOT=ARCHIVE.parents[3]
sys.path.insert(0,str(ARCHIVE))
from render_atlas import linear_color

read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
metadata=read(ARCHIVE/'overview/data/east_asia.json')
style=read(ARCHIVE/'style.json')
old=read(ROOT/'tools/relief-atlas/footprints/selected-cultural-20261106/detail/renders/east_asia-render.json')
data=np.load(ARCHIVE/'overview/data/east_asia.npz')
scene_path=ARCHIVE/'overview/scenes/east_asia-colour.blend'
native=ARCHIVE/'overview/renders/east_asia-colour.png'
bpy.ops.wm.open_mainfile(filepath=str(scene_path))
scene=bpy.context.scene;terrain=bpy.data.objects['Terrain / footprints']
lighting=json.loads(scene['lighting'])
assert lighting==old['lighting']
assert scene.render.filepath.replace('\\','/')=='//../renders/east_asia-colour.png'
assert scene.camera.data.type=='ORTHO'
assert tuple(scene.camera.location)==(0,0,80)
assert tuple(scene.camera.rotation_euler)==(0,0,0)
assert abs(scene.camera.data.ortho_scale-24*6000/4770)<.00001
assert (scene.render.resolution_x,scene.render.resolution_y)==(6000,4770)
assert scene.cycles.samples==192 and scene.cycles.use_denoising
assert scene['postprocessing']=='none' and not scene.use_nodes
assert scene['sea_material']==style['backgrounds']['east_asia']
assert scene['unvisited_material']==style['unvisited_materials']['east_asia']
assert all(image.packed_file for image in bpy.data.images if image.source=='FILE')

mask=data['mask'].astype(bool)&np.isfinite(data['elevation'])
rows,columns=np.where(mask);count=len(rows)
assert len(terrain.data.vertices)==count
west,south,east,north=metadata['extent_km'];scale=24/(north-south)
expected=np.column_stack(((data['x'][columns]-(west+east)/2)*scale,
                          (data['y'][rows]-(south+north)/2)*scale,
                          .008+np.maximum(data['elevation'][mask],0)*scale*metadata['vertical_exaggeration']/1000)).astype('float32')
actual=np.empty(count*3,dtype='float32');terrain.data.vertices.foreach_get('co',actual)
assert np.allclose(actual.reshape(-1,3),expected,atol=.000001)
colors=np.ones((count,4),dtype='float32')
colors[:,:3]=linear_color(scene['unvisited_material'])
for ident,pigment in metadata['region_colors'].items():colors[data['region'][mask]==int(ident),:3]=linear_color(pigment)
actual=np.empty(count*4,dtype='float32');terrain.data.color_attributes['ReliefColor'].data.foreach_get('color',actual)
assert np.allclose(actual.reshape(-1,4),colors,atol=.000001)
image=bpy.data.images.load(str(native));assert tuple(image.size)==(6000,4770);bpy.data.images.remove(image)
preferences=bpy.context.preferences.addons['cycles'].preferences
preferences.compute_device_type='ONEAPI';preferences.get_devices()
devices=[d.name for d in preferences.devices if d.type=='ONEAPI'];assert devices
scene_report={'colour':{'file':scene_path.name,'sha256':digest(scene_path),'bytes':scene_path.stat().st_size,
 'vertices':count,'resolution':[6000,4770],'reopened':True,'pigments_verified':True,'geometry_verified':True,
 'lighting_verified':True,'external_images':False,'white_material_verified':False,'postprocessing':'none','sea_material':scene['sea_material']}}
report={'lighting':lighting,'render_engine':'Blender '+bpy.app.version_string+' / Cycles ONEAPI','samples':192,
 'native_render_size':[6000,4770],'gpu_devices':devices,'render_devices':devices,'compute_device_type':'ONEAPI',
 'unvisited_material':scene['unvisited_material'],'administrative_outlines':False,'sea_material':scene['sea_material'],
 'postprocessing':'none','outputs':{native.name:digest(native)},
 'verification_note':'Existing completed native render and original saved scene verified; Windows relative-path separators normalized. No rerender or scene resave.'}
(ARCHIVE/'overview/scenes/east_asia-scenes.json').write_text(json.dumps(scene_report,indent=2)+'\n',encoding='utf-8')
(ARCHIVE/'overview/renders/east_asia-render.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('EXISTING NATIVE RENDER VERIFIED',count,devices,flush=True)
