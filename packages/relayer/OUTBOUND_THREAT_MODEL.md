# Ferryline outbound CCTP relayer (Stellar → EVM) — threat model, STEP 1

Status: **design only. No implementation exists.** This is the pre-code sign-off for a new,
standalone relaying service, following the same STRIDE-outline structure the router's own
`THREAT_MODEL.md` used at its own start (`## What are we working on?` / `## What can go wrong?`
/ `## What are we going to do about it?`), and the same "verify, don't assume" standard every
other design document in this repo holds itself to — every claim about the EXISTING inbound
relayer below is cited to a real file in `packages/relayer/`, not reconstructed from memory.

See `OUTBOUND_SCOPE.md` (this same directory) for what v1 explicitly does and does not do.

## What are we working on?

A new service that completes Stellar-source CCTP transfers on the destination EVM chain, the
direction Circle's own infrastructure does not automatically finish. Concretely: once a Stellar
`deposit_for_burn` (via the router or a direct SDK call) is attested by Circle's Iris service,
someone must call `receiveMessage(message, attestation)` on the destination chain's
`MessageTransmitterV2` contract, paying that chain's own gas, or the transfer sits attested but
undelivered indefinitely. Confirmed real, not theoretical: `packages/widget/src/index.ts`'s own
`OUTBOUND_CCTP_DELIVERY_CAVEAT` already tells users this plainly, and
`packages/core/verified/experiments/2026-09-12-widget-e2e-real-browser-wallet.md` records a real
transfer that sat undelivered for ~46 minutes before a manual completion
(`packages/widget/e2e/submit-receive-message.mjs`).

This is the mirror direction of the existing, already-shipped inbound relayer
(`packages/relayer/`, EVM → Stellar), which completes the opposite leg (an EVM-source burn's
completing `mint_and_forward` call on Stellar). That existing service is the direct structural
precedent for everything below — every mechanism described here either mirrors it deliberately
(with the reasoning stated) or deliberately departs from it (with the reasoning stated), never
copied or rejected without saying which and why.

## What can go wrong?

### Trigger model: what tells this relayer a transfer exists?

