# Hipparcos distance reference

`hipparcos-distances.js` is a companion to `hipparcos-stars.js`. It contains
parallax measurements from the **ESA Hipparcos Main Catalogue, I/239**:
ESA (1997), *The Hipparcos and Tycho Catalogues*, ESA SP-1200.

- [ESA catalogue page](https://www.cosmos.esa.int/web/hipparcos/catalogues)
- [CDS table documentation](https://cdsarc.cds.unistra.fr/viz-bin/ReadMe/I/239)
- [VizieR TAP service](https://tapvizier.cds.unistra.fr/TAPVizieR/tap)
- The public astronomical measurements and their original scientific
  attribution follow the provenance described in `HIPPARCOS-NOTICE.md`.

Only HIP identifiers already present in the site's star catalogue are
included. Both `Plx` and its reported standard error `e_Plx` must be positive,
and `e_Plx / Plx` must be at most 0.25. Missing or rejected measurements have
no entry. No distance is inferred from apparent brightness or invented for a
missing star. The checked-in asset contains 32,109 adopted measurements
matching the existing 45,934-star catalogue and occupies about 370 kB.

The packed asset preserves the source precision of 0.01 milliarcseconds for
both parallax and standard error. Distance is calculated as `1000 / Plx` in
parsecs. This reciprocal-parallax estimate is useful for an illustrative
local star map, but it is not a modern Bayesian distance estimate. Its
uncertainty is asymmetric, and the relative-error cut does not remove all
catalogue systematics, binary-star effects, or selection bias. At the
accepted limit, approximate distance bounds derived from one parallax
standard error are `1000 / (Plx + e_Plx)` and
`1000 / (Plx - e_Plx)`. These data are the 1997 main catalogue measurements,
not the later Hipparcos reduction or Gaia measurements.

The display may compress distances for legibility; stored distances remain
in physical parsecs and must not be described as exact. An entry absent from
this asset means “no adopted distance,” not zero parsecs.

## Browser API

`window.HipparcosDistances` exposes `source`, `sourceUrl`, `sourceSha256`,
`maximumRelativeError`, `count`, and `byHip`. The latter is a `Map` whose HIP
integer keys return `{ parsecs, parallaxMas, errorMas, relativeError }`.
`relativeError` is the fractional parallax standard error. The asset is
independent at runtime and can be loaded before or after `hipparcos-stars.js`.

## Rebuild

Requires Node.js 18 or newer; no third-party packages.

```sh
node scripts/build-hipparcos-distances.mjs --save-source hipparcos-parallaxes.csv
node scripts/build-hipparcos-distances.mjs --input hipparcos-parallaxes.csv
```

The first command fetches the public CSV and saves the exact input for an
offline, deterministic rebuild. The generated asset records its SHA-256.
Optional `--catalog` and `--output` arguments override the companion
catalogue and destination paths. The input query is:

```sql
SELECT TOP 120000 HIP, Plx, e_Plx
FROM "I/239/hip_main"
WHERE Plx > 0 AND e_Plx > 0 AND e_Plx <= 0.25 * Plx
ORDER BY HIP
```

The builder validates measurements, rejects duplicate HIP identifiers,
checks the packed fields preserve source precision, and filters against the
existing site catalogue. Source CSV files are rebuild inputs and do not need
to be deployed with the site.
