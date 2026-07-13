import { describe, expect, it } from "vitest";
import { initialCampaign } from "@risk/rules";
import { SessionActionQueue, legacyDone, prepareSessionState } from "./session.ts";

const readyPlayers = [
  { userId: "u1", name: "Ada" },
  { userId: "u2", name: "Lin" },
  { userId: "u3", name: "Rex" },
];

describe("session helpers", () => {
  it("preflights engine creation before a session is persisted", () => {
    const campaign = initialCampaign("Terra");
    campaign.unlockedModules = ["pack_1_advanced_draft_biohazards"];
    campaign.contentRequired = [{ moduleId: "pack_1_advanced_draft_biohazards", items: ["draft"] }];

    expect(() => prepareSessionState({
      sessionId: "s1",
      campaignId: "c1",
      seed: 7,
      campaign,
      readyPlayers,
    })).toThrow(/advanced setup draft/);
  });

  it("treats a won game as unresolved until rewards are committed", () => {
    const prepared = prepareSessionState({
      sessionId: "s1",
      campaignId: "c1",
      seed: 7,
      campaign: initialCampaign("Terra"),
      readyPlayers,
    });
    const won = structuredClone(prepared.state);
    won.winner = "u1";
    won.rewards = { order: ["u1"], nextIdx: 0, committed: false };

    expect(legacyDone(prepared.state)).toBe(false);
    expect(legacyDone(won)).toBe(false);
    won.rewards!.committed = true;
    expect(legacyDone(won)).toBe(true);
    won.worldCompletion = { namingPlayerId: "u1" };
    expect(legacyDone(won)).toBe(false);
    won.worldCompletion.name = "Aeternum";
    expect(legacyDone(won)).toBe(true);
    won.contentRequired = [{ moduleId: "pack_3_homelands_missions", items: ["missions"] }];
    expect(legacyDone(won)).toBe(false);
    won.contentRequired = [];
    expect(legacyDone(won)).toBe(true);
  });

  it("serializes authoritative actions within one session", async () => {
    const queue = new SessionActionQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.run("s1", async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    const second = queue.run("s1", async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });
});
