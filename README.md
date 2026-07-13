# Risk Legacy — Private Web Rebuild

Private, non-commercial digital table for one game group's Risk Legacy campaign. Built from `risk-legacy-web-rebuild-plan.md`.

## Studio table runtime

This is the standalone sibling project that executes [the Presentation Runtime Migration Specification](docs/PRESENTATION-RUNTIME-MIGRATION-SPEC.md) without modifying `risk-legacy-web`.

PixiJS owns the board, generated one-/three-troop miniatures, HQs, permanent marks, camera, interaction treatments, and effects. React owns decisions, cards, HUD, settings, and the synchronized accessible board. A Presentation Director keeps Presented State behind Authoritative State long enough to explain recruitment, movement, battle, conquest, scars, module reveals, legacy rituals, and victory in causal order.

The generated faction sheets live in `apps/web/src/assets/table/pieces`; transparent masters and export notes live in `art-source`. Production atlases are 78–122 KB each versus a 700 KB budget. The Balanced board source rasterizes near a 2250-pixel long edge, while High uses 3000 and Low 1500.

For focused visual QA, open `/?table-demo=1`. The fixture uses the production Pixi runtime and exercises every faction, interaction intent, battle, conquest, scars, modules, and victory.

## Layout

```
packages/map        rules geometry plus validated presentation slots, markers, routes, camera focus, and board source
packages/content    canonical content pack (factions, powers, scars, 52 resource cards, payout table, rule constants, sealed unlock gates) + zod validation
packages/rules      deterministic seeded rules engine (event-emitting, replayable) + vitest suite
apps/server         Express + Socket.IO + Kysely/Postgres: accounts, campaigns/invites, lobbies, append-only action ledger, hidden-state filtering, auto campaign export on game end
apps/web            React decision UI plus lazy Pixi table, accessibility mirror, generated atlases, and Playwright E2E
tools/simulator     seeded full-game CLI harness through the real action API
```

## Quick start

```bash
npm install
npm test                 # engine, campaign matrix, unlocks, content, map, server via pg-mem, and web UI
npm run lint             # tsc typecheck, all projects
npm run validate:content # blocks on errors; prints verify-pending warnings
npm run sim -- 1234 4    # full seeded 4-player game in the terminal
npm run campaign:fixtures # materialize 18 campaign-stage QA snapshots
npm run dev:web          # hot-seat sandbox at http://localhost:5173
npm run validate:presentation-map
npm run test:presentation
npm run test:visual      # Chromium goldens: factions, marks, tiers, motion, desktop/tablet/phone
npm run perf:table       # 150+ piece, battle, diagnostics, and resize renderer budgets
npm run perf:table:soak  # 30-minute active/idle heap and resource endurance gate
npm run assets:table:report
```

## LAN deployment (Mac mini)

1. Postgres reachable at `192.168.86.21:5432` (use the IPv4 directly; `.local` may resolve IPv6 from Windows clients). Create db/user, then:
   ```bash
   cp apps/server/.env.example apps/server/.env   # edit DATABASE_URL / CORS_ORIGINS
   npm run migrate -w @risk/server
   npm run dev:server                              # :8787 — REST auth/campaigns + Socket.IO lobbies/games
   npm run dev:web                                 # vite --host, open from any laptop on the LAN
   ```
2. Backups: completed games auto-write campaign export JSON to `BACKUP_DIR`. Add a nightly `pg_dump` cron on the host for the second backup direction.

## Table presentation contract

The hand-authored `packages/map/assets/board.svg`, canonical territory ids, adjacency, and `0 0 749.819 519.068` coordinates remain fixed. `GameTable` lazy-loads the Pixi adapter only on game entry. `packages/map/data/presentation.json` supplies authored territory profiles, and `packages/map/src/presentation.ts` expands and validates piece, marker, overflow, label-avoidance, and camera slots. The synchronized DOM adapter exposes exact state and legal actions without rendering visual pieces.

## Legacy board source

