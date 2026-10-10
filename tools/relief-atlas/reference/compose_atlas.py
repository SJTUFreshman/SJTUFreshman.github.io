from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps
from pyproj import CRS, Transformer


MAP_IDS = ("shengsi", "china", "hainan", "fujian_taiwan")
PALETTE = ("#c9ad65", "#a9bc9a", "#c49a8b", "#a5bdc0", "#d2c6a6", "#afa4b9")
TITLES = {
    "shengsi": ("嵊泗列岛", "SHENGSI ARCHIPELAGO"),
    "china": ("中华人民共和国", "CHINA / A RELIEF ATLAS"),
    "hainan": ("雷州半岛与海南岛", "LEIZHOU & HAINAN"),
    "fujian_taiwan": ("福建与台湾", "FUJIAN & TAIWAN"),
}
BASE_COLORS = {
    "shengsi": "#7fa5b5",
    "china": "#dad5c3",
    "hainan": "#dcddda",
    "fujian_taiwan": "#dad5c3",
}
DESIGN_SIZES = {
    "shengsi": (2400, 1600),
    "china": (2480, 2000),
    "hainan": (2000, 2400),
    "fujian_taiwan": (2000, 2300),
}


def rgb(color):
    value = color.lstrip("#")
    return tuple(int(value[index:index + 2], 16) for index in (0, 2, 4))


def overlap_area(first, second):
    return max(0, min(first[2], second[2]) - max(first[0], second[0])) * max(
        0, min(first[3], second[3]) - max(first[1], second[1])
    )


def expand_rect(rect, padding):
    return rect[0] - padding, rect[1] - padding, rect[2] + padding, rect[3] + padding


