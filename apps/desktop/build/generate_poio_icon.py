from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).parent
SIZE = 1024


def rounded_gradient() -> Image.Image:
    image = Image.new("RGBA", (SIZE, SIZE))
    pixels = image.load()
    for y in range(SIZE):
        for x in range(SIZE):
            t = (x + y) / (2 * (SIZE - 1))
            pixels[x, y] = (
                round(143 - 50 * t),
                round(112 - 55 * t),
                round(255 - 5 * t),
                255,
            )
    mask = Image.new("L", (SIZE, SIZE))
    ImageDraw.Draw(mask).rounded_rectangle((34, 34, SIZE - 34, SIZE - 34), radius=235, fill=255)
    image.putalpha(mask)
    return image


def wordmark() -> Image.Image:
    layer = Image.new("RGBA", (1500, 700))
    draw = ImageDraw.Draw(layer)
    font_path = Path(r"C:\Windows\Fonts\arialbd.ttf")
    font = ImageFont.truetype(str(font_path), 285)
    text = "POIO"
    box = draw.textbbox((0, 0), text, font=font, stroke_width=4)
    width = box[2] - box[0]
    height = box[3] - box[1]
    x = (layer.width - width) // 2
    y = (layer.height - height) // 2 - box[1]
    draw.text((x + 24, y + 32), text, font=font, fill=(25, 14, 74, 155), stroke_width=8, stroke_fill=(25, 14, 74, 80))
    draw.text((x, y), text, font=font, fill="white", stroke_width=5, stroke_fill=(255, 255, 255, 245))
    shear = 0.16
    transformed = layer.transform(
        layer.size,
        Image.Transform.AFFINE,
        (1, shear, -70, 0, 1, 0),
        resample=Image.Resampling.BICUBIC,
    )
    bbox = transformed.getbbox()
    return transformed.crop(bbox)


icon = rounded_gradient()
shine = Image.new("RGBA", (SIZE, SIZE))
ImageDraw.Draw(shine).ellipse((-220, -390, 920, 570), fill=(255, 255, 255, 35))
shine = shine.filter(ImageFilter.GaussianBlur(40))
icon.alpha_composite(shine)

mark = wordmark()
mark.thumbnail((800, 430), Image.Resampling.LANCZOS)
icon.alpha_composite(mark, ((SIZE - mark.width) // 2, (SIZE - mark.height) // 2 - 8))

icon.save(ROOT / "icon-source.png")
icon.resize((512, 512), Image.Resampling.LANCZOS).save(ROOT / "icon.png")
icon.save(ROOT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
