"""Create demand-loaded ATM1 terrain meshes from the archived DEM scenes.

The static artwork is unchanged. The binary format is a 12-byte little-endian
ATM1/count/count header, float32 XYZ positions, float32 normals, uint16 indices.
An adaptive coastline mesh retains disconnected islands and holes; only the
interior elevation sampling is coarsened. Insets remain separately selectable
models, never fictitiously joined at their page-layout coordinates.
"""
from __future__ import annotations

import argparse
from collections import Counter
import concurrent.futures
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import time
import uuid

import numpy as np
from rasterio.features import shapes
from scipy.ndimage import map_coordinates
from shapely import constrained_delaunay_triangles
from shapely.geometry import shape, box, Point
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/maps/administrative'
MESH=OUT/'meshes'
BUDGET=250_000


def read(path):return json.loads(Path(path).read_text(encoding='utf-8'))


def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.tmp-'+uuid.uuid4().hex)
    temporary.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    os.replace(temporary,path)


def load_scene(path):
    with np.load(path,allow_pickle=False) as scene:
        metadata=json.loads(str(scene['metadata']))
        elevation=scene['elevation_qm'].astype(np.float32)*.25
        mask=np.unpackbits(scene['mask_bits'])[:int(np.prod(scene['mask_shape']))].reshape(scene['mask_shape']).astype(bool)
    return elevation,mask,metadata


