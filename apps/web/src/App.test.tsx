// @vitest-environment jsdom
// new (TEST-web): smoke test - the hub renders and a local sandbox game starts against the real engine.
import "./test-shims.ts";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import App from "./App.tsx";
import { LOCAL_CAMPAIGN_KEY } from "./local/campaignStore.ts";

function prepareWorld() {
  for (let index = 0; index < 12; index++) {
    fireEvent.click(screen.getByRole("button", { name: /next sticker/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Resource sticker slot 1" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "COMMIT STICKER" }));
  }
  fireEvent.click(screen.getByRole("button", { name: "CONFIRM REVIEW" }));
  fireEvent.click(screen.getByRole("button", { name: "SEAL PREPARATION" }));
}

function startLocalGame() {
  fireEvent.click(screen.getByRole("button", { name: /NEW CAMPAIGN/ }));
  fireEvent.click(screen.getByRole("button", { name: "PREPARE THE WORLD" }));
  prepareWorld();
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("web smoke (TEST-web)", () => {
  it("renders the hub as the game table with player-facing entries (UI-6)", () => {
    render(<App />);
    expect(screen.getByText("WAR ROOM")).toBeTruthy();
    expect(screen.getByText("SELECT A CAMPAIGN")).toBeTruthy();
    expect(screen.getByText("NEW CAMPAIGN")).toBeTruthy();
    expect(document.querySelectorAll("[data-emblem]")).toHaveLength(5);
    expect(screen.getByText("JOIN THE WAR ROOM")).toBeTruthy();
    expect(screen.getByText("THE LEGACY VAULT")).toBeTruthy();
    expect(document.querySelectorAll("[data-legacy-packet]")).toHaveLength(6);
    expect(screen.queryByText(/1-web/)).toBeNull();
    expect(screen.queryByText(/npm run/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /NEW CAMPAIGN/ }));
    expect(screen.getByText("PLAY AT THIS TABLE")).toBeTruthy();
    expect(screen.getByLabelText("World name")).toBeTruthy();
    expect(screen.getByLabelText("Remove seat 1").hasAttribute("disabled")).toBe(true);
  });

  it("starts a sandbox game: board renders with 42 territories and setup waits on the first chooser", () => {
    render(<App />);
    startLocalGame();
    const board = document.getElementById("risk-board-modern");
    expect(board).toBeTruthy();
    expect(board!.getAttribute("viewBox")).toBe("0 0 749.819 519.068");
    expect(board!.querySelectorAll("path.territory-border")).toHaveLength(42);
    expect(screen.getByText("ACTING:")).toBeTruthy();
    expect(screen.getByText(/HUB/)).toBeTruthy();
  });

  it("returns to the hub on exit", () => {
    render(<App />);
    startLocalGame();
    fireEvent.click(screen.getByText(/HUB/));
    expect(screen.getByText("WAR ROOM")).toBeTruthy();
  });

  it("persists and resumes a local hot-seat game from the hub", () => {
    render(<App />);
    startLocalGame();
    const saved = JSON.parse(window.localStorage.getItem(LOCAL_CAMPAIGN_KEY)!);
    expect(saved.activeGame.phase).toBe("setup");

    fireEvent.click(screen.getByText(/HUB/));
    expect(screen.getByText("Saved campaign")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "RESUME" }));

    expect(document.getElementById("risk-board-modern")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(LOCAL_CAMPAIGN_KEY)!).id).toBe(saved.id);
  });

  it("requires confirmation before replacing or deleting a local campaign", () => {
    render(<App />);
    startLocalGame();
    fireEvent.click(screen.getByText(/HUB/));
    const originalId = JSON.parse(window.localStorage.getItem(LOCAL_CAMPAIGN_KEY)!).id;

    fireEvent.click(screen.getByRole("button", { name: /NEW CAMPAIGN/ }));
    fireEvent.click(screen.getByRole("button", { name: "PREPARE THE WORLD" }));
    expect(screen.getByText("REPLACE CAMPAIGN?")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(LOCAL_CAMPAIGN_KEY)!).id).toBe(originalId);
    fireEvent.click(screen.getByRole("button", { name: "CANCEL" }));

    fireEvent.click(screen.getByRole("button", { name: /CAMPAIGNS/ }));
    fireEvent.click(screen.getByRole("button", { name: "DELETE SAVE" }));
    expect(screen.getByText("DELETE CAMPAIGN?")).toBeTruthy();
    expect(window.localStorage.getItem(LOCAL_CAMPAIGN_KEY)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "DELETE PERMANENTLY" }));
    expect(window.localStorage.getItem(LOCAL_CAMPAIGN_KEY)).toBeNull();
  });
});
