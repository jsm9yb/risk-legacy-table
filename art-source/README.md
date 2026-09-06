# Table art source

`generated/pieces/<faction>/atlas-master-v2.png` contains the current lossless transparent master. The earlier `atlas-master.png` is retained as a reference. Production atlases are packed into 768×512 lossless WebP under `apps/web/src/assets/table/pieces/`.

All faction sheets use the same three-column contract:

1. one-troop miniature;
2. three-troop miniature;
3. faction HQ.

The exact current prompts and built-in generation mode are recorded in `generated/pieces/prompts-v2.json`. The `chroma-v2.png` sources use a flat magenta technical key. Run `python scripts/build-faction-atlases.py` (Pillow, NumPy, SciPy) to isolate the three silhouettes, unmix antialiased key edges, and export the masters, lossless WebP atlases, and `pieces/frames.json`. The exporter enforces three isolated subjects, transparent padding and the 700 KB-per-faction transfer budget. Frames have 16px minimum horizontal gutters and share a baseline at y=496.

## Architecture atlas

`generated/architecture/bases/` contains the five approved transparent masters for Minor City, Major City, World Capital, Ruin, and Fallout. They use the same miniature camera and finish as the faction pieces.

Run `python scripts/build-architecture-assets.py` with Pillow available to rebuild:

- `generated/architecture/atlas-master.png` — lossless 35-frame source atlas;
- `generated/architecture/contact-sheet.png` — labeled visual QA sheet;
- `apps/web/src/assets/table/architecture/atlas.webp` — production alpha WebP;
- `apps/web/src/assets/table/architecture/atlas.json` — exact runtime frame map.

Fortification variants are deterministic composites, not separately generated images. Each city tier has a base frame and durability frames 10 through 1. Ten fixed perimeter positions are consumed clockwise from 12 o'clock; remaining segments are bright cyan and spent segments are dark and damaged.
