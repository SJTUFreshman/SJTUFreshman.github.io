from __future__ import annotations

import json
import math
import shutil
import hashlib
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
SHEET_DIR = ROOT / "assets" / "generated-spritesheets"
MOCHI_V2_DIR = ROOT / "assets" / "mochi" / "generated-v2"

SOURCE_IMAGES = {
    "appcopilot": SHEET_DIR / "appcopilot-model-sheet-v3.png",
    "timo": SHEET_DIR / "timo-model-sheet-v3.png",
    "mochi_run_sleep": Path(
        r"C:\Users\Administrator.DESKTOP-RN0CUUV\.codex\generated_images\019f1d54-2ccd-7031-9875-22539d785ec7\ig_0e19e2281236e453016a45c5c017e081919f1b1f9575e522ed.png"
    ),
    "mochi_direction": Path(
        r"C:\Users\Administrator.DESKTOP-RN0CUUV\.codex\generated_images\019f1d54-2ccd-7031-9875-22539d785ec7\ig_0281962292f7c90f016a45c68260c48191b3f6e98885f6a3bb.png"
    ),
}

WALK_STRIP_IMAGES = {
    "mochi": SHEET_DIR / "mochi-walk-strip-v5.png",
    "appcopilot": SHEET_DIR / "appcopilot-walk-strip-v4.png",
    "timo": SHEET_DIR / "timo-walk-strip-v4.png",
}

ACTION_STRIP_IMAGES = {
    ("appcopilot", "sniff"): SHEET_DIR / "appcopilot-ground-ui-strip-v1.png",
}


FRAME_COUNTS = {
    "stand": 20,
    "sit": 20,
    "sleep": 20,
    "walk": 40,
    "run_down": 32,
    "run_side": 32,
    "run_up": 32,
    "eat_cookie": 20,
    "eat_grape": 20,
    "eat_carrot": 20,
    "eat_melon": 20,
    "happy": 20,
    "groom": 20,
    "sniff": 20,
    "play": 20,
    "stand_to_sit": 20,
    "sit_to_stand": 20,
    "stand_to_walk": 40,
    "walk_to_stand": 40,
    "sit_to_walk": 40,
    "walk_to_sit": 40,
    "walk_to_eat": 40,
    "sit_to_eat": 20,
    "eat_to_happy": 20,
    "happy_to_sit": 20,
    "happy_to_stand": 20,
    "happy_to_walk": 40,
    "walk_to_rest": 40,
    "sit_to_rest": 20,
    "stand_to_rest": 20,
    "rest_to_sleep": 20,
    "sleep_to_rest": 20,
    "rest_to_sit": 20,
    "rest_to_walk": 40,
    "sleep_to_walk": 40,
    "sit_to_play": 20,
    "play_to_sit": 20,
    "turn_side_to_up": 32,
    "turn_side_to_down": 32,
    "turn_up_to_side": 32,
    "turn_down_to_side": 32,
    "turn_up_to_down": 64,
    "turn_down_to_up": 64,
}


SIZE_BY_FOLDER = {
    "stand": (220, 248),
    "sit": (220, 248),
    "sleep": (311, 199),
    "walk": (251, 222),
    "run_down": (300, 248),
    "run_side": (300, 248),
    "run_up": (300, 248),
    "eat_cookie": (275, 237),
    "eat_grape": (289, 256),
    "eat_carrot": (271, 247),
    "eat_melon": (268, 251),
    "happy": (260, 256),
    "groom": (274, 256),
    "sniff": (355, 222),
    "play": (299, 256),
    "stand_to_sit": (220, 248),
    "sit_to_stand": (220, 248),
    "stand_to_walk": (300, 237),
    "walk_to_stand": (299, 235),
    "sit_to_walk": (300, 237),
    "walk_to_sit": (299, 235),
    "walk_to_eat": (299, 235),
    "sit_to_eat": (299, 235),
    "eat_to_happy": (260, 256),
    "happy_to_sit": (260, 256),
    "happy_to_stand": (260, 256),
    "happy_to_walk": (300, 237),
    "walk_to_rest": (338, 217),
    "sit_to_rest": (338, 217),
    "stand_to_rest": (338, 217),
    "rest_to_sleep": (311, 199),
    "sleep_to_rest": (311, 199),
    "rest_to_sit": (325, 232),
    "rest_to_walk": (325, 232),
    "sleep_to_walk": (325, 232),
    "sit_to_play": (299, 256),
    "play_to_sit": (299, 256),
    "turn_side_to_up": (300, 248),
    "turn_side_to_down": (300, 248),
    "turn_up_to_side": (300, 248),
    "turn_down_to_side": (300, 248),
    "turn_up_to_down": (300, 248),
    "turn_down_to_up": (300, 248),
}


