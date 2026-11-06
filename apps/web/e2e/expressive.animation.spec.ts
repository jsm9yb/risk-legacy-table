import { expect, test } from "@playwright/test";

test.use({video: "off"});

test("expressive animation examples visibly progress and release their objects", async ({page}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.clock.resume();
  await page.goto("/?table-demo=1&showcase=1&animation-showcase=1");
  const table = page.locator(".game-table");
  await expect(table).toHaveAttribute("data-presentation-status", "idle");
  await page.getByRole("button", {name: "READY ARMIES", exact: true}).click();
  await expect(table).toHaveAttribute("data-presentation-status", "idle");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 3000));
  for (const name of ["ARMY ARRIVAL", "DEFENDER LOSS", "DECISION PREVIEW", "POWER", "WORLD NAME", "ELIMINATION", "MODULE"]) {
    const beforeLegacy = name === "WORLD NAME" ? await table.screenshot() : undefined;
    await page.getByRole("button", {name, exact: true}).dispatchEvent("click");
    await page.clock.runFor(name === "ARMY ARRIVAL" ? 280 : 80);
    const first = await table.screenshot();
    await page.clock.runFor(180);
    const second = await table.screenshot();
    expect(first.equals(second), `${name} must visibly progress`).toBe(false);
    if (name === "DECISION PREVIEW") await expect(table).toHaveAttribute("data-presentation-status", "idle");
    for (let beat = 0; beat < 8; beat++) await page.clock.fastForward(1000);
    await expect(table).toHaveAttribute("data-presentation-status", "idle");
    const health = await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.capture());
    expect(health.activeParticles, name).toBe(0);
    expect(health.contextLosses, name).toBe(0);
    if (beforeLegacy) expect(beforeLegacy.equals(await table.screenshot()), "the world name remains visible after the ink effect settles").toBe(false);
  }
  expect(errors).toEqual([]);
});

test("elimination and envelope effects honor skip and reduced motion", async ({page}) => {
  test.setTimeout(60_000);
  await page.clock.install();
  await page.clock.resume();
  await page.goto("/?table-demo=1&showcase=1&animation-showcase=1");
  const table = page.locator(".game-table");
  await expect(table).toHaveAttribute("data-presentation-status", "idle");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 3000));
  for (const name of ["ELIMINATION", "MODULE"]) {
    await page.getByRole("button", {name, exact: true}).dispatchEvent("click");
    await page.clock.runFor(100);
    await page.getByTestId("presentation-skip").dispatchEvent("click");
    await expect(table).toHaveAttribute("data-presentation-status", "idle");
    expect((await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.capture())).activeParticles).toBe(0);
  }
  await page.clock.resume();
  await page.getByRole("button", {name: "Presentation settings"}).click();
  await page.getByLabel("Motion", {exact: true}).selectOption("reduced");
  for (const name of ["ELIMINATION", "MODULE", "WORLD NAME", "POWER"]) {
    await page.getByRole("button", {name, exact: true}).click();
    await expect(table).toHaveAttribute("data-presentation-status", "idle");
    expect((await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.capture())).activeParticles).toBe(0);
  }
});
