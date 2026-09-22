// @vitest-environment jsdom
import "../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { contentPack } from "@risk/content";
import { territoryById } from "@risk/map";
import { applyAction, createGame, initialCampaign, isLegalStart, resourceCardDefinition, waitingOn, type Action, type GameState } from "@risk/rules";
import GameScreen from "./GameScreen.tsx";
import { atExpandAttack, throughSetup } from "./test-fixtures.ts";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// Hot-seat harness over the REAL engine: any illegal dispatch throws and fails the test.
let current: GameState;
function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  current = gs;
  const dispatch = (a: Action) => setGs((s) => (current = applyAction(s, a)));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

describe("GameScreen", () => {
  it("lets a waiting network player browse factions without selecting one", () => {
    const gs = createGame({ gameId: "faction-observer", seed: 7, players: [{ id: "p1", name: "Ada" }, { id: "p2", name: "Lin" }, { id: "p3", name: "Rex" }] });
    const viewer = gs.turnOrder.find((pid) => pid !== waitingOn(gs))!;
    render(<GameScreen gs={gs} viewer={viewer} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    const modal = screen.getByRole("dialog", { name: "Faction setup" });
    expect(within(modal).getByLabelText("Available factions")).toBeTruthy();
    expect((within(modal).getAllByRole("button", { name: /^Select / })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("automatically skips an unaffordable start when there are no optional start powers", () => {
    vi.useFakeTimers();
    const gs = throughSetup(83);
    gs.factionPowers = {};
    gs.factionMissilePowers = {};
    gs.comebackPowers = {};
    gs.players[waitingOn(gs)!].hand = [];
    render(<Harness initial={gs} />);
    act(() => vi.advanceTimersByTime(900));
    expect(current.phase).toBe("join_or_recruit");
  });

  it("blocks the table on sealed content and lets the local host resume the exact game", () => {
    const campaign = initialCampaign("Paused World");
    campaign.unlockedModules = ["pack_2_comeback_mercenaries"];
    campaign.contentRequired = [{ moduleId: "pack_2_comeback_mercenaries", items: ["powers"] }];
    const gs = createGame({
      gameId: "paused-content", seed: 5,
      players: [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }],
      campaign,
    });
    render(<Harness initial={gs} />);

    expect(screen.getByRole("dialog", { name: "Sealed content required" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /Choose a faction/i })).toBeNull();
    fireEvent.change(screen.getByLabelText("Sealed content: pack_2_comeback_mercenaries.powers"), {
      target: { value: "Host-entered comeback powers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "SAVE & RESUME" }));

    expect(current.contentRequired).toEqual([]);
    expect(current.hostContent["pack_2_comeback_mercenaries.powers"]).toBe("Host-entered comeback powers");
    expect(screen.queryByRole("dialog", { name: "Sealed content required" })).toBeNull();
  });

  it("runs the Pack 1 advanced snake draft before drafted-faction placement", () => {
    const campaign = initialCampaign("Draft World");
    campaign.unlockedModules = ["pack_1_advanced_draft_biohazards"];
    campaign.hostContent["pack_1_advanced_draft_biohazards.draft"] = { sourced: true };
    const gs = createGame({
      gameId: "advanced-draft-ui", seed: 512,
      players: [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }],
      campaign,
    });
    render(<Harness initial={gs} />);

    const categories = ["faction", "turnOrder", "placementOrder", "startingTroops", "startingCoinCards"] as const;
    for (const category of categories) {
      for (let pick = 0; pick < 3; pick++) {
        const draft = current.advancedDraft!;
        const value = category === "faction" ? draft.available.factions[0] : draft.available[category][0];
        const name = category === "faction"
          ? `Faction ${contentPack.factions.find((faction) => faction.id === value)!.name}`
          : category === "turnOrder"
            ? `Turn Order Turn ${value}`
            : category === "placementOrder"
              ? `Starting Placement Place ${value}`
              : category === "startingTroops"
                ? `Starting Troops ${value} Troops`
                : `Starting Coin Cards ${value} Coin Card${value === 1 ? "" : "s"}`;
        const modal = screen.getByRole("dialog", { name: "Advanced setup draft" });
        fireEvent.click(within(modal).getAllByRole("button", { name })[0]);
        fireEvent.click(screen.getByRole("button", { name: "DRAFT CARD" }));
      }
    }

    expect(current.advancedDraft?.completed).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Advanced setup draft" })).toBeNull();
    const placer = waitingOn(current)!;
    const factionId = current.advancedDraft!.picks[placer].factionId!;
    const faction = contentPack.factions.find((candidate) => candidate.id === factionId)!;
    const power = contentPack.powers.find((candidate) => candidate.id === faction.startingPowers[0])!;
    const territoryId = Object.keys(current.territories)
      .find((id) => isLegalStart(current, id, true, factionId, placer))!;
    fireEvent.click(screen.getByText(power.name));
    fireEvent.click(document.getElementById(territoryId)!);
    expect(current.players[placer].factionId).toBe(factionId);
    expect(current.territories[territoryId].troops).toBe(current.players[placer].startingTroops);
  });

  it("lets an eliminated player choose a permanent Pack 2 comeback power", () => {
    const gs = throughSetup(603);
    const victim = gs.turnOrder[gs.activeIdx];
    const factionId = gs.players[victim].factionId!;
    gs.players[victim].eliminated = true;
    gs.comebackChoice = {
      playerId: victim,
      factionId,
      resume: "advance_turn",
      options: [
        {
          id: "pack2:power:border-recruiters",
          sourceModuleId: "pack_2_comeback_mercenaries",
          title: "Border Recruiters",
          text: "Physical power text A",
        },
        {
          id: "pack2:power:underground-network",
          sourceModuleId: "pack_2_comeback_mercenaries",
          title: "Underground Network",
          text: "Physical power text B",
        },
      ],
    };
    render(<Harness initial={gs} />);

    const modal = screen.getByRole("dialog", { name: "Choose a comeback power" });
    expect(within(modal).getByText(new RegExp(gs.players[victim].name))).toBeTruthy();
    fireEvent.click(within(modal).getByRole("button", { name: /Underground Network/ }));

    expect(current.comebackChoice).toBeUndefined();
    expect(current.comebackPowers[factionId]).toMatchObject({ title: "Underground Network" });
    expect(current.turnOrder[current.activeIdx]).not.toBe(victim);
  });

  it("lets the host place the World Capital when the physical Mission is completed and opens Pack 4", () => {
    const gs = throughSetup(6);
    gs.unlockedModules.push("pack_3_homelands_missions");
    gs.hostContent["pack_3_homelands_missions.missions"] = "Host-entered Missions";
    render(<Harness initial={gs} />);

    fireEvent.click(screen.getByRole("button", { name: "HOST: WORLD CAPITAL MISSION" }));
    fireEvent.click(document.getElementById("middle_east")!);
    fireEvent.change(screen.getByLabelText("World Capital name"), { target: { value: "Unity" } });
    fireEvent.click(screen.getByRole("button", { name: "PLACE & OPEN PACK 4" }));

    expect(current.territories.middle_east.city).toMatchObject({ type: "world_capital", population: 5, name: "Unity" });
    expect(current.unlockedModules).toContain("pack_4_lead_faction_private_missions");
    expect(current.contentRequired).toEqual([]);
    expect(current.legacyCards.missionDeck.filter((mission) =>
      mission.sourceModuleId === "pack_4_lead_faction_private_missions")).toHaveLength(6);
    expect(screen.queryByRole("dialog", { name: "Sealed content required" })).toBeNull();
  });

  it("lets the host capture and activate a Pack 4 Private Mission without exposing its condition", () => {
    const gs = throughSetup(604);
    const claimant = gs.turnOrder[gs.activeIdx];
    const factionId = gs.players[claimant].factionId!;
    gs.phase = "end_turn";
    gs.unlockedModules.push("pack_4_lead_faction_private_missions");
    gs.legacyCards.privateMissionPool = [
      {
        id: "pack4:private:silent-coup",
        sourceModuleId: "pack_4_lead_faction_private_missions",
        title: "Silent Coup",
        text: "Secret physical condition",
      },
      {
        id: "pack4:private:urban-dominion",
        sourceModuleId: "pack_4_lead_faction_private_missions",
        title: "Urban Dominion",
        text: "Another secret condition",
      },
    ];
    render(<Harness initial={gs} />);

    fireEvent.click(screen.getByRole("button", { name: "HOST: PRIVATE MISSIONS" }));
    let modal = screen.getByRole("dialog", { name: "Private missions" });
    fireEvent.change(within(modal).getByLabelText("Private Mission claimant"), { target: { value: claimant } });
    fireEvent.change(within(modal).getByLabelText("Private Mission title"), { target: { value: "Silent Coup" } });
    fireEvent.click(within(modal).getByRole("button", { name: "CAPTURE MISSION" }));
    expect(current.capturedPrivateMissions[factionId]).toMatchObject({ title: "Silent Coup" });
    expect(current.legacyCards.privateMissionPool).toHaveLength(1);

    const starsBefore = current.players[claimant].redStarTokens;
    fireEvent.click(screen.getByRole("button", { name: "HOST: PRIVATE MISSIONS" }));
    modal = screen.getByRole("dialog", { name: "Private missions" });
    fireEvent.click(within(modal).getByRole("button", { name: new RegExp(current.players[claimant].name) }));
    expect(current.players[claimant].redStarTokens).toBe(starsBefore + 1);
    expect(current.privateMissionsUsed).toContain(factionId);
  });

  it("lets the playing Lead Faction choose the face-up Mission", () => {
    const gs = throughSetup(606);
    const leader = gs.turnOrder[gs.activeIdx];
    gs.legacyCards.activeMission = undefined;
    gs.legacyCards.missionDeck = [
      { id: "mission:a", sourceModuleId: "pack_3_homelands_missions", title: "Mission A", text: "First choice", reward: 1 },
      { id: "mission:b", sourceModuleId: "pack_3_homelands_missions", title: "Mission B", text: "Second choice", reward: 2 },
    ];
    gs.missionChoice = { playerId: leader, reason: "game_start" };
    render(<Harness initial={gs} />);

    const modal = screen.getByRole("dialog", { name: "Lead Faction chooses the Mission" });
    fireEvent.click(within(modal).getByRole("button", { name: /Mission B/ }));

    expect(current.missionChoice).toBeUndefined();
    expect(current.legacyCards.activeMission?.title).toBe("Mission B");
  });

  it("lets the host place Alien Island and exposes it as a clickable connected territory", () => {
    const gs = throughSetup(605);
    gs.unlockedModules.push("pocket_2_alien_landing");
    render(<Harness initial={gs} />);

    fireEvent.click(screen.getByRole("button", { name: "HOST: PLACE ALIEN ISLAND" }));
    const modal = screen.getByRole("dialog", { name: "Place Alien Island" });
    fireEvent.change(within(modal).getByLabelText("Alien Island name"), { target: { value: "Arrival" } });
    fireEvent.change(within(modal).getByLabelText("First sea line"), { target: { value: "brazil" } });
    fireEvent.change(within(modal).getByLabelText("Second sea line"), { target: { value: "indonesia" } });
    fireEvent.click(within(modal).getByRole("button", { name: "PLACE ISLAND" }));

    expect(current.alienIsland).toEqual({ territoryId: "alien_island", name: "Arrival", connections: ["brazil", "indonesia"] });
    const island = document.getElementById("alien_island")!;
    expect(island).toBeTruthy();
    expect(island.getAttribute("transform")).toBe("translate(565 440)");
    const boardRoot = document.getElementById("risk-board-modern")!;
    const routes = boardRoot.querySelector("#alien-sea-routes")!;
    expect(routes.querySelectorAll("path[data-alien-route]")).toHaveLength(2);
    expect([...boardRoot.children].indexOf(routes)).toBeLessThan(
      [...boardRoot.children].indexOf(boardRoot.querySelector("#territory-haloes")!),
    );
    fireEvent.click(island);
    expect(screen.getByTestId("inspector").textContent).toContain("Alien Island");
    expect(screen.getByTestId("inspector").textContent).toContain("Off-board territory");
  });

  it("blocks on an Event card until the host records its physical resolution", () => {
    const gs = throughSetup(601);
    gs.phase = "end_turn";
    gs.legacyCards.pendingEvent = {
      id: "pack:event:1",
      sourceModuleId: "pack_1_advanced_draft_biohazards",
      title: "Supply Shock",
      text: "Resolve this effect using the physical card.",
    };
    render(<Harness initial={gs} />);

    const modal = screen.getByRole("dialog", { name: "Event card" });
    expect(within(modal).getByText("Supply Shock")).toBeTruthy();
    expect(within(modal).getAllByText(/physical card/)).toHaveLength(2);
    fireEvent.change(within(modal).getByLabelText("Event resolution note"), {
      target: { value: "Resolved at the table" },
    });
    fireEvent.click(within(modal).getByRole("button", { name: "RETURN TO BOX" }));

    expect(current.legacyCards.pendingEvent).toBeUndefined();
    expect(current.legacyCards.eventBox).toHaveLength(1);
    expect(current.log).toContainEqual(expect.objectContaining({
      type: "EventCardResolved",
      data: expect.objectContaining({ note: "Resolved at the table", destination: "box" }),
    }));
  });

  it("lets the host confirm a face-up Mission instead of the active player's Resource draw", () => {
    const gs = throughSetup(602);
    const pid = gs.turnOrder[gs.activeIdx];
    gs.phase = "end_turn";
    gs.players[pid].redStarTokens = 0;
    gs.legacyCards.activeMission = {
      id: "pack:mission:1",
      sourceModuleId: "pack_3_homelands_missions",
      title: "Bridgehead",
      text: "Control the places printed on the physical card.",
      reward: 1,
    };
    render(<Harness initial={gs} />);

    fireEvent.click(screen.getByRole("button", { name: "HOST: COMPLETE MISSION" }));
    const modal = screen.getByRole("dialog", { name: "Complete mission" });
    expect(within(modal).getByText("Bridgehead")).toBeTruthy();
    expect(within(modal).getByText(new RegExp(gs.players[pid].name))).toBeTruthy();
    fireEvent.click(within(modal).getByRole("button", { name: "CONFIRM MISSION" }));

    expect(current.players[pid].redStarTokens).toBe(1);
    expect(current.legacyCards.missionBox).toHaveLength(1);
    expect(current.log.some((event) => event.type === "ResourceCardDrawn" && event.playerId === pid)).toBe(false);
  });

  it("renders the imported board SVG with all clickable territory paths", () => {
    const gs = createGame({
      gameId: "ui-board-art",
      seed: 7,
      players: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Lin" },
        { id: "u3", name: "Rex" },
      ],
    });

    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);

    const board = document.getElementById("risk-board-modern");
    expect(board).toBeTruthy();
    expect(board!.querySelector("title")?.textContent).toBe("Stylized Risk-inspired campaign board");
    expect(board!.querySelectorAll("path.territory-border")).toHaveLength(42);
    expect(board!.querySelectorAll(".station-mark")).toHaveLength(0);
    expect(board!.querySelectorAll(".continent-callout")).toHaveLength(6);
    expect(document.getElementById("alaska")).toBeTruthy();

    // UI-4 legibility pass: every territory label is sized for 1280x720 without zoom
    const labels = [...board!.querySelectorAll("text.territory-label")];
    expect(labels).toHaveLength(42);
    for (const l of labels) expect(Number(l.getAttribute("font-size"))).toBeGreaterThanOrEqual(6.1);
  });

  it("links face-up sideboard Territory-card hover and focus to the matching map territory", () => {
    const gs = throughSetup(703);
    const cardId = gs.sideboard.slots[0]!;
    const definition = resourceCardDefinition(cardId)!;
    expect(definition.kind).toBe("territory");
    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);

    const sideboard = screen.getByText("SIDEBOARD").closest("section")!;
    const card = sideboard.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`)!;
    const territory = document.getElementById(definition.kind === "territory" ? definition.territoryId : "")!;
    fireEvent.mouseEnter(card);
    expect(territory.classList.contains("resource-card-hover")).toBe(true);
    fireEvent.mouseLeave(card);
    expect(territory.classList.contains("resource-card-hover")).toBe(false);
    fireEvent.focus(card);
    expect(territory.classList.contains("resource-card-hover")).toBe(true);
    fireEvent.blur(card);
    expect(territory.classList.contains("resource-card-hover")).toBe(false);
  });

  it("toggles a current coin-value view for all territories, including upgrades and destroyed cards", () => {
    const gs = throughSetup(704);
    const [upgraded, destroyed] = contentPack.cards.territoryCards;
    gs.cardModifications[upgraded.id] = { resources: 5 };
    gs.sideboard.destroyed.push(destroyed.id);
    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);

    const toggle = screen.getByRole("button", { name: "Show territory resource values" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll("[data-resource-value]")).toHaveLength(42);
    expect(document.querySelector(`[data-resource-value="${upgraded.territoryId}"]`)?.textContent).toBe("5");
    expect(document.querySelector(`[data-resource-value="${destroyed.territoryId}"]`)?.textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Return to tactical board" }));
    expect(document.querySelectorAll("[data-resource-value]")).toHaveLength(0);
  });

  it("keeps start of turn explicit so optional legacy reactions cannot be raced", () => {
    const gs = throughSetup(82);
    const pid = waitingOn(gs)!;
    gs.players[pid].hand = [];
    render(<Harness initial={gs} />);
    expect(screen.getByRole("button", { name: "BEGIN RECRUITMENT" })).toBeTruthy();
    expect(current.phase).toBe("start_turn");
  });

  it("announces Red Stars and eliminations as central dismissible moments", () => {
    const gs = throughSetup(84);
    const { rerender } = render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    const playerId = gs.turnOrder[0];
    const next = structuredClone(gs);
    next.eventSeq++;
    next.log.push({ seq: next.eventSeq, type: "RedStarGained", playerId, data: { source: "captured_hq", territory: "ural" } });
    rerender(<GameScreen gs={next} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    expect(screen.getByText("RED STAR EARNED")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss game announcement" }));

    const eliminated = structuredClone(next);
    eliminated.eventSeq++;
    eliminated.log.push({ seq: eliminated.eventSeq, type: "PlayerEliminated", playerId: eliminated.turnOrder[1] });
    rerender(<GameScreen gs={eliminated} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    expect(screen.getByText("PLAYER ELIMINATED")).toBeTruthy();
  });

  it("highlights an own-founded Major City as a legal setup start", () => {
    const gs = createGame({
      gameId: "ui-major-city",
      seed: 11,
      players: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Lin" },
        { id: "u3", name: "Rex" },
      ],
    });
    const actor = waitingOn(gs)!;
    gs.territories.alaska.city = {
      type: "major",
      population: 2,
      name: "Northgate",
      foundedByPlayerId: actor,
    };
    const faction = contentPack.factions[0];

    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    fireEvent.click(screen.getByText(faction.name));

    expect(document.getElementById("alaska")?.getAttribute("class")).toContain("highlight-start");
  });

  it("runs setup through the full-screen faction/power takeover with readable labels (UI-1/UI-8)", () => {
    vi.useFakeTimers();
    const gs = createGame({
      gameId: "ui-board-click",
      seed: 13,
      players: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Lin" },
        { id: "u3", name: "Rex" },
      ],
    });
    const actor = waitingOn(gs)!;
    const faction = contentPack.factions[0];
    const powerId = faction.startingPowers[0];
    const power = contentPack.powers.find((p) => p.id === powerId)!;
    const dispatch = vi.fn();
    gs.factionHistory[faction.id] = [{
      gameNumber: 1,
      playerId: "u1",
      playerName: "Ada",
      startingTerritoryId: "alaska",
      result: "won",
    }];
    gs.gameNumber = 2;

    render(<GameScreen gs={gs} dispatch={dispatch} onExit={vi.fn()} error={null} />);

    // full-screen takeover with the whose-decision chip; no raw snake_case power ids anywhere (UI-1)
    const takeover = screen.getByRole("dialog", { name: "Faction setup" });
    expect(within(takeover).getAllByText(gs.players[actor].name).length).toBeGreaterThan(0);
    expect(takeover.querySelectorAll(".physical-faction-card-wrap")).toHaveLength(contentPack.factions.length);
    for (const f of contentPack.factions) {
      expect(within(takeover).getByText(f.name)).toBeTruthy();
      expect(within(takeover).getByRole("button", { name: `Select ${f.name}` })).toBeTruthy();
      for (const pw of f.startingPowers) expect(screen.queryByText(pw)).toBeNull();
    }

    fireEvent.click(within(takeover).getByRole("button", { name: `View history for ${faction.name}` }));
    expect(within(takeover).getByText("Alaska")).toBeTruthy();
    expect(within(takeover).getByText("WON")).toBeTruthy();
    fireEvent.click(within(takeover).getByRole("button", { name: `View ${faction.name} front` }));

    // faction step → power step (readable name + rules text) → takeover closes to the board
    fireEvent.click(screen.getByText(faction.name));
    fireEvent.click(screen.getByText(power.name));
    expect(screen.getByText("Permanent faction power chosen")).toBeTruthy();
    expect(screen.getByText("Chosen")).toBeTruthy();
    expect(screen.getByText("Destroyed")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1200); });
    expect(screen.queryByRole("dialog", { name: "Faction setup" })).toBeNull();
    expect(screen.getByText(/click a highlighted territory/i)).toBeTruthy();

    fireEvent.click(document.getElementById("alaska")!);
    expect(dispatch).toHaveBeenCalledWith({
      type: "setup.choose",
      playerId: actor,
      factionId: faction.id,
      territoryId: "alaska",
      powerId,
    });
  });

  it("recruit phase controls live in the bottom action bar, not the rail (UI-2)", () => {
    let gs = throughSetup(83);
    const pid = waitingOn(gs)!;
    gs = applyAction(gs, { type: "start.done", playerId: pid });
    render(<Harness initial={gs} />);

    const bar = document.querySelector("[data-action-bar]") as HTMLElement;
    expect(bar).toBeTruthy();
    expect(within(bar).getByText(`${current.recruit!.remaining} TO PLACE`)).toBeTruthy();
    const rail = document.querySelector("aside") as HTMLElement;
    expect(within(rail).getByLabelText("Recruitment breakdown").textContent).toContain(`${current.recruit!.remaining} troops left to place`);

    // board clicks place via the stepper count; TO ATTACK advances the phase
    const mine = Object.entries(current.territories).find(([, t]) => t.controller === pid)![0];
    expect(document.getElementById(mine)?.getAttribute("class")).toContain("highlight-recruit");
    const start = current.recruit!.remaining;
    for (let i = 0; i < start; i++) fireEvent.click(document.getElementById(mine)!);
    expect(current.recruit!.remaining).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "TO ATTACK" }));
    expect(current.phase).toBe("expand_attack");
    expect(screen.getByRole("button", { name: "END ATTACKS" })).toBeTruthy();
  });

  it("maneuver phase highlights only legal 2+ troop sources before selection", () => {
    let { gs, pid, mine, target } = atExpandAttack(151);
    const destination = territoryById(mine).neighbors.find((tid) => tid !== target)!;
    gs.territories[mine].troops = 1;
    gs.territories[destination] = { controller: pid, troops: 3, scars: [] };
    gs = applyAction(gs, { type: "phase.endAttacks", playerId: pid });

    render(<Harness initial={gs} />);

    expect(document.getElementById(mine)?.getAttribute("class")).not.toContain("highlight-move");
    expect(document.getElementById(destination)?.getAttribute("class")).toContain("highlight-move");

    fireEvent.click(document.getElementById(mine)!);
    expect(screen.getByRole("alert").textContent).toMatch(/2\+ troops/);
    fireEvent.click(document.getElementById(destination)!);

    expect(document.getElementById(destination)?.getAttribute("class")).toContain("selected");
    expect(document.getElementById(mine)?.getAttribute("class")).toContain("highlight-move");
  });

  it("offers and executes Early Maneuver before the maneuver phase", () => {
    const { gs, pid, mine, target } = atExpandAttack(152);
    const destination = territoryById(mine).neighbors.find((tid) => tid !== target)!;
    gs.territories[mine].troops = 6;
    gs.territories[destination] = { controller: pid, troops: 1, scars: [] };
    gs.factionPowers[gs.players[pid].factionId!] = "early_maneuver";
    const before = gs.territories[destination].troops;
    render(<Harness initial={gs} />);

    fireEvent.click(screen.getByRole("button", { name: "EARLY MANEUVER" }));
    fireEvent.click(document.getElementById(mine)!);
    fireEvent.click(document.getElementById(destination)!);

    const move = screen.getByRole("dialog", { name: "Choose troop count" });
    expect((within(move).getByLabelText("Troops to move") as HTMLInputElement).value).toBe("0");
    expect(current.maneuverUsed).toBe(false);
    fireEvent.change(within(move).getByLabelText("Troops to move"), { target: { value: "1" } });
    fireEvent.click(within(move).getByRole("button", { name: "CONFIRM" }));

    expect(current.phase).toBe("expand_attack");
    expect(current.maneuverUsed).toBe(true);
    expect(current.territories[destination].troops).toBe(before + 1);
  });

  it("phone: board-first layout with the table drawer instead of the rail (UI-5)", () => {
    const orig = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      let gs = throughSetup(107);
      const pid = waitingOn(gs)!;
      gs = applyAction(gs, { type: "start.done", playerId: pid });
      render(<Harness initial={gs} />);

      expect(document.querySelector("aside")).toBeNull(); // no desktop rail
      expect(document.getElementById("risk-board-modern")).toBeTruthy(); // board-first
      expect(document.querySelector("[data-action-bar]")).toBeTruthy(); // current action reachable

      fireEvent.click(screen.getByRole("button", { name: "TABLE" }));
      const drawer = screen.getByRole("dialog", { name: "Table" });
      expect(within(drawer).getByText("QUICK LOOK")).toBeTruthy();
      expect(within(drawer).getByText("SIDEBOARD")).toBeTruthy();
      expect(within(drawer).getByText("BATTLE LOG")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "CLOSE ▾" }));
      expect(screen.queryByRole("dialog", { name: "Table" })).toBeNull();
    } finally {
      window.matchMedia = orig;
    }
  });

  it("battle log is a collapsed rail tab that windows long logs (UI-2)", () => {
    const gs = throughSetup(89);
    for (let i = 1; i <= 300; i++) gs.log.push({ seq: gs.eventSeq + i, type: "ModifierPassed" });

    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    expect(screen.queryByTestId("ledger-log")).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByText("BATTLE LOG"));

    const log = screen.getByTestId("ledger-log");
    expect(log.querySelectorAll("div").length).toBeLessThanOrEqual(50); // latest window only
    fireEvent.click(screen.getByText(/earlier \d+ events/));
    expect(screen.getByTestId("ledger-log").querySelectorAll("div")).toHaveLength(gs.log.length);
  });
});
