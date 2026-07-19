// @vitest-environment jsdom
// new (1-web-b): two clients against one authoritative session (real engine + the real
// per-viewer filter) play through to game_over with consistent, hidden-state-correct views.
import "../test-shims.ts";
import { describe, it, expect, afterEach } from "vitest";
import { render, within, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import {
  createGame, applyAction, waitingOn, isLegalStart, neighborsOf, filterStateFor,
  type GameState, type Action,
} from "@risk/rules";
import { contentPack } from "@risk/content";
import { manifest } from "@risk/map";
import NetworkedGame, { type GameSocket } from "./NetworkedGame.tsx";

afterEach(cleanup);

type Handler = (...args: any[]) => void;

class FakeGameSocket implements GameSocket {
  handlers = new Map<string, Handler>();
  emitted: { event: string; payload: any }[] = [];
  constructor(private session: FakeSession, private viewerId: string, private contentHost = false) {}
  on(event: string, h: Handler) { this.handlers.set(event, h); }
  off(event: string) { this.handlers.delete(event); }
  pushState(sessionId: string, state: unknown, rewind?: unknown) { this.handlers.get("game:state")?.({ sessionId, state, rewind }); }
  emit(event: string, payload: any, ack?: (res: any) => void) {
    this.emitted.push({ event, payload });
    if (event === "game:join") {
      ack?.({ ok: true, state: filterStateFor(this.session.state, this.viewerId), seated: true, contentHost: this.contentHost });
    }
    if (event === "game:action") {
      const a = payload.action as Action;
      if (a.playerId !== this.viewerId) return ack?.({ error: "cannot act for another player" }); // server guard
      try {
        this.session.state = applyAction(this.session.state, a);
        this.session.broadcast();
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ error: (e as Error).message });
      }
    }
    if (event === "game:rewind") ack?.({ ok: true });
    return true;
  }
}

/** Authoritative in-test session: real engine state, real filter, per-viewer sockets. */
class FakeSession {
  state: GameState;
  sockets = new Map<string, FakeGameSocket>();
  hiddenViolations = 0;
  sawHiddenHand = false;
  constructor(seed: number, players: { id: string; name: string }[]) {
    this.state = createGame({ gameId: "net-1", seed, players });
  }
  connect(viewerId: string, contentHost = false): FakeGameSocket {
    const s = new FakeGameSocket(this, viewerId, contentHost);
    this.sockets.set(viewerId, s);
    return s;
  }
  broadcast() {
    for (const [viewer, sock] of this.sockets) {
      const f = filterStateFor(this.state, viewer);
      for (const p of Object.values(f.players)) {
        if (p.id === viewer) continue;
        if (p.hand.length > 0 || p.scarHand.length > 0) this.hiddenViolations++; // leak!
        if (((p as any).handCount ?? 0) > 0) this.sawHiddenHand = true; // the check was meaningful
      }
      sock.pushState(this.state.gameId, f);
    }
  }
}