ACTION_LOOP_FOLDERS = {
    "eat_cookie",
    "eat_grape",
    "eat_carrot",
    "eat_melon",
    "happy",
    "groom",
    "sniff",
    "play",
}

FIT_BY_PET = {
    "appcopilot": 0.70,
    "timo": 0.78,
}

PREVIEW_DURATION_MS = {
    "walk": 59,
    "run_down": 63,
    "run_side": 59,
    "run_up": 63,
    "sleep": 667,
    "happy": 91,
    "groom": 125,
    "sniff": 143,
    "play": 91,
    "eat_cookie": 100,
    "eat_grape": 100,
    "eat_carrot": 100,
    "eat_melon": 100,
}


def copy_source_sheets() -> None:
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    for name, source in SOURCE_IMAGES.items():
        target = SHEET_DIR / f"{name}-model-sheet.png"
        if source.exists():
            shutil.copy2(source, target)
        elif not target.exists():
            raise FileNotFoundError(f"Missing generated spritesheet: {source} or {target}")


def remove_magenta(cell: Image.Image, keep_small_parts: bool = False) -> Image.Image:
    rgba = np.array(cell.convert("RGBA"))
    r = rgba[..., 0].astype(np.int16)
    g = rgba[..., 1].astype(np.int16)
    b = rgba[..., 2].astype(np.int16)
    key = (r > 165) & (b > 150) & (g < 95) & ((r - g) > 85) & ((b - g) > 70)
    rgba[key, 3] = 0
    rgba[rgba[..., 3] == 0, :3] = 0

    alpha = (rgba[..., 3] > 8).astype("uint8")
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(alpha, 8)
    if count <= 1:
        return Image.fromarray(rgba).convert("RGBA")

    areas = stats[1:, cv2.CC_STAT_AREA]
    max_area = int(areas.max()) if len(areas) else 0
    if not max_area:
        return Image.fromarray(rgba).convert("RGBA")

    keep = np.zeros(alpha.shape, dtype=bool)
    large_ids = []
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area >= max(14, max_area * (0.018 if keep_small_parts else 0.035)):
            large_ids.append(label)

    if not large_ids:
        large_ids = [1 + int(areas.argmax())]

    for label in large_ids:
        keep |= labels == label

    rgba[~keep, 3] = 0
    rgba[rgba[..., 3] == 0, :3] = 0
    return Image.fromarray(rgba).convert("RGBA")


def crop_subject(image: Image.Image, pad: int = 2) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        return image
    left, top, right, bottom = bbox
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(image.width, right + pad)
    bottom = min(image.height, bottom + pad)
    return image.crop((left, top, right, bottom))


def keep_largest_subject(image: Image.Image) -> Image.Image:
    rgba = np.array(image.convert("RGBA"))
    alpha = (rgba[..., 3] > 8).astype("uint8")
    count, labels, stats, _ = cv2.connectedComponentsWithStats(alpha, 8)
    if count <= 2:
        return image
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = 1 + int(areas.argmax())
    rgba[labels != largest, 3] = 0
    rgba[rgba[..., 3] == 0, :3] = 0
    return crop_subject(Image.fromarray(rgba).convert("RGBA"))


def split_grid(path: Path, cols: int, rows: int, keep_small_parts: bool = False) -> list[list[Image.Image]]:
    sheet = Image.open(path).convert("RGBA")
    cell_w = sheet.width / cols
    cell_h = sheet.height / rows
    output: list[list[Image.Image]] = []
    for row in range(rows):
        row_frames: list[Image.Image] = []
        for col in range(cols):
            box = (
                round(col * cell_w),
                round(row * cell_h),
                round((col + 1) * cell_w),
                round((row + 1) * cell_h),
            )
            cell = sheet.crop(box)
            clean = crop_subject(remove_magenta(cell, keep_small_parts=keep_small_parts))
            row_frames.append(clean)
        output.append(row_frames)
    return output


