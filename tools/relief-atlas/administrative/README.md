# Offline administrative terrain sources

Every whole-unit and urban plate has its own compressed NPZ scene. Named remote
island insets have additional independent scenes. No scene needs remote terrain
tiles to reproduce its published WebP.

Each NPZ contains:

- `elevation_qm`: a 960 × 750 unsigned-integer DEM in quarter metres, sampled
  from AWS Terrain Tiles. Following the regional-plate renderer, samples below
  sea level are clipped to 0 m; these plates do not depict bathymetry.
- `mask_bits` and `mask_shape`: the packed 1280 × 1000 geographic land mask.
- `metadata`: UTF-8-compatible JSON stored as a NumPy Unicode string, including
  projection, metric extent, dimensions, source coordinate convention, lighting,
  material, outline and the sourced settlement focus where applicable.

The renderer uses these same archived height samples. It bilinearly expands the
DEM to the output dimensions, recomputes terrain normals and northwest horizon
occlusion for this isolated mask, and applies the single warm plaster pigment
`#eeeae0`. Light elevation is 42°, azimuth 315°, and vertical exaggeration 2.8×.
Whole and urban images are independent computations, not parent-map crops.

For inset parents, the metadata also stores `inset_sources` and full child scene
information. The main scene remains geographically located; only the clearly
labelled child frames are displaced on the page. Keep those child NPZs beside
the parent scene when reproducing it.

`units-wgs84.geojson.gz` preserves the complete de-duplicated unit geometry used
by this build, including Kinmen's Wuqiu and Kaohsiung's Dongsha and Taiping.
Chinese DataV polygons are inverted from their documented GCJ-02 convention
using six iterative inverse steps. The original files are preserved under
`assets/maps/`; this derivative is explicitly WGS84. Other original geographic
sources remain in `tools/relief-atlas/regions/` and the historical footprint
source archives. The new generator never changes those originals.

Sansha is an explicit exception to the old schematic DataV drawing.
`sansha-controlled-land.geojson` contains 73 actual land patches in eight groups,
assembled from 95 OpenStreetMap `natural=coastline` ways. Its raw 27 API responses
and exact-assembly script are retained in `sansha-osm-sources.zip`. This includes
the sampled Paracels and seven actually administered Spratly reefs, and excludes
maritime borders, claimed extents, submerged reef outlines and Taiping. The
individual features retain source API URLs, way IDs and ODbL 1.0 attribution.
The overview is labelled as an actual-island guide rather than Sansha's full
statutory extent. Yongxing/Shi and each of the seven reefs have independent inset
scenes; the overview still contains all the sourced land at its true position.
Six reclaimed-reef inset scenes have zero-valued available elevation samples.
They retain their real coastlines without invented height. Their scene metadata
sets `elevation_status: no-resolved-relief`, and the visible frame note states
that the public elevation data does not resolve their surface relief.

## Optional live 3D meshes

`scripts/build-admin-mesh.py` derives the separate browser meshes from these same
archived scenes, without accessing the network or changing any static image.
It retains the true mask's islands and holes, samples the DEM on an approximately
80 × 63 interior grid, and creates real XYZ triangles and unit surface normals.
Each island inset remains its own selectable model. A very thin model backing
is decorative; no elevation is fabricated for the six unresolved reef scenes.

The `.atm` files use little-endian `ATM1`, uint32 vertex count, uint32 index count,
then Float32 positions, Float32 normals and Uint16 triangle indices. Each file
stays below 250 KB and 65,535 vertices. The longest horizontal dimension spans
[-1, 1], with X east, Y north, and Z above the scene's minimum elevation at the
same 2.8× vertical exaggeration. Runtime metadata records the source NPZ SHA-256,
grid, coastal simplification tolerance and photo anchor positions on the actual
triangle surface. `view.mesh.parts` resolves the separately selectable insets.

After changing photographic places, run the terrain builder's `--refresh-places`
and then `python scripts/build-admin-mesh.py --refresh-points`. This recomputes
only the photographic anchors; it does not rewrite the mesh binaries. After
changing a focus, rebuild that unit's urban image/scene and its mesh. Run
`python scripts/validate-admin-mesh.py` to check every mesh's binary structure,
normals, bounds, source hash and actual elevation variation.

## Reproduce without network

From the repository root, with NumPy, Pillow, SciPy, Shapely, rasterio and pyproj:

```powershell
python scripts/build-admin-terrain.py --from-scene tools/relief-atlas/administrative/320500-whole.npz --output suzhou-whole.webp
```

This path reads only the NPZ scene and any named inset NPZs. It does not load the
geographic inventory, fetch terrain tiles, query places or access the network.
WebP encoder settings are quality 88, method 6; the same Pillow/libwebp versions
produce identical WebP bytes. Other encoder versions may change compressed bytes
while preserving the decoded relief.

The first full bake can be resumed with `--skip-existing`. A changed focus is
detected and independently re-sampled. Downloads use the separate ignored
`.render-work/admin-sources/` cache; they are not required to reproduce any
finished archived scene.

Primary sources:

- AWS Terrain Tiles: <https://registry.opendata.aws/terrain-tiles/>
- DataV source: <https://datav.aliyun.com/portal/school/atlas/area_selector>
- DataV coordinate convention: <https://help.aliyun.com/en/datav/datav-7-0/user-guide/map-data-format-1>
- Taiwan NLSC county boundaries: <https://maps.nlsc.gov.tw/pro/download.jsp>
- Natural Earth: <https://www.naturalearthdata.com/>
- Lahaul and Spiti: <https://www.geoboundaries.org/api/current/gbOpen/IND/ADM2/>
- OpenStreetMap contributors, ODbL 1.0: <https://www.openstreetmap.org/copyright>

Each urban focus also preserves its own coordinate source, selection source,
three-language definition and viewport extent in its scene metadata.
