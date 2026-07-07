# Risk Legacy — Private Web Rebuild

Private, non-commercial digital table for one game group's Risk Legacy campaign. Built from `risk-legacy-web-rebuild-plan.md`.

## Layout

```
packages/map        42-territory manifest (adjacency, continents, anchors), board SVG generator + validation
packages/content    canonical content pack (factions, powers, scars, 52 resource cards, payout table, rule constants, sealed unlock gates) + zod validation
packages/rules      deterministic seeded rules engine (event-emitting, replayable) + vitest suite
apps/server         Express + Socket.IO + Kysely/Postgres: accounts, campaigns/invites, lobbies, append-only action ledger, hidden-state filtering, auto campaign export on game end
apps/web            Vite/React/Tailwind war-room UI: hub + fully playable local hot-seat sandbox
tools/simulator     seeded full-game CLI harness through the real action API
```

## Quick start

```bash
npm install
npm test                 # 92 tests (engine, campaign, unlocks, content, map, server via pg-mem, web via jsdom)
npm run lint             # tsc typecheck, all projects
npm run validate:content # blocks on errors; prints verify-pending warnings
npm run sim -- 1234 4    # full seeded 4-player game in the terminal
npm run dev:web          # hot-seat sandbox at http://localhost:5173
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

## Swapping in the real board art

The repo renders a generated placeholder with the **same contract** as `risk_board_modern_web.svg`: root id `risk-board-modern`, viewBox `0 0 749.819 519.068`, and 42 `path.territory-border` elements whose ids are the canonical territory ids. Drop the real file at `packages/map/assets/board.svg`; the web `Board` component marks the swap point (load the asset, bind clicks by those ids) — no rules/server changes needed.

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

All ten **faction starting powers** (SPEC §6) are implemented and `confirmed`: a faction's power is chosen on its first play (`setup.choose` powerId), attaches to the faction permanently, carries across games via the campaign, and every application emits `FactionPowerApplied`. **Still genuinely pending:** module-gated content only (e.g. the Pack 2 Mercenary scar) — unlocked by the module engine (BACKLOG task 11).

Already enforced: 4 Red Stars to win with immediate board lock, defender wins ties, missiles = unmodifiable 6 with sequential post-roll windows, conquest move-in min = surviving attackers / max = all-but-one, 4-slot face-up sideboard with slot-4 discard on coin draw, mandatory matching face-up territory card, deck reshuffle from discard, first coin-pile depletion red-star award (tie = none), knockout vs. elimination with automatic resource-card transfer, HQs as independent pieces keyed to original faction, Won/Held-On/Eliminated auto-classification.

## Status

Live task status, dependencies, and what to build next live in **[BACKLOG.md](BACKLOG.md)**; dated history is in [PROGRESS.md](PROGRESS.md); design intent in [SPEC.md](SPEC.md).

High level: the **base single game is complete and playable hot-seat** with **all ten faction powers**, **placeable starter scars**, **in-engine end-game rewards/signatures**, **cross-game campaign persistence** (engine `CampaignState` + server `campaigns.state`), and the **unlock-module engine** (Pack 1 + Pack 2 trigger/reveal live; Mercenary wired; sealed content pauses on host-entered text). The simulator chains two campaign games end-to-end — a game-1 elimination unlocks Pack 2 and game 2 deals Mercenary scars from the folded campaign. The rule decisions D1–D5 are all resolved (SPEC §5–§10). **Networked play is reachable through the browser**: hub → CONNECT → register/login → campaigns/invites → lobby (with the **sealed-content import wizard** for `content_required` unlocks) → the networked game screen on the per-viewer filtered Socket.IO protocol (`game:join`, `game:action`, `game:state`), sharing the same `GameScreen` as the hot-seat sandbox. Effects render via **PixiJS** at the `EffectsLayer` seam (graceful fallback without WebGL). The original backlog is complete; what's next (module mechanics from host-entered card text, real board art) is queued in BACKLOG.
