# Risk Legacy — Web Rebuild Plan (Revision 2)

> **Largely superseded (2026-06-13).** Design intent now lives in [SPEC.md](SPEC.md); live task status + decisions in [BACKLOG.md](BACKLOG.md); dated history in [PROGRESS.md](PROGRESS.md). This file is kept for its prose context only and is no longer the place to track status. Consider retiring it once SPEC/BACKLOG are settled.

Companion to the original `risk-legacy-web-rebuild-plan.md`. This revision folds the verify-pending rules into confirmed values and adds the sealed-module manifest. Content-pack version bumped to **v2**.

---

## 1. Build status against the 14 slices

Moved to **[BACKLOG.md](BACKLOG.md)** (live task status, dependencies, blockers, acceptance) and **[PROGRESS.md](PROGRESS.md)** (dated worklog). Not restated here to avoid drift.

---

## 2. Confirmed core rules (was "verify-pending")

All of the following are now **confirmed** and corrected. "Data" = fixed in `packages/content/data/pack.*.json`. "Engine" = enforced in `packages/rules`. "Pending-engine" = value confirmed in data, behavior not yet wired.

| Rule | Confirmed value | Where |
|---|---|---|
| Players | 3–5. **2-player is not supported.** | Data + Engine (`createGame` rejects <3) |
| Starting troops | **Flat 8 per player.** No player-count scaling. | Data + Engine (`startingTroops()`) |
| Red Star purchase | **4 Resource cards** (Territory or Coin; resource value irrelevant). Multiple may be bought at start of turn if enough cards. | Data + Engine (repeatable in `start_turn`) |
| Own HQ | Every HQ a player **controls** = 1 board Red Star. An HQ territory with 0 troops is controlled by nobody. | Data + Engine (`redStars()`) |
| Legal start | Unoccupied **unmarked** territory, or unoccupied **Major City founded by that player** (even if scarred). **Minor cities never qualify.** | Data + Engine (`isLegalStart`); major-city allowance activates with the city-founding slice |
| Initial HQ adjacency | Initial HQ **cannot be adjacent to another faction's HQ**. | Engine (`isLegalStart(..., placingHq=true)`) |
| Join-the-War legal start | Same as starting placement, **no HQ placed** → HQ-adjacency only applies when placing an HQ. | Engine |
| Join-the-War troops | **Half the starting total (=4).** No HQ placed. | Data + Engine (`joinWarTroops()`) |
| City resistance on expand | Expanding into an **unoccupied** city costs troops = population (Minor 1, Major 2, World Capital 5); **fortified +2**. Attacking enemy troops in a city pays **no** resistance. | Data + Engine (fortified surcharge live; city founding pending) |

### Scar effects (confirmed; wired into the engine in Slice 8)

| Scar | Effect |
|---|---|
| Bunker | Defender adds **+1 to the highest** defense die. |
| Ammo Shortage | Defender **−1 to the highest** defense die. |
| Biohazard | At the end of the controlling player's turn, **lose 1 troop** from this territory. |
| Fortification | City only. Defender **+1 to each** defense die. Expanding into the unoccupied fortified city costs **+2**. Mark 1 durability box after each attack roll made with **3 attacking troops**; after **10 boxes** the city is no longer fortified. Re-fortifying **replaces** remaining durability. |

(Mercenary scar belongs to Pack 2 and is defined on unlock.)

---

## 3. Sealed module manifest

Seeded as **locked** content (`implementationStatus: "content_seeded"`) in pack v2. Each module carries `id`, `name`, `trigger`, `openCondition`, `revealTiming`, `permanentRules`, `cardsAdded`, `factionsAdded`, `stateAdded`, `rulesHooks`, `locked`.

