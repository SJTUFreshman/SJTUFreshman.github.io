#!/usr/bin/env python3
"""Cycles equirectangular renderer for export-world-scene.cjs output."""
import argparse,importlib.util,json,math,runpy,sys
from pathlib import Path
try:
 import bpy
 from mathutils import Matrix,Vector
except ImportError: raise SystemExit('Run with Blender: blender -b --python scripts/render-world-panorama.py -- ...')
BASIS=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
def args():
 parser=argparse.ArgumentParser()
 parser.add_argument('--scene',required=True)
 parser.add_argument('--output',required=True)
 parser.add_argument('--blend',required=True)
 parser.add_argument('--asset-root',default=str(Path(__file__).resolve().parent.parent))
 parser.add_argument('--width',type=int,default=4096)
 parser.add_argument('--height',type=int,default=2048)
 parser.add_argument('--samples',type=int,default=256)
 parser.add_argument('--device',choices=('CPU','CUDA','OPTIX'),default='CUDA')
 parser.add_argument('--save-only',action='store_true')
 parser.add_argument('--hdri')
 parser.add_argument('--hdri-rotation',type=float,default=0)
 parser.add_argument('--environment-strength',type=float,default=1)
 parser.add_argument('--sky-output')
 parser.add_argument('--exposure',type=float,default=0)
 parser.add_argument('--proxy-only',action='store_true')
 parser.add_argument('--measured-terrain',action='store_true')
 return parser.parse_args(sys.argv[sys.argv.index('--')+1:])
def vec(v): return (float(v[0]),-float(v[2]),float(v[1]))
def col(v):
 n=int(v.lstrip('#'),16) if isinstance(v,str) else int(v)
 channels=[(n>>s&255)/255 for s in (16,8,0)]
 return tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in channels)
def mat(v):
 a=Matrix(tuple(tuple(v[c*4+r] for c in range(4)) for r in range(4)));return BASIS@a@BASIS.inverted()
def material(data,root):
 result=bpy.data.materials.new('NightWorld/material');result.use_nodes=True
 nodes,links=result.node_tree.nodes,result.node_tree.links
 shader=nodes.get('Principled BSDF')
 shader.inputs['Base Color'].default_value=col(data['color'])+(1,)
 shader.inputs['Roughness'].default_value=data.get('roughness',.85)
 shader.inputs['Metallic'].default_value=data.get('metalness',0)
 shader.inputs['Emission Color'].default_value=col(data.get('emissive','#000000'))+(1,)
 shader.inputs['Emission Strength'].default_value=data.get('emissiveIntensity',0)
 normal_node=None
 texture_data=dict(data.get('textures',{}))
 offline=data.get('offlineMaterial')
 if offline:
  channel_names={'baseColor':'diff','normal':'nor','roughness':'rough'}
  for name,suffix in channel_names.items():
   candidates=[base/offline/(offline+'_'+suffix+'_'+texture_resolution+'.jpg') for texture_resolution in ['4k','2k'] for base in [root/'assets'/'life'/'textures'/'library',root/'.render-work'/'library']]
   source=next((candidate for candidate in candidates if candidate.exists()),None)
   if source:
    repeat=texture_data.get(name,{}).get('repeat',[3,3])
    texture_data[name]={'path':str(source),'repeat':repeat}
 for name,detail in texture_data.items():
  detail=detail if isinstance(detail,dict) else {'path':detail,'repeat':[1,1]}
  source=root/detail['path']
  if not source.exists():raise FileNotFoundError(source)
  texture=nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(str(source),check_existing=True)
  texture.image.colorspace_settings.name='sRGB' if name=='baseColor' else 'Non-Color'
  coordinates=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping')
  mapping.inputs['Scale'].default_value=tuple(detail.get('repeat',[1,1]))+(1,)
  links.new(coordinates.outputs['UV'],mapping.inputs['Vector']);links.new(mapping.outputs['Vector'],texture.inputs['Vector'])
  if name=='normal':
   normal_node=nodes.new('ShaderNodeNormalMap');normal_node.inputs['Strength'].default_value=sum(abs(value) for value in data.get('normalScale',[1,1]))*.5;links.new(texture.outputs['Color'],normal_node.inputs['Color'])
  elif name=='baseColor':
   multiply=nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1;multiply.inputs[2].default_value=col(data['color'])+(1,)
   links.new(texture.outputs['Color'],multiply.inputs[1]);links.new(multiply.outputs[0],shader.inputs['Base Color'])
  elif name=='roughness':
   multiply=nodes.new('ShaderNodeMath');multiply.operation='MULTIPLY';multiply.inputs[1].default_value=data.get('roughness',.85)
   links.new(texture.outputs['Color'],multiply.inputs[0]);links.new(multiply.outputs[0],shader.inputs['Roughness'])
 noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=160
 bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.0005
 links.new(noise.outputs['Fac'],bump.inputs['Height'])
 if normal_node:links.new(normal_node.outputs['Normal'],bump.inputs['Normal'])
 links.new(bump.outputs['Normal'],shader.inputs['Normal'])
 if data.get('transparent') or data.get('opacity',1)<.999:
  result.surface_render_method='DITHERED'
  shader.inputs['Alpha'].default_value=data.get('opacity',1)
 return result
