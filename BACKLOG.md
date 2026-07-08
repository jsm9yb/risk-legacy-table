# Risk Legacy — Backlog

**Single source of truth for what to build, in what order, and what's blocked.** The loop reads this to choose the next task and flips a task's `Status` here when it lands. Design intent lives in [SPEC.md](SPEC.md); dated history lives in [PROGRESS.md](PROGRESS.md). Status is tracked **here only** — other docs link here, they don't restate it.

---

## Loop contract (read every iteration)

1. **Verify after every change, before marking anything done:** `npm test` · `npm run lint` · `npm run validate:content` · `npm run sim -- 1234 4`. All four green, or stop and report — never work around them.
2. **Pick the next task:** among `todo` tasks whose `Depends on` are all `done` **and** whose `Blocked by` is `—`, choose by, in order: unblocks the most downstream work → most player-facing value → smallest safe increment.
3. **Never invent a rule** whose verification is `pending`. If the next-most-valuable task is `blocked`, leave it and add/point to its entry in **Needs a decision** rather than guessing.
4. **One PR-sized task at a time.** When it lands: set its `Status` here and prepend a dated entry to PROGRESS.md (what changed, new test count, anything discovered/deferred).

## Status legend
`done` · `in_progress` · `todo` (ready — no open blocker) · `blocked` (needs a decision below, or an upstream task)

## Acceptance conventions
A feature task is done only when **(a)** its named tests pass, **(b)** the full verify loop is green, and **(c) reachability** — the mechanic is exercised by *real play* (the simulator or an end-to-end path), not unit tests alone. (c) is mandatory because code can pass unit tests while being unreachable in an actual game (this already happened — see `8a`).

---

## Needs a decision

**All five decisions (D1–D5) were resolved 2026-06-13** and recorded in SPEC §5 (scars), §6 (faction powers), §7 (cities/rewards/signatures/carry-over), and §9 (unlock modules). The tasks below are now unblocked. The remaining open inputs are **`content_required`** items inside the unlock modules (host-entered Event/Mission/Power card text), surfaced by the import wizard (task `12`) rather than blocking the engine.

Notable reclassifications from the D1–D5 update (ripple into existing code — see affected tasks):
- **Fortification is not a scar** — it's a winner reward mark (`fortify_city`) on a city. Its combat effect data stays in the pack for the engine to read, but it is never dealt or played.
- **Biohazard → Pack 1**, **Mercenary → Pack 2** — neither is dealt at starter setup. Starter playable scars are **Bunker ×3 + Ammo Shortage ×3** only.
- **Starting Red Stars are signature-driven** (§4/§7): 0 signatures → 1 token; ≥1 → missiles = signature count, no token. Base Game-1 behavior (everyone at 0) is unchanged.
- **Faction power ids in the pack are placeholders** and must be replaced with the official ids in SPEC §6 as part of task `9`.

---

## Done (built & verified)

| id | title | note |
|---|---|---|
| 0 | Monorepo scaffold + scripts | workspaces; `test`/`lint`/`validate:content`/`sim` |
| 2 | Map + 42-territory manifest | symmetric adjacency, continents, anchors; placeholder board SVG w/ real-asset contract |
| 3 | Content pack v2 + validation | zod-validated; errors block, warnings need host ack |
| 4 | Local hot-seat web sandbox | wires the real engine through every phase; **the one fully playable surface today** |
| 5 | Turn machine | start / recruit / expand-attack / maneuver / end |
| 6 | Combat | dice, sequential missile windows (unmodifiable 6), conquest move-in bounds, knockout/elimination, card transfer |
| 7 | Cards / red stars / victory | sideboard (4 slots, slot-4 coin discard, reshuffle), forced matching draw, coin-depletion star, 4-star lock + auto Won/Held-On/Eliminated |
| 1s | Server (headless) | scrypt auth, campaigns + invites, Socket.IO lobbies, event-sourced sessions, per-viewer hidden-state filter, campaign export. **Needs Postgres; no web UI drives it yet (see 1-web-a/b).** |
| 8a | Scar combat effects | Bunker/Ammo/Fortification dice mods + durability + expiry; Biohazard attrition; defense dice clamped 1..6. |
| 8b | Scar play action | starter inventory (Bunker ×3 + Ammo ×3) dealt hidden; `scar.play` by the holder at a stable boundary on any turn; one scar/territory; **8a effects now reachable in real play** (proven by test + reachability case). |
| sim | Simulator harness | greedy full-game CLI through the real action API |