class AtlasPage:
    def __init__(self, root, map_id):
        self.root = root
        self.map_id = map_id
        self.layout = json.loads((root / "data" / f"{map_id}_layout.json").read_text(encoding="utf-8"))
        data_path = root / "data" / f"{map_id}.json"
        self.data = json.loads(data_path.read_text(encoding="utf-8")) if data_path.is_file() else {}
        self.image = Image.open(root / "renders" / f"{map_id}_terrain.png").convert("RGB")
        self.width, self.height = self.image.size
        expected = self.layout["width"], self.layout["height"]
        if self.image.size != expected:
            raise ValueError(f"{map_id}: render size {self.image.size} differs from layout size {expected}")
        design_width, design_height = DESIGN_SIZES[map_id]
        self.scale_x = self.width / design_width
        self.scale_y = self.height / design_height
        self.scale = min(self.scale_x, self.scale_y)
        self.layer = Image.new("RGBA", self.image.size)
        self.draw = ImageDraw.Draw(self.layer)
        self.map_rect = self.layout["map_rect"]
        self.extent = self.layout["extent_km"]
        self.projector = Transformer.from_crs("EPSG:4326", CRS.from_user_input(self.layout["projection"]), always_xy=True)
        self.ink = rgb("#e7ebe6" if map_id == "shengsi" else "#46463b")
        self.muted = rgb("#d3dfde" if map_id == "shengsi" else "#77786a")
        self.sea_ink = rgb("#e0e8e3" if map_id == "shengsi" else "#67827a")
        self.base = rgb(BASE_COLORS[map_id])
        self.occupied = []
        self.fonts = {}
        self.cjk_path = self.find_font((
            Path("C:/Windows/Fonts/simsun.ttc"),
            Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"),
            Path("/usr/share/fonts/truetype/arphic/uming.ttc"),
        ))
        self.latin_path = self.find_font((
            Path("C:/Windows/Fonts/times.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"),
            Path("/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf"),
        ))

    @staticmethod
    def find_font(candidates):
        for candidate in candidates:
            if candidate.is_file():
                return candidate
        raise FileNotFoundError(f"No suitable font found among: {', '.join(map(str, candidates))}")

    def font(self, size, latin=False):
        key = max(1, round(size * self.scale)), latin
        if key not in self.fonts:
            self.fonts[key] = ImageFont.truetype(str(self.latin_path if latin else self.cjk_path), key[0])
        return self.fonts[key]

    def design_point(self, xpos, ypos):
        return xpos * self.scale_x, ypos * self.scale_y

    def geo(self, longitude, latitude):
        east, north = self.projector.transform(longitude, latitude)
        min_east, min_north, max_east, max_north = self.extent
        left, top, right, bottom = self.map_rect
        return (
            left + (east / 1000 - min_east) / (max_east - min_east) * (right - left),
            bottom - (north / 1000 - min_north) / (max_north - min_north) * (bottom - top),
        )

    def text(self, position, content, size, *, color=None, latin=False, spacing=0, anchor="lt", reserve=True, stroke=0):
        font = self.font(size, latin)
        color = color or self.ink
        stroke_width = round(stroke * self.scale)
        spacing *= self.scale
        advance = sum(self.draw.textlength(character, font=font) for character in content)
        advance += max(0, len(content) - 1) * spacing
        glyph_box = font.getbbox(content)
        text_height = glyph_box[3] - glyph_box[1]
        xpos, ypos = position
        if anchor[0] == "m":
            xpos -= advance / 2
        elif anchor[0] == "r":
            xpos -= advance
        if anchor[-1] == "m":
            ypos -= text_height / 2
        elif anchor[-1] == "b":
            ypos -= text_height
        bounds = xpos, ypos, xpos + advance, ypos + text_height
        if spacing:
            cursor = xpos
            for character in content:
                self.draw.text((cursor, ypos - glyph_box[1]), character, font=font, fill=color, stroke_width=stroke_width, stroke_fill=color)
                cursor += self.draw.textlength(character, font=font) + spacing
        else:
            self.draw.text((xpos, ypos - glyph_box[1]), content, font=font, fill=color, stroke_width=stroke_width, stroke_fill=color)
        if reserve:
            self.occupied.append(expand_rect(bounds, 10 * self.scale))
        return bounds

    def design_text(self, position, content, size, **kwargs):
        return self.text(self.design_point(*position), content, size, **kwargs)

    def line(self, coordinates, color=None, width=1):
        self.draw.line(coordinates, fill=color or self.muted, width=max(1, round(width * self.scale)))

    def border(self, double=False):
        margin = 36 * self.scale
        color = (*self.muted, 115)
        self.draw.rectangle((margin, margin, self.width - margin, self.height - margin), outline=color, width=1)
        if double:
            inset = margin + 12 * self.scale
            self.draw.rectangle((inset, inset, self.width - inset, self.height - inset), outline=(*self.muted, 40), width=1)

    def background_penalty(self, rect):
        left, top, right, bottom = rect
        score = 0
        count = 0
        for fraction_x in (0.15, 0.5, 0.85):
            for fraction_y in (0.2, 0.5, 0.8):
                xpos = round(left + (right - left) * fraction_x)
                ypos = round(top + (bottom - top) * fraction_y)
                if 0 <= xpos < self.width and 0 <= ypos < self.height:
                    pixel = self.image.getpixel((xpos, ypos))
                    score += min(100, sum(abs(pixel[index] - self.base[index]) for index in range(3)))
                    count += 1
        return score / max(1, count)

    def label(self, content, longitude, latitude, size=25, offset=(0, 0), *, leader=False, prefer_sea=False, color=None, extra_offsets=(), target=None):
        point = self.geo(longitude, latitude)
        if not (0 < point[0] < self.width and 0 < point[1] < self.height):
            return
        font = self.font(size)
        bounds = font.getbbox(content)
        text_width = self.draw.textlength(content, font=font)
        text_height = bounds[3] - bounds[1]
        if target is not None:
            target_point = self.design_point(*target)
            alternatives = [((target_point[0] - point[0]) / self.scale, (target_point[1] - point[1]) / self.scale)]
        else:
            alternatives = [offset, *extra_offsets]
        if leader and target is None:
            alternatives += [(0, -65), (80, -40), (-80, -40), (90, 35), (-90, 35), (0, 70)]
        elif target is None:
            alternatives += [(0, -22), (0, 22), (32, 0), (-32, 0)]
        best = None
        safe = 62 * self.scale
        for order, (offset_x, offset_y) in enumerate(alternatives):
            center = point[0] + offset_x * self.scale, point[1] + offset_y * self.scale
            rect = center[0] - text_width / 2, center[1] - text_height / 2, center[0] + text_width / 2, center[1] + text_height / 2
            if rect[0] < safe or rect[1] < safe or rect[2] > self.width - safe or rect[3] > self.height - safe:
                continue
            collision = sum(overlap_area(expand_rect(rect, 8 * self.scale), occupied) for occupied in self.occupied)
            penalty = collision * 100 / max(1, self.scale ** 2) + order * 4
            if prefer_sea:
                penalty += self.background_penalty(rect)
            if best is None or penalty < best[0]:
                best = penalty, center, rect
        if best is None:
            return
        _, center, rect = best
        if leader and math.dist(point, center) > 20 * self.scale:
            target = (
                min(max(point[0], rect[0]), rect[2]),
                min(max(point[1], rect[1]), rect[3]),
            )
            distance = math.dist(point, target)
            if distance > 8 * self.scale:
                ratio = 5 * self.scale / distance
                endpoint = target[0] + (point[0] - target[0]) * ratio, target[1] + (point[1] - target[1]) * ratio
                self.line([point, endpoint], color=(*(color or self.muted), 135))
        self.text(center, content, size, color=color, anchor="mm")

    def ocean(self, content, longitude, latitude, english=None, size=27):
        position = self.geo(longitude, latitude)
        if not (70 * self.scale < position[0] < self.width - 70 * self.scale and 70 * self.scale < position[1] < self.height - 70 * self.scale):
            return
        font = self.font(size)
        width = self.draw.textlength(content, font=font) + 9 * self.scale * max(0, len(content) - 1)
        rect = (position[0] - width / 2, position[1], position[0] + width / 2, position[1] + 70 * self.scale)
        if any(overlap_area(rect, occupied) > 0 for occupied in self.occupied):
            return
        self.text(position, content, size, color=self.sea_ink, spacing=9, anchor="mt")
        if english:
            self.text((position[0], position[1] + 47 * self.scale), english, 10, color=self.sea_ink, latin=True, spacing=1.2, anchor="mt")

    def north_arrow(self, position, length=80):
        xpos, ypos = self.design_point(*position)
        length *= self.scale
        self.text((xpos, ypos - 27 * self.scale), "N", 14, latin=True, color=self.muted, anchor="mb")
        self.line([(xpos, ypos + length), (xpos, ypos)])
        self.line([(xpos - 10 * self.scale, ypos + 23 * self.scale), (xpos, ypos), (xpos + 10 * self.scale, ypos + 23 * self.scale)])

    def scale_bar(self, position, length_km):
        xpos, ypos = self.design_point(*position)
        left, _, right, _ = self.map_rect
        min_east, _, max_east, _ = self.extent
        length_px = length_km / (max_east - min_east) * (right - left)
        self.line([(xpos, ypos), (xpos + length_px, ypos)])
        for tick in (xpos, xpos + length_px):
            self.line([(tick, ypos - 6 * self.scale), (tick, ypos + 6 * self.scale)])
        self.text((xpos, ypos + 17 * self.scale), "0", 11, latin=True, color=self.muted)
        self.text((xpos + length_px, ypos + 17 * self.scale), f"{length_km:g} km", 11, latin=True, color=self.muted, anchor="rt")

    def legend(self, position, regional=False):
        xpos, ypos = self.design_point(*position)
        self.text((xpos, ypos), "图 例", 27)
        self.text((xpos + 100 * self.scale, ypos + 14 * self.scale), "LEGEND", 9, latin=True, color=self.muted, spacing=1)
        for index, color in enumerate(PALETTE):
            left = xpos + index * 32 * self.scale
            self.draw.rectangle((left, ypos + 45 * self.scale, left + 27 * self.scale, ypos + 60 * self.scale), fill=rgb(color))
        self.text((xpos, ypos + 76 * self.scale), "区域分色" if regional else "省域设色", 18, color=self.muted)
        self.line([(xpos, ypos + 119 * self.scale), (xpos + 43 * self.scale, ypos + 119 * self.scale)])
        self.text((xpos + 62 * self.scale, ypos + 108 * self.scale), "区域边界" if regional else "行政边界", 17, color=self.muted)
        self.text((xpos, ypos + 150 * self.scale), "阴影表示地形起伏", 16, color=self.muted)
        self.text((xpos, ypos + 177 * self.scale), "高程经垂直夸张处理", 14, color=self.muted)
        self.occupied.append((xpos - 10, ypos - 10, xpos + 240 * self.scale, ypos + 205 * self.scale))

    def graticule(self, longitudes, latitudes):
        grid = Image.new("RGBA", self.image.size)
        grid_draw = ImageDraw.Draw(grid)
        left, top, right, bottom = self.map_rect
        for longitude in longitudes:
            points = [self.geo(longitude, -5 + sample * 0.2) for sample in range(351)]
            self.grid_segments(grid_draw, points, (left, top, right, bottom))
        for latitude in latitudes:
            points = [self.geo(65 + sample * 0.2, latitude) for sample in range(401)]
            self.grid_segments(grid_draw, points, (left, top, right, bottom))
        difference = ImageChops.difference(self.image, Image.new("RGB", self.image.size, self.base)).convert("L")
        sea_mask = difference.point(lambda intensity: 255 if intensity < 13 else 35)
        alpha = ImageChops.multiply(grid.getchannel("A"), sea_mask)
        grid.putalpha(alpha)
        self.layer = Image.alpha_composite(grid, self.layer)
        self.draw = ImageDraw.Draw(self.layer)

    def grid_segments(self, grid_draw, points, rect):
        previous = None
        for current in points:
            inside = rect[0] <= current[0] <= rect[2] and rect[1] <= current[1] <= rect[3]
            if inside and previous is not None:
                grid_draw.line([previous, current], fill=(*self.muted, 25), width=1)
            previous = current if inside else None

    def geojson(self):
        candidates = [self.root / "cache" / "china_admin1.json"]
        candidates += list((self.root / "data").rglob("100000_full.geojson"))
        candidates += list((self.root / "data").rglob("100000_full.json"))
        for path in candidates:
            try:
                document = json.loads(path.read_text(encoding="utf-8"))
                if document.get("type") == "FeatureCollection":
                    return document
            except (OSError, ValueError):
                continue
        return None

    def south_china_sea_inset(self):
        document = self.geojson()
        if document is None:
            return
        left, top = self.design_point(2090, 1330)
        right, bottom = self.design_point(2350, 1760)
        box = round(left), round(top), round(right), round(bottom)
        self.draw.rectangle(box, fill=(*self.base, 245), outline=(*self.muted, 150), width=1)
        self.text((left + 18 * self.scale, top + 19 * self.scale), "南海诸岛", 19)
        content_box = (left + 15 * self.scale, top + 58 * self.scale, right - 15 * self.scale, bottom - 42 * self.scale)
        inset = Image.new("RGBA", (max(1, round(content_box[2] - content_box[0])), max(1, round(content_box[3] - content_box[1]))))
        inset_draw = ImageDraw.Draw(inset)
        west, south, east, north = 105, 2, 125, 24

        def point(coordinate):
            return ((coordinate[0] - west) / (east - west) * inset.width, (north - coordinate[1]) / (north - south) * inset.height)

        def draw_geometry(geometry):
            if not geometry:
                return
            kind = geometry.get("type")
            coordinates = geometry.get("coordinates", [])
            if kind == "GeometryCollection":
                for child in geometry.get("geometries", []):
                    draw_geometry(child)
            elif kind == "Polygon":
                for ring in coordinates:
                    if len(ring) > 1:
                        inset_draw.line([point(coordinate) for coordinate in ring], fill=(*self.ink, 150), width=1)
            elif kind == "MultiPolygon":
                for polygon in coordinates:
                    draw_geometry({"type": "Polygon", "coordinates": polygon})
            elif kind == "LineString" and len(coordinates) > 1:
                inset_draw.line([point(coordinate) for coordinate in coordinates], fill=(*self.ink, 150), width=1)
            elif kind == "MultiLineString":
                for line in coordinates:
                    draw_geometry({"type": "LineString", "coordinates": line})

        for feature in document.get("features", []):
            draw_geometry(feature.get("geometry"))
        self.layer.alpha_composite(inset, (round(content_box[0]), round(content_box[1])))
        self.text((left + 17 * self.scale, bottom - 27 * self.scale), "地理数据示意 · 非独立比例", 10, color=self.muted)
        self.occupied.append(expand_rect(box, 20 * self.scale))

    def footer(self, position, headline):
        self.design_text(position, headline, 18, color=self.muted)
        self.design_text((position[0], position[1] + 34), "SHADED RELIEF / BLENDER", 10, latin=True, color=self.muted, spacing=1.1)
        defaults = {
            "shengsi": "Mapzen / AWS Terrain Tiles · © OpenStreetMap contributors",
            "hainan": "Mapzen / AWS Terrain Tiles · Blender",
            "china": "Mapzen Terrain Tiles · Alibaba DataV · Blender",
            "fujian_taiwan": "Mapzen · DataV · geoBoundaries / © OpenStreetMap contributors",
        }
        source_note = self.layout.get("source_note", defaults[self.map_id])
        self.design_text((position[0], position[1] + 59), source_note, 10, latin=source_note.isascii(), color=self.muted)

    def finish(self):
        output = Image.alpha_composite(self.image.convert("RGBA"), self.layer).convert("RGB")
        path = self.root / "outputs" / f"{self.map_id}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        labels_path = path.with_name(f"{self.map_id}_labels.png")
        self.layer.save(labels_path, dpi=(300, 300))
        output.save(path, dpi=(300, 300))
        print(f"Wrote {labels_path}")
        print(f"Wrote {path}")
        return path


