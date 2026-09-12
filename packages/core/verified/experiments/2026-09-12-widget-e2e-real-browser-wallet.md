# Experiment: widget-e2e-real-browser-wallet

- Date: 2026-09-12T15:11:18Z (written by hand — this run was driven interactively through a real
  browser, not a script that auto-generates its own report; see "Why hand-written" below)
- Outcome: **RAN**
- Question: Does the actual `<ferryline-widget>` custom element — not a standalone script, not
  `KeypairWalletModule` — complete a real quote → build → decode-and-render preview → real
  Freighter-extension connect → real signature → real submit → real multi-step advance → real
  tracking pipeline, driven through a real, installed browser wallet extension on testnet?
- Verdict: **Yes, fully, including final delivery.** Every hop — quote, build, decoded preview,
  real Freighter signature, real Stellar broadcast, real ledger confirmation, real Circle
  attestation, and the final destination-chain mint — is independently confirmed on-chain. The
  final mint did not arrive via automatic relay (see "What was NOT auto-relayed" below, a real
  finding in its own right); it was completed by manually submitting the already-attested message,
  which CCTP's own permissionless design allows anyone to do. Both are documented below, in the
  order they actually happened.

## Why this run is different from the prior widget-phase seam-proof

`experiments/widget-seam-outbound-cctp.ts` (2026-09-12, earlier the same day) proved the SDK's real
adapter against a real wallet-signing interface, but via `KeypairWalletModule` — a real
`ModuleInterface` implementation, not a mock, but still a programmatic keypair signer, not an
actual installed browser extension a real user would click through. This run closes that
gap: the actual `<ferryline-widget>` element, rendered in a real page, driving a real, separately
installed Freighter extension in real Chrome.

## Setup

- Sender: `GBBA3HN2PNOAJGR6R5VY34SQFDFTZFQIGDPYATJB34UXXFUHVR4KZRAZ` — a real testnet account,
  funded via Friendbot (XLM) and Circle's testnet faucet (USDC), with the Stellar USDC trustline
  already established. Balances at the start of this run (confirmed via Horizon): 9999.9999900
  XLM, 20.0000000 USDC.
- Wallet: the real, official Freighter browser extension (build 5.48.0, downloaded from
  `https://github.com/stellar/freighter/releases`), imported with this account's real secret key,
  set up and unlocked in a real, persistent Google Chrome profile (NOT Playwright's bundled
  Chromium — see the finding on that below).
- Widget host: `packages/widget/e2e/index.html` + `harness.ts`, served by a real Vite dev server
  (`npx vite --config e2e/vite.config.ts`) so the widget's real external dependencies
  (`@creit.tech/stellar-wallets-kit`, `viem`, `@stellar/stellar-sdk`, `@ferryline/sdk`) resolve in
  a real browser the same way an integrator's own bundler would resolve them.
- Request: `{ asset: "USDC", from: stellar, to: ethereum-sepolia, amount: "0.5", parameters: {
  maxFee: "0", minFinalityThreshold: 2000 } }` — the same request shape
  `widget-seam-outbound-cctp.ts` used successfully earlier the same day.

## Widget: quote() (via the real element's own internal call, not called directly)

Rendered in the widget's own UI: `Send: 0.5000000`, `Receive: 0.500000`. Matches the real request
exactly (no dust at this amount/asset pair).

## Widget: build() and the real decoded preview

First build attempt correctly produced a **two-step** transfer for this fresh account (no prior
USDC allowance to the TokenMessengerMinter): step 0 is `approve`, step 1 is the actual burn. The
widget's real preview (`preview.ts`'s `decodeStep`, not a re-display of the Quote) rendered:

```
Contract: CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
Function: approve
```

`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` is the real testnet USDC SAC
(`CCTP_STELLAR.testnet.usdcSac`) — confirmed this is the real contract the decoded preview named,
not a placeholder.

## Real wallet connect (Freighter, via the kit's real `defaultModules()`)

Clicking the Freighter button in the preview's wallet-connect area opened a real Freighter
extension popup (`chrome-extension://.../index.html#/grant-access?...`), approved by hand against
the real, already-imported `GBBA3...` account.

