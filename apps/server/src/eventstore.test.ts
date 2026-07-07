import { describe, it, expect } from "vitest";
import { newDb } from "pg-mem";
import { runMigrations } from "./db/migrate.ts";
import { createDbFromPool } from "./db/connect.ts";
import { createGame, initialCampaign, applyGameToCampaign, applyAction, supplyModuleContent, type CampaignState } from "@risk/rules"; // new (10b, 12)

describe("event store (pg-mem smoke)", () => {
  it("migrates, appends actions append-only, reads back in order", async () => {
    const mem = newDb();
    const { Pool } = mem.adapters.createPg();
    const pool = new Pool();
    await runMigrations(pool as any);
    const db = createDbFromPool(pool as any);

    await db.insertInto("users").values({ id: "u1", username: "ada", display_name: "Ada", password_hash: "x:y" }).execute();
    await db.insertInto("campaigns").values({ id: "c1", owner_id: "u1", world_name: "World A", invite_code: "abcd1234" }).execute();
    await db.insertInto("game_sessions").values({ id: "s1", campaign_id: "c1", game_number: 1, seed: "42" }).execute();

    for (let i = 1; i <= 3; i++) {
      await db.insertInto("game_actions").values({
        session_id: "s1", seq: i, actor_id: "u1", kind: "action",
        payload: JSON.stringify({ type: "start.done", playerId: "u1", n: i }), reason: null,
      }).execute();
    }
    const rows = await db.selectFrom("game_actions").selectAll().where("session_id", "=", "s1").orderBy("seq").execute();
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(JSON.parse(rows[2].payload).n).toBe(3);

    // Append-only: duplicate seq must be rejected (PK), corrections append with reason
    await expect(
      db.insertInto("game_actions").values({ session_id: "s1", seq: 3, actor_id: "u1", kind: "action", payload: "{}", reason: null }).execute()
    ).rejects.toThrow();
    await db.insertInto("game_actions").values({
      session_id: "s1", seq: 4, actor_id: "u1", kind: "correction",
      payload: JSON.stringify({ supersedes: 3 }), reason: "host fix: misclick",
    }).execute();
    const all = await db.selectFrom("game_actions").selectAll().where("session_id", "=", "s1").orderBy("seq").execute();
    expect(all).toHaveLength(4);
    expect(all[3].kind).toBe("correction");
  });

  it("persists campaign state and seeds the next session from the stored snapshot (10b)", async () => { // new: whole test
    const mem = newDb();
    const { Pool } = mem.adapters.createPg();
    const pool = new Pool();
    await runMigrations(pool as any); // includes 002_campaign_state
    const db = createDbFromPool(pool as any);

    await db.insertInto("users").values({ id: "u1", username: "ada", display_name: "Ada", password_hash: "x:y" }).execute();
    await db.insertInto("campaigns").values({ id: "c1", owner_id: "u1", world_name: "Terra", invite_code: "ff00aa11" }).execute();

    // Game 1 completes: fold legacy into the campaign and persist it (what game:action does on commit).
    const players = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }];
    let g1 = createGame({ gameId: "s1", seed: 42, players, campaign: initialCampaign("Terra") });
    const factions = ["khan_industries", "die_mechaniker", "saharan_republic"];
    const starts = ["alaska", "brazil", "western_australia"];
    const powers = ["territory_card_reinforcement", "defensive_stand", "unconnected_maneuver"]; // new (9): first-play power picks
    [...g1.setup!.chooserOrder].forEach((pid, i) => {
      g1 = applyAction(g1, { type: "setup.choose", playerId: pid, factionId: factions[i], territoryId: starts[i], powerId: powers[i] }); // new
    });
    const winner = g1.turnOrder[0];
    g1.players[winner].redStarTokens = 2;
    g1.players[winner].hand = ["42", "43", "44", "45"];
    g1 = applyAction(g1, { type: "start.buyRedStar", playerId: winner, cardIds: ["42", "43", "44", "45"] });
    for (const pid of g1.rewards!.order) {
      g1 = applyAction(g1, {
        type: "reward.choose", playerId: pid,
        reward: pid === winner ? { kind: "name_continent", continentId: "africa", name: "Zaharan" } : { kind: "pass" },
      });
    }
    const folded = applyGameToCampaign(initialCampaign("Terra"), g1);
    await db.updateTable("campaigns").set({ state: JSON.stringify(folded) }).where("id", "=", "c1").execute();

    // Next session stores the snapshot it was seeded from (what game:create does).
    const stored = (await db.selectFrom("campaigns").select("state").where("id", "=", "c1").executeTakeFirst())!.state!;
    await db.insertInto("game_sessions").values({ id: "s2", campaign_id: "c1", game_number: 2, seed: "77", campaign_state: stored }).execute();

    // Replay path (loadSession): parse the snapshot and seed the next game — signature-driven setup applies.
    const row = (await db.selectFrom("game_sessions").selectAll().where("id", "=", "s2").executeTakeFirst())!;
    const campaign = JSON.parse(row.campaign_state!) as CampaignState;
    const g2 = createGame({ gameId: "s2", seed: Number(row.seed), players, campaign });
    expect(g2.gameNumber).toBe(2);
    expect(g2.players[winner].missiles).toBe(1); // 1 signature -> 1 missile, no token
    expect(g2.players[winner].redStarTokens).toBe(0);
    expect(g2.continents["africa"]).toEqual({ name: "Zaharan", namedBy: winner });
  });

  it("stores host-supplied module content and records it in content_overrides (12)", async () => { // new: whole test
    const mem = newDb();
    const { Pool } = mem.adapters.createPg();
    const pool = new Pool();
    await runMigrations(pool as any);
    const db = createDbFromPool(pool as any);
    await db.insertInto("users").values({ id: "u1", username: "ada", display_name: "Ada", password_hash: "x:y" }).execute();
    await db.insertInto("campaigns").values({ id: "c1", owner_id: "u1", world_name: "Terra", invite_code: "ff00aa22" }).execute();

    // a campaign paused on Pack 2's comeback-power text
    const camp = initialCampaign("Terra");
    camp.unlockedModules = ["pack_2_comeback_mercenaries"];
    camp.contentRequired = [{ moduleId: "pack_2_comeback_mercenaries", items: ["powers"] }];
    await db.updateTable("campaigns").set({ state: JSON.stringify(camp) }).where("id", "=", "c1").execute();

    // what the /api/campaigns/:id/content route does: apply + persist + append the override row
    const stored = JSON.parse((await db.selectFrom("campaigns").select("state").where("id", "=", "c1").executeTakeFirst())!.state!) as CampaignState;
    const next = supplyModuleContent(stored, "pack_2_comeback_mercenaries", "powers", "Border Recruiters: ...");
    await db.updateTable("campaigns").set({ state: JSON.stringify(next) }).where("id", "=", "c1").execute();
    await db.insertInto("content_overrides").values({
      id: "ov1", campaign_id: "c1", author_id: "u1",
      path: "pack_2_comeback_mercenaries.powers", value: JSON.stringify("Border Recruiters: ..."),
      reason: "import wizard: module content_required",
    }).execute();

    const after = JSON.parse((await db.selectFrom("campaigns").select("state").where("id", "=", "c1").executeTakeFirst())!.state!) as CampaignState;
    expect(after.contentRequired).toEqual([]); // the pause is cleared
    expect(after.hostContent["pack_2_comeback_mercenaries.powers"]).toBe("Border Recruiters: ...");
    const rows = await db.selectFrom("content_overrides").selectAll().where("campaign_id", "=", "c1").execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("pack_2_comeback_mercenaries.powers");
  });

  it("prevents a campaign from having two active sessions", async () => {
    const mem = newDb();
    const { Pool } = mem.adapters.createPg();
    const pool = new Pool();
    await runMigrations(pool as any);
    const db = createDbFromPool(pool as any);

    await db.insertInto("users").values({ id: "u1", username: "ada", display_name: "Ada", password_hash: "x:y" }).execute();
    await db.insertInto("campaigns").values({ id: "c1", owner_id: "u1", world_name: "Terra", invite_code: "ff00aa33" }).execute();
    await db.insertInto("game_sessions").values({ id: "s1", campaign_id: "c1", game_number: 1, seed: "42" }).execute();

    await expect(
      db.insertInto("game_sessions").values({ id: "s2", campaign_id: "c1", game_number: 2, seed: "43" }).execute()
    ).rejects.toThrow();

    await db.updateTable("game_sessions").set({ status: "completed" }).where("id", "=", "s1").execute();
    await db.insertInto("game_sessions").values({ id: "s2", campaign_id: "c1", game_number: 2, seed: "43" }).execute();
    const active = await db.selectFrom("game_sessions").selectAll()
      .where("campaign_id", "=", "c1").where("status", "=", "active").execute();
    expect(active.map((s) => s.id)).toEqual(["s2"]);
  });
});