---

## Active backlog

### BUG-1 — Server rejects <3 players to match the engine
- **Status:** done
- **Depends on:** — · **Blocked by:** —
- **Scope:** `apps/server/src/main.ts` `game:create` allows `players.length < 2`; the engine's `createGame` rejects fewer than 3, so a 2-player lobby creates a session that crashes on replay. Change the guard to `< 3`.
- **Non-goals:** lobby UI.
- **Acceptance:** server refuses to create a session with 2 ready players with a clear error; verify loop green. (Add a server test if the harness reaches `game:create`; otherwise note it's manual.)

### TEST-web — Minimal web test harness
- **Status:** done
- **Depends on:** — · **Blocked by:** —
- **Scope:** add a Vitest + React Testing Library (or Playwright) setup under `apps/web` so web tasks have machine-verifiable acceptance. Web currently has **zero** automated tests.
- **Non-goals:** exhaustive UI coverage.
- **Acceptance:** one smoke test renders the hub and starts a sandbox game; `npm test` picks it up; verify loop green. Enables real acceptance for `1-web-*` and `13`.

### 1-web-a — Auth + campaign/lobby UI
- **Status:** done
- **Depends on:** 1s · **Blocked by:** —
- **Scope:** web screens for register/login, list/create/join campaign (REST), and a Socket.IO lobby with ready/launch. The web app today only has hub → local sandbox; none of the server's auth/campaign/lobby surface is reachable from the UI.
- **Non-goals:** the in-game networked screen (that's 1-web-b); reconnection edge cases.
- **Acceptance:** a user can register, create/join a campaign, ready up, and trigger `game:create` against a running server; component tests (needs TEST-web) + build + typecheck green.

### 1-web-b — Networked game screen
- **Status:** done
- **Depends on:** 1s, 1-web-a · **Blocked by:** —
- **Scope:** connect the web game page to `game:join` / `game:action` / filtered `game:state`; render from the filtered payload; reuse `Board`, `SidePanel`, `Ledger`. This is what makes networked multiplayer actually playable.
- **Non-goals:** spectator-specific UX polish; optimistic updates.
- **Acceptance:** two clients against one server session see consistent, hidden-state-correct views and can take turns to a winner; tests (needs TEST-web) + build green. **Reachability:** a real 2-client session reaches `game_over`.

### 9 — Faction power handlers (SPEC §6)
- **Status:** done
- **Depends on:** 5, 6 · **Blocked by:** —
- **Scope:** replace the pack's placeholder power ids with the ten official ids (SPEC §6), one selected power **per faction** (attaches to faction, not player); implement handlers via the typed ids + hook points; emit `FactionPowerApplied` on every (automatic or optional) application; flip each implemented power to `confirmed`. Likely split per handler-group: **9a** modifyCombatDie (`fortified_hq`, `defensive_stand`, `lower_die_intimidation`, `total_conquest`), **9b** alterRecruitment/draw (`round_up_recruiting`, `expansionist_supply`, `hq_reinforcement`, `territory_card_reinforcement`), **9c** extraManeuver (`early_maneuver`, `unconnected_maneuver`).
- **Non-goals:** Comeback/Missile/Mutant/Alien powers (module content).
- **Acceptance:** per-power `engine.test.ts` cases; verify loop green; **reachability:** the simulator exercises at least the combat/recruitment-affecting powers.

### city — City model & mechanics (SPEC §7)
- **Status:** done
- **Depends on:** 5, 7 · **Blocked by:** —
- **Scope:** the city data model (`type` minor/major, `population`, `name`, `foundedByPlayerId`) and its in-game mechanics: population recruitment for the controller, expand resistance (pop +2 if fortified, already coded), and the Major-City legal-start allowance (already coded behind `foundedBy`). Founding itself happens in the post-game reward flow (task `10`), so this task wires the model + mechanics the reward consumes.
- **Non-goals:** the reward-driven founding action (10); Pack city events; World Capital (Pack 4).
- **Acceptance:** `engine.test.ts` for population recruitment + the Major-City legal start + city expand resistance; verify loop green.

### 10a — End-game reward placement / signatures (in-game) (SPEC §7)
- **Status:** done
- **Depends on:** 7, city · **Blocked by:** —
- **Scope:** the post-win flow in resolution order — winner signs + resolves one winner reward, then held-on non-winners choose clockwise. Winner rewards: `name_continent`, `found_major_city`, `cancel_scar` (4 stickers), `change_continent_bonus` (+1/−1, each continent once, global), `fortify_city` (5 marks, 10 durability). Held-on rewards: `found_minor_city`, `upgrade_territory_card` (territory card, <6 resources, +1; no coins). Track finite inventories (5 major / 9 minor cities, 4 cancel, 5 fortify). Auto-classification + export already exist (7/1s).
- **Non-goals:** carrying state to the next game (10b); module unlock dispatch (11).
- **Acceptance:** `engine.test.ts` per reward type + signature capture + resolution order; verify loop green.

### 10b — Cross-game campaign persistence (SPEC §7, §10)
- **Status:** done
- **Depends on:** 8b, city, 10a, 1s · **Blocked by:** —
- **Scope:** persist the canonical `CampaignState` (SPEC §10) and seed the next game from it — carry board scars, cities, fortifications, continent names/bonus marks, destroyed/upgraded cards, signatures, faction-power choices/results, scar + reward inventories, unlock flags, world name; **do not** carry troops/control/hands/missiles/tokens/transient state. Apply signature-driven starting Red Stars/missiles (§4). Stop starter reward changes after Game 15.
- **Non-goals:** the unlock *engine* (11).
- **Acceptance:** a completed game's legacy state seeds the next game's setup (signature→token/missile rule included); server/event-store tests; verify loop green.

### 11 — Unlock module engine (SPEC §9)
- **Status:** done
- **Depends on:** city, 10b · **Blocked by:** —
- **Scope:** reveal/activation state machine driven by the manifest + the global hooks in SPEC §9 (`onMinorCityFounded`, `onPlayerEliminated`, `onMissilePlayed`, …), honoring the **unlock processing order** (Pack 1→2→3→4→Pocket 1→2→variants) and **pausing at any `content_required`** unlock. Implement the per-pack permanent mechanics whose rules are fully defined (e.g. Pack 1 Biohazard placement + advanced-setup gating, Pack 2 elimination trigger + Mercenary, Pocket 1 nuclear trigger). Recommend starting with **one** pack end-to-end to validate the abstraction.
- **Non-goals:** host-entered card text (that's `12`); the "Do Not Open Ever" variants unless host-enabled.
- **Acceptance:** at least one module reveals on its trigger and applies its permanent rules; tests; verify loop green.

### 12 — Import wizard (`content_required` card text)
- **Status:** done
- **Depends on:** 11 · **Blocked by:** —
- **Scope:** host entry of Event/Mission/Power/Private-Mission card text for modules that unlock with `content_required` content; the engine pauses such unlocks until the host supplies text. Needs the web shell (1-web) for the host UI.
- **Acceptance:** a `content_required` unlock prompts the host, accepts entered text, and resumes the unlock queue; tests; verify loop green.

### 13 — Polish / PixiJS effects
- **Status:** done
- **Depends on:** — · **Blocked by:** —
- **Scope:** swap the canvas `EffectsLayer` for PixiJS at the existing stable seam; non-blocking, low priority.
- **Acceptance:** effects render at the seam with no game-component changes; build green (+ TEST-web smoke if present).

### UI-1 - Human-readable setup labels
- **Status:** todo
- **Depends on:** TEST-web · **Blocked by:** —
- **Scope:** replace raw faction-power ids and other snake_case labels in the web UI with player-facing names/descriptions from the content pack. Setup faction buttons should show readable power names, sideboard/card labels should use title-cased territory names, and the ledger should avoid internal ids where a readable label exists.
- **Non-goals:** changing content-pack ids, rules behavior, or sealed-content text.
- **Acceptance:** faction setup no longer displays strings like `fortified_hq` / `defensive_stand`; the setup smoke/component test covers the readable labels; verify loop green.

### UI-2 - Action-first side panel
- **Status:** todo
- **Depends on:** UI-1, UI-8 · **Blocked by:** —
- **Scope:** **Rescoped 2026-07-07 (design conversation):** spatial grammar is *bottom = you, right = the table*. Non-blocking phase controls (place-count stepper, expand/maneuver counts, End Attacks / End Maneuver / End Turn) move into a slim **action bar** in the UI-9 bottom strip beside the hand/HUD. The right rail becomes purely ambient: sideboard mat (UI-9) → Quick Look roster (emblem tiles) → battle log as a tab. Includes the Ledger perf fix: render the latest ~50 events with lazy "earlier…" expansion (currently re-renders the full log per action — quadratic on long games, noted 2026-07-06).
- **Non-goals:** mobile layout, board art, or new rules.
- **Acceptance:** no blocking flow renders in the rail (they live in UI-8 surfaces); phase controls live in the bottom action bar; the ledger no longer renders the full event log per action; existing game-screen tests updated/added for at least setup and recruit; verify loop green.

### UI-3 - Territory inspector and move preview
- **Status:** todo
- **Depends on:** UI-2 · **Blocked by:** —
- **Scope:** add a selected-territory inspector that shows owner, troops, HQ/city/scar markers, adjacent legal targets, and the action that the next click will take in the current phase. During attack/maneuver, selecting a source territory should make the target choices and consequences explicit before the player commits.
- **Non-goals:** undo, confirmation modals for every action, or rule-engine changes.
- **Acceptance:** selecting a territory in setup/attack/maneuver updates the inspector; illegal targets explain why they are unavailable when practical; tests cover at least attack-source selection and setup placement guidance; verify loop green.

### UI-4 - Board legibility pass
- **Status:** todo
- **Depends on:** UI-1 · **Blocked by:** —
- **Scope:** improve the current generated board's readability while it remains the active board: larger territory labels, clearer route lines, stronger owner/troop/HQ/city markers, and more distinguishable selected/legal/attack/move states. Keep the manifest-driven SVG renderer and existing click behavior.
- **Non-goals:** replacing the board with final art; changing territory anchors or adjacency.
- **Acceptance:** at 1280x720 all troop counts and major state markers are readable without zoom; legal setup and attack highlights are visually distinct; component smoke still asserts 42 territory shapes; verify loop green.

### UI-5 - Responsive play layout
- **Status:** todo
- **Depends on:** UI-2, UI-4 · **Blocked by:** —
- **Scope:** replace the fixed desktop-only game grid with a responsive layout. Desktop keeps board + rail; tablet/phone uses a board-first layout with a bottom drawer or tabbed panel for actions/status/logs, and the phase strip must remain usable without horizontal clipping.
- **Non-goals:** native app gestures, offline support, or a separate mobile game mode.
- **Acceptance:** no horizontal overflow at 390x844, 768x1024, and 1280x720; the current action remains reachable without page zoom; add the strongest automated coverage available plus a documented browser screenshot check; verify loop green.

### UI-6 - Game-first hub polish
- **Status:** todo
- **Depends on:** UI-1 · **Blocked by:** —
- **Scope:** remove project-status and implementation-copy from the hub, make the first screen feel like the game table, and keep the local hot-seat and LAN entry points obvious. Replace text like `1-web-b` / file-drop instructions with player-facing language and a compact board/campaign visual signal. **Design 2026-07-07:** board art as dimmed full-bleed backdrop; world name in display type; the five faction emblems in a row; entries "PLAY AT THIS TABLE" (hot-seat) and "JOIN THE WAR ROOM" (LAN); when connected with a campaign, show game number, signatures, and unlocked packs as opened-envelope icons.
- **Non-goals:** new campaign features, server behavior, or real board-art integration.
- **Acceptance:** hub contains no internal task ids or asset-drop instructions; local start and LAN connect flows still work in tests; verify loop green.

### UI-7 - Real board art integration
- **Status:** done
- **Depends on:** — · **Blocked by:** —
- **Scope:** swap the manifest-generated placeholder board for the final board SVG while preserving territory ids, click handlers, highlights, owner/troop/HQ/city overlays, and tests. The implementation should continue to use the map manifest as the source of truth for game state and adjacency.
- **Non-goals:** redesigning the map data model or changing Risk Legacy rules.
- **Acceptance:** final board art renders in the game screen; all 42 territories remain clickable and test-addressable; overlays align with territories at desktop and tablet sizes; verify loop green.

### UI-8 - Modal/overlay layer + combat modal
- **Status:** todo
- **Depends on:** UI-1 · **Blocked by:** —
- **Scope:** introduce a shared modal/overlay system for blocking decisions (decided 2026-07-07): **combat** gets a large centered overlay (attacker vs defender panels in faction colors, big dice with natural→final missile states, attacker/defender dice choice, the missile modifier window as an explicit interrupt, move-in slider); **card draws / hand decisions** get a bottom-anchored panel; **faction + power selection** gets a full-screen takeover during setup. Hot-seat and networked both show a clear "whose decision" marker on every blocking surface (no pass-the-device interstitial). Scar plays and rewards adopt the same layer where natural. The rail's `CombatTray` is retired.
- **Non-goals:** rendered card art (UI-9), faction emblems (UI-10), rules/engine changes, optimistic updates.
- **Design decisions (2026-07-07):** dice get a short CSS tumble (respect `prefers-reduced-motion`); an "Attack again" button re-declares the same battle after a non-conquering roll; the overlay keeps a compact per-roll battle history for sieges; a per-player "auto-defend with max dice" UI toggle (off by default) auto-dispatches the defender dice choice; scar/power effects on a roll render as explanatory badges.
- **Acceptance:** declaring an attack opens the combat overlay and drives dice choice → roll → missile window → casualties → move-in to completion through the real action API; setup runs through the full-screen faction/power picker; tests cover the combat overlay flow and the setup takeover; verify loop green.

### UI-9 - Rendered resource cards + card flows
- **Status:** todo
- **Depends on:** UI-8 · **Blocked by:** —
- **Scope:** render Resource cards as physical-game-styled card components (reference: white card, yellow name banner, gray textured panel with a white-outlined territory silhouette reusing the board SVG path geometry filled per continent, yellow lower panel with a 3×2 grid of 6 coin slots — filled coins = current `resources` incl. `cardModifications` upgrades, capped by `cardUpgradeMaxResources`; small card id in the corner; black logo card back for decks/hidden hands; **coin cards are a big single individual coin face** — same deck, distinct look from territory cards). Together these form the one resource deck. Rebuild the card-touching flows on these components: hand view, 4-slot sideboard, buy-Red-Star selection, recruit trade-in, end-of-turn draw (mandatory-match emphasized), and the `upgrade_territory_card` reward showing the new coin being added.
- **Non-goals:** scanned/photographic assets, new card rules, changing pack data.
- **Design decisions (2026-07-07):** ambient sideboard renders as a **sideboard mat** modeled on the rulebook illustration — top row DRAW (face-down stack) · coin slot (face-up) · MISSION · EVENT (sealed/empty outlines until modules unlock) · DISCARD; bottom row numbered slots 1→4 face-up; red star token pool beside the mat. The player's **hand is an always-visible strip along the bottom of the board**, sharing a personal HUD (recruitment estimate, red stars tokens+board, missiles, scar count); Quick Look in the rail keeps other players. Upgraded coins render **identical to base coins** (like the physical sticker — no marker). Card/mat textures are code-drawn (SVG filter) behind a single swappable seam so an external texture image can drop in later.
- **Acceptance:** hand/sideboard/draw/trade/buy flows all render card components instead of text labels; an upgraded card visibly shows its extra coin(s); card faces of other players' hands are never rendered from filtered payloads (counts/backs only); tests cover the card component (resource pips incl. an upgraded card) and one full draw flow; verify loop green.

### UI-10 - Faction visual identity
- **Status:** todo
- **Depends on:** UI-8 · **Blocked by:** —
- **Scope:** give the five base factions distinct visual identities beyond a hex color: an emblem/crest per faction in the board-art style — **static image assets (e.g. PNG) are fine; SVG not required** — plus faction-colored HQ/troop marker treatments, and a faction "card" (emblem, name, blurb, both starting powers) used by the UI-8 setup takeover, the Quick Look roster, and combat overlay headers.
- **Non-goals:** changing faction ids/colors in the pack, rules behavior, module factions (Mutants/Aliens) beyond leaving a slot for them.
- **Acceptance:** all five factions render distinct emblems in setup, roster, and combat surfaces; board markers visually distinguish factions beyond color at 1280x720; component tests assert emblems render per faction; verify loop green. Emblem art **exists** (2026-07-07) at `apps/web/src/assets/factions/*.png` in the main checkout (uncommitted — copy into the working branch), plus scar art at `assets/scars/*.png` and `assets/red-star.svg`. The images have solid dark backgrounds: render emblems as rounded framed tiles with a faction-color border, circular-cropped at small sizes (roster, ledger, HQ shield). Scar art renders as full cards in scar-play/inspector flows and circular chips on the board. A `FactionEmblem` component still provides a styled fallback for module factions without art.

### UI-12 - Victory, signing & reward flow presentation
- **Status:** todo
- **Depends on:** UI-8, UI-9, UI-10 · **Blocked by:** —
- **Scope:** make the end-game the legacy ritual it is (design 2026-07-07): (1) **victory beat** — full-screen takeover with the winner's emblem, then the signing moment rendering the winner's name in a handwriting face onto the board's signature rail (engine already auto-signs; presentation only); (2) **reward sequence** — a modal walking the engine's claim order with the whose-decision chip; rewards render as a sticker-sheet of choice cards showing remaining inventory, ineligible/depleted choices dimmed with the reason; (3) **target selection drops to the board** — city founding (glow → click → name → sticker animates on), continent naming, card upgrade via the UI-9 card component; (4) **aftermath screen** — per-faction results and a world-change recap, preceded by an **envelope tear-open reveal** whenever a module unlocks. Scar-play flow also lands here using the full scar art as a card + a circular board chip.
- **Non-goals:** engine/reward-rule changes, module mechanics, campaign persistence changes.
- **Acceptance:** a game driven to victory flows through victory beat → signing → each claimant's reward via the modal → aftermath; a module unlock shows the envelope reveal; a scar play uses the card flow; tests cover the reward modal claim order and one board-targeted reward; verify loop green.

### UI-11 - Legacy-game theming pass
- **Status:** todo
- **Depends on:** UI-8, UI-9, UI-10 · **Blocked by:** —
- **Scope:** extend the physical game's battle-worn aesthetic from the board (UI-7) to the surrounding chrome: hub, phase strip, rail, modals, ledger — textures, typography, and iconography inspired by the original game so the app reads as one artifact. Absorbs the intent of UI-6's "feel like the game table".
- **Non-goals:** copyrighted asset reproduction, board changes, new mechanics.
- **Acceptance:** hub + game chrome share the themed treatment; no regression in existing component tests; a documented browser screenshot check at 1280x720; verify loop green.

---

## Ready right now (no decision needed)
**The original engine/network backlog is complete.** The next ready pickup batch is UI polish, re-sequenced after the 2026-07-07 UX conversation (modals, card art, faction identity): `UI-1` → **`UI-8` (modal layer + combat modal, the keystone)** → `UI-9` (rendered cards + bottom strip) and `UI-10` (faction identity) in either order → `UI-2` (ambient rail + action bar) → `UI-12` (victory/reward presentation) → `UI-3`/`UI-4` → `UI-5`/`UI-6` → `UI-11` (theming capstone). `UI-7` is done with the in-repo board SVG asset.

What starts the next backlog cycle (add tasks here when they become real):
- **Module mechanics from host-entered text** — the import wizard stores `content_required` card text; the gameplay that consumes it (Pack 1 advanced-draft turns, Pack 2 comeback-power effects, Pack 3 missions/homelands play, Pack 4 lead faction/private missions, Pocket 1 nuclear resolution, Pocket 2 Alien Island) begins when the group actually unlocks a module and supplies real card text.
- **Networked-play niceties** — reconnection UX, optimistic updates, spectator polish, Ledger render perf on long games.
- **True socket/Postgres e2e** — the in-test session covers engine+filter+protocol; a scripted 2-laptop LAN checklist would close the loop.
