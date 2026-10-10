"""Render white and coloured relief using the approved atlas lighting and material."""

import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--reference-root", type=Path, default=Path(__file__).resolve().parents[1] / "tools/relief-atlas/reference")
    parser.add_argument("--map", required=True)
    parser.add_argument("--save-scene", action="store_true")
    parser.add_argument("--scene-only", action="store_true", help="Save and reopen production scenes without repeating the render")
    arguments = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if arguments.scene_only:
        arguments.save_scene = True
    sys.path.insert(0, str(arguments.reference_root))
    from render_atlas import linear_color, make_terrain, matte_material, setup_lighting

    metadata = json.loads((arguments.root / "data" / (arguments.map + ".json")).read_text(encoding="utf-8"))
    data = np.load(arguments.root / "data" / (arguments.map + ".npz"))
    west, south, east, north = metadata["extent_km"]
    world_per_km = 24 / (north-south)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    terrain = make_terrain("footprints", data, {"exaggeration": metadata["vertical_exaggeration"]},
                           world_per_km, (west+east)/2, (south+north)/2)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    bpy.context.object.data.materials.append(matte_material("Sea / paper", metadata["background"]))
    camera_data = bpy.data.cameras.new("Orthographic atlas camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 24 * max(metadata["width"]/metadata["height"], 1)
    camera = bpy.data.objects.new("Orthographic atlas camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0, 0, 80)
    camera.rotation_euler = (0, 0, 0)
    scene.camera = camera
    lighting = setup_lighting(32)
    scene.render.engine = "CYCLES"
    scene.cycles.samples = metadata.get("samples", 192)
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 5
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 1
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "CUDA"
    preferences.get_devices()
    gpu_devices = []
    for device in preferences.devices:
        device.use = device.type == "CUDA"
        if device.use:
            gpu_devices.append(device.name)
    if not gpu_devices:
        raise RuntimeError("CUDA GPU required")
    scene.cycles.device = "GPU"
    scene.render.resolution_x = metadata["width"]
    scene.render.resolution_y = metadata["height"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 85
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = -0.4
    scene.view_settings.gamma = 1
    renders = arguments.root / "renders"
    renders.mkdir(exist_ok=True)
    colors = np.ones((len(terrain.data.vertices), 4), dtype=np.float32)
    vertex_count = len(terrain.data.vertices)
    attribute = terrain.data.color_attributes["ReliefColor"]
    saved_scenes = []
    for variant in ("relief", "colour") if arguments.map != "europe_usa" else ("relief",):
        if variant == "colour":
            mask = data["mask"].astype(bool) & np.isfinite(data["elevation"])
            regions = data["region"][mask]
            for region_id, color in metadata.get("region_colors", {}).items():
                colors[regions == int(region_id), :3] = linear_color(color)
        attribute.data.foreach_set("color", colors.ravel())
        terrain.data.update()
        scene.render.filepath = f"//../renders/{arguments.map}-{variant}.png"
        if arguments.save_scene:
            scenes = arguments.root / "scenes"
            scenes.mkdir(exist_ok=True)
            bpy.context.preferences.filepaths.save_version = 0
            scene_path = scenes / f"{arguments.map}-{variant}.blend"
            bpy.ops.wm.save_as_mainfile(filepath=str(scene_path), compress=True)
            saved_scenes.append((variant, scene_path))
        if arguments.scene_only:
            continue
        scene.render.filepath = str(renders / f"{arguments.map}-{variant}.png")
        bpy.ops.render.render(write_still=True)
    if arguments.scene_only:
        verification = {}
        for variant, scene_path in saved_scenes:
            bpy.ops.wm.open_mainfile(filepath=str(scene_path))
            restored_scene = bpy.context.scene
            restored_terrain = bpy.data.objects["Terrain / footprints"]
            assert len(restored_terrain.data.vertices) == vertex_count
            assert restored_scene.camera.data.type == "ORTHO"
            assert (restored_scene.render.resolution_x, restored_scene.render.resolution_y) == (metadata["width"], metadata["height"])
            assert restored_scene.cycles.samples == metadata["samples"]
            assert json.loads(restored_scene["lighting"]) == lighting
            assert restored_scene.render.filepath == f"//../renders/{arguments.map}-{variant}.png"
            actual_colors = np.empty(vertex_count*4, dtype=np.float32)
            restored_terrain.data.color_attributes["ReliefColor"].data.foreach_get("color", actual_colors)
            expected_colors = np.ones_like(colors) if variant == "relief" else colors
            assert np.allclose(actual_colors.reshape((-1, 4)), expected_colors, atol=0.000001)
            assert all(image.packed_file for image in bpy.data.images if image.source == "FILE")
            verification[variant] = {"file": scene_path.name, "sha256": hashlib.sha256(scene_path.read_bytes()).hexdigest(),
                                     "bytes": scene_path.stat().st_size, "vertices": vertex_count,
                                     "resolution": [metadata["width"], metadata["height"]], "reopened": True,
                                     "pigments_verified": True, "lighting_verified": True, "external_images": False}
        (arguments.root / "scenes" / (arguments.map + "-scenes.json")).write_text(json.dumps(verification, indent=2) + "\n", encoding="utf-8")
        print("SCENES VERIFIED", arguments.map, flush=True)
        return
    report = {"lighting": lighting, "render_engine": "Blender 4.5.3 / Cycles CUDA", "samples": scene.cycles.samples,
              "native_render_size": [metadata["width"], metadata["height"]],
              "gpu_devices": gpu_devices, "unvisited_material": "#ffffff", "administrative_outlines": False}
    (renders / (arguments.map + "-render.json")).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("COMPLETE", arguments.map, flush=True)


if __name__ == "__main__":
    main()
