from pathlib import Path
from PIL import Image, ImageDraw
import sys
root=Path(sys.argv[1])
for directory in sorted(root.iterdir()):
    if not directory.is_dir(): continue
    paths=sorted(directory.glob('*.png'))
    if len(paths)<3: continue
    sheet=Image.new('RGB',(1100, int(760/2+28)*3),(18,23,29))
    for i in range(6):
        index=min(len(paths)-1,round(i*(len(paths)-1)/5))
        frame=Image.open(paths[index]); frame.thumbnail((550,380))
        x=(i%2)*550; y=(i//2)*408
        sheet.paste(frame,(x,y+28)); ImageDraw.Draw(sheet).text((x+8,y+8),f'{directory.name}: {index*50} ms',fill='white')
    sheet.save(root/f'{directory.name}-contact.jpg')
