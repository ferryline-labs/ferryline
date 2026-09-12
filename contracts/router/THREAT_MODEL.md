# Ferryline router — threat model

Status: **STEP 2 complete.** `send_cross_chain` and `send_cross_chain_batch` are implemented in
`src/lib.rs`, invariant-by-invariant against the tests in `src/invariants.rs`. Every invariant below
now has a status of **implemented and tested**, with a pointer to its specific test(s) — see the
"Status" column in the threat table below, added so this document stays cross-referenceable against
real test names, not just a design doc that predates the code. See `SCOPE.md` for what v1 deliberately
does not cover, and this crate's STEP 2 report for coverage numbers and the mutation-testing pass that
verified each test actually catches the removal of its corresponding protection.

This follows the structure of Stellar's own STRIDE threat-modeling template
(`developers.stellar.org/docs/build/security-docs/threat-modeling`), which the SDF Audit Bank
requires as a precondition for requesting an audit — so this document is not just an answer to five
questions, it is meant to be reusable as-is when Audit Bank is engaged (per the roadmap's T1
tranche). Every finding below is verified against the actual pinned dependency
(`soroban-sdk = "27.0.6"`, confirmed in `Cargo.lock`) — either its real source, downloaded locally at
`~/.cargo/registry/src/.../soroban-sdk-27.0.6/`, or Stellar's own current documentation — not
inferred from EVM/other-chain intuition. Every claim below cites its source.

## Standing design rule: no live-state-derived value inside a `require_auth`-covered argument

**Added 2026-09-12, after STEP 6's real testnet fix. This is a permanent design rule for this
contract, not a note about one past bug — read this before adding or changing any call this router
makes that is a sub-invocation of a `require_auth`-covered address.**

Any argument that is part of a `require_auth`-covered invocation — directly on a top-level call, or
on a nested sub-invocation the authorized address's tree passes through — must be **stable across
a realistic simulate-to-apply time gap**. Concretely: never compute such an argument as a raw
function of live, unrounded, time-dependent host state (`env.ledger().sequence()`, a raw
timestamp, or anything else that can differ between the moment `stellar-cli` simulates-and-signs a
transaction and the moment it is actually applied on-chain, ordinarily a few seconds later — long
enough for at least one real ledger to close on Stellar testnet's ~5-second ledger time).

Soroban's authorization-tree matching (confirmed directly against `soroban-env-host` 27.0.1's own
`src/auth.rs`, `maybe_extend_invocation_match`) requires a live call's FULL arguments — not just the
target contract and function name — to exactly equal what was signed. A live-state-derived argument
that drifts between simulate-time and apply-time makes the real call's arguments match NO node in
the signed authorization tree, which the host reports as `"Unauthorized function call for
address"` — not a signature failure, an absence-of-match failure. This class of bug is
particularly dangerous because it passes local unit tests (where simulated time never advances
between "sign" and "apply," since there is no real network round trip) and can even pass on a live
network intermittently, whenever the simulate-to-submit gap happens to land inside one ledger — see
STEP 6's real, confirmed instance of exactly this, in `dispatch_one_leg`'s `approve` call
(`live_until_ledger`), for the full mechanism, the real transaction hashes that failed, and the fix.

Two ways to satisfy this rule, matching the router's own already-established pattern for
caller-supplied vs. internally-fixed values (see `Dest`'s own doc comment): a value with genuine
per-call meaning that only the caller can decide (`max_fee`, `min_finality_threshold`,
`refund_address`) must be a **caller-supplied argument**, bound once at authorization time and
passed through unchanged, never recomputed inside the callee. A value that needs to be "current,
but not too precisely current" (an expiration/validity window, like `approve`'s
`live_until_ledger`) may be computed internally, but only if **rounded to a bucket coarse enough**
that simulate-time and apply-time computations land on the identical result — see
`approve_live_until_ledger` in `src/lib.rs` for the concrete pattern. A value with no real per-call
variation at all should be a fixed constant (`destination_caller`'s CCTP convention is the existing
example).

## What are we working on?

**Data flow.** A caller contract (a payroll, vault, or escrow contract — anything implementing its
own authorization, e.g. a smart account) invokes `Router::send_cross_chain(payer, rail, dest,
amount)` or a future batch entry point. The router is a **thin dispatcher**: per the sign-off
context, it must not reimplement `@ferryline/core`'s decimal handling, address encoding, or
forwarder-field rules — see Invariant 2 for why that reuse can only ever be structural (same
argument shapes, same verified constants), never a runtime call into TypeScript.

```
Caller contract (payer's own require_auth already satisfied, per the caller's OWN rules)
        |
        v
Router::send_cross_chain(payer: Address, rail: Rail, dest: Dest, amount: i128)
        |
        +-- payer.require_auth_for_args(...)        <- THIS document's Invariant 1
        |
        +-- Rail::Usdc  -> invoke_contract(TokenMessengerMinter, "deposit_for_burn_with_hook", ...)
        |                  (real mainnet interface: packages/core/verified/cctp-token-messenger-minter.mainnet.rs)
        |
        +-- Rail::Usdt0 -> invoke_contract(OFT contract, "send", SendParam { ... })
                           (real mainnet interface: packages/sdk/src/rails/usdt0-layerzero/generated/oft.ts)
```

Both rail targets are themselves Soroban WASM contracts already deployed on mainnet. The router's
own on-chain footprint (Invariant 4) is whatever aggregate storage it writes to make volume
verifiable.

## What can go wrong?

### STRIDE reminders

| Mnemonic Threat            | Definition                                                                              | Question                                     |
| -------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| **S**poofing               | The ability to impersonate another user or system component to gain unauthorized access | Is the user who they say they are?           |
| **T**ampering              | Unauthorized alteration of data or code                                                 | Has the data or code been modified?          |
| **R**epudiation            | The ability for a system or user to deny having taken a certain action                  | Can we prove what happened?                  |
| **I**nformation Disclosure | The over-sharing of data expected to be kept private                                    | Is anything exposed that should be private?  |
| **D**enial of Service      | The ability for an attacker to negatively affect availability                           | Can availability or correctness be degraded? |
| **E**levation of Privilege | Gain additional privileges and roles beyond what were initially granted                 | Can an unauthorized action be performed?     |

### Threat table

Five threats below map directly onto the sign-off's five numbered invariants (labeled to match), plus
one the platform research surfaced that the original five did not name explicitly (`Elev.2`).

The six invariants below (Elev.1/Tamper.1/Dos.1/Dos.2/Elev.2/Spoof.1) have EQUAL standing per the
STEP 1 sign-off and are all implemented and tested as of STEP 2. Info.1's protection is folded into
Tamper.1 (`pack_destination`'s own length check). Tamper.2 is confirmed dormant (the router's
current call graph vacuously satisfies it) with an explicit tripwire for when that changes. Repud.1
is confirmed as real, deferred, non-blocking scope, with an explicit dependency noted for when it
stops being deferrable. See each row for the full reasoning.

