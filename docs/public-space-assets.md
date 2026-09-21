# Public space assets for offline cockpit work

## NASA ISS Internal (E)

- **Official model page:** <https://science.nasa.gov/3d-resources/international-space-station-iss-e-internal/>
- **Official source repository:** <https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/International%20Space%20Station%20%28ISS%29%20%28E%29%20%28Internal%29>
- **Retrieved format:** one `FBX` binary (`International Space Station (ISS) [internal].fbx`), assembled from eight official `.7z` volumes.
- **FBX binary inventory:** FBX 7.4; 303 geometry nodes including shape geometry; 295,855 stored vertices; 293,971 polygons; 41 materials. These are archive counts, not a Blender render result.
- **Verified textures:** 97 embedded PNG images; 91 are 4096×4096, with named `Diffuse`, `Normal`, and `Metallic` maps.
- **Recognizable interior groups:** `Node1_Int`, `Node2_Int_*`, `Node3_Int_*`, `EXPRESS_Racks_ATLAS_*`, `Columbus_*`, `JPM_*`, `JLP_*`, `BEAM_*`, and `Bishop_*`.
- **Axes in FBX global settings:** `UpAxis=Z`; `FrontAxis=-Y`; `CoordAxis=X`. `UnitScaleFactor=1` is FBX metadata, not proof that the imported coordinates equal metres. Physical scale remains unverified; the imported Cupola spans roughly 21 Blender units and requires calibration before combination with the Life cockpit.
- **License basis:** NASA's media guidelines state that 3D model texture maps and polygon data are generally usable for educational/informational purposes and personal webpages when NASA is credited and endorsement is not implied. Check any third-party content identified by NASA before commercial reuse.
- **Use in Life:** offline Blender/Cycles only. Import and inspect individual `Node*_Int`/module corridors, then choose a real interior camera. Do not put the FBX or its textures in the browser runtime, and retain the existing independent sky opening.

The isolated download and provenance hashes are in `.render-work/public-models/nasa/provenance.json`. Blender-side verification is provided by `scripts/inspect-nasa-interior.py`; it requires the actual FBX and reports world bounds, triangles, materials, image loading, and mesh names without a fallback importer.

## Actual A800 import, 2026-09-16

Slurm job `164261` completed with exit code `0:0`, using Blender 4.5.3 and an allocated NVIDIA A800-SXM4-80GB. Unlike earlier jobs `162201`, `162212`, and `162218`, it produced an actual `inspection.json` and packed `.blend`; their earlier apparent Slurm completion did not establish successful import.

- Source: `.render-work/public-models/nasa/International Space Station (ISS) [internal].fbx`, 315,560,604 bytes, SHA-256 `bb884b3f5fdae3fe6116bd2241b44e8efb2f804de8785840431f400ebfa09816`.
- Actual Blender import: **265 mesh objects, 474,527 triangles, 41 materials, 108/108 loaded image datablocks**. The source embeds 97 PNG files; alpha uses cause additional Blender image datablocks.
- Unmodified imported bounds: `[-55.3819, -47.4843, -34.1718]` to `[171.2722, 158.3671, 51.2141]`, or `226.6540 × 205.8514 × 85.3858` Blender units. No automatic scale correction is applied.
- Most materials have verified Diffuse → Base Color, Normal → Normal Map → Normal, and Metallic → Metallic connections. Diffuse images use sRGB; normal/metallic images use Non-Color. No roughness texture maps were found; most imported roughness values are constant `0.5`.
- `Node1_Int_Bulkhead` and `Node1_Int_Rack` have no image textures, and no matching Node1 textures occur in the embedded image inventory. This is a source limitation, not a recoverable missing disk path.
- `Generic_Misc_Details` lacks image nodes although the source contains identically named Diffuse/Metallic maps. A diagnostic repair can connect those exact maps without synthesizing textures.
- `Cupola_Glass` imports as metallic `1`, transmission `0`, alpha `0.2`. Diagnostic glass correction is explicitly authored (metallic `0`, transmission `1`, alpha `1`, roughness `0.035`), and must not be described as recovered NASA metadata.

Original import evidence: `.render-work/nasa-inspect-20260916-r1/inspection.json`, `slurm-164261.out`, `slurm-164261.err`; the remote isolated directory also retains `nasa-iss-imported.blend`. The first report's `_m` field suffix was misleading; values are uncalibrated Blender import units. Later reports use `_blender_units` and `physical_scale_verified: false`.

The inspection runner requires an `hp_a800` Slurm allocation and an A800 CUDA device, rejects source hash changes, disables CPU rendering, imports an isolated source copy, and returns a nonzero exit on Python failure via `--python-exit-code 1`. The original FBX and original import blend remain unchanged. The rendered study and all material edits are isolated review artifacts; no runtime asset or panorama manifest is updated.

## Actual A800 image review, 2026-09-16

Job `164271` completed with exit code `0:0` in 6m19s on NVIDIA A800-SXM4-80GB. It rendered five 1600×1100 PNGs at 64 Cycles samples from the original packed import. All five images were opened and visually inspected. Evidence is under `.render-work/nasa-inspect-20260916-r2/`; its report records camera positions, six-axis ray clearances, original and repaired material graphs, and SHA-256 hashes for each rendered PNG.

