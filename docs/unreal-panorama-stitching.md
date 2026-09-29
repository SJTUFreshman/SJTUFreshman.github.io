# Calibrated Unreal cube-face stitching

`scripts/stitch-unreal-panorama.py` converts six standard Deferred RGBA PNG camera views to the site's top-origin 2:1 equirectangular convention. Requires Python, NumPy and OpenCV (`numpy`, `opencv-python`). It performs no rendering and cannot recover alpha from opaque source images.

```powershell
python scripts/stitch-unreal-panorama.py capture.json panorama.png --width 8192 --block-rows 16
python scripts/validate-unreal-panorama-stitch.py
```

Every face must describe the **actual exported camera**, not an assumed screenshot name: origin in Unreal centimeters, forward/right/up as unit vectors in Unreal coordinates, horizontal and vertical 90° FOV, image path relative to the JSON, input color space and alpha convention. Images use top-origin rows. All six origins must agree within 0.001 cm; the forward vectors must form three opposite perpendicular pairs and camera right/up must align with cube axes. Camera roll by multiples of 90° is supported. A globally rotated cube is supported if every recorded basis is consistently rotated. Different origins would introduce parallax and are rejected.

Example camera arrangement (replace origins and bases with measured values):

```json
{
  "coordinateSystem": "unreal-centimeters",
  "faces": [
    {"name":"minus-y","image":"minus-y.png","origin":[125,-350,168],"forward":[0,-1,0],"right":[1,0,0],"up":[0,0,1],"horizontalFovDegrees":90,"verticalFovDegrees":90,"colorSpace":"srgb","alphaMode":"straight"},
    {"name":"plus-x","image":"plus-x.png","origin":[125,-350,168],"forward":[1,0,0],"right":[0,1,0],"up":[0,0,1],"horizontalFovDegrees":90,"verticalFovDegrees":90,"colorSpace":"srgb","alphaMode":"straight"},
    {"name":"minus-x","image":"minus-x.png","origin":[125,-350,168],"forward":[-1,0,0],"right":[0,-1,0],"up":[0,0,1],"horizontalFovDegrees":90,"verticalFovDegrees":90,"colorSpace":"srgb","alphaMode":"straight"},
    {"name":"plus-y","image":"plus-y.png","origin":[125,-350,168],"forward":[0,1,0],"right":[-1,0,0],"up":[0,0,1],"horizontalFovDegrees":90,"verticalFovDegrees":90,"colorSpace":"srgb","alphaMode":"straight"},
    {"name":"plus-z","image":"plus-z.png","origin":[125,-350,168],"forward":[0,0,1],"right":[1,0,0],"up":[0,1,0],"horizontalFovDegrees":90,"verticalFovDegrees":90,"colorSpace":"srgb","alphaMode":"straight"},
    {"name":"minus-z","image":"minus-z.png","origin":[125,-350,168],"forward":[0,0,-1],"right":[1,0,0],"up":[0,-1,0],"horizontalFovDegrees":90,"verticalFovDegrees":90,"colorSpace":"srgb","alphaMode":"straight"}
  ]
}
```

The mapping is UE `(X,Y,Z)` → Three `(X,Z,Y)*0.01` → shader navigation `(ThreeX,ThreeY,-ThreeZ)`. Thus panorama center looks toward UE −Y, U=.75 toward +X, U=.25 toward −X, the U seam toward +Y, top toward +Z and bottom toward −Z. Coordinates refer to pixel centers; poles/axis directions fall between pixels in an even-size raster. The output is in global site axes, so do not apply an extra camera yaw or Z flip when installing it. Translation converts the observation position; it never alters ray directions. The JSON report records this convention and the converted origin.

Inputs must be true RGBA PNG at 8 or 16 bits per channel. They are decoded unchanged by OpenCV, cached as integer disk memmaps one face at a time, and sampled in bounded row blocks. The panorama is compressed incrementally by a streaming PNG writer. No full-resolution floating panorama or six floating faces are allocated. Temporary disk space holds the six integer faces; peak decode memory includes one integer face plus its decoder buffers. Reduce `--block-rows` for lower working memory; `--cache-dir` selects scratch storage.

Input `colorSpace` explicitly means sRGB or linear RGB using sRGB/Rec.709 primaries, independent of PNG profile metadata. This tool does not perform ICC, wide-gamut, ACES or tone-mapping conversions. Convert those sources intentionally first. `alphaMode=straight` means unassociated RGB; `premultiplied` means RGB multiplied by alpha **in the declared input color space**; `premultiplied-linear` means RGB was multiplied in linear light **before** sRGB encoding. That last distinction matters for rendering pipelines that accumulate coverage before exporting to PNG: `sRGB(alpha * RGB)` differs from `alpha * sRGB(RGB)`. Select the convention from actual output evidence. Sampling converts the chosen input convention to linear premultiplied RGBA, then applies bilinear filtering. The output is unassociated RGB, zero RGB at zero alpha, with a linear coverage alpha channel. Default output is sRGB; choose `--output-color-space linear` for linear RGB. Its PNG sRGB/gAMA metadata records the selected output convention.

For each output ray the tool selects the face whose forward vector has the largest dot product. Ties use JSON face order. Bilinear sampling clamps within that face; it never blends pixels from different faces. This prevents transparent cross-face RGB contamination but cannot repair inconsistent exposure, Lumen histories, animation or edge sampling across faces. It does not provide area filtering when strongly downsampling: create the calibrated master at an appropriate resolution, then derive delivery tiers using an alpha-aware downsampler. Inspect cube boundaries, poles and foliage at full resolution.

Default output depth is the highest input depth; RGBA16 remains RGBA16, including samples not representable in 8 bits. `--bits 16` can explicitly select 16-bit output for RGBA8 sources. Reducing 16-bit sources requires both `--bits 8 --allow-precision-loss`, and is recorded in the report. Filtering uses float32 linear RGBA while geometry calculations use float64. EXR input/output is deliberately rejected: a float/HDR pipeline needs explicit channel, gamut and range handling and is not silently converted to PNG8.

The `.png.json` report includes depth, color/alpha conventions, alpha extrema and counts, calibration mapping, input paths and config hash. An all-opaque result is allowed for indoor scenes but must not be called a transparent sky asset. Validate exported alpha with open sky, solid geometry and partial edge samples; composite on bright and dark replacement skies to inspect halos before installation. The numerical validator uses independent six-axis solid markers and rolled image patterns, not a second copy of the stitcher's projection formula.
