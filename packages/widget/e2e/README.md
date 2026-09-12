# Widget E2E: real browser wallet, real testnet transfer

This is the "at least one real, manual, end-to-end run against a real browser wallet extension on
testnet, documented with a real transaction hash" requirement for the widget phase. It is
**semi-scripted, not fully automated** — see "What's actually scripted vs. manual" below for the
honest breakdown, and why.

## What this proves

The full real pipeline, driven through the actual `<ferryline-widget>` element (not a standalone
script like the earlier seam-proof experiments): quote → build → decode-and-render a real
transaction preview → connect a real installed Freighter extension → sign with it → submit → wait
for real Stellar ledger confirmation → advance to the next deferred step (approve → burn) → track
through Iris attestation.

## Setup

1. **Build the widget's dependency chain** (from the repo root): `pnpm install`.
2. **Get a real Freighter extension build.** Download the latest release zip from
   `https://api.github.com/repos/stellar/freighter/releases/latest` and unpack it somewhere (this
   run used `/tmp/freighter-ext/unpacked` — not committed to the repo; it's a real, official,
   pre-built Chrome extension, not something this repo can vendor cleanly without re-verifying each
   release).
3. **Set up a real testnet account in real Chrome, not Playwright's bundled Chromium.** This
   matters: Freighter's encrypted vault, set up manually in an actual installed Chrome browser, is
   not portable to Playwright's bundled Chromium binary even when pointed at the same
   `--user-data-dir` — confirmed directly (the `grant-access` popup showed onboarding instead of an
   unlock/connect prompt against the bundled binary). Launch real Chrome against a fresh profile
   directory with the extension loaded:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --user-data-dir=/tmp/freighter-profile-explore \
     --disable-extensions-except=/tmp/freighter-ext/unpacked \
     --load-extension=/tmp/freighter-ext/unpacked
   ```
   Open the Freighter extension, choose **"I already have a wallet"**, and import a real testnet
   account's secret key (this run used a funded account with real testnet XLM and a USDC
   trustline — fund yours via the widget's own testnet faucet links, or `stellar keys secret` for an
   existing CLI identity).
4. **Serve the widget's real source** (not the built `dist/`, so no rebuild step is needed between
   edits) via Vite: from `packages/widget`, run `npx vite --config e2e/vite.config.ts`. This serves
   `e2e/index.html` + `e2e/harness.ts` at `http://localhost:4173/`, with real module resolution for
   the widget's external dependencies (`@creit.tech/stellar-wallets-kit`, `viem`,
   `@stellar/stellar-sdk`, `@ferryline/sdk`) — the published `dist/index.js` leaves these as bare
   external imports for an integrator's own bundler to resolve (see `src/client.ts`'s own doc
   comment), so a real browser page needs a real dev server/bundler in front of it, not a hand-built
   import map.
5. Point that same real Chrome window (with Freighter already unlocked) at
   `http://localhost:4173/`.

## Driving the flow

`e2e/harness.ts` defines the real element and exposes one test hook,
`window.__ferrylineTestHooks.setRequest()`, which sets a real `TransferRequest` (0.5 USDC,
Stellar testnet → `ethereum-sepolia`, matching the same request shape STEP 1's own proven outbound
seam script used).

Run `node e2e/run.mjs` (from `packages/widget`, with the Vite dev server already running) to
script the quote/build/preview/connect portion automatically — it opens the real Freighter
approval popup and then hands off, printing exactly what to click next. Or drive the same steps by
hand from the browser console:

```js
window.__ferrylineTestHooks.setRequest();
```

Then, in the widget's own UI:

1. Wait for the real quote (send/receive amounts, ETA).
2. Click **Build transaction** — renders a real decoded preview (contract id + function name for
   the first step, which for a fresh account is `approve` on the USDC SAC, before the actual burn).
3. Click the **Freighter** wallet-module button, approve the real connection-access popup.
4. Click **Confirm and sign**, approve the real signature prompt in Freighter.
5. Wait — the widget polls for real ledger confirmation before preparing the next deferred step
   (this can take up to ~60s; the UI still says "Waiting for your wallet…" for this whole window,
   which is honestly a minor UX gap — the wallet has already responded, the wait is for the network,
   not the wallet — noted but not fixed this phase since it's cosmetic, not a defect in the flow
   itself).
6. Once the approve confirms, the widget automatically prepares and previews the burn step —
   confirm and sign that one too.
7. Tracking begins: `submitted` → `verified` (once Circle's Iris attestation completes) →
   `delivered` (once the destination `MessageTransmitterV2` shows the nonce consumed) or `failed`.

## If tracking sits at "verified, delivering" and never reaches "delivered"

A real finding from this phase's own run: on testnet, nothing may automatically submit the
attested CCTP message to the destination chain's `MessageTransmitterV2.receiveMessage`. `track()`
only _observes_ whether the nonce has been consumed — it never submits that call itself, and
that's correct (see the phase report's own note on why building an automatic outbound relay is out
of this phase's scope). If Circle's testnet auto-relay doesn't pick a message up, delivery can
stall indefinitely even though everything up to that point (signature, broadcast, attestation) is
completely real and correct.

`e2e/submit-receive-message.mjs` completes delivery manually, using CCTP's own permissionless
design (anyone can submit an already-attested message and pay its gas):

```bash
GAS_ACCOUNT_PRIVATE_KEY=0x... node e2e/submit-receive-message.mjs <sourceTxHash>
```

Needs a real Sepolia-ETH-funded EVM account (a few cents of gas; a public faucet like Google
Cloud's Web3 Sepolia faucet works and, unlike some others, doesn't gate on holding mainnet ETH).
It re-fetches the real message/attestation from Iris by the source transaction hash and submits
`receiveMessage` directly — see the phase report for the real transaction hash this produced and
independent before/after verification (nonce consumption + recipient balance delta).

## What's actually scripted vs. manual

- **Scripted and reusable:** the Vite dev server (`e2e/vite.config.ts`), the host page and test hook
  (`e2e/harness.ts`, `e2e/index.html`), and Playwright launching the real Freighter extension into a
  real Chrome profile and confirming it loads with a genuine extension ID (see the phase report for
  the exact commands).
- **Manual, by design:** the initial Freighter wallet setup (importing a secret key, setting a
  password) — Freighter's own onboarding has no documented automation-friendly API for this, and
  scripting past a real password/seed-phrase UI is exactly the kind of brittle, security-adjacent
  automation not worth building for a lower-ceremony phase like this one. Once set up, the _unlocked_
  session is real Chrome state, reusable across runs from the same profile directory.
- **Driven step-by-step in the browser** (clicking through quote → build → preview → connect →
  sign) for this run, rather than a single unattended Playwright script — a fully automated version
  (scripting the button clicks via Playwright against the real Chrome channel, now that the
  Chromium-vs-Chrome profile-portability issue is understood) is a reasonable next iteration but was
  not required by this phase's bar ("a real run... has actually happened once for real, not just
  been asserted to work") and wasn't built to keep this phase's ceremony proportionate to its stated
  risk level.

## Real evidence from the run that produced this file

See the repo's own phase report for the exact real transaction hashes, the real account address
used, and independent verification via Horizon / Circle's Iris API / Ethereum Sepolia RPC.