- `whole-imported.png`: the imported model is a joined collection of interior modules, not a complete spacecraft exterior. It is unsuitable as the exterior hull without separately authored surrounding structure.
- `uslab-imported-forward.png`: a usable interior camera at `[49, 33.8, 0]` looks along +X through the US laboratory toward Node2. Labels, blue handrails, equipment-rack frames, vent covers, hatch seals, and layered panels are visible. This is the strongest inspected source for the Life ship's equipment corridor and rearward views; it does not provide a forward windshield.
- `columbus-imported-forward.png`: camera `[150.4, -3, 0]` looks along -Y inside Columbus. Panel and rack labeling are readable, but the end wall is shallow, the nearby empty rack is dark, and the broad white surfaces remain too uniform for a final photoreal close view.
- `cupola-imported-down.png`: the source glass behaves like a mirror and the three monitors are blank because `Generic_Misc_Details` was unconnected. A large white circle is the diagnostic area-light reflection, not a sky image or missing texture.
- `cupola-repaired-down.png`: connecting the existing source Diffuse/Metallic maps restores the monitors and equipment labels. The explicit glass interpretation still shows strong interior/lamp reflections; this view does not establish an acceptable sky opening. Cupola needs a separate controlled glass/window-cover study before Life use.

The packed reload reports **106/106 loaded and packed image datablocks**. The two additional datablocks in the first import (`BEAM_Int_Diffuse.png.002` and `Node2_Int_Bulkhead_Diffuse.png.001`) are unused duplicates absent after save/reload; this is not a loss of two unique source textures. The source FBX SHA-256 is unchanged. The original geometry and UVs are unchanged in this study; only the recorded material fixes affect the last Cupola image.

These images establish working source geometry and textures, **not photoreal approval**. Remaining issues include constant roughness, obvious polygonal close-up edges, flat small panel details, and no calibrated physical dimensions. The recommendation is to reuse inspected rack/module geometry in the offline Blender build after scale calibration and authored material refinement. Keep the Life sky independent and do not ship the source FBX or these diagnostic images to the browser. The Life consecutive clean-review count remains **0**, and no panorama or manifest is installed.

## Cupola opening diagnostic, 2026-09-17

Job `164545` completed with exit code `0:0` in 61 seconds on NVIDIA A800-SXM4-80GB. The three 1600×1100, 64-sample images in `.render-work/nasa-inspect-20260916-r3/` were opened and reviewed. All use the same camera as r2 and the recorded material repairs; the added studio lamp is removed and the neutral environment is made brighter to diagnose transmission. This neutral environment is a study backdrop, not Life's sky.

- `cupola-repaired-no-studio-lamp.png`: the large white lamp reflection disappears, but the closed source window covers prevent an exterior view and leave the cabin dark.
- `cupola-repaired-covers-hidden.png`: hiding precisely `Cupola_WC_01` through `Cupola_WC_07` lets the neutral environment show through all seven windows. The authored glass correction transmits successfully, with a weaker remaining interior reflection. The source covers, rather than a missing sky asset, were the main obstruction.
- `cupola-opening-alpha-diagnostic.png`: hiding those seven covers plus `Cupola_Int_Glass`, and enabling transparent film, produces genuine RGBA openings. Alpha is exactly zero in 530,102 pixels (30.1194% of the image), with 14,917 partly covered edge pixels. Samples inside each of the seven windows have alpha 0, while sampled frame and monitor pixels have alpha 255. These are transparent pixels, not a black background baked into the panorama.

These visibility overrides apply only to the named render views and are restored afterwards. The retained derivative `.blend` is not an already configured open-window Life scene. The original FBX, its UVs, and its original import `.blend` remain unchanged. All eight r2/r3 PNG hashes match their render reports, and the source FBX still hashes to `bb884b3f5fdae3fe6116bd2241b44e8efb2f804de8785840431f400ebfa09816`.

This establishes that Cupola's window topology can support an independent sky layer. It does **not** approve Cupola as a final Life cockpit: its cabin is underlit, close window rims have visible polygonal edges, and much of its fine detail is flat texture. Physical scale also remains unverified. Use the source window frame/module topology as offline input, then author the larger Life cockpit and material response; keep any glass reflection treatment separate from the changing sky. No sky, constellation behavior, Home content, runtime model, panorama, or manifest changed in this inspection.

The user accepts the NASA modules' realism as a **source-asset baseline** and directs that they remain the ship's foundation. The main agent independently opened all three r3 images and confirmed the window-cover diagnosis and transparent opening topology, while retaining the dark-cabin and polygonal-rim findings. Source-asset acceptance does not count as a complete Life-scene photoreal acceptance round: the consecutive clean-review count is still **0**, and the manifest remains unchanged.

Jobs `164261`, `164271`, and `164545` all finished `COMPLETED 0:0`; the final queue inspection contains none of these jobs. No cancellation was necessary. Unrelated training job `164021` was left running and untouched. No further GPU inspection job is pending.

## Other reliable NASA candidates

- **ISS (D) (IGOAL):** official page <https://science.nasa.gov/3d-resources/international-space-station-iss-d-igoal/> and NASA's `NASA-3D-Resources` repository. It provides an original `GLB` plus a high-resolution multipart archive; the GLB is easier to inspect in Blender, but the page does not identify it as an interior-specific model. Use only after a native visual review.
- **ISS (C) (High Res):** official page <https://science.nasa.gov/3d-resources/international-space-station-iss-c-high-res/>. It is a 35.53 MB ZIP in original LightWave format with many parts, suitable for exterior structural detail; the page gives no interior-view claim, so it is a secondary source for the cockpit task.

Both candidates inherit NASA's 3D media guidance described above. Neither is approved for Life until its actual imported geometry and texture loading are independently reviewed.

## Not a model

NASA's **Discovery Flight Deck Panels** page provides six 2D JPEG/TIFF photographs, not a mesh: <https://science.nasa.gov/3d-resources/discovery-flight-deck-panels/>. It can inform material reference only.
