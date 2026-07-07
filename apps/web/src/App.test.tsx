// @vitest-environment jsdom
// new (TEST-web): smoke test — the hub renders and a local sandbox game starts against the real engine.
import "./test-shims.ts";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import App from "./App.tsx";

afterEach(cleanup);

describe("web smoke (TEST-web)", () => {
  it("renders the hub", () => {
    render(<App />);
    expect(screen.getByText("WAR ROOM")).toBeTruthy();
    expect(screen.getByText("START GAME")).toBeTruthy();
  });

  it("starts a sandbox game: board renders with 42 territories and setup waits on the first chooser", () => {
    render(<App />);
    fireEvent.click(screen.getByText("START GAME"));
    const board = document.getElementById("risk-board-modern");
    expect(board).toBeTruthy();
    expect(board!.getAttribute("viewBox")).toBe("0 0 749.819 519.068"); // fixed contract (SPEC §11)
    expect(board!.querySelectorAll("path.territory-border")).toHaveLength(42);
    expect(screen.getByText("ACTING:")).toBeTruthy(); // setup phase routes to the first chooser
    expect(screen.getByText("← HUB")).toBeTruthy();
  });

  it("returns to the hub on exit", () => {
    render(<App />);
    fireEvent.click(screen.getByText("START GAME"));
    fireEvent.click(screen.getByText("← HUB"));
    expect(screen.getByText("WAR ROOM")).toBeTruthy();
  });
});
