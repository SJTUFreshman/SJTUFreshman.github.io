# Hipparcos star-map data

`hipparcos-stars.js` is generated from the ESA Hipparcos Main Catalogue,
catalogue I/239, using the public VizieR TAP service.

- Source catalogue: ESA (1997), *The Hipparcos and Tycho Catalogues*,
  ESA SP-1200.
- Catalogue page: https://www.cosmos.esa.int/web/hipparcos/catalogues
- Machine-readable table: https://cdsarc.cds.unistra.fr/viz-bin/ReadMe/I/239
- Generated subset: the 45,934 records with the lowest Johnson V magnitude
  among rows that contain a valid position and V magnitude.
- Stored fields: HIP identifier, ICRS right ascension and declination,
  Johnson V magnitude, and B-V colour index when available.

The underlying Hipparcos catalogue measurements are public-domain data. The
local asset contains only those factual measurements and the small decoder
authored for this site; it does not copy third-party catalogue-reader code.
The ESA citation is retained for scientific attribution. A source/licence
distinction between the public-domain Hipparcos measurements and GPL
Stellarium line data is documented by the
[Hipparcos Planetarium Data project](https://github.com/creativival/hipparcos_planetarium_data_creator/blob/main/README.md).

The VizieR selection used to build the local asset was:

```sql
SELECT TOP 45934 HIP, RAICRS, DEICRS, Vmag, "B-V"
FROM "I/239/hip_main"
WHERE Vmag IS NOT NULL
  AND RAICRS IS NOT NULL
  AND DEICRS IS NOT NULL
ORDER BY Vmag ASC
```

Coordinates are quantized to approximately 20 arcseconds in right ascension
and 10 arcseconds in declination. This is substantially finer than a rendered
screen pixel at the site's widest field of view.

The interactive constellation lines are a small, original set of common
stick-figure connections authored for this site. No Stellarium constellation
line data is included.
