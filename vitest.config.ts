import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" }, // new (TEST-web): React 17+ JSX runtime for .test.tsx files
  test: { include: ["packages/**/*.test.ts", "apps/server/src/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"] }, // new: web tests included
});
