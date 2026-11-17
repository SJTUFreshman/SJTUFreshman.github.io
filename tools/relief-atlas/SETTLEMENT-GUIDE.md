# Settlement and visit layers

The three footprint maps use the same interaction rules. A region's visited
flag changes its appearance, never whether its geography can be opened.
Restricted destinations retain their warning hatch. Insets have their own
hit geometry, rather than activating the mainland underneath.

## Built-up reference

`assets/maps/settlements/manifest.json` indexes demand-loaded overlays for
regional plates and both administrative views. The source is GHSL GHS-BUILT-S
R2023A, epoch 2020, at 1 km resolution. Cells with at least 50,000 m² of built
surface are included. This is a generalized building-density reference, not a
planning boundary, a legal urban boundary, or individual building footprints.
Small or sparse settlements may be absent. The UI states these limits.

The derived threshold raster, source checksum, attribution and rebuild
instructions are archived in [settlements/README.md](settlements/README.md).
No remote bake server is needed to regenerate this layer.

Flat maps draw clipped SVG paths. The WebGL viewer rasterizes those same paths
into a 1024-pixel mask and samples them in terrain coordinates. The mask follows
the actual mesh surface and its depth test, so rotation does not leave a flat
overlay floating above the terrain. Each island part uses its own coordinates.
The layer can be toggled without changing the underlying plaster material.

## Visits and geographic coverage

Visited city dots come from the existing explicit visit list and known city
coordinates. A visited country or province does not imply that its capital was
visited. Opening or browsing a region never edits the travel history.

`scripts/build-region-coverage.py` supplies missing atlas detail records from
the existing geographic outlines and baked terrain. Existing administrative
views are reused where available. Additional regional plates are isolated from
the matching atlas relief; their data records retain this provenance.
`subregions[].explore` describes another regional view; `administrative: true`
links a unit to its whole-area and urban guide.

## Verification and publication

Run the coverage and settlement data validators alongside:

```text
node scripts/validate-footprint-region-access.cjs
node scripts/validate-settlement-ui.cjs
node scripts/validate-admin-terrain-3d.cjs
```

After changing localized descriptions, regenerate the site font subsets and
check their coverage. Keep all Life and Observatory runtime `v=` parameters on
one release version (the two shared typography stylesheets have independent
versions). Bump both the atlas loader and regional loader versions when their
JSON changes. `scripts/validate-life-http.cjs` checks the complete served
release before publication.
