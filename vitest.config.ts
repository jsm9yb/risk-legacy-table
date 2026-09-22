import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { include: ["packages/**/*.test.ts", "apps/server/src/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"] },
});
