# Insignia and motion direction

The checked-in physical faction-card scans under `apps/web/src/assets/faction-cards/`
are the reference for material and mood: worn paper, hard military silhouettes,
bone-colored print, tarnished metal, and utilitarian marks. The SVG faction marks
are interpretive interface insignia, not claims to reproduce official logos.
Existing faction identity colors remain recognizable in the badge rims.

## Vector audit

- Seven faction badges now share an ink field, narrow paper rim, colored register,
  and sparse edge wear. Mechaniker's respirator, the Bear's angular claw print,
  Balkania's eagle, Khan's industrial monogram, and Sahara's compass have distinct
  silhouettes. Sealed factions retain their skull and alien motifs.
- Seven scar stickers share the same paper stock and outline weight. Safety signs
  use simple dark silhouettes; bunker and fortification use masonry shapes.
- All scar symbols are available to the table renderer, including weakness and
  fortification, which previously fell back to tiny letter abbreviations. Fallout
  still projects to its established architecture miniature on the board.
- Keep critical shapes readable at 10–16px. Edge wear is decorative only. Do not
  add SVG noise filters, embedded images, font glyphs, or external references;
  scars must render through both browser SVG and Pixi Graphics.
- The board's source geometry, physical card scans, and existing faceted red-star
  token already serve the physical-game direction and are retained.

Regenerate all fourteen badges with `node scripts/build-insignia.mjs`.

## Motion audit

- Camera travel eases into and out of its framing position and stops at board
  edges, avoiding large empty areas when framing coastal territories.
- Armies use the same one/three denomination composition as static stacks, with
  centered spacing, a small lift and a grounded contact shadow. HQ travel uses the
  faction's HQ miniature; a missile has its own silhouette.
- Casualties use faction miniatures that tip and fade. Zero casualties produce no
  phantom loss. Combat uses a short directional strike and local dust burst.
- Scar placement settles to its permanent 10px footprint before state commits.
- Confirmation rings and victory motion are restrained. Nuclear resolution uses
  local dust and blast marks instead of washing out the entire board.
- Decision-surface dice land with a small rotation; keeping a power feels like
  pressing paper, and tearing it no longer produces a neon slash.
- Timing and commit order remain owned by PresentationDirector. Skip/abort cleanup
  is idempotent and removes its listener after completion. No new timers, shaders,
  React board pieces, or animation dependencies are introduced.

Check full/reduced/instant motion, interruption, permanent marks, all factions,
and small displays with the existing presentation and Chromium gates. Screenshot
baselines must be inspected before accepting changes. This art pass is not a
presentation-runtime release; the separate 30-minute endurance gate remains a
release requirement.
