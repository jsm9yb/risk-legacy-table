import { expect, test, type Page } from "@playwright/test";

async function expectHealthyTable(page: Page) {
  await expect(page.getByTestId("pixi-table-host").locator("canvas")).toBeVisible();
  await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");
  await expect(page.getByRole("alert").filter({ hasText: "TABLE RENDERER UNAVAILABLE" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Game board" })).toBeAttached();
}

test("populated Pixi table renders generated pieces, permanent marks, and interaction", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/?table-demo=1");
  await expectHealthyTable(page);
  await expect(page).toHaveScreenshot("table-desktop-populated.png");

  for (const factionId of ["die_mechaniker", "enclave_of_the_bear", "imperial_balkania", "khan_industries", "saharan_republic", "mutants", "aliens"]) {
    await page.getByLabel("Demo faction").selectOption(factionId);
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot(`table-faction-${factionId}.png`);
  }
  await page.getByLabel("Demo intents").selectOption("matrix");
  await expect(page).toHaveScreenshot("table-interaction-intents.png");

  const alaska = page.locator('button[data-accessible-territory="alaska"]');
  await alaska.focus();
  await alaska.press("ArrowRight");
  const keyboardTarget = page.locator('button[data-accessible-territory="northwest_territory"]');
  await expect(keyboardTarget).toBeFocused();
  await keyboardTarget.press("Enter");
  await expect(keyboardTarget).toHaveAttribute("aria-pressed", "true");

  await page.locator("canvas").evaluate((canvas) => {
    canvas.dispatchEvent(new Event("webglcontextlost"));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
  });
  await expectHealthyTable(page);
  expect(errors).toEqual([]);
});

test("high and low quality tiers render stable tables", async ({ page }) => {
  test.setTimeout(60_000);
  for (const quality of ["high", "balanced", "low"]) {
    await page.goto("/?table-demo=1");
    await page.evaluate((value) => localStorage.setItem("risk.table.quality", value), quality);
    await page.reload();
    await expectHealthyTable(page);
    await expect(page).toHaveScreenshot(`table-quality-${quality}.png`);
  }
});

test("empty and three-to-five-player campaign tables cover every permanent mark", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?table-demo=1&fixture=empty");
  await expectHealthyTable(page);
  await expect(page).toHaveScreenshot("table-empty-setup.png");

  for (const players of [3, 4, 5]) {
    await page.goto(`/?table-demo=1&players=${players}`);
    await expectHealthyTable(page);
    await expect(page).toHaveScreenshot(`table-populated-${players}-players.png`);
  }

  await page.goto("/?table-demo=1&players=5&fixture=marks");
  await expectHealthyTable(page);
  await expect(page).toHaveScreenshot("table-all-permanent-marks.png");
});

test("every territory stays countable under the global clutter fixture and exposes exact hover detail", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?table-demo=1&players=5&fixture=clutter");
  await expectHealthyTable(page);
  await expect(page).toHaveScreenshot("table-global-clutter-audit.png");

  const point = await page.evaluate(() => (globalThis as any).__riskTableDiagnostics.territoryClientPoint("alaska"));
  await page.mouse.move(point.x, point.y);
  const tooltip = page.getByTestId("territory-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Alaska");
  await expect(tooltip).toContainText(/1\s*troops/i);
  await expect(tooltip).toContainText("Die Mechaniker");
  await expect(tooltip).toContainText("Fortification");
});

test("battle and conquest execute as skippable semantic sequences", async ({ page }) => {
  await page.goto("/?table-demo=1");
  await expectHealthyTable(page);
  await page.getByRole("button", { name: "BATTLE", exact: true }).click();
  await expect(page.getByRole("button", { name: "SKIP" })).toBeVisible();
  await page.getByRole("button", { name: "SKIP" }).click();
  await expect(page.getByRole("button", { name: "SKIP" })).toBeHidden();

  await page.getByRole("button", { name: "BATTLE", exact: true }).click();
  await page.waitForTimeout(1_040);
  expect(await page.screenshot()).toMatchSnapshot("table-battle-impact.png", { maxDiffPixelRatio: 0.02, threshold: 0.3 });
  await expect(page.locator(".game-table")).toHaveAttribute("data-presentation-status", "idle");

  await page.getByRole("button", { name: "CONQUEST", exact: true }).click();
  await page.waitForTimeout(250);
  expect(await page.screenshot()).toMatchSnapshot("table-conquest-travel.png", { maxDiffPixelRatio: 0.02, threshold: 0.3 });
});

test("ordinary movement and legacy rituals use semantic full-motion sequences", async ({ page }) => {
  test.setTimeout(120_000);
  const capture = async (button: string, delay: number, screenshot: string) => {
    await page.goto("/?table-demo=1&fixture=marks");
    await expectHealthyTable(page);
    await page.getByRole("button", { name: button, exact: true }).click();
    await page.waitForTimeout(delay);
    const image = await page.screenshot();
    expect(image).toMatchSnapshot(screenshot, { maxDiffPixelRatio: 0.02, threshold: 0.3 });
  };

  await capture("RECRUIT", 180, "table-recruit-placement.png");
  await capture("MANEUVER", 520, "table-maneuver-travel.png");
  await capture("ATTACKER LOSS", 1_160, "table-battle-attacker-loss.png");
  await capture("DEFENDER LOSS", 1_160, "table-battle-defender-loss.png");
  await capture("BATTLE", 1_160, "table-battle-mixed-loss.png");
  await capture("MISSILE", 410, "table-missile-modifier.png");
  await capture("NUCLEAR", 420, "table-nuclear-resolution.png");
  await capture("MODULE", 420, "table-module-reveal.png");
  await capture("VICTORY", 520, "table-victory.png");
  await capture("SIGNING", 160, "table-signing.png");
});

test("reduced motion preserves changes without camera travel", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/?table-demo=1");
  await expectHealthyTable(page);
  await page.getByRole("button", { name: "SCAR", exact: true }).click();
  await page.waitForTimeout(180);
  await expect(page.getByRole("button", { name: "SKIP" })).toBeHidden();
  await expect(page).toHaveScreenshot("table-reduced-motion.png");
  await context.close();
});

test("phone portrait keeps the table and decisions usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?table-demo=1");
  await expectHealthyTable(page);
  await expect(page.getByRole("button", { name: "BATTLE" })).toBeVisible();
  await expect(page).toHaveScreenshot("table-phone-portrait.png");
});

test("tablet portrait keeps authored territory alignment", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/?table-demo=1&players=5&fixture=marks");
  await expectHealthyTable(page);
  await expect(page).toHaveScreenshot("table-tablet-portrait.png");
});

test("real local campaign enters the production Pixi table", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /NEW CAMPAIGN/ }).click();
  await page.getByLabel("World name").fill("E2E World");
  await page.getByRole("button", { name: "START GAME" }).click();
  await expectHealthyTable(page);
  await expect(page.getByText(/Choose a faction/i)).toBeVisible();
});
