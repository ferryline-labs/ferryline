# Changelog

All notable changes to `@ferryline/widget` are documented in this file. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

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
