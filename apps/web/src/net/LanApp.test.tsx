// @vitest-environment jsdom
// new (1-web-a): component tests for the LAN flow — register, create campaign, lobby, ready, launch.
import "../test-shims.ts";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

// ---- fake Socket.IO client ----
type Handler = (...args: any[]) => void;
const fakeSocket = {
  handlers: new Map<string, Handler>(),
  emitted: [] as { event: string; payload: any }[],
  on(event: string, h: Handler) { this.handlers.set(event, h); return this; },
  off(event: string) { this.handlers.delete(event); },
  emit(event: string, payload: any, ack?: (res: any) => void) {
    this.emitted.push({ event, payload });
    if (event === "lobby:join") ack?.({ ok: true, members: [
      { userId: "u1", name: "Ada", role: "host", ready: false, connected: true, seat: null },
      { userId: "u2", name: "Lin", role: "player", ready: true, connected: true, seat: 2 },
      { userId: "u3", name: "Rex", role: "player", ready: true, connected: true, seat: 3 },
    ] });
    if (event === "lobby:seat") {
      this.handlers.get("lobby:state")?.([
        { userId: "u1", name: "Ada", role: "host", ready: false, connected: true, seat: payload.seat },
        { userId: "u2", name: "Lin", role: "player", ready: true, connected: true, seat: 2 },
        { userId: "u3", name: "Rex", role: "player", ready: true, connected: true, seat: 3 },
      ]);
      ack?.({ ok: true });
    }
    if (event === "lobby:ready") this.handlers.get("lobby:state")?.([
      { userId: "u1", name: "Ada", role: "host", ready: !!payload.ready, connected: true, seat: 1 },
      { userId: "u2", name: "Lin", role: "player", ready: true, connected: true, seat: 2 },
      { userId: "u3", name: "Rex", role: "player", ready: true, connected: true, seat: 3 },
    ]);
    if (event === "game:create") ack?.({ ok: true, sessionId: "sess-42" });
    if (event === "game:join") { // new (1-web-b): serve a real filtered engine state
      const state = createGame({ gameId: "sess-42", seed: 7, players: [
        { id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" },
      ] });
      ack?.({ ok: true, state: filterStateFor(state, "u1"), seated: true });
    }
  },
  disconnect() {},
};
vi.mock("socket.io-client", () => ({ io: () => fakeSocket }));

import LanApp from "./LanApp.tsx";
import { createGame, filterStateFor } from "@risk/rules"; // new (1-web-b)

const jsonRes = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, statusText: "", json: () => Promise.resolve(body) } as Response);

let pendingContent: { moduleId: string; items: string[] }[] = []; // new (12): served by /state, cleared by /content
let suppliedBodies: any[] = []; // new (12)
let activeCampaign = false;