def compose_shengsi(page):
    page.border()
    page.design_text((145, 87), "嵊泗列岛", 76, spacing=5, stroke=2)
    page.design_text((149, 188), "Shengsi Archipelago", 30, latin=True, spacing=1)
    page.design_text((150, 242), "ZHEJIANG   CHINA", 11, latin=True, color=page.muted, spacing=2.2)
    page.north_arrow((2235, 150), 80)
    labels = (
        ("洋山诸岛", 122.061, 30.61, 55, -85),
        ("泗礁岛", 122.466, 30.724, -135, 83),
        ("黄龙岛", 122.550, 30.667, 94, 62),
        ("绿华诸岛", 122.616, 30.825, -110, -28),
        ("花鸟岛", 122.681, 30.859, -10, -73),
        ("枸杞岛", 122.764, 30.721, -12, 88),
        ("嵊山岛", 122.821, 30.724, 65, -80),
    )
    for content, longitude, latitude, offset_x, offset_y in labels:
        page.label(content, longitude, latitude, 27, (offset_x, offset_y), leader=True, prefer_sea=True)
    page.ocean("东 海", 122.68, 30.575, "EAST CHINA SEA", 29)
    page.scale_bar((155, 1417), 10)
    page.footer((1620, 1400), "群岛地形 · 海上浮雕")


