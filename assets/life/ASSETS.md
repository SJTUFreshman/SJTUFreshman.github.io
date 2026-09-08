# Night environment assets

All twelve model/material assets are from [Poly Haven](https://polyhaven.com).
They are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/);
see [Poly Haven's license policy](https://polyhaven.com/license).
Retrieved and verified on 2026-09-07. Each downloaded file was checked against
the Files API's byte size and MD5; SHA-256 values below identify the local bytes.
Models and textures are served locally. Builders should load them only when
needed; adding these files does not preload every scene. No external asset CDN
is needed at runtime. A procedural fallback can remain visible during loading
or when a local asset cannot load.

These are purely environmental visuals: none is mapped to Home, Projects or
another site content section.

## Integration

The seven model entry points are:

- `assets/life/models/potted_plant_01/potted_plant_01_1k.gltf`
- `assets/life/models/mid_century_lounge_chair/mid_century_lounge_chair_1k.gltf`
- `assets/life/models/desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf`
- `assets/life/models/rock_07/rock_07_1k.gltf`
- `assets/life/models/painted_wooden_bench/painted_wooden_bench_1k.gltf`
- `assets/life/models/stone_fire_pit/stone_fire_pit_1k.gltf`
- `assets/life/models/pine_sapling_small_variant_01/pine_sapling_small_variant_01_1k.gltf`

The six complete model descriptors, buffers and image includes are unmodified;
the pine variant is a documented lossless geometry subset described below.
Relative paths in each glTF resolve inside its model directory. Poly Haven's 1K model
manifests reference shared geometry buffers at upstream `gltf/8k` or `gltf/4k`
URLs; these are the exact official includes, not 8K or 4K texture downloads.
No Draco, KTX2 or meshopt decoder is required by these seven models.

The standalone JPG maps under `assets/life/textures/` provide color
(`diff` or `col_*`), OpenGL normal (`nor_gl`), roughness (`rough`),
and packed ambient-occlusion/roughness/metalness (`arm`, R/G/B). Set color
maps to Three.js SRGBColorSpace; keep data maps linear. Fabric has three
provided color variants; use one at a time. Texture scales should be tuned
in world units rather than stretched to fit a whole large floor.

## Local loader

Load `assets/vendor/night-gltf-loader-0.160.1.js` after the existing
`assets/vendor/three-0.160.1.min.js`. It exports
`window.NightGLTFLoader` with the official loader API (`load`,
`loadAsync`, `parse`), and references the existing `window.THREE`.
There is no second Three.js engine.

The classic adapter is mechanically generated: replace the named Three.js
import with destructuring of `window.THREE`, include only the unmodified
`toTrianglesDrawMode` helper, replace the export with the global assignment,
and wrap the result in an IIFE. No loader logic is changed. It is MIT licensed;
see `assets/vendor/THREE-LICENSE.txt`.

Rebuild (requires network only during this maintenance command):

```powershell
node assets/vendor/build-night-gltf-loader.cjs
node --check assets/vendor/night-gltf-loader-0.160.1.js
```

| Source or artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| [GLTFLoader.js 0.160.1](https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/loaders/GLTFLoader.js) | 108522 | `d073b438e6a07e1359741dd5d6c76c953420cc0d4fd84eb1bdde94315540e6a3` |
| [BufferGeometryUtils.js 0.160.1](https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/utils/BufferGeometryUtils.js) | 31906 | `9be041e96308775d00e2695cc607645b9a9b64fd7c0e759dd8f7c00a8d92becb` |
| `assets/vendor/night-gltf-loader-0.160.1.js` | 110905 | `5bd60d69b4021d5eb5301dcf8acc320be5d5b136d64eb87b0b461f2e284ef2e4` |

Validation completed: classic loader syntax; one triangle glTF and all seven
downloaded model geometries parsed using the already loaded THREE revision
160; each model has finite world bounds; all local glTF include paths resolve;
all 55 original downloaded files match the API size and MD5. The pine's six
texture files also match upstream; its descriptor and geometry are checked
against the reproducible extraction and recorded SHA-256. The geometry test uses
stub image decoding, so browser checks are still required for material visuals.
Total model and texture payload across all twelve assets: 41,272,729 bytes.
This total is not a required initial-page download.

| Model | Triangles | Bounds (X × Y × Z, metres) |
| --- | ---: | --- |
| Potted Plant 01 | 176226 | 0.587 × 1.350 × 0.634 |
| Mid-Century Lounge Chair | 6148 | 1.009 × 1.169 × 1.190 |
| Desk Lamp Arm 01 | 24102 | 0.202 × 0.893 × 0.614 |
| Rock 07 | 14844 | 0.169 × 0.144 × 0.320 |
| Painted Wooden Bench | 630 | 1.165 × 0.889 × 0.497 |
| Stone Fire Pit | 3887 | 1.448 × 0.388 × 1.433 |
| Pine Sapling Small (variant B) | 122235 | 0.529 × 1.046 × 0.730 |

The plant is a detailed hero prop; avoid repeating many instances. Normalize
placement to the model's bottom bound (especially the desk lamp, whose source
minimum Y is about −0.088). Scale the small rock deliberately for boulders.
The fire pit's source minimum Y is about −0.193; normalize its bottom before
placing it on terrain. The bench's source minimum Y is approximately zero.

