# Public castle scan candidates

Verified locally on 2026-09-14 and updated on 2026-09-17. These are source-selection records, not photographic acceptance. Consecutive independent passing rounds remain **0**. No source in this document has been installed into the runtime panorama manifest.

The user reviewed the public-source studies on 2026-09-17 and rejected both Kokura and Bodiam as insufficiently realistic. Further Kokura crop/composition work is paused, and Bodiam must not be downloaded as the next replacement. The user also rejected Upnor as too fortress-like for the intended scene. The uploaded Kokura r2 has never been submitted to Slurm and must not be described as a rendered or accepted candidate. The latest priority is a beautiful palace-like silhouette with pointed towers, while preserving photographic close-view quality and coherent whole-building appearance; a Hogwarts-like silhouette is optional and must not displace this quality requirement.

## Downloaded source: Kokura Castle

- Creator: **AVATTA**. The creator states that the reconstruction used more than 1,500 drone photographs from all directions and Agisoft Photoscan.
- Original: <https://sketchfab.com/3d-models/kokura-castle-aba23531911c45439067a6e0aaccad07>.
- Official metadata: <https://api.sketchfab.com/v3/models/aba23531911c45439067a6e0aaccad07>.
- License: **CC BY 4.0**, <https://creativecommons.org/licenses/by/4.0/>. Attribution is required; commercial use and adaptation are allowed.
- Downloaded public mirror, pinned to commit `3868c3ec87d8fcdbe8b77db5093c030073c3ed19`: <https://raw.githubusercontent.com/nataliaradcuk/kokura-castle-3d/3868c3ec87d8fcdbe8b77db5093c030073c3ed19/src/models/kokura_castle.glb>.
- Local source: `.render-work/public-models/castle/kokura_castle/kokura_castle.glb`.
- Size: **88,232,132 bytes**. SHA-256: `0e2c31ce4cf01eed7f4e24fe5adcc1206120b737201d2e7c670dce39de25c05c`.
- The mirror repository has no asset attribution in its template README. Attribution is nevertheless independently verified in the downloaded GLB's `asset.extras`: `AVATTA (https://sketchfab.com/avatta)`, `CC-BY-4.0`, and the exact original model URL above. The official model API independently reports CC BY 4.0. The GLB size and geometry counts also match the official search API's GLB archive record.
- Download succeeded anonymously with PowerShell `Invoke-WebRequest`. One prior `curl.exe` attempt encountered a connection reset before writing a file; no authentication workaround was used.

Suggested attribution: “Kokura Castle by AVATTA, via Sketchfab, licensed under CC BY 4.0.” Include source and license links, and describe any later cropping, cleanup, relighting, or other modifications when publishing.

### Actual GLB inspection

| Property | Verified value |
| --- | --- |
| Format | glTF 2.0 binary; `Sketchfab-13.43.0` generator; no required extensions |
| Geometry | 18 mesh objects/primitives; 1,460,392 triangles; 1,121,679 stored vertices |
| Structure | 20 nodes, one scene; meshes split the scan rather than separating castle, trees, paths, and water by semantic object |
| Camera/lights | No cameras or light extensions embedded |
| Material | One `mat0`, double sided; metallic factor 0; roughness factor omitted, therefore default 1 |
| Base color | Embedded 8,192 × 8,192 JPEG; 16,484,175 bytes |
| ORM/AO | Embedded 8,192 × 8,192 PNG; 18,312,838 bytes; shared AO and metallic-roughness texture; AO strength 0.17 |
| ORM channels | R varies; G and B are uniformly 255. Thus roughness is uniformly 1 and metallic is uniformly 0 after multiplication by the metallic factor. This is not a varied material roughness scan. |
| Other maps | No normal or displacement map |
| Local mesh bounds | `[-0.000005, -83.315636, 0.000007]` to `[147.898712, -0.000001, 146.408783]` |
| Root transform | Approximately `diag(1, -1, -1, 1)`, a 180-degree X rotation |
| glTF scene bounds | Approximately `[0, 0, -146.408783]` to `[147.898712, 83.315636, 0]`, glTF Y-up |
| Expected Blender import | Normal importer converts glTF Y-up to Blender Z-up, giving `(local X, local Z, -local Y)` and bounds approximately `[0, 0, 0]` to `[147.898712, 146.408783, 83.315636]`; no extra study rotation is indicated |
| Physical scale | **Uncalibrated source units**. The source is not verified as 83.3 metres high. Do not enlarge it based on this bound or assume that 1 source unit is 1 metre. |

