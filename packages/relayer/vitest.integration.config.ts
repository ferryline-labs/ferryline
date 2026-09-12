import { defineConfig } from "vitest/config";

// Postgres-backed tests: need a live Docker daemon (testcontainers spins up ephemeral Postgres
// containers). Run explicitly with `pnpm test:integration`, not part of the default `pnpm test`
// so CI and local runs without Docker are not blocked.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
