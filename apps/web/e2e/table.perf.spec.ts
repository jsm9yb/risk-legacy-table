import { expect, test } from "@playwright/test";

async function frameSample(page: import("@playwright/test").Page, frames = 180) {
  return page.evaluate((count) => (globalThis as any).__riskTableDiagnostics.benchmarkFrames(count), frames) as Promise<{ median: number; p95: number; max: number; frames: number }>;
}

test("150+ piece table and battle stay inside responsiveness budgets", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?table-demo=1");
  await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");
  const idle = await frameSample(page, 120);
  console.log("idle frame sample", idle);
  expect(idle.median).toBeLessThanOrEqual(8);
  expect(idle.p95).toBeLessThanOrEqual(16.7);
  const diagnostics = await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.capture());
  expect(diagnostics.renderer).toBe("pixi-webgl");
  expect(diagnostics.activeSprites).toBeGreaterThan(100);
  expect(diagnostics.activeParticles).toBe(0);

  await page.getByRole("button", { name: "BATTLE", exact: true }).click();
  const battle = await frameSample(page, 120);
  console.log("battle frame sample", battle);
  expect(battle.p95).toBeLessThanOrEqual(33);

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");
  await page.setViewportSize({ width: 1440, height: 800 });
  const resized = await frameSample(page, 60);
  expect(resized.p95).toBeLessThanOrEqual(16.7);
});