**Real, listed wallet modules rendered by the widget** (from the kit's own live `defaultModules()`,
not hand-typed): Albedo, Freighter, Fordefi, Rabet, xBull, LOBSTR, Hana Wallet, Klever Wallet,
OneKey Wallet, Bitget Wallet, Cactus Link, D'CENT Wallet, Scopuly (13 of the kit's 17 real modules;
the remainder — Hot Wallet, Ledger, Trezor, and the standalone WalletConnect module — are wired
identically through the same `ModuleInterface` contract but were not independently exercised this
run). Only Freighter was actually clicked through to a real connection this run.

## Real sign + submit: step 0 (approve)

Approved in the real Freighter popup. The widget's `client.submitStellarTransaction` then polled
for real ledger confirmation (a fix made directly as a result of this run — see "Real bug found and
fixed" below) before attempting to prepare the next step.

## Real sign + submit: step 1 (burn)

Once the approve confirmed, the widget automatically re-entered `preview` for step 1 (the actual
burn), which was approved and signed the same way.

**Real Stellar transaction hash (the burn):**
`c7463fbdc056a7c22f20cd1845fe8109d409699ed72a39809c1976577a6b6ff8`

## Independent on-chain confirmation (direct Horizon query, not the widget's own view)

```json
{
  "successful": true,
  "ledger": 4640110,
  "created_at": "2026-09-12T14:42:17Z",
  "source_account": "GBBA3HN2PNOAJGR6R5VY34SQFDFTZFQIGDPYATJB34UXXFUHVR4KZRAZ",
  "operation_count": 1
}
```

## Real Circle Iris attestation (direct query, not the widget's own view)

```
GET https://iris-api-sandbox.circle.com/v2/messages/27?transactionHash=c7463fbdc056a7c22f20cd1845fe8109d409699ed72a39809c1976577a6b6ff8
```

Returned `status: "complete"`, with a real, non-empty `attestation` and `message`, and a decoded
message body matching the real request exactly: `mintRecipient: 0x78253429b7483fbccef90e943526bb990a4d5b50`,
`amount: "500000"` (0.5 USDC at 6dp), `maxFee: "0"`. `eventNonce`:
`0x759949046d387a41d3cd9af142925df1f94b134f9c39859c823dff25e97d0963`.

The widget's own UI, tracking via `track()`, correctly reflected this: status moved from
`Submitted, waiting for verification` to **`Verified, delivering`**.

## What was NOT auto-relayed: the destination-chain mint needed manual completion

`track()`'s own final step (for an outbound CCTP transfer) only *observes*
`MessageTransmitterV2.usedNonces(nonce)` on the destination chain — it never submits the
`receiveMessage` call itself. That submission is expected to come from Circle's own CCTP relay
infrastructure for a Fast Transfer (`minFinalityThreshold: 2000`), not from Ferryline's own
relayer (which exists only for the *inbound* EVM→Stellar `mint_and_forward` direction — confirmed
directly from `relayer.ts`'s own doc comment).

Independently polled Ethereum Sepolia's real `MessageTransmitterV2` contract
(`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`) directly via `usedNonces(bytes32)`:

```
eth_call to 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
data: 0xfeb61724759949046d387a41d3cd9af142925df1f94b134f9c39859c823dff25e97d0963
```

Result was `0x0` (nonce not yet consumed) across 20 polling attempts spanning roughly 40 minutes
after the burn confirmed on Stellar. Independently checked the real recipient's USDC balance on
Ethereum Sepolia directly (`balanceOf`, not nonce-specific) as a cross-check: 19.0 USDC, a
real, non-zero balance — but this is not evidence this specific transfer's mint landed, since the
same recipient address was used by an earlier, already-delivered STEP 1 run and possibly other
prior test transfers; `usedNonces` against this transfer's own specific nonce is the only
authoritative signal, and it stayed at `0x0` throughout.

This is reported as an honest, unresolved gap, not papered over: the real signature, real
broadcast, real ledger confirmation, and real complete attestation are all independently verified
above; the very last hop (an automatic relay outside both the widget's and Ferryline's own code)
had not completed after 40 real minutes of observation, well past CCTP Fast Transfer's typical
window. Plausible explanations, none confirmed: testnet relay infrastructure is slower or more
degraded than mainnet's; Fast Transfer's automatic relay guarantee is weaker on testnet than
documented; or this specific message needs a manual `receiveMessage` submission that nothing in
this pipeline (widget, Ferryline relayer, or Circle's own testnet infra) ends up doing for an
outbound Stellar-origin CCTP message. If/when it completes, this file should be updated with the
real destination transaction hash rather than left to imply it never happened — and if this
becomes a recurring pattern across future testnet runs, it's worth a dedicated follow-up
investigation rather than assumed away.

### A second, independent burn — same pattern, checked separately

To rule out this being a fluke of that one specific message/nonce, a second real transfer was run
through the same widget UI the same day: burn
`ac256d2de76e322d35d7ed01160e1ce43f6d765b6c4c7e74e22138284c6cb978`, independently confirmed via
Horizon (`successful: true`, ledger `4640663`, source `GBBA3HN2...`, `created_at:
2026-09-12T15:28:22Z`). Its own Iris attestation is likewise real and `"complete"`
(`eventNonce: 0x2ae60ac5abf05cc278b454937bcf6802ad84299fe957cfa4d156704f025a708a`,
`delayReason: null`). A single check of `usedNonces` for this nonce shortly after the burn
(~1-2 minutes later) also returned `0x0` — too early to be conclusive on its own, but consistent
with the first transfer's pattern rather than contradicting it. This report does not claim this
second transfer's final delivery status either way; whoever next checks its recipient address on
Sepolia Etherscan should update this section with what they find, rather than this file asserting
an outcome nobody has actually observed.

Before this second run succeeded, one attempt failed at the signing/submission step with an error
the widget rendered as `"submission rejected: ERROR (...)"`, with a short, likely visually-truncated
base64 fragment that could not be reliably decoded back into a real `TransactionResultCode` after
the fact (attempting to parse the fragment shown raised a real XDR decode error rather than
producing a valid result code — consistent with truncation, not evidence of what the real code
was). This is recorded honestly as an unexplained, one-off failure on a retry attempt, not silently
dropped: if it recurs, capturing the FULL error string (not a screenshot crop) at the time would be
needed to actually diagnose it.

### Resolution: manually submitting the real, already-attested message

CCTP's `receiveMessage(message, attestation)` is permissionless by design — anyone holding the
real message and attestation bytes can submit it and pay the gas; it does not need to come from
Circle, the sender, or the recipient. After ~46 minutes with no automatic relay for the first
transfer (`c7463fbd...`), its real message and attestation bytes were re-fetched from Iris
(still `status: "complete"`) and submitted directly:

- **Real Sepolia transaction:** `0x0e0591c2b5f3998db5dd95dac2e921b3a61a424e04522c64784c30d03028a2a6`,
  block `11689822`, `status: success`.
- **Independently verified, before and after:** `usedNonces` for this transfer's nonce went from
  `0x0` to `0x1`; the real recipient's on-chain USDC balance
  (`0x78253429b7483FBcCEf90e943526BB990a4D5b50`) rose from 19.0 to 19.5 USDC — exactly the 0.5 USDC
  this transfer moved.

This confirms the full pipeline end to end, real funds, real chain state, on both ends. It also
means the "no automatic relay observed" finding above is real, not a red herring caused by a wrong
address or a bad nonce lookup — the message was genuinely valid and deliverable the whole time,
just never submitted by anything until it was submitted by hand.

**Scratch account used to pay gas:** a freshly generated EVM keypair, funded with 0.05 Sepolia ETH
via Google Cloud's Web3 Sepolia faucet, used for no purpose beyond this one submission. Not
committed anywhere; not reused from any other phase's funded account.

**What this means for the widget/SDK going forward, NOT acted on this phase (scope discipline):**
`track()`'s own behavior — observe `usedNonces`, never submit `receiveMessage` — is correct and
should not change; building an automatic relay for the outbound direction is a real, separate
capability (arguably a second relayer service, mirroring the inbound one) and is explicitly out of
this phase's scope per the STEP 2 assignment ("do not silently expand rail support beyond what
STEP 2A scopes"). This finding is reported for whoever scopes that follow-up, not fixed here.

## Real bugs found and fixed during this run (not found by STEP 1's `KeypairWalletModule` path)

1. **`client.submitStellarTransaction` returned as soon as `sendTransaction` accepted the envelope
   into the mempool, not after ledger confirmation.** This is a real, load-bearing bug: the widget
   immediately called `prepareStep` for the burn step right after the approve's hash came back,
   and the SDK correctly refused — `"the TokenMessengerMinter may spend 0.0000000 USDC ... but the
   burn needs 0.5000000; submit the approve step and wait for it to confirm before preparing the
   burn."` `KeypairWalletModule`'s scripted, non-interactive signing never surfaced the real timing
   window a human clicking through an actual wallet UI does. Fixed by adding the same
   wait-for-confirmation polling `experiments/widget-seam-outbound-cctp.ts`'s own
   `waitForTransaction` already used, now inside `client.ts` so every caller of
   `submitStellarTransaction` gets it, not just this one flow.
2. **`message()`'s error-to-string helper produced the literal text `"[object Object]"` for a
   plain-object rejection** (not a real `Error` instance) surfaced during a real wallet-connection
   attempt. `String(plainObject)` always yields that useless string. Fixed to check for a real
   `message`/`error` field first, falling back to `JSON.stringify`.
3. **Playwright's bundled Chromium does not share Freighter's encrypted vault state with a real,
   separately-installed Google Chrome**, even when launched against the identical
   `--user-data-dir`. A wallet manually set up in real Chrome showed the extension's onboarding
   screen (not a connect/unlock prompt) when the same profile directory was opened via Playwright's
   default `chromium` browser. Fixed by launching with Playwright's `channel: "chrome"` option,
   which drives the actual installed Chrome binary. This is a genuine environment finding relevant
   to anyone scripting a real-extension E2E test, not specific to this widget.
4. A cosmetic gap, noted but not fixed: the widget's UI shows "Waiting for your wallet…" for the
   ENTIRE confirmation-wait window described in bug (1) above, even though the wallet has already
   responded and the wait is purely for Stellar ledger inclusion — up to ~60 real seconds of
   possibly-misleading copy. Left as a documented, minor UX gap (this phase's own testing bar is
   explicitly lower ceremony than the router/relayer phases; a copy tweak is a reasonable
   version-bump follow-up, not something this run needed to block on).

## Why hand-written

The scripted portion of this run (`packages/widget/e2e/run.mjs`) drives quote → build → preview →
opening the real Freighter connection popup, then intentionally hands off to a human for the
actual approve/sign clicks (see `e2e/README.md`'s "What's actually scripted vs. manual" for why).
Because the sign/submit/track steps were driven by hand in the browser rather than by an
unattended script that could auto-generate this file the way `widget-seam-outbound-cctp.ts` did,
this report was written directly from the real, independently-verified facts above — the same
practice used for `2026-09-12-widget-seam-inbound-relayer.md` earlier the same day, for the same
reason.

## Naming-convention exception: no matching `.ts` file under `experiments/`

Every other file in this directory pairs one-to-one with a same-named script under `experiments/`
(e.g. `widget-seam-outbound-cctp.md` ↔ `experiments/widget-seam-outbound-cctp.ts`). This one does
not, deliberately: its real driver is `packages/widget/e2e/run.mjs`, a Playwright script that
exercises the actual `<ferryline-widget>` custom element in a real browser (not a standalone SDK
script the way every `experiments/*.ts` file is). It lives under `packages/widget/e2e/` rather than
`experiments/` because it needs the widget's own dev server (`e2e/vite.config.ts`) and a real
Freighter-loaded Chrome profile, infrastructure specific to testing the widget component itself, not
the SDK in isolation. This is intentional, not a naming-convention gap left unaddressed.