The Blender axis result is computed from the documented glTF conversion and actual root matrix; the A800 import evidence should confirm it. The stored triangle count was calculated from index accessors, not inferred from the title or thumbnail.

### Completeness and visible limitations

The scan includes the full reconstructed Japanese **tenshu/keep**, its sloping stone foundation, a west-side annex and approach, surrounding paths and tree masses, and partial moat/water surfaces. It is not a clean standalone building or a complete reconstruction of the entire historical fortified city.

### A800 source study (job 162194)

The unscaled source was imported in Blender 4.5.3 and rendered under clear and dusk HDRIs from four sides, elevated, underside, and a near-facade camera. Import produced 18 meshes, 1,121,679 vertices and 1,460,392 triangles, with the expected Blender Z-up bounds. The facade view was black because the generic camera was placed inside the scan's fused tree/ground parcel; this is a source-composition limitation, not a successful close-up. Cardinal views show a recognizable keep with coherent roof and plaster detail, but the fused tree masses dominate foreground and hide lower walls. The scan is therefore a promising castle subject for a reviewed crop and calibrated scale study, not an installable replacement or a photographic pass.

The official 1,920 × 1,080 preview has been inspected and is saved as `source-preview.jpg` next to the source. Its SHA-256 is `4aae7dfa32815e878707efae34ea0bedef887b6dcac9f9ed29d2919d826625c3`. The architecture has coherent real roof, plaster, window, and masonry detail. The surrounding scanned trees are visibly fused, irregular solid masses, with holes and no separately resolved leaves. The park and moat end at a rectangular cut boundary.

`diagnostic-basecolor-preview.jpg` is a resized view of the actual embedded diffuse texture. It contains dark roof/overhang regions, vegetation shadowing, and static water appearance. Therefore it is not verified as de-lit albedo. A dusk light may conflict with those baked conditions. `diagnostic-topdown-vertex-color.png` is a CPU-generated vertex projection used to locate the building, moat, and clipping edges; its point gaps are visualization gaps, not a claim that the source mesh has that many holes. Neither image is an A800 render or acceptance evidence.

The source includes an almost planar bottom closure near Z = 0. Actual usable upper surfaces are substantially above this bottom. Vertical intersections with actual triangles, expressed in raw expected Blender source coordinates:

| XY sample | Upper surface Z | Interpretation from top-view image |
| --- | --- | --- |
| `(40, 70)` | 25.865 | West approach courtyard |
| `(58, 65)` | 25.822 | Courtyard close to keep |
| `(62, 80)` | 27.118 | Entrance-side approach near annex |
| `(45, 45)` | 25.488 | Park/approach |
| `(87, 125)` | 9.047 | Northern moat/water patch |
| `(138, 100)` | 9.039 | Eastern moat/water patch |

Each sample also intersects the artificial bottom near Z = 0.02. `base_at_zero` in a source study places that bottom at zero; it does **not** place the courtyard or water at zero.

### Composition guidance for the existing island and bridge

The existing protected island core has local centre `(-12, -8)`, semiaxes `(66, 72)`, radius gate `0.86`, and elevation `-15`. Its world centre is approximately `(-58.507817, 195.053601, -15)`. The current bridge's castle-side deck starts at local chainage `28.95`, across `7`, with world position approximately `(-15.216515, 189.784285, -11)`.

First render the scan alone from all cardinal sides, an elevated view, and entrance/roof/stone-base close views under clear and dusk lighting. Preserve the original texture in this first source study. Use the lower source coordinate values as diagnostic coordinates, not certified metres. Calibrate scale from a real measured building dimension or a verified door/floor span before the composition study.

For composition, keep the actual tenshu and stone podium as one coherent real building. Rotate the western annex/approach toward the bridge's existing castle-side end; select the actual courtyard connection with a camera and world-space surface ray, since the nearest bounding-box edge includes trees and water. After scale `s` is known, set translation Z using the chosen courtyard surface, for example `-11 - 25.865 * s` for the sampled west approach, rather than aligning the model minimum to the island top.