def extract_grid_by_components(
    path: Path,
    cols: int,
    rows: int,
    min_area: int = 420,
    max_cols: int = 10,
) -> list[list[Image.Image]]:
    sheet = Image.open(path).convert("RGBA")
    fallback = split_grid(path, cols, rows, keep_small_parts=True)
    output: list[list[Image.Image]] = []

    for row in range(rows):
        band_top = round(row * sheet.height / rows)
        band_bottom = round((row + 1) * sheet.height / rows)
        band = sheet.crop((0, band_top, sheet.width, band_bottom))
        rgba = np.array(band)
        r = rgba[..., 0].astype(np.int16)
        g = rgba[..., 1].astype(np.int16)
        b = rgba[..., 2].astype(np.int16)
        key = (r > 165) & (b > 150) & (g < 95) & ((r - g) > 85) & ((b - g) > 70)
        mask = (~key).astype("uint8")
        grouped = cv2.dilate(mask, np.ones((7, 7), np.uint8), iterations=1)
        count, _labels, stats, _ = cv2.connectedComponentsWithStats(grouped, 8)

        boxes: list[tuple[int, int, int, int, int]] = []
        for label in range(1, count):
            x, y, w, h, area = stats[label]
            if int(area) < min_area or w < 16 or h < 16:
                continue
            if w > sheet.width * 0.24 or h > band.height * 0.96:
                continue
            boxes.append((int(x), int(y), int(x + w), int(y + h), int(area)))

        if not boxes:
            output.append(fallback[row])
            continue

        max_area = max(area for *_rect, area in boxes)
        main_area = max(min_area * 1.6, max_area * 0.34)
        main_boxes = [
            box for box in boxes
            if box[4] >= main_area and (box[2] - box[0]) >= 24 and (box[3] - box[1]) >= 24
        ]
        if len(main_boxes) < 4:
            relaxed_area = max(min_area, max_area * 0.22)
            main_boxes = [box for box in boxes if box[4] >= relaxed_area]
        if len(main_boxes) < 4:
            output.append(fallback[row])
            continue

        main_boxes = sorted(main_boxes, key=lambda item: item[4], reverse=True)[:max_cols]
        main_boxes.sort(key=lambda item: item[0])

        frames: list[Image.Image] = []
        for left, top, right, bottom, _area in main_boxes:
            pad = 12
            crop = band.crop((
                max(0, left - pad),
                max(0, top - pad),
                min(band.width, right + pad),
                min(band.height, bottom + pad),
            ))
            frames.append(crop_subject(remove_magenta(crop, keep_small_parts=True)))
        output.append(frames)

    return output


def extract_rows_by_components(path: Path, rows: int, min_area: int = 500) -> list[list[Image.Image]]:
    sheet = Image.open(path).convert("RGBA")
    extracted: list[list[Image.Image]] = []
    for row in range(rows):
        top = round(row * sheet.height / rows)
        bottom = round((row + 1) * sheet.height / rows)
        band = sheet.crop((0, top, sheet.width, bottom))
        rgba = np.array(band.convert("RGBA"))
        r = rgba[..., 0].astype(np.int16)
        g = rgba[..., 1].astype(np.int16)
        b = rgba[..., 2].astype(np.int16)
        key = (r > 165) & (b > 150) & (g < 95) & ((r - g) > 85) & ((b - g) > 70)
        mask = (~key).astype("uint8")
        count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
        boxes = []
        for label in range(1, count):
            x, y, w, h, area = stats[label]
            if int(area) < min_area:
                continue
            if w < 18 or h < 18:
                continue
            boxes.append((int(x), int(y), int(x + w), int(y + h), int(area)))
        boxes.sort(key=lambda item: item[0])
        row_frames: list[Image.Image] = []
        for left, top_y, right, bottom_y, _area in boxes:
            pad = 6
            crop = band.crop((
                max(0, left - pad),
                max(0, top_y - pad),
                min(band.width, right + pad),
                min(band.height, bottom_y + pad),
            ))
            row_frames.append(crop_subject(remove_magenta(crop, keep_small_parts=True)))
        extracted.append(row_frames)
    return extracted


def flatten_rows(rows: list[list[Image.Image]]) -> list[Image.Image]:
    return [
        frame
        for row in rows
        for frame in row
        if frame.getchannel("A").getbbox()
    ]


def load_mochi_v2(name: str, keep_small_parts: bool = False, largest_only: bool = True) -> list[Image.Image]:
    path = MOCHI_V2_DIR / f"{name}.png"
    frames = flatten_rows(split_grid(path, 5, 4, keep_small_parts=keep_small_parts))
    if largest_only:
        return [keep_largest_subject(frame) for frame in frames]
    return frames


