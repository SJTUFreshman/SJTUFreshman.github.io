# Regional plaster relief plates

`manifest.json` resolves `map:view:region-id` to one small JSON document and one
transparent WebP. The files are loaded only when a region is opened. The registry
covers China's 47 editorial cultural groups, 34 province-level entries and all
38 currently visited prefecture-level cities; East Asia aliases share the same
full geographic regions rather than its clipped overview geometry. Visit flags
always come from the source atlas, never from the enlarged cultural extent.

## Rebuild

Run `python scripts/build-region-terrain.py` with numpy, Pillow, scipy, shapely,
rasterio, pyproj, geopandas and requests available. `--skip-existing` resumes a
partially completed build; `--only CHN:wuyue,310000` rebuilds selected IDs.
`--refresh-content` recomputes geographic photo anchors and international borders
without rerendering the images. Run it after updating `places.json`.

To add a visited city, first update `site_content.json` and rebuild the parent
footprint atlas using its documented packaging command. Then rerun this builder
without `--skip-existing` so visits and membership are refreshed, regenerate
the content/photo inventory, and run `--refresh-content`. Do not set visits in
the display scripts or infer them from the presence of a landscape plate.

Images are newly shaded for each isolated region, not cropped from the large
atlas. AWS Terrain Tiles provide actual elevations, at zoom 6–12 selected for
the region's extent. Each plate recomputes surface normals and northwest horizon
occlusion after masking out other regions (42° light elevation, 315° azimuth,
2.8× vertical exaggeration). Every region and offshore inset now uses the same
matte warm-plaster pigment, **#eeeae0**. Only DEM-derived surface lighting and
terrain occlusion modulate that pigment. The brightest slope retains the base
pigment instead of clipping to white. NASA and Sentinel surface imagery is not
loaded or sampled; this is a fresh constant-material terrain render, not a
desaturated satellite image. These are rendered relief plates rather than a
navigable WebGL terrain mesh.

Elevation tile and intermediate caches remain under ignored
`.render-work/region-sources/`; browsers never fetch these large source files.
The generated image has no EXIF, XMP or embedded project data.
Historical NASA/Sentinel source archives and their licenses remain available
for reproducibility of the previous colour treatment, but the current generator
does not use them. `manifest.json` and the current provenance record list only
the active material and geographic/elevation sources.

## Geography

Chinese administrative geometry and the 47 editorial cultural groups reuse the
existing atlas's archived inputs. These cultural groups are an editorial travel
guide, not precise linguistic or ethnic boundaries.

- Mongolia joins the selected Chinese cultural members, Mongolia, and Tuva.
- Tibet joins the selected Chinese cultural members, Nepal, Bhutan, Ladakh,
  Sikkim, and the Lahaul and Spiti valleys. This requested itinerary grouping
  does not imply a single culture throughout these internally diverse places.
  The historical Ladakh component is deliberately broader than the modern
  Ladakh administrative polygon: Leh, Kargil/Purig and Zanskar lie in that
  polygon, Lahaul and Spiti are added from district-level geometry, and the
  existing Ngari member covers Guge, Purang and Rutog in western Tibet.
  John Bray's historical synthesis identifies the mid-17th-century kingdom's
  eastern expansion into Guge, Purang and Rutog, and Spiti as a dependency;
  Lahaul's official history documents periods under Ladakhi rule. This is an
  approximate cultural itinerary across periods, not a reconstructed border
  at a single historical date. The source units are disclosed rather than
  presented as exact historical boundaries. It does not equate all of modern
  Gilgit-Baltistan, Kashmir or Himachal Pradesh with the kingdom of Ladakh.
- Taiwan uses the National Land Surveying and Mapping Center's official county
  polygons, including coastal islets missing from the older geoBoundaries file.
  The county source includes Kinmen's Dadan/Erdan, Dongding, Beiding and Wuqiu,
  Keelung's offshore islands, Penghu, Dongsha and Taiping. The source's Yilan
  claim to the Senkaku/Diaoyu islands is explicitly excluded because this view
  follows actual administration. Dongsha and Taiping are rendered separately
  and placed in labelled inset frames; they are not shifted geographic neighbours.
