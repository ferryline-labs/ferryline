# Ferryline outbound CCTP relayer (Stellar → EVM) — v1 scope

**STATUS UPDATE: v1 is implemented, tested, and testnet-proven with a real Sepolia transaction.**
This document is kept as the real, approved design this build followed — not rewritten after the
fact — so its "would do"/"would not do" wording below is preserved as written at design time. Where
a design decision below was left as an open question, `OUTBOUND_THREAT_MODEL.md`'s own "Open
questions" section now records which option was actually chosen and implemented. SDK/widget wiring
(automatic registration, `packages/sdk/src/index.ts`'s `Ferryline.registerOutboundTransfer`) was
also built, in a later phase than this scope doc's own "no changes to packages/sdk or
packages/widget" framing below anticipated — see `OUTBOUND_THREAT_MODEL.md`'s own note on that
question for why.

What v1 does and, explicitly, does not do, written for the same reason the router's own `SCOPE.md`
states it: so nobody has to guess at intent from what is merely absent. See
`OUTBOUND_THREAT_MODEL.md` (this same directory) for the safety reasoning behind several of these.

This is new, standalone infrastructure for the direction Circle's own CCTP protocol does not
automatically complete: a Stellar-source burn's completing `receiveMessage` call on the
destination EVM chain. Confirmed real, not assumed — Circle's own technical guide states plainly
that "an API consumer must query this attestation and submit it onchain to the destination
domain's MessageTransmitterV2#receiveMessage function," with no testnet/mainnet exception drawn
anywhere in that document, and this project's own widget-phase testing confirmed it directly: a
real, fully attested Stellar-source burn sat undelivered for about 46 minutes until manually
completed (`packages/widget/e2e/submit-receive-message.mjs`, `packages/core/verified/experiments/
2026-09-12-widget-e2e-real-browser-wallet.md`). See `technical-doc.md`'s own threat-model-outline
table for this project's original, pre-this-design-pass framing of the gap.

The existing `packages/relayer` (inbound, EVM → Stellar) is the direct structural precedent for
everything below, cited by file throughout. This was NOT a modification of that package's own
inbound service logic — v1 shipped as new modules inside the same `packages/relayer` codebase
(Option A of the two considered in `OUTBOUND_THREAT_MODEL.md`'s open questions, confirmed chosen),
reusing its existing patterns (a Postgres-backed transfer state machine, an append-only spend
ledger, a `Signer` abstraction, startup crash reconciliation), not new logic bolted onto the
inbound work loop or its own database rows.

## v1 does

- Complete an already-attested Stellar-source CCTP burn by calling `receiveMessage(message,
attestation)` on the real destination EVM chain's `MessageTransmitterV2` contract, paying that
  chain's own gas from a relayer-controlled EVM hot wallet — the same real call
  `packages/widget/e2e/submit-receive-message.mjs` already does by hand for one transfer at a
  time, generalized into an automated service.
- A registration/polling model directly mirroring the inbound relayer's own real shape (`POST
/transfers` registers a transfer to watch; the service itself polls Circle's Iris for
  attestation status and, once attested, polls/checks on-chain nonce state before and after
  submitting) — see `OUTBOUND_THREAT_MODEL.md`'s "what triggers this relayer" section for the one
  real, direction-driven difference from the inbound model (the relayer discovers a Stellar burn
  itself rather than being told a specific tx hash — see that section for why).
- Exactly ONE destination EVM chain for v1 (see `OUTBOUND_THREAT_MODEL.md`'s multi-chain section
  for the reasoning) — the same "start narrow, prove it, expand later" pattern the SDK's own rail
  adapters (`packages/sdk/src/rails/`) and the router's own two-rail scope
  (`contracts/router/SCOPE.md`'s "No generic 'any rail' extensibility") both already follow.
- A per-transfer gas cap, a per-recipient rate limit, a global daily gas-spend ceiling that
  actually halts new submissions when reached (atomic reserve-then-commit, not a post-hoc check),
  and an append-only spend ledger — directly mirroring `packages/relayer/db/schema.sql`'s
  `daily_spend`/`spend_attempts`/`spend_ledger_events` tables and `src/spend/ceiling.ts`'s
  `SpendCeiling.reserve()`/`release()` pattern, adapted for whatever the EVM-side gas-accounting
  unit turns out to be (see `OUTBOUND_THREAT_MODEL.md`'s gas-market-risk section — this is a real,
  direction-specific design question, not a drop-in port).
- Crash recovery via on-chain re-verification at startup, the same real pattern as
  `packages/relayer/src/work/reconcile.ts`'s `reconcileSubmitting`: before resubmitting anything
  found mid-flight, ask the destination chain directly (`MessageTransmitterV2.usedNonces(...)` on
  EVM, the real, symmetrical counterpart to the inbound relayer's own
  `nonceIsUsedOnStellar`/Stellar `MessageTransmitter.is_nonce_used` check) whether the nonce is
  already consumed, and only resubmit if it genuinely is not.
- A `Signer`-shaped abstraction for the EVM hot wallet, matching
  `packages/relayer/src/signer/env-secret-signer.ts`'s own stated design intent (one file reads
  the raw secret; everything else calls an interface) — so a future KMS/HSM-backed signer swap
  costs one new file and one wiring change, the same property that file already documents for the
  Stellar side.

## v1 explicitly does NOT do

### More than one destination EVM chain

CCTP supports several EVM destination chains; v1 targets exactly one (recommendation: whichever
chain this project's own existing testnet work already has real, verified experience with — see
`OUTBOUND_THREAT_MODEL.md`'s multi-chain section for the specific recommendation and reasoning).
Multi-chain support is real, scoped, future work once v1 is proven on one chain, mirroring how
the SDK's own rail adapters and the router's own rail set both started narrow before any
expansion was considered. Building v1 to already support N chains "for free" is explicitly
rejected: gas-market behavior, nonce-check RPC endpoints, and hot-wallet funding are all
per-chain, real operational surface that should be proven once before being multiplied.

### Automatic delivery for transfers already in flight before v1 existed

v1 only ever acts on transfers registered with it after it started running. It does not
retroactively scan Stellar's ledger history for past, still-undelivered burns from before it
existed. An operator (or the SDK/widget) choosing to backfill historical undelivered transfers into
the relayer is a separate, explicit operational decision, not something v1's own design assumed or
automated.

### Gas-price prediction, bidding, or MEV protection

v1 submits `receiveMessage` using whatever gas-price strategy its EVM RPC/library defaults
recommend at submission time (to be selected during implementation, not this design pass) and
accepts the chain's real, current gas market as a given. It does not attempt to predict gas-price
spikes, does not implement a bidding/priority-fee optimization strategy, and does not protect
against MEV extraction on the completing transaction (there is little to extract — `receiveMessage`
moves already-minted funds to their already-fixed, attestation-specified recipient; front-running it
does not redirect funds). See `OUTBOUND_THREAT_MODEL.md`'s gas-market-risk section for the actual
failure mode this scope decision implies (a transfer sits unrelayed longer, not a fund-loss risk).

### A guaranteed delivery-time SLA

Because `receiveMessage` is permissionless (anyone, including the sender or recipient, can
complete it — the same property this project's own `FAQ.md` already states plainly), v1 is best
described as "the default path that makes delivery automatic, most of the time, for most
transfers," not a guarantee. A transfer stuck behind an exhausted gas-spend ceiling, a chain-wide
gas spike past whatever cap is configured, or an outage in v1 itself still has the exact same
recourse that exists today with no relayer at all: anyone can complete it manually, the same way
`packages/widget/e2e/submit-receive-message.mjs` already demonstrates.

### Any change to the router contract, the SDK's rail adapters, or the widget's own UI

**UPDATE: the SDK/widget wiring described as out of scope below DID happen, in a genuinely
separate, later phase** — `packages/sdk/src/index.ts`'s `Ferryline.registerOutboundTransfer`
(open question 2's Option A, automatic registration, confirmed chosen — see
`OUTBOUND_THREAT_MODEL.md`'s own open-questions section) and the widget's matching
`OUTBOUND_CCTP_DELIVERY_CAVEAT` revision, exactly as anticipated below. The original claim was
scoped correctly for its own moment: v1 ITSELF (this relayer service) needed no router/SDK/widget
change to build — that remained true. What follows is the original text, unedited, for the
record:

v1 is a new, standalone service consuming already-existing, already-real interfaces: Circle's
Iris attestation API (already integrated, `packages/sdk/src/rails/usdc-cctp/iris.ts`) and the
real, already-deployed `MessageTransmitterV2` contract on the destination EVM chain. No change to
`contracts/router`, `packages/sdk`, or `packages/widget` is proposed or required to build v1. The
widget's own honest "not automatically delivered" caveat
(`OUTBOUND_CCTP_DELIVERY_CAVEAT` in `packages/widget/src/index.ts`) would likely be revised once
v1 is real and live, to point users at the new automatic path instead of describing its absence,
but that revision is out of scope for v1's own build and design.

### Sponsoring/funding the recipient's own destination-chain gas needs beyond this one call

v1's gas spend is scoped exactly to the one `receiveMessage` completion call. It does not fund the
recipient's wallet for any of their own subsequent transactions, and does not sponsor any other
destination-chain operation. This mirrors the inbound relayer's own scope discipline (its sponsor
account "holds only enough XLM to pay gas for completing already-verified transfers, it is never
in the path of the actual USDC being moved" — `ARCHITECTURE.md`'s security model).

### Formal verification or third-party audit

Same status as the router's own `SCOPE.md` states for itself: an SDF Audit Bank engagement is
planned project-wide but has not started for any component, this one included. This document and
its companion threat model exist so that engagement, when it happens, starts from a settled design
rather than reconstructing one from code after the fact.