def load_walk_strip(pet_id: str) -> list[Image.Image]:
    path = WALK_STRIP_IMAGES.get(pet_id)
    if not path or not path.exists():
        return []
    rows = extract_rows_by_components(path, 1, min_area=1000)
    return [keep_largest_subject(frame) for frame in rows[0]] if rows else []


def load_action_strip(pet_id: str, folder: str) -> list[Image.Image]:
    path = ACTION_STRIP_IMAGES.get((pet_id, folder))
    if not path or not path.exists():
        return []
    rows = extract_rows_by_components(path, 1, min_area=1000)
    return [keep_largest_subject(frame) for frame in rows[0]] if rows else []


def pick_frames(frames: list[Image.Image], indexes: list[int]) -> list[Image.Image]:
    return [frames[index] for index in indexes if 0 <= index < len(frames)]


def fit_to_canvas(sprite: Image.Image, size: tuple[int, int], fit: float = 0.82) -> Image.Image:
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    if not sprite.getchannel("A").getbbox():
        return canvas
    scale = min((size[0] * fit) / sprite.width, (size[1] * fit) / sprite.height, 1.0 if max(sprite.size) < 64 else 10.0)
    resized = sprite.resize((max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))), Image.Resampling.NEAREST)
    x = (size[0] - resized.width) // 2
    y = size[1] - resized.height - max(2, round(size[1] * 0.03))
    canvas.alpha_composite(resized, (x, y))
    return canvas


def fit_sequence_to_canvas(frames: list[Image.Image], size: tuple[int, int], fit: float = 0.82) -> list[Image.Image]:
    sprites = [crop_subject(frame) for frame in frames]
    visible = [sprite for sprite in sprites if sprite.getchannel("A").getbbox()]
    if not visible:
        return [Image.new("RGBA", size, (0, 0, 0, 0)) for _ in frames]

    max_w = max(sprite.width for sprite in visible)
    max_h = max(sprite.height for sprite in visible)
    scale = min((size[0] * fit) / max_w, (size[1] * fit) / max_h, 1.0 if max(max_w, max_h) < 64 else 10.0)
    bottom_pad = max(2, round(size[1] * 0.03))
    output: list[Image.Image] = []
    for sprite in sprites:
        canvas = Image.new("RGBA", size, (0, 0, 0, 0))
        if not sprite.getchannel("A").getbbox():
            output.append(canvas)
            continue
        resized = sprite.resize((max(1, round(sprite.width * scale)), max(1, round(sprite.height * scale))), Image.Resampling.NEAREST)
        x = (size[0] - resized.width) // 2
        y = size[1] - resized.height - bottom_pad
        canvas.alpha_composite(resized, (x, y))
        output.append(canvas)
    return output


