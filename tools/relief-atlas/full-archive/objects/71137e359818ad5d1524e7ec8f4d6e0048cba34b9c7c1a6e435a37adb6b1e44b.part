import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


CROP_FRACTIONS = (0.20, 0.57, 0.665, 0.84)
BACKGROUND = '#eeeae2'
CARD = '#f9f7f2'
INK = '#34434b'
MUTED = '#65747a'
ACCENT = '#ab7f35'


def load_font(size):
    candidates = (
        Path('C:/Windows/Fonts/msyh.ttc'),
        Path('C:/Windows/Fonts/simsun.ttc'),
        Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),
        Path('/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'),
    )
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size)
    raise FileNotFoundError('No Chinese font found for the comparison titles')


def centered_text(draw, center_x, top, text, font, fill=INK):
    draw.text((center_x, top), text, font=font, fill=fill, anchor='mt')


def fit_image(canvas, source, box):
    left, top, right, bottom = box
    fitted = ImageOps.contain(source, (right - left, bottom - top), Image.Resampling.LANCZOS)
    xpos = left + (right - left - fitted.width) // 2
    ypos = top + (bottom - top - fitted.height) // 2
    canvas.paste(fitted, (xpos, ypos))
    return xpos, ypos, fitted.width, fitted.height


def make_comparison(root, final=False):
    review = root / 'lighting_review'
    if final:
        sources = (
            ('原版 · 太阳高度 48.3°', review / 'hainan_before.png'),
            ('正式版 · 太阳高度 32°', root / 'renders' / 'hainan_terrain.png'),
        )
        output = root / 'outputs' / 'lighting_comparison.jpg'
        subtitle = '原版与正式渲染对照 · 上方整图，下方为相同位置的山体局部'
        footnote = '两幅图均读取全尺寸无文字地形渲染；金色框表示局部放大范围。'
    else:
        sources = (
            ('原版 · 太阳高度 48.3°', review / 'hainan_before.png'),
            ('候选 · 太阳高度 32°', review / 'hainan_sun_32.png'),
            ('候选 · 太阳高度 24°', review / 'hainan_sun_24.png'),
        )
        output = review / 'hainan_candidates.jpg'
        subtitle = '灯光角度候选对照 · 上方整图，下方为相同位置的山体局部'
        footnote = '候选图为 50% 分辨率预览；金色框表示局部放大范围，细节锐度仅供参考。'

    missing = [str(path) for _, path in sources if not path.is_file()]
    if missing:
        raise FileNotFoundError('Missing comparison input: ' + ', '.join(missing))
    images = []
    for _, path in sources:
        with Image.open(path) as source:
            source.load()
            images.append(source.convert('RGB'))
    reference_width, reference_height = images[0].size
    for (_, path), source in zip(sources, images):
        if source.width * reference_height != source.height * reference_width:
            raise ValueError(f'Image aspect ratio differs from the original: {path}')
        if final and source.size != (reference_width, reference_height):
            raise ValueError(f'Final image dimensions differ from the original: {path}')

    column_width = 620 if final else 480
    margin = 20
    canvas = Image.new('RGB', (column_width * len(sources) + margin * 2, 1120), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    title_font = load_font(31)
    column_font = load_font(22)
    caption_font = load_font(19)
    note_font = load_font(17)
    centered_text(draw, canvas.width // 2, 22, '海南地形 · 斜向日光对照', title_font)
    centered_text(draw, canvas.width // 2, 69, subtitle, note_font, MUTED)

    for index, ((title, _), source) in enumerate(zip(sources, images)):
        left = margin + index * column_width
        center_x = left + column_width // 2
        draw.rounded_rectangle((left + 6, 106, left + column_width - 6, 1061), radius=12, fill=CARD)
        centered_text(draw, center_x, 122, title, column_font)
        overview_box = (left + 24, 164, left + column_width - 24, 648)
        overview_x, overview_y, overview_width, overview_height = fit_image(canvas, source, overview_box)
        crop_box = tuple(round(fraction * dimension) for fraction, dimension in zip(
            CROP_FRACTIONS, (source.width, source.height, source.width, source.height)
        ))
        overview_crop = (
            overview_x + round(CROP_FRACTIONS[0] * overview_width),
            overview_y + round(CROP_FRACTIONS[1] * overview_height),
            overview_x + round(CROP_FRACTIONS[2] * overview_width),
            overview_y + round(CROP_FRACTIONS[3] * overview_height),
        )
        draw.rectangle(overview_crop, outline=ACCENT, width=2)
        centered_text(draw, center_x, 667, '海南中南部山体 · 同一区域', caption_font, MUTED)
        detail = source.crop(crop_box)
        fit_image(canvas, detail, (left + 24, 709, left + column_width - 24, 1041))

    centered_text(draw, canvas.width // 2, 1080, footnote, note_font, MUTED)
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, quality=95, subsampling=0)
    print(f'Wrote {output} ({canvas.width} x {canvas.height})')
    return output


def main():
    parser = argparse.ArgumentParser(description='Compare Hainan sunlight elevations using matched map crops.')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--final', action='store_true', help='Compare the original against the full-resolution final terrain render.')
    arguments = parser.parse_args()
    make_comparison(arguments.root.resolve(), final=arguments.final)


if __name__ == '__main__':
    main()