def compose_china(page):
    page.border(double=True)
    page.design_text((1240, 105), "中华人民共和国", 67, spacing=16, anchor="mt", stroke=2)
    page.design_text((1240, 192), "CHINA   A RELIEF ATLAS", 15, latin=True, spacing=2, anchor="mt")
    page.design_text((100, 142), "地 形 与 省 域 设 色", 13, color=page.muted)
    page.design_text((2370, 145), "PLATE 02", 10, latin=True, spacing=1.5, anchor="rt", color=page.muted)
    page.legend((100, 345))
    page.south_china_sea_inset()
    provinces = (
        ("新疆", 85.7, 41.5, 32), ("西藏", 88.2, 31.6, 32),
        ("青海", 96.0, 35.6, 27), ("甘肃", 103.3, 37.5, 23),
        ("内蒙古", 111.0, 43.5, 29), ("黑龙江", 128.0, 47.6, 24),
        ("吉林", 126.5, 43.5, 23), ("辽宁", 122.9, 41.3, 23),
        ("山西", 112.1, 37.5, 23), ("陕西", 108.7, 35.4, 23),
        ("山东", 118.7, 36.3, 23), ("河南", 113.6, 33.8, 23),
        ("湖北", 112.7, 30.9, 23), ("湖南", 111.6, 27.6, 23),
        ("四川", 102.8, 30.6, 27), ("云南", 101.0, 24.5, 25),
        ("贵州", 106.6, 26.7, 22), ("广西", 108.5, 23.9, 23),
        ("广东", 113.4, 23.4, 23), ("江西", 115.5, 27.3, 22),
        ("福建", 118.0, 26.1, 22), ("浙江", 120.2, 29.1, 22),
        ("安徽", 117.1, 31.8, 22), ("江苏", 119.5, 33.4, 22),
        ("河北", 115.0, 38.5, 22), ("重庆", 107.5, 29.6, 20),
        ("宁夏", 106.1, 37.1, 20), ("台湾", 121.0, 23.7, 22),
        ("海南", 109.7, 19.2, 22),
    )
    for content, longitude, latitude, size in provinces:
        for region in page.data.get("region_labels", []):
            if region["name"].startswith(content):
                longitude, latitude = region["lon"], region["lat"]
                break
        page.label(content, longitude, latitude, size)
    for content, longitude, latitude, offset in (
        ("北京", 116.4, 39.9, (-8, -30)),
        ("天津", 117.4, 39.1, (60, 0)),
        ("上海", 121.47, 31.2, (85, 2)),
        ("香港", 114.16, 22.28, (60, 49)),
        ("澳门", 113.55, 22.2, (-5, 69)),
    ):
        page.label(content, longitude, latitude, 17, offset, leader=True)
    neighbors = (
        ("俄罗斯", 112.5, 52.8), ("蒙古", 103.5, 46.7),
        ("哈萨克斯坦", 79.8, 46.5), ("吉尔吉斯斯坦", 73.9, 41.8),
        ("巴基斯坦", 73.7, 33.1), ("印度", 79.4, 26.2),
        ("尼泊尔", 83.9, 28.0), ("缅甸", 96.2, 22.0),
        ("越南", 105.8, 19.1), ("朝鲜", 127.3, 39.4),
        ("韩国", 128.5, 36.3), ("日本", 135.0, 36.3),
    )
    for content, longitude, latitude in neighbors:
        page.label(content, longitude, latitude, 18, color=page.muted)
    page.ocean("黄海", 123.5, 34.7, size=23)
    page.ocean("东海", 126.0, 28.8, size=23)
    page.ocean("太平洋", 133.0, 29.5, size=23)
    page.ocean("南海", 115.5, 18.6, size=23)
    page.footer((100, 1825), "地形晕渲 · 省域设色")


