"""Encode unmodified browser screenshot frames as a looping GIF."""
import sys
from pathlib import Path
from PIL import Image

source, output = map(Path, sys.argv[1:3])
frames = [Image.open(path).convert('RGB') for path in sorted(source.glob('*.png'))]
# One palette for the complete sequence prevents frame-to-frame color flicker.
contact = Image.new('RGB', (frames[0].width, frames[0].height * min(12, len(frames))))
for row in range(min(12, len(frames))):
    contact.paste(frames[row * (len(frames) - 1) // max(1, min(12, len(frames)) - 1)], (0, row * frames[0].height))
palette = contact.quantize(colors=256)
indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
indexed[0].save(output, save_all=True, append_images=indexed[1:], duration=50, loop=0, optimize=True, disposal=1)
print(output)
