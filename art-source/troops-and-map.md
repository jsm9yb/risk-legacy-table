# Troop and map polish

The seven physical faction-card scans are the visual reference. The v2 miniatures
were edited with built-in image generation, then technically keyed and packed by
`scripts/build-faction-atlases.py`. Exact prompts are in
`generated/pieces/prompts-v2.json`; source images and transparent masters sit beside
each faction's earlier master. Production files remain at the established atlas
URLs, with frame rectangles generated from actual silhouettes.

## Faction direction

- Die Mechaniker: broad steel armor, respirator, ochre equipment markings and a
  compact artillery walker. Less scratch noise and stronger separated forms.
- Enclave of the Bear: human spearmen with blue war paint and a mounted bear,
  bringing the troop designs closer to the physical card's frontier clans.
- Imperial Balkania: crimson uniforms, ivory masks, gold trim and a low red tank.
- Khan Industries: visible human face, charcoal industrial armor, blocky walker
  and restrained green equipment indicators.
- Saharan Republic: goggled desert scout, intact windblown cloak and wheeled
  reconnaissance buggy, replacing the generic hovering vehicle.
- Mutants: ochre flesh, asymmetrical anatomy and dull scrap equipment, with less
  shiny surface noise.
- Aliens: pale elongated forms, smooth ivory equipment and controlled cyan accents.

All 21 figures have clearer surfaces and isolated silhouettes. Shared shallow
bases and lighting unify the set. Runtime sprites fit both a height and a width
budget so broad tanks, riders and HQs do not exceed their placement envelopes.
Production exports are lossless, between 176 and 234 KB per faction.

## Map direction

The hand-authored production board retains its geometry, continent identities,
routes, and writing areas. Muted ink-like continent gradients replace the bright
saturated shading; the ocean uses slate teal with a lighter, gentler vignette.
Thinner coastline shadows and route strokes reduce clutter. Territory names use
dark printed lettering with a small paper-colored edge. Clear names render at
78% opacity; names overlapping a piece fade to 20%. The resource overlay still
uses its own label emphasis.

Edit `packages/map/assets/board.svg` for production artwork. The existing board
generator remains a separate geometry preview and does not overwrite this art.
