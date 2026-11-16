"""Restore the two pinned 10 m Copernicus true-colour island crops.

Requires rasterio (with HTTPS/COG support), pyproj and numpy. Only source pixels
inside the recorded WGS84 bounding box are downloaded; full scenes are not saved.
"""
import json
from pathlib import Path
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

ROOT=Path(__file__).resolve().parents[1]/'tools/relief-atlas/regions'
for name in ('dongsha','taiping'):
    metadata=json.loads((ROOT/f'{name}-sentinel.json').read_text(encoding='utf-8'))
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR'):
        with rasterio.open(metadata['source']) as source:
            bounds=transform_bounds('EPSG:4326',source.crs,*metadata['bbox'])
            window=from_bounds(*bounds,source.transform).round_offsets().round_lengths()
            assert window.col_off>=0 and window.row_off>=0
            assert window.col_off+window.width<=source.width and window.row_off+window.height<=source.height
            pixels=source.read(window=window)
            profile=source.profile.copy()
            profile.update(width=pixels.shape[2],height=pixels.shape[1],transform=source.window_transform(window),compress='deflate')
            with rasterio.open(ROOT/f'{name}-sentinel.tif','w',**profile) as output:output.write(pixels)
            print(name,metadata['id'],pixels.shape)
