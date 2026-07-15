"""Build the table architecture atlas from approved transparent base masters.

The generative step intentionally stops at five base subjects. Fortification
durability is deterministic: every runtime frame contains the same city pixels
plus ten fixed perimeter segments whose bright/spent state encodes 10..1.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BASE_ROOT = ROOT / "art-source" / "generated" / "architecture" / "bases"
SOURCE_ROOT = ROOT / "art-source" / "generated" / "architecture"
RUNTIME_ROOT = ROOT / "apps" / "web" / "src" / "assets" / "table" / "architecture"

CITY_TIERS = ("minor", "major", "world_capital")
BASE_FILES = {
    "minor": "minor-city.png",
    "major": "major-city.png",
    "world_capital": "world-capital.png",
    "ruin": "ruin.png",
    "fallout": "fallout.png",
}

MASTER_CELL = 256
RUNTIME_CELL = 128
ATLAS_COLUMNS = 7
ATLAS_ROWS = 5
SUBJECT_BOX = (38, 34, 218, 222)
HAZARD_BOX = (27, 27, 229, 229)


def keys() -> list[str]:
    result: list[str] = []
    for tier in CITY_TIERS:
        result.append(f"city.{tier}.base")
        result.extend(f"city.{tier}.fortified.{remaining}" for remaining in range(10, 0, -1))
    return [*result, "ruin", "fallout"]


def fit_subject(path: Path, target_box: tuple[int, int, int, int]) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    alpha_box = image.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"{path} has no visible subject")
    image = image.crop(alpha_box)
    width = target_box[2] - target_box[0]
    height = target_box[3] - target_box[1]
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (MASTER_CELL, MASTER_CELL), (0, 0, 0, 0))
    x = target_box[0] + (width - image.width) // 2
    y = target_box[1] + (height - image.height) // 2
    canvas.alpha_composite(image, (x, y))
    return canvas


def draw_fortification(city: Image.Image, remaining: int) -> Image.Image:
    if remaining < 1 or remaining > 10:
        raise ValueError(f"invalid fortification durability: {remaining}")

    result = city.copy()
    draw = ImageDraw.Draw(result, "RGBA")
    ellipse = (13, 18, 243, 239)
    spent = 10 - remaining

    draw.ellipse(ellipse, outline=(8, 19, 27, 225), width=7)
    draw.ellipse((19, 24, 237, 233), outline=(71, 91, 101, 210), width=3)

    for index in range(10):
        start = -90 + index * 36 + 4
        end = start + 27
        is_spent = index < spent
        under = (18, 24, 28, 255) if is_spent else (8, 38, 49, 255)
        color = (83, 72, 66, 255) if is_spent else (45, 220, 244, 255)
        highlight = (125, 108, 94, 170) if is_spent else (195, 250, 255, 220)
        draw.arc(ellipse, start=start, end=end, fill=under, width=18)
        draw.arc(ellipse, start=start, end=end, fill=color, width=11)
        draw.arc((17, 22, 239, 235), start=start, end=end, fill=highlight, width=2)

        if is_spent:
            angle = math.radians((start + end) / 2)
            cx, cy = 128, 128.5
            rx, ry = 111, 106
            x = cx + math.cos(angle) * rx
            y = cy + math.sin(angle) * ry
            tangent = angle + math.pi / 2
            dx = math.cos(tangent) * 7
            dy = math.sin(tangent) * 7
            draw.line((x - dx, y - dy, x + dx, y + dy), fill=(38, 16, 12, 245), width=4)
            draw.line((x - dy * 0.5, y + dx * 0.5, x + dy * 0.5, y - dx * 0.5), fill=(143, 60, 35, 210), width=2)

    return result


def checkerboard(size: tuple[int, int], square: int = 16) -> Image.Image:
    image = Image.new("RGBA", size, (29, 35, 43, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill=(44, 52, 62, 255))
    return image


def build() -> None:
    required = [BASE_ROOT / filename for filename in BASE_FILES.values()]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("missing architecture base masters:\n" + "\n".join(missing))

    SOURCE_ROOT.mkdir(parents=True, exist_ok=True)
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)

    cities = {tier: fit_subject(BASE_ROOT / BASE_FILES[tier], SUBJECT_BOX) for tier in CITY_TIERS}
    frames: dict[str, Image.Image] = {}
    for tier, city in cities.items():
        frames[f"city.{tier}.base"] = city
        for remaining in range(10, 0, -1):
            frames[f"city.{tier}.fortified.{remaining}"] = draw_fortification(city, remaining)
    frames["ruin"] = fit_subject(BASE_ROOT / BASE_FILES["ruin"], HAZARD_BOX)
    frames["fallout"] = fit_subject(BASE_ROOT / BASE_FILES["fallout"], HAZARD_BOX)

    ordered_keys = keys()
    if len(ordered_keys) != 35 or set(ordered_keys) != set(frames):
        raise AssertionError("architecture atlas must contain exactly 35 named frames")

    atlas_size = (ATLAS_COLUMNS * MASTER_CELL, ATLAS_ROWS * MASTER_CELL)
    master = Image.new("RGBA", atlas_size, (0, 0, 0, 0))
    contact = checkerboard(atlas_size)
    contact_draw = ImageDraw.Draw(contact, "RGBA")
    font = ImageFont.load_default()
    manifest: dict[str, dict[str, int]] = {}

    for index, key in enumerate(ordered_keys):
        column = index % ATLAS_COLUMNS
        row = index // ATLAS_COLUMNS
        x = column * MASTER_CELL
        y = row * MASTER_CELL
        frame = frames[key]
        master.alpha_composite(frame, (x, y))
        contact.alpha_composite(frame, (x, y))
        contact_draw.rectangle((x + 4, y + 4, x + 252, y + 24), fill=(4, 8, 12, 205))
        contact_draw.text((x + 8, y + 8), key, fill=(235, 243, 247, 255), font=font)
        manifest[key] = {
            "x": column * RUNTIME_CELL,
            "y": row * RUNTIME_CELL,
            "width": RUNTIME_CELL,
            "height": RUNTIME_CELL,
        }

    master_path = SOURCE_ROOT / "atlas-master.png"
    contact_path = SOURCE_ROOT / "contact-sheet.png"
    runtime_path = RUNTIME_ROOT / "atlas.webp"
    manifest_path = RUNTIME_ROOT / "atlas.json"
    master.save(master_path, optimize=True)
    contact.save(contact_path, optimize=True)
    master.resize((ATLAS_COLUMNS * RUNTIME_CELL, ATLAS_ROWS * RUNTIME_CELL), Image.Resampling.LANCZOS).save(
        runtime_path,
        format="WEBP",
        lossless=True,
        method=6,
    )
    manifest_path.write_text(
        json.dumps(
            {
                "meta": {"width": ATLAS_COLUMNS * RUNTIME_CELL, "height": ATLAS_ROWS * RUNTIME_CELL, "frameCount": 35},
                "frames": manifest,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    runtime = Image.open(runtime_path).convert("RGBA")
    for key, frame in manifest.items():
        x, y = frame["x"], frame["y"]
        corners = ((x, y), (x + 127, y), (x, y + 127), (x + 127, y + 127))
        if any(runtime.getpixel(point)[3] != 0 for point in corners):
            raise AssertionError(f"{key} does not have transparent frame corners")

    print(f"Wrote {master_path}")
    print(f"Wrote {contact_path}")
    print(f"Wrote {runtime_path} ({runtime_path.stat().st_size / 1024:.1f} KB)")
    print(f"Wrote {manifest_path}")


if __name__ == "__main__":
    build()
