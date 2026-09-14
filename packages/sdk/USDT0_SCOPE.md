# Ferryline USDT0-over-LayerZero rail (Stellar ↔ EVM) — scope

**STATUS: the rail itself is already implemented and, for outbound only, testnet-proven —
mainnet-proven, since USDT0 has no Stellar testnet deployment — with two real first-party
transactions plus one real third-party transaction independently decoded.** This document is new,
written alongside `USDT0_THREAT_MODEL.md` as a design-review pass over already-shipped code, not a
pre-implementation plan for code that doesn't exist yet. Its "does" / "does NOT do" wording below
describes the rail as it exists in the working tree today (commit `bedfaed`,
`phase-7/usdt0-mainnet-proof`), verified directly while writing this document, not reconstructed
from memory of earlier phases.

What this rail does and, explicitly, does not do, written for the same reason the router's own
`SCOPE.md` and the CCTP outbound relayer's own `OUTBOUND_SCOPE.md` state it: so nobody has to guess
at intent from what is merely absent. See `USDT0_THREAT_MODEL.md` (this same directory) for the
safety reasoning behind several of these.

This is the SDK's second rail, alongside `usdc-cctp`, implementing `RailAdapter`
(`packages/core/src/rail.ts`) for USDT0 transfers between Stellar and EVM chains via LayerZero's
OFT (Omnichain Fungible Token) standard — a different delivery mechanism from CCTP's burn/attest/
mint flow, chosen by Tether/LayerZero for this asset, not by this project. Confirmed real, not
assumed: `packages/core/VERIFIED.md` §2 documents the real, deployed Stellar-mainnet OFT contract
(`CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6`) and its real interface, decoded
directly from the deployed bytecode.

## What this rail does

