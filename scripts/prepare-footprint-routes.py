"""Prepare network-routed footprint journeys and split them at province borders."""

from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import time
from typing import Any, Iterable
from urllib.request import Request, urlopen
from urllib.parse import urlencode

import requests

from shapely.geometry import GeometryCollection, LineString, MultiLineString, Point, shape
from shapely.validation import make_valid


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROVINCE_PATH = ROOT / "assets" / "maps" / "china_100000_full.json"
REFERENCE = ROOT / "tools" / "relief-atlas" / "reference"
DEFAULT_COLOUR_SOURCE = REFERENCE / "render_atlas.py"
DEFAULT_NAMES_SOURCE = REFERENCE / "data" / "china.json"
DEFAULT_OUTPUT = ROOT / "assets" / "maps" / "footprint-journeys.json"
DEFAULT_CACHE = ROOT / ".render-work" / "footprints" / "cache" / "china-route-segments.json"
ROAD_CACHE = DEFAULT_CACHE.parent / "road-routes.json"
RAIL_CACHE = DEFAULT_CACHE.parent / "actual-rail-routes.json"
OSRM_BASE = "https://router.project-osrm.org/route/v1/driving/"
BROUTER_BASE = "https://brouter.de/brouter"
RAIL_PROFILE = """---context:global
assign downhillcost 0
assign uphillcost 0
---context:way
assign turncost 0
assign initialcost 0
assign costfactor switch railway=rail 1 100000
---context:node
assign initialcost 0
"""
RAIL_STATIONS = {
    "北京": (116.4270, 39.9045), "天津": (117.2163, 39.1353),
    "德州": (116.2825, 37.4510), "济南": (116.9907, 36.6705),
    "泰安": (117.1165, 36.1890), "兖州": (116.8442, 35.5563),
    "徐州": (117.2045, 34.2695), "蚌埠": (117.3840, 32.9410),
    "南京": (118.7970, 32.0860), "镇江": (119.4260, 32.1990),
    "常州": (119.9750, 31.7800), "无锡": (120.3020, 31.5890),
    "苏州": (120.6060, 31.3250), "上海": (121.4550, 31.2500),
    "青岛": (120.3130, 36.0630), "潍坊": (119.1040, 36.6950),
    "淄博": (118.0470, 36.7930), "保定": (115.4700, 38.8720),
    "石家庄": (114.4840, 38.0120), "邯郸": (114.4820, 36.6020),
    "安阳": (114.3450, 36.1100), "郑州": (113.6580, 34.7470),
    "洛阳": (112.4310, 34.6840), "三门峡": (111.2390, 34.7610),
    "渭南": (109.4930, 34.4820), "西安": (108.9500, 34.2770),
    "咸阳": (108.7440, 34.3350), "宝鸡": (107.1530, 34.3570),
    "天水": (105.9000, 34.3790), "定西": (104.6240, 35.5930),
    "兰州": (103.8560, 36.0340), "陇南": (104.9550, 33.3730),
    "广元": (105.8180, 32.4560), "绵阳": (104.7240, 31.4590),
    "成都": (104.0730, 30.6970), "资阳": (104.6510, 30.1290),
    "内江": (105.0390, 29.5820), "隆昌": (105.2890, 29.3460),
    "重庆": (106.5480, 29.5520),
}

PALETTE = json.loads((REFERENCE.parent / "footprints-style.json").read_text(encoding="utf-8"))["palette"]


def point(name: str, longitude: float, latitude: float) -> dict[str, Any]:
    return {"name": name, "coordinate": [round(longitude, 6), round(latitude, 6)]}


def names(en: str, simplified: str, traditional: str) -> dict[str, str]:
    return {"en": en, "zh-CN": simplified, "zh-TW": traditional}


def route(
    identifier: str,
    title: dict[str, str],
    kind: str,
    waypoints: Iterable[dict[str, Any]],
    schematic: bool = False,
    note: dict[str, str] | None = None,
) -> dict[str, Any]:
    waypoint_list = list(waypoints)
    coordinates = [item["coordinate"] for item in waypoint_list]
    result: dict[str, Any] = {
        "id": identifier,
        "name": title,
        "kind": kind,
        "waypoints": waypoint_list,
        "geometry": {"type": "LineString", "coordinates": coordinates},
    }
    if schematic:
        result["schematic"] = True
    if note:
        result["note"] = note
    return result


