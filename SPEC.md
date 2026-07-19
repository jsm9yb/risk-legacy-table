# Risk Legacy — Web Rebuild Specification

A private, non-commercial digital table for one group's Risk Legacy campaign. This document is the design specification: the system to build, the rules it must enforce, and the order in which to build it. It describes intended behavior, not progress. Rule decisions resolved with the group are recorded here; live task status lives in [BACKLOG.md](BACKLOG.md).

**Presentation runtime (2026-07-12):** the production play surface is a lazy-loaded PixiJS retained scene governed by `docs/PRESENTATION-RUNTIME-MIGRATION-SPEC.md`. React owns decisions and accessibility; Pixi owns the board, pieces, marks, interaction overlays, camera, and semantic motion. The renderer may interpolate between authoritative states but never owns game rules or mutates campaign state.

---

## 1. Scope

- A digital implementation of the Risk Legacy starter game for **3–5 players** (2-player is out of scope).
- A persistent **campaign**: scars, cities, fortifications, signatures, faction-power choices, and unlock flags carry between games.
- The **sealed legacy modules** open under their trigger conditions and permanently change the game.
- Hot-seat play on one screen and networked play across machines on a LAN, sharing one rules engine.

Non-goals: commercial distribution, AI opponents beyond a test harness, and any rule the official rulebook does not define.

---

## 2. Repository layout

A TypeScript monorepo (npm workspaces, Node 22).

```
packages/map        42-territory manifest (adjacency, continents, anchors); board SVG generator + validation
packages/content    canonical content pack (factions, powers, scars, 52 resource cards, payout table, rule
                    constants, sealed-module manifest) with zod validation
packages/rules      deterministic, seeded, event-sourced rules engine + test suite
apps/server         Express + Socket.IO + Kysely/Postgres: accounts, campaigns/invites, lobbies, append-only
                    action ledger, hidden-state filtering, campaign export on game end
apps/web            Vite/React/Tailwind UI: hub + local hot-seat sandbox + networked game screen
tools/simulator     seeded full-game CLI harness driving the real action API
```

---

## 3. Engine design principles

- **Deterministic and replayable.** `applyAction(state, action)` clones the state, validates the action, mutates the clone, appends events, and returns the new state. The same seed and action sequence always reproduce the same game.
- **Seeded randomness only.** All randomness flows through `state.rngState`. The engine never reads `Math.random()`.
- **Event-sourced.** Every action appends to an event log; the log replays to a `GameState`.
- **Rules are data, not code.** Rule constants and content values live in `packages/content/data/pack.*.json`, each carrying a `verification` flag (`confirmed` | `pending`). The engine reads them through `ruleValue()`. Only `confirmed` behaviors are enforced; `pending`/`content_required` ones are not implemented until defined.
- **Append-only ledger.** The server's `game_actions` ledger is never mutated or deleted. Corrections append a new row with a reason.
- **Hidden information.** Other players' resource hands, held-scar identities, and deck order are filtered server-side (`filterState`) and never leak into other players' payloads.

---

## 4. Core rules

Values live as data in `packages/content/data/pack.*.json`; behavior is enforced in `packages/rules`.

| Rule | Value |
|---|---|
| Players | 3–5. 2-player is not supported (`createGame` rejects fewer than 3). |
| Starting troops | Flat 8 per player. No player-count scaling. |
| Starting Red Stars / missiles | Signature-driven (§7): a player with **0 board signatures** starts with **1 Red Star token** and no missiles; a player with **≥1 signature** starts with **missiles equal to their signature count** and **no** starting Red Star. With no campaign history (Game 1) everyone has 0 signatures → 1 token each. |
| Red Star purchase | 4 Resource cards (Territory or Coin; resource value irrelevant). Repeatable at start of turn while enough cards remain. |
| Own HQ | Every HQ a player controls counts as 1 board Red Star. An HQ territory with 0 troops is controlled by nobody. |
| Legal start | An unoccupied, unmarked territory, or an unoccupied Major City founded by that player (even if scarred). Minor cities never qualify. |
| Initial HQ adjacency | An initial HQ may not be placed adjacent to another faction's HQ. |
| Join the War — legal start | Same placement rule as setup, but no HQ is placed (so HQ-adjacency applies only when placing an HQ). |
| Join the War — troops | Half the starting total (4). No HQ placed. |
| City resistance on expand | Expanding into an unoccupied city costs troops equal to its population (Minor 1, Major 2, World Capital 5); +2 if fortified. Attacking enemy troops in a city pays no resistance. |
| Recruitment | `max(floor((territories + city population) / 3), 3)` — population counts **inside** the division — plus continent bonuses (base ± bonus marks, +1 personal named bonus) and trade-ins. Imperial's `round_up_recruiting` turns the floor into a ceiling (§6). |
| Victory | 4 Red Stars. The game locks immediately on the winning action. |