def mesh(item,geometry,materials):
 vertices=[vec(geometry['positions'][index:index+3]) for index in range(0,len(geometry['positions']),3)]
 indices=geometry.get('indices') or list(range(len(vertices)))
 result=bpy.data.meshes.new('NightWorld/geometry');result.from_pydata(vertices,[],[indices[index:index+3] for index in range(0,len(indices)-2,3)])
 result.materials.append(materials[item['material']]);result.update()
 for polygon in result.polygons:polygon.use_smooth=True
 normals=geometry.get('normals',[])
 if len(normals)==len(vertices)*3:result.normals_split_custom_set_from_vertices([vec(normals[index:index+3]) for index in range(0,len(normals),3)])
 coordinates=geometry.get('uvs',[])
 if len(coordinates)==len(vertices)*2:
  layer=result.uv_layers.new(name='UVMap')
  for loop in result.loops:layer.data[loop.index].uv=coordinates[loop.vertex_index*2:loop.vertex_index*2+2]
 colors=geometry.get('colors',[])
 if len(colors)==len(vertices)*3:
  layer=result.color_attributes.new(name='surfaceColor',type='FLOAT_COLOR',domain='POINT')
  for index in range(len(vertices)):layer.data[index].color=tuple(colors[index*3:index*3+3])+(1,)
  local=result.materials[0].copy();node=local.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name='surfaceColor'
  shader=local.node_tree.nodes['Principled BSDF'];base=shader.inputs['Base Color']
  multiply=local.node_tree.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY';multiply.inputs[0].default_value=1
  if base.is_linked:local.node_tree.links.new(base.links[0].from_socket,multiply.inputs[1])
  else:multiply.inputs[1].default_value=base.default_value
  local.node_tree.links.new(node.outputs['Color'],multiply.inputs[2]);local.node_tree.links.new(multiply.outputs[0],base)
  result.materials.clear();result.materials.append(local)
 instance=bpy.data.objects.new('NightWorld/mesh',result);bpy.context.collection.objects.link(instance);instance.matrix_world=mat(item['matrix'])
 if item.get('offlineRole'):instance['offline_role']=item['offlineRole']
 if item.get('offlineParameters'):instance['offline_parameters']=json.dumps(item['offlineParameters'])
 return instance

def import_asset(asset,root):
 model_dir=root/'assets'/'life'/'models'/asset['id']
 candidates=[model_dir/(asset['id']+'_'+resolution+'.gltf') for resolution in ('8k','4k','2k','1k')]
 source=next((candidate for candidate in candidates if candidate.exists()),None)
 if source is None:raise FileNotFoundError('No local glTF model: '+', '.join(str(candidate) for candidate in candidates))
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(source),merge_vertices=False);imported=set(bpy.data.objects)-before
 bpy.context.view_layer.update()
 corners=[instance.matrix_world@Vector(corner) for instance in imported if instance.type=='MESH' for corner in instance.bound_box]
 minimum=Vector(tuple(min(corner[axis] for corner in corners) for axis in range(3)))
 maximum=Vector(tuple(max(corner[axis] for corner in corners) for axis in range(3)))
 center=(minimum+maximum)*.5;scale=(asset.get('options',{}).get('height') or maximum.z-minimum.z)/max(.001,maximum.z-minimum.z)
 placement=mat(asset['matrix'])@Matrix.Translation((-center.x*scale,-center.y*scale,-minimum.z*scale))@Matrix.Scale(scale,4)
 for instance in imported:
  if instance.parent not in imported:instance.matrix_world=placement@instance.matrix_world
 print('GLTF_IMPORTED',asset['id'],len(imported))

