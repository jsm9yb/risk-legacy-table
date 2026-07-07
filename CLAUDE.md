# Risk Legacy — agent guide

Private, non-commercial digital Risk Legacy table. TypeScript monorepo (npm workspaces, Node 22).
See @README.md for layout and confirmed rules, @SPEC.md for the design specification (status-free), @BACKLOG.md for the live task list + decision queue (the single source of truth for what to build next), @PROGRESS.md for the dated worklog, and @package.json for scripts. (@PLAN-r2.md is an older worked plan, now largely superseded by SPEC + BACKLOG.)

## Setup (first time on a machine)
`npm install` at the repo root before running anything below.

## Verification loop — run after EVERY change, before claiming done
1. `npm test` — must stay green (see PROGRESS.md for current count).
2. `npm run lint` — tsc across all 6 projects; zero errors.
3. `npm run validate:content` — content pack must validate (errors block; warnings are acceptable).
4. `npm run sim -- 1234 4` — full game must still reach a winner.
If you can't make all four pass, stop and report rather than working around them.

## How to work
- Take ONE task at a time from @BACKLOG.md. Work test-first: write the failing test that encodes the spec, then implement until green.
- Pick the next task and learn what's blocked via @BACKLOG.md (its "Loop contract" + "Needs a decision" queue). Don't restate task status in other files — BACKLOG owns it.
- Keep changes scoped to the relevant package. Don't refactor across the monorepo opportunistically.

## Conventions (non-negotiable)
- Label changed/added lines with a trailing `// new` (or `# new`) comment. Don't rename existing identifiers unless asked.
- Rules data lives in `packages/content/data/pack.*.json`, NOT in code. New rule constants/values go there with a `verification` flag (`confirmed` | `pending`). Engine reads them via `ruleValue()`.
- The engine (`packages/rules`) is deterministic and event-sourced: `applyAction(state, action)` clones, validates, mutates the clone, appends events, returns it. Randomness only through `state.rngState` (seeded). Never read `Math.random()` in the engine.
- The server action ledger (`game_actions`) is APPEND-ONLY. Corrections append a new row with a reason; never mutate or delete past rows.
- Hidden information: other players' hands and deck order are filtered server-side (`filterState`). Don't leak them into client payloads.
- Commit author must be `Jordan Smith <jordansmithkc@gmail.com>`. No rebase workflows — direct, non-destructive only.

## Guardrails (do NOT do these)
- Do NOT invent faction power or scar behaviors. Only implement effects whose `verification` is `confirmed` in the pack. If a definition is missing (e.g. faction powers are still `pending`), stop and ask.
- Do NOT change the board SVG contract: root id `risk-board-modern`, viewBox `0 0 749.819 519.068`, 42 `path.territory-border` elements keyed by canonical territory id. The real art is a drop-in swap at `packages/map/assets/board.svg`.
- Do NOT add 2-player support — starter rules are 3–5 players.
- Do NOT introduce localStorage/browser storage in the web app; use React state.
- Be mindful of performance: `applyAction` deep-clones state including the event log. Don't add O(n) work per event that makes long games quadratic.

## Architecture quick map
- `packages/map` — 42-territory manifest, adjacency, board SVG generator + `validateManifest`.
- `packages/content` — zod-validated content pack (v2), rule constants, sealed modules.
- `packages/rules` — engine (`engine.ts`), types, seeded RNG, tests. The source of truth for game logic.
- `apps/server` — Express + Socket.IO + Kysely/Postgres: auth, campaigns, lobbies, ledger, hidden-state filtering.
- `apps/web` — Vite/React/Tailwind hot-seat sandbox (the networked game screen is not built yet).
- `tools/simulator` — greedy full-game harness through the real action API.

---

## Choosing what to implement next

You decide the next task each session — don't wait to be told. The full procedure, task list, dependencies, blockers, and acceptance criteria live in @BACKLOG.md. In short:
1. Read @BACKLOG.md — the "Loop contract", the "Ready right now" line, and the "Needs a decision" queue.
2. Pick a `todo` task whose `Depends on` are all `done` and whose `Blocked by` is `—`, choosing by: unblocks most downstream → most player-facing value → smallest safe increment.
3. State in one line which task you chose and why, then work **test-first**.
4. If the most valuable task is `blocked` on a decision, don't guess — leave it and tell the human which decision (D1–D5) to resolve.

## Tracking your work

Status lives in @BACKLOG.md; dated history lives in @PROGRESS.md. In the **same change** as your code (after the verify loop passes):
- Flip the task's `Status` in @BACKLOG.md (`todo` → `in_progress` → `done`); if a decision lands, update its `Needs a decision` entry.
- Prepend a dated worklog entry to @PROGRESS.md: what you did, the new test count, anything discovered or deferred.
- Never mark a task `done` unless all four verify commands pass **and** the feature is reachable in real play (see BACKLOG "Acceptance conventions").