The production Pixi scene rasterizes the hand-authored SVG at a quality-tier-specific resolution and builds pointer masks from canonical territory paths. `npm run generate:board` writes `board.generated-preview.svg` for geometry debugging and never overwrites the production artwork.

## Confirmed core rules

These were verified against the rulebook and corrected in pack **v2**. Values live as **data** in `packages/content/data/pack.*.json`; behavior is enforced in `packages/rules`.

- Players: **3–5** (2-player not supported; `createGame` rejects <3)
- Starting troops: **flat 8** per player, no scaling
- Red Star purchase: **4 Resource cards** (Territory or Coin; value irrelevant), repeatable at start of turn
- Own HQ: every **controlled** HQ = 1 board Red Star; a 0-troop HQ territory is controlled by nobody
- Legal start: unoccupied **unmarked** territory, or own-founded **Major City** (minor cities never qualify)
- Initial HQ: **not adjacent** to another faction's HQ
- Join the War: **half starting (4)** troops, no HQ placed
- City resistance on expand: population (Minor 1 / Major 2 / Capital 5) **+2 if fortified**; no resistance when attacking enemy-held cities
- Recruitment: **max(floor((territories + city population) / 3), 3)** — population counts *inside* the division (corrected 2026-07-06; was previously added at face value) — plus continent bonuses and trade-ins

Scar effects are confirmed in data **and wired into the engine** (Slice 8): Bunker (+1 highest def die), Ammo Shortage (−1 highest def die), Biohazard (−1 troop at controller's end of turn; territory vacated if it was the last), Fortification (+1 each def die, +2 expand, durability 10 marked on 3-attacker rolls, expires at 0). Missile-set dice stay unmodifiable — scars never alter a missile 6. Starter scars (Bunker, Ammo Shortage) are now **placeable in play** via the `scar.play` action, so these effects are reachable in a real game. Defense dice are clamped to 1..6 after scar modifiers.

All ten **faction starting powers** (SPEC §6) are implemented and `confirmed`: before Game 1 the campaign stores one validated power for every faction, the power attaches to the faction permanently, and every application emits `FactionPowerApplied`. The same initializer places the official 12 starting Resource stickers (maximum 3 resources per Territory card).

Already enforced: 4 Red Stars to win with immediate board lock, defender wins ties, missiles = unmodifiable 6 with sequential post-roll windows, conquest move-in min = surviving attackers / max = all-but-one, 4-slot face-up sideboard with slot-4 discard on coin draw, mandatory matching face-up territory card, deck reshuffle from discard, first coin-pile depletion red-star award (tie = none), knockout vs. elimination with automatic resource-card transfer, HQs as independent pieces keyed to original faction, Won/Held-On/Eliminated auto-classification.

## Status

Live task status, dependencies, and what to build next live in **[BACKLOG.md](BACKLOG.md)**; dated history is in [PROGRESS.md](PROGRESS.md); design intent in [SPEC.md](SPEC.md).

High level: the **canonical campaign is executable from Game 1 through post-Game-15 play**. That includes all ten starting faction powers, scars, end-game rewards/signatures, campaign persistence, all four Packs, both Pockets, public and Private Missions, every standard sealed Event, Mutants/evolutions/Missile Powers, Aliens/Weaknesses/Ruins, and Alien Island's topology and Territory card. Eighteen campaign-stage fixtures exercise every trigger boundary and active module, legal setup, Red Star victory/reward flow, game-to-campaign fold, persisted JSON, and next-game creation; all 18 also round-trip through the browser save store and PostgreSQL snapshots. The simulator chains two games end-to-end. **Networked play is reachable through the browser**: hub → CONNECT → register/login → campaigns/invites → lobby → shared game screen. A compatibility import wizard remains for custom/legacy card overrides. The optional Do Not Open Ever packet is intentionally disabled. Verification and provenance live in [the rulebook audit](docs/RULEBOOK-CAMPAIGN-AUDIT.md) and [sealed-content source audit](docs/SEALED-CONTENT-SOURCE-AUDIT.md).