### Pine variant extraction

`models/pine_sapling_small_variant_01/` is a bounded extraction of the first
(`pine_sapling_small_b`) natural Y-up variant from Poly Haven's
`pine_sapling_small` glTF. The source model contains three variants in one
17.8 MB geometry buffer; this extraction removes the other two presentation
variants and the first variant's X=1 presentation offset, while preserving its
original bark/twig meshes, normals, UVs, alpha-mask material, and 1K maps.
The result is 9,571,633 bytes and 122,235 triangles, with bounds
0.529 × 1.046 × 0.730 m (X × Y × Z), so it remains below the 10 MB / 150k
triangle guardrails. Rebuild and verify it with:

```powershell
node assets/life/models/repack-pine-variant.cjs
```

The script checks the upstream descriptor and geometry MD5 before extracting;
the source asset and all local extracted files remain CC0-1.0. The glTF's
`extras` records the source URL and extraction choice.

## Download manifest

### painted_wooden_bench

[Asset page](https://polyhaven.com/a/painted_wooden_bench) · [Files API](https://api.polyhaven.com/files/painted_wooden_bench) · CC0-1.0 · 1,989,639 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/models/painted_wooden_bench/painted_wooden_bench_1k.gltf` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/painted_wooden_bench/painted_wooden_bench_1k.gltf) | 2835 | `2289ab82f3fe3045bf18f7b9541743d2c65b9f071cb34bbe424d2bc998f3e507` |
| `assets/life/models/painted_wooden_bench/painted_wooden_bench.bin` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/painted_wooden_bench/painted_wooden_bench.bin) | 25444 | `5799bcb20924105cccd6424de8cdb8e67eb57fddc19c395befeac634a7b2e013` |
| `assets/life/models/painted_wooden_bench/textures/painted_wooden_bench_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/painted_wooden_bench/painted_wooden_bench_diff_1k.jpg) | 545216 | `9bc533313091ee71eaca5fa6334b71d27935d9d75311f64df6a53c28a67c435c` |
| `assets/life/models/painted_wooden_bench/textures/painted_wooden_bench_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/painted_wooden_bench/painted_wooden_bench_nor_gl_1k.jpg) | 830104 | `a0f53740d77fc61aac01de0b7e1ae6109445d1756839f739ae31fdf10c9911f2` |
| `assets/life/models/painted_wooden_bench/textures/painted_wooden_bench_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/painted_wooden_bench/painted_wooden_bench_arm_1k.jpg) | 586040 | `878785565eeff706b8f1e4db7e3d794a544e9cf0e56cee424d9a271ab4ead47e` |

### stone_fire_pit

[Asset page](https://polyhaven.com/a/stone_fire_pit) · [Files API](https://api.polyhaven.com/files/stone_fire_pit) · CC0-1.0 · 2,535,945 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/models/stone_fire_pit/stone_fire_pit_1k.gltf` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/stone_fire_pit/stone_fire_pit_1k.gltf) | 2792 | `40034b326d28c06f25cf1cdb39a5ab3f3b1d1a9415d490af39621efe6c31cee6` |
| `assets/life/models/stone_fire_pit/stone_fire_pit.bin` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/4k/stone_fire_pit/stone_fire_pit.bin) | 96220 | `83528a314ac1ff67a583a59640612e7f8dca803dbb581188b8226d9b661ef0d6` |
| `assets/life/models/stone_fire_pit/textures/stone_fire_pit_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/stone_fire_pit/stone_fire_pit_diff_1k.jpg) | 785670 | `3f2a2340a7dc7207d5b24deb7697c11c43bbd1963533b8f7c41644d32872d1ff` |
| `assets/life/models/stone_fire_pit/textures/stone_fire_pit_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/stone_fire_pit/stone_fire_pit_nor_gl_1k.jpg) | 969822 | `6ba240fbdc1ab6dac4b06ac342e7fca9fa6064c7d4f98e75cfccad44214c533a` |
| `assets/life/models/stone_fire_pit/textures/stone_fire_pit_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/stone_fire_pit/stone_fire_pit_arm_1k.jpg) | 681441 | `9812f7511ccbddcb8340fd47a6fffcf3897820fad31004241639d6d2ea523e2c` |

### pine_sapling_small_variant_01

[Source asset page](https://polyhaven.com/a/pine_sapling_small) · [Files API](https://api.polyhaven.com/files/pine_sapling_small) · CC0-1.0 · extracted payload 9,571,633 bytes.

| Local file | Bytes | SHA-256 | Original source |
| --- | ---: | --- | --- |
| `assets/life/models/pine_sapling_small_variant_01/pine_sapling_small_variant_01_1k.gltf` | 6156 | `d1f42e078403e92ddf7d75b5058e64e91f19e889cb04446fbf84739be627b0e1` | Derived from [pine_sapling_small_1k.gltf](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/pine_sapling_small/pine_sapling_small_1k.gltf) |
| `assets/life/models/pine_sapling_small_variant_01/pine_sapling_small_variant_01.bin` | 5457376 | `e7849902101f8fc752a30dcba0b39f61fab18db6735ea6ff2811f3536ed48ba6` | Derived from [pine_sapling_small.bin](https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/pine_sapling_small/pine_sapling_small.bin) |
| `assets/life/models/pine_sapling_small_variant_01/textures/pine_sapling_small_bark_nor_gl_1k.jpg` | 1016849 | `05c46455531781b6cf18cae0648cf627f60ee942adaa8bcbfd1592fc2506a9e0` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_sapling_small/pine_sapling_small_bark_nor_gl_1k.jpg) |
| `assets/life/models/pine_sapling_small_variant_01/textures/pine_sapling_small_bark_diff_1k.jpg` | 725265 | `5c76836b01c3536fa0e24207b67bf4f3315b53ebe2b4ecc6f08dfcf3f8d74929` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_sapling_small/pine_sapling_small_bark_diff_1k.jpg) |
| `assets/life/models/pine_sapling_small_variant_01/textures/pine_sapling_small_bark_arm_1k.jpg` | 801278 | `336a4680cd571b6076b67afee2310b290b8900d9d126eb39ec1ae92e95be2ea9` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_sapling_small/pine_sapling_small_bark_arm_1k.jpg) |
| `assets/life/models/pine_sapling_small_variant_01/textures/pine_sapling_small_twig_nor_gl_1k.jpg` | 692711 | `76af87821d7ff00e25768d5d97a449394fe64a21ae55d099da7f5ed46d9098c8` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_sapling_small/pine_sapling_small_twig_nor_gl_1k.jpg) |
| `assets/life/models/pine_sapling_small_variant_01/textures/pine_sapling_small_twig_diff_1k.jpg` | 477942 | `54af7d6fb664b5a38bcb118b557bc50e01e86ec54d6f1a573c3e32c649a53362` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_sapling_small/pine_sapling_small_twig_diff_1k.jpg) |
| `assets/life/models/pine_sapling_small_variant_01/textures/pine_sapling_small_twig_arm_1k.jpg` | 394056 | `2eb0aa44124b5a4ae9401e00b23b3c916f4c3f421616ce1bb932f248fc061288` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_sapling_small/pine_sapling_small_twig_arm_1k.jpg) |

### potted_plant_01

[Asset page](https://polyhaven.com/a/potted_plant_01) · [Files API](https://api.polyhaven.com/files/potted_plant_01) · CC0-1.0 · 6,325,139 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/models/potted_plant_01/potted_plant_01_1k.gltf` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/potted_plant_01/potted_plant_01_1k.gltf) | 7969 | `23b30294407684b02f14800d6685bd8938da5d2111e17753ac8dd3c37d8c88a0` |
| `assets/life/models/potted_plant_01/textures/potted_plant_01_pot_rough_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/potted_plant_01/potted_plant_01_pot_rough_1k.jpg) | 173192 | `1256199fe3a88a0534bcd4c8bf141cfa9a28b68fce3f286193d0713796fd8561` |
| `assets/life/models/potted_plant_01/textures/potted_plant_01_leaves_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/potted_plant_01/potted_plant_01_leaves_nor_gl_1k.jpg) | 177105 | `2faa756e0ee2b8341c752b283b93599157bf56f4083a9f61b825cdfa0c7138ff` |
| `assets/life/models/potted_plant_01/textures/potted_plant_01_pot_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/potted_plant_01/potted_plant_01_pot_diff_1k.jpg) | 204900 | `51c9d80e8abe585bd3dbcebe7cba1d3ed1a22b137c7cb66baf0e462c08dca312` |
| `assets/life/models/potted_plant_01/potted_plant_01.bin` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/potted_plant_01/potted_plant_01.bin) | 5345188 | `a8dd1f7ce75f50dc25bbedc20809da02ee4193815c155b883a329925fa5548f7` |
| `assets/life/models/potted_plant_01/textures/potted_plant_01_leaves_rough_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/potted_plant_01/potted_plant_01_leaves_rough_1k.jpg) | 91706 | `765e3bd1bfdad39dd0d1cd755eafd1f9f1d46cbbb6013988cbfd1197de27a1f9` |
| `assets/life/models/potted_plant_01/textures/potted_plant_01_pot_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/potted_plant_01/potted_plant_01_pot_nor_gl_1k.jpg) | 200349 | `ec02e51751e0822d229d48bea1373b06e2675c3725ff04fd1f87ac516719e620` |
| `assets/life/models/potted_plant_01/textures/potted_plant_01_leaves_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/potted_plant_01/potted_plant_01_leaves_diff_1k.jpg) | 124730 | `b73891a0a606e139d0fcdd9e6fe503cd1210be3fc9c55fbd033941288231ccaa` |

