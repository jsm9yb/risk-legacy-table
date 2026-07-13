import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/*.soak.spec.ts",
  timeout: 31 * 60_000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-soak", open: "never" }]],
});
