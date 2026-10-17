# Local photographic Milky Way sky

These textures show the night sky **from inside the Milky Way**. They are
derived from a visible-light photographic mosaic, not an external view of a
spiral galaxy and not an AI-generated image.

## Source and required credit

**[ESO/S. Brunier](https://www.eso.org/public/images/eso0932a/)** —
“The Milky Way panorama”, ESO image `eso0932a`, GigaGalaxy Zoom (2009).

- [Public original TIFF](https://cdn.eso.org/images/original/eso0932a.tif):
  **6000 × 3000**, 29,082,084 bytes; sRGB IEC61966-2.1.
- SHA-256: `10f209ab83e1fd89e7fa1ed70277ffc6ed19c43549f04ec637c6806d98aff035`.
- Licence: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/),
  as stated in the source metadata and the
  [ESO copyright policy](https://www.eso.org/public/outreach/copyright/).
- The complete credit **ESO/S. Brunier**, linked to the image page, must be
  clearly visible with the displayed image. A README alone is insufficient
  for the interactive viewer's attribution.
- The source metadata identifies Serge Brunier and Frédéric Tapissier as
  the creators. The image is copyrighted, released under the licence above;
  it is not claimed to be public domain.

The [source description](https://www.eso.org/public/images/eso0932a/) explicitly
withholds the full 800-million-pixel original. Both the public TIFF and large
JPEG are 6000 × 3000; the official zoomable viewer also exposes exactly that
size. The observer page now serves the full native 6K image, while the 3D map
keeps its downsampled 4K background. No 8K upscale or invented detail is used.
The photograph combines tracked exposures taken
over several months; its colour and faint dust detail exceed naked-eye
perception, and some photographed bright objects are planets at those dates.
It is a scenic background, not a current-epoch astrometric survey.

## Generated assets and modifications

| File | Dimensions | Encoding | Bytes |
| --- | --- | --- | --- |
| `milky-way-preview.webp` | 2048 × 1024 | WebP quality 92 | 545,142 |
| `milky-way-sky.webp` | 4096 × 2048 | WebP quality 92 | 2,442,698 |
| `milky-way-sky-native.webp` | 6000 × 3000 | WebP quality 96 | about 6.98 MB |

Modifications are a **single rigid spherical rotation** to align the original
panorama with standard Galactic coordinates and WebP compression. The shared
2K/4K assets use bilinear reprojection and Lanczos downsampling. The native 6K
observer asset uses cubic interpolation at the original dimensions to preserve
small-scale detail through the coordinate rotation, with no downsampling. The source's
sRGB colour values are retained. No sharpening, invented stars, painted dust,
AI detail, or local shape warps are applied. Credit/licence information is
also embedded in each WebP's XMP metadata.

## Projection and alignment evidence

The output is a full-sphere **equirectangular / plate carrée** image:

```text
u = fract(0.5 - GalacticLongitude / (2 * pi))
v = 0.5 - GalacticLatitude / pi
```

The Galactic centre is at `(u, v) = (0.5, 0.5)`. Longitude increases leftward,
the north Galactic pole is at the top, and the `l = 180°` seam wraps left to
right. This is not Hammer or Mollweide projection.

The source lacks formal WCS metadata; the projection was checked by fitting
one rotation to sixteen identifiable bright stars across both hemispheres,
including high Galactic latitudes. The source's almost-horizontal Galactic
plane is slightly rotated relative to the standard Galactic frame. Treating
it as already aligned would displace the stars by roughly 2–3 degrees.
After the rigid fit, the RMS landmark residual is **0.0718°**, and the maximum
fitted residual is **0.1127°**. This close agreement across the sphere supports
equirectangular projection. It does not make the photo an exact star catalogue.

| Star | HIP | Original TIFF pixel (x, y) | Residual after fit |
| --- | ---: | --- | ---: |
| Sirius | 32349 | 5261, 1654 | 0.0530° |
| Canopus | 30438 | 4686, 1908 | 0.0744° |
| Arcturus | 69673 | 2740, 324 | 0.0910° |
| Vega | 91262 | 1919, 1182 | 0.0915° |
| Capella | 24608 | 344, 1455 | 0.0156° |
| Rigel | 24436 | 5552, 1936 | 0.0524° |
| Procyon | 37279 | 5498, 1296 | 0.0700° |
| Achernar | 7588 | 4175, 2454 | 0.0534° |
| Betelgeuse | 27989 | 5719, 1669 | 0.0551° |
| Altair | 97649 | 2262, 1639 | 0.1127° |
| Aldebaran | 21421 | 29, 1866 | 0.1090° |
| Spica | 65474 | 3796, 619 | 0.1034° |
| Fomalhaut | 113368 | 2762, 2559 | 0.0489° |
| Deneb | 102098 | 1648, 1479 | 0.0359° |
| Regulus | 49669 | 5314, 692 | 0.0517° |
| Pollux | 37826 | 5858, 1133 | 0.0470° |

Antares (HIP 80763, pixel 3184, 1214), in a blended nebular field, is withheld
from the fit and has an independent residual of **0.2501°**. Pixel positions
are zero-based; the fit uses their centres. Directions come from the bundled
Hipparcos catalogue, transformed from ICRS/J2000 to Galactic coordinates.
The complete directions and pixel pairs are in `CALIBRATION_LANDMARKS` and
`VALIDATION_LANDMARKS` in the builder, so the evidence is reproducible.

## Rebuild

Requires Python with Pillow, NumPy, and SciPy. From the repository root:

```powershell
python scripts/build-local-sky-assets.py
python scripts/build-local-sky-assets.py --observatory-detail-only --quality 96
```

The script downloads the public original into
`.render-work/galaxy-reference/eso0932a-original.tif` if absent, verifies its
SHA-256 and dimensions, fits and checks the rigid rotation, prints individual
landmark residuals, and writes both WebP files. A changed source is rejected
until it has been checked and recalibrated. `--observatory-detail-only` writes
only the native observer texture, leaving the existing 3D-map assets unchanged.

The observer renderer loads the small preview first, then the native image.
It respects the device's maximum texture size; on capable mobile and desktop
GPUs it uses all 6000 × 3000 pixels. The non-power-of-two image uses WebGL 1's
required clamp/linear sampling instead of invalid mipmaps. The canvas supports
DPR 2 within an 8.3-million-pixel budget. Canvas fallback retains a 4K source and
up to 1440 × 900 steady projection, with a smaller projection during gestures.
