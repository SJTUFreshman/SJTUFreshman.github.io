# Settlement reference overlays

These are demand-loaded vector overlays for the cultural atlas and administrative
terrain views. They come from the European Commission Joint Research Centre's
[GHS-BUILT-S R2023A](https://human-settlement.emergency.copernicus.eu/ghs_buS2023.php),
2020 epoch, 1 km Mollweide grid. A cell is included when buildings cover at least
50,000 m² (5%) of its 1,000,000 m² area. Residential and non-residential buildings
are both included. This consistent worldwide reference also shows settlements
in areas the author has never visited.

This is a generalized built-up reference, **not** a legal urban/planning boundary
or a dataset of individual building footprints. Small and sparse settlements may
not reach the threshold. The 2020 epoch is modelled within GHSL's multitemporal
series. Display those limitations with the legend; do not relabel a rectangular
camera window as the urban boundary.

`manifest.json` maps geographical record IDs to independent JSON files. Regional
files contain `paths` in the original terrain image's coordinates and
`visitedCities` with real geographic anchors. Administrative files contain
`views.whole` and `views.urban`. Each view also has `meshOverlays`, keyed by the
exact `.atm` file, so a 3D renderer can map the same footprint to the terrain
surface, including disconnected island models. Render paths using the even-odd
fill rule. Multiple disconnected polygons are combined into path chunks to avoid
thousands of DOM nodes.

The derived source mask and provenance are archived under
`tools/relief-atlas/settlements`; `scripts/build-settlement-overlays.py` rebuilds
everything offline. `--prepare-source` recreates that mask from the official
download. The original 145 MiB global download is only a local cache, not a web
payload. Regenerate overlays after terrain extents, geography, or visits change.

Visited city markers come only from the explicit `visited_china` list in
`site_content.json`, joined to the atlas's sourced city coordinates. Country
visits do not imply visits to every city. The original dataset currently contains
no explicit overseas city visits.

Citation: Pesaresi M., Politis P. (2023), GHS-BUILT-S R2023A, European Commission,
Joint Research Centre. DOI: 10.2905/9F06F36F-4B11-47EC-ABB0-4F8B7B1D72EA.
