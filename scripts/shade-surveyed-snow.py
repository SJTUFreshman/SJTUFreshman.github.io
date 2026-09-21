"""Add verified close-range snow PBR detail without changing surveyed geometry."""
import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Vector


def apply(objects, options):
    manifest_path = Path(options['manifest']).resolve()
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    record = next(asset for asset in manifest['assets'] if asset['id'] == 'snow_02' and asset['resolution'] == '4k')
    images, sources = {}, []
    channels = ('nor', 'rough', 'diff') if options.get('close_diffuse') else ('nor', 'rough')
    for channel in record['channels']:
        if channel['channel'] not in channels:
            continue
        path = Path(channel['path']).resolve()
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != channel['sha256']:
            raise ValueError(f'Snow PBR checksum mismatch: {path}')
        image = bpy.data.images.load(str(path), check_existing=True)
        image.colorspace_settings.name = 'sRGB' if channel['channel'] == 'diff' else 'Non-Color'
        if min(image.size) != 4096:
            raise ValueError('Expected actual 4K snow maps')
        images[channel['channel']] = image
        sources.append({'path': str(path), 'sha256': digest, 'channel': channel['channel']})
    if set(images) != set(channels):
        raise ValueError('All requested verified snow PBR channels are required')
    prefixes = tuple(options.get('material_prefixes', ['surveyed-']))
    repeat_metres = float(options.get('repeat_metres', 2))
    if repeat_metres <= 0:
        raise ValueError('Snow PBR repeat length must be positive')
    uv_name = 'Public snow detail world XY'
    for instance in objects:
        if instance.type != 'MESH' or not any(material and material.name.startswith(prefixes)
                for material in instance.data.materials):
            continue
        coordinates = [instance.matrix_world @ vertex.co for vertex in instance.data.vertices]
        layer = instance.data.uv_layers.get(uv_name) or instance.data.uv_layers.new(name=uv_name)
        for loop in instance.data.loops:
            coordinate = coordinates[loop.vertex_index]
            layer.data[loop.index].uv = Vector((coordinate.x, coordinate.y)) / repeat_metres
    materials = {material for instance in objects if instance.type == 'MESH'
                 for material in instance.data.materials if material}
    changed = []
    for material in materials:
        if not material.name.startswith(prefixes) or not material.use_nodes:
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        shader = next(node for node in nodes if node.type == 'BSDF_PRINCIPLED')
        base = shader.inputs['Base Color']
        if not base.is_linked:
            raise ValueError(f'Surveyed material is missing its orthophoto: {material.name}')
        luminance = nodes.new('ShaderNodeRGBToBW')
        links.new(base.links[0].from_socket, luminance.inputs[0])
        snow = nodes.new('ShaderNodeMapRange')
        snow.clamp = True
        snow.inputs['From Min'].default_value = .32
        snow.inputs['From Max'].default_value = .65
        links.new(luminance.outputs[0], snow.inputs['Value'])
        geometry = nodes.new('ShaderNodeNewGeometry')
        slope = nodes.new('ShaderNodeSeparateXYZ')
        links.new(geometry.outputs['Normal'], slope.inputs[0])
        upward = nodes.new('ShaderNodeMapRange')
        upward.clamp = True
        upward.inputs['From Min'].default_value = .70
        upward.inputs['From Max'].default_value = .92
        links.new(slope.outputs['Z'], upward.inputs['Value'])
        camera = nodes.new('ShaderNodeCameraData')
        distance = nodes.new('ShaderNodeMapRange')
        distance.clamp = True
        distance.interpolation_type = 'SMOOTHERSTEP'
        distance.inputs['From Min'].default_value = 12
        distance.inputs['From Max'].default_value = 65
        distance.inputs['To Min'].default_value = 1
        distance.inputs['To Max'].default_value = 0
        links.new(camera.outputs['View Distance'], distance.inputs['Value'])
        coverage = nodes.new('ShaderNodeMath')
        coverage.operation = 'MULTIPLY'
        links.new(snow.outputs['Result'], coverage.inputs[0])
        links.new(upward.outputs['Result'], coverage.inputs[1])
        weight = nodes.new('ShaderNodeMath')
        weight.operation = 'MULTIPLY'
        links.new(coverage.outputs[0], weight.inputs[0])
        links.new(distance.outputs['Result'], weight.inputs[1])
        mapping = nodes.new('ShaderNodeUVMap')
        mapping.uv_map = uv_name
        textures = {}
        for name, image in images.items():
            texture = nodes.new('ShaderNodeTexImage')
            texture.image = image
            texture.extension = 'REPEAT'
            links.new(mapping.outputs['UV'], texture.inputs['Vector'])
            textures[name] = texture
        normal = nodes.new('ShaderNodeNormalMap')
        normal.uv_map = uv_name
        links.new(textures['nor'].outputs['Color'], normal.inputs['Color'])
        strength = nodes.new('ShaderNodeMath')
        strength.operation = 'MULTIPLY'
        strength.inputs[1].default_value = .7
        links.new(weight.outputs[0], strength.inputs[0])
        links.new(strength.outputs[0], normal.inputs['Strength'])
        links.new(normal.outputs['Normal'], shader.inputs['Normal'])
        roughness = nodes.new('ShaderNodeMixRGB')
        original_roughness = shader.inputs['Roughness']
        if original_roughness.is_linked:
            links.new(original_roughness.links[0].from_socket, roughness.inputs[1])
        else:
            roughness.inputs[1].default_value = (original_roughness.default_value,) * 3 + (1,)
        links.new(weight.outputs[0], roughness.inputs[0])
        links.new(textures['rough'].outputs['Color'], roughness.inputs[2])
        links.new(roughness.outputs[0], shader.inputs['Roughness'])
        if options.get('close_diffuse'):
            original_color = base.links[0].from_socket
            color = nodes.new('ShaderNodeMixRGB')
            links.new(weight.outputs[0], color.inputs[0])
            links.new(original_color, color.inputs[1])
            links.new(textures['diff'].outputs['Color'], color.inputs[2])
            links.new(color.outputs[0], base)
        material['surveyed_snow_surface_detail'] = 'Poly Haven snow_02 normal/roughness, 2m repeat, 12-65m fade'
        changed.append(material.name)
    if not changed:
        raise ValueError('No surveyed snow materials matched')
    return {'source_url': record['source'], 'license': manifest['license'],
            'sources': sources, 'materials': sorted(changed), 'repeat_metres': repeat_metres,
            'fade_metres': [12, 65], 'normal_strength': .7,
            'close_diffuse': bool(options.get('close_diffuse')),
            'preserved': ['all source vertices', 'source distant color', 'camera position'],
            'not_surveyed_detail': 'Supplemental photographed snow PBR is from a separate location',
            'visual_approval': False}
