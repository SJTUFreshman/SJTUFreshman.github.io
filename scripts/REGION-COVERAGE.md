# All-region atlas coverage

`build-region-coverage.py` adds entry points for **every displayed region**, including unvisited regions, in the China, East Asia and Europe/USA maps. Visit flags are copied unchanged from `assets/maps/relief/atlas.json`. Singapore's five district outlines and Hawaii's outline come from the already archived inset source files.

Run after the original regional terrain/content builders:

```sh
python scripts/build-region-coverage.py --content
python scripts/validate-region-coverage.py
```

For subsequent geometry/index refreshes, `--skip-images` reuses the existing coverage plates. Existing sourced content is retained unless `--content` is supplied. A first run fetches missing content automatically. Missing translations and encyclopedia disambiguation entries stop publication and require a sourced entry in `region-coverage-editorial.json`.

The original independent China/cultural bakes remain unchanged. New administrative detail entry points reuse their existing whole-area plates and content, and expose their two-view administrative guide. Previously unbaked foreign plates use a transparent geographic mask and an exact crop of the original real-DEM relief. The affine crop preserves the original projection and publishes its new `extent_m`; it does not invent elevations, shift boundaries or claim a fresh independent lighting bake. `terrain_provenance` records that distinction. The material remains neutral warm plaster.

Foreign descriptions use the relevant regional encyclopedia article, with explicit disambiguation for names such as Georgia, Washington, Kanto and the UK's similarly named regions. Historical Scottish statistical regions have separate, sourced editorial descriptions; they are not described as unique cultural boundaries. Photographs retain Commons attribution and verified licences. Regions without a suitable licensed ground scene use a **dated Landsat 2000 reference**, explicitly described as archival satellite imagery.

`package-footprint-sectional.py` now retains every detail hit region. `footprint_web_geometry.py` creates the small-map hit layer and inset hit regions independently of visit status. Rebuild the runtime from the source atlas with the existing `write_runtime(atlas, destination)` publication function, then validate:

```sh
python scripts/validate-footprint-web-payloads.py
node scripts/validate-footprint-region-access.cjs
```

The small-map geometry remains a separate lazy-loaded file (under 165 KB compressed per map); expanded-map geometry remains under 1.1 MB compressed. The full precision editorial source is not a browser startup dependency. Rebuild settlement overlays and the Life font subset after adding new regions or translated descriptions.
