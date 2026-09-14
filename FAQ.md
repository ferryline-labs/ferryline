# Frequently anticipated questions

Answers grounded in this repo's own current, real state, not aspirational claims. Where something
has a dated source (a verified-facts file, a real transaction hash), it's cited so you can check it
yourself rather than take this file's word for it. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup
and where help is needed.

## Is this production-ready?

No. Pre-alpha, nothing is deployed to mainnet, and no third-party security audit has happened yet
(an SDF Audit Bank engagement is planned but hasn't started, see
[contracts/router/SCOPE.md](contracts/router/SCOPE.md)). Everything real that's been verified so
far, real transactions, real test coverage, is against Stellar testnet, Ethereum Sepolia, and, for
a handful of read-only observations, real mainnet data collected without moving funds. See
[README.md](README.md)'s own status line and [ARCHITECTURE.md](ARCHITECTURE.md)'s deployment-status
section for exactly what's real versus what's still ahead.

## Can I use USDT0 on testnet?

No, and this isn't a gap in the SDK, it's a fact about the upstream protocol: USDT0 has no Stellar
testnet deployment at all, confirmed directly against LayerZero's own metadata API. The SDK's
`Usdt0LayerZeroAdapter` constructor option type is literally `{ network: "mainnet" }`, not a
`"testnet" | "mainnet"` union, so constructing it for testnet is a compile-time error, not a
runtime check you could accidentally bypass. If you need to test an integration end to end, use the
`usdc-cctp` rail, it's the only one with a real testnet deployment today.

## Does requesting Fast Transfer on a CCTP burn from Stellar actually work?

**No, and this is now confirmed with real, first-party burns, not just a docs quote.** Circle's own
capability table lists Stellar as a source chain with Fast Transfer marked "N/A," but what a real
burn actually does with `minFinalityThreshold: 1000` wasn't documented anywhere obvious. Two real
testnet burns settled it: a burn with `minFinalityThreshold: 1000` requested is accepted on-chain
with no error, but Circle's own attestation reports `finalityThresholdExecuted: "2000"`, silently
re-executed as Standard, not rejected and not honored as Fast. A second burn requesting `2000`
executed at `2000` as expected, confirming this wasn't a fluke of the first transaction. See
[packages/core/verified/experiments/2026-09-12-cctp-finality-threshold.md](packages/core/verified/experiments/2026-09-12-cctp-finality-threshold.md)
for the real transaction hashes and full attestation data, and
[packages/core/VERIFIED.md](packages/core/VERIFIED.md)'s §5 revision history for the complete
account. This finding is also written up as its own section in
[contracts/router/EXTERNAL_REPORT_DRAFT.md](contracts/router/EXTERNAL_REPORT_DRAFT.md), alongside
two related Soroban authorization findings, pending a decision on where to post it publicly.

## Does the SDK ship a default for `maxFee` or `minFinalityThreshold`?

No, and this was a deliberate decision, confirmed by real testing to still be the right one, not
just an unresolved TODO. Both burns above used `maxFee: "0"`, and a separate real, first-party burn
independently confirmed `max_fee = 0` is genuinely accepted end to end (real on-chain success, real
Circle attestation with `feeExecuted: "0"`, see
[packages/core/verified/experiments/2026-09-12-cctp-burn-max-fee-zero.md](packages/core/verified/experiments/2026-09-12-cctp-burn-max-fee-zero.md)).
But confirming one value works in the case tested doesn't make it universally correct (a larger
transfer, or a period where Circle's minimum fee is genuinely nonzero, needs the caller to decide
for themselves), and the finality-threshold finding above is itself a reason to keep the parameter
required: since Circle can silently reinterpret `1000`, a caller who explicitly states their intent
has an honest, auditable record of what they actually asked for. The SDK throws
`PARAMETER_REQUIRED` if either is missing from a `usdc-cctp` request, on purpose.

## Why does outbound CCTP tracking sometimes still say "verified, delivering" and sit there?