### mid_century_lounge_chair

[Asset page](https://polyhaven.com/a/mid_century_lounge_chair) · [Files API](https://api.polyhaven.com/files/mid_century_lounge_chair) · CC0-1.0 · 2,087,019 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/models/mid_century_lounge_chair/mid_century_lounge_chair_1k.gltf` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/mid_century_lounge_chair/mid_century_lounge_chair_1k.gltf) | 2884 | `47c5769ee4dfa350e2506a6a76d8ef58a1e1060344acda35c503ddff46645d26` |
| `assets/life/models/mid_century_lounge_chair/textures/mid_century_lounge_chair_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/mid_century_lounge_chair/mid_century_lounge_chair_nor_gl_1k.jpg) | 648960 | `4bb4b325e4478f5d9063e4e061cf34bc6ccc3067abda608c1548c4a367f50397` |
| `assets/life/models/mid_century_lounge_chair/textures/mid_century_lounge_chair_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/mid_century_lounge_chair/mid_century_lounge_chair_diff_1k.jpg) | 627298 | `ae1f80e964426b49f70b402403c444a655bdaa363d8d43fee5b57fcb3b492c54` |
| `assets/life/models/mid_century_lounge_chair/textures/mid_century_lounge_chair_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/mid_century_lounge_chair/mid_century_lounge_chair_arm_1k.jpg) | 636493 | `9fa5fa4af5306576a3a27886767feec5431f41d94df9119f2ccced8f0b024f1a` |
| `assets/life/models/mid_century_lounge_chair/mid_century_lounge_chair.bin` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/mid_century_lounge_chair/mid_century_lounge_chair.bin) | 171384 | `26346cdc548ad74b1b6db5734c8c231c3c740656b012de2cc3bbc2b3b975200c` |

### desk_lamp_arm_01

[Asset page](https://polyhaven.com/a/desk_lamp_arm_01) · [Files API](https://api.polyhaven.com/files/desk_lamp_arm_01) · CC0-1.0 · 2,875,984 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/models/desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf) | 4453 | `2ac8389afc1519449a9cfdf7efd9fa36780a2177bb47ab58f7a7dda7d247dc8c` |
| `assets/life/models/desk_lamp_arm_01/textures/desk_lamp_arm_01_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/desk_lamp_arm_01/desk_lamp_arm_01_nor_gl_1k.jpg) | 651826 | `feefedc3835ecef3634e97a24977451671f8f57747a023f48cd14c84bc73513a` |
| `assets/life/models/desk_lamp_arm_01/textures/desk_lamp_arm_01_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/desk_lamp_arm_01/desk_lamp_arm_01_arm_1k.jpg) | 780379 | `206404c79fb7dcf8e2c4558c13544342f87d2190526231a1750c3c9adc256fbc` |
| `assets/life/models/desk_lamp_arm_01/textures/desk_lamp_arm_01_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/desk_lamp_arm_01/desk_lamp_arm_01_diff_1k.jpg) | 702522 | `159eb178aba3271bd555cbe07ca36431d8af9a006f0b8e9d8c67030cbdc9e4d3` |
| `assets/life/models/desk_lamp_arm_01/desk_lamp_arm_01.bin` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/desk_lamp_arm_01/desk_lamp_arm_01.bin) | 736804 | `07f34e32abecbaa63d28b9d12d6a0eb82b775a0f50c92327655909d72ff8489b` |

