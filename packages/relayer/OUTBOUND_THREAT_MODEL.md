# Ferryline outbound CCTP relayer (Stellar → EVM) — threat model, STEP 1

Status: **implemented, tested, and testnet-proven with a real Sepolia transaction** — this was the
pre-code sign-off for what became a real, running service (`packages/relayer/src/work/outbound-*`
and siblings); kept as written at design time rather than rewritten after the fact, since it's the
real document that governed the build. See "Open questions needing sign-off before implementation
starts" near the end of this file for which option was actually chosen for each open decision, and
`packages/relayer/README.md`'s own "Outbound (Stellar -> EVM)" section for the real, current
env vars/API/behavior this design produced.

**Explicit note on the format choice below, checked directly rather than assumed**: this document
uses the router's CURRENT, matured `THREAT_MODEL.md`'s three-part STRIDE-outline shape
(`## What are we working on?` / `## What can go wrong?` / `## What are we going to do about it?`).
That is a conscious, stated choice of a familiar, already-proven-useful shape for THIS document,
not a claim that it reproduces a real Step-1 precedent from this repo's own history. Checked
directly: neither the router's `SCOPE.md`/`THREAT_MODEL.md` nor the inbound relayer's own
equivalent exists in git history as a separately-committed, genuinely pre-implementation artifact
— both were first committed already matured, after real code and real testnet work, each
narrating an earlier "STEP 1 sign-off" this repo never preserved as its own file
(`git log --diff-filter=A` on both paths confirms this; the router's own THREAT_MODEL.md was
first added in the same commit that also reports STEP 2 through STEP 8 complete). The one artifact
in this repo that IS verifiably pre-code is `technical-doc.md`'s own `## Threat model outline`
section (a plain `| Threat | Impact | Mitigation | Monitor |` table, explicitly labeled "the start
of the threat model... it gets expanded in Week 7"). This document deliberately does NOT use that
format instead — reasoning: `technical-doc.md`'s table is intentionally terse (one row per
threat, a sentence or two each), appropriate for a whole-project pitch document covering many
components at once, while this document needs the fuller, section-per-question depth the
router's own STRIDE outline provides to actually answer the specific, detailed questions this
design was asked to work through (trigger model, custody, spend adaptation, gas-market risk,
multi-chain scope). The router's shape was picked for that reason, not because it is the
historically accurate "how Phase 4 really started" template — no such template survives in this
repo to copy. Every claim about the EXISTING inbound relayer below is cited to a real file in
`packages/relayer/`, not reconstructed from memory.

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
- **Scope discipline**: one destination chain for v1, Ethereum Sepolia (or whichever chain has the
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

**RESOLVED — real decisions actually made and implemented, recorded here rather than reconstructed
from memory:**

1. **Package boundary** → Option A, new modules inside `packages/relayer` (confirmed: real code
   lives in `packages/relayer/src/work/outbound-*.ts` and sibling files, not a separate package).
2. **Widget/SDK wiring** → Option A, automatic registration. `packages/sdk/src/index.ts`'s
   `Ferryline.registerOutboundTransfer` fires once a transfer's final build step confirms (see that
   method's own doc comment, and `isFinalStep`, both in the same file, for why "final step" matters
   — an earlier version of this wiring fired on every step and had to be fixed). The widget calls it
   automatically from its own `afterStepSubmitted`; a raw SDK integrator calls it explicitly at the
   same point. Gated entirely by whether a relayer is configured (`FerrylineConfig.relayerUrl`) —
   an integrator with none configured is unaffected, per this question's own original reasoning.
3. **Destination chain** → Ethereum Sepolia, exactly as anticipated, confirmed via a real,
   independently-verified Sepolia transaction (see `packages/core/verified/experiments/` for the
   real burn/delivery tx hashes).
4. **Traffic bypassing the widget/SDK** → still genuinely open; nothing resolved this by
   construction (the relayer's own `POST /outbound-transfers` accepts any caller with a valid API
   key, whether or not it came from `@ferryline/sdk`).