/** Compact greedy bot (simulator policy) over the authoritative state. */
function pickAction(s: GameState): Action | null {
  const pid = waitingOn(s);
  if (!pid) return null;
  const p = s.players[pid];
  if (s.comebackChoice) return { type: "comeback.choose", playerId: pid, optionId: s.comebackChoice.options[0].id };
  if (s.phase === "setup") {
    const faction = contentPack.factions.find((f) => !Object.values(s.players).some((x) => x.factionId === f.id))!;
    const start = manifest.territories.find((t) => isLegalStart(s, t.id, true, faction.id))!;
    return { type: "setup.choose", playerId: pid, factionId: faction.id, territoryId: start.id, powerId: s.factionPowers[faction.id] ? undefined : faction.startingPowers[0] };
  }
  if (s.phase === "game_over") {
    if (!s.rewards || s.rewards.committed) return null;
    if (s.rewards.order[0] === pid) {
      const unnamed = manifest.continents.find((c) => !s.continents[c.id]?.name)!;
      return { type: "reward.choose", playerId: pid, reward: { kind: "name_continent", continentId: unnamed.id, name: `${p.name}'s land` } };
    }
    return { type: "reward.choose", playerId: pid, reward: { kind: "pass" } };
  }
  const c = s.combat;
  if (c) {
    if (c.awaitingMoveIn) return { type: "attack.moveIn", playerId: c.attacker, count: c.awaitingMoveIn.max };
    if (c.natural && c.window) return { type: "combat.pass", playerId: pid };
    if (c.attackerDice === undefined) return { type: "attack.chooseAttackers", playerId: pid, count: Math.min(3, s.territories[c.from].troops - 1) };
    if (c.defenderDice === undefined) return { type: "attack.defenderDice", playerId: pid, count: Math.min(2, s.territories[c.to].troops) };
  }
  const owned = () => Object.entries(s.territories).filter(([, t]) => t.controller === pid);
  switch (s.phase) {
    case "start_turn":
      if (p.hand.length >= 4) return { type: "start.buyRedStar", playerId: pid, cardIds: p.hand.slice(0, 4) };
      return { type: "start.done", playerId: pid };
    case "join_or_recruit": {
      if (owned().length === 0) {
        const start = manifest.territories.find((t) => isLegalStart(s, t.id, false, p.factionId, pid));
        return start ? { type: "join.enter", playerId: pid, territoryId: start.id } : null;
      }
      if (s.recruit && s.recruit.remaining > 0) {
        const mine = owned();
        const nextToHq = mine.find(([tid]) => neighborsOf(s, tid).some((n) => {
          const x = s.territories[n];
          return x.hqFaction && x.controller && x.controller !== pid;
        }));
        const frontier = mine.find(([tid]) => neighborsOf(s, tid).some((n) => s.territories[n].controller && s.territories[n].controller !== pid));
        return { type: "recruit.place", playerId: pid, territoryId: (nextToHq ?? frontier ?? mine[0])[0], count: s.recruit.remaining };
      }
      return { type: "recruit.done", playerId: pid };
    }
    case "expand_attack": {
      // rank attacks HQ-first (board Red Stars -> convergence), then biggest margin
      const cands: { from: string; to: string; hq: boolean; margin: number }[] = [];
      for (const [tid, t] of owned()) {
        if (t.troops < 3) continue;
        for (const n of neighborsOf(s, tid)) {
          const nt = s.territories[n];
          if (nt.controller && nt.controller !== pid && nt.troops <= t.troops - 2 && !s.blockedAttackTargets.includes(n)) {
            cands.push({ from: tid, to: n, hq: !!nt.hqFaction, margin: t.troops - nt.troops });
          }
        }
      }
      cands.sort((x, y) => Number(y.hq) - Number(x.hq) || y.margin - x.margin);
      if (cands[0]) return { type: "attack.declare", playerId: pid, from: cands[0].from, to: cands[0].to };
      // no attack -> grow toward enemies through empty, unmarked territories
      const expandable = owned()
        .filter(([tid, t]) => t.troops >= 4 && neighborsOf(s, tid).some((n) => {
          const nt = s.territories[n];
          return !nt.controller && nt.troops === 0 && !nt.city && nt.scars.length === 0;
        }))
        .sort((x, y) => y[1].troops - x[1].troops)[0];
      if (expandable) {
        const [tid, t] = expandable;
        const to = neighborsOf(s, tid).find((n) => {
          const nt = s.territories[n];
          return !nt.controller && nt.troops === 0 && !nt.city && nt.scars.length === 0;
        })!;
        return { type: "attack.expand", playerId: pid, from: tid, to, troops: Math.floor(t.troops / 2) };
      }
      return { type: "phase.endAttacks", playerId: pid };
    }
    case "maneuver":
      return { type: "phase.endManeuver", playerId: pid };
    case "end_turn": {
      if (!p.conqueredEnemyThisTurn) return { type: "end.turn", playerId: pid };
      const slot = s.sideboard.slots.findIndex((id) => {
        const cd = id && contentPack.cards.territoryCards.find((x) => x.id === id);
        return cd && s.territories[cd.territoryId].controller === pid;
      });
      if (slot >= 0) return { type: "end.draw", playerId: pid, choice: { slot } };
      if (s.sideboard.coinPile.length > 0) return { type: "end.draw", playerId: pid, choice: { coin: true } };
      return { type: "end.turn", playerId: pid };
    }
    default:
      return null;
  }
}