### rock_07

[Asset page](https://polyhaven.com/a/rock_07) · [Files API](https://api.polyhaven.com/files/rock_07) · CC0-1.0 · 2,184,088 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/models/rock_07/rock_07_1k.gltf` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/rock_07/rock_07_1k.gltf) | 2979 | `efcc2dcaa133ff8ad5c865dc2135772e8f5dbc83fa38db2ee2cf25382436b6e6` |
| `assets/life/models/rock_07/rock_07.bin` | [download](https://dl.polyhaven.org/file/ph-assets/Models/gltf/8k/rock_07/rock_07.bin) | 468936 | `e4a532a6d6cf4a08c288f501b790f32cba0528136a29959ce774c3cd39369e7e` |
| `assets/life/models/rock_07/textures/rock_07_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/rock_07/rock_07_arm_1k.jpg) | 309735 | `1ed76e9a8542c76bdc6b7b018720ae1f52cd75d9f5ae719f613de3f5032cf4da` |
| `assets/life/models/rock_07/textures/rock_07_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/rock_07/rock_07_diff_1k.jpg) | 635452 | `8ff1965aa1664cc4abcc0131c44ee2b97ab14d6e131d7a51429ff261eeb101c8` |
| `assets/life/models/rock_07/textures/rock_07_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/rock_07/rock_07_nor_gl_1k.jpg) | 766986 | `57cb2210951aeb376164fce5f7c65f03e5599def04873b56cad0f173c275d78d` |

### wood_floor

[Asset page](https://polyhaven.com/a/wood_floor) · [Files API](https://api.polyhaven.com/files/wood_floor) · CC0-1.0 · 2,133,405 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/textures/wood_floor_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor/wood_floor_arm_1k.jpg) | 447855 | `a84d9457fa35a76cf8a41da8bcef55387230c6b236819de878799585eda76059` |
| `assets/life/textures/wood_floor_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor/wood_floor_diff_1k.jpg) | 734493 | `2a1c07687b6dbb214c4b9213739c6d92d425f1f0fc8ab3ac157f105d78240789` |
| `assets/life/textures/wood_floor_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor/wood_floor_nor_gl_1k.jpg) | 423303 | `452247f0d0d1b7fc7f8324ff3b6ed60bcc6de1405f4284eeb8d9bce90d4939c2` |
| `assets/life/textures/wood_floor_rough_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/wood_floor/wood_floor_rough_1k.jpg) | 527754 | `061f1e1293251b2d28c76e3fac1ea9452b0e8648bb8f9b3728e09db386166e5c` |

