# Risk Legacy campaign rulebook audit

Audit date: 2026-07-11

## Authority and scope

Base-game rules were checked against Hasbro's [original 2011 English booklet](https://www.hasbro.com/common/documents/dad2886d1c4311ddbd0b0800200c9a66/00D721465056900B10A16E11F8F54E7F.pdf) and [current F3156 English instructions](https://www.hasbro.com/common/documents/60D52426B94D40B98A9E78EE4DD8BF94/CF415FFE3B8E456B9602F42E3BA24684.pdf). Both deliberately omit the rules stickers and cards inside sealed packages.

Sealed rules were reconstructed from the physical-component scans in the [Risk Legacy Tabletop Simulator workshop item](https://steamcommunity.com/workshop/filedetails/?id=620524853), then cross-checked against the [Risk Legacy: Tales from the Other Side transcription](https://risklegacyos.wordpress.com/category/uncategorized/), contemporary play reports, and the [BoardGameGeek FAQ](https://boardgamegeek.com/wiki/page/Risk_Legacy_FAQ). `SEALED-CONTENT-SOURCE-AUDIT.md` records the packet-level provenance. Card text is paraphrased in the application and documentation.

The canonical campaign is executable from Game 1 through post-Game-15 play. The optional **Do Not Open Ever** variants are deliberately outside the implemented ruleset because a physical campaign is instructed not to open them.

## Verification result

The repository currently passes:

- `npm test`: **212 tests across 20 files**.
- `npm run lint`: all six TypeScript projects.
- `npm run validate:content`: 42 base Territory cards, 10 Coin cards, and **0 warnings**.
- `npm run sim -- 1234 4`: two complete, chained campaign games.
- `npm run campaign:fixtures`: all **18 deterministic campaign stages**.

The 18 fixtures cover fresh Game 1, returning and developed campaigns, every Pack/Pocket trigger boundary, every active module, a captured Private Mission, both sealed factions, persistent Alien Island topology, completed Game 15, and post-campaign play. Each startable fixture reaches a legal first turn, completes a real Red Star victory and rewards, folds into campaign state, round-trips through JSON, and creates the next game. The same catalog is tested through the browser save store and PostgreSQL campaign/session snapshots.

## Base-book traceability

| Rule element | Result | Executable evidence |
|---|---|---|
| Prepare the World | Verified | Before Game 1, exactly 12 individually committed Coin stickers are persisted. Clockwise seats alternate placements; a card may receive both legal sticker slots but may not begin above 3 resources. Game creation is blocked until review and sealing. The first player to select each faction later chooses that faction's permanent green power during setup. |
| Players and setup | Verified | 3-5 players, 8 starting troops, unique high-roll chooser, clockwise order, legal unoccupied/unmarked starts, founder-only Major City exception, and no adjacent opposing HQ. Ruins count as marks. |
| Signatures | Verified | No signature gives one Red Star token; each prior signature instead gives one Missile. |
| Scar deal | Verified | One Scar per player only when enough physical instances remain for everyone. |
| Winning | Verified | Immediate victory at four Red Stars or when all opponents are eliminated. |
| Start-of-turn Red Star | Verified | Costs four Resource cards. |
| Join the War | Verified | Only from knockout, only at a legal start, half that player's drafted/base starting troops, and no HQ. |
| Recruitment | Verified | `(territories + population) / 3`, minimum 3, continent/faction/scar modifiers, and one Resource-card set per recruit phase. |
| Expand and cities | Verified | Empty expansion, population loss, Fortification penalty, Fallout reversal for Mutants, Ruin restrictions, and Alien Collaborator penalty. |
| Combat | Verified | Attacker/defender dice limits, defender wins ties, scars/fortifications/faction powers, any-player Missile priority, knockout, conquest, and move-in. |
| Maneuver | Verified | One connected maneuver, with the printed faction-power exceptions. |
| Resource draw and sideboard | Verified | Mandatory matching Territory card after conquest, Coin fallback, slot-4 discard, rightward slide, slot-1 refill, even-resource Event trigger, and first Coin depletion award. Alien Island's Territory card participates in this same lifecycle. |
| End-of-turn order | Verified | Maneuver, board Scar effects, optional Mission in place of Resource draw, Resource/Event resolution, then turn advance. |
| Rewards and persistence | Verified | Winner signing/reward, held-on rewards clockwise, no eliminated reward, permanent cities/scars/fortifications/card upgrades/destruction/continent changes, and inventory depletion. A city may be rebuilt over a Ruin. |
| Game 15 | Verified | Starter rewards stop; the most-winning player names the world, with the printed named-continent roll modifier for ties. Later games retain campaign state. |

## Sealed-package traceability

| Package | Trigger and implemented rules | Result |
|---|---|---|
| Pack 1 | Ninth Minor City founded, opened after end-game rewards. Five-category alternating snake draft; drafted faction, turn order, placement order, starting troops, Coin cards, and Join-the-War count; Biohazard; Fortify, Control the People, Riots, and Resistance Events. | Complete and tested. |
| Pack 2 | Player/faction eliminated, immediately when no legal re-entry exists or at game end otherwise. Mercenary and the six persistent Comeback Powers: Resourceful, Stealthy, Well-Armed, Mobile, Convincing, Well-Supplied. | Complete and tested. |
| Pack 3 | One person signs the board for the second time, opened after that winner's reward. Homeland is the uniquely most-used starting continent; a tie means no Homeland. Eight public Missions, their 1/2-star conditions, World Capital founding, and three Join the Cause Events. | Complete and tested. |
| Pack 4 | World Capital is founded. A unique most-winning **playing** faction is Lead; ties mean no Lead. Lead chooses the face-up Mission and begins future games with three troops in the World Capital. All six Private Missions enter the public deck, award a Red Star, permanently attach to an empty red faction slot, and can then be used once per game without also completing the public Mission that turn. | Complete and tested. |
| Pocket 1 | Third Missile committed to one combat roll, before normal casualties. Removes the attacking troops committed to the roll, wipes and marks the target, destroys its Territory card, rolls losses for every land-adjacent territory, and discards cards for resulting knockouts. Bringer of Nuclear Fire, five Missile Powers, Mutants, all four evolution paths, Mutant Private Mission, and all eight Events are executable. | Complete and tested. |
| Pocket 2 | Active recruit total reaches 30+ while that player retains a Missile. Alien Collaborator weakness, opening-game Alien alliance, 10 arriving troops, persistent two-sea-line Alien Island, Island Territory card shuffle, Aliens in later games, Alien Private Mission, five Weaknesses, Ruins, and all seven Events are executable. Conditional Die Humans destruction and Mysterious Island's possible second Event are enforced. | Complete and tested. |

## Representation boundaries

- Scratching cards, applying stickers, destroying cards, and writing names/signatures are represented as durable state plus explicit UI decisions; the web app cannot physically alter a board.
- A compatibility import path remains for older/custom campaign snapshots that contain host-supplied cards. Canonical Pack 1-4 and Pocket 1-2 mechanics no longer depend on invented or unknown host text.
- The German promotional Mercenary draft cards and the optional Do Not Open Ever variants are not part of the standard 15-game ruleset and are not automatically enabled.
