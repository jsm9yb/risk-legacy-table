import { expect, test, type Page } from "@playwright/test";

const minutes = Number(process.env.TABLE_SOAK_MINUTES ?? "30");

async function skipPresentationIfAvailable(page: Page) {
  return page.evaluate(() => {
    const skip = document.querySelector<HTMLButtonElement>('[data-testid="presentation-skip"]');
    if (!skip) return false;
    skip.click();
    return true;
  });
}

test("soak skip check tolerates a presentation completing between observation and activation", async ({ page }) => {
  await page.goto("/?table-demo=1&players=5&fixture=marks");
  await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");
  await page.getByRole("button", { name: "BATTLE", exact: true }).click();
  const skip = page.getByRole("button", { name: "SKIP", exact: true });
  await expect(skip).toBeVisible();
  expect(await skipPresentationIfAvailable(page)).toBe(true);
  await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");

  await page.getByRole("button", { name: "BATTLE", exact: true }).click();
  await expect(skip).toBeVisible();
  await page.waitForTimeout(2_500);
  expect(await skipPresentationIfAvailable(page)).toBe(false);
  await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");
});

test("30-minute idle and active table memory soak @soak", async ({ page }) => {
  test.setTimeout((minutes + 2) * 60_000);
  await page.goto("/?table-demo=1&players=5&fixture=marks");
  await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");

  const heapSamples: number[] = [];
  const actions = ["RECRUIT", "MANEUVER", "BATTLE", "MISSILE", "MODULE", "NUCLEAR"];
  const deadline = Date.now() + minutes * 60_000;
  for (let index = 0; Date.now() < deadline; index++) {
    const action = actions[index % actions.length];
    await page.getByRole("button", { name: action, exact: true }).click();
    await skipPresentationIfAvailable(page);
    await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");
    await page.setViewportSize(index % 2 ? { width: 1280, height: 720 } : { width: 1024, height: 768 });
    const heap = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize);
    if (typeof heap === "number") heapSamples.push(heap);
    const remaining = deadline - Date.now();
    if (remaining > 0) await page.waitForTimeout(Math.min(10_000, remaining));
  }

  const diagnostics = await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.capture());
  expect(diagnostics.activeParticles).toBe(0);
  expect(diagnostics.contextLosses).toBe(0);
  if (heapSamples.length > 1) {
    const drift = heapSamples.at(-1)! - heapSamples[0];
    const spread = Math.max(...heapSamples) - Math.min(...heapSamples);
    console.log("table soak heap", { samples: heapSamples.length, drift, spread });
    expect(drift).toBeLessThan(64 * 1024 * 1024);
    expect(spread).toBeLessThan(96 * 1024 * 1024);
  }
});