### brown_mud

[Asset page](https://polyhaven.com/a/brown_mud) · [Files API](https://api.polyhaven.com/files/brown_mud) · CC0-1.0 · 2,078,981 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/textures/brown_mud_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud/brown_mud_diff_1k.jpg) | 501955 | `df3f135c899f10a3b018738343b222cbc67d13e7c76c5d8da834a3d34c984417` |
| `assets/life/textures/brown_mud_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud/brown_mud_nor_gl_1k.jpg) | 1011780 | `ac517ca39eb507ae0f27e2b3db431c60888f9b5c3c52bec49d2c0775da0920cb` |
| `assets/life/textures/brown_mud_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud/brown_mud_arm_1k.jpg) | 224431 | `40a5ac438f23ea454ff45f3f62f0fe4ac5b89c42fd070d10e7d41c51252caf88` |
| `assets/life/textures/brown_mud_rough_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud/brown_mud_rough_1k.jpg) | 340815 | `ae9fb57c1173ccb4579f40edf8321a30bdca815042ffd72015a2a707c7e2e7ba` |

### fabric_pattern_07

[Asset page](https://polyhaven.com/a/fabric_pattern_07) · [Files API](https://api.polyhaven.com/files/fabric_pattern_07) · CC0-1.0 · 3,984,334 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/textures/fabric_pattern_07_col_2_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_07/fabric_pattern_07_col_2_1k.jpg) | 887747 | `cded7066e78b8060e4fe4fe382f854739dc8d6f42da6ec99edc0a4ef811b5093` |
| `assets/life/textures/fabric_pattern_07_col_1_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_07/fabric_pattern_07_col_1_1k.jpg) | 788593 | `aeb7a1487b77aec55e39de662def4d371f5c7c617f62d1f291d7f9932ffebdc9` |
| `assets/life/textures/fabric_pattern_07_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_07/fabric_pattern_07_nor_gl_1k.jpg) | 828071 | `f6955bbdead9f023f2357f6f8808ed49627d10882cd2a3cb6b5a5ace155abc45` |
| `assets/life/textures/fabric_pattern_07_col_03_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_07/fabric_pattern_07_col_03_1k.jpg) | 764120 | `0f8568df8535ec73a528235e773fd9931942dd6efabb6a50b473a5e78231ea5f` |
| `assets/life/textures/fabric_pattern_07_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_07/fabric_pattern_07_arm_1k.jpg) | 227059 | `57520f1383a41ea9d69a3f9c1d2a2b0cdc6ba85c579935c44a1281845ec11030` |
| `assets/life/textures/fabric_pattern_07_rough_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_07/fabric_pattern_07_rough_1k.jpg) | 488744 | `3d90ac40b5c32a15649cc8525b7eeed133ea46b63a0e3eae5e34911d5c967e3a` |

