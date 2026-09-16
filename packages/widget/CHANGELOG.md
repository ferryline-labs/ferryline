# Changelog

All notable changes to `@ferryline/widget` are documented in this file. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## 0.1.4 (2026-09-16)

### Added

- **A visual "still working" signal during the `tracking` phase**: an indeterminate spinner plus a
  live, ticking elapsed-time counter (`(12s)`, `(1m 05s)`) next to the status text. Closes a real
  gap: `track()`'s own polling loop only yields a new status when Circle's attestation service or
  the destination chain actually changes state, real, observed gaps between updates have run into
  multiple minutes, and without an independent visual signal a user watching this phase had no way
  to tell "still working" apart from "stuck." New `::part()` selectors: `tracking-progress`,
  `spinner`, `tracking-elapsed`. Respects `prefers-reduced-motion` (the spinner's rotation stops;
  the elapsed-time text still updates).

  Two real bugs found and fixed via live browser testing before this shipped, not caught by the
  unit test suite (jsdom doesn't render real CSS the way an actual browser does): a CSS-var
  fallback for the spinner's color that never actually triggered, and the real, load-bearing one,
  Tailwind's `border-*` utilities depend on an `@property` registration that does not take effect
  inside a dynamically-injected shadow-root `<style>` tag (the exact same limitation this file's
  own `button:focus-visible` rule had already hit once before for `outline-style`). The spinner's
  ring never rendered at all until switched to plain, literal CSS. Both fixed the same way that
  earlier case was.

## 0.1.3 (2026-09-16)

### Fixed

- **`0.1.2` was published with a stale `dist/`.** The `pollPrepareStep` fix documented below was
  genuinely merged to `main` and pulled locally before publishing, but the publisher's own
  `dist/index.js` on disk still predated that pull — last built before the merge, never rebuilt
  after — and `pnpm run publish:widget` packed whatever was on disk without checking it was
  current. Confirmed directly: the real `0.1.2` tarball on npm still contained the old,
  already-proven-broken `POST_APPROVE_BUILD_DELAY_MS` fixed timer, not the fix the version bump
  claimed to ship. Found via a real outside-the-monorepo install and a direct `grep` of the
  installed `dist/index.js`, the same verification step every publish in this project is supposed
  to get, this time catching a real miss.

  **Root cause, broader than just this package:** neither `@ferryline/core` nor `@ferryline/sdk`
  had ever guarded against this either — their own `prepack` scripts
  (`scripts/prepare-publish.mjs`) only strip non-shippable script names from the manifest before
  packing, they never touch `dist/` at all. Every prior successful publish across all three
  packages worked only because `dist/` happened to already be fresh by luck or discipline, never
  because of a real guardrail. This is a structural gap, not a one-off mistake.

  **Fixed at the root**, in the one shared script every publishable package's `prepublishOnly`
  already runs (`scripts/assert-pnpm-publish.mjs`): after confirming the invoking tool is really
  `pnpm` (the original `0.1.2`-class fix), it now also runs the package's own real `build` script
  before pnpm packs anything. A failing rebuild refuses the publish outright rather than shipping
  stale-or-broken output. This closes the gap for `core` and `sdk` too, not just the widget.
  Verified directly: deliberately staled `dist/index.js` with a marker string, ran the gate under a
  simulated `pnpm` invocation, confirmed the marker was gone and the real fix was present
  afterward; separately, deliberately broke the build with a real syntax error and confirmed the
  gate refuses to publish (exit code 1) rather than packing broken output.

  **`0.1.2` is not marked as completely broken** the way `@ferryline/sdk@0.1.2` was: the package
  still installs and imports correctly, and does carry the real `0.1.1` ESM-interop fix — it is
  specifically missing the `pollPrepareStep` fix below, silently running the old fixed-timer
  mechanism instead. If you installed `0.1.2` and rely on the outbound CCTP two-step flow,
  upgrade to `0.1.3`.

## 0.1.2 (2026-09-16)

### Fixed

- **`POST_APPROVE_BUILD_DELAY_MS`, the fixed-timer wait shipped in `0.1.0`/`0.1.1` before building
  the deferred CCTP burn step, was replaced with a real, poll-based mechanism.** An external,
  independent integration test (built with zero access to this repo's internals, public npm
  packages and public docs only) found and reproduced a real, repeatable bug: the two-step CCTP
  flow (approve, then deferred burn) failed with `tx_bad_seq` 100% of the time on a genuinely fresh
  testnet account, using the widget's shipped default `POST_APPROVE_BUILD_DELAY_MS` (15 seconds).
  Reproduced twice, independently, before being reported.

  **Root-caused, not just patched.** The 15-second default was a real, honestly-caveated live
  measurement (comparing `getLatestLedger` on the public testnet RPC against Horizon at one moment,
  finding ~10-12s of lag), not a guess — but it had never been live-validated against a real,
  two-step testnet transfer before shipping. Its own introducing commit (`1b741de`, 2026-09-14)
  said so outright: *"this fix has NOT yet been validated against a real live testnet re-run...
  whether the real rejection rate actually drops is still to be confirmed."* That validation never
  happened before `0.1.0`'s publish. This project's own one real, publicly-cited two-step reference
  transaction (`c7463fbd...`, cited in `apps/docs/content/docs/bridge-walkthrough.mdx`) took a real
  180 real-world seconds between the approve confirming and the burn landing, 12x longer than the
  shipped 15-second default — but that transaction predates the fixed-delay mechanism entirely by
  two days and was never protected by it; it was protected by a *different* mechanism
  (`waitForStellarConfirmation`, polling for the approve's own ledger confirmation before returning
  control at all). No experiment in this repo's real transaction history had ever exercised the
  fixed-delay code path against a real network before this incident.

  **The fix:** `pollPrepareStep` (new, `client.ts`) retries `prepareStep` itself, on the one
  specific, real, typed error it throws exactly when the chain state it needs isn't there yet —
  `FerrylineError` with `code: "ALLOWANCE_INSUFFICIENT"` (documented directly on
  `RailAdapter.prepareStep`'s own interface in `@ferryline/core`). Every other failure, including a
  genuine `STEP_NOT_READY` (a real caller bug, not a timing issue), is rethrown immediately, on the
  first attempt, never retried. This polls for the actual, specific condition that must be true,
  not a fixed amount of time that might or might not be enough.

  **Live-validated against real testnet transfers before publishing** — not a unit test, not a
  mock, the same discipline every other real fix in this project holds to. Two independent runs, on
  two independent, genuinely fresh testnet accounts (zero prior TokenMessengerMinter allowance,
  matching the external report's own reproduction conditions exactly): one exercising the poll's
  zero-retry fast path (approve `3aa27e49941e6c9adbbfbcdd4d9601894a678bca71404fb588790e5310057537`,
  burn `3b09902262033ba210d7e2f9d1f37ca8c8bf41a0ce39d965ac6ad496c9e0a664`, both independently
  confirmed successful via Horizon), one exercising its real, multi-retry recovery path (approve
  `b1b28aa509192e32f73a3bfe5de066ef5a5495db0d63def8fd7d68e8a5a4ee96`, burn
  `4d8502400fcac6fee2402d2c38c65702a1e8c90f020b5e69d5fd22beadff846d`, 2 real
  `ALLOWANCE_INSUFFICIENT` retries over 5804ms, also independently confirmed successful). See
  [`packages/core/verified/experiments/2026-09-16-widget-poll-prepare-step-live.md`](../core/verified/experiments/2026-09-16-widget-poll-prepare-step-live.md)
  for the full, real, dated report, including an honest correction of a real scripting bug in the
  first run's own on-chain check (not a bug in the fix itself).

  **Not yet covered by this live validation:** the actual `<ferryline-widget>` custom element's own
  UI wiring of this mechanism (as opposed to the underlying `pollPrepareStep` function itself,
  which is what the live runs above exercise directly) still needs a real, human-driven browser +
  Freighter session to fully validate end to end, the same real constraint every prior widget e2e
  proof in this project has had (see `packages/widget/e2e/README.md`), since Freighter's real
  approve/sign click has no stable, documented automation surface. Unit-tested thoroughly
  (`index.test.ts`) in the meantime.

  **New, real, public widget configuration:** `prepare-step-poll-max-attempts` (default `20`) and
  `prepare-step-poll-interval-ms` (default `1500`) attributes/properties — unlike the old
  `POST_APPROVE_BUILD_DELAY_MS`, which was deliberately never exposed, an integrator whose own RPC
  node has worse allowance-visibility lag than this project's own testing observed can now raise
  either value without waiting on a new widget release. See
  [the Widget reference](https://github.com/ferryline-labs/ferryline/blob/main/apps/docs/content/docs/widget.mdx#polling-before-the-deferred-burn-step)
  for the full documentation.

  **`0.1.0` and `0.1.1` are not marked broken** the way `@ferryline/sdk@0.1.2` was: a real bundler
  (verified directly with `esbuild --bundle`) resolves this fine, since bundlers do CJS/ESM interop
  dynamically, so most real consumers were likely unaffected by the `0.1.1` ESM interop bug (see
  that entry below), and this timing bug is a real, meaningful reliability issue but not a
  from-scratch break for every install the way `sdk@0.1.2` was. Still, if you've hit `tx_bad_seq` on
  the outbound CCTP flow with a fresh testnet account on `0.1.0`/`0.1.1`, upgrade to `0.1.2`.

## 0.1.1 (2026-09-15)

### Fixed

- **`0.1.0` broke for any consumer using a plain Node ESM `import` outside a bundler.** Root cause:
  `@creit.tech/stellar-wallets-kit` (a real widget dependency) does a static named ESM import from
  `@stellar/freighter-api`, which ships only a single webpack-bundled CJS file — no `exports` map,
  no ESM build of its own (confirmed by reading its real, published `package.json`). Node's ESM
  loader uses static analysis to detect named exports from a CJS module, and that analysis fails
  for this particular bundle's shape, even though the exports genuinely exist (confirmed directly:
  a plain `require()` of the same file works fine). `0.1.0`'s build (`tsup.config.ts`) left
  `stellar-wallets-kit` external, the default for a real dependency, so this reached real consumers
  unfixed: `import('@ferryline/widget')` failed with `The requested module '@stellar/freighter-api'
  does not provide an export named 'getAddress'`.

  **This was already found and predicted** by an earlier phase of this project, before the widget
  had ever actually been published — see `vitest.config.ts` and `shims/stellar-freighter-api.ts`,
  which shimmed this exact issue for this package's own test suite only, with an explicit note
  flagging it as "a genuine, real integration risk... not just a test-tooling quirk." It went live
  the moment `0.1.0` became the widget's first real publish, since the 49 passing tests run against
  the shim, never the real unshimmed import path.

  **Real scope, checked directly rather than assumed:** a plain Node `import()`/`import` in
  isolation (Node scripts, non-bundled SSR, some test runners) failed. A real bundler-based consumer
  — confirmed directly with `esbuild --bundle`, which resolves CJS/ESM interop dynamically rather
  than via Node's static analysis — bundled `0.1.0` cleanly with no error, real `getAddress`
  references present in the output. Most real widget consumers (any app bundling it with webpack,
  Vite, Rollup, or esbuild) were very likely unaffected; the bug was real but narrower than a
  from-scratch break for every install, unlike the unrelated `@ferryline/sdk@0.1.2` npm-packaging
  incident (see [`/PUBLISHING.md`](https://github.com/ferryline-labs/ferryline/blob/main/PUBLISHING.md)).

  **Fixed by inlining `@creit.tech/stellar-wallets-kit` into the widget's own built bundle**
  (`tsup.config.ts`'s `noExternal`), resolving the CJS/ESM interop at build time so it never reaches
  a consumer's own runtime or bundler at all, regardless of their tooling. Verified directly: a real
  cold install + `import()` outside the monorepo, with a real DOM present (this widget is a
  `HTMLElement` subclass and genuinely requires one, unrelated to this fix), now succeeds and
  exports the full expected public API (`FerrylineWidget`, `STAGE_LABELS`, `WIDGET_TAG`,
  `defineFerrylineWidget`, `isTerminal`). Tradeoff, disclosed rather than glossed over:
  `dist/index.js` grew from 52.53 KB to 804.26 KB, since it now inlines `stellar-wallets-kit`'s own
  full dependency tree (every wallet module it supports: Freighter, xBull, Albedo, WalletConnect,
  Trezor, and others), not just the parts this widget actually exercises. 49 widget tests still
  pass unchanged.

  **If you installed `@ferryline/widget@0.1.0` and consume it via a bundler, it likely already
  worked and this is a safe, low-risk upgrade. If you consume it via a plain Node `import` outside
  a bundler, `0.1.0` did not work at all — upgrade to `0.1.1`.**

## 0.1.0 (2026-09-15)

First published release. `<ferryline-widget>`: a framework-agnostic custom element wiring the SDK,
a real Stellar Wallets Kit session, and a transaction preview into one drop-in UI. See
[README.md](README.md) for the full feature set and
[packages/core/verified/experiments/2026-09-12-widget-e2e-real-browser-wallet.md](../core/verified/experiments/2026-09-12-widget-e2e-real-browser-wallet.md)
for real end-to-end proof (real Freighter signature, real broadcast, real destination-chain
delivery) recorded before this release.