def build_geometry(elevation,mask,metadata,grid_x=80,tolerance=1.8,protected_points=()):
    height,width=mask.shape
    grid_y=round(grid_x*height/width)
    xs=np.linspace(0,width,grid_x+1);ys=np.linspace(0,height,grid_y+1)
    original=unary_union([shape(geometry) for geometry,value in shapes(mask.astype(np.uint8),mask=mask) if value])
    poly=original.simplify(tolerance,preserve_topology=True)
    for point in protected_points:
        location=Point(*point)
        if original.covers(location) and not poly.covers(location):
            # A genuine shoreline photo must not disappear with a coarse coast.
            # Restore the actual raster coastline locally; never move its point.
            radius=max(width/grid_x,height/grid_y)*1.5
            window=box(point[0]-radius,point[1]-radius,point[0]+radius,point[1]+radius)
            poly=poly.difference(window).union(original.intersection(window))
    vertices=[];faces=[];lookup={}

    def vertex(x,y):
        key=(round(x,5),round(y,5))
        if key not in lookup:
            lookup[key]=len(vertices);vertices.append(key)
        return lookup[key]

    def triangle(points):
        a,b,c=points[:3]
        area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
        if abs(area)<1e-8:return
        # Image Y points south; world Y points north. Top faces point up.
        if area>0:b,c=c,b
        indices=(vertex(*a),vertex(*b),vertex(*c))
        if len(set(indices))==3:faces.append(indices)

    for iy in range(grid_y):
        y0,y1=ys[iy:iy+2]
        for ix in range(grid_x):
            x0,x1=xs[ix:ix+2]
            sample=mask[max(0,int(y0)):min(height,math.ceil(y1)),max(0,int(x0)):min(width,math.ceil(x1))]
            if not sample.any():continue
            if sample.all():
                triangle([(x0,y0),(x1,y0),(x1,y1)])
                triangle([(x0,y0),(x1,y1),(x0,y1)])
            else:
                clipped=poly.intersection(box(x0,y0,x1,y1))
                if clipped.is_empty:continue
                for part in constrained_delaunay_triangles(clipped).geoms:
                    triangle(list(part.exterior.coords))
    if not faces:raise ValueError('No land faces in terrain scene')
    pixels=np.asarray(vertices,dtype=np.float64)
    gx,gy=np.meshgrid(xs,ys)
    node_heights=map_coordinates(elevation,[gy/height*elevation.shape[0]-.5,gx/width*elevation.shape[1]-.5],order=1,mode='nearest')

    def sample_height(points):
        return map_coordinates(node_heights,[points[:,1]/height*grid_y,points[:,0]/width*grid_x],order=1,mode='nearest')

    heights=sample_height(pixels)
    land_min=float(heights.min())
    x0,y0,x1,y1=poly.bounds
    span=max(x1-x0,y1-y0)
    metres_per_pixel=(metadata['extent_m'][2]-metadata['extent_m'][0])/width
    z_scale=2*metadata['light']['vertical_exaggeration']/(span*metres_per_pixel)
    positions=np.column_stack(((pixels[:,0]-(x0+x1)/2)*2/span,((y0+y1)/2-pixels[:,1])*2/span,(heights-land_min)*z_scale)).tolist()
    top_count=len(positions);top_faces=list(faces)

    # Share wall vertices with adjacent walls, but keep a crisp edge against the
    # top surface. This thin backing is a model base, not invented land height.
    edges=Counter();directed={}
    for tri in faces:
        for a,b in ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])):
            key=tuple(sorted((a,b)));edges[key]+=1;directed[key]=(a,b)
    wall_vertices={};base_z=-.006

    def is_land(x,y):
        return 0<=x<width and 0<=y<height and mask[int(y),int(x)]

    def wall_vertex(index,bottom):
        key=(index,bottom)
        if key not in wall_vertices:
            wall_vertices[key]=len(positions)
            x,y,z=positions[index];positions.append([x,y,base_z if bottom else z])
        return wall_vertices[key]

    for key,count in edges.items():
        if count!=1:continue
        a,b=directed[key];pa,pb=pixels[a],pixels[b]
        delta=pb-pa;length=float(np.linalg.norm(delta))
        if length<1e-9:continue
        mid=(pa+pb)/2;normal=np.array([-delta[1],delta[0]])/length*.6
        # A collinear subdivision of a neighbouring cell is not an outside edge.
        if is_land(*(mid+normal)) and is_land(*(mid-normal)):continue
        at,bt=wall_vertex(a,False),wall_vertex(b,False)
        ab,bb=wall_vertex(a,True),wall_vertex(b,True)
        faces.extend([(at,bb,bt),(at,ab,bb)])

    positions=np.asarray(positions,dtype='<f4');indices=np.asarray(faces,dtype=np.uint32)
    normals=np.zeros_like(positions)
    cross=np.cross(positions[indices[:,1]]-positions[indices[:,0]],positions[indices[:,2]]-positions[indices[:,0]])
    for corner in range(3):np.add.at(normals,indices[:,corner],cross)
    lengths=np.linalg.norm(normals,axis=1);normals/=np.maximum(lengths[:,None],1e-12)
    if len(positions)>=65535:raise ValueError('Mesh exceeds uint16 vertex limit')
    indices=indices.astype('<u2')
    payload=struct.pack('<4sII',b'ATM1',len(positions),indices.size)+positions.tobytes()+normals.astype('<f4').tobytes()+indices.tobytes()
    info={'vertices':len(positions),'triangles':len(indices),'grid':[grid_x,grid_y],
          'top_vertices':top_count,'top_triangles':len(top_faces),
          'coast_tolerance_px':tolerance,'pixel_bounds':[x0,y0,x1,y1],
          'elevation_origin_m':land_min,'vertical_exaggeration':metadata['light']['vertical_exaggeration'],
          'metres_per_pixel':metres_per_pixel,'base_thickness':abs(base_z),
          'source_archive':metadata.get('source_archive')}
    return payload,info,pixels,np.asarray(top_faces),positions[:top_count]


def surface_points(places,pixels,triangles,positions):
    result={};triangle_pixels=pixels[triangles]
    lo=triangle_pixels.min(axis=1);hi=triangle_pixels.max(axis=1)
    for place in places:
        point=np.asarray(place['point'],dtype=float)
        candidates=np.flatnonzero(np.all(point>=lo-1e-5,axis=1)&np.all(point<=hi+1e-5,axis=1))
        for index in candidates:
            a,b,c=triangle_pixels[index];v0=b-a;v1=c-a;v2=point-a
            denominator=v0[0]*v1[1]-v1[0]*v0[1]
            if abs(denominator)<1e-10:continue
            u=(v2[0]*v1[1]-v1[0]*v2[1])/denominator
            v=(v0[0]*v2[1]-v2[0]*v0[1])/denominator
            if u>=-1e-5 and v>=-1e-5 and u+v<=1+1e-5:
                world=positions[triangles[index]]
                result[place['id']]=[round(float(value),7) for value in world[0]*(1-u-v)+world[1]*u+world[2]*v]
                break
    return result