| Threat                                                                                                          | Issues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Elev.1 — Authorization invariant**                                                                            | `send_cross_chain` must move funds only when `require_auth` was checked for the EXACT payer, amount, and destination that actually execute. See "Elev.1: authorization invariant" below for the concrete mismatch scenario and why it is real, not hypothetical, on this platform.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Implemented and tested, single-send and batch cases both — see "Elev.1, batch case" below (added STEP 8) for why the batch case needs its own explicit design statement, not just a mechanical extension of the single-send reasoning.** `send_cross_chain` calls `payer.require_auth()` once (binds to the actual invocation's own arguments automatically — no separate authorized-values list to drift from). `send_cross_chain_batch` ALSO calls `payer.require_auth()` exactly once — as of STEP 8, moved to before the leg-dispatch loop (previously once per leg, a real bug fixed after a real testnet failure; see STEP 7/STEP 8 sections). Single-send tests: `elev_1_authorization_binds_exact_payer_amount_and_destination`, `elev_1_unauthorized_payer_cannot_move_funds`, `elev_1_authorized_amount_and_executed_amount_cannot_drift`. Batch tests (STEP 8): `elev_1_batch_authorization_binds_every_legs_amount_and_destination_not_just_payer_identity` (adversarial: one signed batch cannot authorize a DIFFERENT batch with an altered leg), `elev_1_batch_unauthorized_payer_cannot_move_funds` (a completely unauthenticated batch call is rejected). Mutation-verified for both cases: removing `require_auth()` from either function makes its own dedicated unauthorized-call test fail (confirmed by direct tests); the batch mutation also surfaced that even with the router's own check removed, the real SAC's own internal `approve` requirement and Soroban's own "authorization not tied to the root invocation" recording-mode safety net independently reject an unauthorized batch too — genuine platform defense-in-depth, recorded but not relied upon in place of the router's own check. |
| **Tamper.1 — No parallel encoding invariant**                                                                   | If the router independently re-derives any encoding `@ferryline/core`/`@ferryline/sdk` already computes (address bytes, hook data, decimal scaling), the two implementations can silently drift, producing a fund-misdirection bug neither side's own tests would catch. See "Tamper.1" below for what the router actually needs to encode and why it turns out to need almost none of it.                                                                                                                                                                                                                                                                                                                                                                         | **Implemented and tested.** No parallel encoding exists — `dispatch_one_leg` passes native Soroban types directly as cross-contract call args. The one genuine Rust-side logic, `pack_destination`'s 32-byte validation, is tested by `tamper_1_destination_packing_round_trips`, `tamper_1_destination_packing_rejects_wrong_length`, and a 256-case property test (`pack_destination_round_trips_for_any_32_byte_input`, `pack_destination_rejects_any_non_32_byte_length`). Mutation-verified: removing the length check makes the property test fail with a real `Abort` (confirmed by direct test).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Dos.1 — Batch atomicity invariant**                                                                           | An unproven assumption about all-or-nothing batch semantics, carried over from EVM intuition, could be silently wrong on Soroban (a different platform, different rollback model) and only discovered once a batch partially executes on mainnet. See "Dos.1" below for the real, host-source-confirmed answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Implemented and tested.** Every leg uses `atomic_invoke`, a NAMED wrapper (per the STEP 2 sign-off's explicit instruction) around the platform's default panic-on-failure `env.invoke_contract` — never `env.try_invoke_contract`. Tests: `dos_1_one_leg_impossible_rolls_back_the_whole_batch`, `dos_1_one_leg_impossible_rolls_back_router_owned_state_too`, `dos_1_all_legs_impossible_rolls_back_cleanly`, plus a source-level structural guard (`dos_1_atomic_invoke_is_the_only_call_site_and_never_uses_try_invoke`) that fails if a second call site or a `try_invoke_contract(` swap is ever introduced. Mutation-verified for both the behavioral tests and the structural guard (confirmed by direct tests).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Dos.2 — No unbounded state growth invariant**                                                                 | The volume-footprint feature could let an attacker grow router storage for free (spamming tiny sends to bloat rent), if the router is structured naively. See "Dos.2" below — the real answer inverts the naive assumption, but two real cost-shifting paths remain.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Implemented and tested.** `volume()` reads a fixed set of aggregate counters (one per `Rail` variant, plus the two constructor-set contract-address entries) — never a per-transfer or caller-indexed entry. Test: `dos_2_storage_footprint_does_not_grow_with_transaction_count`, which measures the router's real instance-storage entry count before/after 50 sends and asserts it is unchanged and bounded (≤4 entries). Mutation-verified: adding a genuinely per-call growing entry makes this test fail with an exact, specific growth count (confirmed by direct test).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Elev.2 — No reentrancy/callback invariant**                                                                   | The router calls into rail adapters and token contracts; if internal state is not finalized before an external call, a malicious or compromised rail contract could observe or exploit a partially-updated router state. See "Elev.2" below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Implemented and tested — with an important STEP 2 correction, read this before relying on it.** The originally-planned reentrant-callback test cannot run: Soroban's host rejects the exact attack scenario outright (`ContractReentryMode::Prohibited` by default), confirmed empirically (`elev_2_platform_reentrancy_prohibition_blocks_the_exact_attack_this_invariant_worries_about`). **This invariant's safety margin rests PARTLY on that platform default, not solely on router code** — `soroban_sdk` exposes no contract-author-facing API to weaken it, but a future host/SDK upgrade changing the default, or a future feature needing a different invocation primitive, could silently erode it; nothing in this test suite can detect a host-level default change directly, only the regression alarm of this specific test starting to pass instead of panic. Write-ordering is separately proven by a lexical source-order test (`elev_2_volume_write_is_lexically_after_the_external_call_in_source`) — this is the SOLE test that actually discriminates write-before-call from write-after-call; a corrected finding from this crate's own mutation-testing pass (`elev_2_dos_1_tests_do_not_independently_prove_write_ordering_only_atomicity`) proves the earlier assumption that Dos.1's rollback tests would also catch this was WRONG (Soroban's rollback-on-panic undoes a prior write in the same frame identically to no write at all, so the failure path cannot distinguish the two).                                                                                                                                                                                                             |
| **Spoof.1 — Rail contract identity spoofing**                                                                   | The router's `Rail`/`Dest` types name a rail (`Usdc`, `Usdt0`) and a destination domain/EID, but the actual TokenMessengerMinter/OFT contract ADDRESS the router calls must be a router-owned constant or verified config, never a caller-suppliable parameter — otherwise a caller could redirect `send_cross_chain` to invoke an arbitrary contract instead of the real rail contract, spoofing "this went through the real CCTP/LayerZero path" while actually calling anything. Adopted with EQUAL standing to the original five per the STEP 1 sign-off.                                                                                                                                                                                                      | **Implemented and tested.** Rail contract addresses are set once via `__constructor` and read from fixed instance-storage keys; `send_cross_chain`/`send_cross_chain_batch`'s signatures have no `Address` parameter used as an invocation target. Tests: `spoof_1_public_entry_points_have_no_caller_suppliable_contract_address_parameter` (structural), `spoof_1_dispatch_uses_the_constructor_set_address_for_the_matching_rail` and `spoof_1_constructor_argument_order_maps_usdc_and_usdt0_to_the_right_slot` (behavioral, using genuinely distinguishable stub contracts after this crate's own mutation-testing pass found the ORIGINAL versions of these two tests used interchangeable stubs and could not actually detect a constructor-argument transposition bug — see git history and each test's own doc comment for the full finding), and `spoof_1_rail_dest_mismatch_is_rejected_not_silently_trusted` (a narrower guard against an inconsistent `rail`/`dest` pair, added after this crate's own coverage measurement found the mismatch panic branch was never exercised by any prior test). All mutation-verified (confirmed by direct tests).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Tamper.2 — Signed-tree shape must match the real call graph**                                                 | Per the authorization docs' "Matching Authorized Invocation Trees" rule (cited under Elev.1), a `require_auth`/`require_auth_for_args` call signs a specific call-path SHAPE (which contract calls which function calls which function), not just "this address authorized this data." If the router's actual invocation path (router -> rail contract) differs from what a caller/smart-account signed for, the auth fails closed (good for safety) but this needs an explicit test proving it fails closed rather than silently degrading to some other check.                                                                                                                                                                                                   | **Confirmed dormant — vacuously satisfied by the router's current call graph, no code needed now.** Checked directly against `dispatch_one_leg`: every leg today is exactly two levels — `send_cross_chain`/`send_cross_chain_batch` calls `payer.require_auth()` directly inside itself, then makes ONE direct call to a rail contract via `atomic_invoke`. There is no third hop anywhere in the current implementation, so there is no live call-graph-mismatch scenario for this invariant to catch yet. **Tripwire, not a task for this phase: Tamper.2 MUST be re-examined with a real test before any future change gives the router's call graph a third level** — an intermediate contract the router calls through, or a rail contract calling back through the router. Whoever adds such a feature should read this row first and add the missing test as part of that change, not discover the gap afterward.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Repud.1 — No repudiation source for what actually executed**                                                  | If the router does not emit a structured event per successful `send_cross_chain`/batch leg (payer, rail, destination, amount, the exact args passed to `require_auth`), there is no independent record to reconstruct what happened for a disputed transfer, and the roadmap's own risk register (`technical-doc.md`, "Router event stream") already commits to this as a mitigation.                                                                                                                                                                                                                                                                                                                                                                              | **Confirmed real, deferred, non-blocking scope.** No event emission exists yet; `send_cross_chain`/`send_cross_chain_batch` return `()`. The router's three fund-safety invariants tested in STEP 2 (Elev.1 authorization, Dos.1 atomicity, Dos.2 bounded storage) all hold independent of this — Repud.1 is about after-the-fact observability, not execution-time correctness, so its absence does not weaken anything already implemented. Scheduled as its own future piece of work (event emission for per-transfer observability); does not block testnet deployment. **Explicit dependency: this MUST land before the roadmap's metrics page or any adoption-milestone verification (`technical-doc.md`'s adoption-milestones table) depends on per-transfer on-chain data** — today's aggregate `volume()` counters (Dos.2) can attest total volume moved, but cannot attest anything about a SPECIFIC transfer, which per-transfer verification would need. Whoever builds the metrics page or verifies an adoption milestone against router activity should check this row first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Info.1 — Hook data / destination bytes are not secret, but must not be truncated or misinterpreted silently** | CCTP's `mint_recipient`/`destination_caller` and the forwarder's hook data (see `packages/sdk/src/rails/usdc-cctp/message.ts`) are fixed 32-byte fields. If the router accepts caller-supplied destination bytes without validating length/format before forwarding, a malformed value could be silently zero-padded or truncated by a downstream ScVal conversion, sending funds to an unintended address that happens to share a byte prefix. This is a real, previously-seen class of bug in this project (see the phase-3 nonce-length validation fix in `@ferryline/sdk`, documented in its CHANGELOG) — the router needs the equivalent length/format check before it ever calls the rail contract, not a lower bar just because it is a different language. | **Implemented and tested — folded into Tamper.1.** `pack_destination`'s exact-32-byte check IS Info.1's protection; see Tamper.1's row above for its tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

### Elev.1: authorization invariant

**Restated in terms of the real API** (per `soroban-sdk` 27.0.6's `Address::require_auth`/
`require_auth_for_args`, `src/address.rs`, confirmed against the locally-downloaded crate source —
not assumed): `send_cross_chain(payer: Address, rail: Rail, dest: Dest, amount: i128)` must call
`payer.require_auth_for_args(vec![payer_val, rail_val, dest_val, amount_val])` (or the equivalent
plain `payer.require_auth()`, which the SDK's own doc comment says infers "all the invocation
arguments" automatically) using the **exact same `amount`, `dest`, and `payer` values that the
function goes on to actually pass to the rail contract's `deposit_for_burn_with_hook`/`send` call** —
not a value computed before some later adjustment step.

**Confirmed as a real, not hypothetical, risk on this platform**, from the SDK's own doc comment
(`address.rs`, `require_auth_for_args`): _"The arguments don't have to match the arguments of the
contract invocation."_ This is the platform explicitly telling implementers that nothing enforces the
binding between what was authorized and what a function does afterward — that binding is the
**contract author's responsibility**, not a guarantee Soroban provides automatically. Two concrete
ways this could go wrong in `send_cross_chain`, both realistic given the rail-fee/decimal handling
this router touches:

1. **Fee-adjustment-after-auth.** If `send_cross_chain` calls `payer.require_auth_for_args(&[payer,
rail, dest, amount])`, then later computes `let net_amount = amount - protocol_fee(amount)` and
   sends `net_amount` to the CCTP/OFT call instead of `amount`, the authorization check already
   passed for `amount` — a different number than what actually moves. If `net_amount` could be
   **larger** than `amount` under some future fee-rebate logic, this is a direct fund-authorization
   bypass (the payer authorized $X, more than $X moves). If `net_amount` is always smaller, this
   specific direction is not a fund-safety bug today, but it is still an authorization-correctness
   bug: the signed payload no longer describes what happened, which breaks the Repud.1 record and
   would fail an audit against the STRIDE template's own "Has the data been modified?" tampering
   question.
2. **Decimal-scaling mismatch.** `amount` sent to `require_auth_for_args` must be in the same units
   as the actual on-chain call. CCTP's Stellar-side `deposit_for_burn` takes "7-decimal Stellar
   units" per `packages/sdk/src/rails/usdc-cctp/stellar.ts`'s own doc comment, while the CCTP message
   itself is always 6-decimal. If the router authorizes in one unit and calls the rail contract in
   another (a scaling bug, not a malicious one), the _value_ authorized and the _value_ moved could
   differ by orders of magnitude while `require_auth_for_args` still reports success, because nothing
   about the authorization framework understands "decimals" — it only compares the raw `Val` the
   contract handed it.

**Test that would catch this** (scaffolded, not yet real logic — see `src/test.rs`): construct a
`send_cross_chain` call where the function internally computes a _different_ amount after the
`require_auth_for_args` call than what it started with (simulating either bug above), using
`env.mock_auths(&[...])` with an explicit `MockAuthInvoke` naming the _original_ amount, then assert
via `env.auths()` (not just "it didn't panic") that the specific args recorded in the authorized
invocation tree match what the rail contract was actually invoked with. Per the fuzz-tooling
research: **`mock_all_auths()` alone would NOT catch this** — the SDK's own example
(`address.rs`) and the fuzz-tooling agent's findings both flag that `mock_all_auths()` makes _any_
`require_auth` call succeed regardless of arguments, so a test using only `mock_all_auths()` passes
even if the router is missing the check entirely, let alone checking the wrong values. The scaffold
therefore uses `mock_auths` with an explicit, narrow grant plus an `env.auths()` assertion, never
`mock_all_auths()` unaccompanied, for anything auth-related.

### Elev.1, batch case: `send_cross_chain_batch` — added 2026-09-12, STEP 8

**Stated plainly, as its own design property, not a simplification of the single-send case above:
`send_cross_chain_batch` is authorized by exactly ONE `payer.require_auth()` call, made once,
before any leg is dispatched — not once per leg.** This single call binds to the CURRENT
INVOCATION'S FULL ARGUMENTS automatically (the same `require_auth()` behavior cited above, applied
here to the batch entry point specifically): the entire `legs: Vec<(Rail, Dest, i128)>` array, byte
for byte — every leg's own `rail`, `dest`, and `amount` — not merely the `payer` address's identity.
**The whole batch is authorized as one atomic unit, both at the execution level (already true via
Dos.1's all-or-nothing rollback) and, as of STEP 8, explicitly at the authorization level too**:
one signature covers the complete, exact set of legs as submitted; there is no notion of
"authorizing leg 1 but not leg 2" within a single `send_cross_chain_batch` call, by design.

**This was not always the design, and the change from N calls to 1 was a real correction, not an
arbitrary simplification — the full mechanism is recorded in STEP 7/STEP 8 below.** The original
STEP 2 implementation called `payer.require_auth()` once PER LEG, inside the dispatch loop, on the
mistaken belief that this produced N independent, per-leg authorizations (see this file's own STEP 7
section for the real testnet failure — `"frame is already authorized"` — that disproved this).
Soroban's authorization model binds `require_auth()`'s `AuthorizedFunction` to the CURRENT STACK
FRAME's own invocation, which for every iteration of a flat loop is the SAME frame — so calling it N
times never provided N distinct authorizations; every one of those N calls authorized the exact
same thing (this whole batch invocation), and the Nth call was simply asking the host to re-confirm
an authorization it had already granted. **Calling `require_auth()` once, at the top, is therefore
the correct realization of what this mechanism always actually provided — realized correctly for
the first time, not a weakening of a guarantee that never genuinely existed in the N-calls version.**

**Confirmed by direct, adversarial test — not by design reasoning alone**
(`elev_1_batch_authorization_binds_every_legs_amount_and_destination_not_just_payer_identity` in
`src/invariants.rs`): mocks a real authorization for a SPECIFIC two-leg batch (via `mock_auths`,
which constructs a real `xdr::SorobanAuthorizationEntry` and exercises the real enforcing-mode
`AuthorizedFunction`-equality matching, not a test-only shortcut), then attempts to submit a
DIFFERENT batch — leg 2's amount altered after the mock was constructed — through that SAME mocked
authorization, and confirms this is rejected. Self-checked before trusting it (per this crate's own
discipline): temporarily submitted the UNTAMPERED legs through the identical mock first and
confirmed that succeeds cleanly, proving the panic is specifically caused by the tampering, not an
unrelated setup mistake.

**Mutation-tested, and a real gap found and closed as part of doing so**
(`elev_1_batch_unauthorized_payer_cannot_move_funds`): removing `payer.require_auth()` from
`send_cross_chain_batch` entirely was a real mutation that ALL pre-existing tests (28 at the time)
failed to catch — no test exercised "does the batch function reject a call with NO authorization at
all," the batch-scoped mirror of `elev_1_unauthorized_payer_cannot_move_funds`'s single-send
coverage. Added directly, mocking authorization to a different address than the real payer (the
same technique the single-send version uses). Also verified, by diagnostic (not committed): the
router's own check is the one this test exercises against real code (the panic occurs on
`send_cross_chain_batch` itself, before `dispatch_one_leg` runs), but even with the router's own
check mutated away, the real SAC's own internal `approve` requirement and, separately, Soroban's
own recording-mode "authorization not tied to the root invocation" safety net both independently
reject an unauthorized batch too — genuine defense-in-depth on this platform, not a reason to treat
the router's own check as optional.

### Tamper.1: no parallel encoding invariant

**What the router actually needs to encode, checked against the real function signatures the router
would call (not assumed):**

- CCTP outbound: `TokenMessengerMinter.deposit_for_burn_with_hook(caller: Address, amount: i128,
destination_domain: u32, mint_recipient: BytesN<32>, burn_token: Address, destination_caller:
BytesN<32>, max_fee: i128, min_finality_threshold: u32, hook_data: Bytes)` — verbatim from
  `packages/core/verified/cctp-token-messenger-minter.mainnet.rs`, itself a real `stellar contract
info interface` dump against the deployed mainnet contract (`CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL`).
- USDT0 outbound: OFT's `send(from: string, send_param: SendParam, fee: MessagingFee,
refund_address: string)`, where `SendParam { amount_ld: i128, dst_eid: u32, to: BytesN-shaped
32-byte buffer, min_amount_ld: i128, extra_options/compose_msg/oft_cmd: bytes }` — verbatim from
  the SDK's own generated Soroban contract client, `packages/sdk/src/rails/usdt0-layerzero/generated/oft.ts`.

**Finding, confirmed against real Soroban platform semantics, not assumed:** a Soroban contract
cannot invoke TypeScript/Node.js code at runtime under any circumstances. This is not a sandboxing
restriction that can be loosened — it is structural. Per Stellar's own documentation
(`environment-concepts.mdx`, `rust-dialect.mdx`): the on-chain guest environment is isolated inside a
WebAssembly VM whose only outbound reach is host functions and cross-contract calls to _other WASM
contracts_; a module that imports networking, I/O, or multithreading primitives "will fail to
instantiate." So the premise "the Rust-side logic can defer to already-verified TypeScript logic at
runtime" is a **category error** — it cannot mean runtime deference, only that the router's Rust code
and `@ferryline/core`'s TypeScript code independently agree on the same real, verified constants
(contract addresses, domain IDs, argument order) documented in the same source-of-truth files
(`packages/core/verified/*.rs`), the way `packages/sdk`'s own TypeScript already does.

**Given that, does any genuine Rust-side encoding logic need to exist?** Looking at both call shapes
above: every field the router populates is a native Soroban type (`Address`, `i128`, `u32`,
`BytesN<32>`, `Bytes`) passed directly as a cross-contract call argument. Soroban's own
`env.invoke_contract`/generated client machinery marshals these natively — there is no byte-level
XDR construction the router's Rust code must perform by hand, unlike `@ferryline/sdk`'s TypeScript
(which builds raw XDR for an _off-chain-constructed_ transaction envelope, a fundamentally different
job that only exists because that code runs before a transaction is ever submitted). **The one place
the router does need real, non-trivial Rust logic is converting a caller-supplied recipient
representation into the `BytesN<32>` shape `mint_recipient`/`to` expect** — but per `Info.1` above,
this is a fixed-width byte-packing/validation operation (does the caller's input decode to exactly 32
bytes, in the right encoding for the destination chain family), not the multi-decimal-precision
scaling or strkey-checksum logic `packages/core`'s `amount.ts`/`address.ts` perform, which only makes
sense against off-chain string representations a Soroban contract never receives directly (a Soroban
caller passes typed values, not decimal strings).

**Conclusion:** no parallel encoding needs to exist in Rust for either rail's call construction. If
implementation reveals a genuine need for byte-packing logic (e.g. a generic "chain-agnostic 32-byte
destination" validator), it needs its own round-trip property test (build bytes -> the exact
`BytesN<32>`/`Bytes` value a real deployed rail contract would accept -> parse back, matching the
rigor of `packages/core`'s existing address/amount property tests) — flagged here as a decision to
make explicitly during STEP 2, not assumed away.

### Dos.1: batch atomicity invariant

**Confirmed from `soroban-sdk` 27.0.6's own source** (`src/env.rs`, both functions read directly from
the locally-installed crate) **and from the host implementation** (`rs-soroban-env`,
`soroban-env-host/src/host/frame.rs`), not inferred from EVM behavior:

- `Env::invoke_contract`'s own doc comment: _"Will panic if the contract that is invoked fails or
  aborts in anyway."_ This is the **default** cross-contract call path (also reachable via a generated
  client's plain method, e.g. `client.send(...)`). A panic during Soroban WASM execution is a trap;
  per Stellar's own docs (Errors guide, cited by the platform-semantics research): _"If an error is
  returned from a function anything the function has done is rolled back... all those changes are
  reverted."_ Confirmed at the host-implementation level: each call frame is its own sub-transaction
  with a `RollbackPoint` snapshotting storage/events/auth (`frame.rs`), and an uncaught trap
  propagating to the top-level invocation rolls back everything, all the way up.
- `Env::try_invoke_contract` exists specifically to opt OUT of that default: it returns a `Result`
  instead of panicking, so a contract _can_ catch one leg's failure and continue — but only if it
  deliberately chooses `try_invoke_contract`/a generated client's `try_*` method for that call. This
  is a **contract-author decision**, not a platform default.
- **v1's all-or-nothing decision (already made — see `SCOPE.md`) is therefore the platform's own
  default behavior for the batch loop**, achieved simply by having each leg use the plain
  `invoke_contract` path (or a generated client's non-`try_` method) rather than `try_invoke_contract`.
  This needs to be an explicit, commented choice in the implementation, not an accident of which
  client method happened to be reached for first — a future maintainer switching to a `try_` variant
  "to add better error messages" would silently change v1's atomicity guarantee.
- **Caveat that matters for the "isolated per leg" future version already deferred in `SCOPE.md`**:
  `try_invoke_contract` does not catch everything. Resource-limit errors (exceeded CPU/memory budget,
  or touching a ledger entry outside the transaction's declared footprint) and internal host errors
  trap uncatchably regardless of `try_`/non-`try_` choice — "a contract does not choose which errors
  are recoverable... the rule is the same for every contract" (Stellar's Contract Interactions
  Overview docs). A future isolated-per-leg batch design cannot assume `try_invoke_contract` alone
  gives true per-leg isolation; it would need to reason about which failure modes are actually
  catchable, a design question explicitly out of scope for v1 (see `SCOPE.md`).

**Tests that would catch a wrong assumption here** (scaffolded — see `src/test.rs`): "one leg
impossible" (a batch of two legs where the second leg's rail contract call is guaranteed to trap —
e.g. calling with an amount exceeding what a test double will accept — asserting the FIRST leg's
state changes, and the router's OWN storage writes made before the failing call, are also rolled
back, not just the failing leg's own effects) and "all legs impossible" (every leg fails, asserting
the whole transaction reverts cleanly with no partial router-side storage mutation surviving).

### Dos.2: no unbounded state growth invariant

**What "an on-chain footprint for measuring volume" actually needs to be**, per `technical-doc.md`'s
own framing (not assumed): _"the relayer account and the router contract are on-chain footprints
anyone can check"_ — this describes an **aggregate, independently-verifiable total**, not a
transaction-by-transaction history. A bounded set of running counters (e.g. total volume per asset,
readable via a `view` function) satisfies "anyone can check" without storage growing per-transfer at
all. This reframes the naive worry (one storage entry per send, unbounded growth) into a much smaller
actual risk surface, once the feature is scoped this way rather than as an audit log.

**Confirmed, and inverted from a plausible-but-wrong assumption**, from Stellar's own fee/storage
documentation: Soroban's rent/storage-write cost is charged to the **transaction's source account**
as part of its resource fee (Fees, Resource Limits, and Metering docs) — _"deducted from the source
account"_ — not funded from a pool the contract itself must maintain. So the naive "attacker spams
tiny sends to bloat the router's own storage rent bill" does not directly apply the way it would on a
platform where the contract deployer pays ongoing storage costs regardless of caller. **However, two
real cost-shifting paths remain, both documented by Stellar itself, and both directly relevant to how
the aggregate-counter design gets implemented:**

1. If the counter-update logic calls `extend_ttl()` on the counter's own storage entry as part of
   every `send_cross_chain` (a pattern Stellar's own "Persisting Data" guide recommends for
   autonomous contracts maintaining shared state), that TTL-extension cost is charged to _whichever
   caller's transaction happens to trigger it_ — meaning a caller who merely triggers routine upkeep
   pays a cost unrelated to their own transfer's size, and if the router's maintainer relies on a
   cron job to keep the counter alive independently, that cron job's cost is a real, ongoing
   maintenance cost the maintainer bears (documented directly as the intended mitigation pattern, not
   a bug — but worth naming so it is a deliberate operational cost, not a surprise).
2. If the volume counter is naively a single collection (e.g. one `Vec`/`Map` keyed by transfer id
   rather than one small fixed set of aggregate totals), Stellar's storage-strategies guide documents
   that such a structure is read and written **in full** on every update — cost grows with the
   collection's total size, every caller pays for everyone's accumulated data, and writes hard-fail
   past the 64 KiB single-entry limit. This is exactly the naive design invariant 4 originally
   worried about, and it is a real, documented "red flag in review," not a hypothetical — it is simply
   avoidable by construction (aggregate counters in fixed, well-known storage keys; never a
   caller-indexed growing collection) rather than needing a minimum-amount floor or a storage-cost
   passthrough as the fix.

**Proposal, to make explicit rather than assumed:** the volume footprint should be a small, fixed
number of aggregate counters (at minimum: cumulative volume per asset), stored under fixed instance-
storage keys, updated by simple addition on each successful `send_cross_chain`/batch leg, with no
per-transfer entry and no caller-indexed collection. `extend_ttl` calls on this storage, if any,
should be deliberate and their cost accounted for as an operational cost of the router (documented in
`SCOPE.md`/an operations doc), not discovered later as a surprise line item. This needs its own test
proving storage size does not grow with transaction _count_, only remains a small, fixed footprint
regardless of how many sends occur.

### Elev.2: no reentrancy/callback invariant

**Confirmed at the host implementation level, not merely from documentation** (`rs-soroban-env`,
`soroban-env-host/src/host/frame.rs`): reentrancy is `ContractReentryMode::Prohibited` by default in
both `default_external_call()` and `default_internal_call()` — enforced by the host itself, not a
convention contracts must remember to follow. This means the checks-effects-interactions pattern's
EVM-style _purpose_ (preventing a callee from re-entering the caller mid-execution to observe stale
state) is substantially covered by the platform default, differently from how EVM requires the
contract author to enforce it manually. The enum admits `SelfAllowed`/`Allowed` variants too, so this
default should be treated as the current platform behavior to verify against at implementation time,
not an eternal guarantee to hardcode an assumption around without a test.

**What still needs explicit verification, given that default:** the router calls into rail contracts
(TokenMessengerMinter, the OFT contract) which are themselves complex contracts the router does not
control and has not audited. Even with reentrancy prohibited at the host level, the router must still
finalize any of its own storage writes (the Dos.2 volume counters, and any per-transfer bookkeeping
STEP 2 introduces) **before** making the outbound `invoke_contract` call for that leg, for two reasons
independent of reentrancy: (a) the crash-safety property this project has applied consistently
elsewhere (see the relayer's "write status before broadcast" pattern in
`packages/relayer/src/work/submit.ts`) — if the router's own bookkeeping write happened _after_ the
external call and the transaction failed to fully commit for an unrelated reason, the two would be
inconsistent; and (b) `try_invoke_contract`'s isolation (Dos.1) only rolls back the _callee's_ frame,
not the router's own already-committed writes in the same frame — so if a batch leg's own
router-side bookkeeping runs after a `try_`-wrapped call that then fails, the router must not have
already assumed success and written state reflecting it.

**Test that would catch a violation:** a test double rail contract that, when invoked, reads the
router's own exposed volume-counter state (via a cross-contract call back into the router, simulating
either a malicious or merely buggy downstream contract) and asserts what it observes — proving the
counter was NOT yet incremented for the in-flight leg at the moment the external call was made
(finalize-after-call, not before), while still being correctly incremented once that leg's frame
successfully returns.

## What are we going to do about it?

Remediations are the corresponding property/fuzz tests scaffolded in `src/test.rs` (see the STEP 1C
section of the accompanying report) plus these structural decisions to carry into STEP 2's
implementation:

| Threat       | Remediation                                                                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Elev.1.R.1   | `send_cross_chain`/the batch function call `require_auth_for_args` with the SAME bound values used in the actual downstream call, computed once and never re-derived after the auth check.      |
| Elev.1.R.2   | Every auth-path test asserts via `env.auths()` against an explicit `mock_auths` grant — never `mock_all_auths()` unaccompanied.                                                                 |
| Tamper.1.R.1 | No independent Rust re-derivation of any `@ferryline/core`-owned value; shared real constants live in `packages/core/verified/*.rs`-style dumps the router's own constants are checked against. |
| Dos.1.R.1    | Batch legs use the plain (non-`try_`) invocation path, with an explicit code comment naming this as the deliberate all-or-nothing choice.                                                       |
| Dos.1.R.2    | "One leg impossible" and "all legs impossible" tests both assert full rollback, including the router's own pre-call storage writes.                                                             |
| Dos.2.R.1    | Volume footprint implemented as a small, fixed set of aggregate counters under fixed storage keys — never a per-transfer or caller-indexed collection.                                          |
| Dos.2.R.2    | A test asserting router storage size is invariant to transaction count.                                                                                                                         |
| Elev.2.R.1   | Router's own storage writes for a leg happen only after that leg's external call returns successfully, not before.                                                                              |
| Spoof.1.R.1  | Rail contract addresses (TokenMessengerMinter, OFT) are router-owned constants/config, never a caller-suppliable argument to `send_cross_chain`.                                                |
| Repud.1.R.1  | A structured event emitted per successful leg, naming payer/rail/destination/amount and the args passed to `require_auth`.                                                                      |
| Info.1.R.1   | Explicit length/format validation on any caller-supplied destination bytes before they reach a rail contract call.                                                                              |

## STEP 3 — testnet deployment findings (2026-09-12)

The router was deployed to Soroban testnet and exercised with real transactions against the
real CCTP TokenMessengerMinter and (as a documented mainnet stand-in, since none exists on
testnet) the real USDT0 OFT. Full detail, transaction hashes, and real fee data are in
`TESTNET_DEPLOYMENT.md`; the load-bearing summary belongs here because it changes what "done"
means for `send_cross_chain`/`send_cross_chain_batch` as end-to-end functions, even though it
does not implicate any of the six invariants below.

**Finding: `send_cross_chain` cannot currently complete successfully against either real rail
contract, on any network.** The router's cross-contract call-building code
(`dispatch_one_leg` in `src/lib.rs`) sends the wrong argument shape to both rails —
`deposit_for_burn_with_hook` is missing 5 of its real 9 arguments (`burn_token`,
`destination_caller`, `max_fee`, `min_finality_threshold`, `hook_data`), and the OFT `send`
call sends 4 scalar values where the real interface requires a `SendParam` struct, a
`MessagingFee` struct, and a `refund_address`. Confirmed with real testnet transactions, not
inferred: CCTP traps with `Error(WasmVm, UnexpectedSize)` / `MismatchingParameterLen`; the
same trap reproduces inside a batch call and correctly rolls the whole transaction back
(volume counters confirmed at `0` after every failed attempt).

**Why STEP 2's 100%-branch-coverage, six-invariants-confirmed-by-mutation-testing unit tests
never caught this:** they tested against `RailStub`, a hand-written test double built to match
the router's own assumption of each rail's interface, not an independently-sourced one. This
was sufficient to prove everything those tests were designed to prove — `send_cross_chain`'s
own authorization binding, atomicity, storage bounds, rail-address integrity, and reentrancy
safety are all still correctly implemented and still hold. It was never sufficient to prove the
router calls a real rail contract correctly, which requires exactly what this phase did: a real
deployment and a real cross-contract call.

**Scope note, consistent with this phase's explicit boundary:** this is a reported finding, not
a fix. Implementing the correct CCTP/OFT call shapes is separate, future, not-yet-started work,
to be scoped and signed off on its own terms — the same discipline already applied to Repud.1
and the Tamper.2 tripwire above. `send_cross_chain` and the batch function are not safe to route
real funds through today; they are safe in the narrower sense STEP 2 verified (a payer's
authorization, funds, and destination cannot be forged, dropped, or partially executed) but that
narrower sense is necessary, not sufficient, for the functions to work end-to-end.

## STEP 4 — the fix, and STEP 5 — a second, real-network-only finding (2026-09-12)

STEP 4 fixed `dispatch_one_leg`'s call-building against the real interfaces in
`packages/core/verified/*.rs`: CCTP's arm now sends the correct 8 real arguments (plain
`deposit_for_burn` — see below for why not `_with_hook`), and the OFT's arm builds a real
`SendParam`/`MessagingFee` and calls the real on-chain `quote_send` first. Root cause, precisely:
STEP 2's own doc comment correctly verified the two function NAMES against the dumps but never
extended that check to the argument SHAPES — a partial-verification bug, not a wrong source. A new
structural test class, `src/interface_conformance.rs`, now parses the real interface dumps directly
and checks both count AND type-shape of every argument the router builds, closing the root cause
rather than just this one instance — mutation-tested twice, including one honest self-correction
(the first version of this check only verified count, which a real mutation test proved blind to
the OFT bug specifically; a second, shape-checking test was added and confirmed to catch it). A
third mutation-testing pass also found and fixed a real gap in the pre-existing
`dos_1_atomic_invoke_is_the_only_call_site_and_never_uses_try_invoke` guard (it missed a
turbofish'd `try_invoke_contract` call). All fixes and corrections are named, discoverable
functions/comments in the source, not silently patched. Full root-cause account, the mutation-
testing proof, and every fix: `TESTNET_DEPLOYMENT.md` §2.

A real testnet redeployment then found a SECOND, real bug the unit tests couldn't see: CCTP's
`_with_hook` variant requires non-empty `hook_data`, which the router had none to supply. Fixed by
switching to the plain, hook-free `deposit_for_burn` — the verified, purpose-built alternative,
not an invented placeholder. `TESTNET_DEPLOYMENT.md` §3.

**STEP 5's open finding, reported plainly rather than claimed as resolved:** a real
`send_cross_chain` CCTP send now SIMULATES completely successfully (confirmed via full, real event
data covering approve/transfer/burn/message-dispatch), proving the STEP 4 fix builds the exactly
correct call shape and the real CCTP contract accepts it. But real SUBMISSION of that identical,
correctly-built call fails, twice, reproducibly, with a real `"Unauthorized function call for
address"` error on the nested `approve` sub-invocation — despite the same address being used
throughout, despite Stellar's own authorization docs stating one signature should cover a
same-address nested tree, and despite a real single-hop version of the same `approve` call from
the same account succeeding cleanly. This was investigated as far as this phase's boundaries allow
(no raw key extraction, no routing around the platform) and is reported as a genuine, unresolved
discrepancy between Soroban simulation and real testnet application — not a bug in the router's
own logic (Dos.1's atomicity held perfectly through every failed attempt; nothing was lost or
stranded), but a real blocker to the sign-off's own completion bar for this phase ("a real
send_cross_chain... actually completes successfully on testnet"), which is NOT yet met. Full
investigation, every real transaction hash, and every ruled-out hypothesis: `TESTNET_DEPLOYMENT.md`
§4.3.

## STEP 6 — external verification of STEP 5's open finding (2026-09-12)

Per the sign-off's explicit instruction, no further fix was attempted before external input.
Search (Discord/GitHub/forums/general web, via a dedicated research pass) found nothing matching
this exact scenario — a genuine "nothing found," not a failed search (one gap: Stellar Stack
Exchange could not be directly accessed by the available tooling; not ruled out, just unresolved).
Full search results and every source checked: `EXTERNAL_REPORT_DRAFT.md`'s header note and the
STEP 6 conversation turn's own report.

A direct, primary-source re-read of `soroban-env-host` 27.0.1's own `src/auth.rs` (the exact host
version this project's Cargo.lock pins) — not just the docs page — found a specific, mechanically
precise candidate explanation, NOT yet confirmed by a controlled experiment (deliberately held
pending review, per the sign-off's instruction not to attempt further fixes): the authorization
tree's invocation-matching step (`maybe_extend_invocation_match`) requires a live call's FULL
arguments to exactly equal what was signed. The router's `approve` sub-invocation includes
`live_until_ledger = env.ledger().sequence() + APPROVE_LEDGER_WINDOW` — a value read from live
ledger state, recomputed fresh every time `dispatch_one_leg` executes, including once during the
CLI's simulate-and-sign step and AGAIN during real on-chain application, seconds apart. If even one
ledger closes between those two moments (ordinary on a ~5-second-ledger-close testnet), the two
computed values differ, the real call's arguments no longer match ANY signed node, and the host
reports exactly the "unauthorized" class of error observed — not because a signature is wrong, but
because there is no signed node left for the real call to match. A full reproduction, this
mechanism's explanation, and three open questions for Stellar's own maintainers are drafted in
`EXTERNAL_REPORT_DRAFT.md`, not yet posted, awaiting review — if this mechanism is confirmed by a
real, controlled fix-and-retest cycle rather than posted externally first, that report may not need
sending at all. Either way, whatever gets confirmed becomes an explicit lesson for this router: a
value covered by `require_auth` inside a nested sub-invocation must never be recomputed from live,
time-dependent state on the callee side — it must be a stable, caller-supplied top-level argument
(bound once, at authorization time) or a fixed constant, never derived fresh inside the callee.

**CONFIRMED by a real, controlled fix-and-retest cycle, same day.** `dispatch_one_leg`'s
`approve_live_until_ledger` (new function) rounds `env.ledger().sequence()` down to a fixed
20-ledger bucket before adding the validity window, so simulate-time and apply-time computations
land on the identical value as long as they fall in the same bucket — comfortably true for any
realistic submission delay. Two new direct unit tests prove this against a REAL simulated
ledger-sequence advance (stable across a 3-ledger gap; still advances past a 20-ledger boundary),
mutation-tested by reverting to the original computation and confirming the stability test fails
immediately. 27/27 tests pass, fmt/clippy clean, real WASM build succeeds. Redeployed to testnet
and re-attempted the exact call that failed twice in STEP 5: **`send_cross_chain` now completes,
for real, for the first time in this project's history** — tx
`5f91eb68a75f0a1bbcaded62d4dc2af37ccea795c984fae8c66eb9fdaace33b0`, `successful: true` (confirmed
via direct Horizon query), the router's own `volume(Usdc)` counter correctly updated to a real
non-zero value, and `demo-payer`'s real USDC balance correctly reduced by the exact amount burned.
`EXTERNAL_REPORT_DRAFT.md` was rewritten as a confirmation/documentation post (root cause + fix,
not a question) per this session's own instruction, and is queued for review before posting — this
is a genuine contribution worth making regardless of whether external confirmation was still
needed, since none was found and the mechanism is now independently proven correct.

**A new, distinct, real, NOT-yet-investigated finding, surfaced only because this fix let a real
send get far enough for the first time:** attempting a real `send_cross_chain_batch` (two legs,
one real, one deliberately bad — the rollback test case) failed at SIMULATION with
`Error(Auth, ExistingValue)` / `"frame is already authorized"` on the SECOND leg's
`payer.require_auth()` call — a different mechanism from the `live_until_ledger` bug (leg 1's own
`approve` and full call chain completed successfully first). This is reported here as a tripwire,
not folded into this fix: `send_cross_chain_batch`'s real-world testability is NOT yet confirmed,
and whoever picks this up next should start from `TESTNET_DEPLOYMENT.md` §5b's account of exactly
where the trace stopped, rather than re-deriving it.

## STEP 7 — batch authorization mechanism, root-caused (2026-09-12)

**Mechanism, confirmed via direct source reading (`soroban-env-host` 27.0.1's `src/auth.rs`),
same standard as STEP 6, not a guess:** `send_cross_chain_batch`'s loop calls PLAIN
`payer.require_auth()` (no `require_auth_for_args`) once per leg. Plain `require_auth()`'s
`AuthorizedFunction` is derived from `self.try_borrow_call_stack(host)?.last()` — the CURRENT
STACK FRAME's own contract address, function name, and "all the invocation's own arguments" (the
SDK's own documented behavior, `soroban-sdk` 27.0.6's `address.rs`). Every iteration of the loop
runs inside the SAME top-level frame (`send_cross_chain_batch`'s own invocation never returns
between legs — only nested calls made DURING a leg push and pop their own frames), and that
frame's own arguments (the whole `legs` vector) never change across iterations. Every
`require_auth()` call in the loop therefore produces the byte-identical `AuthorizedFunction` — not
a similar one, the SAME one — because plain `require_auth()`'s granularity is "the whole current
invocation," not "this specific loop iteration." The second call asks the host's recording-mode
auth tracker (`require_auth_recording`, same file) to record a match for a frame already matched
by leg 1, which `current_frame_is_already_matched()` correctly and accurately rejects — this is not
a platform bug, and not a client-tooling limitation; it is a real structural gap between what this
router's own code comment claims ("each leg is authorized for its OWN exact... N legs need N
distinct authorizations") and what plain `require_auth()` actually produces when called this way.

**Related to STEP 6's `live_until_ledger` finding, or independent?** Independent. Both are real
bugs surfaced by `auth.rs`'s matching logic, but the mechanisms don't share a root: STEP 6 was a
VALUE drifting between two temporally-separated computations of the conceptually SAME invocation
(simulate vs. real apply, seconds apart) — a timing problem, confirmed by failing only at real
submission, never at simulation. STEP 7 is a structural IDENTITY collision between two genuinely
DIFFERENT invocations (leg 1's authorization request vs. leg 2's) that collapse to the same
`AuthorizedFunction` because of how plain `require_auth()`'s scope resolves — confirmed by failing
at SIMULATION itself, with no time gap involved at all. Fixing STEP 6 does not touch this; fixing
this will not touch STEP 6's fix.

**Existing developer-channel discussion, searched before proposing anything (GitHub across
`rs-soroban-env`/`rs-soroban-sdk`/`stellar-cli`/`soroban-examples`, Discord, Stellar Stack Exchange,
general web):** no open issue, PR, or discussion in any official `stellar/*` repo discusses this
EXACT reported scenario (a batch function hitting this error during CLI simulation) as a question
or bug report — that specific combination is not something anyone has publicly asked about.
Discord's message history isn't web-indexed and couldn't be searched directly; Stellar Stack
Exchange was unreachable by available tooling (blocked by a Cloudflare challenge) and indexed
search of it returned nothing. What WAS found, and is far more valuable than a forum thread: the
actual historical GitHub issue that shaped today's exact behavior
(`stellar/rs-soroban-env#795`, closed 2023) and Stellar's own official reference implementation of
the correct pattern (`atomic_multiswap`/`atomic_swap`) — both cited below. Several unrelated,
independent third-party Soroban contracts (not official Stellar sources) were also found to have
hit this identical error message and fixed it the same way (calling `require_auth` once per unique
address rather than once per loop iteration) — useful only as corroboration that this is a real,
recurring failure mode in the wild, not authoritative discussion.

**CORRECTION to this document's own first-draft proposed fix, found via a real search before
implementing anything — recorded explicitly, not silently fixed, per this project's established
discipline (the same discipline that caught the Elev.2/Spoof.1 test-design flaws in STEP 2):** the
first version of this section proposed switching the loop's plain `require_auth()` to
`require_auth_for_args` with a per-leg args tuple, reasoning that a distinct `args` value would
produce a distinct `AuthorizedFunction` per iteration. **This was checked directly against
`current_frame_is_already_matched()` and `maybe_extend_invocation_match` in `auth.rs` before being
finalized, and found wrong**: both functions gate on `self.match_stack.last()` — a slot indexed by
CALL-STACK DEPTH, one entry per stack frame, updated only by the host's own `push_frame`/
`pop_frame` (which fire on real cross-contract/host-call transitions, never from inside
`require_auth`/`require_auth_for_args` themselves) — and this gate fires **unconditionally, before
any argument comparison ever runs**. Varying `require_auth_for_args`'s `args` while still calling it
flatly inside the loop, at the SAME stack depth every iteration, changes nothing: the frame-depth
check rejects the second call before it would ever get to compare arguments. This correction was
found by fetching and reading the full source of Stellar's own official `atomic_swap`/
`atomic_multiswap` examples (not by guessing) and then re-verifying the claim directly against
`auth.rs` a second time — described precisely below.

**Confirmed root cause of the ACTUAL fix, direct from Stellar's own history and reference
implementation, not derived from source alone this time:** `stellar/rs-soroban-env#795` (closed) is
the historical issue that produced today's exact behavior — a maintainer (dmkozh) explicitly
resolved it as: _"we allow duplicate `require_auth` calls each of which has to belong to a
**separate authorized call tree**"_ (i.e., a separate stack frame/node, not merely separate
arguments). Stellar's own official `atomic_multiswap` example (`stellar/soroban-examples`)
demonstrates the correct pattern for exactly this "loop over N items, same-shaped authorization
needed per item" case: its `multi_swap` function contains **no `require_auth` call of its own at
all** — it loops and calls `atomic_swap::Client::try_swap(...)` once per pairing, a REAL
cross-contract call (a genuine new stack frame), and `atomic_swap::swap` (a separate contract)
calls `require_auth_for_args` internally, once per party, with that party's own curated argument
tuple. Because each `try_swap` call is its own contract invocation, each one gets its OWN slot in
`match_stack`, and the same-address collision the router's flat loop hits never arises — not
because the arguments differ, but because the CALL STACK genuinely deepens and returns once per
item.

**A second candidate fix direction was checked and ALSO found not to work, before being proposed —
recorded here rather than silently discarded, since it's informative about why this is genuinely
hard within the router's current scope:** could `dispatch_one_leg` become the sub-invocation
boundary by calling it via a real cross-contract call back into this same router's own deployed
address (a self-call), moving `payer.require_auth()` inside that self-invoked function so each leg
lands in its own frame? Checked directly against `soroban-env-host` 27.0.1's `src/host/frame.rs`,
`call_n_internal`: reentry is checked by whether the TARGET contract's id already appears anywhere
in the current call stack (`reentry_distance`), and `env.invoke_contract` always uses
`CallParams::default_external_call()`, which sets `reentry_mode: ContractReentryMode::Prohibited`
unconditionally — matching the `(ContractReentryMode::Prohibited, Some(_))` error arm for ANY
self-call, with no exception. **A contract cannot call itself via `env.invoke_contract` at all, on
this platform, full stop** — this is not a risk to weigh, it is a hard platform rule, fully
consistent with (and now directly confirming, at the source level) STEP 1/STEP 2's own Elev.2
finding. This fix direction is a dead end, not merely unverified.

**No confirmed, viable fix exists yet within the router's current scope (SCOPE.md: no new
sub-contracts, no generic extensibility, no self-call available).** The one official pattern that
demonstrably works (`atomic_multiswap` → `atomic_swap`) relies on calling a genuinely SEPARATE,
already-deployed contract per item — which is exactly what gives each item its own real stack
frame — and the router has no such separate contract to call per leg for authorization purposes
alone (its two rail contracts exist to move funds, not to serve as an authorization-frame
boundary, and routing every leg through an extra rail-adjacent contract call purely to create a
frame would be a real, unreviewed design change, not a small fix). This is reported as the honest
state of the investigation, not resolved: **no code fix is proposed for sign-off in this document**
— the two directions checked (per-leg args to `require_auth_for_args` in the flat loop; a self-call
sub-invocation) are both confirmed, at the source level, not to work, and a genuinely new design
(a real, reviewed decision, likely touching SCOPE.md's current "no new contracts" boundary or
accepting a different batch-authorization shape entirely — e.g., one signature covering the WHOLE
batch via `require_auth_for_args(legs)` at the top, rather than per-leg authorizations, a real
design trade-off change to Elev.1's current guarantee that would need its own explicit review) is
needed before a fix can be proposed at all.

## STEP 8 — batch fix implemented and verified, first real completed batch send (2026-09-12)

**Design decision, made by the lead engineer, not derived unilaterally**: the "one signature over
the WHOLE batch" direction STEP 7 flagged above as the remaining option is exactly what was
adopted — `send_cross_chain_batch` now calls `payer.require_auth()` once, at the top, before any
leg dispatches. Reasoning, stated plainly: the frame-based authorization model means
`AuthorizedFunction` already binds to the entire top-level invocation's arguments (the whole `legs`
vector) regardless of how many times `require_auth()` is called inside one frame — there was never
real per-leg authorization available in this design, only whole-batch authorization, called
redundantly N times. Calling it once is the correct realization of what the mechanism always
provided, not a weakening of it. See "Elev.1, batch case" above for the full, permanent design
statement this correction produced — that section, not this one, is where a future reader should
look for what the batch authorization guarantee actually IS today.

**Verification, summarized here; full detail in "Elev.1, batch case" above and
`TESTNET_DEPLOYMENT.md` §5d**: a direct, adversarial test proves one signature binds to every leg's
real content (tampering with one leg's amount after signing is rejected); a required mutation test
found and closed a real gap (no prior test caught a completely unauthenticated batch call) and, in
the process, surfaced genuine platform defense-in-depth (the SAC's own `approve` check and
Soroban's own root-invocation safety net both independently reject an unauthorized batch too). Full
suite: 29/29 pass, fmt/clippy clean, real build succeeds.

**Real testnet result: the router phase's remaining unproven case is now proven.** A real,
two-good-leg `send_cross_chain_batch` completed successfully end-to-end for the first time
(`TESTNET_DEPLOYMENT.md` §5d — real tx hash, `successful: true`, both legs' real call chains
completed, router state and payer balance both correctly updated). The deliberate-failure rollback
case was also confirmed genuinely real — leg 1's real, already-executed effects (a real burn, a
real CCTP message dispatch) were confirmed rolled back after leg 2's real rejection — but this
specific case produces no transaction hash of its own, for a platform reason confirmed directly,
not assumed: Soroban's transaction model makes a resource footprint and fee themselves PRODUCTS of
successful simulation, and simulation genuinely executes the real contract logic against real
current state, so any CONTENT-level failure (a bad domain, insufficient balance) traps identically
at simulation, before a footprint exists to build a submittable transaction from — confirmed by
checking for a bypass (`--build-only` produces a footprint-free envelope; `stellar tx simulate` runs
the same simulation on anything handed to it) and by reproducing the same constraint with a second,
independent content-failure case (insufficient balance) to confirm it wasn't specific to the bad-
domain scenario. This is structurally different from STEP 6's `live_until_ledger` bug, which DID
produce real, hash-bearing, `successful: false` transactions, because that was a values MISMATCH
between what simulation signed and what execution recomputed — not a content-level rejection
simulation could see coming before submission.

## Did we do a good job?

Open items for the next checkpoint (STEP 2 review), not yet resolved by this document alone:

- Whether `send_cross_chain`'s destination-bytes validation (Info.1) needs its own small round-trip
  property test module, decided once STEP 2's actual `Dest` type is designed.
- Whether the volume counters (Dos.2) need per-asset AND per-time-window aggregation, or a single
  cumulative total is sufficient for the "anyone can check" bar — a product decision, not a safety
  one, to confirm before STEP 2.
- This document has not yet been reviewed by anyone outside this session; it is a draft threat model,
  not a completed one, and should be revisited once `send_cross_chain`'s real implementation exists,
  per Stellar's own STRIDE template's retrospective step.

## Official Soroban security guidance found

Stellar/SDF publishes a **security best-practices section**
(`developers.stellar.org/docs/build/security-docs`), including the STRIDE threat-modeling template
this document follows (explicitly required by the SDF Audit Bank as an audit precondition), a
monitoring guide, and a security-tools page listing CoinFabrik's Scout (a Soroban static analyzer),
Certora Sunbeam (formal verification of compiled Wasm), and the community-run Soroban Security
Portal. **No official, SWC-registry-style enumerated common-vulnerabilities list was found** — the
closest official artifacts are the STRIDE process template (a methodology, not a vulnerability
taxonomy) and normative guidance embedded in topic docs (notably the storage-strategies guide's own
"red flags in review" section, cited under Dos.2 above, and the TTL-safety rules cited under Dos.2's
first cost-shifting path). Cross-referencing this contract's design against that scattered guidance
is exactly what Dos.2 and Elev.2 above did. A third-party checklist (Veridise's public Soroban
security checklist) exists and is worth consulting at STEP 2, but is explicitly not an official
Stellar/SDF artifact.
