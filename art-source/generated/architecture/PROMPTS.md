# Architecture master prompts

Generation mode: built-in image generation, one call per base subject. Each result used a flat `#ff00ff` chroma background, followed by the installed soft-matte/despill remover. Fortification variants were generated deterministically by `scripts/build-architecture-assets.py`.

## Shared production prompt

> Premium prerendered 3D tabletop miniature in matte painted resin/plastic, matching a high-end dark post-apocalyptic board-game piece. Center one isolated neutral subject with an orthographic-like 38-degree downward three-quarter camera, compact square footprint, stable baseline, generous padding, warm upper-left key light, restrained cool cyan rim light, and strong value separation at 20 pixels. Use charcoal stone, weathered steel, and restrained warm lights without faction colors. Render on perfectly flat solid #ff00ff with no shadows, gradient, floor, text, labels, logos, watermark, duplicates, cropping, or extra objects.

## Subject variants

- **Minor City:** three to five low-rise buildings around a modest civic building; smallest city tier; no defensive wall or state marks.
- **Major City:** dense developed district with a prominent central tower and substantial civic/industrial buildings; no defensive wall or state marks.
- **World Capital:** unique monumental civic spire with restrained antique-gold accents and surrounding government buildings; no defensive wall or state marks.
- **Ruin:** collapsed minor-city civic building, broken walls and streets, bent steel, and a dark empty center; low permanent replacement marker.
- **Fallout:** cracked blackened ground, shallow crater, skeletal remnants, toxic yellow-green pools, and one subtle physical radiation trefoil; low permanent replacement marker.

All prompts prohibited people, vehicles, weapons, smoke, floating particles, runtime durability dashes, and the chroma color inside the subject.
