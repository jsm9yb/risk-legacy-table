// @vitest-environment jsdom
import "../test-shims.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUnpreparedCampaign, type CampaignPreparationAction } from "@risk/rules";
import PrepareWorldScreen from "./PrepareWorldScreen.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const participants = [
  { playerId: "p1", name: "One", seat: 0 },
  { playerId: "p2", name: "Two", seat: 1 },
  { playerId: "p3", name: "Three", seat: 2 },
];

describe("PrepareWorldScreen", () => {
  it("drops the current Coin onto the whole Territory card, not only its pip", () => {
    const campaign = createUnpreparedCampaign("Drag World", participants);
    campaign.preparation!.stage = "resource_stickers";
    const dispatch = vi.fn<(action: CampaignPreparationAction) => void>();
    render(<PrepareWorldScreen campaign={campaign} dispatch={dispatch} onExit={() => {}} />);

    const sticker = screen.getByRole("button", { name: /next sticker/i });
    const targetCard = document.querySelector<HTMLElement>('[data-card-id="0"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => targetCard) });

    fireEvent.pointerDown(sticker, { pointerId: 1, clientX: 900, clientY: 300 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 300, clientY: 300 });
    expect(document.querySelector("#alaska")?.classList.contains("prep-map-active")).toBe(true);
    expect(screen.getByText("HOW RESOURCE CARDS WORK")).toBeTruthy();
    expect(screen.getByText(/Unlike classic Risk, these cards are not equal/i)).toBeTruthy();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 300, clientY: 300 });

    expect(screen.getByRole("dialog", { name: "Confirm permanent sticker" })).toBeTruthy();
  });

  it("requires confirmation before an admin randomly places every remaining Coin", () => {
    const campaign = createUnpreparedCampaign("Random World", participants);
    const dispatch = vi.fn<(action: CampaignPreparationAction) => void>();
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<PrepareWorldScreen campaign={campaign} dispatch={dispatch} onExit={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /randomize remaining.*admin override/i }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /confirm admin randomization/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "RANDOMIZE COINS" }));

    expect(dispatch).toHaveBeenCalledOnce();
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe("preparation.randomizeResourceStickers");
    if (action.type !== "preparation.randomizeResourceStickers") throw new Error("Unexpected action");
    expect(action.placements).toHaveLength(12);
    expect(new Set(action.placements.map((placement) => `${placement.cardId}:${placement.slot}`)).size).toBe(12);
  });

  it("hides the admin override from non-admin players", () => {
    const campaign = createUnpreparedCampaign("Player World", participants);
    render(<PrepareWorldScreen campaign={campaign} dispatch={() => {}} onExit={() => {}} viewerId="p1" adminOverride={false} />);
    expect(screen.queryByRole("button", { name: /admin override/i })).toBeNull();
  });
});