def build_routes() -> list[dict[str, Any]]:
    beijing = point("北京", 116.405285, 39.904989)
    tianjin = point("天津", 117.190182, 39.125596)
    dezhou = point("德州", 116.357464, 37.434093)
    jinan = point("济南", 117.120128, 36.651296)
    taian = point("泰安", 117.129063, 36.194968)
    yanzhou = point("兖州", 116.783834, 35.553144)
    xuzhou = point("徐州", 117.184811, 34.261792)
    bengbu = point("蚌埠", 117.389719, 32.916287)
    nanjing = point("南京", 118.796877, 32.060255)
    zhenjiang = point("镇江", 119.452753, 32.204402)
    changzhou = point("常州", 119.974654, 31.810689)
    wuxi = point("无锡", 120.31191, 31.49117)
    suzhou = point("苏州", 120.585315, 31.298886)
    shanghai = point("上海", 121.473701, 31.230416)

    routes = [
        route(
            "beijing-shanghai-rail",
            names("Beijing–Shanghai railway", "京沪铁路", "京滬鐵路"),
            "rail",
            [beijing, tianjin, dezhou, jinan, taian, yanzhou, xuzhou, bengbu, nanjing, zhenjiang, changzhou, wuxi, suzhou, shanghai],
        ),
        route(
            "qingdao-beijing-rail",
            names("Qingdao–Beijing railway", "青岛—北京铁路", "青島—北京鐵路"),
            "rail",
            [
                point("青岛", 120.38264, 36.067082),
                point("潍坊", 119.161755, 36.706774),
                point("淄博", 118.054927, 36.813487),
                jinan,
                dezhou,
                tianjin,
                beijing,
            ],
            note=names(
                "Follows the Shandong corridor; no direct line is drawn across Bohai Bay.",
                "沿山东陆上通道行进，不跨渤海直连。",
                "沿山東陸上通道行進，不跨渤海直連。",
            ),
        ),
        route(
            "beijing-xian-rail",
            names("Beijing–Xi'an railway", "北京—西安铁路", "北京—西安鐵路"),
            "rail",
            [
                beijing,
                point("保定", 115.464806, 38.873891),
                point("石家庄", 114.514976, 38.042007),
                point("邯郸", 114.538962, 36.625657),
                point("安阳", 114.392392, 36.097577),
                point("郑州", 113.625368, 34.7466),
                point("洛阳", 112.434468, 34.663041),
                point("三门峡", 111.200135, 34.772493),
                point("渭南", 109.509786, 34.499995),
                point("西安", 108.939621, 34.343147),
            ],
            note=names(
                "Schematic Zhengzhou–Luoyang corridor; it does not route through Yulin.",
                "采用郑州—洛阳一线的示意走向，不绕行榆林。",
                "採用鄭州—洛陽一線的示意走向，不繞行榆林。",
            ),
        ),
        route(
            "xian-lanzhou-rail",
            names("Xi'an–Lanzhou railway", "西安—兰州铁路", "西安—蘭州鐵路"),
            "rail",
            [
                point("西安", 108.939621, 34.343147),
                point("咸阳", 108.705117, 34.333439),
                point("宝鸡", 107.237974, 34.361979),
                point("天水", 105.724998, 34.581445),
                point("定西", 104.626282, 35.579578),
                point("兰州", 103.834303, 36.061089),
            ],
        ),
        route(
            "lanzhou-chengdu-rail",
            names("Lanzhou–Chengdu railway", "兰州—成都铁路", "蘭州—成都鐵路"),
            "rail",
            [
                point("兰州", 103.834303, 36.061089),
                point("陇南", 104.921841, 33.400684),
                point("广元", 105.843357, 32.435435),
                point("绵阳", 104.679114, 31.46745),
                point("成都", 104.066541, 30.572269),
            ],
            note=names(
                "Schematic Lanzhou–Longnan–Guangyuan alignment toward Chengdu.",
                "采用兰州—陇南—广元—成都的示意走向。",
                "採用蘭州—隴南—廣元—成都的示意走向。",
            ),
        ),
        route(
            "chengdu-chongqing-rail",
            names("Chengdu–Chongqing railway", "成渝铁路", "成渝鐵路"),
            "rail",
            [
                point("成都", 104.066541, 30.572269),
                point("资阳", 104.627636, 30.128901),
                point("内江", 105.058433, 29.580228),
                point("隆昌", 105.28763, 29.339187),
                point("重庆", 106.551556, 29.563009),
            ],
        ),
        route(
            "mudanjiang-beijing-road",
            names("Mudanjiang–Beijing road journey", "牡丹江—北京自驾线", "牡丹江—北京自駕線"),
            "road",
            [
                point("牡丹江", 129.633169, 44.551653),
                point("吉林", 126.549572, 43.837883),
                point("沈阳", 123.431474, 41.805698),
                point("锦州", 121.127004, 41.095119),
                point("秦皇岛", 119.600492, 39.935385),
                beijing,
            ],
        ),
        route(
            "beijing-zhangjiakou-road",
            names("Beijing–Zhangjiakou–Yulin road journey", "北京—张家口—榆林自驾线", "北京—張家口—榆林自駕線"),
            "road",
            [
                beijing,
                point("承德", 117.96241, 40.954071),
                point("赤峰", 118.886856, 42.257817),
                point("张家口", 114.887543, 40.824418),
                point("榆林", 109.734589, 38.28539),
            ],
            schematic=True,
            note=names(
                "The order and intermediate roads are reconstructed from the travel description.",
                "顺序及中间道路根据叙述整理，属于示意路线。",
                "順序及中間道路根據敘述整理，屬於示意路線。",
            ),
        ),
        route(
            "yulin-xian-road",
            names("Yulin–Xi'an road journey", "榆林—西安自驾线", "榆林—西安自駕線"),
            "road",
            [
                point("榆林", 109.734589, 38.28539),
                point("延安", 109.489727, 36.585455),
                point("吕梁", 111.144319, 37.518314),
                point("临汾", 111.518976, 36.088005),
                point("咸阳", 108.705117, 34.333439),
                point("西安", 108.939621, 34.343147),
            ],
            schematic=True,
            note=names(
                "Luliang and Linfen are retained as approximate intermediate waypoints.",
                "保留吕梁、临汾作为近似中间途经点。",
                "保留呂梁、臨汾作為近似中間途經點。",
            ),
        ),
        route(
            "xian-yinchuan-lanzhou-road",
            names("Xi'an–Yinchuan–Xining–Lanzhou road journey", "西安—银川—西宁—兰州自驾线", "西安—銀川—西寧—蘭州自駕線"),
            "road",
            [
                point("西安", 108.939621, 34.343147),
                point("洛阳", 112.434468, 34.663041),
                point("开封", 114.341447, 34.797049),
                point("银川", 106.230909, 38.487193),
                point("西宁", 101.778228, 36.617144),
                point("兰州", 103.834303, 36.061089),
            ],
            schematic=True,
            note=names(
                "The Ningxia–Qinghai detour is schematic; Yinchuan and Xining are required waypoints.",
                "宁夏—青海段为示意路线，明确保留银川和西宁。",
                "寧夏—青海段為示意路線，明確保留銀川和西寧。",
            ),
        ),
        route(
            "henan-jiangxi-shanghai-road",
            names("Lanzhou–Henan–Jiangxi–Shanghai road journey", "兰州—河南—江西—上海自驾线", "蘭州—河南—江西—上海自駕線"),
            "road",
            [
                point("兰州", 103.834303, 36.061089),
                point("天水", 105.724998, 34.581445),
                point("西安", 108.939621, 34.343147),
                point("郑州", 113.625368, 34.7466),
                point("开封", 114.341447, 34.797049),
                point("武汉", 114.305392, 30.593098),
                point("九江", 116.00193, 29.705077),
                point("南昌", 115.858198, 28.682892),
                point("景德镇", 117.178419, 29.268835),
                shanghai,
            ],
            schematic=True,
            note=names(
                "The Yangtze crossing and Jiangxi leg are schematic travel connections.",
                "过江及江西段按叙述整理为示意连接。",
                "過江及江西段按敘述整理為示意連接。",
            ),
        ),
        route(
            "shanghai-mudanjiang-road",
            names("Shanghai–Mudanjiang return journey", "上海—牡丹江返程自驾线", "上海—牡丹江返程自駕線"),
            "road",
            [
                shanghai,
                nanjing,
                xuzhou,
                jinan,
                beijing,
                point("沈阳", 123.431474, 41.805698),
                point("长春", 125.323544, 43.817071),
                point("牡丹江", 129.633169, 44.551653),
            ],
            schematic=True,
            note=names(
                "Return corridor is schematic and closes the described trip back to Mudanjiang.",
                "返程通道为示意路线，用于闭合叙述中的牡丹江返程。",
                "返程通道為示意路線，用於閉合敘述中的牡丹江返程。",
            ),
        ),
    ]
    return routes


