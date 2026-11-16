# Administrative guide content

The cultural atlas contains 404 memberships across 47 cultural regions, resolving
to 401 distinct administrative units. Each unit has its own small content bundle
under `assets/maps/administrative/content/`. These articles describe the actual
administrative locality. They do not replace the original cultural essays in
`scripts/region-culture-content.json`.

## Runtime contract

`manifest.json.units[id].file` identifies a two-view scene. Its `content_file`
points to a JSON object with `entries`: the unit article and its named attractions
or locally documented scene photographs. Entries retain three-language labels
and descriptions, original text sources, photograph creator, license, original
file, modifications, WGS84 `lngLat`, and a coordinate source. Scene `places` are
projected from these same points; a picture of an outlying attraction is never
attached to an unrelated city centroid. Kaohsiung and Kinmen content bundles also
contain the relevant outlying-island entries for their labelled inset maps.

Wikipedia excerpts are shortened, translated and converted between Chinese
scripts under CC BY-SA 4.0. The 245 manual English translations are maintained in
`scripts/administrative-landmark-translations.json`. Cultural essays and the
other original captions have distinct `textKind` values and source labels.
The original source links and credits remain intact; requested display naming
is applied separately, preserving the full name People's Republic of China.

## Geographic centres and photographs

Principal urban windows use documented Wikidata city or administrative-seat
coordinates, with individually sourced corrections in
`scripts/administrative-focus-overrides.json`. A focus describes a landscape
window of a specified width, not a legal built-up-area boundary. Beijing uses
its central city rather than the relocated municipal offices in Tongzhou;
Jiagedaqi is explicitly identified as the administrative seat outside the
displayed Daxinganling outline. Yongxing, Dongsha, Taiping and Wuqiu use settlement
or island close-up definitions. All ten Hainan county-level seats were checked
against original OSM records; Ledong was corrected to Baoyou.

Named-attraction coordinates come from the linked encyclopedia or original
OSM/Wikidata record. `scripts/administrative-place-coordinate-overrides.json`
records independent corrections, including the actual OSM Jokhang building
footprint rather than the incorrect English Wikipedia longitude.

When a named attraction does not have a usable image, the guide can show a
published-location scene photograph. Such entries use `role: photo-location`,
retain the actual Commons/Mapillary camera coordinate and identify the scene
without inventing a landmark. Historic streetscapes are dated explicitly.
Nine sparse localities use clearly labelled 2025 NASA/USGS HLS L30 true-colour
observations. Their original granules, exact dates, bounding boxes and source
images are archived in `imagery/`; they are satellite references, not ground
photographs or synthetic natural-colour textures.

All 597 automatically selected named-attraction pictures and 178 initial
geotagged scene pictures received visual review. Fifty-one unsuitable candidates
(maps, plaques, objects, unrelated close-ups or unlabelled false-colour imagery)
were excluded by `scripts/administrative-rejected-photos.json`. Reviewed
replacements and additional accurately located landmarks are persisted in
`assets/maps/administrative/curated-landmark-entries.json`. Candidate metadata is
retained for audit, while unreferenced candidate WebP files are removed from the
public photo directory. The final unit heroes are also copied into the existing
cultural-region member cards using
`scripts/administrative-unit-photo-overrides.json`.

## Reproduce and audit

The complete public JSON API cache, original editorial inputs, review lists and
checks are stored in `content-sources.zip`. Its `SOURCE-MANIFEST.json` contains
each archived path, byte length and SHA-256. Extract it at the repository root
to restore `.render-work/region-content/`. It contains no duplicate raster photo
downloads; the credited WebP files are already published in the repository.

With Python, Pillow, OpenCC, requests, Shapely and pyproj available:

```powershell
python scripts/build-administrative-content.py --emit-content --sync-region-photos
python scripts/build-region-content.py --package-content-only
python scripts/build-admin-terrain.py --refresh-places
python scripts/build-admin-mesh.py --refresh-points
python scripts/build-edukai-subset.py --page index.html --page life.html --page observatory.html
python scripts/build-edukai-subset.py --check --page index.html --page life.html --page observatory.html
```

The first command reproduces the curated content without new network requests.
For deliberate source refreshes, the builder also exposes `--focus`,
`--external-focus`, `--discover-places`, `--collect-candidates`,
`--build-candidate-places`, `--collect-geotagged` and `--build-geotagged`.
Existing editorial translations, coordinate corrections, rejected candidates
and curated replacements remain applied after those stages. Additional inputs
can be merged with `--import-curated` and `--import-translations`.

The dedicated external-landmark, reviewed-Gansu-landmark and new-city-imagery
scripts retain their individual generation rules. The final independent asset
and interaction checks live in `scripts/validate-admin-explorer.cjs`. Font
generation includes the shipped administrative content and asynchronously
loaded map labels so that new simplified/traditional characters are not omitted.

All reference photographs retain their actual creators and licenses. None is
presented as a photograph personally taken by the site's author.