def sample_sequence(frames: list[Image.Image], count: int, pingpong: bool = False, reverse: bool = False, mode: str = "stretch") -> list[Image.Image]:
    source = list(reversed(frames)) if reverse else list(frames)
    if not source:
        return []
    if pingpong and len(source) > 2:
        source = source + source[-2:0:-1]
    if mode == "gait_cycle":
        if len(source) <= 8:
            held: list[Image.Image] = []
            for index, frame in enumerate(source):
                held.append(frame)
                if index in {0, len(source) // 2}:
                    held.append(frame)
            source = held
        return [source[index % len(source)] for index in range(count)]
    if mode == "held_cycle":
        held: list[Image.Image] = []
        for index, frame in enumerate(source):
            hold = 3 if len(source) <= 8 and index in {0, len(source) // 2} else 2
            held.extend([frame] * hold)
        return [held[index % len(held)] for index in range(count)]
    if mode == "pingpong_cycle":
        if len(source) > 2:
            source = source + source[-2:0:-1]
        return [source[index % len(source)] for index in range(count)]
    if mode == "cycle":
        return [source[index % len(source)] for index in range(count)]
    return [source[math.floor(i * len(source) / count) % len(source)] for i in range(count)]


def folder_mode(folder: str) -> str:
    if folder in {"walk", "run_side", "run_down", "run_up"}:
        return "gait_cycle"
    if folder in ACTION_LOOP_FOLDERS:
        return "pingpong_cycle"
    return "stretch"


def pet_fit(pet_id: str, folder: str) -> float:
    fit = FIT_BY_PET.get(pet_id, 0.82)
    if pet_id == "appcopilot" and folder == "sniff":
        return 0.64
    if pet_id == "appcopilot" and folder in {"groom", "play", "sit_to_play", "play_to_sit"}:
        return 0.73
    return fit


def write_folder(
    pet_id: str,
    folder: str,
    frames: list[Image.Image],
    reverse: bool = False,
    mode: str | None = None,
    fit: float | None = None,
) -> None:
    count = FRAME_COUNTS[folder]
    out_dir = ROOT / "assets" / pet_id / "frames" / folder
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    seq = sample_sequence(frames, count, reverse=reverse, mode=mode or folder_mode(folder))
    fit_value = pet_fit(pet_id, folder) if fit is None else fit
    for index, frame in enumerate(fit_sequence_to_canvas(seq, SIZE_BY_FOLDER[folder], fit=fit_value)):
        frame.save(out_dir / f"{folder}-{index:02d}.png")


def clean_frame_root(pet_id: str) -> None:
    frames_root = ROOT / "assets" / pet_id / "frames"
    if not frames_root.exists():
        return
    for child in frames_root.iterdir():
        if child.is_dir() and child.name not in FRAME_COUNTS:
            shutil.rmtree(child)


def build_pet_from_rows(pet_id: str, rows: list[list[Image.Image]]) -> None:
    if len(rows) >= 8:
        idle, side, front, back, sleep, happy, review, work = rows[:8]
    else:
        idle, side, front, back, sleep, happy = rows
        review = front
        work = happy
    sleep = [keep_largest_subject(frame) for frame in sleep]
    generated_walk = load_walk_strip(pet_id)
    side_walk = generated_walk or side
    if pet_id == "timo":
        explain = work
        teach = work + happy
        eat_cookie = happy
        eat_grape = review
        eat_carrot = teach
        eat_melon = happy + review
    elif pet_id == "appcopilot":
        explain = load_action_strip("appcopilot", "sniff") or work
        teach = work + review
        eat_cookie = happy
        eat_grape = review
        eat_carrot = work
        eat_melon = happy + work
    else:
        explain = review
        teach = work
        eat_cookie = work
        eat_grape = work
        eat_carrot = work
        eat_melon = work
    mapping = {
        "stand": idle,
        "sit": idle,
        "sleep": sleep,
        "walk": side_walk,
        "run_side": side_walk,
        "run_down": front,
        "run_up": back,
        "eat_cookie": eat_cookie,
        "eat_grape": eat_grape,
        "eat_carrot": eat_carrot,
        "eat_melon": eat_melon,
        "happy": happy,
        "groom": review,
        "sniff": explain,
        "play": teach,
        "stand_to_sit": idle,
        "sit_to_stand": idle,
        "stand_to_walk": side_walk,
        "walk_to_stand": side_walk,
        "sit_to_walk": side_walk,
        "walk_to_sit": side_walk,
        "walk_to_eat": side_walk,
        "sit_to_eat": eat_cookie,
        "eat_to_happy": happy,
        "happy_to_sit": happy,
        "happy_to_stand": happy,
        "happy_to_walk": side_walk,
        "walk_to_rest": side_walk,
        "sit_to_rest": idle,
        "stand_to_rest": idle,
        "rest_to_sleep": sleep,
        "sleep_to_rest": sleep,
        "rest_to_sit": idle,
        "rest_to_walk": side_walk,
        "sleep_to_walk": side_walk,
        "sit_to_play": teach,
        "play_to_sit": teach,
        "turn_side_to_up": back,
        "turn_side_to_down": front,
        "turn_up_to_side": back,
        "turn_down_to_side": front,
        "turn_up_to_down": back + front,
        "turn_down_to_up": front + back,
    }
    for folder, frames in mapping.items():
        reverse = folder in {"walk_to_stand", "walk_to_sit", "sleep_to_rest", "play_to_sit", "happy_to_sit", "happy_to_stand"}
        write_folder(pet_id, folder, frames, reverse=reverse)


def build_mochi() -> None:
    run_sleep = extract_rows_by_components(SHEET_DIR / "mochi_run_sleep-model-sheet.png", 2)
    direction = extract_rows_by_components(SHEET_DIR / "mochi_direction-model-sheet.png", 6)
    side_16 = run_sleep[0]
    sleep_16 = run_sleep[1]
    _, front, back, side_to_front, side_to_back, sleep_8 = direction
    side_walk = load_walk_strip("mochi") or side_16
    mapping = {
        "walk": side_walk,
        "run_side": side_walk,
        "run_down": front,
        "run_up": back,
        "stand_to_walk": side_walk,
        "walk_to_stand": side_walk,
        "sit_to_walk": side_walk,
        "walk_to_sit": side_walk,
        "walk_to_eat": side_walk,
        "happy_to_walk": side_walk,
        "walk_to_rest": side_walk,
        "rest_to_walk": side_walk,
        "sleep_to_walk": side_walk,
        "turn_side_to_up": side_to_back,
        "turn_side_to_down": side_to_front,
        "turn_up_to_side": side_to_back,
        "turn_down_to_side": side_to_front,
        "turn_up_to_down": back + front,
        "turn_down_to_up": front + back,
        "sleep": sleep_16,
        "rest_to_sleep": sleep_8,
        "sleep_to_rest": sleep_8,
    }
    for folder, frames in mapping.items():
        reverse = folder in {"walk_to_stand", "walk_to_sit", "sleep_to_rest", "turn_up_to_side", "turn_down_to_side"}
        write_folder("mochi", folder, frames, reverse=reverse)


def build_mochi_interactions() -> None:
    idle = load_mochi_v2("mochi-idle-20")
    happy = load_mochi_v2("mochi-happy-20")
    groom = load_mochi_v2("mochi-groom-20")
    sniff_source = load_mochi_v2("mochi-sniff-20")
    play_source = load_mochi_v2("mochi-happy-20")
    cookie = load_mochi_v2("mochi-eat-cookie-20", keep_small_parts=True, largest_only=False)
    grape = load_mochi_v2("mochi-eat-grape-20", keep_small_parts=True, largest_only=False)
    carrot = load_mochi_v2("mochi-eat-carrot-20", keep_small_parts=True, largest_only=False)
    melon = load_mochi_v2("mochi-eat-melon-20", keep_small_parts=True, largest_only=False)
    sleep = [
        Image.open(path).convert("RGBA")
        for path in sorted((ROOT / "assets" / "mochi" / "frames" / "sleep").glob("*.png"))
    ]

    sniff = pick_frames(sniff_source, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 16, 15, 14, 13, 12])
    play = pick_frames(play_source, list(range(20)))

    def write(folder: str, frames: list[Image.Image], reverse: bool = False, mode: str | None = None, fit: float = 0.78) -> None:
        write_folder("mochi", folder, frames, reverse=reverse, mode=mode, fit=fit)

    write("stand", idle, mode="pingpong_cycle")
    write("sit", idle, mode="pingpong_cycle")
    write("stand_to_sit", idle, mode="stretch")
    write("sit_to_stand", idle, reverse=True, mode="stretch")
    write("happy", happy)
    write("groom", groom)
    write("sniff", sniff)
    write("play", play)
    write("eat_cookie", cookie, fit=0.80)
    write("eat_grape", grape, fit=0.80)
    write("eat_carrot", carrot, fit=0.80)
    write("eat_melon", melon, fit=0.80)
    write("sit_to_eat", idle[:5] + cookie[:10], mode="stretch", fit=0.80)
    write("eat_to_happy", cookie[-5:] + happy[:12], mode="stretch", fit=0.80)
    write("happy_to_sit", happy, reverse=True, mode="stretch")
    write("happy_to_stand", happy, reverse=True, mode="stretch")
    write("sit_to_play", idle[:5] + play[:10], mode="stretch")
    write("play_to_sit", play[:10] + idle[:5], reverse=True, mode="stretch")
    write("sit_to_rest", idle[:5] + sleep[:8], mode="stretch", fit=0.80)
    write("stand_to_rest", idle[:5] + sleep[:8], mode="stretch", fit=0.80)
    write("rest_to_sit", sleep[:8] + idle[:8], mode="stretch", fit=0.80)


def metrics_for_frames(pet_id: str) -> dict[str, dict[str, float | int]]:
    frames_root = ROOT / "assets" / pet_id / "frames"
    metrics: dict[str, dict[str, float | int]] = {}
    for path in sorted(frames_root.rglob("*.png")):
        image = Image.open(path).convert("RGBA")
        alpha = np.asarray(image.getchannel("A"))
        ys, xs = np.nonzero(alpha > 8)
        rel = path.relative_to(frames_root.parent).as_posix()
        if len(xs) == 0:
            metrics[rel] = {"w": image.width, "h": image.height, "l": 0, "r": 0, "t": 0, "b": 0, "a": image.width / 2}
            continue
        left, right = int(xs.min()), int(xs.max()) + 1
        top, bottom = int(ys.min()), int(ys.max()) + 1
        metrics[rel] = {
            "w": image.width,
            "h": image.height,
            "l": left,
            "r": right,
            "t": top,
            "b": bottom,
            "a": round((left + right) / 2, 2),
        }
    return metrics


def write_metrics(pet_id: str, variable: str) -> None:
    output = ROOT / "assets" / pet_id / f"{pet_id}-frame-metrics.js"
    payload = json.dumps(metrics_for_frames(pet_id), separators=(",", ":"))
    output.write_text(f"window.{variable} = {payload};\n", encoding="utf-8")


def contact_sheet(pet_id: str, rows: list[str], output: Path) -> None:
    cells: list[tuple[str, Image.Image]] = []
    for row in rows:
        for path in sorted((ROOT / "assets" / pet_id / "frames" / row).glob("*.png")):
            image = Image.open(path).convert("RGBA")
            image.thumbnail((72, 72), Image.Resampling.NEAREST)
            cells.append((path.stem.split("-")[-1], image.copy()))
    cols = 20
    cell_w, cell_h = 82, 94
    sheet = Image.new("RGBA", (cols * cell_w, math.ceil(len(cells) / cols) * cell_h + 26), (255, 255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    draw.text((6, 6), f"{pet_id}: {', '.join(rows)}", fill=(0, 0, 0, 255))
    for index, (label, image) in enumerate(cells):
        x = (index % cols) * cell_w
        y = (index // cols) * cell_h + 26
        draw.text((x + 4, y + 3), label, fill=(0, 0, 0, 255))
        sheet.alpha_composite(image, (x + (cell_w - image.width) // 2, y + 20 + (cell_h - 24 - image.height) // 2))
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(output)


def render_preview_frame(frame: Image.Image, stage_size: tuple[int, int] = (224, 192), margin: int = 8) -> Image.Image:
    stage = Image.new("RGBA", stage_size, (255, 255, 255, 0))
    frame = frame.copy()
    scale = min((stage_size[0] - margin * 2) / frame.width, (stage_size[1] - margin * 2) / frame.height)
    resized = frame.resize(
        (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
        Image.Resampling.NEAREST,
    )
    stage.alpha_composite(resized, ((stage_size[0] - resized.width) // 2, stage_size[1] - resized.height - margin))
    return stage


def gif_preview(pet_id: str, row: str, output: Path, duration: int = 42) -> None:
    images = []
    for path in sorted((ROOT / "assets" / pet_id / "frames" / row).glob("*.png")):
        frame = Image.open(path).convert("RGBA")
        images.append(render_preview_frame(frame))
    if images:
        output.parent.mkdir(parents=True, exist_ok=True)
        images[0].save(output, save_all=True, append_images=images[1:], duration=duration, loop=0, disposal=2)


def preview_duration(row: str) -> int:
    return PREVIEW_DURATION_MS.get(row, 100)


def audit_frame(path: Path) -> dict[str, float | int | str]:
    image = Image.open(path).convert("RGBA")
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.nonzero(alpha > 8)
    digest = hashlib.sha1(image.tobytes()).hexdigest()[:12]
    if len(xs) == 0:
        return {
            "w": image.width,
            "h": image.height,
            "empty": 1,
            "left": 0,
            "right": 0,
            "top": 0,
            "bottom": 0,
            "anchor": image.width / 2,
            "area": 0,
            "hash": digest,
        }
    left, right = int(xs.min()), int(xs.max()) + 1
    top, bottom = int(ys.min()), int(ys.max()) + 1
    return {
        "w": image.width,
        "h": image.height,
        "empty": 0,
        "left": left,
        "right": right,
        "top": top,
        "bottom": bottom,
        "anchor": round((left + right) / 2, 2),
        "area": int(len(xs)),
        "hash": digest,
    }


def value_range(records: list[dict[str, float | int | str]], key: str) -> list[float]:
    values = [float(record[key]) for record in records]
    if not values:
        return [0, 0]
    return [round(min(values), 2), round(max(values), 2)]


def max_delta(records: list[dict[str, float | int | str]], key: str) -> float:
    values = [float(record[key]) for record in records]
    if len(values) < 2:
        return 0
    return round(max(abs(values[index] - values[index - 1]) for index in range(1, len(values))), 2)


def audit_folder(pet_id: str, folder: str) -> dict[str, float | int | list[float]]:
    paths = sorted((ROOT / "assets" / pet_id / "frames" / folder).glob("*.png"))
    records = [audit_frame(path) for path in paths]
    hashes = [str(record["hash"]) for record in records]
    widths = [float(record["right"]) - float(record["left"]) for record in records]
    heights = [float(record["bottom"]) - float(record["top"]) for record in records]
    return {
        "frames": len(records),
        "empty_frames": sum(int(record["empty"]) for record in records),
        "unique_frames": len(set(hashes)),
        "duplicate_frames": max(0, len(records) - len(set(hashes))),
        "width_range": [round(min(widths), 2), round(max(widths), 2)] if widths else [0, 0],
        "height_range": [round(min(heights), 2), round(max(heights), 2)] if heights else [0, 0],
        "top_range": value_range(records, "top"),
        "bottom_range": value_range(records, "bottom"),
        "anchor_range": value_range(records, "anchor"),
        "area_range": value_range(records, "area"),
        "max_anchor_delta": max_delta(records, "anchor"),
        "max_bottom_delta": max_delta(records, "bottom"),
        "max_area_delta": max_delta(records, "area"),
    }


def write_motion_audit(output: Path) -> None:
    rows = [
        "stand",
        "sit",
        "walk",
        "run_side",
        "run_down",
        "run_up",
        "stand_to_walk",
        "walk_to_stand",
        "sit_to_walk",
        "walk_to_sit",
        "happy_to_walk",
        "sleep_to_walk",
        "sleep",
        "happy",
        "groom",
        "sniff",
        "play",
        "eat_cookie",
        "eat_grape",
        "eat_carrot",
        "eat_melon",
        "sit_to_play",
        "play_to_sit",
        "sit_to_rest",
        "rest_to_sit",
    ]
    audit = {
        pet_id: {row: audit_folder(pet_id, row) for row in rows}
        for pet_id in ["mochi", "appcopilot", "timo"]
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(audit, indent=2), encoding="utf-8")


def main() -> None:
    copy_source_sheets()
    for pet_id in ["mochi", "appcopilot", "timo"]:
        clean_frame_root(pet_id)
    build_pet_from_rows("appcopilot", extract_grid_by_components(SHEET_DIR / "appcopilot-model-sheet.png", 8, 8))
    build_pet_from_rows("timo", extract_grid_by_components(SHEET_DIR / "timo-model-sheet.png", 8, 8))
    build_mochi()
    build_mochi_interactions()

    write_metrics("mochi", "MOCHI_FRAME_METRICS")
    write_metrics("appcopilot", "APPCOPILOT_FRAME_METRICS")
    write_metrics("timo", "TIMO_FRAME_METRICS")

    qa = ROOT / "assets" / "mochi" / "qa"
    contact_sheet("mochi", ["walk", "run_down", "run_up", "sleep"], qa / "mochi-model-contact.png")
    contact_sheet(
        "mochi",
        ["stand", "sit", "happy", "groom", "sniff", "play", "eat_cookie", "eat_grape", "eat_carrot", "eat_melon"],
        qa / "mochi-model-actions-contact.png",
    )
    contact_sheet("appcopilot", ["stand", "walk", "run_down", "run_up", "sleep", "happy", "groom", "play"], qa / "appcopilot-model-contact.png")
    contact_sheet(
        "appcopilot",
        ["happy", "groom", "sniff", "play", "eat_cookie", "eat_grape", "eat_carrot", "eat_melon"],
        qa / "appcopilot-model-actions-contact.png",
    )
    contact_sheet("timo", ["stand", "walk", "run_down", "run_up", "sleep", "happy", "groom", "play"], qa / "timo-model-contact.png")
    contact_sheet(
        "timo",
        ["happy", "groom", "sniff", "play", "eat_cookie", "eat_grape", "eat_carrot", "eat_melon"],
        qa / "timo-model-actions-contact.png",
    )
    for pet_id in ["mochi", "appcopilot", "timo"]:
        gif_preview(pet_id, "walk", qa / f"{pet_id}-model-walk-preview.gif", duration=preview_duration("walk"))
        gif_preview(pet_id, "sleep", qa / f"{pet_id}-model-sleep-preview.gif", duration=preview_duration("sleep"))
    for pet_id in ["mochi", "appcopilot", "timo"]:
        for row in ["happy", "groom", "sniff", "play", "eat_cookie"]:
            gif_preview(pet_id, row, qa / f"{pet_id}-model-{row.replace('_', '-')}-preview.gif", duration=preview_duration(row))
    for pet_id in ["appcopilot", "timo"]:
        gif_preview(pet_id, "groom", qa / f"{pet_id}-model-review-preview.gif", duration=preview_duration("groom"))
        gif_preview(pet_id, "play", qa / f"{pet_id}-model-work-preview.gif", duration=preview_duration("play"))
    write_motion_audit(qa / "model-motion-audit.json")


if __name__ == "__main__":
    main()