The scan's courtyard-to-water difference is about `16.8 * s`, whereas the existing deck-to-lake difference is 23 metres. These are two independent heights: connecting the courtyard to the current bridge does not automatically align the scan's water with the existing lake at -34. The source study must expose this mismatch before deciding whether to remove the baked water and fit the actual stone podium into the new photographed cliff assets, or adjust the island/bridge approach as a coherent composition. Keep new cliff geometry outside the preserved castle stonework; do not hide an arbitrary rectangular cut through visible roofs or walls.

Replace or crop out the fused scanned tree masses only after an independently reviewed source render identifies a safe separation. Removing whole numbered mesh objects would remove mixed building geometry as well. A scan is not automatically photo-real in a new composition; courtyard scale, crop boundaries, embedded shadow directions, solid foliage, and clear/dusk compatibility are outstanding review criteria.

### A800 crop and cliff study (job 164268, failed visual review)

Job `164268` completed successfully in 00:03:21 with Slurm exit `0:0`. Its isolated directory is `.render-work/public-castle-20260916-r1/`. The source crop contains 353,492 triangles and 286,766 stored vertices. Its SHA-256 is `e962c6050dd0e35035bab2f7f5a0452ec122e1a82197d01b78c42fb12d43f007`. Original UVs and texture payloads were retained; this is a spatial crop, not a semantic reconstruction of missing architecture.

The actual output consists of 18 isolated-crop images and eight castle/cliff composition images under clear and dusk lighting, plus the camera audit and source hash evidence. Thirteen distinct camera positions passed the geometric proximity check. The entrance close camera at `(44, 72, 32)` was above the measured courtyard at Z = 25.930527 and had a forward surface intersection 22.7348 source units away, avoiding the earlier black-camera failure.

The parent reviewer and source agent both found blocking visual defects: the castle floats over the cliff; a long green closure triangle projects into the rock; parts of the annex wall and roof are missing; vegetation fragments float beside the building. Close views also expose the scan's diffuse blur. The reviewed views failed; no claim is made that every one of the 26 images received an independent inspection. Rendering completion and camera safety do not constitute a photographic pass.

The separate `.render-work/public-castle-20260916-r2/` contains a revised 377,877-triangle crop, SHA-256 `606203ca32793016e65bdad0dc2f15bb8ef1fd60cb4cdf537d1af818aeac8477`, and a two-cliff contact-probing queue. Files were uploaded successfully, but no r2 job was submitted and its contact placement was never verified on the GPU. Work stopped when the user requested a replacement source.

A fresh queue check on 2026-09-17 confirmed that job `164268` was completed and this agent had no active job. The only listed user job was unrelated training `164021`; it was not cancelled.

## Additional verified candidates, not downloaded

The Sketchfab search API provides the archive counts below. The official download API returned HTTP 401 without authentication during a single test. These are licensed, downloadable candidates but **no anonymous binary URL has been verified** for them. No protected data was extracted.

