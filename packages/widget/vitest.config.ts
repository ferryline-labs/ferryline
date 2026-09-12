import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // @stellar/freighter-api ships only a single webpack-bundled CJS file (no `exports` map, no
      // ESM build — confirmed by reading its real package.json). @creit.tech/stellar-wallets-kit's
      // real FreighterModule does a static named import from it, and Vitest's dev-time module
      // transform fails to statically synthesize named ESM bindings from this particular CJS
      // bundle's export shape (a real, reproduced
      // "does not provide an export named 'getAddress'" — confirmed those exports genuinely exist
      // via a plain `require()` of the same file). This alias points the bare specifier at a real
      // interop shim (shims/stellar-freighter-api.ts) instead of a mock — see that file's own doc
      // comment for the full mechanism and for why this is a real integration risk this phase
      // discovered for any widget consumer's own bundler, not just a test-tooling quirk.
      "@stellar/freighter-api": fileURLToPath(
        new URL("./shims/stellar-freighter-api.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    server: {
      deps: {
        // By default Vitest externalizes node_modules packages (handled by Node's own
        // import/require, bypassing Vite's resolver — including the alias above). The failing
        // import happens INSIDE @creit.tech/stellar-wallets-kit's own pre-built .js file, which is
        // itself externalized by default — so its own `import ... from "@stellar/freighter-api"`
        // is resolved by Node's native loader, never reaching Vite's resolver/alias at all
        // (confirmed directly: the alias shim never loaded until this was added). Both packages
        // must be inlined for the alias to actually intercept the freighter-api import.
        inline: [/@stellar\/freighter-api/, /@creit\.tech\/stellar-wallets-kit/],
      },
    },
  },
});