| Module | Open condition | Reveal | Unlocks |
|---|---|---|---|
| **Pack 1** — Advanced Draft / Biohazards | 9th Minor City founded | End-game, after last Minor City placed & named | Snake-order advanced setup draft (starting resources/coins, placement order, turn order, starting troop count); 3 Biohazard scars; city-focused events |
| **Pack 2** — Comeback Powers / Mercenaries | A player/faction eliminated | Mid-game if a faction can't legally Join the War; else end-game on elimination | Blue Comeback Powers for eliminated factions; 3 Mercenary scars |
| **Pack 3** — Homelands / Missions | Second board signature by one person | End-game, after second-win reward | Homeland end-of-turn Resource draw; population events; Mission cards (incl. World/Global Capital placement) |
| **Pack 4** — Lead Faction / Private Missions | World/Global Capital mark placed | Mid-game, when mark enters play | Lead Faction (most wins) picks public mission + extra troops at Capital; World Capital pop 5; 6 Private Missions capturable into a faction slot for a once-per-game Red Star |
| **Pocket 1** — Nuclear War / Mutants | 3 Missiles in the same combat roll | Mid-combat, after 3rd missile, before resolution | Bringer of Nuclear Fire; Fallout scar destroys city/scar/card/troops/HQ + neighbor attrition; Mutant faction + evolutions; brown Missile Powers; Mutant events |
| **Pocket 2** — Alien Landing | Player about to place 30+ troops **and** holds ≥1 Missile | Mid-game during recruitment, before placement | Alien Collaborator; Alien Island via two sea lines; Alien faction (draftable after); Alien events; yellow Weakness scars |
| **Do Not Open Ever** | Host-enabled only | Optional variant | One of: Deadly Virus / Unstable Orbit / Curse Deck / Ancient Entity. **Forbidden unless host enables.** |

Recommended global hooks (for the unlock engine, Slice 11): `onMinorCityFounded`, `onPlayerStartTurn`, `onPlayerEliminated`, `onGameEnd`, `onBoardSigned`, `onMissionCompleted`, `onMissilePlayed`, `onCombatRollPendingResolution`, `onRecruitmentCalculated`, `onFactionDraftStarted`.

Keep optional variants separate from campaign modules. Suggested content files: `modules.json`, `cards.draft.json`, `cards.scars.json`, `cards.events.json`, `cards.missions.json`, `cards.private-missions.json`, `factions.unlocks.json`, `variants.optional.json`.

---

## 4. Campaign state (persistence target for Slice 10/11)

```ts
type CampaignState = {
  unlockedModules: string[];
  optionalVariantId?: string;
  signedWins: Record<PlayerId, number>;
  foundedMinorCities: number;
  worldCapitalTerritoryId?: string;
  leadFactionId?: string;
  factions: FactionLegacyState[];
  board: BoardLegacyState;
};
```

This maps onto the existing `campaigns` / `content_overrides` / `audit_log` tables; the per-game `game_actions` ledger already replays to a `GameState`. Carrying scars, signatures, founded cities, and unlock flags **between** games is the new persistence work.

---

## 5. Next implementation slices (recommended order)

1. **Scar play action (remaining Slice 8 increment).** The four scar combat effects (Bunker / Ammo Shortage / Fortification dice mods + durability; Biohazard attrition) are wired into `resolveCombat`/end-of-turn and tested. What's left is the action that plays a held Scar card onto a target, gated per the play rules (SPEC §5, resolved 2026-06-13; tracked as task `8b` in BACKLOG). Per-game PLAY only; cross-game persistence is task `10b`.
2. **Faction power handlers (Slice 9).** Powers need their concrete definitions before wiring; the typed handler ids (`modifyCombatDie`, `alterRecruitment`, `extraManeuver`, `legalStartOverride`) and hook points exist.
3. **Networked game screen (Slice 1 web).** Connect the web game page to the live Socket.IO protocol (`game:join` / `game:action` / filtered `game:state`); reuse the existing board + panels.
4. **City founding + cities (enables Slice 8/11 fully).** Minor/Major city placement; only then do the Major-City legal-start allowance and Pack-1/3/4 city mechanics activate.
5. **Unlock engine (Slice 11)** using the manifest + hooks; then end-game rewards/signatures and cross-game persistence (Slice 10).
6. **Polish (Slice 13):** PixiJS effects upgrade at the existing `EffectsLayer` seam.