- Southern Min includes Kinmen, Mindu includes Matsu, and Puxian includes Wuqiu.
  Fujian's province view includes all three groups too. This deliberate overlap
  does not mark them as visited.

International land boundaries come from Natural Earth's boundary-line dataset,
clipped into each region. `kind: disputed` preserves its disputed classification.
At the user's request, the **China–India eastern-sector undetermined line** is
omitted from the rendered border overlay. The filter requires both country
codes CHN/IND, a disputed classification, and the whole source feature within
90–99°E / 26–31°N. In the archived source this matches exactly one feature,
whose actual bounds are 91.628339–97.323496°E / 27.724820–29.369286°N.
It is applied to both initial baking and `--refresh-content`, including province
details, and leaves the western Ladakh disputed lines, Sikkim-sector line and
Nepal/Bhutan borders intact. Original archived boundary geometry is unchanged.
No boundary is invented by connecting administrative centroids. The datasets
have different source dates and generalized geometry; these views are for
regional exploration rather than cadastral or navigation use.

## Coordinate contract

All `path`, `outline`, `center`, border and photo `point` coordinates are in the
image's 1280 × 1000 pixel space. `projection` and `extent_m` retain the geographic
transform. Every photo leader is anchored using a `lngLat` entry in `places.json`;
country and cultural representative points are excluded from photo leaders.
`inset_frames` identifies separately rendered islands. `units.json` lists the
region/member IDs for maintaining multilingual text and photographs.

`content.json` is independent of the terrain build. It is the maintenance source;
the browser fetches only `content/<detail-file-name>.json`, the small regional
shard rebuilt by the content collector after geographic anchors are refreshed.
The explorer merges entries
by ID for titles, descriptions, image credit and source links. Photo source and
license records are stored with that content and its collection script.

## Sources

- [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) and the upstream elevation datasets credited there.
- [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), public-domain administrative geometry and international land boundaries.
- [geoBoundaries India ADM2](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/), Pathways Data / Local Government Directory, 2021 administrative coverage, integrated 2023-01-19, build 2023-12-12, downloaded 2026-11-16; Open Data Commons Open Database License 1.0. Only feature `76128533B75359793481950` (Lahul & Spiti) is extracted from the pinned upstream commit `9469f09`, archived in `tools/relief-atlas/regions/lahaul-spiti-geoboundaries.geojson.gz`; its unmodified API metadata is adjacent. This openly archived extract preserves attribution and the source license.
- [NLSC government open data downloads](https://maps.nlsc.gov.tw/pro/download.jsp), county boundaries, TWD97, downloaded 2026-11-16; original ZIP archived at `tools/relief-atlas/regions/taiwan-nlsc.zip`. Government Open Data License, version 1.0.
- Chinese city/province inputs and editorial classification are documented in the adjacent relief atlas and `tools/relief-atlas/china-cultural-regions.json`.
- [John Bray, *Introduction: Locating Ladakhi History*](https://www.academia.edu/9645160/Locating_Ladakhi_History), in *Ladakhi Histories: Local and Regional Perspectives* (Brill, 2005), pp. 1, 11–12; historical scope, including Spiti, Zanskar and the 1630 annexation of Guge/Purang/Rutog.
- [Lahaul and Spiti District — History](https://hplahaulspiti.nic.in/history/), official district history distinguishing the two valleys' ties with Ladakh and Kullu; used for historical membership rather than claiming their modern district edge is a medieval frontier.

To refresh this Himalayan scope after a source/content change, run
`python scripts/build-region-terrain.py --only CHN:qingzang`, then
`python scripts/build-region-terrain.py --refresh-content` and
`python scripts/validate-region-terrain.py`. Regenerate the content shards after
the final anchor refresh. The validator checks the named historical locations,
Bhutan/Sikkim coverage, and the narrowly filtered eastern-sector border against
the actual source geometry.