Combat: server-rolled dice; defender wins ties; pairwise highest-to-lowest comparison. Missiles set an unmodifiable 6, resolved in sequential post-roll response windows. On conquest, the attacker moves in between (surviving attackers) and (all but one); an HQ remains on the board as an independent piece keyed to its original faction. A knocked-out player's Resource cards transfer to the conqueror (scars, tokens, and missiles do not). Results auto-classify as Won / Held On / Eliminated.

Sideboard: a shuffled territory deck feeds exactly 4 face-up slots; a coin pile; discard piles. A coin draw discards the slot-4 card. When a face-up territory card matches a territory the drawing player controls, taking it is mandatory over a coin. The territory deck reshuffles from its discard when empty. The first player to deplete the coin pile is awarded a Red Star (no award on a tie).

---

## 5. Scars

Scars are permanent modifiers attached to a target, persisting across games unless a rule explicitly removes, destroys, replaces, or cleanses them.

### Starter playable scars

Only two scar types are playable from the start: **Bunker** and **Ammo Shortage**. The starter inventory is **six physical instances — 3 Bunker and 3 Ammo Shortage**. At setup, deal **one hidden scar instance to each player**, only if enough instances remain for every player. Filtered/public state exposes only a player's **scar count**, never identity. Unplayed scars return to the available inventory at game end; **played scars are permanently consumed**.

All other scars are module content (not dealt at starter setup): **Biohazard** (Pack 1), **Mercenary** (Pack 2), and module-specific scars such as Fallout (Pocket 1) and Weakness (Pocket 2). **Fortification is not a scar** — it is a winner reward mark on a city (§7).

### Playing a starter scar

The **holder** may play Bunker or Ammo Shortage at **any stable action boundary**, during **any player's** turn, in any phase except `game_over`. A scar play may **not** interrupt atomic resolution, a **post-roll missile window** (once dice have been rolled), or a **conquest move-in**. Legal target: **any unscarred territory**. A territory may hold **at most one scar total**, unless a later rule explicitly overrides this. Playing attaches the scar to the target, consumes the instance from the holder's hand, and reveals it (a placed scar is public, on the board).

### Combat & end-of-turn effects (confirmed)

| Scar | Source | Effect |
|---|---|---|
| Bunker | starter | Defender adds +1 to **one highest** defense die. |
| Ammo Shortage | starter | Defender subtracts 1 from **one highest** defense die. |
| Biohazard | Pack 1 | At the controller's end of turn, **before the draw**, the territory loses 1 troop (vacated if it was the last). |
| Mercenary | Pack 2 | At the controller's end of turn, the territory gains 1 troop if still controlled. |

If a scar is on the **defending** territory when dice are rolled, it applies to that battle. Dice modifiers are **mandatory** and resolve **before** missiles. After applying a modifier, **clamp each die to 1..6**, then sort before comparison. A **missile-set die is never altered** by a scar (a bonus targeting a missile die is lost, not shifted).

### Timing windows (module/event scars)

Module and event scars may specify a window from `ScarTiming`. Starter scars use the "any stable boundary" rule above rather than a single window.

```ts
type ScarTiming =
  | "beforeBattleRoll" | "afterBattleRoll" | "afterTerritoryCaptured" | "whenCityFounded"
  | "whenFactionEliminated" | "duringRecruitment" | "duringSetup" | "onModuleUnlock";
```

---

## 6. Faction powers

Each base faction has two candidate starting powers; the campaign stores **one selected starting power per faction**. A power **attaches to the faction, not to a real-world player** — whoever plays that faction in a game gets its selected power. Powers dispatch through typed handler ids (`modifyCombatDie`, `alterRecruitment`, `extraManeuver`, `legalStartOverride`) at engine hook points. Every automatic or optional power application emits `FactionPowerApplied` with enough data for the audit log and UI animation.

