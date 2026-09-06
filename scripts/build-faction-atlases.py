"""Export image-generated chroma masters into guarded, lossless Pixi atlases.

Creative image changes happen in image generation; this script only extracts the
technical key, isolates the three subjects, and packs/scales their RGBA pixels.
Run: python scripts/build-faction-atlases.py
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "art-source/generated/pieces"
OUTPUT = ROOT / "apps/web/src/assets/table/pieces"
KINDS = ("one", "three", "hq")


def extract_key(image):
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dominance = np.minimum(r, b) - g
    keyed = (dominance > 70) & (np.minimum(r, b) > 150)
    alpha = np.ones(r.shape, dtype=np.float32)
    alpha[keyed] = np.clip(1 - dominance[keyed] / 255, 0, 1)
    alpha[alpha < 0.06] = 0
    # Unmix the magenta from antialiased edge pixels, never from opaque interiors.
    edge = (alpha > 0) & (alpha < 1)
    for channel, background in enumerate((255, 0, 255)):
        rgb[..., channel][edge] = np.clip(
            (rgb[..., channel][edge] - (1 - alpha[edge]) * background) / alpha[edge], 0, 255)
    rgb[alpha == 0] = 0
    return np.dstack((rgb.astype(np.uint8), np.rint(alpha * 255).astype(np.uint8)))


def subjects(rgba):
    labels, count = ndimage.label(rgba[..., 3] > 16)
    sizes = np.bincount(labels.ravel())
    large = [i for i in range(1, count + 1) if sizes[i] > rgba.shape[0] * rgba.shape[1] * 0.012]
    if len(large) != 3:
        raise ValueError(f"Expected three disconnected miniature silhouettes, found {len(large)}")
    boxes = ndimage.find_objects(labels)
    result = []
    for label in large:
        yy, xx = boxes[label - 1]
        # Include soft edge pixels around the connected solid subject.
        mask = ndimage.binary_dilation(labels == label, iterations=2)
        isolated = rgba.copy()
        isolated[~mask] = 0
        bounds = (max(0, xx.start - 2), max(0, yy.start - 2),
                  min(rgba.shape[1], xx.stop + 2), min(rgba.shape[0], yy.stop + 2))
        result.append(((xx.start + xx.stop) / 2, Image.fromarray(isolated).crop(bounds)))
    return [image for _, image in sorted(result, key=lambda item: item[0])]


def build():
    frames = {}
    report = []
    for folder in sorted(SOURCE.iterdir()):
        source = folder / "chroma-v2.png"
        if not source.exists():
            continue
        rgba = extract_key(Image.open(source))
        pieces = subjects(rgba)
        master = Image.new("RGBA", (1536, 1024))
        atlas = Image.new("RGBA", (768, 512))
        frames[folder.name] = {}
        for index, (kind, piece) in enumerate(zip(KINDS, pieces)):
            piece.thumbnail((448, 832), Image.Resampling.LANCZOS)
            x, y = index * 512 + (512 - piece.width) // 2, 992 - piece.height
            master.alpha_composite(piece, (x, y))
            small = piece.resize((max(1, round(piece.width / 2)), max(1, round(piece.height / 2))), Image.Resampling.LANCZOS)
            px, py = index * 256 + (256 - small.width) // 2, 496 - small.height
            atlas.alpha_composite(small, (px, py))
            frames[folder.name][kind] = {"x": px, "y": py, "width": small.width, "height": small.height}
        master.save(folder / "atlas-master-v2.png")
        target = OUTPUT / folder.name / "atlas.webp"
        atlas.save(target, format="WEBP", lossless=True, method=6, exact=True)
        assert target.stat().st_size <= 700 * 1024, f"Atlas exceeds transfer budget: {folder.name}"
        assert atlas.getpixel((0, 0))[3] == 0
        report.append(f"{folder.name}: {target.stat().st_size / 1024:.1f} KB; 3 isolated frames")
    if len(frames) != 7:
        raise ValueError(f"Expected all seven faction sources, found {len(frames)}")
    (OUTPUT / "frames.json").write_text(json.dumps(frames, indent=2) + "\n", encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    build()