def label(data):
 curve=bpy.data.curves.new('NightWorld/label','FONT');curve.body=str(data.get('text',''));curve.align_x='CENTER';curve.align_y='CENTER'
 curve.size=min(data.get('width',2)/max(1,len(curve.body)*.62),data.get('width',2)/6)
 instance=bpy.data.objects.new('NightWorld/label',curve);bpy.context.collection.objects.link(instance)
 instance.data.materials.append(material({'color':data.get('color','#c9d5df')},Path('.')))
 instance.matrix_world=mat(data['matrix'])@BASIS

def screen(data):
 placement=mat(data['matrix']);horizontal_scale=data['width']/data['canvasWidth'];vertical_scale=data['height']/data['canvasHeight']
 for index,command in enumerate(data['commands']):
  ink=command.get('color','#89a4ab');depth=-.003-index*.000005
  screen_material=material({'color':ink,'emissive':ink,'emissiveIntensity':.45},Path('.'))
  if command['type']=='text':
   curve=bpy.data.curves.new('NightWorld/instrument text','FONT');curve.body=str(command['text']);curve.align_x='LEFT';curve.align_y='BOTTOM_BASELINE'
   font_size=float(command.get('font','16px').split('px')[0].split()[-1]);curve.size=font_size*vertical_scale
   instance=bpy.data.objects.new('NightWorld/instrument text',curve);bpy.context.collection.objects.link(instance)
   instance.data.materials.append(screen_material)
   offset=Matrix.Translation((command['horizontal']*horizontal_scale-data['width']/2,depth,data['height']/2-command['vertical']*vertical_scale))
   instance.matrix_world=placement@offset@BASIS
  elif command['type']=='rect':
   left=command['horizontal']*horizontal_scale-data['width']/2;right=left+command['width']*horizontal_scale
   top=data['height']/2-command['vertical']*vertical_scale;bottom=top-command['height']*vertical_scale
   rectangle=bpy.data.meshes.new('NightWorld/screen fill');rectangle.from_pydata([(left,depth,bottom),(right,depth,bottom),(right,depth,top),(left,depth,top)],[],[(0,1,2,3)])
   rectangle.materials.append(screen_material);instance=bpy.data.objects.new('NightWorld/screen fill',rectangle);bpy.context.collection.objects.link(instance);instance.matrix_world=placement
  elif command['type']=='line':
   curve=bpy.data.curves.new('NightWorld/screen trace','CURVE');curve.dimensions='3D';curve.bevel_depth=max(.0002,command.get('width',1)*horizontal_scale*.5);curve.bevel_resolution=1
   spline=curve.splines.new('POLY');spline.points.add(len(command['points'])-1)
   for point,coordinate in zip(spline.points,command['points']):point.co=(coordinate[0]*horizontal_scale-data['width']/2,depth,data['height']/2-coordinate[1]*vertical_scale,1)
   curve.materials.append(screen_material);instance=bpy.data.objects.new('NightWorld/screen trace',curve);bpy.context.collection.objects.link(instance);instance.matrix_world=placement
def device(scene,want):
 scene.cycles.device='CPU' if want=='CPU' else 'GPU';
 if want=='CPU':print('CYCLES_DEVICE CPU explicit');return
 p=bpy.context.preferences.addons['cycles'].preferences;p.compute_device_type=want;p.get_devices();[setattr(d,'use',d.type==want) for d in p.devices];active=[d for d in p.devices if d.use];print('CYCLES_DEVICE',want,[(d.name,d.type,d.use) for d in p.devices]);
 if not active:raise RuntimeError('No active GPU device; refusing CPU fallback')