| Faction | Power id | Handler | Effect |
|---|---|---|---|
| Die Mechaniker | `fortified_hq` | modifyCombatDie | Its starting HQ is fortified when Die Mechaniker defends it: no durability, no expansion surcharge, does not stack with the Fortification mark. |
| Die Mechaniker | `defensive_stand` | modifyCombatDie | If the natural defense roll is two 6s, the target territory cannot be attacked again for the rest of the active turn. |
| Enclave of the Bear | `lower_die_intimidation` | modifyCombatDie | Defender subtracts 1 from the **lower** defense die in the first territory Enclave attacks that turn, while Enclave keeps attacking that same territory. |
| Enclave of the Bear | `total_conquest` | modifyCombatDie | If the natural attack roll is three of a kind and the final combat would kill ≥1 defender, remove **all** defenders and conquer normally. |
| Imperial Balkania | `round_up_recruiting` | alterRecruitment | Round **up** only the `(territories + population) / 3` recruitment component, before min-recruit and bonuses. |
| Imperial Balkania | `expansionist_supply` | alterRecruitment | If Imperial expands into 4+ unoccupied territories this turn, it may draw a Resource card even without an enemy conquest. |
| Khan Industries | `hq_reinforcement` | alterRecruitment | At start-of-turn entry, add 1 troop to each territory Khan controls that contains any HQ. |
| Khan Industries | `territory_card_reinforcement` | alterRecruitment | After drawing a Territory card, if Khan controls that territory, optional +1 troop there. |
| Saharan Republic | `early_maneuver` | extraManeuver | One maneuver may be taken at any stable point during Saharan's own turn (HUD control). |
| Saharan Republic | `unconnected_maneuver` | extraManeuver | Normal maneuver timing, but source and target need only be **controlled**, not connected. |

---

## 7. Cities, end-game rewards, signatures, and campaign carry-over

### Cities (starter founding is a post-game reward only)

| City | Founded by | Target | Population | Legal start? |
|---|---|---|---|---|
| Major City | a **winner** (winner reward) | any territory **without a city**, regardless of control; may be scarred/occupied/contain an HQ | 2 | Only its founder may use it as a legal start, subject to HQ adjacency |
| Minor City | a **held-on** non-winner (held-on reward) | a territory that player **controls at game end** and that has **no city** | 1 | Never creates a legal start |

Each city stores `type`, `population`, `name`, `foundedByPlayerId`. Inventory is finite: **5 Major Cities, 9 Minor Cities**. City names are required, trimmed, public text; duplicates allowed with a UI warning. City population benefits whoever controls the territory at recruitment. Expanding into an unoccupied city costs population resistance, +2 if fortified. **World Capital** is module content (Pack 4): a city of population 5.

### End-game rewards & signatures

Post-game resolution order: the **winner** signs and resolves **one** winner reward; then **held-on** non-winners choose rewards **clockwise from the winner**. Eliminated and unused factions get no reward.

**Signatures** are mandatory, tied to real-world player identity, and visible on/near the board. Signature count drives future setup (see §4 starting Red Stars/missiles). A person's **second** signature triggers Pack 3 after reward resolution.

Winner rewards:
- `name_continent` — name an unnamed continent; the naming player gets a personal +1 when controlling it.
- `found_major_city` — found a Major City (above).
- `cancel_scar` — consume one of **4** cancel stickers; remove one territory scar and destroy/cancel its instance.
- `change_continent_bonus` — campaign-wide inventory of one **+1** and one **−1**; each continent may be changed at most once; change is global for all players.
- `fortify_city` — consume one of **5** Fortification marks; set or replace a city's fortification at **10** durability.

Held-on rewards:
- `found_minor_city` — found a Minor City (above).
- `upgrade_territory_card` — a card for a territory controlled at game end, not destroyed, resources < 6; consume a resource sticker for +1 resources. Coin cards cannot be upgraded.

### Campaign carry-over

Persist a canonical `CampaignState` between games (§10). **Carry:** board scars, cities, fortifications, continent names/bonus marks, destroyed/upgraded cards, signatures, faction-power choices/results, scar inventory, reward inventories, unlock flags, world name. **Do not carry:** troops, control, hands, unplayed missiles, Red-Star tokens, or transient turn/combat state. After **Game 15** rewards, starter reward changes stop; existing state and modules remain active.

---

## 8. Implementation slices

Build one slice at a time, test-first: write the failing test that encodes the spec, then implement to green. Each slice is one PR-sized change. (Live decomposition and status: [BACKLOG.md](BACKLOG.md).)