**The inbound relayer's real model, confirmed from source**: `POST /transfers`
(`packages/relayer/src/http/routes/register-transfer.ts`) is called by an external caller (today,
the widget's own `registerInboundTransfer` method, `packages/widget/src/index.ts`) who ALREADY
has a real, confirmed source-chain (EVM) transaction hash in hand — the burn happened entirely
outside the relayer's own visibility, in a wallet the relayer's own code never touches, and the
caller tells the relayer "watch this specific hash." Everything downstream of that registration
(Iris polling, attestation, submission) is the relayer's own pull/poll loop
(`packages/relayer/src/work/loop.ts`), not push.

**Does the same model hold for the OUTBOUND direction? Worked through explicitly, not assumed:**

The source-chain burn for outbound is a Stellar `deposit_for_burn` call — either via the router
contract (`send_cross_chain`) or a direct SDK call
(`packages/sdk/src/rails/usdc-cctp/adapter.ts`). Critically, **this transaction is signed by the
SAME Stellar wallet session the widget already holds**, not an external, invisible-to-Ferryline
wallet the way an inbound EVM burn is. The SDK's own existing `Ferryline.markSubmitted(transferId,
sourceTxHash)` method (`packages/sdk/src/rails/usdc-cctp/adapter.ts`, referenced directly by that
file's own `track()` method) already records a real Stellar tx hash the moment a burn is signed —
this is not a new capability that needs building, it already exists for the widget's own
in-process tracking.

**This means the outbound direction has STRICTLY BETTER first-party visibility than inbound
does**, not worse or merely equivalent: the widget/SDK is a first-party participant in the exact
moment the source transaction is created and confirmed, rather than an outside observer told
about an EVM transaction after the fact. The push model is not merely "still applicable," it is
the more natural fit for this direction specifically, because the caller registering the transfer
already has a first-party, low-latency, definitely-correct source tx hash the instant the burn
lands — there's no reason to make the relayer independently rediscover something its own caller
already knows for certain, one ledger closes after the caller does.

**One real, genuinely new design question this direction introduces, that inbound's design never
had to answer:** the widget/SDK, not a third-party dApp, is the overwhelmingly likely registration
caller for outbound (since the widget already drives the Stellar-side signing itself). This
argues for the registration call being wired directly into the widget's own outbound-transfer flow
(a new, symmetrical `registerOutboundTransfer` method alongside the existing
`registerInboundTransfer`), rather than left as a manual, external integration step the way inbound
registration is documented today. This is a real product/API-design decision, not a safety one —
flagged as an open question below for sign-off, not decided unilaterally here.

**Recommendation: keep the push/registration model, adapted as above.** See "Push vs. watch,
reconsidered for this direction" below for the fuller reasoning, including why a pure watch/scan
model was considered and rejected.

### What does this relayer hold/control?

The inbound relayer holds exactly one Stellar secret key (`FERRYLINE_SPONSOR_SECRET`, the ONLY
place it's read: `packages/relayer/src/signer/env-secret-signer.ts`), used to fee-bump
`mint_and_forward` transactions. Outbound needs the symmetrical thing on the EVM side: **one EVM
hot-wallet private key**, used to sign and submit `receiveMessage` transactions, paying that
chain's own native gas token.

**A real, direction-specific difference, not glossed over**: the inbound relayer's sponsor key
only ever needs to hold XLM, on one network. The outbound relayer's hot wallet needs the
destination chain's own native gas token (ETH on most EVM CCTP destinations, or that chain's own
equivalent) — and if v1 ever supports more than one destination chain (explicitly deferred, see
`OUTBOUND_SCOPE.md`), the wallet needs funding on EACH chain independently; there is no shared gas
token across EVM chains the way there's one XLM balance for every Stellar operation. For v1's
single-destination-chain scope (see below), this reduces to the same shape as inbound: one key,
one chain, one balance to monitor — the multi-chain version of this question is explicitly
deferred along with multi-chain scope itself, not solved here.

The `Signer` abstraction pattern (`packages/relayer/src/signer/types.ts`'s interface,
implemented by `EnvSecretSigner` in the same directory) should be mirrored directly: one new file
(`EnvSecretEvmSigner` or similar) that is the ONLY place an EVM raw private key is read, with
every other module receiving an interface and calling `.sign()`/`.address()` on it — the same
"one KMS/HSM swap costs one new file" property the existing signer's own doc comment states as
the reason it's shaped this way.

### Spend accounting: what does "spend ceiling" mean for gas instead of an XLM fee-bump?

The inbound relayer's spend-safety stack is three genuinely distinct controls, and this design
keeps that same three-way separation rather than collapsing them:

1. **Per-transfer cap** (inbound: `FERRYLINE_MAX_FEE_BUMP_STROOPS`, checked against a real quoted
   fee before broadcast). Outbound equivalent: a per-transfer max-gas-cost cap, checked against a
   real, current gas-price quote (from the destination chain's own RPC, at submission time) before
   broadcast, in the destination chain's native gas units.
2. **Registration-time rate limit** (inbound: `packages/relayer/src/spend/registration-limit.ts`,
   a blunt per-API-key brake, not atomic, because nothing at registration time spends money).
   Outbound: identical reasoning applies unchanged — registering a transfer to watch has no
   immediate cost, so the same non-atomic, blunt brake is appropriate here too.
3. **Per-recipient rate limit** (inbound: checked once the recipient is known from the verified
   on-chain message, via `countByRecipientSince`). Outbound: the recipient (the EVM address CCTP's
   own attestation names as `mintRecipient`) is known the moment Iris attests the message, exactly
   analogous to when inbound learns its own recipient — same check, same timing, different chain.
4. **Global daily spend ceiling, with an atomic reserve-then-commit, not a post-hoc check**
   (inbound: `daily_spend` table, `SpendCeiling.reserve()`'s single
   `INSERT ... ON CONFLICT ... WHERE ... RETURNING` statement,
   `packages/relayer/src/spend/ceiling.ts` / `db/schema.sql`, verified race-free under real
   concurrency by `ceiling.integration.test.ts`). Outbound: the identical mechanism, the identical
   SQL shape, a `daily_gas_spend`-equivalent table keyed by (spend_date, destination_chain) rather
   than just spend_date (v1 has one destination chain, so this is a forward-looking key shape, not
   forward-looking behavior — the effective behavior for v1 is identical to inbound's single-key
   table).
5. **The append-only spend ledger** (inbound: `spend_attempts` + `spend_ledger_events`, the
   "reservation-intent log" plus "what actually happened to each reservation" pair, per
   `db/schema.sql`'s own extensive comments). Outbound: the same two-table shape, same
   `'reserved' | 'released' | 'broadcast'` event typing, same `release_reason` enum
   (`'concurrent_race_lost' | 'broadcast_rejected'`), denominated in the destination chain's gas
   units instead of XLM stroops.

**One real question this direction adds that inbound's design didn't need to answer: gas price is
not a fixed, quotable-in-advance fee the way a Stellar fee-bump largely is.** See the next section.

### New risk specific to this direction: what if destination-chain gas spikes past the cap?

This is a real, direction-specific risk inbound's design never had to reason about, because
Stellar's own fee market doesn't behave the way EVM gas markets do (no base-fee auction, no
demand spikes of the same magnitude). Worked through explicitly:

**The failure mode, precisely**: if the destination chain's current gas price would make a
`receiveMessage` call's cost exceed the per-transfer cap (or would exceed remaining daily-ceiling
room), the relayer does not submit. **This produces the exact same failure mode that exists TODAY,
with no relayer at all**: the transfer sits attested, undelivered, exactly as
`OUTBOUND_CCTP_DELIVERY_CAVEAT` already describes. This is not a regression or a new, worse
failure mode this service introduces — it is the SAME already-accepted, already-documented
"someone has to complete this, permissionlessly, and nobody has yet" state, just narrower in
scope (this specific relayer chose not to, this time, because of its own configured caps) rather
than universal (nothing chose to). **`receiveMessage`'s own permissionless design (confirmed
directly: Circle's technical guide states "anyone... can submit it," and this project's own
`FAQ.md` already states the same) means the transfer is never stuck in a way this relayer's own
absence-of-action makes worse than today** — the sender, the recipient, or a future retry (once
gas prices fall back under the cap) can still complete it, exactly as before this service existed.

**The one genuinely worse failure mode to explicitly design against, and how**: a poorly-designed
retry policy that keeps re-attempting a submission at increasing gas prices without a hard ceiling
could itself become a spend-safety failure — burning through the daily ceiling on repeated,
increasingly expensive attempts at ONE stuck transfer, starving every other transfer's fair share
of the day's budget. **Mitigation, stated as a hard design requirement, not an implementation
detail to figure out later**: retries must use the SAME per-transfer cap on every attempt (never
an escalating "try harder" ceiling), and the per-recipient rate limit already caps how often any
one recipient's transfers can even reach the submission path in the first place. A transfer that
cannot be completed within the per-transfer cap simply waits for gas to fall, polled on the same
cadence as any other attested-but-not-yet-submitted transfer, not specially retried more
aggressively.

### Multi-chain complexity: how many destination chains does v1 need to support?

**Recommendation: exactly one destination chain for v1**, mirroring how this project's own SDK
rail adapters (`packages/sdk/src/rails/`, one adapter per rail, not one generic multi-rail
abstraction from day one) and the router contract itself (`contracts/router/SCOPE.md`'s own "No
generic 'any rail' extensibility," exactly two rails, expansion explicitly deferred) both already
made the identical call. Reasoning, specific to this service rather than inherited by analogy
alone:

- Gas-market behavior, RPC endpoint reliability, and typical `receiveMessage` gas cost are all
  real, per-chain facts that need their own real verification before being trusted in a spend-cap
  calculation — the same "verify, don't assume" standard this project applies to Circle's own
  parameter behavior (see `EXTERNAL_REPORT_DRAFT.md`'s Finding 3) applies equally to "what does
  `receiveMessage` actually cost on chain X, under real conditions" for any chain this relayer
  would submit to.
- Hot-wallet funding is genuinely per-chain (see "what does this relayer hold" above) — supporting
  N chains means N independently-funded, independently-monitored balances from day one, real
  operational surface multiplied before v1 has even proven the single-chain mechanism works for
  real.
- **Which one chain**: recommend whichever destination this project's own testnet work already has
  real, verified experience with — **Ethereum Sepolia** is the concrete candidate, confirmed
  directly from the real code, not from a comment describing it: `packages/widget/e2e/harness.ts`
  sets `to: { chain: "ethereum-sepolia", ... }` and the manual completion script
  (`submit-receive-message.mjs`) imports `sepolia` from `viem/chains` and submits to it directly.
  (That harness file's own doc comment says "Stellar -> Base Sepolia" — a stale comment that
  doesn't match its own code, worth a small doc fix separately, but not something this design
  should inherit as fact; the real, executed chain is Ethereum Sepolia, confirmed by reading the
  actual `to`/`viem/chains` values, not the surrounding prose.) Starting where real,
  already-verified testnet experience already exists is a smaller first step than picking a chain
  from Circle's supported-destinations list with no prior first-party experience against it.

## What are we going to do about it?

The concrete mitigations above (per-transfer cap, per-recipient limit, atomic global ceiling with
reserve-then-commit, append-only ledger, single-destination-chain scope, nonce-based crash
recovery) ARE the answer to "what are we going to do about it" for each risk in turn — restated
here as one list for a reviewer who wants the mitigation column without re-reading the reasoning:

- **Trigger/visibility**: push/registration model, the caller (widget/SDK) supplies a real,
  already-confirmed Stellar burn tx hash it obtained first-party via the SDK's existing
  `markSubmitted` mechanism — no new discovery/scanning logic needed.
- **Key custody**: one EVM hot-wallet key, one dedicated `Signer`-shaped abstraction file, same
  "refuse to start without it, no silent default" discipline as `env-secret-signer.ts`.
- **Spend safety**: the inbound relayer's exact three-tier control (per-transfer cap,
  per-recipient limit, atomic daily ceiling) ported directly, denominated in destination-chain gas
  units, with the same append-only two-table ledger shape.
- **Gas-spike risk**: bounded by the same per-transfer cap on every retry attempt, no escalating
  "try harder" behavior; the failure mode this produces (a transfer waits) is explicitly the SAME
  failure mode that already exists with no relayer at all, not a new or worse one.
- **Crash recovery**: startup reconciliation against the destination chain's own
  `MessageTransmitterV2.usedNonces(...)`, mirroring `reconcile.ts`'s real
  `nonceIsUsedOnStellar`-based logic exactly — never resubmit if the nonce is already consumed;
  always safe to resubmit if it is not, because CCTP nonces are one-shot on the destination side
  the same way they are on the source side.
- **Scope discipline**: one destination chain for v1, Base Sepolia (or whichever chain has the
  most real, existing verified experience by the time implementation starts) recommended
  specifically, not a placeholder "pick one" — expansion is real, explicit, future work.

## Push vs. watch, reconsidered for this direction (explicit deliverable)

**Recommendation: push (registration), not watch (scanning). Re-examined from scratch for this
direction, not inherited from the inbound conclusion by assumption.**

The inbound relayer's own choice of push over watch rests on a fact specific to ITS direction:
the relayer has no way to distinguish "a Ferryline-relevant EVM burn" from any other CCTP burn on
a chain it doesn't control or specially watch, without being told which transaction matters —
scanning would mean either indexing every CCTP burn on every supported EVM chain (expensive,
mostly irrelevant) or requiring some other correlation signal that doesn't exist without a
registration step providing it.

**Does that same reasoning hold for outbound?** Re-examined directly:

- **Argument for switching to watch, considered seriously**: unlike an external EVM burn, a
  Stellar-source burn IS potentially observable by watching Stellar's own ledger directly (via a
  Horizon/RPC event stream) for `deposit_for_burn` calls against the known `TokenMessengerMinter`
  contract address, without needing a caller to register anything. This is a real, technically
  viable alternative that inbound's own direction doesn't have an equivalent for (there is no
  analogous "watch Stellar for the completing side" option there, since Stellar is the
  destination, not the source, for inbound).
- **Why push still wins, even though watch is technically possible here**: a pure watch model
  would need to independently re-derive, from raw ledger events alone, exactly the information the
  registering caller already has for free and with certainty (the transfer's own destination
  chain/recipient/router-vs-direct-SDK context) — CCTP's own burn event carries the destination
  domain and mint recipient, so this is NOT impossible, but it adds a real dependency (a live
  ledger-streaming component, its own uptime/backpressure/replay-on-restart concerns) to solve a
  problem the push model already solves for free, given that the overwhelmingly likely caller (the
  widget/SDK) is a first-party participant in the burn transaction itself and already knows
  everything a watcher would have to reconstruct. Watching only becomes clearly worth its own
  added complexity if a genuinely large fraction of outbound burns are expected to originate
  OUTSIDE any Ferryline-integrated surface (a raw Soroban call from an unrelated dApp using the
  router directly, never touching the SDK or widget) — which is a real possibility worth
  confirming rather than assuming away (see open questions below), but is not the default,
  most-likely case today.
- **A hybrid worth naming, not designing further here**: nothing about a push-based v1 forecloses
  ADDING a watch-based fallback later specifically for burns that never get registered (a safety
  net, not the primary mechanism) — this is real, explicitly deferred future work, not part of
  v1's own design, following the same "start narrow, prove it, expand later" discipline as the
  chain-count and rail-count decisions above.

## Open questions needing sign-off before implementation starts

1. **Package boundary**: does this live inside the existing `packages/relayer` (new modules,
   sharing its Postgres instance/schema/deployment) or as a genuinely new package? This design
   assumes the former (reusing schema/deployment/patterns directly) but that's a real choice, not
   yet decided.
2. **Widget/SDK wiring**: should a new `registerOutboundTransfer` method be added to the widget
   alongside the existing `registerInboundTransfer`, wired automatically into the outbound send
   flow, or left as a documented manual integration step the way inbound registration is today?
   This is a product-surface decision, not a safety one, and belongs with whoever owns that
   surface, not decided unilaterally in this document.
3. **Destination chain choice for v1**: Base Sepolia is recommended above on "most existing real
   verified experience," but this should be confirmed against whatever the actual real integrator
   demand looks like once any exists, not decided purely on convenience.
4. **How much of outbound traffic is expected to bypass the widget/SDK entirely** (a direct router
   call from an unrelated integration): this materially affects whether the push model's
   assumption (the registering caller already knows everything) holds broadly enough, or whether
   the watch-based fallback mentioned above should be pulled into v1's own scope rather than left
   fully deferred.
5. **EVM RPC/library choice** for building, quoting gas, and submitting the `receiveMessage`
   transaction (this design deliberately does not pick one — that's an implementation detail, not
   a design-level safety question, the same way inbound's own design docs don't mandate a specific
   Stellar SDK call shape beyond what's already in the real, shipped code).