describe("networked game (1-web-b)", () => {
  it("rejoins and refreshes authoritative state after a socket reconnect", () => {
    const session = new FakeSession(93, [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }]);
    const socket = session.connect("u1");
    render(<NetworkedGame socket={socket} sessionId="net-1" viewerId="u1" onExit={() => {}} />);
    expect(socket.emitted.filter((entry) => entry.event === "game:join")).toHaveLength(1);
    act(() => socket.handlers.get("disconnect")?.());
    act(() => socket.handlers.get("connect")?.());
    expect(socket.emitted.filter((entry) => entry.event === "game:join")).toHaveLength(2);
  });

  it("clears campaign-local setup choices when the session changes", () => {
    const players = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }];
    const session = new FakeSession(94, players);
    const chooser = waitingOn(session.state)!;
    const socket = session.connect(chooser);
    const view = render(<NetworkedGame socket={socket} sessionId="net-1" viewerId={chooser} onExit={() => {}} />);
    const faction = contentPack.factions[0];

    fireEvent.click(within(view.container).getByText(faction.name));
    expect(view.container.querySelector(".physical-faction-card-wrap.is-selected")).toBeTruthy();

    view.rerender(<NetworkedGame socket={socket} sessionId="net-2" viewerId={chooser} onExit={() => {}} />);
    expect(view.container.querySelector(".physical-faction-card-wrap.is-selected")).toBeNull();
    expect(socket.emitted).toContainEqual({ event: "game:leave", payload: { sessionId: "net-1" } });
    expect(socket.emitted).toContainEqual({ event: "game:join", payload: { sessionId: "net-2" } });
  });

  it("lets only the connected campaign host satisfy an in-game sealed-content pause", async () => {
    const players = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }];
    const session = new FakeSession(95, players);
    session.state.unlockedModules.push("pack_2_comeback_mercenaries");
    session.state.contentRequired = [{ moduleId: "pack_2_comeback_mercenaries", items: ["powers"] }];
    const hostSocket = session.connect("u1", true);
    const view = render(<NetworkedGame socket={hostSocket} sessionId="net-1" viewerId="u1" onExit={() => {}} />);

    const field = await within(view.container).findByLabelText("Sealed content: pack_2_comeback_mercenaries.powers");
    fireEvent.change(field, { target: { value: "Host-entered comeback powers" } });
    fireEvent.click(within(view.container).getByRole("button", { name: "SAVE & RESUME" }));
    await waitFor(() => expect(session.state.contentRequired).toEqual([]));
    expect(session.state.hostContent["pack_2_comeback_mercenaries.powers"]).toBe("Host-entered comeback powers");
  });

  it("lets the network host capture a Private Mission while keeping the pool text filtered", async () => {
    const players = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }];
    const session = new FakeSession(951, players);
    while (session.state.phase === "setup") session.state = applyAction(session.state, pickAction(session.state)!);
    session.state.unlockedModules.push("pack_4_lead_faction_private_missions");
    session.state.legacyCards.privateMissionPool = [{
      id: "pack4:private:silent-coup",
      sourceModuleId: "pack_4_lead_faction_private_missions",
      title: "Silent Coup",
      text: "Secret physical condition",
    }];
    const hostSocket = session.connect("u1", true);
    const view = render(<NetworkedGame socket={hostSocket} sessionId="net-1" viewerId="u1" onExit={() => {}} />);

    const button = await within(view.container).findByRole("button", { name: "HOST: PRIVATE MISSIONS" });
    expect(within(view.container).queryByText("Secret physical condition")).toBeNull();
    fireEvent.click(button);
    const modal = within(view.container).getByRole("dialog", { name: "Private missions" });
    fireEvent.change(within(modal).getByLabelText("Private Mission title"), { target: { value: "Silent Coup" } });
    fireEvent.click(within(modal).getByRole("button", { name: "CAPTURE MISSION" }));

    await waitFor(() => expect(Object.keys(session.state.capturedPrivateMissions)).toHaveLength(1));
    expect(session.state.legacyCards.privateMissionPool).toEqual([]);
  });

  it("ignores stale room updates and leaves its session on unmount", () => {
    const players = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }];
    const session = new FakeSession(96, players);
    const socket = session.connect("u1");
    const view = render(<NetworkedGame socket={socket} sessionId="net-1" viewerId="u1" onExit={() => {}} />);

    const stale = createGame({ gameId: "other", seed: 2, players: [
      { id: "u1", name: "Wrong board" }, { id: "u2", name: "Other" }, { id: "u3", name: "Third" },
    ] });
    act(() => socket.pushState("other", filterStateFor(stale, "u1")));
    expect(within(view.container).queryByText("Wrong board")).toBeNull();

    act(() => socket.pushState("net-1", filterStateFor(session.state, "u1"), {
      canReset: true, canBack: true, reason: "safe checkpoint",
    }));
    fireEvent.click(within(view.container).getByRole("button", { name: "RESET PHASE" }));
    fireEvent.click(within(view.container).getByRole("button", { name: "← BACK A PHASE" }));
    expect(socket.emitted).toContainEqual({ event: "game:rewind", payload: { sessionId: "net-1", mode: "reset" } });
    expect(socket.emitted).toContainEqual({ event: "game:rewind", payload: { sessionId: "net-1", mode: "back" } });

    view.unmount();
    expect(socket.emitted).toContainEqual({ event: "game:leave", payload: { sessionId: "net-1" } });
  });

  it("two clients play one session to game_over with consistent, hidden-state-correct views", async () => {
    const players = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }];
    const session = new FakeSession(97, players);
    const sockA = session.connect("u1");
    const sockB = session.connect("u2");
    const sockC = session.connect("u3"); // headless third seat

    const a = render(<NetworkedGame socket={sockA} sessionId="net-1" viewerId="u1" onExit={() => {}} />);
    const b = render(<NetworkedGame socket={sockB} sessionId="net-1" viewerId="u2" onExit={() => {}} />);
    expect(a.container.querySelector("#risk-board-modern")).toBeTruthy();
    expect(b.container.querySelector("#risk-board-modern")).toBeTruthy();

    // --- UI-driven action: the first chooser (u1 or u2) picks faction+power+territory by clicking ---
    let chooser = waitingOn(session.state)!;
    if (chooser === "u3") { // headless seat picks via the bot first
      const act0 = pickAction(session.state)!;
      await act(async () => { sockC.emit("game:action", { sessionId: "net-1", action: act0 }, () => {}); });
      chooser = waitingOn(session.state)!;
    }
    const ui = chooser === "u1" ? a : b;
    const faction = contentPack.factions.find((f) => !Object.values(session.state.players).some((x) => x.factionId === f.id))!;
    const power = contentPack.powers.find((x) => x.id === faction.startingPowers[0])!;
    const tid = manifest.territories.find((t) => isLegalStart(session.state, t.id, true, faction.id))!.id;
    fireEvent.click(within(ui.container).getByText(faction.name));
    fireEvent.click(await within(ui.container).findByText(power.name));
    fireEvent.click(ui.container.querySelector(`#${tid}`)!);
    expect(session.state.players[chooser].factionId).toBe(faction.id); // the click flow reached the server
    // both clients saw the update
    await waitFor(() => expect(a.container.querySelectorAll("path.territory-border")).toHaveLength(42));

    // --- acting for another player is rejected by the server guard ---
    let rejected: string | null = null;
    sockB.emit("game:action", { sessionId: "net-1", action: { type: "start.done", playerId: "u1" } }, (res: any) => { rejected = res?.error ?? null; });
    expect(rejected).toMatch(/another player/);

    // --- drive the whole game through the per-viewer sockets ---
    // The UIs unmount for the long drive (the Ledger renders the full log each action, which is
    // quadratic across thousands of steps); every payload is still filtered + leak-checked in
    // broadcast(), and fresh clients re-join below to render the terminal state.
    a.unmount();
    b.unmount();
    let steps = 0;
    let stuck = 0;
    while (steps++ < 6000) {
      const s = session.state;
      if (s.phase === "game_over" && (!s.rewards || s.rewards.committed)) break;
      const next = pickAction(s);
      if (!next) break;
      let err: string | null = null;
      session.sockets.get(next.playerId)!.emit("game:action", { sessionId: "net-1", action: next }, (r: any) => { err = r?.error ?? null; });
      if (err) { if (++stuck > 20) throw new Error(`bot stuck on ${next.type}: ${err}`); }
      else stuck = 0;
    }

    expect(session.state.winner).toBeTruthy();
    expect(session.state.rewards?.committed).toBe(true);
    // no hidden-information leak in any payload across the whole game, and the check saw real hidden hands
    expect(session.hiddenViolations).toBe(0);
    expect(session.sawHiddenHand).toBe(true);

    // fresh clients join the finished session (game:join path) and render the same terminal result
    const winnerName = session.state.players[session.state.winner!].name;
    const a2 = render(<NetworkedGame socket={session.connect("u1")} sessionId="net-1" viewerId="u1" onExit={() => {}} />);
    const b2 = render(<NetworkedGame socket={session.connect("u2")} sessionId="net-1" viewerId="u2" onExit={() => {}} />);
    await waitFor(() => {
      expect(within(a2.container).getByText("GAME OVER")).toBeTruthy();
      expect(within(b2.container).getByText("GAME OVER")).toBeTruthy();
    });
    expect(within(a2.container).getAllByText(winnerName, { exact: false }).length).toBeGreaterThan(0);
    expect(within(b2.container).getAllByText(winnerName, { exact: false }).length).toBeGreaterThan(0);
  }, 60000);
});