| # | Slice | Scope |
|---|---|---|
| 0 | Scaffold | Monorepo, workspaces, scripts (`test` / `lint` / `validate:content` / `sim`), typecheck. |
| 1 | Accounts & lobby | Auth, campaigns, invite codes, Socket.IO lobbies/presence/ready, append-only action ledger, per-viewer hidden-state filtering, campaign export on game end. |
| 2 | Map & manifest | 42 territories, symmetric adjacency, 6 continents, anchors; board SVG with the real-asset contract. |
| 3 | Content pack & validation | zod-validated pack; errors block startup, warnings require host acknowledgement. |
| 4 | Board render & sandbox | Interactive SVG, phase-aware highlights, troop/HQ/city markers; local hot-seat with the full action surface. |
| 5 | Turn machine | Start of turn, recruit, expand/attack, maneuver, end of turn. |
| 6 | Combat | Dice, sequential missile windows, conquest move-in bounds, knockout/elimination, card transfer. |
| 7 | Cards / Red Stars / victory | Sideboard mechanics, coin depletion award, 4-star win with immediate lock and auto-classification. |
| 8 | Scars | Combat/attrition effects (§5) and the scar play action (starter Bunker/Ammo, stable-boundary timing). |
| 9 | Faction powers | Executable handlers for the ten powers (§6). |
| 10 | End-game & carry-over | City founding, reward placement, board signatures (§7), and cross-game `CampaignState` persistence. |
| 11 | Unlock engine | Reveal/activation of sealed modules (§9) using the manifest and global hooks. |
| 12 | Import wizard | Compatibility path for custom or legacy host-supplied module cards (`content_required`); canonical sealed content is built in. |
| 13 | Polish | PixiJS effects layer at the stable `EffectsLayer` seam. |

---

## 9. Sealed module manifest

Each module is seeded as locked content with: `id`, `name`, `trigger`, `openCondition`, `revealTiming`, `permanentRules`, `cardsAdded`, `factionsAdded`, `stateAdded`, `rulesHooks`, `locked`. Canonical Pack 1-4 and Pocket 1-2 inventories and executable rules are built in from the sealed-content source audit. `content_required` remains only for custom/legacy host-supplied content.

| Module | Open condition | Reveal | Unlocks |
|---|---|---|---|
| Pack 1 — Advanced Draft / Biohazards | 9th Minor City founded & named | End-game | Advanced setup draft (replaces base roll setup); 3 Biohazard scar instances; city/population events |
| Pack 2 — Comeback Powers / Mercenaries | A player/faction eliminated | Mid-game if elimination is from a failed Join the War; else end-game | A comeback power for the eliminated faction (attached permanently to the faction); 3 Mercenary scar instances |
| Pack 3 — Homelands / Missions | A person's 2nd signature, after their winner reward | End-game | Homeland end-of-turn Resource draw; population events; Mission cards (incl. World/Global Capital placement) |
| Pack 4 — Lead Faction / Private Missions | World Capital mark placed | Immediately | World Capital (pop 5); Lead Faction setup bonus; Private Missions (capturable, once-per-game Red Star) |
| Pocket 1 — Nuclear War / Mutants | 3rd Missile committed to one combat roll | Mid-combat, before casualty resolution | Nuclear event on the defending territory; Fallout scar/mark; Mutant faction (next game) |
| Pocket 2 — Alien Landing | During recruitment: 30+ troops calculated and active player holds ≥1 Missile | Mid-game, before placement | Alien Island off-board territory via two sea lines; Alien faction (next game); Alien events; Weakness scars |
| Do Not Open Ever | Host-enabled only | Optional variant | One of: Deadly Virus / Unstable Orbit / Curse Deck / Ancient Entity. Forbidden unless the host explicitly enables it. |

### Resolved unlock mechanics (D5)

