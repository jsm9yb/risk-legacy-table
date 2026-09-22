import { describe, expect, it } from "vitest";
import { atExpandAttack } from "../test-fixtures.ts";
import { historyRenderState, openingOrder, permanentHistoryFrames, PublicBoardHistory, publicBoardSnapshot } from "./PublicBoardHistory.ts";

const memoryStore = () => {
  const values = new Map<string, string>();
  return {values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value);} };
};

describe("public board history", () => {
  it("persists real public armies across reload without private hands, log fields or RNG", () => {
    const previous = structuredClone(atExpandAttack(921).gs);
    const playerId = previous.turnOrder[0];
    previous.players[playerId].hand = ["SECRET-HAND"];
    previous.hostContent = {text: "SEALED-PRIVATE-TEXT"};
    previous.territories.alaska.troops = 8;
    previous.territories.kamchatka.troops = 0;
    const next = structuredClone(previous);
    next.territories.alaska.troops = 5;
    next.territories.kamchatka.troops = 3;
    next.territories.kamchatka.controller = playerId;
    next.log.push({seq: ++next.eventSeq, type: "TerritoryConquered", playerId, data: {territory: "kamchatka", from: "alaska", moved: 3, defender: previous.turnOrder[1], hqCaptured: null}});
    const storage = memoryStore();
    const history = new PublicBoardHistory(previous.gameId, storage);
    history.capture(previous, next);
    previous.territories.alaska.troops = 999;
    const restored = new PublicBoardHistory(next.gameId, storage).list(next);
    expect(restored).toHaveLength(1);
    expect(restored[0].before.territories.alaska.troops).toBe(8);
    expect(restored[0].after.territories.alaska.troops).toBe(5);
    expect(restored[0].commands).toContainEqual({type: "army.move", from: "alaska", to: "kamchatka", count: 3, tone: "conquest"});
    const serialized = [...storage.values.values()].join("");
    expect(serialized).not.toMatch(/SECRET-HAND|SEALED-PRIVATE-TEXT|rngState|"seed"|"hand"|"log"/);
    const displayed = historyRenderState(next, restored[0].before);
    expect(displayed.players[playerId].hand).toEqual([]);
    expect(displayed.log).toEqual([]);
    expect(next.territories.alaska.troops).toBe(5);
  });

  it("reconstructs permanent changes without inventing historical army positions", () => {
    const state = structuredClone(atExpandAttack(922).gs);
    state.territories.alaska.troops = 17;
    state.territories.alaska.city = {type: "major", population: 2, name: "Northgate"};
    state.log.push({seq: ++state.eventSeq, type: "MajorCityFounded", data: {territory: "alaska", name: "Northgate"}});
    const frames = permanentHistoryFrames(state);
    expect(frames.at(-1)?.before.territories.alaska.city).toBeUndefined();
    expect(frames.at(-1)?.after.territories.alaska.city?.name).toBe("Northgate");
    expect(frames.at(-1)?.provenance).toBe("permanent");
    expect(frames.at(-1)?.before.territories.alaska.troops).toBe(17);
    expect(frames.at(-1)?.after.territories.alaska.troops).toBe(17);
    expect(frames.at(-1)?.detail).toContain("positions are current");
  });

  it("drops future snapshots on rewind and tolerates unavailable storage", () => {
    const previous = atExpandAttack(923).gs;
    const next = structuredClone(previous);
    next.log.push({seq: ++next.eventSeq, type: "BoardSigned", playerId: previous.turnOrder[0], data: {signatures: 1}});
    const history = new PublicBoardHistory(previous.gameId, {getItem: () => {throw new Error("disabled");}, setItem: () => {throw new Error("full");}});
    history.capture(previous, next);
    expect(history.list(next).some(f => f.provenance === "captured")).toBe(true);
    history.capture(next, previous);
    expect(history.list(previous).some(f => f.provenance === "captured")).toBe(false);
  });

  it("uses the recorded setup roll rather than producing random replay dice", () => {
    const state = atExpandAttack(924).gs;
    state.setup = {stage: "order_reveal", nextIdx: 0, rolls: {u1: 6, u2: 2}, chooserOrder: ["u1", "u2"]};
    expect(openingOrder(state)[0].commands).toMatchObject([{type: "setup.order", order: ["u1", "u2"], rolls: [{playerId: "u1", value: 6}, {playerId: "u2", value: 2}]}]);
    expect(publicBoardSnapshot(state)).not.toHaveProperty("rngState");
  });
});

