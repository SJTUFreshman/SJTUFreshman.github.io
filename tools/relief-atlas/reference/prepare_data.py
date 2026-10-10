import argparse
import concurrent.futures
import json
import math
from pathlib import Path
import threading
import time
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image
import pyproj
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling
import requests
import shapely
from shapely.geometry import box, mapping, shape
from shapely.ops import transform as transform_geometry
from shapely.ops import polygonize
from shapely.geometry import LineString


ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"
DATA = ROOT / "data"
TILE_BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"
NATIONAL_URL = "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"
FUJIAN_URL = "https://geo.datav.aliyun.com/areas_v3/bound/350000_full.json"
TAIWAN_API = "https://www.geoboundaries.org/api/current/gbOpen/TWN/ADM1/"
YANGSHAN_OSM_URL = "https://api.openstreetmap.org/api/0.6/map?bbox=121.96,30.58,122.15,30.66"
WEB_MERCATOR_HALF = 20037508.342789244
THREAD_LOCAL = threading.local()
TAIWAN_NAMES = {
    "Hsinchu County": "新竹县", "Miaoli County": "苗栗县", "Matsu Islands": "连江县",
    "Kinmen": "金门县", "Chiayi County": "嘉义县", "Yilan County": "宜兰县",
    "Nantou County": "南投县", "Changhua County": "彰化县", "Pingtung County": "屏东县",
    "Taitung County": "台东县", "Hualien County": "花莲县", "Penghu": "澎湖县",
    "Yunlin County": "云林县", "Chiayi": "嘉义市", "Hsinchu": "新竹市", "Keelung": "基隆市",
    "Taichung": "台中市", "Taoyuan": "桃园市", "New Taipei": "新北市", "Tainan": "台南市",
    "Taipei": "台北市", "Kaohsiung": "高雄市",
}
CONFIGS = {
    "hainan": {"bounds": [108.45, 17.95, 111.45, 21.8], "zoom": 10, "lat0": 20},
    "shengsi": {"bounds": [121.95, 30.48, 123.00, 30.97], "zoom": 12, "lat0": 30.7},
    "china": {"bounds": [73, 18, 135.2, 53.7], "zoom": 7},
    "fujian_taiwan": {"bounds": [115.7, 21.8, 122.25, 28.45], "zoom": 10, "lat0": 25},
}


def session():
    if not hasattr(THREAD_LOCAL, "session"):
        THREAD_LOCAL.session = requests.Session()
        THREAD_LOCAL.session.headers["User-Agent"] = "ReliefAtlasStudy/1.0"
    return THREAD_LOCAL.session


def cached_download(url, destination):
    destination = Path(destination)
    if destination.exists() and destination.stat().st_size:
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(5):
        try:
            response = session().get(url, timeout=(15, 80))
            response.raise_for_status()
            temporary = destination.with_suffix(destination.suffix + ".partial")
            temporary.write_bytes(response.content)
            temporary.replace(destination)
            return destination
        except requests.RequestException:
            if attempt == 4:
                raise
            time.sleep(1.5 * (attempt + 1))


def load_json(url, filename):
    return json.loads(cached_download(url, CACHE / filename).read_text(encoding="utf-8"))


def tile_coordinates(longitude, latitude, zoom):
    count = 2 ** zoom
    tile_x = (longitude + 180) / 360 * count
    tile_y = (1 - math.asinh(math.tan(math.radians(latitude))) / math.pi) / 2 * count
    return tile_x, tile_y


def download_tile(tile):
    zoom, tile_x, tile_y = tile
    filename = CACHE / "terrarium" / str(zoom) / str(tile_x) / f"{tile_y}.png"
    path = cached_download(f"{TILE_BASE}/{zoom}/{tile_x}/{tile_y}.png", filename)
    with Image.open(path) as image:
        pixels = np.asarray(image.convert("RGB"), dtype=np.float32)
    elevation = pixels[:, :, 0] * 256 + pixels[:, :, 1] + pixels[:, :, 2] / 256 - 32768
    return tile_x, tile_y, elevation