def mesh_view(view):
    source=ROOT/view['source_archive']
    elevation,mask,metadata=load_scene(source)
    for attempt in range(4):
        payload,info,pixels,triangles,positions=build_geometry(elevation,mask,metadata,
            grid_x=80-attempt*12,tolerance=1.8+attempt*.8,
            protected_points=[place['point'] for place in view.get('places',[])])
        if len(payload)<=BUDGET:break
    if len(payload)>BUDGET:raise ValueError(f'Mesh budget exceeded: {source.name}: {len(payload)}')
    target=MESH/(source.stem+'.atm')
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(payload)
    view['mesh']={**info,'file':target.relative_to(ROOT).as_posix(),'bytes':len(payload),
        'source_archive':view['source_archive'],'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'points':surface_points(view.get('places',[]),pixels,triangles,positions)}
    for inset in view.get('insets',[]):mesh_view(inset)
    if view.get('insets'):
        view['mesh']['parts']=[{**inset['mesh'],'title':inset.get('title') or inset['frame']['title'],'id':inset['id']} for inset in view['insets']]


def refresh_points(view):
    mesh=view['mesh'];payload=(ROOT/mesh['file']).read_bytes()
    _,vertex_count,index_count=struct.unpack_from('<4sII',payload)
    positions=np.frombuffer(payload,dtype='<f4',count=vertex_count*3,offset=12).reshape((-1,3))[:mesh['top_vertices']]
    indices=np.frombuffer(payload,dtype='<u2',count=index_count,offset=12+vertex_count*24).reshape((-1,3))[:mesh['top_triangles']]
    x0,y0,x1,y1=mesh['pixel_bounds'];span=max(x1-x0,y1-y0)
    pixels=np.column_stack((positions[:,0]*span/2+(x0+x1)/2,(y0+y1)/2-positions[:,1]*span/2))
    mesh['points']=surface_points(view.get('places',[]),pixels,indices,positions)
    for inset in view.get('insets',[]):refresh_points(inset)
    if view.get('insets'):
        mesh['parts']=[{**inset['mesh'],'title':inset.get('title') or inset['frame']['title'],'id':inset['id']} for inset in view['insets']]


def build_unit(filename,points_only=False):
    document=read(filename)
    for view in document['views'].values():
        if points_only:refresh_points(view)
        else:mesh_view(view)
    write(Path(filename),document)
    print(document['id'],sum(view['mesh']['bytes'] for view in document['views'].values()),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only',help='Comma-separated administrative IDs')
    parser.add_argument('--exclude',default='')
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--refresh-points',action='store_true',help='Update photo XYZ after refreshing place metadata; retain mesh files')
    args=parser.parse_args()
    units=read(OUT/'manifest.json')['units'];selected=set(args.only.split(',')) if args.only else set(units)
    selected-=set(args.exclude.split(','))
    filenames=[ROOT/units[key]['file'] for key in units if key in selected]
    started=time.monotonic();failures=[]
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures={pool.submit(build_unit,filename,args.refresh_points):filename for filename in filenames}
        for future in concurrent.futures.as_completed(futures):
            try:future.result()
            except Exception as error:
                failures.append({'file':str(futures[future]),'error':str(error)});print('ERROR',futures[future],repr(error),flush=True)
    print(json.dumps({'units':len(filenames),'seconds':round(time.monotonic()-started,1),'failures':failures}),flush=True)
    if failures:raise SystemExit(1)


if __name__=='__main__':main()
