import { expect, test } from "@playwright/test";

test.use({ video: "off" });

test("gameplay choreography settles and releases every transient object", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.clock.resume();
  await page.goto("/?table-demo=1&showcase=1");
  const table = page.locator(".game-table");
  await expect(table).toHaveAttribute("data-presentation-status", "idle");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
  const commands: Record<string, string[]> = {
    INCOME: ["recruitment.show"], DRAW: ["cards.transfer"], TRADE: ["cards.transfer"], STAR: ["cards.transfer", "redStar.gain"],
    CITY: ["city.place"], FORTIFY: ["city.fortify"], DAMAGE: ["city.damage"], POWER: ["power.activate"], HANDOFF: ["turn.handoff"],
    "DESTROY CARD": ["legacy.ritual"], "WORLD NAME": ["legacy.ritual"], "SETUP CLAIM": ["setup.faction", "setup.claim"], ISLAND: ["alienIsland.place"],
    CONQUEST: ["army.move", "territory.conquest", "hq.capture", "reward.eligible"], SIGNING: ["legacy.ritual"],
  };
  for (const name of ["INCOME", "DRAW", "TRADE", "STAR", "CITY", "FORTIFY", "DAMAGE", "POWER", "HANDOFF", "DESTROY CARD", "WORLD NAME", "SETUP CLAIM", "ISLAND", "CONQUEST", "SIGNING"]) {
    await page.evaluate(() => { (globalThis as any).__riskTableDiagnostics.lastCommand = undefined; });
    await page.getByRole("button", { name, exact: true }).dispatchEvent("click");
    await expect.poll(() => page.evaluate(() => (globalThis as any).__riskTableDiagnostics.lastCommand?.type), { message: name }).toMatch(new RegExp(`^(${commands[name].map(command => command.replaceAll(".", "\\.")).join("|")})$`));
    if (["INCOME", "CITY", "CONQUEST"].includes(name)) {
      await page.clock.runFor(180);
      await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase()}-active.png`) });
    }
    for (let beat = 0; beat < 6; beat++) await page.clock.fastForward(1_000);
    await expect(table).toHaveAttribute("data-presentation-status", "idle");
    const diagnostics = await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.capture());
    expect(diagnostics.activeParticles, name).toBe(0);
    expect(diagnostics.contextLosses, name).toBe(0);
  }
  expect(errors).toEqual([]);
});

test("reduced and instant gameplay remains cancellable and leak free", async ({ page }) => {
  test.setTimeout(60_000);
  await page.clock.install();
  await page.clock.resume();
  await page.goto("/?table-demo=1&showcase=1");
  const table = page.locator(".game-table");
  await expect(table).toHaveAttribute("data-presentation-status", "idle");
  await page.getByRole("button", { name: "Presentation settings" }).click();
  for (const motion of ["reduced", "instant"]) {
    await page.getByLabel("Motion", { exact: true }).selectOption(motion);
    for (const name of ["INCOME", "STAR", "CONQUEST", "ISLAND", "WORLD NAME"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(table).toHaveAttribute("data-presentation-status", "idle");
      expect((await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.capture())).activeParticles).toBe(0);
    }
  }
  await page.getByLabel("Motion", { exact: true }).selectOption("full");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
  await page.getByRole("button", { name: "VICTORY", exact: true }).dispatchEvent("click");
  await page.getByTestId("presentation-skip").dispatchEvent("click");
  await expect(table).toHaveAttribute("data-presentation-status", "idle");
  expect((await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.capture())).activeParticles).toBe(0);
});
