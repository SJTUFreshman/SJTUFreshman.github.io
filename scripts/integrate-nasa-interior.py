"""Build the Life spaceship offline scene from the verified NASA ISS interior."""
import json
import math
from pathlib import Path
import runpy
import shutil

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


SOURCE_CAMERA = Vector((0, 98, -20.5))
# Deliberately enlarged for the Life ship, not a claim about ISS physical units.
ARTISTIC_SCALE = .22
HIDDEN = [f'Cupola_WC_{index:02d}' for index in range(1, 8)] + ['Cupola_Int_Glass']


def visible_surface(meshes):
    vertices, triangles = [], []
    for obj in meshes:
        if obj.hide_render:
            continue
        offset = len(vertices)
        vertices.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
        obj.data.calc_loop_triangles()
        triangles.extend(tuple(offset + index for index in triangle.vertices)
                         for triangle in obj.data.loop_triangles)
    return BVHTree.FromPolygons(vertices, triangles, all_triangles=True)


def integrate(scene, description, source, working_directory):
    if description.get('scene') != 'spaceship':
        raise ValueError('NASA interior integration requires the spaceship descriptor')
    helper = runpy.run_path(str(Path(__file__).with_name('inspect-nasa-interior.py')))
    helper['require_gpu'](scene)
    source = Path(source).resolve()
    if source.suffix.lower() != '.fbx' or helper['digest'](source) != helper['SOURCE_SHA256']:
        raise ValueError('NASA FBX does not match the verified official source')
    # Blender extracts FBX embedded textures beside the import; keep that work isolated.
    working_directory = Path(working_directory).resolve()
    working_directory.mkdir(parents=True, exist_ok=True)
    isolated = working_directory / 'nasa-source-copy.fbx'
    if isolated == source:
        raise ValueError('NASA original source must remain separate from the render output')
    if isolated.exists():
        if helper['digest'](isolated) != helper['SOURCE_SHA256']:
            raise ValueError('Existing isolated NASA copy has an unexpected hash')
    else:
        shutil.copyfile(source, isolated)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(isolated), use_image_search=True,
                             automatic_bone_orientation=False, use_custom_normals=True)
    imported = set(bpy.data.objects) - before
    bpy.context.view_layer.update()
    meshes = [obj for obj in imported if obj.type == 'MESH']
    if len(meshes) != 265:
        raise ValueError(f'Unexpected NASA mesh inventory: {len(meshes)}')
    for obj in imported:
        if obj.type in ('CAMERA', 'LIGHT'):
            obj.hide_render = True
    material_changes = helper['repair_imported_materials']()
    materials = {material for obj in meshes for material in obj.data.materials if material}
    images = {node.image for material in materials if material.use_nodes
              for node in material.node_tree.nodes if node.type == 'TEX_IMAGE' and node.image}
    # Blender lazily decodes non-colour images. Read size/pixels before has_data;
    # the original inspector also resolves image.size before checking has_data.
    image_records = []
    for image in sorted(images, key=lambda item: item.name):
        dimensions = list(image.size)
        sample = list(image.pixels[:4])
        image_records.append({'name': image.name, 'dimensions': dimensions,
                              'loaded': image.has_data and len(sample) == 4})
    missing = [image['name'] for image in image_records if not image['loaded']]
    if missing:
        raise ValueError('NASA material textures have no loaded pixels: ' + json.dumps(missing))
    if len(images) < 90:
        raise ValueError(f'Unexpected NASA material image inventory: {len(images)}')
    for name in HIDDEN:
        obj = bpy.data.objects.get(name)
        if obj not in imported:
            raise ValueError('Missing NASA sky-opening object: ' + name)
        obj.hide_render = True
    observation = description['observation']['position']
    destination = Vector((observation[0], -observation[2], observation[1]))
    # NASA Cupola faces -Z; Life's zero-yaw view faces Blender +Y.
    rotation = Matrix.Rotation(math.pi / 2, 4, 'X')
    transform = (Matrix.Translation(destination) @ rotation @
                 Matrix.Scale(ARTISTIC_SCALE, 4) @ Matrix.Translation(-SOURCE_CAMERA))
    for obj in imported:
        if obj.parent not in imported:
            obj.matrix_world = transform @ obj.matrix_world
    bpy.context.view_layer.update()
    lighting = []
    # Authored cabin fixtures supply room light independently of the exterior sky.
    for name, position, target, watts, size in [
        ('Cupola port fill', (-6, 98, -21), (0, 98, -29), 45, .65),
        ('Cupola starboard fill', (6, 98, -21), (0, 98, -29), 45, .65),
        ('Node3 equipment light', (0, 97, -10), (0, 83, 0), 110, 1.1),
        ('Node3 aisle light', (0, 75, -8), (0, 77, 0), 90, 1.1),
    ]:
        data = bpy.data.lights.new('Life NASA/' + name, 'AREA')
        data.energy = watts
        data.color = (1, .91, .80)
        data.shape = 'DISK'
        data.size = size
        obj = bpy.data.objects.new(data.name, data)
        scene.collection.objects.link(obj)
        obj.location = transform @ Vector(position)
        aim = transform @ Vector(target)
        obj.rotation_euler = (aim - obj.location).to_track_quat('-Z', 'Y').to_euler()
        lighting.append({'name': name, 'watts': watts, 'diameter': size,
                         'position': list(obj.location), 'target': list(aim)})
    bpy.context.view_layer.update()
    surface = visible_surface(meshes)
    clearances = []
    for direction in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)):
        location, normal, face, distance = surface.ray_cast(destination, Vector(direction), 1000)
        if distance is not None and distance < .05:
            raise ValueError('NASA observer intersects imported geometry')
        clearances.append({'direction': direction, 'distance': distance,
                           'scope': 'visible render meshes only'})
    window_rays = []
    # These seven pixels were alpha=0 in the verified r5 source camera, at 85 degrees.
    # A shutter bounding-box centre is not necessarily inside its actual aperture.
    probes = [(800, 550), (220, 320), (810, 80), (220, 800), (810, 1030), (1450, 340), (1450, 800)]
    tangent = math.tan(math.radians(85) / 2)
    for index, (x, y) in enumerate(probes):
        source_direction = Vector(((x + .5 - 800) * tangent / 550,
                                   (550 - y - .5) * tangent / 550, -1))
        direction = (rotation.to_3x3() @ source_direction).normalized()
        hit, normal, face, distance = surface.ray_cast(destination, direction, 1000)
        window_rays.append({'opening_sample': index + 1, 'source_pixel_r5': [x, y], 'direction': list(direction),
                            'clear_to_exterior': hit is None, 'hit_distance': distance})
    if not all(probe['clear_to_exterior'] for probe in window_rays):
        raise ValueError('NASA sky-opening probe blocked: ' + json.dumps(window_rays))
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    report = {
        'source': str(source), 'source_sha256': helper['SOURCE_SHA256'],
        'isolated_import_copy': str(isolated),
        'credit': 'NASA, International Space Station (ISS) (E) (Internal)',
        'source_url': 'https://science.nasa.gov/3d-resources/international-space-station-iss-e-internal/',
        'mesh_count': len(meshes), 'triangles': triangles,
        'loaded_material_images': len(images),
        'images': image_records,
        'physical_scale_verified': False, 'artistic_scale': ARTISTIC_SCALE,
        'scale_note': 'Authored enlarged Life cabin; source units have not been calibrated to metres',
        'source_observer': list(SOURCE_CAMERA), 'life_observer': list(destination),
        'source_to_life_matrix': [list(row) for row in transform],
        'hidden_for_independent_sky': HIDDEN, 'material_changes': material_changes,
        'authored_roughness_remap': False, 'authored_cabin_lighting': lighting,
        'camera_axis_clearance': clearances, 'source_geometry_and_uv_preserved': True,
        'window_rays': window_rays,
        'photographic_acceptance': False, 'manifest_installed': False,
    }
    scene['nasa_integration_report'] = json.dumps(report)
    print('NASA_LIFE_INTEGRATION', json.dumps(report), flush=True)
    return report