def fetch_road_routes(routes: list[dict[str, Any]], force: bool = False) -> dict[str, Any]:
    fetched_routes = []
    for route_data in routes:
        if route_data["kind"] != "road":
            continue
        coordinate_text = ";".join(
            ",".join(str(value) for value in waypoint["coordinate"])
            for waypoint in route_data["waypoints"]
        )
        request_url = OSRM_BASE + coordinate_text + "?overview=full&geometries=geojson&steps=false&continue_straight=false"
        response_path = DEFAULT_CACHE.parent / ("osrm-" + route_data["id"] + ".json")
        if response_path.exists() and not force:
            response = json.loads(response_path.read_text(encoding="utf-8"))
            if response.get("request_url") != request_url:
                response = None
        else:
            response = None
        if response is None:
            print("Routing " + route_data["id"], flush=True)
            request = Request(request_url, headers={"User-Agent": "SJTUFreshman-footprints-map/1.0"})
            for attempt in range(3):
                try:
                    with urlopen(request, timeout=60) as stream:
                        payload = json.load(stream)
                    if payload.get("code") != "Ok":
                        raise ValueError("OSRM response: " + str(payload.get("code")))
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(2 * (attempt + 1))
            response = {"request_url": request_url, "retrieved_at": datetime.now(timezone.utc).isoformat(), "response": payload}
            response_path.parent.mkdir(parents=True, exist_ok=True)
            response_path.write_text(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        payload = response["response"]
        routed = payload["routes"][0]
        geometry = routed["geometry"]
        if geometry.get("type") != "LineString" or len(geometry.get("coordinates", [])) < 20:
            raise ValueError("OSRM did not return full road geometry for " + route_data["id"])
        validate_network_geometry(route_data["id"], geometry)
        fetched_routes.append({
            "id": route_data["id"],
            "geometry": geometry,
            "distance_metres": routed["distance"],
            "snapped_waypoints": payload["waypoints"],
            "source": {
                "provider": "OSRM public routing service / OpenStreetMap road network",
                "request_url": request_url,
                "retrieved_at": response["retrieved_at"],
                "routing_profile": "driving",
                "geometry_detail": "overview=full",
                "attribution": "© OpenStreetMap contributors",
                "license": "ODbL-1.0",
                "license_url": "https://www.openstreetmap.org/copyright",
            },
        })
        print(f"{route_data['id']}: {len(geometry['coordinates'])} road coordinates; {routed['distance'] / 1000:.1f} km", flush=True)
    result = {"version": 2, "routes": fetched_routes}
    ROAD_CACHE.parent.mkdir(parents=True, exist_ok=True)
    ROAD_CACHE.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return result


def distance_metres(start: list[float], end: list[float]) -> float:
    radius = 6371008.8
    start_latitude, end_latitude = math.radians(start[1]), math.radians(end[1])
    latitude_delta = end_latitude - start_latitude
    longitude_delta = math.radians(end[0] - start[0])
    haversine = math.sin(latitude_delta / 2) ** 2 + math.cos(start_latitude) * math.cos(end_latitude) * math.sin(longitude_delta / 2) ** 2
    return radius * 2 * math.asin(min(1, math.sqrt(haversine)))


def fetch_rail_routes(routes: list[dict[str, Any]], output: Path = RAIL_CACHE) -> None:
    fetched = []
    profile_path = DEFAULT_CACHE.parent / "rail-profile.json"
    if profile_path.exists():
        profile = json.loads(profile_path.read_text(encoding="utf-8"))
    else:
        response = requests.post(BROUTER_BASE + "/profile", data=RAIL_PROFILE,
                                 headers={"Content-Type": "text/plain"}, timeout=30)
        response.raise_for_status()
        profile = response.json()
        if "error" in profile:
            raise ValueError(profile["error"])
        profile_path.write_text(json.dumps(profile), encoding="utf-8")
    for route_data in routes:
        if route_data["kind"] != "rail":
            continue
        stations = [RAIL_STATIONS[waypoint["name"]] for waypoint in route_data["waypoints"]]
        coordinates = []
        request_urls = []
        total_distance = 0
        for leg_index, (start, end) in enumerate(zip(stations, stations[1:])):
            query = urlencode({"lonlats": "|".join(",".join(map(str, coordinate)) for coordinate in (start, end)),
                               "profile": profile["profileid"], "alternativeidx": 0, "format": "geojson"})
            request_url = BROUTER_BASE + "?" + query
            cache_path = DEFAULT_CACHE.parent / (f"brouter-{route_data['id']}-{leg_index}.json")
            cached = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else None
            if not cached or cached.get("request_url") != request_url:
                print(f"Rail routing {route_data['id']} leg {leg_index + 1}", flush=True)
                response = requests.get(request_url, timeout=60)
                response.raise_for_status()
                cached = {"request_url": request_url, "retrieved_at": datetime.now(timezone.utc).isoformat(), "response": response.json()}
                cache_path.write_text(json.dumps(cached, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
                time.sleep(1)
            feature = cached["response"]["features"][0]
            messages = feature["properties"]["messages"]
            tags_index = messages[0].index("WayTags")
            distance_index = messages[0].index("Distance")
            off_rail = [message for message in messages[1:] if "railway=rail" not in message[tags_index] and float(message[distance_index]) > 0]
            if off_rail:
                raise ValueError(f"Non-rail edges in {route_data['id']}: {off_rail[:3]}")
            leg_coordinates = [coordinate[:2] for coordinate in feature["geometry"]["coordinates"]]
            if coordinates and distance_metres(coordinates[-1], leg_coordinates[0]) > 5:
                raise ValueError("Rail legs do not meet at a common mapped track")
            coordinates.extend(leg_coordinates[1:] if coordinates else leg_coordinates)
            total_distance += float(feature["properties"]["track-length"])
            request_urls.append(request_url)
        geometry = {"type": "LineString", "coordinates": coordinates}
        validate_network_geometry(route_data["id"], geometry, maximum_step_metres=35000)
        fetched.append({"id": route_data["id"], "geometry": geometry,
                        "distance_metres": total_distance,
                        "source": {"provider": "BRouter / OpenStreetMap railway network", "request_urls": request_urls,
                                   "retrieved_at": cached["retrieved_at"], "routing_profile": "rail",
                                   "profile_source": RAIL_PROFILE,
                                   "verified_way_tags": "railway=rail for every routed edge",
                                   "attribution": "© OpenStreetMap contributors", "license": "ODbL-1.0",
                                   "license_url": "https://www.openstreetmap.org/copyright"}})
        print(f"{route_data['id']}: {len(geometry['coordinates'])} railway coordinates", flush=True)
    output.write_text(json.dumps({"version": 2, "routes": fetched}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def validate_network_geometry(identifier: str, geometry: dict[str, Any], maximum_step_metres: float = 20000) -> None:
    coordinates = geometry.get("coordinates", [])
    if geometry.get("type") != "LineString" or len(coordinates) < 20:
        raise ValueError(identifier + " is missing detailed network geometry")
    maximum_step = max(distance_metres(start, end) for start, end in zip(coordinates, coordinates[1:]))
    if maximum_step > maximum_step_metres:
        raise ValueError(f"{identifier} contains an unexplained {maximum_step / 1000:.1f} km coordinate jump")


def replace_network_geometries(routes: list[dict[str, Any]], road_data: dict[str, Any], rail_path: Path) -> None:
    if not rail_path.exists():
        raise FileNotFoundError("Actual railway geometries are required: " + str(rail_path))
    rail_data = json.loads(rail_path.read_text(encoding="utf-8"))
    network_routes = {item["id"]: item for item in road_data["routes"] + rail_data["routes"]}
    for route_data in routes:
        actual = network_routes[route_data["id"]]
        validate_network_geometry(route_data["id"], actual["geometry"], 35000 if route_data["kind"] == "rail" else 20000)
        route_data["geometry"] = actual["geometry"]
        route_data["source"] = actual["source"]
        route_data["geometry_status"] = "network_routed"
        route_data["itinerary_status"] = "reconstructed_from_memory"
        route_data.pop("schematic", None)
        if "distance_metres" in actual:
            route_data["distance_metres"] = actual["distance_metres"]
        if route_data["kind"] == "road":
            route_data["note"] = names(
                "Follows mapped roads between remembered waypoints. The exact historic itinerary is inferred, not a GPS recording.",
                "沿回忆途经点之间的真实道路行进，具体历史行程为推定，并非 GPS 实测轨迹。",
                "沿回憶途經點之間的真實道路行進，具體歷史行程為推定，並非 GPS 實測軌跡。",
            )
        else:
            route_data["note"] = names(
                "Follows mapped railway geometry. The service and historical itinerary are inferred from the described endpoints.",
                "沿真实铁路几何绘制；具体车次和历史行程依据叙述的起终点推定。",
                "沿真實鐵路幾何繪製；具體車次和歷史行程依據敘述的起終點推定。",
            )


def read_literal_assignment(path: Path, variable: str) -> Any:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(isinstance(target, ast.Name) and target.id == variable for target in statement.targets):
            return ast.literal_eval(statement.value)
    raise ValueError(f"{variable} was not found in {path}")


def load_provinces(path: Path) -> tuple[list[dict[str, Any]], dict[int, str], dict[int, str]]:
    source = json.loads(path.read_text(encoding="utf-8"))
    china_names = json.loads(DEFAULT_NAMES_SOURCE.read_text(encoding="utf-8"))["region_names"]
    region_names = {int(identifier): name for identifier, name in china_names.items()}
    region_colours = read_literal_assignment(DEFAULT_COLOUR_SOURCE, "REGION_COLORS")["china"]
    features: list[dict[str, Any]] = []
    adcode_to_name: dict[int, str] = {}
    adcode_to_colour: dict[int, str] = {}
    name_to_region = {name: identifier for identifier, name in region_names.items()}
    for feature in source["features"]:
        properties = feature.get("properties", {})
        adcode = properties.get("adcode")
        if not isinstance(adcode, int) or adcode < 100000:
            continue
        name = properties.get("name", "")
        region_id = name_to_region.get(name)
        if region_id is None:
            raise ValueError(f"Province {name!r} (adcode {adcode}) is missing from china.json region_names")
        palette_index = region_colours.get(region_id, (region_id - 1) % len(PALETTE))
        adcode_to_name[adcode] = name
        adcode_to_colour[adcode] = PALETTE[palette_index]
        geometry = shape(feature["geometry"])
        if not geometry.is_valid:
            geometry = make_valid(geometry)
        features.append({"adcode": adcode, "name": name, "geometry": geometry})
    if len(features) != 34:
        raise ValueError(f"Expected 34 province features, found {len(features)}")
    return features, adcode_to_name, adcode_to_colour


def line_parts(geometry: Any) -> list[LineString]:
    if isinstance(geometry, LineString):
        return [geometry] if geometry.length > 1e-9 else []
    if isinstance(geometry, MultiLineString):
        return [part for part in geometry.geoms if part.length > 1e-9]
    if isinstance(geometry, GeometryCollection):
        result: list[LineString] = []
        for part in geometry.geoms:
            result.extend(line_parts(part))
        return result
    return []


def split_route(route_data: dict[str, Any], provinces: list[dict[str, Any]], colours: dict[int, str]) -> list[dict[str, Any]]:
    coordinates = route_data["geometry"]["coordinates"]
    source_line = LineString(coordinates)
    candidates: list[tuple[float, float, int, LineString]] = []
    for province in provinces:
        clipped = source_line.intersection(province["geometry"])
        for piece in line_parts(clipped):
            midpoint = piece.interpolate(0.5, normalized=True)
            if not province["geometry"].covers(midpoint):
                continue
            start_distance = source_line.project(Point(piece.coords[0]))
            end_distance = source_line.project(Point(piece.coords[-1]))
            if end_distance < start_distance:
                piece = LineString(list(piece.coords)[::-1])
                start_distance, end_distance = end_distance, start_distance
            candidates.append((start_distance, end_distance, province["adcode"], piece))
    candidates.sort(key=lambda item: (item[0], item[1], item[2]))
    segments: list[dict[str, Any]] = []
    for start_distance, end_distance, adcode, piece in candidates:
        coordinates = [[round(float(longitude), 6), round(float(latitude), 6)] for longitude, latitude in piece.coords]
        if len(coordinates) < 2:
            continue
        if segments and abs(start_distance - segments[-1]["_end_distance"]) < 1e-7 and segments[-1]["adcode"] == adcode:
            merged = segments[-1]["points"]
            merged.extend(coordinates[1:])
            segments[-1]["_end_distance"] = end_distance
            continue
        segments.append({
            "province": province_name(adcode, provinces),
            "adcode": adcode,
            "color": colours[adcode],
            "points": coordinates,
            "_start_distance": start_distance,
            "_end_distance": end_distance,
        })
    for segment in segments:
        segment.pop("_start_distance", None)
        segment.pop("_end_distance", None)
    return segments


def province_name(adcode: int, provinces: list[dict[str, Any]]) -> str:
    for province in provinces:
        if province["adcode"] == adcode:
            return province["name"]
    raise KeyError(adcode)


def prepare(province_path: Path, output_path: Path, cache_path: Path, rail_path: Path = RAIL_CACHE, force_roads: bool = False) -> dict[str, Any]:
    provinces, _, colours = load_provinces(province_path)
    routes = build_routes()
    roads = fetch_road_routes(routes, force_roads)
    if not rail_path.exists():
        fetch_rail_routes(routes, rail_path)
    replace_network_geometries(routes, roads, rail_path)
    for route_data in routes:
        route_data["segments"] = split_route(route_data, provinces, colours)
        if not route_data["segments"]:
            raise ValueError(f"Route {route_data['id']} does not intersect a China province")
    result = {
        "version": 2,
        "note": names(
            "Journeys follow mapped road and rail networks. The itinerary is inferred from remembered waypoints, not measured GPS tracks. Segment colours follow intersections with province boundaries.",
            "线路沿真实公路与铁路网络绘制；具体行程根据回忆途经点推定，并非 GPS 实测轨迹。线路跨省时按省界交点变色。",
            "線路沿真實公路與鐵路網路繪製；具體行程根據回憶途經點推定，並非 GPS 實測軌跡。線路跨省時按省界交點變色。",
        ),
        "source": {
            "province_geojson": "assets/maps/china_100000_full.json",
            "colour_source": "tools/relief-atlas/footprints-style.json palette; reference/render_atlas.py REGION_COLORS['china']",
            "region_name_source": "tools/relief-atlas/reference/data/china.json region_names",
        },
        "routes": routes,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"version": 2, "source": str(province_path), "routes": routes}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provinces", type=Path, default=DEFAULT_PROVINCE_PATH)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--rail-geometries", type=Path, default=RAIL_CACHE)
    parser.add_argument("--fetch-roads-only", action="store_true")
    parser.add_argument("--force-roads", action="store_true")
    arguments = parser.parse_args()
    if arguments.fetch_roads_only:
        fetch_road_routes(build_routes(), arguments.force_roads)
        return
    result = prepare(arguments.provinces, arguments.output, arguments.cache, arguments.rail_geometries, arguments.force_roads)
    route_count = len(result["routes"])
    segment_count = sum(len(item["segments"]) for item in result["routes"])
    print(f"Wrote {route_count} routes and {segment_count} province segments to {arguments.output}")


if __name__ == "__main__":
    main()
