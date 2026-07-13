# Risk Legacy sealed-content source audit

Audit date: 2026-07-11

Hasbro's public booklets intentionally omit the sealed rules. This ledger records the spoiler sources used to reconstruct them. Mechanics are paraphrased in code and docs.

## Evidence standard

The strongest available source is the card/rules-sticker imagery embedded in the [Risk Legacy Tabletop Simulator workshop item](https://steamcommunity.com/workshop/filedetails/?id=620524853). Packet mapping in that asset is:

- B: Pack 1
- C: Pack 2
- D: Pack 3
- E: Pack 4
- J: Pocket 1
- K: Pocket 2
- L: German promotional Mercenary draft cards
- H: Do Not Open Ever

The scans were cross-checked with the [campaign transcription](https://risklegacyos.wordpress.com/category/uncategorized/), [Mutant transcription](https://daviau1.rssing.com/chan-5960803/all_p2204.html), [Alien transcription](https://daviau1.rssing.com/chan-5960803/article14753.html), [BoardGameGeek FAQ](https://boardgamegeek.com/wiki/page/Risk_Legacy_FAQ), and contemporary reports such as [Risk Legacy game 13](https://boardgamegeek.com/thread/827295/risk-legacy-game-13-spoilers).

## Packet results

### Pack 1 — Advanced Draft / Biohazards

Status: implemented and tested.

Verified inventory and behavior: the Faction, Turn Order, Placement Order, Starting Troops, and Starting Coin-card draft; alternating snake direction; Biohazards; two Fortify, two Control the People, one Riots, and two Resistance Events, including their discard/destroy behavior.

Additional corroboration: [MafiaScum campaign discussion](https://forum.mafiascum.net/viewtopic.php?t=21230), [Any Game Good reports](https://anygamegood.wordpress.com/tag/risk-legacy/).

### Pack 2 — Comeback Powers / Mercenaries

Status: implemented and tested.

Verified inventory and behavior: Resourceful, Stealthy, Well-Armed, Mobile, Convincing, and Well-Supplied; permanent blue-slot attachment; Mercenary reinforcement.

Additional corroboration: [campaign transcription](https://risklegacyos.wordpress.com/), [standard-game component guide](https://www.reddit.com/r/Risk/comments/l2c3e7/guide_how_to_create_a_standard_game_setup_for/).

### Pack 3 — Homelands / Missions

Status: implemented and tested.

Verified behavior: unique most-frequent starting continent defines a Homeland and ties give none; eight public Missions with their printed rewards and conditions; World Capital founding; three Join the Cause Events.

Additional corroboration: [campaign transcription](https://risklegacyos.wordpress.com/category/uncategorized/).

### Pack 4 — Lead Faction / Private Missions

Status: implemented and tested from card-level scans.

Verified behavior: only a unique most-winning faction among factions playing the current game becomes Lead; Lead chooses the public Mission and receives the World Capital setup troops. The six Private Missions are Wide Border, Forced Occupation, Guerilla Warfare, Advanced Training, Urban Troop Surge, and Advanced Tactics. Their public completion, permanent red-slot capture, reward, once-per-game later use, and one-Mission-per-turn restriction are executable.

Additional corroboration: [Urban Troop Surge play report](https://boardgamegeek.com/thread/827295/risk-legacy-game-13-spoilers).

### Pocket 1 — Nuclear War / Mutants

Status: implemented and tested from card-level scans.

Verified behavior: complete nuclear-opening casualty sequence and permanent Fallout result; Bringer of Nuclear Fire; Recon, Bad Intel, Rally, EMP, and Interference; Mutant faction and Private Mission; Unnatural Strength, Mindshackle, Defensive Cloning, and Mass Hypnosis; two Mutants Evolve, three Agent of Chaos, and three Fallout Events.

Additional corroboration: [Mutant transcription](https://daviau1.rssing.com/chan-5960803/all_p2204.html).

### Pocket 2 — Alien Landing

Status: implemented and tested from card-level scans.

Verified behavior: opening-game collaborator/alliance, yellow-slot Alien Collaborator weakness, Alien Island placement and Territory card, future Alien faction rules, Ruins, Alien Private Mission, five Weaknesses, two Mysterious Island, two Beam Down, and three Die Humans Events. The conditional destroy/discard instruction and second Event possibility are enforced.

Additional corroboration: [Alien transcription](https://daviau1.rssing.com/chan-5960803/article14753.html).

## Explicit exclusions

No standard campaign rule remains marked content-pending. Packet H (Do Not Open Ever) stays disabled by design. Packet L is a German promotional standard-game aid rather than part of the canonical 15-game campaign.