def dem_mosaic(bounds, zoom):
    west, south, east, north = bounds
    left, top = tile_coordinates(west, north, zoom)
    right, bottom = tile_coordinates(east, south, zoom)
    first_x, first_y = math.floor(left), math.floor(top)
    last_x, last_y = math.floor(right), math.floor(bottom)
    tile_list = [(zoom, tile_x, tile_y) for tile_y in range(first_y, last_y + 1)
                 for tile_x in range(first_x, last_x + 1)]
    print(f"DEM z{zoom}: {len(tile_list)} tiles ({last_x-first_x+1} x {last_y-first_y+1})", flush=True)
    mosaic = np.empty(((last_y-first_y+1)*256, (last_x-first_x+1)*256), dtype=np.float32)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(download_tile, tile) for tile in tile_list]
        for completed, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            tile_x, tile_y, elevation = future.result()
            column, row = (tile_x-first_x)*256, (tile_y-first_y)*256
            mosaic[row:row+256, column:column+256] = elevation
            if completed % 40 == 0 or completed == len(tile_list):
                print(f"  tiles ready: {completed}/{len(tile_list)}", flush=True)
    tile_size = WEB_MERCATOR_HALF * 2 / 2 ** zoom
    source_bounds = [-WEB_MERCATOR_HALF + first_x*tile_size,
                     WEB_MERCATOR_HALF - (last_y+1)*tile_size,
                     -WEB_MERCATOR_HALF + (last_x+1)*tile_size,
                     WEB_MERCATOR_HALF - first_y*tile_size]
    source_transform = from_bounds(*source_bounds, mosaic.shape[1], mosaic.shape[0])
    return mosaic, source_transform, len(tile_list)


def region_features(identifier, national, fujian, taiwan):
    if identifier == "china":
        return [(str(feature["properties"]["name"]), feature) for feature in national["features"]
                if isinstance(feature["properties"].get("adcode"), int)]
    if identifier == "fujian_taiwan":
        features = [(feature["properties"]["name"], feature) for feature in fujian["features"]]
        if taiwan:
            features.extend([(TAIWAN_NAMES.get(feature["properties"].get("shapeName"), feature["properties"].get("shapeName", "台湾")), feature)
                             for feature in taiwan["features"]])
        else:
            features.extend([("台湾", feature) for feature in national["features"]
                             if feature["properties"].get("adcode") == 710000])
        return features
    return []


def yangshan_land():
    filename = CACHE / "yangshan_osm_land.geojson"
    if not filename.exists():
        source = cached_download(YANGSHAN_OSM_URL, CACHE / "yangshan_osm_map.xml")
        root = ET.fromstring(source.read_bytes())
        nodes = {node.get("id"): (float(node.get("lon")), float(node.get("lat")))
                 for node in root.findall("node")}
        lines = []
        for way in root.findall("way"):
            tags = {tag.get("k"): tag.get("v") for tag in way.findall("tag")}
            if tags.get("natural") != "coastline":
                continue
            coordinates = [nodes[node.get("ref")] for node in way.findall("nd")]
            lines.append(LineString(coordinates))
        polygons = list(polygonize(lines))
        collection = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"source": "OpenStreetMap natural=coastline",
             "license": "ODbL 1.0"}, "geometry": mapping(polygon)} for polygon in polygons]}
        filename.write_text(json.dumps(collection), encoding="utf-8")
    return json.loads(filename.read_text(encoding="utf-8"))