- Quote, build, and (via the caller's own wallet) sign a real outbound (Stellar → EVM) USDT0
  transfer, using LayerZero's real `send()`/`quote_send`/`quote_oft` contract calls
  (`Usdt0LayerZeroAdapter.quoteOutbound`/`buildOutbound`,
  `packages/sdk/src/rails/usdt0-layerzero/adapter.ts:325-608`) — the same
  `quote()`→`build()`→sign→`markSubmitted()`→`track()` shape every other rail in this SDK uses
  (`packages/core/src/rail.ts`'s own `RailAdapter` interface), so an integrator already using
  `usdc-cctp` needs no new mental model to add this rail.
- Quote and build a real inbound (EVM → Stellar) USDT0 transfer too
  (`quoteInbound`/`buildInbound`, `adapter.ts:610-736`), but gated to G-account (plain Stellar
  account) recipients only — see "does NOT do" below for the real reason.
- Validate every address involved — sender, recipient, and refund address, on both directions —
  against a real EIP-55 checksum (`viem`'s `isAddress`, not a format-only regex), as of commit
  `bedfaed`. See `USDT0_THREAT_MODEL.md`'s "Address validation" section for the bug this closed
  and the exhaustive sweep confirming no other adapter call site shared it.
- Handle the real 7-decimal (Stellar) ↔ 6-decimal (LayerZero shared representation) amount
  mismatch correctly, including returning any floored remainder as `dust` rather than silently
  dropping it (`packages/core/src/amount.ts`'s `scaleDown`/`toSharedDecimals`,
  `adapter.ts:358-360`) — independently confirmed to match the real, on-chain OFT contract's own
  documented dust-refund behavior (`VERIFIED.md:238-239`).
- Refuse to construct at all against `network: "testnet"` (`adapter.ts:164-169`) — USDT0 has no
  Stellar testnet deployment (confirmed directly: LayerZero's own metadata API returns `{}` for
  USDT0 on `stellar-testnet`; Horizon testnet's 13 "USDT0"-coded assets are all unrelated issuers;
  `VERIFIED.md` §2.5), so this is a real, structural refusal, not a policy choice this project
  could relax by changing a flag.
- Support 13 real, LayerZero-configured destination EVM chains for outbound (`chains.ts:41-159`,
  full list in `USDT0_THREAT_MODEL.md`'s "Destination chain coverage" section) — but see "does NOT
  do" below for which of these are actually **proven**, not merely configured.
- Rely entirely on the sender's own wallet signature to pay for both the Stellar network fee and
  the LayerZero `native_fee` messaging cost, within the same signed transaction
  (`adapter.ts:457-468,585`) — no Ferryline-operated relayer, sponsor key, or hot wallet is
  involved in this rail at all, confirmed independently by the relayer's own
  `SUPPORTED_RAILS = ["usdc-cctp"]` (`packages/relayer/src/http/schemas.ts:10-11`, enforced by a
  real Zod-schema rejection, proven by two negative tests) and a full-repo grep finding zero other
  USDT0/LayerZero references anywhere in `packages/relayer/`.

## What this rail explicitly does NOT do

### Provide any Ferryline-side spend ceiling, rate limit, or per-recipient cap

Confirmed by exhaustive grep (`USDT0_THREAT_MODEL.md`'s "No spend/rate limits" section) — none
exists anywhere in this rail's code, on either direction. This is a deliberate consequence of the
rail's own trust shape, not an oversight: because there is no Ferryline-operated relayer or
sponsor key on this rail (unlike the CCTP outbound relayer, which holds a real EVM hot wallet and
needs exactly this kind of control — see `packages/relayer/OUTBOUND_THREAT_MODEL.md`'s own "Spend
accounting" section), there is no shared pool of funds for a Ferryline-side cap to protect. The
sender's own wallet balance is the only real bound on any single transfer, and the OFT contract's
own on-chain `min_amount_ld`/`max_amount_ld` (queried live, not assumed) is the only route-level
limit. See `USDT0_THREAT_MODEL.md` for the fuller reasoning on why this is judged acceptable rather
than a gap.

### Guarantee that the "proven" claim extends past Arbitrum

Of 13 configured destination chains, exactly one — Arbitrum — has a real, first-party,
Ferryline-signed transaction behind it (2026-09-14, cited throughout `USDT0_THREAT_MODEL.md` and
`VERIFIED.md` §2.7). The other 12 are real, live, correctly-configured LayerZero routes the
adapter will attempt exactly as built — but their gas/fee behavior and delivery timing are
genuinely unverified by this project, the same "no default ships until verified end to end"
discipline `usdc-cctp`'s own `maxFee`/`minFinalityThreshold` parameters already hold themselves
to (`packages/sdk/src/rails/usdc-cctp/adapter.ts:71-73`'s own doc comment). This is a
documentation/claim-scoping decision, not a code change — the code itself already fails safely on
a genuinely unresolvable chain (`ROUTE_UNSUPPORTED`) and treats all 13 configured chains
identically apart from the one, already-cited, `approvalRequired` distinction. Anyone citing this
rail's mainnet-proven status should name Arbitrum specifically, not the rail's chain list as a
whole.

### Validate that a caller-supplied refund address actually belongs to the sender

`TransferRequest.refundAddress` (`packages/core/src/rail.ts:30`), when explicitly supplied, is
accepted on both directions after only a format/checksum/non-muxed check — never an ownership
check tying it back to the resolved sender. This is a real, open gap, not a designed-in property,
recorded in `USDT0_THREAT_MODEL.md`'s own "Refund address" section along with two candidate fixes
pending sign-off. The existing widget never exercises this gap (it never sets `refundAddress`), so
this is scoped to raw SDK integrators building their own `TransferRequest` today, until a fix is
chosen and shipped.

### Resolve inbound USDT0 delivery to C-address or muxed recipients, or confirm no-trustline retry behavior

Both remain genuinely **BLOCKED**, per `packages/core/VERIFIED.md` §4 and the two dated experiment
files (`2026-09-11-inbound-usdt0-c-address.md`, `2026-09-11-inbound-usdt0-no-trustline.md`) — each
needs a real mainnet operator with real USDT0 and a real Stellar smart-account target that this
project does not yet have. The adapter's own current behavior already refuses the unresolved case
outright (`UNSUPPORTED_RECIPIENT_KIND` for any non-G-account inbound recipient,
`adapter.ts:610-625`) rather than guessing, and this scope document makes no attempt to resolve
either question — both remain exactly as unresolved as `VERIFIED.md` already, accurately, records
them.

### Operate, control, or take responsibility for LayerZero's own delivery infrastructure

Once a sender's own wallet signs and submits the outbound transaction, delivery is entirely
LayerZero's protocol's own responsibility — its DVN network and executor, none of which this
project operates or can influence. `USDT0_THREAT_MODEL.md`'s "Ferryline's responsibility boundary"
section works through this explicitly: Ferryline's real responsibility on this rail ends at "the
transaction we built and asked you to sign was correct," not "we will get your funds there" — a
narrower boundary than the CCTP outbound relayer's own, and one that should be stated plainly to
any integrator who might otherwise assume relayer-style delivery guarantees this rail was never
designed to provide.

### Provide any change to the CCTP-only relayer, the router contract, or the widget's own refund-address handling

This document and its companion threat model are a review of the SDK rail's own existing code.
They do not propose, and this phase does not implement, any change to `packages/relayer` (which
remains, and per its own `schemas.ts`, is designed to remain, CCTP-only), `contracts/router`
(entirely unrelated to this rail — LayerZero delivery bypasses the router contract), or the
widget's own UI (which today never surfaces or sets `refundAddress` at all, and is unaffected by
any of this document's open questions until one is resolved and, if code changes result,
implemented separately).

### Formal verification or third-party audit

No formal verification or external security audit of this rail has been performed. The real
mainnet evidence cited throughout this document and `USDT0_THREAT_MODEL.md` is direct,
first-party, on-chain observation of a small number of real transactions (one proven chain, one
proven amount scale, one proven direction) — real evidence, but not a substitute for the kind of
systematic review the CCTP outbound relayer itself still awaits (see that service's own
`OUTBOUND_SCOPE.md`, which states the same limitation for its own, more mature codebase).
