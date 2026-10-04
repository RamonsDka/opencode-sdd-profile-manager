"""Exporta los frames del smoke OpenTUI a PNG. Solo desarrollo; requiere Pillow."""
from PIL import Image, ImageDraw, ImageFont
import json
import pathlib

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 16)
cw, ch = font.getlength('M'), 22
for file in pathlib.Path('assets').glob('tui-*.json'):
    frame = json.loads(file.read_text())
    last = max((i for i, line in enumerate(frame['lines']) if ''.join(s['text'] for s in line['spans']).strip()), default=0)
    img = Image.new('RGB', (round(frame['cols'] * cw + 48), (last + 1) * ch + 48), '#080d15')
    draw = ImageDraw.Draw(img)
    for y, line in enumerate(frame['lines'][:last + 1]):
        x = 0
        for span in line['spans']:
            def rgb(color):
                return tuple(int(color['buffer'][str(i)]) for i in range(3))
            w = span['width'] * cw
            draw.rectangle((24+x, 24+y*ch, 24+x+w, 24+(y+1)*ch), fill=rgb(span['bg']))
            draw.text((24+x, 24+y*ch+1), span['text'], font=font, fill=rgb(span['fg']))
            x += w
    img.save(file.with_suffix('.png'))
