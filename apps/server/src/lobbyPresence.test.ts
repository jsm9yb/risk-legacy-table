import { describe, expect, it } from "vitest";
import { LobbyPresence } from "./lobbyPresence.ts";

describe("lobby presence", () => {
  it("keeps a player present when another tab leaves or disconnects", () => {
    const presence = new LobbyPresence();
    presence.join("world", "player", "tab1");
    presence.join("world", "player", "tab2");
    expect(presence.leave("world", "player", "tab1")).toBe(false);
    expect(presence.leave("world", "player", "tab1")).toBe(false);
    expect(presence.leave("world", "player", "tab2")).toBe(true);
  });

  it("does not disconnect a different campaign or user", () => {
    const presence = new LobbyPresence();
    presence.join("world1", "player", "tab1");
    presence.join("world2", "player", "tab2");
    expect(presence.leave("world2", "player", "tab1")).toBe(false);
    expect(presence.leave("world1", "other", "tab1")).toBe(false);
    expect(presence.leave("world1", "player", "tab1")).toBe(true);
    expect(presence.leave("world2", "player", "tab2")).toBe(true);
  });
});
