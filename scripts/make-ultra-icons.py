"""Draw poe2ultra's own geometric book/U icon, independent of upstream branding."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / 'public' / 'icon'
root.mkdir(parents=True, exist_ok=True)
image = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((12, 12, 500, 500), radius=106, fill='#14171e')
draw.polygon([(96, 118), (228, 160), (228, 398), (96, 352)], fill='#e8a15a')
draw.polygon([(284, 160), (416, 118), (416, 352), (284, 398)], fill='#69beb5')
draw.line([(132, 204), (191, 224)], fill='#14171e', width=16)
draw.line([(132, 260), (191, 280)], fill='#14171e', width=16)
draw.line([(322, 224), (381, 204)], fill='#14171e', width=16)
draw.line([(322, 280), (381, 260)], fill='#14171e', width=16)
for size in (16, 32, 48, 96, 128):
    image.resize((size, size), Image.Resampling.LANCZOS).save(root / f'{size}.png')
print('Generated poe2ultra icons.')