def compose_hainan(page):
    page.design_text((145, 260), "雷州半岛", 76, spacing=4, stroke=2)
    page.design_text((145, 363), "与海南岛", 76, spacing=4, stroke=2)
    page.design_text((149, 510), "LEIZHOU & HAINAN", 20, latin=True, spacing=1.2)
    page.design_text((148, 563), "琼州海峡两岸", 26)
    for content, longitude, latitude, target, size in (
        ("雷州半岛", 110.04, 20.83, (1470, 630), 28),
        ("琼州海峡", 110.15, 20.17, (1400, 990), 26),
        ("海南岛", 110.31, 19.05, (1710, 1590), 29),
        ("五指山", 109.69, 18.91, (237, 1680), 28),
    ):
        page.label(content, longitude, latitude, size, leader=True, target=target)
    page.ocean("北部湾", 108.60, 20.0, "BEIBU GULF", 28)
    page.ocean("南 海", 111.05, 18.6, "SOUTH CHINA SEA", 28)
    page.footer((148, 2235), "TOPOGRAPHIC STUDY")


def compose_fujian_taiwan(page):
    page.graticule(range(116, 123), range(22, 29))
    page.border(double=True)
    page.design_text((125, 105), "福建与台湾", 69, spacing=5, stroke=2)
    page.design_text((128, 199), "FUJIAN & TAIWAN", 19, latin=True, spacing=1.1)
    page.design_text((126, 244), "台湾海峡两岸 · 地形图", 24)
    page.design_text((128, 285), "A RELIEF STUDY OF THE TAIWAN STRAIT", 9, latin=True, spacing=1.1, color=page.muted)
    page.design_text((1870, 91), "PLATE 04", 10, latin=True, spacing=1.4, anchor="rt", color=page.muted)
    page.north_arrow((146, 345), 62)
    page.legend((125, 1860), regional=True)
    page.label("福 建", 117.50, 26.40, 41)
    page.label("台 湾", 121.03, 23.75, 38, (132, 85), leader=False, prefer_sea=True)
    for content, longitude, latitude, offset in (
        ("福州", 119.30, 26.08, (50, -20)),
        ("厦门", 118.08, 24.48, (-15, 32)),
        ("马祖", 119.94, 26.16, (55, -32)),
        ("平潭", 119.78, 25.50, (58, -8)),
        ("金门", 118.33, 24.44, (52, 48)),
        ("澎湖列岛", 119.58, 23.57, (-85, 28)),
        ("基隆", 121.74, 25.13, (50, -50)),
        ("台北", 121.56, 25.04, (-72, -37)),
        ("台中", 120.68, 24.15, (-65, -25)),
        ("台南", 120.20, 23.00, (-60, 0)),
        ("花莲", 121.61, 23.99, (70, 2)),
        ("绿岛", 121.49, 22.66, (77, -5)),
        ("兰屿", 121.55, 22.05, (75, 8)),
    ):
        page.label(content, longitude, latitude, 18, offset, leader=True, prefer_sea=True)
    page.ocean("台湾海峡", 119.50, 24.2, "TAIWAN STRAIT", 28)
    page.ocean("东海", 121.2, 26.8, "EAST CHINA SEA", 25)
    page.ocean("太平洋", 122.1, 23.6, "PACIFIC OCEAN", 25)
    page.ocean("南海", 117.8, 22.1, "SOUTH CHINA SEA", 25)
    for content, longitude, latitude in (("浙江", 119.7, 28.0), ("江西", 116.2, 27.0), ("广东", 116.1, 23.3)):
        page.label(content, longitude, latitude, 20, color=page.muted)
    page.scale_bar((130, 2167), 50)
    page.footer((1290, 2150), "地形浮雕 · 区域设色")


