# Footprints relief atlas

Three continuous, north-up orthographic relief maps power the Life footprints panel. Visited Chinese prefecture-level cities and narrow terrain corridors along journeys receive colour; a corridor does not mark its intermediate cities as visited. Administrative boundaries and names are hidden until a visited city is hovered or focused.

- China reuses the approved China DEM and Albers projection. Provincial colour groups come from the in-repository `tools/relief-atlas/reference/render_atlas.py` and its region-name table. `tools/relief-atlas/footprints-style.json` supplies Blender's mineral pigment palette, pure-white unvisited material and blue-grey sea material.
- East Asia spans 103–147° E, 18–47° N, including eastern China, Taiwan, Korea and Japan. Chinese visits and route segments use the same data as the China map.
- Europe and the USA occupy one uninterrupted Atlantic extent: 128° W–40° E, 24–66° N. The mainland USA, southern Canada and most of Europe retain their geographic relationship. There are no inset panels. US states and larger European regions are selectable units for future visits; Switzerland and other smaller countries remain single units. All are currently unvisited.
- Unvisited terrain uses an explicit `#ffffff` Principled matte material with zero emission. Cycles renders it with real elevation and the reference lighting: 32° sun elevation, 321.842773° azimuth, 3° angular diameter, 0.45 skylight, exposure −0.4. Ocean colour also comes from its Blender material. Packaging only encodes the original PNGs as WebP: no brightness curve, shadow lifting, compositing or sea recolouring. White material still produces darker pixels on shaded slopes and in cast shadows. Saved scenes are reopened to verify white Base Color, zero emission, matte roughness, province pigments and lighting. Earlier PNGs, Blender scenes and archive checksums retain their original bytes.
- The colour raster is clipped by the union of visited cities and buffered network corridors, preserving the actual terrain shading along roads and railways. Display corridors are 30 km wide for rail and 26 km for roads, exaggerated for regional readability and clipped to land. No flat route strokes are drawn. The white raster, colour raster and SVG share the same projected extent and camera. There are no permanent administrative strokes.
- China and East Asia are natively rendered at 6000 pixels wide; Europe/USA at 8000 pixels, with 192 Cycles samples. Published WebP uses quality 95. Rendering resolution is independent of the original DEM grid resolution; these are regional relief maps. Inline and modal views cap zoom at 300% for China and 200% for East Asia and Europe/USA, relative to the fitted view. Buttons, pointer-anchored wheel zoom, touch pinch, double-click, keyboard navigation and viewport resizing all respect the same cap. The percentage shortcut opens the maximum zoom; Escape closes the large map. Zoom changes the stage's layout dimensions so the browser rerasterizes relief and clipping at the displayed size instead of magnifying a cached small compositing layer.

## Routes and provenance

`../footprint-journeys.json` stores six railway journeys and six driving journeys. Road geometry comes from OSRM's full OpenStreetMap driving network. Railway geometry comes from BRouter with a strict `railway=rail` profile; each returned edge is checked to reject roads, metro and tram segments. Long mapped tunnel segments are retained without inventing intermediate points. Routes are split at province polygon intersections for provenance; visible colour comes directly from that province's rendered terrain pigment.

The exact historical itinerary and train services are inferred from the user's remembered places. These are network-based reconstructions, not measured GPS recordings. Via points are railway stations or city locations used to obtain network geometry; they are never connected directly as a fallback. Source requests, retrieval dates, routing profiles and per-route qualifications are preserved in the journey data. Live routing services are not used by the page.

Sources:

