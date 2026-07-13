import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  testIgnore: "**/*.soak.spec.ts",
  timeout: 30_000,
  expect: { timeout: 8_000, toHaveScreenshot: { maxDiffPixelRatio: 0.025, animations: "disabled" } },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      launchOptions: { args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] },
    } },
  ],
  webServer: {
    command: "npm run dev -w @risk/web -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
