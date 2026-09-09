#!/usr/bin/env python3
"""Cycles equirectangular renderer for export-world-scene.cjs output."""
import argparse,json,math,sys
from pathlib import Path
try:
 import bpy
 from mathutils import Matrix,Vector
except ImportError: raise SystemExit('Run with Blender: blender -b --python scripts/render-world-panorama.py -- ...')
BASIS=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
def args():
 p=argparse.ArgumentParser();p.add_argument('--scene',required=True);p.add_argument('--output',required=True);p.add_argument('--blend',required=True);p.add_argument('--asset-root',default=str(Path(__file__).resolve().parent.parent));p.add_argument('--width',type=int,default=4096);p.add_argument('--height',type=int,default=2048);p.add_argument('--samples',type=int,default=256);p.add_argument('--device',choices=('CPU','CUDA','OPTIX'),default='CUDA');p.add_argument('--save-only',action='store_true');return p.parse_args(sys.argv[sys.argv.index('--')+1:])
def vec(v): return (float(v[0]),-float(v[2]),float(v[1]))
def col(v):
 n=int(v.lstrip('#'),16) if isinstance(v,str) else int(v);return tuple((n>>s&255)/255 for s in (16,8,0))
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
 for name,detail in data.get('textures',{}).items():
  source=root/detail['path']
  if not source.exists():raise FileNotFoundError(source)
  texture=nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(str(source),check_existing=True)
  texture.image.colorspace_settings.name='sRGB' if name=='baseColor' else 'Non-Color'
  coordinates=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeMapping')
  mapping.inputs['Scale'].default_value=tuple(detail.get('repeat',[1,1]))+(1,)
  links.new(coordinates.outputs['UV'],mapping.inputs['Vector']);links.new(mapping.outputs['Vector'],texture.inputs['Vector'])
  if name=='normal':
   normal_node=nodes.new('ShaderNodeNormalMap');normal_node.inputs['Strength'].default_value=.3;links.new(texture.outputs['Color'],normal_node.inputs['Color'])
  elif name in ['baseColor','roughness']:links.new(texture.outputs['Color'],shader.inputs['Base Color' if name=='baseColor' else 'Roughness'])
 noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=160
 bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.0005
 links.new(noise.outputs['Fac'],bump.inputs['Height'])
 if normal_node:links.new(normal_node.outputs['Normal'],bump.inputs['Normal'])
 links.new(bump.outputs['Normal'],shader.inputs['Normal'])
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
  local.node_tree.links.new(node.outputs['Color'],local.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
  result.materials.clear();result.materials.append(local)
 instance=bpy.data.objects.new('NightWorld/mesh',result);bpy.context.collection.objects.link(instance);instance.matrix_world=mat(item['matrix']);return instance

def import_asset(asset,root):
 source=root/'assets'/'life'/'models'/asset['id']/(asset['id']+'_1k.gltf')
 if not source.exists():raise FileNotFoundError(source)
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
def main():
 a=args();d=json.loads(Path(a.scene).read_text());root=Path(a.asset_root);bpy.ops.wm.read_factory_settings(use_empty=True);s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=a.samples;s.cycles.use_denoising=True;device(s,a.device);s.render.resolution_x=a.width;s.render.resolution_y=a.height;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.film_transparent=True
 w=bpy.data.worlds.new('NightWorld/world');s.world=w;w.use_nodes=True;w.node_tree.nodes['Background'].inputs['Color'].default_value=(.65,.75,1,1) if d.get('environment',{}).get('phase')=='day' else (.26,.36,.55,1);w.node_tree.nodes['Background'].inputs['Strength'].default_value=.24
 ms=[material(x,root) for x in d['materials']];gs={x['id']:x for x in d['geometry']}
 for o in d['objects']:mesh(o,gs[o['geometry']],ms)
 for value in d.get('assets',[]):import_asset(value,root)
 for value in d.get('labels',[]):label(value)
 for value in d.get('screens',[]):screen(value)
 for x in d['lights']:
  ld=bpy.data.lights.new('NightWorld/light','POINT');ld.energy=x['intensity']*12;ld.color=col(x['color']);ob=bpy.data.objects.new('NightWorld/light',ld);bpy.context.collection.objects.link(ob);ob.location=vec(x['position'])
 if d.get('environment',{}).get('sunDirection'):
  ld=bpy.data.lights.new('NightWorld/sun','SUN');ld.energy=d['environment'].get('sunIntensity',1);ob=bpy.data.objects.new('NightWorld/sun',ld);bpy.context.collection.objects.link(ob);ob.rotation_euler=(-Vector(vec(d['environment']['sunDirection']))).to_track_quat('-Z','Y').to_euler()
 cd=bpy.data.cameras.new('NightWorld/equirectangular');cd.type='PANO';cd.panorama_type='EQUIRECTANGULAR';cam=bpy.data.objects.new('NightWorld/camera',cd);bpy.context.collection.objects.link(cam);cam.location=vec(d['observation']['position']);cam.rotation_euler=(math.pi/2,0,0);s.camera=cam
 out=Path(a.output).resolve();blend=Path(a.blend).resolve();out.parent.mkdir(parents=True,exist_ok=True);blend.parent.mkdir(parents=True,exist_ok=True);s.render.filepath=str(out);bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(blend));print('ALPHA_COMPOSITE RGBA film_transparent',s.render.film_transparent)
 if not a.save_only:bpy.ops.render.render(write_still=True);print('PANORAMA_OUTPUT',out)
 print('BLEND_OUTPUT',blend)
if __name__=='__main__':main()
