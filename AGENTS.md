# Risk Legacy Agent Guide

## Verification loop

Run after every change before claiming done:

1. `npm test` - must stay green.
2. `npm run lint` - TypeScript checks across all projects; zero errors.
3. `npm run validate:content` - content pack errors block; warnings are acceptable.
4. `npm run sim -- 1234 4` - full seeded 4-player game must reach a winner.
5. `npm run validate:presentation-map && npm run test:presentation` - presentation contracts and semantic recording stay green.
6. `npm run test:visual && npm run perf:table && npm run assets:table:report` - real Chromium visuals, renderer cost, and transfer budgets stay green for table changes.

Before declaring a presentation-runtime release complete, also run the opt-in 30-minute `npm run perf:table:soak` endurance gate.

If any command fails, stop and report the failure instead of working around it.

## Architecture map

- `packages/map` - rules geometry plus validated presentation slots, marker positions, camera focus, and board source.
- `packages/content` - canonical content pack data, rule constants, factions, powers, scars, cards, sealed unlock modules, and content validation.
- `packages/rules` - deterministic seeded rules engine, event-sourced action reducer, campaign folding, hidden-state filtering, types, RNG, and rules tests.
- `apps/server` - Express, Socket.IO, Kysely/Postgres, auth, campaigns, lobbies, game sessions, append-only action ledger, per-viewer filtering, migrations, and campaign exports.
- `apps/web` - React decision surfaces around a lazy Pixi table. `PresentationDirector` alone owns table time and commit order; adapters receive semantic commands. Never add React-rendered pieces or independent table timers.
- `apps/web/e2e` - Playwright visual, animation, real-route, responsive, reduced-motion, quality-tier, and performance gates.
- `tools/simulator` - seeded full-game CLI harness through the real action API.
