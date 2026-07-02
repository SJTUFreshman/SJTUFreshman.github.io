from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
SHEET_DIR = ROOT / "assets" / "generated-spritesheets"

SOURCE_IMAGES = {
    "appcopilot": Path(
        r"C:\Users\Administrator.DESKTOP-RN0CUUV\.codex\generated_images\019f1d54-2ccd-7031-9875-22539d785ec7\ig_02d5870e846e601c016a45d43215ac8191a78040f0fe06b6eb.png"
    ),
    "timo": Path(
        r"C:\Users\Administrator.DESKTOP-RN0CUUV\.codex\generated_images\019f1d54-2ccd-7031-9875-22539d785ec7\ig_02d5870e846e601c016a45d50544488191a45d2cbb535b0025.png"
    ),
    "mochi_run_sleep": Path(
        r"C:\Users\Administrator.DESKTOP-RN0CUUV\.codex\generated_images\019f1d54-2ccd-7031-9875-22539d785ec7\ig_0e19e2281236e453016a45c5c017e081919f1b1f9575e522ed.png"
    ),
    "mochi_direction": Path(
        r"C:\Users\Administrator.DESKTOP-RN0CUUV\.codex\generated_images\019f1d54-2ccd-7031-9875-22539d785ec7\ig_0281962292f7c90f016a45c68260c48191b3f6e98885f6a3bb.png"
    ),
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


def extract_grid_by_components(path: Path, cols: int, rows: int, min_area: int = 420) -> list[list[Image.Image]]:
    sheet = Image.open(path).convert("RGBA")
    rgba = np.array(sheet)
    r = rgba[..., 0].astype(np.int16)
    g = rgba[..., 1].astype(np.int16)
    b = rgba[..., 2].astype(np.int16)
    key = (r > 165) & (b > 150) & (g < 95) & ((r - g) > 85) & ((b - g) > 70)
    mask = (~key).astype("uint8")
    kernel = np.ones((9, 9), np.uint8)
    grouped = cv2.dilate(mask, kernel, iterations=1)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(grouped, 8)
    row_boxes: list[list[tuple[int, int, int, int, int]]] = [[] for _ in range(rows)]
    max_cell_w = sheet.width / cols
    max_cell_h = sheet.height / rows

    for label in range(1, count):
        x, y, w, h, area = stats[label]
        if int(area) < min_area or w < 16 or h < 16:
            continue
        if w > max_cell_w * 1.8 or h > max_cell_h * 1.9:
            continue
        center_y = int(y + h / 2)
        row = min(rows - 1, max(0, int(center_y * rows / sheet.height)))
        row_boxes[row].append((int(x), int(y), int(x + w), int(y + h), int(area)))

    output: list[list[Image.Image]] = []
    fallback = split_grid(path, cols, rows, keep_small_parts=True)
    for row, boxes in enumerate(row_boxes):
        if len(boxes) < max(3, cols // 2):
            output.append(fallback[row])
            continue
        boxes = sorted(boxes, key=lambda item: item[4], reverse=True)[:cols]
        boxes.sort(key=lambda item: item[0])
        frames: list[Image.Image] = []
        for left, top, right, bottom, _area in boxes:
            pad = 5
            crop = sheet.crop((
                max(0, left - pad),
                max(0, top - pad),
                min(sheet.width, right + pad),
                min(sheet.height, bottom + pad),
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


def sample_sequence(frames: list[Image.Image], count: int, pingpong: bool = False, reverse: bool = False) -> list[Image.Image]:
    source = list(reversed(frames)) if reverse else list(frames)
    if pingpong and len(source) > 2:
        source = source + source[-2:0:-1]
    return [source[math.floor(i * len(source) / count) % len(source)] for i in range(count)]


def write_folder(pet_id: str, folder: str, frames: list[Image.Image], reverse: bool = False) -> None:
    count = FRAME_COUNTS[folder]
    out_dir = ROOT / "assets" / pet_id / "frames" / folder
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    seq = sample_sequence(frames, count, reverse=reverse)
    for index, frame in enumerate(seq):
        fit_to_canvas(frame, SIZE_BY_FOLDER[folder]).save(out_dir / f"{folder}-{index:02d}.png")


def build_pet_from_rows(pet_id: str, rows: list[list[Image.Image]]) -> None:
    if len(rows) >= 8:
        idle, side, front, back, sleep, happy, review, work = rows[:8]
    else:
        idle, side, front, back, sleep, happy = rows
        review = front
        work = happy
    sleep = [keep_largest_subject(frame) for frame in sleep]
    mapping = {
        "stand": idle,
        "sit": idle,
        "sleep": sleep,
        "walk": side,
        "run_side": side,
        "run_down": front,
        "run_up": back,
        "eat_cookie": work,
        "eat_grape": work,
        "eat_carrot": work,
        "eat_melon": work,
        "happy": happy,
        "groom": review,
        "sniff": review,
        "play": work,
        "stand_to_sit": idle,
        "sit_to_stand": idle,
        "stand_to_walk": side,
        "walk_to_stand": side,
        "sit_to_walk": side,
        "walk_to_sit": side,
        "walk_to_eat": side,
        "sit_to_eat": work,
        "eat_to_happy": happy,
        "happy_to_sit": happy,
        "happy_to_stand": happy,
        "happy_to_walk": side,
        "walk_to_rest": side,
        "sit_to_rest": idle,
        "stand_to_rest": idle,
        "rest_to_sleep": sleep,
        "sleep_to_rest": sleep,
        "rest_to_sit": idle,
        "rest_to_walk": side,
        "sleep_to_walk": side,
        "sit_to_play": work,
        "play_to_sit": work,
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
    mapping = {
        "walk": side_16,
        "run_side": side_16,
        "run_down": front,
        "run_up": back,
        "stand_to_walk": side_16,
        "walk_to_stand": side_16,
        "sit_to_walk": side_16,
        "walk_to_sit": side_16,
        "walk_to_eat": side_16,
        "happy_to_walk": side_16,
        "walk_to_rest": side_16,
        "rest_to_walk": side_16,
        "sleep_to_walk": side_16,
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


def gif_preview(pet_id: str, row: str, output: Path, duration: int = 42) -> None:
    images = []
    for path in sorted((ROOT / "assets" / pet_id / "frames" / row).glob("*.png")):
        frame = Image.open(path).convert("RGBA")
        stage = Image.new("RGBA", (224, 170), (255, 255, 255, 0))
        frame.thumbnail((186, 154), Image.Resampling.NEAREST)
        stage.alpha_composite(frame, ((224 - frame.width) // 2, 170 - frame.height))
        images.append(stage)
    if images:
        output.parent.mkdir(parents=True, exist_ok=True)
        images[0].save(output, save_all=True, append_images=images[1:], duration=duration, loop=0, disposal=2)


def main() -> None:
    copy_source_sheets()
    build_pet_from_rows("appcopilot", extract_grid_by_components(SHEET_DIR / "appcopilot-model-sheet.png", 8, 8))
    build_pet_from_rows("timo", extract_grid_by_components(SHEET_DIR / "timo-model-sheet.png", 8, 8))
    build_mochi()

    write_metrics("mochi", "MOCHI_FRAME_METRICS")
    write_metrics("appcopilot", "APPCOPILOT_FRAME_METRICS")
    write_metrics("timo", "TIMO_FRAME_METRICS")

    qa = ROOT / "assets" / "mochi" / "qa"
    contact_sheet("mochi", ["walk", "run_down", "run_up", "sleep"], qa / "mochi-model-contact.png")
    contact_sheet("appcopilot", ["stand", "walk", "run_down", "run_up", "sleep", "happy", "groom", "play"], qa / "appcopilot-model-contact.png")
    contact_sheet("timo", ["stand", "walk", "run_down", "run_up", "sleep", "happy", "groom", "play"], qa / "timo-model-contact.png")
    for pet_id in ["mochi", "appcopilot", "timo"]:
        gif_preview(pet_id, "walk", qa / f"{pet_id}-model-walk-preview.gif")
        gif_preview(pet_id, "sleep", qa / f"{pet_id}-model-sleep-preview.gif", duration=250)
    for pet_id in ["appcopilot", "timo"]:
        gif_preview(pet_id, "groom", qa / f"{pet_id}-model-review-preview.gif", duration=110)
        gif_preview(pet_id, "play", qa / f"{pet_id}-model-work-preview.gif", duration=90)


if __name__ == "__main__":
    main()