def camera_horizon(world,coordinates,texture,strength):
 nodes,links=world.node_tree.nodes,world.node_tree.links
 source=texture.image
 width,height=source.size
 samples=[]
 for fraction in (.523,.528,.534):
  offset=int(height*fraction)*width*4
  row=source.pixels[offset:offset+width*4]
  samples.extend(tuple(row[index:index+3]) for index in range(0,len(row),64))
 haze=tuple(sorted(sample[channel] for sample in samples)[len(samples)//2] for channel in range(3))
 direction=nodes.new('ShaderNodeSeparateXYZ')
 links.new(coordinates.outputs['Generated'],direction.inputs[0])
 transition=nodes.new('ShaderNodeMapRange');transition.interpolation_type='SMOOTHERSTEP';transition.clamp=True
 transition.inputs['From Min'].default_value=-.02618;transition.inputs['From Max'].default_value=.06976
 transition.inputs['To Min'].default_value=0;transition.inputs['To Max'].default_value=1
 links.new(direction.outputs['Z'],transition.inputs['Value'])
 visible_color=nodes.new('ShaderNodeMixRGB');visible_color.name='Camera-only lower-hemisphere horizon haze'
 visible_color.inputs[1].default_value=haze+(1,)
 links.new(transition.outputs['Result'],visible_color.inputs[0]);links.new(texture.outputs['Color'],visible_color.inputs[2])
 visible=nodes.new('ShaderNodeBackground');visible.inputs['Strength'].default_value=strength
 links.new(visible_color.outputs[0],visible.inputs['Color'])
 rays=nodes.new('ShaderNodeLightPath');separate=nodes.new('ShaderNodeMixShader')
 links.new(rays.outputs['Is Camera Ray'],separate.inputs[0])
 links.new(nodes['Background'].outputs[0],separate.inputs[1]);links.new(visible.outputs[0],separate.inputs[2])
 links.new(separate.outputs[0],nodes['World Output'].inputs['Surface'])
 world['camera_horizon_correction']=json.dumps({'source':source.filepath,'scope':'puresky camera rays only',
  'transition_elevation_degrees':[-1.5,4],'haze_linear_rgb':haze,
  'lighting_and_reflections':'original HDRI','lower_hemisphere':'authored horizon haze, not photographed terrain'})
 print('CAMERA_HORIZON_CORRECTION',world['camera_horizon_correction'],flush=True)

def environment(scene,options,description):
 world=bpy.data.worlds.new('NightWorld/world');scene.world=world;world.use_nodes=True
 nodes,links=world.node_tree.nodes,world.node_tree.links
 background=nodes['Background']
 if options.hdri:
  source=Path(options.hdri).resolve()
  if not source.is_file():raise FileNotFoundError(source)
  texture=nodes.new('ShaderNodeTexEnvironment');texture.image=bpy.data.images.load(str(source),check_existing=True)
  coordinates=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping')
  mapping.inputs['Rotation'].default_value[2]=math.radians(options.hdri_rotation)
  links.new(coordinates.outputs['Generated'],mapping.inputs['Vector']);links.new(mapping.outputs['Vector'],texture.inputs['Vector'])
  links.new(texture.outputs['Color'],background.inputs['Color']);background.inputs['Strength'].default_value=options.environment_strength
  if '_puresky' in source.stem:camera_horizon(world,coordinates,texture,options.environment_strength)
 else:
  background.inputs['Color'].default_value=(.65,.75,1,1) if description.get('phase')=='day' else (.26,.36,.55,1)
  background.inputs['Strength'].default_value=.24

def sky_image(scene,output):
 hidden=[]
 render_device=scene.cycles.device
 render_samples=scene.cycles.samples
 render_denoising=scene.cycles.use_denoising
 for instance in scene.objects:
  if instance.type!='CAMERA' and not instance.hide_render:
   hidden.append(instance);instance.hide_render=True
 scene.render.film_transparent=False
 scene.render.image_settings.color_mode='RGB'
 scene.cycles.device='CPU'
 scene.cycles.samples=1
 scene.cycles.use_denoising=False
 scene.render.filepath=str(Path(output).resolve())
 Path(scene.render.filepath).parent.mkdir(parents=True,exist_ok=True)
 bpy.ops.render.render(write_still=True)
 for instance in hidden:instance.hide_render=False
 scene.render.film_transparent=True
 scene.render.image_settings.color_mode='RGBA'
 scene.cycles.device=render_device
 scene.cycles.samples=render_samples
 scene.cycles.use_denoising=render_denoising
 print('MATCHED_SKY_OUTPUT',output)

def refine_scene(scene,description):
 filename='refine-cockpit.py' if description.get('scene')=='spaceship' else 'refine-landscapes.py'
 source=Path(__file__).resolve().parent/filename
 specification=importlib.util.spec_from_file_location('world_refinement',source)
 module=importlib.util.module_from_spec(specification)
 specification.loader.exec_module(module)
 return module.refine(scene,description)
def main():
 a=args();d=json.loads(Path(a.scene).read_text());root=Path(a.asset_root).resolve();bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=a.samples;s.cycles.use_denoising=True;device(s,a.device);s.render.resolution_x=a.width;s.render.resolution_y=a.height;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.film_transparent=True
 if a.width!=a.height*2:raise ValueError('Panoramas must have a 2:1 aspect ratio')
 if a.sky_output and not a.hdri:raise ValueError('--sky-output requires --hdri for matched lighting')
 if a.measured_terrain and (a.proxy_only or d.get('scene')!='snowmountain'):raise ValueError('--measured-terrain requires a refined snowmountain scene')
 if not a.proxy_only and d.get('scene')=='spaceship':
  displays=runpy.run_path(str(Path(__file__).resolve().with_name('refine-flight-displays.py')))
  d=displays['refine'](d)
 s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast';s.view_settings.exposure=a.exposure
 environment(s,a,d.get('environment',{}))
 ms=[material(x,root) for x in d['materials']];gs={x['id']:x for x in d['geometry']}
 for o in d['objects']:mesh(o,gs[o['geometry']],ms)
 for value in d.get('assets',[]):import_asset(value,root)
 for value in d.get('labels',[]):label(value)
 for value in d.get('screens',[]):screen(value)
 if a.measured_terrain:
  terrain=runpy.run_path(str(Path(__file__).resolve().with_name('refine-terrain.py')))
  terrain['refine'](s,d,root)
 if not a.proxy_only and d.get('scene')=='hogwarts':
  highlands=runpy.run_path(str(Path(__file__).resolve().with_name('refine-highlands.py')))
  highlands['refine'](s,d,root)
 for x in d['lights']:
  ld=bpy.data.lights.new('NightWorld/light','POINT');ld.energy=x['intensity']*12;ld.color=col(x['color']);ob=bpy.data.objects.new('NightWorld/light',ld);bpy.context.collection.objects.link(ob);ob.location=vec(x['position'])
 if not a.proxy_only and not (d.get('scene')=='shelter' and d.get('artRevision')=='street-settlement-v1'):refine_scene(s,d)
 if not a.proxy_only and d.get('scene')=='shelter':
  refinement='refine-wasteland.py' if d.get('artRevision')=='street-settlement-v1' else 'refine-shelter.py'
  shelter=runpy.run_path(str(Path(__file__).resolve().with_name(refinement)))
  shelter['refine'](s,d)
 if a.measured_terrain:terrain['ground_props'](s,d)
 if not a.hdri and d.get('environment',{}).get('sunDirection'):
  ld=bpy.data.lights.new('NightWorld/sun','SUN');ld.energy=d['environment'].get('sunIntensity',1);ob=bpy.data.objects.new('NightWorld/sun',ld);bpy.context.collection.objects.link(ob);ob.rotation_euler=(-Vector(vec(d['environment']['sunDirection']))).to_track_quat('-Z','Y').to_euler()
 cd=bpy.data.cameras.new('NightWorld/equirectangular');cd.type='PANO';cd.panorama_type='EQUIRECTANGULAR';cam=bpy.data.objects.new('NightWorld/camera',cd);bpy.context.collection.objects.link(cam);cam.location=vec(d['observation']['position']);cam.rotation_euler=(math.pi/2,0,0);s.camera=cam
 out=Path(a.output).resolve();blend=Path(a.blend).resolve();out.parent.mkdir(parents=True,exist_ok=True);blend.parent.mkdir(parents=True,exist_ok=True);s.render.filepath=str(out);bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(blend));print('ALPHA_COMPOSITE RGBA film_transparent',s.render.film_transparent)
 if not a.save_only:bpy.ops.render.render(write_still=True);print('PANORAMA_OUTPUT',out)
 if not a.save_only and a.sky_output:sky_image(s,a.sky_output)
 print('BLEND_OUTPUT',blend)
if __name__=='__main__':main()
