// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CenterOverlay } from "./overlays.tsx";

afterEach(cleanup);

function DraftDecision() {
  const [draft, setDraft] = useState("");
  return <CenterOverlay label="Legacy decision">
    <input aria-label="City name" value={draft} onChange={(event) => setDraft(event.target.value)} />
    <button type="button">Confirm city</button>
  </CenterOverlay>;
}

describe("mounted presentation decision focus", () => {
  it("focuses on reveal, preserves the mounted draft, traps Tab, and restores the opener", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Open reward";
    document.body.append(opener);
    opener.focus();
    const view = render(<div hidden><DraftDecision /></div>);
    expect(document.activeElement).toBe(opener);

    view.rerender(<div hidden={false}><DraftDecision /></div>);
    const input = screen.getByRole("textbox", { name: "City name" });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "Fort Jordan" } });
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm city" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(input);

    view.rerender(<div hidden><DraftDecision /></div>);
    await waitFor(() => expect(input.closest("[hidden]")).toBeTruthy());
    opener.focus();
    view.rerender(<div hidden={false}><DraftDecision /></div>);
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect((input as HTMLInputElement).value).toBe("Fort Jordan");
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("recognizes a styled hidden ancestor and ignores disabled fieldset controls", async () => {
    const content = <CenterOverlay label="Paused decision"><fieldset disabled><button>Held action</button></fieldset><button>Available action</button></CenterOverlay>;
    const view = render(<div style={{ display: "none" }}>{content}</div>);
    expect(document.activeElement?.textContent).not.toBe("Available action");
    view.rerender(<div style={{ display: "block" }}>{content}</div>);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Available action" })));
  });
});