Because that can still be real, though it's now the exception rather than the default. If you
(or the widget you're using) configured a Ferryline relayer (`relayer-url`), outbound transfers
register with it automatically once the burn confirms, and it's a real, testnet-proven,
self-hostable service (`packages/relayer/`) that submits the completing `receiveMessage` call for
you. If no relayer is configured, or the configured one is unavailable/misconfigured/has hit its
own daily spend ceiling, this reverts to the original situation: Circle's own infrastructure does
not submit `receiveMessage` automatically, on testnet or mainnet, confirmed directly against
Circle's own technical guide, and `receiveMessage` is permissionless by CCTP's own design — anyone,
including the sender or recipient, can submit it and pay its small gas cost. Even with a relayer
configured, this is not a guaranteed delivery-time SLA — see
[packages/relayer/OUTBOUND_THREAT_MODEL.md](packages/relayer/OUTBOUND_THREAT_MODEL.md) for the full
design/risk write-up. See
[packages/core/verified/experiments/2026-09-12-widget-e2e-real-browser-wallet.md](packages/core/verified/experiments/2026-09-12-widget-e2e-real-browser-wallet.md)
for the original finding (before the relayer existed) and `packages/widget/e2e/submit-receive-message.mjs`
for a real, working example of completing delivery manually, which still works exactly the same way
regardless of whether a relayer is configured.

## Can inbound USDT0 be delivered to a smart-account (C-address) recipient?

Unknown, genuinely, this is one of the project's real, currently open questions, not answered
either way yet. The SDK refuses this today (`UNSUPPORTED_RECIPIENT_KIND`) rather than assume it
works, because whether LayerZero's OFT can deliver correctly to a Soroban smart-account recipient
hasn't been tested. It needs a funded mainnet operator and a real Stellar smart account to target,
see
[packages/core/verified/experiments/2026-09-11-inbound-usdt0-c-address.md](packages/core/verified/experiments/2026-09-11-inbound-usdt0-c-address.md)
for exactly what's needed to answer it for real.

## Is the router contract deployed to mainnet?

No. Every router contract address in this repo is testnet, each tied to a specific fix (see
[contracts/router/TESTNET_DEPLOYMENT.md](contracts/router/TESTNET_DEPLOYMENT.md) for the full,
dated history across several redeployments). A mainnet deployment depends on the SDF Audit Bank
engagement mentioned above, which hasn't started.

## What real bugs has this project actually found and fixed?

More than a few, and all of them are written up in detail rather than quietly patched:

- Two distinct, real Soroban authorization surprises on the router: a `require_auth`-covered
  argument computed from live ledger state that drifted between simulate-time signing and
  apply-time execution, and a same-address `require_auth()` loop that never produced the N
  independent authorizations it looked like it did. Both root-caused against
  `soroban-env-host`'s own source, both fixed, both mutation-tested. Full technical write-up in
  [contracts/router/EXTERNAL_REPORT_DRAFT.md](contracts/router/EXTERNAL_REPORT_DRAFT.md).
- A memo-based transfer-correlation design (from an earlier phase) that turned out to be
  structurally impossible, Soroban transactions cannot carry a memo at all, confirmed by a real
  testnet RPC rejection, fixed by relying on the transfer store's own already-public API instead.
  See [packages/sdk/CHANGELOG.md](packages/sdk/CHANGELOG.md).
- The CCTP finality-threshold silent-reinterpretation finding described above.

None of these were found by inspection alone, each required a real transaction on a real network to
surface. That's the whole reason this project's testing philosophy leans as hard as it does on real
runs over simulated ones, see [ARCHITECTURE.md](ARCHITECTURE.md)'s testing-strategy section.

## How do I report a security issue?

If you find a real vulnerability (not one of the already-documented, known gaps above), please
don't open a public issue for it, follow whatever responsible-disclosure process the repository's
own security policy describes, or contact the maintainers directly if none exists yet. This project
takes its own "verify, don't assume" standard seriously and would rather hear about a real problem
privately than have it discovered the hard way.
