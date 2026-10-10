# Footprints relief atlas

Three continuous, north-up orthographic relief maps power the Life footprints panel. Visited Chinese prefecture-level cities and narrow terrain corridors along journeys receive colour; a corridor does not mark its intermediate cities as visited. Administrative boundaries and names are hidden until a visited city is hovered or focused.

- China reuses the approved China DEM and Albers projection. Provincial colour groups come from the in-repository `tools/relief-atlas/reference/render_atlas.py` and its region-name table. `tools/relief-atlas/footprints-style.json` supplies the website's mineral pigment palette and warm paper / blue sea backgrounds.
- East Asia spans 103–147° E, 18–47° N, including eastern China, Taiwan, Korea and Japan. Chinese visits and route segments use the same data as the China map.
- Europe and the USA occupy one uninterrupted Atlantic extent: 128° W–40° E, 24–66° N. The mainland USA, southern Canada and most of Europe retain their geographic relationship. There are no inset panels. US states and larger European regions are selectable units for future visits; Switzerland and other smaller countries remain single units. All are currently unvisited.
- Unvisited terrain uses a `#ffffff` matte material. Cycles renders it with real elevation and the reference lighting: 32° sun elevation, 321.842773° azimuth, 3° angular diameter, 0.45 skylight, exposure −0.4. White terrain keeps its own shadows; it is not a grayscale conversion of province pigments.
- The colour raster is clipped by the union of visited cities and buffered network corridors, preserving the actual terrain shading along roads and railways. Display corridors are 30 km wide for rail and 26 km for roads, exaggerated for regional readability and clipped to land. No flat route strokes are drawn. The white raster, colour raster and SVG share the same projected extent and camera. There are no permanent administrative strokes.
- China and East Asia are natively rendered at 6000 pixels wide; Europe/USA at 8000 pixels, with 192 Cycles samples. Published WebP uses quality 95. Rendering resolution is independent of the original DEM grid resolution; these are regional relief maps. A modal large-map viewer supports 8× zoom (extended when needed for native pixels), pointer-anchored wheel zoom, touch pinch, dragging, original-resolution view, keyboard navigation and Escape to close. Zoom changes the stage's layout dimensions so the browser rerasterizes relief and clipping at the displayed size instead of magnifying a cached small compositing layer.

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

Copy the prepared `data/` directory and repository scripts to the cluster, set `BLENDER_BIN` and optional `ATLAS_WORK`, then submit `scripts/render-footprint-atlas.slurm` on a CUDA GPU. Copy its `renders/` back to `.render-work/footprints/renders/`. The job uses Blender 4.5.3 and never runs a render on the login node. It does not overwrite the four reference scenes.

```powershell
python scripts/build-footprint-atlas.py --package
python scripts/validate-footprint-atlas.py
python site_renderer.py --check --life-only
node scripts/validate-life-runtime.cjs
node scripts/validate-life-http.cjs http://127.0.0.1:8765/life.html
```

To add Chinese visits, edit `life.footprints.visited_china` in `site_content.json`, prepare the atlas metadata again, then package using the existing aligned rasters. The region colours and browser clipping update without a new terrain render. Re-render only when terrain, projection, camera, lighting or material changes. Future overseas visits also require a colour raster for the chosen regional units.