### brushed_concrete

[Asset page](https://polyhaven.com/a/brushed_concrete) · [Files API](https://api.polyhaven.com/files/brushed_concrete) · CC0-1.0 · 3,182,191 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/textures/brushed_concrete_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brushed_concrete/brushed_concrete_diff_1k.jpg) | 847278 | `4054ed6eb65cd063356ffb4a88706b7d7b78c5435051c48bf0ee64290f04bc8c` |
| `assets/life/textures/brushed_concrete_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brushed_concrete/brushed_concrete_nor_gl_1k.jpg) | 849228 | `f4953a881f34627cefcc22f780d392314635e31bb41f75cf3888a5af55c21820` |
| `assets/life/textures/brushed_concrete_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brushed_concrete/brushed_concrete_arm_1k.jpg) | 783702 | `374e4408acfb0bb4512f904f6fd3ae1006195ed12f2e258625b5b8b3a91f6528` |
| `assets/life/textures/brushed_concrete_rough_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brushed_concrete/brushed_concrete_rough_1k.jpg) | 701983 | `24da5e4c3d17b7db1b4764b3cd1fd5c5680c27ef2c86e0d6a312f74d2d0599bd` |

### rusty_metal_03

[Asset page](https://polyhaven.com/a/rusty_metal_03) · [Files API](https://api.polyhaven.com/files/rusty_metal_03) · CC0-1.0 · 2,324,371 bytes total.

| Local path | Exact download source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/life/textures/rusty_metal_03_diff_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rusty_metal_03/rusty_metal_03_diff_1k.jpg) | 781056 | `6bb9ede80978c6c679cef3babec452157f3638c6a90526db617644e06ba1c068` |
| `assets/life/textures/rusty_metal_03_nor_gl_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rusty_metal_03/rusty_metal_03_nor_gl_1k.jpg) | 582177 | `9c9bb22e4e432e8460bcc3157c76b2a3072e7faa64ed8fe4bc213e8f2175c126` |
| `assets/life/textures/rusty_metal_03_arm_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rusty_metal_03/rusty_metal_03_arm_1k.jpg) | 554579 | `569728a44e2a8ded497596fd0b3c0548d9f9a48a8de92c58baf7f94ad5dd1bdd` |
| `assets/life/textures/rusty_metal_03_rough_1k.jpg` | [download](https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rusty_metal_03/rusty_metal_03_rough_1k.jpg) | 406559 | `f8c33af71fcd8bf6325517022bd6b703e76550cff5047df4e7a6a662c389c77a` |
