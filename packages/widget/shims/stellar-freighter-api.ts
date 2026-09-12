/**
 * Real interop shim for `@stellar/freighter-api`, used ONLY by this package's own test config
 * (see vitest.config.ts's `resolve.alias` + `server.deps.inline` — BOTH are required: Vitest
 * externalizes node_modules packages by default, which hands them to Node's native loader and
 * bypasses Vite's resolver/alias entirely; `inline` is what makes the alias apply at all) — NOT
 * part of the published widget bundle (tsup leaves the real dependency external for the
 * integrator's own bundler; see this file's sibling doc note in vitest.config.ts for why that's a
 * genuine, real integration risk this phase discovered, not just a test-tooling quirk).
 *
 * The real, published `@stellar/freighter-api@6.0.0` package ships only a single webpack-bundled
 * CJS file (`build/index.min.js`, confirmed by reading its actual package.json — no `exports` map,
 * no ESM build). `@creit.tech/stellar-wallets-kit`'s real `FreighterModule` source does a static
 * named import from it (`import { getAddress, ... } from "@stellar/freighter-api"`). Vite/Vitest's
 * dev-time module transform fails to statically synthesize those named ESM bindings from this
 * particular CJS bundle's export shape (confirmed via a real, reproduced
 * `SyntaxError: The requested module '@stellar/freighter-api' does not provide an export named
 * 'getAddress'`), even though a plain Node `require()` of the same file genuinely has all of them
 * (confirmed directly). This shim uses `createRequire` to load the real CJS module and re-exports
 * its real, already-verified-present named members explicitly — it does not reimplement or mock
 * any Freighter behavior, it only fixes how the real module's exports are surfaced to Vite/Vitest.
 */
import { createRequire } from "node:module";

import type * as FreighterApi from "@stellar/freighter-api";

const require = createRequire(import.meta.url);
const real = require("@stellar/freighter-api") as typeof FreighterApi;

export const {
  WatchWalletChanges,
  addToken,
  getAddress,
  getNetwork,
  getNetworkDetails,
  isAllowed,
  isBrowser,
  isConnected,
  requestAccess,
  setAllowed,
  signAuthEntry,
  signMessage,
  signTransaction,
} = real;

export default real.default;
