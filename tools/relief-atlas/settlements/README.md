# Reproducible built-up footprint source

`ghsl-2020-builtup-5pct.tif` is a lossless binary selection of the official
GHS-BUILT-S 2020 R2023A 1 km global Mollweide raster: pixels are one when building
surface is at least 50,000 m² and zero otherwise. No smoothing, dilation or
fictional expansion is applied. The compact 2.5 MB file supports rebuilding all
atlas overlays without the original server or an internet connection.

`provenance.json` records the source URL, original raster SHA-256, threshold,
coordinate system, resolution and output checksum. `copyright.txt` is the
source publisher's notice. The original downloaded GeoTIFF and zip are cached
under `.render-work/settlement-sources` when rebuilding the threshold mask.

Rebuild with Python and numpy, rasterio, pyproj, shapely installed:

```sh
python scripts/build-settlement-overlays.py
python scripts/validate-settlement-overlays.py
```

Use `--prepare-source` only to reproduce the binary source from the official
download. `--regions-only` regenerates only the regional overlays;
`--only <filename-fragment>` can limit a preview build. `--index-only` reconciles
the manifest after independently running different build subsets.