- [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), including its upstream elevation sources and attribution.
- [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), public-domain 1:10m coastlines and administrative units.
- Existing DataV China provincial and city polygons in `assets/maps`; their longitude/latitude treatment matches the original atlas. Small datum and coastline differences remain at local zoom levels.
- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0 road and rail geometry, obtained using [OSRM](https://project-osrm.org/) and [BRouter](https://brouter.de/). Route geometries remain subject to ODbL. Visible credits are included below each map.

## Rebuild

The complete source archive and portable rebuild instructions are in [`../../../tools/relief-atlas/README.md`](../../../tools/relief-atlas/README.md). The four reference scenes, prepared DEMs, labels, renders and production scripts are included in `reference/`. The website maps' five production Blender files (white/colour China, white/colour East Asia, white Europe/USA), three prepared DEMs and original high-resolution PNGs are in `footprints/`, with reopening checks and SHA-256 records. `full-archive/` additionally preserves every file from the original local and remote map project directories, including old ZIPs, downloaded tiles, caches, bytecode, logs, intermediate images and review captures. Per-file manifests and a restore command reconstruct the original bytes; large files are split into 48 MiB parts. No sibling checkout is needed. Future downloads and temporary rebuild files use ignored `.render-work/footprints/`.

```powershell
python scripts/prepare-footprint-routes.py
python scripts/build-footprint-atlas.py --prepare
```

Copy the prepared `data/`, repository scripts and style file to a new cluster work directory, set `BLENDER_BIN`, `ATLAS_WORK`, `REFERENCE_ROOT` and `STYLE_FILE`, then submit `scripts/render-footprint-atlas.slurm` on a CUDA GPU. Archive its scenes, original PNGs, inputs and logs in a new production directory; point `render_archive` in the style file at that directory. The job uses Blender 4.5.3 and never runs a render on the login node. It does not overwrite the reference scenes or earlier production archives.

```powershell
python scripts/build-footprint-atlas.py --package
python scripts/validate-footprint-atlas.py
python site_renderer.py --check --life-only
node scripts/validate-life-runtime.cjs
node scripts/validate-life-http.cjs http://127.0.0.1:8765/life.html
```

To add Chinese visits, edit `life.footprints.visited_china` in `site_content.json`, then package using the existing aligned rasters. Packaging reads the latest visited list even when using archived render metadata. Re-render only when terrain, projection, camera, lighting or materials change. The default overviews already have native colour rasters: Chinese provinces reuse the original provincial raster, East Asia groups Japanese prefectures into eight cultural regions and South Korean units into six, and Europe/USA uses one stable pigment per country/territory. Add actual overseas visits through `visited_overseas_regions` (Japan/Korea group IDs) or `visited_country_codes` (Natural Earth country codes); the lists are currently empty. The original detailed view stays available independently on every map. Overseas city/route detail would still need its own new data and render pipeline. See the step-by-step Chinese guide in [`../../../tools/relief-atlas/ADDING-FOOTPRINTS.md`](../../../tools/relief-atlas/ADDING-FOOTPRINTS.md) for city names, road/railway inputs, station coordinates, caching and publishing.

The additional overview archive is `tools/relief-atlas/footprints/administrative-20261016/`. It contains `scenes/east_asia-colour.blend` and `scenes/europe_usa-colour.blend`, their original PNGs, aligned DEM/material inputs, scene verification records and compressed original Natural Earth geometry. `scripts/build-footprint-overviews.py --prepare` prepares a new render archive; `--package` attaches `maps.*.overview` without changing detailed `regions` or `routes`. Ordinary `build-footprint-atlas.py --package` also refreshes overview visits automatically. `scripts/validate-footprint-overviews.py` verifies both sets of inputs and published layers. Cultural grouping is maintained in `tools/relief-atlas/cultural-regions.json`.

To package the current native renders without Blender or downloads:

```powershell
python scripts/build-footprint-atlas.py --package
```

The style file's `render_archive` selects the current original PNGs and DEM metadata. `--render-root` can select another in-repository render directory. Packaging writes only website WebPs and atlas metadata. `validate-footprint-atlas.py` checks pixel fidelity to native PNGs, unchanged shadow contrast, material verification reports, matching sea colours, route alignment and archive hashes. `node scripts/validate-star-map.cjs --serve footprints` exercises map controls on desktop and mobile.
