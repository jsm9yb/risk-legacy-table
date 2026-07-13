# Table art source

`generated/pieces/<faction>/atlas-master.png` contains the lossless transparent master produced from the approved faction prompt. Production atlases are downsampled to 768×512 WebP under `apps/web/src/assets/table/pieces/`.

All faction sheets use the same three-column contract:

1. one-troop miniature;
2. three-troop miniature;
3. faction HQ.

The normalized shared prompt and generation mode are recorded in `apps/web/src/assets/table/catalog.ts`. Generated source images used a flat chroma background, then the installed image-generation skill's soft-matte/despill helper removed it. Production exports were validated for RGBA alpha, transparent corners, subject coverage, and the 700 KB-per-faction transfer budget.