- **Pack 1.** Advanced setup replaces base setup with a five-category snake draft: Faction, Turn Order, Starting Placement, Starting Troops (6/8/8/10/10), and Starting Coin cards (0/0/1/1/2). Begin clockwise from the visibly acknowledged high roller and reverse after every draft round; placement and turns follow their independently drafted order cards. A non-zero Starting Coin pick interrupts the draft until that player explicitly takes the granted physical Coin cards from the public pile into their private hand. Join the War uses half that player's drafted starting troops. Biohazard targets any unscarred territory; at controller end-of-turn before draw, remove 1 troop and vacate if last.
- **Pack 2.** Eliminated faction chooses one comeback power, attached permanently to the faction. Executable powers are Resourceful (city expansion draw), Stealthy (recruit into one empty unmarked territory), Well-Armed (+1 attack dice against HQ), Mobile (move one controlled HQ at start of turn), Convincing (+1 extra Mercenary reinforcement), and Well-Supplied (ignore Ammo Shortage while defending). Mercenary targets any unscarred territory; at controller end-of-turn, add 1 troop if still controlled.
- **Pack 3.** A faction's **Homeland** is its uniquely most-used starting continent over the first 15 games; a tie means no Homeland. At end-of-turn draw, a faction may claim a face-up Territory card from its Homeland as if eligible, even without controlling it — still max one Resource draw and no draw without a draw entitlement. All eight public Missions and three Join the Cause Events are executable.
- **Pack 4.** Unlocks immediately when the World Capital is placed (a city, population 5). Lead Faction is the unique most-winning faction among factions playing this game; a tie means no Lead. The Lead chooses the public Mission and begins future games with **3 troops** in the World Capital in addition to its chosen start. All six Private Missions enter the public deck, can award/capture into an empty red faction slot, and can later be activated once per game under the one-Mission-per-turn rule.
- **Pocket 1.** Unlocks during combat after the **3rd** Missile committed to the same roll, before casualty resolution. The opening removes the committed attacking troops, wipes the defending territory, destroys its Territory card, places Fallout, rolls troop losses in every land-adjacent territory, and discards Resource cards for resulting knockouts. Mutants, their Private Mission, five Missile Powers, four evolution paths, and eight Events are executable.
- **Pocket 2.** Creates Alien Island with two sea-line connections, shuffles its Territory card into the Resource deck, applies Alien Collaborator to the triggering faction's yellow slot, and treats the collaborator plus arriving Alien troops as one faction for the opening game. Aliens are independently selectable in later games. All five Weaknesses, the Alien Private Mission, Ruins, and seven Alien Events are executable.
- **Unlock processing order.** If multiple modules unlock from one action/reward, queue and process in order: **Pack 1, Pack 2, Pack 3, Pack 4, Pocket 1, Pocket 2, optional variants**. Pause at any `content_required` unlock before continuing.

Global hooks for the unlock engine: `onMinorCityFounded`, `onPlayerStartTurn`, `onPlayerEliminated`, `onGameEnd`, `onBoardSigned`, `onMissionCompleted`, `onMissilePlayed`, `onCombatRollPendingResolution`, `onRecruitmentCalculated`, `onFactionDraftStarted`.

Keep optional variants separate from campaign modules. Suggested content files: `modules.json`, `cards.draft.json`, `cards.scars.json`, `cards.events.json`, `cards.missions.json`, `cards.private-missions.json`, `factions.unlocks.json`, `variants.optional.json`.

---

## 10. Campaign state

Persisted between games (carry rules in §7):

```ts
type CampaignState = {
  worldName: string;
  gameNumber: number;             // starter reward changes stop after Game 15
  unlockedModules: string[];
  contentRequired: { moduleId: string; items: string[] }[]; // compatibility/custom content pause
  hostContent: Record<string, unknown>; // custom/legacy host content keyed `${moduleId}.${item}`
  optionalVariantId?: string;
  signatures: Record<RealPlayerId, number>;
  factionPowerChoices: Record<FactionId, PowerId>;
  factionResults: Record<FactionId, GameResult[]>;
  foundedMinorCities: number;
  worldCapitalTerritoryId?: string;
  leadFactionId?: string;
  board: {
    scars: { territoryId: TerritoryId; scarId: string }[];
    cities: { territoryId: TerritoryId; type: "minor" | "major" | "world_capital"; name: string; foundedByPlayerId: string }[];
    fortifications: { territoryId: TerritoryId; durability: number }[];
    continentNames: Record<ContinentId, { name: string; namedBy: RealPlayerId }>; // namedBy carries the §7 personal +1 across games
    continentBonusMarks: Record<ContinentId, number>;
    cardModifications: { cardId: string; destroyed?: boolean; resources?: number }[];
  };
  inventories: { cancelStickers: number; fortifyMarks: number; majorCities: number; minorCities: number; scarInstances: Record<string, number> };
};
```

This maps onto the `campaigns` / `content_overrides` / `audit_log` tables; the per-game `game_actions` ledger replays to a `GameState`. Carrying the above between games is the campaign-persistence work.

---

## 11. Fixed contracts

- **Board SVG.** Root id `risk-board-modern`, viewBox `0 0 749.819 519.068`, 42 `path.territory-border` elements keyed by canonical territory id. The real art drops in at `packages/map/assets/board.svg` with no rules/server changes.
- **Socket protocol.** `game:join`, `game:action`, and per-viewer filtered `game:state`.
- **No browser storage** in the web app; use React state.
