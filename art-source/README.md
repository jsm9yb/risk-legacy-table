# Table art source

`generated/pieces/<faction>/atlas-master.png` contains the lossless transparent master produced from the approved faction prompt. Production atlases are downsampled to 768×512 WebP under `apps/web/src/assets/table/pieces/`.

All faction sheets use the same three-column contract:

1. one-troop miniature;
2. three-troop miniature;
3. faction HQ.

The normalized shared prompt and generation mode are recorded in `apps/web/src/assets/table/catalog.ts`. Generated source images used a flat chroma background, then the installed image-generation skill's soft-matte/despill helper removed it. Production exports were validated for RGBA alpha, transparent corners, subject coverage, and the 700 KB-per-faction transfer budget.

## Architecture atlas

`generated/architecture/bases/` contains the five approved transparent masters for Minor City, Major City, World Capital, Ruin, and Fallout. They use the same miniature camera and finish as the faction pieces.

Run `python scripts/build-architecture-assets.py` with Pillow available to rebuild:

- `generated/architecture/atlas-master.png` — lossless 35-frame source atlas;
- `generated/architecture/contact-sheet.png` — labeled visual QA sheet;
- `apps/web/src/assets/table/architecture/atlas.webp` — production alpha WebP;
- `apps/web/src/assets/table/architecture/atlas.json` — exact runtime frame map.

Fortification variants are deterministic composites, not separately generated images. Each city tier has a base frame and durability frames 10 through 1. Ten fixed perimeter positions are consumed clockwise from 12 o'clock; remaining segments are bright cyan and spent segments are dark and damaged.
