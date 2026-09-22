# Gameplay animation pass

The board uses a physical war-table vocabulary: reserve troops arrive in groups,
armies follow routes, dice expose their causes, ownership spreads within borders,
and permanent changes land as pieces, stickers, stamps, or torn cards.

## Gameplay coverage

| Moment | Presentation |
| --- | --- |
| Setup | Chooser order, HQ claim stamp, starting army, inherited-world summary |
| Recruitment | Territory and continent highlights, reserve total, grouped troop arrival |
| Planning | Translucent destination preview, garrison/count changes, friendly route |
| Expansion | Arrival, entry resistance/fallout, ownership change |
| Combat | Anticipation, natural dice, targeted modifiers, sorted comparisons, casualties |
| Interventions | Spending-faction attribution, missile flight to the affected die, before/after value |
| Conquest | Occupation, ownership ink, distinct HQ capture, first-conquest draw eligibility |
| Maneuver | Connected friendly route including campaign links; power bypass supported |
| Economy | Card draw/trade/purchase, reinforcement preview, Red Star award |
| Turn boundaries | Player-station handoff and public turn recap |
| Legacy | Scar backing peel, city placement, walls/damage, card tearing/upgrades, naming/signing |
| World changes | Envelope reveal, nuclear effects, island arrival and new links |
| Aftermath | Decisive public moment, five-moment player-paced chronicle, proven permanent deltas |

## Runtime ownership

`events.ts` translates the existing per-viewer event stream into semantic commands.
It retains natural die identity for modifiers, then uses sorted final dice for
comparisons. Exact card endpoints are resolved only from the current viewer's
visible hand. Other viewers see card backs; raw private event fields are excluded.

`planTransition.ts` owns the choreography and visual-only intermediate snapshots.
Those snapshots never drive rule decisions. The authoritative next state always
settles when the sequence finishes or is skipped. Fallout logged during entry is
presented after its immediately associated arrival.

`PresentationDirector` owns time, audio, queue order, input blocking, and cancellation.
Queued recruitment placements combine by territory so repeated placement remains
responsive. Other decisions wait while their preceding board sequence resolves.
Takeovers stay mounted but hidden during that sequence, preserving their local
state without obscuring the board. The combat tray retains an accessible skip
button outside its disabled controls.

`interaction/preview.ts` computes hypothetical troop results through the real
deterministic reducer. A preview never dispatches an action or modifies the ledger.
Keyboard focus receives the same preview information as pointer hover.

Full, reduced, and instant modes share the same semantic sequence. Reduced mode
omits camera travel and holds short effects still; instant mode schedules no
animation frames. Each effect releases its ticker and temporary objects on finish
or cancellation. Late atlas loads cannot overwrite a newer visual beat.

## Inspecting the effects

Start the web app and visit `/?table-demo=1&showcase=1` for the animation showcase.
The extra controls cover income, cards, stars, cities, defense damage, powers,
handoff, card destruction, naming, setup claims, and island placement. Ordinary
demo controls also exercise battles, missiles, conquest, scars, packets, nuclear
events, victory, and signing.

`gameplay.animation.spec.ts` checks semantic execution, reduced/instant modes,
skip, and transient cleanup in Chromium. Existing table visual tests capture
specific director-clock instants. Unit regressions cover batch arithmetic,
modifier order, privacy, fallout ordering, preview legality, and cancellation.
Use the repository verification loop, including the full 30-minute soak, before
releasing presentation-runtime changes.

## Completed follow-through

The second pass connects card flights, dice commitments, reserve placement,
faction commitment and score awards to actual screen locations. `DomAnchorRegistry`
measures visible UI elements and retains departing sources before a decision
removes them. Destinations must still be visible. Scrolling or resizing invalidates
old source coordinates. The scene adapter owns both the board and temporary
screen canvases, using the same director clock and cancellation signal.

The reserve mat contains persistent representative troops. Recruitment resolves
the territory/population base, continent bonuses and remaining adjustments in
order. Printed sea crossings follow the authored SVG geometry, including the
Pacific edge crossing. Defenders gather, committed dice enter the tray, later
rolls shorten, powers connect their faction to the affected object, and HQ changes
show both score changes together with any new public leader.

Setup includes faction commitment, the actual recorded roll rounds (including
ties), emblems reordering clockwise from the winning chooser, and a board tour of
inherited permanent marks. Victory first frames the public winning cause.

`history/PublicBoardHistory.ts` retains up to sixteen significant public action
boundaries per game in local browser storage. The explicit snapshot allowlist
excludes hands, decks, RNG and private missions. Playback reconstructs those
captured positions on the main board and ends on the current authoritative board.
Held before/after views support both physical board changes and card-value badges.
Skip, replacement playback, incoming live state and renderer teardown cancel safely.

Games played before capture was available cannot recover missing historical army
positions. Their comparison reconstructs only permanent changes supported by the
public record and explicitly labels the army positions as current. Storage limits
or disabled storage never block gameplay.

The showcase now also includes CHOOSER ORDER, DICE COMMIT, SEA CROSSING,
OPENING TOUR, PLAY WAR, BEFORE WORLD, AFTER WORLD and RETURN LIVE.
The production victory flow exposes board highlights, individual historical
moments, permanent-board comparisons and card-value comparisons. Setup exposes
the world tour and recorded order playback.