beforeEach(() => {
  fakeSocket.handlers.clear();
  fakeSocket.emitted = [];
  pendingContent = [];
  suppliedBodies = [];
  activeCampaign = false;
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    if (path === "/api/register" || path === "/api/login") {
      return jsonRes({ token: "tok", user: { id: "u1", username: "ada", displayName: "Ada" } });
    }
    if (path === "/api/campaigns" && init?.method === "POST") {
      return jsonRes({ id: "c1", worldName: "Terra", inviteCode: "ff00aa11" });
    }
    if (path === "/api/campaigns") {
      return jsonRes([{
        id: "c1",
        worldName: "Terra",
        gameNumber: activeCampaign ? 1 : 0,
        role: "host",
        inviteCode: "ff00aa11",
        activeSessionId: activeCampaign ? "sess-active" : undefined,
        hasActiveGame: activeCampaign,
        preparationStatus: "complete",
      }]);
    }
    if (path === "/api/campaigns/join") return jsonRes({ id: "c2", worldName: "Elsewhere" });
    if (path === "/api/campaigns/c1/state") { // new (12)
      return jsonRes({ worldName: "Terra", gameNumber: 0, unlockedModules: [], contentRequired: pendingContent });
    }
    if (path === "/api/campaigns/c1/content") { // new (12)
      suppliedBodies.push(JSON.parse(String(init?.body)));
      pendingContent = [];
      return jsonRes({ ok: true, contentRequired: [] });
    }
    return jsonRes({ error: "unknown route" }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function signIn() {
  render(<LanApp onExit={() => {}} />);
  fireEvent.change(screen.getByTestId("username"), { target: { value: "ada" } });
  fireEvent.change(screen.getByTestId("password"), { target: { value: "pw" } });
  fireEvent.click(screen.getByText("REGISTER"));
  await waitFor(() => expect(screen.getByText("YOUR CAMPAIGNS")).toBeTruthy());
}

describe("LAN flow (1-web-a)", () => {
  it("registers, lists campaigns with the host invite code", async () => {
    await signIn();
    expect(screen.getByText("Terra")).toBeTruthy();
    expect(screen.getByText("ff00aa11")).toBeTruthy();
  });

  it("shows a login error from the server", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonRes({ error: "invalid credentials" }, 401)));
    render(<LanApp onExit={() => {}} />);
    fireEvent.click(screen.getByText("LOG IN"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("invalid credentials"));
  });

  it("opens a lobby, toggles ready, and the host launches game:create", async () => {
    await signIn();
    fireEvent.click(screen.getByText("OPEN LOBBY"));
    await waitFor(() => expect(screen.getByText(/LOBBY — Terra/)).toBeTruthy());
    expect(screen.getAllByText("Lin").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "CHOOSE A SEAT" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "SEAT 1 available" }));
    expect(fakeSocket.emitted).toContainEqual({ event: "lobby:seat", payload: { campaignId: "c1", seat: 1 } });
    // ready toggle emits and the lobby:state broadcast updates the view
    fireEvent.click(screen.getByRole("button", { name: "READY" }));
    expect(fakeSocket.emitted.some((e) => e.event === "lobby:ready" && e.payload.ready === true)).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "UNREADY" })).toBeTruthy());
    // host launch -> the networked game screen mounts on the created session (1-web-b)
    fireEvent.click(screen.getByText(/LAUNCH GAME/));
    expect(fakeSocket.emitted.some((e) => e.event === "game:create" && e.payload.campaignId === "c1")).toBe(true);
    expect(fakeSocket.emitted.some((e) => e.event === "game:join" && e.payload.sessionId === "sess-42")).toBe(true);
    await waitFor(() => expect(document.getElementById("risk-board-modern")).toBeTruthy());
  });

  it("does not count disconnected ready players and emits lobby:leave when backing out", async () => {
    await signIn();
    fireEvent.click(screen.getByText("OPEN LOBBY"));
    await waitFor(() => expect(screen.getByText(/LOBBY .* Terra/)).toBeTruthy());
    fakeSocket.handlers.get("lobby:state")?.([
      { userId: "u1", name: "Ada", role: "host", ready: true, connected: true, seat: 1 },
      { userId: "u2", name: "Lin", role: "player", ready: true, connected: true, seat: 2 },
      { userId: "u3", name: "Rex", role: "player", ready: true, connected: false, seat: 3 },
    ]);

    const launch = screen.getByRole("button", { name: "LAUNCH GAME (2 ready)" }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /campaigns/i }));
    expect(fakeSocket.emitted).toContainEqual({ event: "lobby:leave", payload: { campaignId: "c1" } });
  });

  it("resumes an active campaign session from the campaign list without launching a new game", async () => {
    activeCampaign = true;
    await signIn();
    expect(screen.getByText("active game")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "RESUME GAME" }));

    expect(fakeSocket.emitted.some((e) => e.event === "game:create")).toBe(false);
    expect(fakeSocket.emitted.some((e) => e.event === "game:join" && e.payload.sessionId === "sess-active")).toBe(true);
    await waitFor(() => expect(document.getElementById("risk-board-modern")).toBeTruthy());
  });

  it("import wizard (12): a paused content_required unlock prompts the host, accepts text, and clears", async () => {
    pendingContent = [{ moduleId: "pack_2_comeback_mercenaries", items: ["powers"] }];
    await signIn();
    fireEvent.click(screen.getByText("OPEN LOBBY"));
    await waitFor(() => expect(screen.getByText("SEALED CONTENT REQUIRED")).toBeTruthy());
    fireEvent.change(screen.getByTestId("content-pack_2_comeback_mercenaries.powers"), {
      target: { value: "Border Recruiters: at the start of your turn..." },
    });
    fireEvent.click(screen.getByText("SUPPLY POWERS"));
    await waitFor(() => expect(suppliedBodies).toHaveLength(1));
    expect(suppliedBodies[0]).toEqual({
      moduleId: "pack_2_comeback_mercenaries", item: "powers",
      content: "Border Recruiters: at the start of your turn...",
    });
    await waitFor(() => expect(screen.queryByText("SEALED CONTENT REQUIRED")).toBeNull()); // pause cleared
  });
});