5. **EVM RPC/library choice** → viem, as anticipated (a non-decision, confirmed correct).

Each of these has a real decision behind it, not just a label — worked through here with the
actual options, what each implies, and where I land, so sign-off means agreeing with a real
argument, not just a name. (Original, pre-decision reasoning preserved below for the record.)

### 1. Package boundary: new modules inside `packages/relayer`, or a genuinely new package?

**Option A — inside `packages/relayer`** (this design's working assumption throughout). New
directories (e.g. `src/outbound/`) alongside the existing inbound code, sharing the same Postgres
instance, the same `db/schema.sql` (extended with new tables), the same deployment
(`Dockerfile`/`docker-compose.yml`), the same `main.ts` process.

- _Implies_: one service to deploy and operate, one database to back up, and direct code reuse of
  `Signer`, the spend-ledger pattern, and the reconciliation-at-startup pattern without needing to
  publish or version any of it as a shared library. The tradeoff: the two directions' work loops
  would run in the same process, so a bug or resource exhaustion in one direction's polling logic
  has more opportunity to affect the other's than if they were fully separate deployments (though
  Node's own single-threaded event loop already means the inbound relayer's own two phases share
  fate today, so this isn't a new category of risk, just extended to a third work loop).
- **Option B — a new package** (`packages/outbound-relayer` or similar). Its own database (or its
  own schema within a shared instance), its own deployment, potentially importing shared pieces
  (`Signer`-shaped interfaces, spend-ledger table conventions) as documented patterns to follow
  rather than literal shared code.
- _Implies_: cleaner operational isolation (one direction's incident doesn't require touching the
  other's deployment), but real duplication risk — the spend-ledger/crash-recovery pattern would
  need to be re-implemented, not reused, unless a genuine shared library is extracted first (itself
  new scope this design doesn't cover).
- **My read**: Option A. The two directions are structurally near-identical (both: watch an
  attestation service, hold one hot key, spend-cap-gate a completion transaction, recover via
  on-chain nonce check at startup) and this project's own existing convention
  (`@ferryline/core` shared by both the SDK and the relayer already) favors sharing real code over
  duplicating a pattern that's already been debugged once. If operational isolation becomes a real
  need later (e.g. wanting to scale/restart the two directions independently), that's a deployment
  topology decision (two processes reading the same package, still one codebase) rather than a
  reason to fork the code itself.

### 2. Widget/SDK wiring: automatic registration, or a documented manual step?

**Option A — a new `registerOutboundTransfer` method**, mirroring `registerInboundTransfer`
exactly, wired automatically right after the widget's own outbound `send_cross_chain` call
confirms on Stellar (the same moment `markSubmitted` already fires internally).

- _Implies_: every outbound transfer sent through the widget gets automatic relay by default, with
  zero extra integration work for anyone already using the widget — the strongest version of "this
  gap is now closed" from a user's perspective. Cost: couples the widget's release cadence to the
  relayer's own readiness (shipping the widget change means the relayer needs to already be live
  and reachable, or the registration call needs its own graceful-failure handling so a
  down/unreachable relayer doesn't block the widget's own already-working local flow).
- **Option B — documented manual step**, mirroring how inbound registration is described in
  `packages/relayer/README.md` today (a real, working, but opt-in integration a caller adds
  themselves).
- _Implies_: no coupling between widget releases and relayer readiness, and a natural place to
  gate rollout (announce the new registration call as available, let integrators adopt it on their
  own timeline) — but the default experience stays exactly as it is today (manual completion, per
  the existing caveat) until each integrator specifically wires it in.
- **My read**: leaning Option A, but explicitly flagging this as the one item on this list closest
  to a genuine product call rather than a technical one — whoever owns the widget's own roadmap
  and release process should weigh the coupling cost against how much the "closes automatically by
  default" experience matters, which isn't a judgment this design document should make unilaterally
  on their behalf.

### 3. Destination chain choice for v1

**The real options** are whichever EVM chains Circle's CCTP v2 actually supports as destinations
today (a real, checkable list from Circle's own docs, not enumerated here since it can drift) —
practically narrowed by which of those this project has ANY real, first-party experience with.
Today that's exactly one: **Ethereum Sepolia**, confirmed directly from
`packages/widget/e2e/harness.ts`'s real `to: { chain: "ethereum-sepolia" }` and
`submit-receive-message.mjs`'s real `viem/chains` import — not a second candidate weighed against
it, because no other chain has any real testnet run behind it in this repo yet.

- _Implies choosing Sepolia_: the fastest path to a working v1, since the destination contract
  address, the real gas/nonce-check RPC calls, and one full manually-completed transfer already
  exist as a proven reference (`submit-receive-message.mjs` itself is close to a manual prototype
  of exactly what this service automates). The real cost: Sepolia is a testnet — a genuine mainnet
  v1 needs its own separate "which mainnet chain first" decision later, informed by real integrator
  demand once any exists, which this document cannot substitute for.
- _Implies choosing differently_: only sensible if there's already a specific, real integrator
  asking for a different chain — in which case that demand should override "most existing
  experience," since building for testnet-only convenience when a real mainnet user needs a
  different chain would optimize for the wrong thing.
- **My read**: Sepolia for the FIRST, testnet-proving build (reuses real, already-working
  reference code directly); the actual mainnet destination-chain choice is a separate decision to
  make later, explicitly informed by real demand, not decided now by default.

### 4. How much outbound traffic is expected to bypass the widget/SDK entirely?

This is the question the whole push-vs-watch recommendation above rests on, so it deserves being
named as a real, checkable assumption rather than left implicit.

- **If the answer is "very little, in practice"** (most real outbound CCTP-via-Ferryline traffic
  goes through the widget or a direct SDK call that already calls `markSubmitted`): the push model
  as designed is sufficient, full stop — every real caller already has the tx hash it needs to
  register.
- **If the answer is "a meaningful fraction bypasses it"** (someone calls the router contract
  directly, e.g. from their own frontend, never touching `@ferryline/sdk`'s own tracking calls):
  those transfers would never get registered under a pure push model, and would sit exactly as
  undelivered as they do today, relayer or not — a real gap, not a hypothetical one, if this
  fraction turns out to be non-trivial.
- **How to actually find out, rather than guess**: this is checkable, not a permanent unknown —
  once the router contract has real mainnet traffic (via Repud.1's now-shipped `TransferSent`
  event), comparing on-chain `TransferSent` events against what the relayer actually got registered
  for would give a real, measured bypass rate, not a guess. That comparison itself is a nice,
  concrete use of the event this project just shipped.
- **My read**: ship push-only for v1 (this is what the scope document already states), but treat
  this specific question as the thing that would most directly justify building the watch-based
  fallback mentioned in the push-vs-watch section — worth deciding to build it only once there's a
  real measured bypass rate to justify the added complexity, not preemptively.

### 5. EVM RPC/library choice

**The real options**, at a glance: `viem` (already a real, existing dependency of both the SDK's
`usdt0-layerzero` adapter and the widget itself — see `packages/sdk/package.json`/
`packages/widget/package.json`) versus `ethers` (not currently used anywhere in this repo) versus
a raw JSON-RPC client.

- _Implies choosing viem_: zero new dependency to add, reuses a library this codebase's own
  authors are already fluent in reading/debugging (the same adapter code this project has already
  verified against real interfaces), and gives free access to the same real chain definitions
  (`viem/chains`) the E2E test and manual completion script already import.
- _Implies choosing anything else_: would need its own justification for why viem specifically is
  unsuitable for this new service's needs — nothing about `receiveMessage`'s call shape suggests
  it would be.
- **My read**: viem, close to a non-decision given it's already a real, proven dependency
  elsewhere in this exact codebase for this exact kind of call — flagged as its own numbered item
  mainly for completeness (a genuine implementation-detail choice, not a design-level safety
  question the way the other four are), not because there's a live debate to have about it.
