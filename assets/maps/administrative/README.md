# Administrative relief portraits

The registry covers all 401 distinct members of the 47 cultural regions: 404
parent/member relationships share 401 documents. This inventory is independent
of visit status. Each document contains two simultaneously displayable views:
`views.whole` and `views.urban`, plus a separately fetched content shard.

Both views use freshly sampled elevation and independent surface lighting in
the same warm plaster material (`#eeeae0`). No satellite colour, land-cover tint
or crop of a parent cultural image is used. The output is a static 1280 × 1000
relief plate. The quarter-metre-quantised 960 × 750 DEM is archived and is also
the actual input to the renderer; this makes offline reproduction deterministic.

An optional **3D view** loads a separate real elevation mesh only after its
button is selected. The default artwork remains the independently shaded image.
The viewer supports pointer rotation, keyboard rotation, zoom and reset, using
the same plain plaster material. These meshes have actual XYZ vertices and
surface normals; the static WebP is not described as a 3D model.

Each binary mesh is below 250 KB. It uses an approximately 80 × 63 interior
height grid, locally clipped to the coastline so that islands and holes survive,
plus a thin decorative backing. The longest horizontal dimension is normalised
to [-1, 1], north is positive Y, and height uses the real DEM relative to the
local minimum with 2.8× exaggeration. Inset meshes remain individually selectable
parts at their own natural shape; page-layout displacements are never joined
into fictitious terrain. Photo lines attach to computed triangle-surface XYZ.

`focus.json` identifies the sourced WGS84 city centre, administrative seat,
settlement or island detail used by each urban viewport. `extentKm` defines its
landscape window. It is a view of that settlement and its surrounding terrain,
not a claim to a statutory city boundary or a remotely sensed built-up polygon.
The focus is never an administrative-polygon centroid. The visible caption must
preserve the distinction between a city centre, a seat, and an island close-up.

Chinese DataV source geometry is explicitly inverted from GCJ-02 to WGS84 before
DEM sampling. Other source geometry, settlement coordinates and all geographic
photo anchors use WGS84. Each scene records its source convention, projection,
extent and lighting. Geometry and raster reprojection use an explicit spherical
equirectangular CRS (`+R=6378137`), avoiding the ambiguous older EQC definition.

The whole Kinmen County view includes Wuqiu, and the whole Kaohsiung City view
includes Dongsha and Taiping. Remote islands appear in named inset frames, with
their own independently rendered scenes and coordinate transforms. Their
independent entries in the cultural guide remain available. Inset outlines and
photo anchors are converted to their displayed frame coordinates.

Sansha's whole view is an **administered-island guide**, not a legal maritime
extent. Its actual land comes from OpenStreetMap coastlines: all sampled Paracel
islands and seven administered Spratly reefs. The source's schematic sea symbols
are never used as land. The overview preserves true geographic locations; eight
labelled close-ups show Yongxing/Shi and the seven reefs. `guide_points` connects
their real locations to the numbered frames. This dataset does not include
Taiping, which remains in the Taiwan actual-administration views.

## Build and resume

```powershell
python scripts/build-admin-terrain.py --workers 4 --skip-existing
python scripts/build-admin-terrain.py --only 320500 --views whole,urban
python scripts/build-admin-terrain.py --refresh-places
python scripts/build-admin-mesh.py --workers 4
python scripts/build-admin-mesh.py --refresh-points
python scripts/validate-admin-mesh.py
```

The builder reads the complete cultural membership from the existing regional
geography inventory. Editorial focus and landmark information is maintained by
the administrative content builder. If a focus definition changes, the resume
operation detects it and rebuilds that urban scene. Updating descriptions or
landmarks only requires `--refresh-places` after the content build.
Follow it with the mesh builder's `--refresh-points` to update photographic XYZ
anchors without touching mesh binaries. A changed focus requires rebuilding its
urban DEM plate and then its mesh, for example `--only 469027` in both builders.

Tile downloads and working intermediates stay under ignored
`.render-work/admin-sources/`. Existing regional tiles may be reused read-only;
the previous regional cache is not changed by this generator. Published WebP
images contain no project files, embedded metadata or elevation arrays.

## Coordinate and loading contract

`manifest.units[id].file` resolves to one document. `content_file` resolves to
its three-language encyclopedic text and licensed locality photographs. The two
view `image` fields are loaded on demand when that unit is opened. A view's
`outline`, `borders`, and `places[].point` are in its `width` × `height` pixels;
`places[].lngLat` retains the real WGS84 coordinates.

`inset_frames` describes visible frames. `insets` contains each complete child
scene plus its `frame`, and `included_units` lists the separately represented
administrative parts. The `source_archive` and `inset_sources` fields link to
offline build records, which browsers never fetch.

See `tools/relief-atlas/administrative/README.md` for source and reproduction
details. Source links and licence metadata remain attached to the content.