def prepare(identifier, national, fujian, taiwan, max_size):
    config = CONFIGS[identifier]
    bounds = config["bounds"]
    west, south, east, north = bounds
    if identifier == "china":
        projection = "+proj=aea +lat_1=25 +lat_2=47 +lat_0=35 +lon_0=105 +datum=WGS84 +units=m +no_defs"
    else:
        projection = f"+proj=eqc +lat_ts={config['lat0']} +lat_0={config['lat0']} +lon_0={(west+east)/2} +datum=WGS84 +units=m +no_defs"
    transformer = pyproj.Transformer.from_crs("EPSG:4326", projection, always_xy=True)
    longitude_samples = np.concatenate([np.linspace(west, east, 200), np.linspace(west, east, 200),
                                        np.full(200, west), np.full(200, east)])
    latitude_samples = np.concatenate([np.full(200, south), np.full(200, north),
                                       np.linspace(south, north, 200), np.linspace(south, north, 200)])
    projected_x, projected_y = transformer.transform(longitude_samples, latitude_samples)
    projected_bounds = [min(projected_x), min(projected_y), max(projected_x), max(projected_y)]
    geographic_clip = box(west, south, east, north)
    named_features = region_features(identifier, national, fujian, taiwan)
    projected_features = []
    labels = []
    for region_id, (name, feature) in enumerate(named_features, start=1):
        geometry = shapely.make_valid(shape(feature["geometry"])).intersection(geographic_clip)
        if geometry.is_empty:
            continue
        projected_geometry = transform_geometry(transformer.transform, geometry)
        projected_features.append((projected_geometry, region_id))
        representative = projected_geometry.representative_point()
        inverse = pyproj.Transformer.from_crs(projection, "EPSG:4326", always_xy=True)
        label_lon, label_lat = inverse.transform(representative.x, representative.y)
        labels.append({"region": region_id, "name": name, "x_km": representative.x/1000,
                       "y_km": representative.y/1000, "lon": label_lon, "lat": label_lat})
    if identifier == "china":
        projected_bounds = [min(geometry.bounds[0] for geometry, unused in projected_features),
                            min(geometry.bounds[1] for geometry, unused in projected_features),
                            max(geometry.bounds[2] for geometry, unused in projected_features),
                            max(geometry.bounds[3] for geometry, unused in projected_features)]
    min_x, min_y, max_x, max_y = projected_bounds
    pixel_size = max(max_x-min_x, max_y-min_y) / max_size
    width = int(math.ceil((max_x-min_x) / pixel_size))
    height = int(math.ceil((max_y-min_y) / pixel_size))
    max_x, min_y = min_x + width*pixel_size, max_y - height*pixel_size
    projected_bounds = [min_x, min_y, max_x, max_y]
    target_transform = from_bounds(*projected_bounds, width, height)
    mosaic, source_transform, tile_count = dem_mosaic(bounds, config["zoom"])
    elevation = np.zeros((height, width), dtype=np.float32)
    reproject(mosaic, elevation, src_transform=source_transform, src_crs="EPSG:3857",
              dst_transform=target_transform, dst_crs=projection,
              resampling=Resampling.bilinear, num_threads=4)
    del mosaic
    if projected_features:
        region = rasterize([(mapping(geometry), region_id) for geometry, region_id in projected_features],
                           out_shape=(height, width), transform=target_transform, fill=0, dtype="int16")
        mask = region > 0
    else:
        mask = elevation > 0.75
        region = mask.astype(np.int16)
    supplemental_land_pixels = 0
    if identifier == "shengsi":
        coastline = yangshan_land()
        coastal_geometries = [transform_geometry(transformer.transform, shape(feature["geometry"]))
                             for feature in coastline["features"]]
        coastal_mask = rasterize([(mapping(geometry), 1) for geometry in coastal_geometries],
                                out_shape=(height, width), transform=target_transform,
                                fill=0, dtype="uint8").astype(bool)
        supplemental_land = coastal_mask & ~mask
        supplemental_land_pixels = int(supplemental_land.sum())
        elevation[supplemental_land] = 1.5
        mask |= coastal_mask
        region = mask.astype(np.int16)
        north_coastline_path = CACHE / "sijiao_north_osm_land.geojson"
        north_artifact_removed_pixels = 0
        if north_coastline_path.exists():
            north_coastline = json.loads(north_coastline_path.read_text(encoding="utf-8"))
            north_geometries = [transform_geometry(transformer.transform, shape(feature["geometry"]))
                                for feature in north_coastline["features"]]
            north_land = rasterize([(mapping(geometry), 1) for geometry in north_geometries],
                                   out_shape=(height, width), transform=target_transform,
                                   fill=0, dtype="uint8").astype(bool)
            north_window = transform_geometry(transformer.transform, box(122.38, 30.748, 122.50, 30.80))
            correction_window = rasterize([(mapping(north_window), 1)], out_shape=(height, width),
                                          transform=target_transform, fill=0, dtype="uint8").astype(bool)
            artifacts = correction_window & mask & ~north_land
            north_artifact_removed_pixels = int(artifacts.sum())
            mask[artifacts] = False
            region = mask.astype(np.int16)
    elevation[~mask] = 0
    x_coordinates = (min_x + (np.arange(width)+0.5)*pixel_size) / 1000
    y_coordinates = (max_y - (np.arange(height)+0.5)*pixel_size) / 1000
    DATA.mkdir(exist_ok=True)
    np.savez_compressed(DATA / f"{identifier}.npz", elevation=elevation, mask=mask, region=region,
                        x=x_coordinates, y=y_coordinates)
    metadata = {
        "id": identifier,
        "bounds": bounds,
        "projection": projection,
        "crs_wkt": pyproj.CRS.from_user_input(projection).to_wkt(),
        "extent_km": [coordinate/1000 for coordinate in projected_bounds],
        "shape": [height, width],
        "pixel_size_m": pixel_size,
        "elevation_units": "m above DEM vertical reference; negative inland elevations preserved",
        "coordinate_units": "km; pixel centers; x increases east, y decreases from north to south",
        "geo_to_xy": "pyproj.Transformer.from_crs('EPSG:4326', projection, always_xy=True).transform(lon, lat), then divide both coordinates by 1000",
        "zoom": config["zoom"],
        "tile_count": tile_count,
        "region_names": {str(index): name for index, (name, unused) in enumerate(named_features, start=1)} if named_features else {"1": "陆地"},
        "region_labels": labels,
        "land_pixels": int(mask.sum()),
        "elevation_range_land_m": [float(elevation[mask].min()), float(elevation[mask].max())],
        "mask_source": ("Terrarium elevation > 0.75 m plus actual OSM Yangshan coastline polygons"
                        if identifier == "shengsi" else "administrative polygons"
                        if named_features else "Terrarium elevation > 0.75 m"),
        "dem_source": TILE_BASE,
        "geographic_coordinates": "EPSG:4326; DataV coordinates treated as lon/lat without datum correction",
    }
    if identifier == "shengsi":
        metadata["supplemental_coastline"] = {
            "url": YANGSHAN_OSM_URL, "cache": "cache/yangshan_osm_land.geojson",
            "attribution": "© OpenStreetMap contributors; ODbL 1.0",
            "retrieved": "2026-10-08", "supplemental_land_pixels": supplemental_land_pixels,
            "supplemental_elevation_m": 1.5,
            "method": "Only closed polygons formed by natural=coastline ways; original DEM retained where its land mask was valid.",
            "limitation": "1.5 m on reclaimed areas is a display elevation, not a measured elevation; coastline is mapped by OpenStreetMap contributors.",
            "rejected_source": "DataV 330922 county polygon contains a maritime corridor and was rejected as a land mask."
        }
        metadata["north_coastline_correction"] = {
            "url": "https://api.openstreetmap.org/api/0.6/map?bbox=122.38,30.73,122.50,30.80",
            "cache": "cache/sijiao_north_osm_land.geojson", "attribution": "© OpenStreetMap contributors; ODbL 1.0",
            "window": [122.38, 30.748, 122.50, 30.80], "removed_pixels": north_artifact_removed_pixels,
            "method": "Intersect existing land mask with actual closed OSM coastlines inside the correction window; only removes false DEM land and never adds land.",
            "reason": "Terrarium DEM contains large circular positive-elevation artefacts around northern islands which extend beyond mapped coastlines."
        }
    (DATA / f"{identifier}.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"READY {identifier}: {width}x{height}, {pixel_size:.1f} m, land={mask.mean():.3f}, elevation={metadata['elevation_range_land_m']}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--regions", nargs="+", default=list(CONFIGS))
    parser.add_argument("--max-size", type=int, default=2300)
    arguments = parser.parse_args()
    national = load_json(NATIONAL_URL, "china_admin1.json")
    fujian = load_json(FUJIAN_URL, "fujian_admin2.json")
    taiwan = None
    taiwan_metadata = None
    try:
        taiwan_metadata = load_json(TAIWAN_API, "taiwan_geoboundaries_metadata.json")
        taiwan = load_json(taiwan_metadata["gjDownloadURL"], "taiwan_admin1.geojson")
        print(f"Taiwan actual administrative units: {len(taiwan['features'])}", flush=True)
    except Exception as error:
        print(f"Taiwan subdivisions unavailable, using single authentic outline: {error}", flush=True)
    for identifier in arguments.regions:
        print(f"Preparing {identifier}", flush=True)
        prepare(identifier, national, fujian, taiwan, arguments.max_size)
    notes = {
        "created": "2026-10-08",
        "purpose": "Real-elevation relief-map art study, not an official or navigational map.",
        "dem": {"provider": "AWS elevation-tiles-prod / Mapzen Terrarium", "url": TILE_BASE,
                "encoding": "R*256 + G + B/256 - 32768 metres", "resampling": "bilinear",
                "attribution": "Mapzen terrain tiles; underlying elevation providers include SRTM, GMTED and other public elevation sources; see https://github.com/tilezen/joerd/blob/master/docs/attribution.md"},
        "boundaries": [
            {"source": "Alibaba DataV China province boundaries", "url": NATIONAL_URL, "cache": "cache/china_admin1.json"},
            {"source": "Alibaba DataV Fujian prefecture boundaries", "url": FUJIAN_URL, "cache": "cache/fujian_admin2.json"},
            {"source": "geoBoundaries Taiwan ADM1", "url": taiwan_metadata.get("gjDownloadURL") if taiwan_metadata else None,
             "cache": "cache/taiwan_admin1.geojson", "metadata": taiwan_metadata,
             "status": "actual subdivisions" if taiwan else "unavailable, single Taiwan outline used"},
            {"source": "OpenStreetMap natural=coastline, Yangshan port and nearby islands", "url": YANGSHAN_OSM_URL,
             "cache": "cache/yangshan_osm_land.geojson", "license": "ODbL 1.0", "attribution": "© OpenStreetMap contributors"}
        ],
        "limitations": [
            "Boundary data are third-party general-purpose visualisation vectors, not authoritative standard-map approval data.",
            "DataV longitude/latitude are used without datum correction; local registration uncertainty can reach several hundred metres.",
            "National map extent is 73–135.2°E, 18–53.7°N; southern offshore island groups require a separate inset.",
            "National province mask preserves negative inland elevations; ocean pixels outside the mask are set to zero.",
            "Hainan and most of Shengsi use elevation > 0.75 m; tidal flats and very low islands can be omitted. Yangshan uses supplemental real OSM coastlines for reclaimed lowlands, assigned a 1.5 m display elevation rather than a measured height.",
            "Source tiles are sampled onto finite-resolution grids, with maximum dimension 2300 pixels; no synthetic mountain noise is introduced.",
            "Terrain is subsequently vertically exaggerated for visualisation by the Blender renderer."
        ]
    }
    (ROOT / "data_notes.json").write_text(json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8")
    make_quicklook()


def make_quicklook():
    canvas = Image.new("RGB", (1200, 1200), "#eeeade")
    for index, identifier in enumerate(["shengsi", "china", "hainan", "fujian_taiwan"]):
        path = DATA / f"{identifier}.npz"
        if not path.exists():
            continue
        with np.load(path) as arrays:
            elevation = arrays["elevation"]
            mask = arrays["mask"]
            gradient_y, gradient_x = np.gradient(elevation)
            slope = np.clip(0.67+(gradient_y-gradient_x)*0.012, 0.15, 1)
            colors = np.stack([slope*0.92, slope*0.90, slope*0.77], axis=-1)
            colors[~mask] = [0.64, 0.76, 0.79]
            image = Image.fromarray(np.uint8(np.clip(colors, 0, 1)*255))
            image.thumbnail((570, 570))
            canvas.paste(image, (index % 2*600+15, index // 2*600+15))
    canvas.save(DATA / "data_quicklook.png")


if __name__ == "__main__":
    main()
