# World asset additions

The optional material library is sourced from [Poly Haven](https://polyhaven.com/), whose assets are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); see the [provider's license policy](https://polyhaven.com/license). Entries were retrieved or revalidated on 2026-09-09 and 2026-09-10. `scripts/fetch-world-assets.cjs` downloads the selected JPG channels, checks their byte sizes and MD5 values against the Poly Haven API, and records local SHA-256 hashes in `assets/life/textures/library/manifest.json`. That manifest is the authoritative per-file source, resolution, retrieval date, URL, checksum, and payload record. Poly Haven does not expose immutable semantic asset versions; the exact download URL and hashes identify the acquired revision.

Selected materials:

- `snow_01` — snow roughness and subdued normal detail. Its photographed footprints make the diffuse map unsuitable for broad repeating summit coverage; rendered review identified and removed that use.
- `rock_face_01` — fractured exposed rock for mountain cuts and summit outcrops. These are the source model's UV textures, not a guaranteed tileable rock material; use them with compatible UVs or bake a new surface rather than tiling the source atlas.
- `rock_face_03` — scanned rough rock-face PBR material for exposed cliff strata and foreground rock. Its [provider metadata](https://api.polyhaven.com/info/rock_face_03) identifies a texture asset (`type: 1`, Rough Rock Faces), and its source maps are published under `Textures/`, unlike the model atlas above. The [asset page](https://polyhaven.com/a/rock_face_03) marks it `tileable` and `seamless`. Photography by Dario Barresi; processing by Rico Cilliers. Use repeat mapping with physical-scale variation to avoid obvious repetition.
- `painted_metal_shutter` — weathered painted metal for the shelter exterior.
- `old_stone_wall` — aged masonry for the Hogwarts overlook ensemble.
- `asphalt_03` — photographed worn asphalt for the open-air city ground. Photography by Charlotte Baglioni; processing by Dario Barresi. Its 2.4 m artistic repeat is a production mapping choice, not a verified source measurement. Diffuse, OpenGL normal and roughness channels retain exact download hashes.
- `leafy_grass` — photographed trampled grass for the Highland meadow base, by Charlotte Baglioni. The 1.75 m repeat is art-directed, not a measured capture scale. Mud remains limited to paths; the grass diffuse, OpenGL normal and roughness maps replace the former green-tinted mud outside the paths.

The library is intentionally kept separate from the existing runtime texture set and is not automatically loaded by the website. Merely downloading these maps does not integrate them into a scene or establish photo-real quality. Offline Blender renders may use 4K by setting `WORLD_ASSET_RESOLUTION=4k`; browser assets should remain at 2K or lower after an explicit performance review. Keep color maps in sRGB and normal/roughness data linear. Local `_nor_` files contain the original OpenGL (`nor_gl`) normal maps.

## Public high-detail model packages

The optional offline model packages are also from Poly Haven and remain CC0 1.0. `scripts/fetch-world-models.cjs` retrieves the official glTF descriptor, binary buffer and all files listed in the Files API's glTF `include` map. Every byte is checked against the provider's advertised size and MD5 before it is written; a SHA-256 is recorded for reproducibility in `assets/life/models/manifest.json`. The downloader rejects unsafe relative include paths and never removes an existing model package.

The current 4K packages are:

- `large_castle_door` — a physically scanned masonry and timber doorway for the castle approach or gate close-up.
- `modular_fort_01` — a complete modular stone fort asset with wall, trim and plaster geometry plus displacement/AO/PBR maps; suitable for assembling a convincing castle or ruined-fort ensemble. It is not a Hogwarts replica.
- `mountainside` — a detailed rocky mountainside assembly and PBR maps for snow-scene outcrops and transition areas.
- `rock_07` — a high-detail boulder with displacement-ready maps for foreground summit breakup.

These are source assets for offline Blender composition, not browser downloads. They must be placed and lit with surrounding authored geometry; repeating a single asset or using it as an entire landscape will not meet the photographic review gate. No game-extracted Hogwarts, Starfield or NASA vehicle mesh is included.

Download or revalidate the default packages with:

```powershell
node scripts/fetch-world-models.cjs
```

Use `WORLD_MODEL_RESOLUTION=8k` only when the render node has enough storage and memory. `node scripts/fetch-world-models.cjs mountainside --dry-run` checks the remote package metadata without writing files. The exact URLs, retrieval date and local hashes are recorded in `assets/life/models/manifest.json`.

Download or refresh the materials with:

```powershell
node scripts/fetch-world-assets.cjs
```

To update only one entry, pass its asset ID, for example `node scripts/fetch-world-assets.cjs snow_01`. Existing manifest entries for other assets or resolutions are retained. All three channels (diffuse, OpenGL normal, roughness) are mandatory; the command fails instead of writing an incomplete asset record. It never removes library files. Fully downloaded bytes are verified before replacing a file, and the manifest is updated only after the entire requested set succeeds.

## Offline sky sources

`scripts/fetch-sky-assets.cjs` fetches CC0 high-dynamic-range pure skies into the ignored `.render-work/hdri/` directory. The website does not fetch these large HDR sources. Each `manifest-<resolution>.json` records the verified URL, byte size, MD5, SHA-256 and retrieval time. These hashes identify source revisions; the source provider does not publish semantic versions.

- [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) provides the daytime lighting reference.
- [Kloppenheim 06 (Pure Sky)](https://polyhaven.com/a/kloppenheim_06_puresky) provides warm low-sun lighting. The original capture is a sunrise; its use for a fictional evening scene does not change that provenance.

Set `SKY_RESOLUTION=8k` for the current review sources. Use the same HDRI, rotation, exposure and color transform for scene lighting and the separately exported sky. Do not duplicate its sun with an additional directional lamp. The original mirrored lower hemisphere is a lighting convenience, not a landscape; it must remain covered by geometry.

## Original high-detail geometry

`scripts/refine-cockpit.py` creates original curved pressure shells and ribs, embedded equipment, shaped seating, manufactured instrument housings, seals, optical covers, mounting pedestals, controller boots and routed service assemblies. `scripts/refine-landscapes.py` creates original architectural stonework, slate courses, textile folds and continuous near-ground snow relief. `scripts/refine-highlands.py` adds an authored glacial-valley composition, blade geometry and path gravel. These offline Blender meshes are separate from browser exploration proxies. No game-extracted meshes, textures, logos or instrument interfaces are used.

`scripts/refine-terrain.py` can replace the snow scene's distant terrain with a verified public-domain-derived Mapzen/USGS elevation tile. Its attribution, exact hashes, artistic modifications and 1:1 scale are documented separately in `docs/terrain-source.md`; do not relabel that data CC0.

The additional geometry is subject to visual review. Polygon counts, successful renders and integrity checks do not establish photorealistic quality.

The cockpit also uses the existing CC0 `fabric_pattern_07` source for flight-seat upholstery, restraint webbing and removable acoustic liners. The shelter uses the existing `wood_floor`, `brushed_concrete` and `fabric_pattern_07` maps for timber, plaster and cloth at physical UV scales. Its radio, window motor housing, guides, chain, water-container fittings and furniture hardware are original geometry, not downloaded product models. These maps are baked into fixed-view outputs; adding them to the offline model does not make the browser load their source textures.

The revised city scene is a street-level, open-air settlement, not an enclosed refuge. `scripts/refine-wasteland.py` reuses original household assemblies from `scripts/refine-shelter.py` and builds hollow surrounding ruins, load-bearing floorplates, recessed window openings, canvas canopies and festoon lighting. The drawn wash basin, hollow copper kettle and pans, storage crockery and draped kitchen cloth are original geometry. Their source materials retain the CC0 provenance above.

`scripts/refine-castle.py` replaces the earlier toy-like tower cluster with an original asymmetric Gothic great hall, tower, clock tower, cloisters and bridge gate. This is Hogwarts-inspired architectural art direction, not a verified replica or game-extracted asset. Camera, bridge and island ground geometry remain separate. The script verifies exact replacement signatures, recessed window depth and actual foundation contact before rendering.
