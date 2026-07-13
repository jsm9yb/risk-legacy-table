#!/usr/bin/env python3
"""Pack transparent generated miniature sheets into runtime WebP atlases."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


FACTIONS = (
    "aliens",
    "die_mechaniker",
    "enclave_of_the_bear",
    "imperial_balkania",
    "khan_industries",
    "mutants",
    "saharan_republic",
)
FRAME_NAMES = ("one", "three", "hq")
ATLAS_SIZE = (768, 512)
CELL_WIDTH = ATLAS_SIZE[0] // 3
CELL_PADDING = 8
BASELINE = 496


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    # Ignore almost-transparent matte noise while retaining antialiased edges.
    mask = alpha.point(lambda value: 255 if value >= 8 else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise ValueError("sprite cell contains no visible pixels")
    return bbox


def subject_ranges(sheet: Image.Image) -> list[tuple[int, int]]:
    alpha = sheet.getchannel("A")
    column_counts = [
        sum(alpha.crop((x, 0, x + 1, sheet.height)).histogram()[128:])
        for x in range(sheet.width)
    ]

    def valley(start_ratio: float, end_ratio: float) -> int:
        start = round(sheet.width * start_ratio)
        end = round(sheet.width * end_ratio)
        window = column_counts[start:end]
        minimum = min(window)
        candidates = [start + index for index, count in enumerate(window) if count == minimum]
        runs: list[list[int]] = []
        for x in candidates:
            if not runs or x != runs[-1][-1] + 1:
                runs.append([x])
            else:
                runs[-1].append(x)
        widest = max(runs, key=len)
        return widest[len(widest) // 2]

    first_split = valley(0.2, 0.45)
    second_split = valley(0.55, 0.8)
    return [(0, first_split), (first_split, second_split), (second_split, sheet.width)]


def pack_sheet(source: Path, destination: Path) -> dict[str, dict[str, int]]:
    with Image.open(source).convert("RGBA") as sheet:
        atlas = Image.new("RGBA", ATLAS_SIZE, (0, 0, 0, 0))
        frames: dict[str, dict[str, int]] = {}

        for index, (frame_name, (left, right)) in enumerate(zip(FRAME_NAMES, subject_ranges(sheet))):
            cell = sheet.crop((left, 0, right, sheet.height))
            sprite = cell.crop(alpha_bbox(cell))

            max_width = CELL_WIDTH - CELL_PADDING * 2
            max_height = BASELINE - CELL_PADDING * 2
            scale = min(max_width / sprite.width, max_height / sprite.height)
            scaled_size = (
                max(1, round(sprite.width * scale)),
                max(1, round(sprite.height * scale)),
            )
            sprite = sprite.resize(scaled_size, Image.Resampling.LANCZOS)

            x = index * CELL_WIDTH + (CELL_WIDTH - sprite.width) // 2
            y = BASELINE - sprite.height
            atlas.alpha_composite(sprite, (x, y))
            frames[frame_name] = {
                "x": x,
                "y": y,
                "width": sprite.width,
                "height": sprite.height,
            }

        destination.parent.mkdir(parents=True, exist_ok=True)
        atlas.save(destination, "WEBP", quality=92, method=6, lossless=False)
        return frames


def validate_atlas(path: Path, frames: dict[str, dict[str, int]]) -> float:
    with Image.open(path).convert("RGBA") as atlas:
        alpha = atlas.getchannel("A")
        corner_alpha = [alpha.getpixel(point) for point in ((0, 0), (atlas.width - 1, 0), (0, atlas.height - 1), (atlas.width - 1, atlas.height - 1))]
        if corner_alpha != [0, 0, 0, 0]:
            raise ValueError(f"{path}: atlas corners are not transparent: {corner_alpha}")

        allowed = Image.new("1", atlas.size, 0)
        draw = ImageDraw.Draw(allowed)
        for frame in frames.values():
            x, y, width, height = frame["x"], frame["y"], frame["width"], frame["height"]
            if x < 0 or y < 0 or x + width > atlas.width or y + height > atlas.height:
                raise ValueError(f"{path}: frame is outside atlas bounds: {frame}")
            if alpha.crop((x, y, x + width, y + height)).getbbox() is None:
                raise ValueError(f"{path}: frame contains no visible pixels: {frame}")
            draw.rectangle((x, y, x + width - 1, y + height - 1), fill=1)

        outside = Image.new("L", atlas.size, 0)
        outside.paste(alpha, mask=allowed.point(lambda value: 0 if value else 255))
        if outside.getbbox() is not None:
            raise ValueError(f"{path}: visible pixels exist outside declared frames")

        visible_pixels = sum(1 for value in alpha.getdata() if value >= 8)
        coverage = visible_pixels / (atlas.width * atlas.height)
        if not 0.05 <= coverage <= 0.75:
            raise ValueError(f"{path}: unexpected visible coverage: {coverage:.2%}")
        return coverage


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--asset-root", required=True, type=Path)
    parser.add_argument("--frames-out", required=True, type=Path)
    args = parser.parse_args()

    frame_catalog: dict[str, dict[str, dict[str, int]]] = {}
    for faction in FACTIONS:
        source = args.source_dir / f"{faction}-transparent.png"
        destination = args.asset_root / faction / "atlas.webp"
        frame_catalog[faction] = pack_sheet(source, destination)
        coverage = validate_atlas(destination, frame_catalog[faction])
        print(f"{faction}: alpha and frames valid, visible coverage {coverage:.1%}")

    args.frames_out.parent.mkdir(parents=True, exist_ok=True)
    args.frames_out.write_text(json.dumps(frame_catalog, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