it("uses the recorded major city before a World Capital and never invents an empty prior territory", () => {
  const previous = structuredClone(atExpandAttack(926).gs);
  previous.territories.alaska.city = {type: "major", population: 2, name: "Old Capital"};
  const next = structuredClone(previous);
  next.territories.alaska.city = {type: "world_capital", population: 5, name: "New Capital"};
  next.log.push({seq: ++next.eventSeq, type: "WorldCapitalFounded", data: {territory: "alaska", name: "New Capital"}});
  const history = new PublicBoardHistory(next.gameId);
  history.capture(previous, next);
  const frames = permanentHistoryFrames(next, history.list(next));
  expect(frames.at(-1)?.before.territories.alaska.city).toMatchObject({type: "major", name: "Old Capital"});
  expect(frames.at(-1)?.after.territories.alaska.city).toMatchObject({type: "world_capital", name: "New Capital"});
  expect(permanentHistoryFrames(next)).toEqual([]);
  // Even an earlier founding event cannot justify erasing a replacement capital.
  next.log.splice(next.log.length - 1, 0, {seq: next.eventSeq - 1, type: "MajorCityFounded", data: {territory: "alaska", name: "Old Capital"}});
  expect(permanentHistoryFrames(next)).toEqual([]);
});

it("combines captured fortification, island, packet, ruins and naming changes while keeping current armies", () => {
  let state = structuredClone(atExpandAttack(927).gs);
  state.territories.alaska.city = {type: "major", population: 2, name: "Northgate"};
  state.territories.alaska.fortification = {max: 10, remaining: 3};
  const originalName = state.worldName;
  const originalModules = [...state.unlockedModules];
  const history = new PublicBoardHistory(state.gameId);
  const change = (type: "CityFortified" | "AlienIslandPlaced" | "ModuleRevealed" | "AlienRuinsPlaced" | "WorldNamed", data: Record<string, unknown>, mutate: (next: typeof state) => void) => {
    const next = structuredClone(state);
    mutate(next);
    next.log.push({seq: ++next.eventSeq, type, data});
    history.capture(state, next);
    state = next;
  };
  change("CityFortified", {territory: "alaska", durability: 10}, next => {next.territories.alaska.fortification = {max: 10, remaining: 10};});
  change("AlienIslandPlaced", {territory: "alien_island", name: "Arrival", connections: ["indonesia", "eastern_australia"]}, next => {
    next.alienIsland = {territoryId: "alien_island", name: "Arrival", connections: ["indonesia", "eastern_australia"]};
    next.territories.alien_island = {troops: 4, scars: [], controller: next.turnOrder[0]};
  });
  change("ModuleRevealed", {moduleId: "pack_4"}, next => {next.unlockedModules.push("pack_4");});
  change("AlienRuinsPlaced", {territory: "alberta"}, next => {next.territories.alberta.ruin = true;});
  change("WorldNamed", {name: "The New World"}, next => {next.worldName = "The New World";});
  state.territories.alaska.troops = 71;
  const frames = permanentHistoryFrames(state, history.list(state));
  const before = frames[0].before, after = frames.at(-1)!.after;
  expect(before.territories.alaska.fortification?.remaining).toBe(3);
  expect(after.territories.alaska.fortification?.remaining).toBe(10);
  expect(before.alienIsland).toBeUndefined();
  expect(before.territories.alien_island).toBeUndefined();
  expect(after.alienIsland?.name).toBe("Arrival");
  expect(before.unlockedModules).toEqual(originalModules);
  expect(after.unlockedModules).toContain("pack_4");
  expect(before.territories.alberta.ruin).toBeUndefined();
  expect(after.territories.alberta.ruin).toBe(true);
  expect(before.worldName).toBe(originalName);
  expect(after.worldName).toBe("The New World");
  expect(before.territories.alaska.troops).toBe(71);
  expect(after.territories.alaska.troops).toBe(71);
});