| Candidate | Source and creator | License | Available GLB archive | Status and suitability |
| --- | --- | --- | --- | --- |
| Bodiam Castle, listed as “Boadiam Castle” | [Original](https://sketchfab.com/3d-models/boadiam-castle-d0542d3f53e64565a75ff1c51a8997ff), WDS-LAB / `wlab_studio` | CC BY 4.0 | 356,086,068 bytes; 4,305,375 faces; 2,567,323 vertices; one texture, max 8K | Creator explicitly states photogrammetry. Whole moated medieval castle with towers and enclosed courtyard. Strong European option, but download requires an authorized Sketchfab session/token. |
| Laarne Castle | [Original](https://sketchfab.com/3d-models/laarne-castle-cdaa8e6db45f48ccbc83f2d063d4ea00), LZCreation / `jmch` | CC BY 4.0 | 77,259,192 bytes; 1,660,407 faces; 1,307,173 vertices; one texture, max 8K | Creator tags include photogrammetry; description identifies the full Belgian moated castle. Download authentication unresolved; no binary inspection or visual acceptance performed. |
| Skhvilo Castle | [Original](https://sketchfab.com/3d-models/skhvilo-castle-3ab0d9913fa9472bbf90d29de9887ec3), Nik / `nikska` | CC BY 4.0 | 129,800,136 bytes; 499,999 faces; 388,733 vertices; four textures, max 8K; original source archive 196,998,453 bytes | Creator explicitly describes making the scan. Official 1920-pixel preview inspected: complete long stone frontage, main tower, door and little surrounding vegetation. Promising alternative with less parcel cleanup; four texture records do not prove four color atlases. No binary downloaded or close-view acceptance. |

Metadata query for all three: <https://api.sketchfab.com/v3/search?type=models&q=castle%20photogrammetry&downloadable=true&count=24>. Per-model API endpoints contain the complete license URL; the search results only include a license label/UID.

### Bodiam official preview and next source audit

The 1,920 × 1,080 official preview is saved at `.render-work/public-models/castle/bodiam_castle/source-preview.jpg` and has been visually inspected. It shows a complete quadrangular castle, round corner towers, gate towers, interior ruins, an approach bridge and moat. The exposed stonework and unobstructed walls are a stronger source candidate than Kokura's tree-obscured lower building. However, the preview also shows fused surrounding trees, baked moat appearance, and bright wall regions. It is not evidence that close views or relighting pass.

The parent agent verified the official download dialog in a real browser: it requires a signed-in Sketchfab account. The user subsequently rejected Bodiam, so its download was abandoned. Archive counts remain API metadata and no local geometry, material, scale or ground-height verification is claimed.

Suggested first study: four cardinal sides, elevated and underside views, then entrance-bridge and courtyard-wall close views under clear and dusk light. Close cameras must use actual mesh intersections for bridge/courtyard elevation and forward clearance, not the parcel's minimum Z or an arbitrary inset from its bounding box.

### Additional mirror examined and not adopted

The public `henrikglass/hgl` repository contains `assets/castle.obj` and `assets/castle4k.png`. Its `assets/credits.txt` credits **Castle of Loarre** to **matousekfoto**. The matching original is <https://sketchfab.com/3d-models/castle-of-loarre-2876fc98a198429ca34ea7f0a2dae014>, currently reporting 732,376 faces and a **Free Standard** license. The repository's MIT software license does not establish permission to redistribute this third-party model. No mesh from that mirror was downloaded or approved; the mirror is not treated as a CC BY alternative.

## Later source screening: close-view quality first

No new mesh has passed the source-quality gate or been downloaded in this screening. Official 1920-pixel previews are preserved under `.render-work/public-models/castle/research-previews/<Sketchfab UID>.jpg`. These are original publisher previews, not our A800 renders. Texture counts below are archive metadata; they do not establish the number of diffuse atlases or prove that roughness, normals, displacement or de-lit albedo exist.

### Sources rejected or limited after actual preview inspection

| Source | Observed evidence | Decision |
| --- | --- | --- |
| [Neuschwanstein, Brian Trepanier](https://sketchfab.com/3d-models/neuschwanstein-castle-bavaria-germany-7d6d970009724dbda4fc5c5ffa303577) | Visible triangulation and deformed wall/tower surfaces; extremely coarse fused tree parcel. One max-8K texture covers the large scene. Origin of imagery not established. | Rejected; 1.5M total faces does not resolve visible quality. |
| [Hogwarts 3D, Ju Designer](https://sketchfab.com/3d-models/hogwarts-3d-70dcec840f8444dda2974aa6a9b049e2) | Clearly synthetic repetitive masonry, simple roof surfaces and faceted cliff geometry. Six max-1K textures. | Rejected despite the requested earlier silhouette. |
| [Mont-Saint-Michel, LZCreation](https://sketchfab.com/3d-models/mont-saint-michel-france-ee4eb76e449044d297010c49a178825a) | Author explicitly says “Photogrammetry using Google Earth images.” | Not adopted; uploader's CC label does not establish underlying image reuse permission. |
| [Cour du Château de Chambord, DroneContrast](https://sketchfab.com/3d-models/cour-du-chateau-de-chambord-31bfcbfd527444d99dc759190d7946d0) | Ten max-8K texture records; 551,494,909-byte original archive; CC BY 4.0. Window frames and distant masonry have credible detail, but the parent reviewer found melted foreground balustrades, courtyard remnants and a clipped roof. | Potential local facade reuse only; not a complete accepted castle. |
| [Tamworth Castle, Juan Brualla](https://sketchfab.com/3d-models/tamworth-castle-uk-8f29ebb9582b4481a82a35f02d04f9fc) | Soft facade detail, damaged adjoining buildings and fragmented tree shapes visible in the official preview. | Not promoted as a photographic replacement. |
| [Lanhoso Castle](https://sketchfab.com/3d-models/lanhoso-castle-015bbe27e1d04f0ca824f5a179b0f927) | Large fused tree parcel, blurred foreground roads and cars; the main castle is a small part of the texture coverage. | Not promoted despite nine max-8K texture records. |

### Palace-style and professional scans awaiting close-view inspection

### Palace-style lead: Hohenzollern Castle

The strongest visual lead from the 2026-09-18 palace screening is [Hohenzollern Castle by LZCreation](https://sketchfab.com/3d-models/hohenzollern-castle-e846059e2d624910b4913d73899e4e3d), UID `e846059e2d624910b4913d73899e4e3d`. Its official 1,920 × 1,080 preview shows a coherent neo-Gothic hilltop complex with multiple steep slate roofs, slender towers, masonry courses, arched windows and a recognizable central facade. This is materially closer to the requested elegant castle silhouette than Kokura, Bodiam or Upnor.

- Official API reports **461,176 faces**, **230,461 vertices**, one material and one texture record; the model is downloadable, unprotected and licensed **CC BY 4.0**. The creator is `jmch` / LZCreation.
- The preview has a clean close facade but also shows a fused, highly saturated vegetation/ground parcel. The one texture record may contain baked capture lighting; it is not evidence of relightable PBR maps or a de-lit albedo.
- The user completed the official signed-in Sketchfab download. The isolated archive is `.render-work/public-models/castle/hohenzollern_castle/hohenzollern-castle.zip` (122,218,904 bytes, SHA-256 `9a61ad10605486c0758929e8924d6048610621b97c04564e0262e215b957fde9`). The extracted source is `HZ3.obj` (461,176 triangles, 230,466 vertices, SHA-256 `e9c9a60fbfbe53af1eb0cd4ad8accb0186ff5f30aa89b29c32e3b33802e1ccd7`) with one 16,384 × 16,384 JPEG diffuse texture (SHA-256 `c4f0d5b4fca61e2e71ad8956295d8df17e9363d93b9d68524cc85f69004b5603`). The package remains isolated and is not installed.
- The institutional **Burg Hohenzollern** scan by Landesamt für Denkmalpflege (UID `a88eda1be5cc4e58a4268fce708b1a72`) is a second, CC BY-NC 4.0 alternative with 750,000 faces and three-quarter aerial coverage, but its preview is softer and its noncommercial restriction must be checked against deployment.

The authorized download still does not authorize installation. The source audit must remain separate from the runtime manifest and include six directions, near facades, clear and dusk renders before any composition work.

### Hohenzollern A800 source studies (2026-09-19)

- Job `166002` (`r1`) completed with the default OBJ axis and failed immediately on visual inspection: the castle was rotated sideways and a dark sealed scan face dominated the lower parcel.
- Job `166009` (`r2`) used `forward_axis="Y"`, `up_axis="Z"` and restored the castle upright. Near facade images show coherent pointed roofs and masonry, but wide views expose a dark/deep-green fused parcel and a rectangular scan boundary. It remains a failed source study.
- Job `166051` (`r3`) clipped the lowest source geometry below placed Z = 10.0. This removed 8,222 triangles and reduced the lowest bound to Z = 10, but the wide views still show dark fused sides; the close facades remain source-quality references only.
- Job `166086` (`r4`) tested low-shell deletion with an outer ellipse and downward-normal filter. It exposed open triangular holes and spikes, so this method is rejected and is not an installation candidate.
- Job `166094` (`r5`) tested an open-sided ring skirt using Poly Haven `mountainside` diffuse/normal maps. It replaced part of the lower silhouette but left black scan gaps and a visibly fused foreground, so it failed visual review.
- Job `166101` (`r6`) raised the skirt to Z = 18 and clipped source geometry below that height. The six-direction and four-facade views still show open gaps, hard skirt boundaries and melted vegetation; it also failed. No version has passed a photographic round, and the manifest remains unchanged.

### Other palace-shaped leads screened on 2026-09-18

These previews are useful for comparison only. None has been downloaded or approved, and archive face counts do not establish photographic quality.

| Candidate | Official archive metadata | Visual decision |
| --- | --- | --- |
| [Château de la Bretesche](https://sketchfab.com/3d-models/chateau-de-la-bretesche-rawscan-2eeeba7fa4824666b485bbc8e919da1c) | 1,262,171 faces; 1 texture; downloadable; CC BY-NC 4.0; described as photogrammetry from video | Attractive moat-and-tower silhouette, but the preview has saturated green scan ground and soft vegetation. Keep as fallback, not the first download. |
| [Pena's Palace #2](https://sketchfab.com/3d-models/penas-palace-2-7d6d8ac33a064db4b7a02731957e6f10) | 1,627,878 faces; 1 texture; downloadable; CC BY 4.0 | Only an entrance fragment is represented, so it cannot supply a complete castle scene. |
| [Moszna Castle](https://sketchfab.com/3d-models/moszna-castle-example-of-eclectic-architecture-8a096081702e405d8fec5b2bf7ec7018) | 1,030,000 faces; no texture record; downloadable; CC BY 4.0 | Beautiful roof/tower profile, but the preview shows soft aerial surfaces and no verified texture payload. |
| [Grafenegg Castle](https://sketchfab.com/3d-models/grafenegg-castle-schloss-grafenegg-c033a6ee2f8c4028bd2fd25f04ab5e9e) | 1,019,445 faces; 1 texture; downloadable; CC BY 4.0 | Complete palace composition, but strong aerial blur and a large fused grounds parcel are visible. |
| [Castle of Dona Chica](https://sketchfab.com/3d-models/castle-of-dona-chica-c80186a4e79045e383a6cfabca078ac8) | 4,463,815 faces; 1 texture; downloadable; CC BY 4.0 | Distinctive neo-romantic architecture, but the preview is a partial building with fused trees and ground; source close views are unverified. |
| [Bojnice Castle](https://sketchfab.com/3d-models/bojnice-bojnicky-hrad-f0107519360e4ae5a4d5ad4da2b57c31) | 4,076,193 faces; 1 texture; downloadable; CC BY-NC-SA 4.0 | Very attractive romantic castle silhouette and substantial scan, but the noncommercial-sharealike license and aerial-only preview require an explicit deployment check. |

On the current evidence, Hohenzollern is the best balance of elegant tower silhouette, visible facade detail, commercial-compatible CC BY terms and complete-looking architecture. Bojnice is the most visually promising fallback if the project can satisfy its NC-SA terms; Bretesche is the next fallback if a less Gothic palace is preferred.

The previously investigated [Upnor Castle by artfletch](https://sketchfab.com/3d-models/upnor-castle-a08280d12911401aa6022c1a58f2b49a) remains useful only as a real-scan reference. Although its 5,647 Sony a7R III and 120 DJI Mavic 2 photographs produce coherent masonry, the user rejected its compact military-fortress character. It must not be used as the final castle route.

These are stronger capture-provenance leads, not accepted assets. All three are published by **Global Digital Heritage** under **CC BY-NC 4.0**, which restricts reuse to noncommercial purposes. No assumption is made that the current site or any later deployment satisfies that restriction.

| Source | Publisher's capture method and available archive | Current visual limits |
| --- | --- | --- |
| [Castle of La Riba de Santiuste](https://sketchfab.com/3d-models/castle-of-la-riba-de-santiuste-siguenza-spain-db2eab0514ac4e42ae76554fa4be38b0) | RealityScan from **138 laser scans and 6,300 images**, with Geomagic Wrap/ZBrush processing. Ten max-8K texture records; original archive **453,249,885 bytes**. | Original preview shows coherent complete walls, towers and actual rocky foundation; thin cut parcel edge remains. Ground-level masonry and relighting have not been inspected. |
| [Castle of Consuegra](https://sketchfab.com/3d-models/castle-of-consuegra-toledo-spain-dd6b50b630904b569bace37e2bfaa559) | RealityCapture from **192 laser scans and 16,071 images**, independently repeated on the [publisher's project page](https://gdh.org/model/castle-of-consuegra-toledo-spain/). Six max-8K texture records; original archive **519,252,665 bytes**. | Original preview shows complete keep, circular towers and multiple perimeter walls. Lower roads, cars and terrain have scan artifacts; fine stone detail cannot yet be judged at ground-level viewing distance. |
| [Castle of Los Vélez](https://sketchfab.com/3d-models/the-castle-of-los-velez-mula-murcia-977ca26a58194e81af7139529002776d) | RealityCapture from **1,653 DJI Phantom 4 Pro images**. Seven max-8K texture records; original archive **362,346,318 bytes**. | Original facade preview resolves masonry and coats of arms, but bright rock/wall regions and roof-edge defects are visible. Not accepted on this evidence. |

The subagent's browser attempts returned “No browser is available” and “Browser is not available: iab”. It did not extract a restricted viewer or use another UI implementation. Interactive close views of the two first candidates were requested from the parent agent, whose browser had previously worked. No downloading is justified solely by the capture counts.

### Institutional repositories: availability verified

- Historic Environment Scotland publishes [Edinburgh Castle](https://sketchfab.com/3d-models/edinburgh-castle-b494fdf5e2754259bc90c536b18fcfff) with 118 max-4K texture records, and [Caerlaverock Castle](https://sketchfab.com/3d-models/caerlaverock-castle-4a21aeea4daf4317aeb13a2fff7dad7f) with 20 max-8K records. Both official APIs report `isDownloadable: false` and no license. They are not openly downloadable candidates; no viewer extraction was attempted. `3d.scot` also failed DNS/TLS access in this environment.
- DroneContrast has a separate [whole Château de Chambord](https://sketchfab.com/3d-models/chateau-de-chambord-chambord-castle-4a7dd40a82e545689d07c98436de7939), ten max-8K records, but it reports `isDownloadable: false` and no license. The open courtyard model does not grant rights to this whole-building model.
- [Open Heritage 3D, Montcortes](https://www.openheritage3d.org/project.php?id=xhj8-8x48) lists **14.32 GB terrestrial photos and 3.76 GB aerial photos**, with emailed access links; it does not list a ready textured mesh. Its visible license label says CC BY-NC-SA while its license hyperlink points to CC BY 4.0, an unresolved metadata conflict. No form was submitted or data downloaded.
- [Borgo Medievale di Torino](https://www.openheritage3d.org/project.php?id=hrdy-b471) lists all three acquisition datasets as **Not available**. [Marble House](https://www.openheritage3d.org/project.php?id=mhb0-3218) and [Houghton Hall](https://www.openheritage3d.org/project.php?id=sjyw-3r43) list 15.282 GB and 11.502 GB of terrestrial LiDAR respectively. [Al Azem Palace](https://www.openheritage3d.org/project.php?id=ws0a-3g91) lists 59.07 GB LiDAR plus 11.91 GB photographs. These are reconstruction inputs, not verified ready-to-render high-quality castle meshes.

### Hohenzollern provenance and anonymous-download audit (2026-09-18)

The institutional alternative is [Burg Hohenzollern by Landesamt für Denkmalpflege Baden-Württemberg (LAD BW)](https://sketchfab.com/3d-models/burg-hohenzollern-a88eda1be5cc4e58a4268fce708b1a72), UID `a88eda1be5cc4e58a4268fce708b1a72`. Its [official API record](https://api.sketchfab.com/v3/models/a88eda1be5cc4e58a4268fce708b1a72) reports `downloadable=true`, `protected=false`, **750,000 faces**, **375,899 vertices**, one material and one texture. The license is **CC BY-NC 4.0**; commercial use is excluded. The description credits Christoph Steffen photographs and “2018 (c) Landesamt für Denkmalpflege im Regierungspräsidium Stuttgart.” It links an [official Google My Maps index](https://drive.google.com/open?id=1Y3h9JGowHjneXdkfL_1TYbdxgPdlmB-z&usp=sharing); the Hohenzollern map entry labels the object `3D-Modell/3D-Model` and links `https://skfb.ly/6zCBT`. The map's description says these are overview models made during archaeological aerial flights. The map and Sketchfab metadata are useful institutional provenance, but neither exposes an anonymous mesh archive.

The LZCreation model remains the stronger visual lead: its [official API record](https://api.sketchfab.com/v3/models/e846059e2d624910b4913d73899e4e3d) reports **461,176 faces**, **230,461 vertices**, one material and one texture, `downloadable=true`, `protected=false`, and **CC BY 4.0**. The creator profile identifies `jmch` / LZCreation, lists photogrammetry as a skill, and links [lzcreation.com](http://www.lzcreation.com/); no author-hosted Hohenzollern package was found there. A direct unauthenticated request to each model's official `/download` endpoint returned HTTP 401. The institutional short link returned a CloudFront WAF challenge. No binary, viewer geometry, texture payload, hash, or GPU render was obtained in this audit. The small Emily Loader model (UID `5699f06be8f24eb5b07ee0b238e5f87b`) is CC BY and downloadable but only **17,862 faces / 18,409 vertices** and explicitly described as a simplistic Maya model; it is not a high-detail candidate.
