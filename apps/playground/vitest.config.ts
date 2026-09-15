import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors tsconfig.json's "@/*" path mapping — Next resolves this natively; Vite needs it
      // spelled out.
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Same real fix as packages/widget/vitest.config.ts's own alias, reused rather than
      // reinvented: this app imports @ferryline/widget (for WidgetEmbed), which transitively
      // imports wallet.ts -> @creit.tech/stellar-wallets-kit -> @stellar/freighter-api, hitting
      // the identical real CJS/ESM interop bug that shim exists for — see that package's own
      // vitest.config.ts and shims/stellar-freighter-api.ts for the full, already-documented
      // mechanism and why it's a real bundler risk, not just a test-tooling quirk.
      "@stellar/freighter-api": fileURLToPath(
        new URL("../../packages/widget/shims/stellar-freighter-api.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    server: {
      deps: {
        // Same reason as packages/widget's own config: both packages must be inlined for the
        // alias above to actually intercept the import, since Vitest externalizes node_modules
        // packages by default (bypassing Vite's resolver/alias) unless told otherwise.
        inline: [/@stellar\/freighter-api/, /@creit\.tech\/stellar-wallets-kit/],
      },
    },
  },
});
