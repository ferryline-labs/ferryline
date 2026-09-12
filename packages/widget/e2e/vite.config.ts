import { defineConfig } from "vite";

/**
 * Dev server for the real E2E test host page. Serves e2e/index.html with real module resolution
 * for the widget's real dependencies (@creit.tech/stellar-wallets-kit, viem, @stellar/stellar-sdk,
 * @ferryline/core, @ferryline/sdk) — the built dist/index.js leaves all of these as external bare
 * imports (see client.ts's own doc comment on why: an integrator's own bundler is expected to
 * resolve them), so a real browser page needs a real bundler/dev-server in front of it, not a
 * hand-rolled import map. Same freighter-api CJS-interop fix as vitest.config.ts, for the same
 * real reason (see that file's own doc comment).
 */
export default defineConfig({
  root: import.meta.dirname,
  server: {
    port: 4173,
    strictPort: true,
  },
});