COMPOSERS = {
    "shengsi": compose_shengsi,
    "china": compose_china,
    "hainan": compose_hainan,
    "fujian_taiwan": compose_fujian_taiwan,
}


def contact_sheet(root):
    available = [(map_id, root / "outputs" / f"{map_id}.png") for map_id in MAP_IDS]
    available = [(map_id, path) for map_id, path in available if path.is_file()]
    if not available:
        return
    cell_width, cell_height = 940, 1120
    columns = 2 if len(available) > 1 else 1
    rows = math.ceil(len(available) / columns)
    sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), "#f0eee7")
    canvas = ImageDraw.Draw(sheet)
    cjk_font = ImageFont.truetype(str(AtlasPage.find_font((Path("C:/Windows/Fonts/simsun.ttc"), Path("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc")))), 24)
    latin_font = ImageFont.truetype(str(AtlasPage.find_font((Path("C:/Windows/Fonts/times.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf")))), 13)
    for index, (map_id, path) in enumerate(available):
        left, top = (index % columns) * cell_width, (index // columns) * cell_height
        with Image.open(path) as source:
            preview = ImageOps.contain(source.convert("RGB"), (cell_width - 60, cell_height - 115), Image.Resampling.LANCZOS)
        xpos = left + (cell_width - preview.width) // 2
        ypos = top + 35 + (cell_height - 115 - preview.height) // 2
        sheet.paste(preview, (xpos, ypos))
        canvas.text((left + 32, top + cell_height - 65), TITLES[map_id][0], fill="#4e5148", font=cjk_font)
        canvas.text((left + 32, top + cell_height - 31), TITLES[map_id][1], fill="#797c70", font=latin_font)
    path = root / "outputs" / "contact_sheet.jpg"
    sheet.save(path, quality=94, subsampling=0, dpi=(150, 150))
    print(f"Wrote {path}")


def main():
    parser = argparse.ArgumentParser(description="Compose labels and atlas furniture over Blender terrain renders.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--only", choices=MAP_IDS, nargs="+", action="append", help="Compose selected maps; accepts multiple IDs or repeated flags.")
    arguments = parser.parse_args()
    root = arguments.root.resolve()
    requested = {map_id for selection in arguments.only for map_id in selection} if arguments.only else set(MAP_IDS)
    for map_id in MAP_IDS:
        if map_id not in requested:
            continue
        required = (root / "renders" / f"{map_id}_terrain.png", root / "data" / f"{map_id}_layout.json")
        if any(not path.is_file() for path in required):
            print(f"Skipping {map_id}: terrain render or layout metadata not yet available")
            continue
        page = AtlasPage(root, map_id)
        COMPOSERS[map_id](page)
        page.finish()
    contact_sheet(root)


if __name__ == "__main__":
    main()
