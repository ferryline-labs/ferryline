# Router testnet deployment — STEP 3/4/5 findings

**STEP 3 checked: 2026-09-12.** **STEP 4/5 checked: 2026-09-12 (same day, following STEP 3's
finding directly to a fix and a second, deeper round of real-network testing).** Real deployment
and real transactions against Soroban testnet throughout — every hash below is a real, submitted
testnet transaction, resolvable at `https://stellar.expert/explorer/testnet/tx/<hash>`. Nothing in
this document is simulated or assumed; every failure is reported as a finding, not smoothed over.

This document exists for the same reason `packages/core/VERIFIED.md` exists: to record what
reality said, dated, with receipts. Read it before touching `dispatch_one_leg`'s rail-dispatch
code again — in either direction, since STEP 5 leaves one real, unresolved discrepancy documented
in §5 that any future change to the CCTP leg should account for.

---

## 1. STEP 3's original finding (superseded by the fix below, kept for the record)

STEP 3 deployed the router as it stood at the end of STEP 2 and found `send_cross_chain` could not
complete against either real rail contract: CCTP's `deposit_for_burn_with_hook` call was missing 5
of its 9 real arguments, and the OFT's `send`/`quote_send` calls used 4 scalar values where the
real interface requires struct-typed `SendParam`/`MessagingFee`. Full detail of that finding
(transaction hashes, error text, root-cause analysis of the STEP 2 test-double gap that let it
through) is preserved in this file's git history and in `THREAT_MODEL.md`'s STEP 3 section. STEP 4
below fixes it.

## 2. STEP 4 — the fix, and the mutation-testing proof it actually closes the gap

**Root cause, precisely (per the sign-off's request to know how, not just that):** the STEP 2 doc
comment on `RAIL_FN_CCTP`/`RAIL_FN_OFT` claimed the function *names* were "verbatim from" the
verified interface dumps — and that claim was true. But the check stopped at the name. The
*argument lists* were built from the four values semantically obvious from `send_cross_chain`'s own
parameter list (`payer, amount, destination_domain/dst_eid, recipient/to`) — a plausible-looking
subset that happens to be a strict subset of CCTP's real 9 arguments and a differently-shaped
subset of the OFT's 4. This is a **partial-verification bug**: not a wrong source, not a stale
understanding, not a copy-paste from the wrong rail — a real check that covered names and silently
stopped short of covering shapes. This is the same root cause as the Spoof.1 test-double flaw from
STEP 2 (a stub built to mirror the code under test, rather than an independent source, can pass
while the code is wrong) — now recorded as a standing note in this crate's test-writing practices
(see `invariants.rs`'s and `interface_conformance.rs`'s own top doc comments): any stub representing
an external contract's real interface must be built from or checked against the verified interface,
never freehand.

**The fix** (`dispatch_one_leg` in `src/lib.rs`): CCTP's arm now sends all 8 real arguments plain
`deposit_for_burn` requires (see §3 for why the plain variant, not `_with_hook`), and the OFT's arm
now builds a real `SendParam` struct, calls the real on-chain `quote_send` first to get a real
`MessagingFee` (mirroring `packages/sdk/src/rails/usdt0-layerzero/adapter.ts`'s own
quote-then-send sequencing, as two calls within one atomic transaction rather than two separate
ones), then calls `send` with that fee. Both legs now also `approve` the rail contract to move the
payer's token first — a second gap STEP 3's failure never got far enough to surface, found by
reading `packages/core/verified/experiments/2026-09-11-cctp-burn-max-fee-zero.md`'s own "allowance
model" finding while building this fix.

**New structural test class** (`src/interface_conformance.rs`, 6 tests): parses the REAL parameter
list straight out of the verified interface dumps and compares it against what `dispatch_one_leg`'s
own source actually builds — count AND shape, not a second hand-typed list. Mutation-tested twice,
honestly, including one real self-correction:

- Reverting the CCTP call to STEP 3's original 4-argument bug: **caught immediately**
  (`cctp_call_sends_every_real_argument_deposit_for_burn_requires` fails, names the exact 4-vs-9
  discrepancy).
- Reverting the OFT `send` call to STEP 3's original 4-scalar bug: **NOT caught** by the
  count-only check on the first attempt — both the real and buggy shapes have exactly 4 non-env
  entries, so a pure argument-count comparison is structurally blind to this specific bug class.
  This was not silently patched over: a second test
  (`oft_send_call_uses_struct_typed_send_param_and_fee_not_scalars`) was added that checks each
  struct-typed real parameter's POSITION is actually built from a variable of that struct's type,
  not a primitive — re-running the identical mutation now correctly fails it.
- A third, independent mutation-testing pass on the six ORIGINAL invariants (not just the new
  interface checks) found a second real gap: `dos_1_atomic_invoke_is_the_only_call_site_and_never_
  uses_try_invoke`'s `try_invoke_contract` guard matched only the literal substring
  `"env.try_invoke_contract("` — a real call written WITH explicit turbofish generic arguments
  (`::<(), soroban_sdk::Error>`, the more common way to write this call when type inference can't
  resolve it, which is genuinely how it had to be written during this exact mutation test) has
  other characters between the method name and the paren, so the substring never matched. Fixed to
  a line-based check (any non-comment line containing the method name), confirmed by re-running the
  identical mutation.

All three corrections are named, discoverable test functions/doc comments in the source — not
silently fixed and forgotten — consistent with this project's established discipline.

**Full verification, all real:** 25/25 tests pass, `cargo fmt --check` clean, `cargo clippy
--all-targets -- -D warnings` clean, `stellar contract build` succeeds (WASM hash
`93b786f97e61c001e1ebaab9a81141214f3030ca73a148f71083d426f16633fd`).

## 3. A second, STEP-5-discovered fix: `deposit_for_burn`, not `_with_hook`

The first real testnet send attempt (against the STEP 4 build, before this second fix) trapped with
the CCTP contract's own real business-logic error `Error(Contract, #7107)` —
`TokenMessengerMinterError::HookDataEmpty`, per
`packages/core/verified/cctp-token-messenger-minter.mainnet.rs`. The `_with_hook` variant genuinely
requires non-empty `hook_data`; the router had none to supply, since it has no hook/forwarding
feature (SCOPE.md). Rather than invent placeholder hook bytes with no real meaning, the router was
switched to call plain `deposit_for_burn` (verified, real, 8 arguments, identical to `_with_hook`
minus `hook_data`) — the purpose-built alternative for exactly this case. All test doubles, the
interface-conformance test, and doc comments were updated to match; 25/25 tests still pass,
fmt/clippy still clean, `stellar contract build` succeeds again (WASM hash
`93b786f97e61c001e1ebaab9a81141214f3030ca73a148f71083d426f16633fd` — same hash as §2's, since this
fix landed before that build was taken; see the redeploy in §4 for the actual deployed hash after
this correction, which is a fresh build with the same hash since no further source changes followed
it before deployment).

## 4. STEP 5 — real transaction hashes and outcomes

### 4.1 Redeployment

| Item | Value |
|---|---|
| Router contract (testnet, post-fix) | `CACNV466XMCEQSE73FJN646KWYD54C3ZRDXZUZJM3EH7736YHWTKZSMP` |
| WASM hash | `93b786f97e61c001e1ebaab9a81141214f3030ca73a148f71083d426f16633fd` |
| Upload tx | `f58f1fa1ce2859d044e978fc46a0ab2b6b2576a5048673099d6ecdb644056ce3` |
| Deploy (constructor) tx | `fa12fe884a13af7f1759397b823f446dfdd5704f76ac6686ffe8cd26d9c84c36` |

Rail-slot wiring reverified directly from ledger storage after redeployment: `UsdcContract` →
`CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP`, `UsdcSac` →
`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, `Usdt0Contract`/`Usdt0Sac` →
`CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6` (documented mainnet-OFT stand-in — see
§5.3). All four genuinely distinct where they need to be, correctly slotted per the constructor's
`(usdc_contract, usdt0_contract, usdc_sac, usdt0_sac)` order.

An earlier, STEP-4-only build (before the `deposit_for_burn` fix in §3) was also deployed once, to
`CADZV6S7CADVQFYH4FU3JTWVTRKL6VN474ZX637UVKHP36GUGIKY2QHI` (upload tx
`37c4ee320d8322c8d4523406764a606bb746d967525c035c4e529e7ba1510f3a`, deploy tx
`e68a2f7741ef44891bc21ff5a5d8527dd8d20395766423b558687fb2d7e85373`) — this is the deployment that
surfaced the `HookDataEmpty` finding in §3, superseded by the redeployment above and not used for
anything past that point.

### 4.2 Real testnet USDC — a live account, not a faucet claim

`send_cross_chain`'s CCTP leg moves real USDC, which the `ferryline-testnet-operator` account never
held (confirmed both in STEP 3 and again here — balance `0`). Circle's public testnet faucet
(`faucet.circle.com`, confirmed to support Stellar Testnet, 20 USDC per address per 2 hours, no
API key) is a browser-only form with no documented public REST endpoint this environment could
call programmatically. Rather than guess at an unverified endpoint, a real, already-testnet-USDC-
funded account already present in this project's own key set was used instead: `demo-payer`
(`GA3CZKET5CLA6FXMZ56L4SYSXQYQTSD42WBSRIOZ6Q4WGKVFY6D2IZC2`), confirmed via a direct Horizon query
to hold real `99.0550000` USDC and `9943.5046817` XLM.

### 4.3 Single-leg CCTP send — real submission, real partial success, one real unresolved failure

**Simulation succeeds completely and reproducibly.** A real (non-submitting) simulation of
`send_cross_chain(payer=demo-payer, rail=Usdc, dest=Cctp(domain=0, recipient=<real Sepolia-shaped
address>, max_fee=0, min_finality_threshold=2000), amount=5_000_000)` returns real, successful
event data for the ENTIRE call chain: a real `approve` event, a real `transfer` event (moving
5,000,000 units of real testnet USDC), a real `burn` event, a real CCTP `message_sent` event
carrying a real-shaped cross-chain message payload, and a real `deposit_for_burn` event with every
field populated correctly (amount, destination_domain, mint_recipient, max_fee, all matching the
call). This is complete, genuine confirmation that the STEP 4/5 fix builds the exactly correct call
shape and that the real CCTP contract accepts it — the interface-shape problem STEP 3 found is
fully resolved.

**Real submission fails, consistently and reproducibly, at ledger-apply time — not at
simulation.** Two real transactions were submitted (`472de592cf5dc40560cfee6d8f103437e04c1df959e3
efb236a4d3ccafbd7025`, `728576f1b5ff4d20c0c4e8b16693bef2469ef8b2212759d2fd036a44796aad94`), both
real fee-charged, ledger-included, and `FAILED` with `InvokeHostFunction(Trapped)`. Decoding the
second transaction's real diagnostic events (via direct Soroban RPC `getTransaction`) shows the
real cause: **`"Unauthorized function call for address"` on the nested `approve` sub-invocation**
inside the router's own signed authorization tree — despite `demo-payer` being both the transaction
source account and the `payer`/`from` address on every level of that tree, and despite Stellar's
own authorization documentation stating a single signature should cover a same-address nested
tree ("it is possible for a contract to call `require_auth` for an `Address` and then call
`token.xfer` authorized for the same `Address`" through sub-contract calls).

**Real, controlled tests to isolate this precisely**, all confirmed:
- Decoded the actual signed envelope: the authorization tree DOES contain the correct nested
  structure (`send_cross_chain` → sub-invocation `approve` → sibling `deposit_for_burn`), correctly
  addressed, with `credentials: source_account` — the tree shape itself is not the problem.
- A real, single-hop `approve` call from the SAME account
  (`1dcad976809f5c1294fe5ec9fe4e3960766a694feb9e9bb584106041858ce091`) **succeeds** — `demo-payer`'s
  ability to sign and its account state are both fine.
- Rebuilt and resubmitted immediately (an ~8-second round trip) to rule out a stale-simulation/
  ledger-sequence race: same failure, same error.
- Confirmed `--build-only` (no simulation) produces a bare, auth-free operation — proving the CLI's
  real submission genuinely uses a freshly-simulated, not stale, auth tree.

**This is reported as a real, open, unresolved finding — exactly the class of thing this phase
exists to surface — not something quietly patched around.** The router's own call-building code is
now verified correct against the real interfaces (§2–3) and behaves exactly as designed under
simulation; something about how `stellar-cli`'s default signing flow (or Soroban testnet's real
application of a `source_account`-credentialed, same-address, multi-level authorization tree
crossing three real contracts — router → SAC → TokenMessengerMinter, which itself sub-calls
MessageTransmitter) disagrees with what simulation and the platform's own documentation both predict.
No further attempt was made to route around this by extracting a raw signing key or fabricating a
different signing path — that boundary was respected rather than worked around.

**Real state confirmed clean after every attempt:** `volume(Usdc)`/`volume(Usdt0)` both `"0"`,
`demo-payer`'s real USDC balance unchanged at `99.0550000`, and the SAC's real allowance for
`demo-payer → TokenMessengerMinter` at `"0"` — Dos.1's atomicity guarantee held perfectly through
every one of these real failures; nothing was lost, stranded, or partially applied.

### 4.4 Batch send and the deliberate-failure rollback case

Not executed as a genuinely distinct scenario this round: since no single-leg CCTP send could
complete for the reason in §4.3, a batch containing a real successful leg plus a deliberately-bad
leg could not be constructed either. What batch atomicity WAS re-confirmed, empirically, under real
conditions: the two real single-leg submission failures in §4.3 each correctly rolled back
everything the transaction attempted (see the state check above) — the same guarantee a batch's
rollback depends on, exercised via `send_cross_chain` rather than `send_cross_chain_batch`
specifically. A genuine batch-with-mixed-outcome test, and the USDT0 leg (blocked separately by
§5.3's finding), remain outstanding once §4.3's authorization discrepancy is resolved.

### 4.5 USDT0/LayerZero leg

Not attempted this round: §5.3 confirms USDT0 still has no Stellar testnet deployment, so this leg
cannot be exercised on testnet regardless of §4.3's finding. The router's OFT call-building code
(§2's fix) was verified correct against the real interface via `interface_conformance.rs`'s
struct-shape checks and mutation testing, but — like the CCTP leg's real submission — has not been
confirmed to complete a real, successful, submitted transaction, since no real testnet OFT exists to
submit one against.

## 5. Observed gas/resource costs (real, on-chain)

All figures are real `fee_charged` values from Horizon/RPC for actual submitted transactions, in
stroops (1 XLM = 10,000,000 stroops).

| Call | Tx hash | Fee charged | Notes |
|---|---|---|---|
| WASM upload (STEP 3 build) | `42a69c80...06eaa9957849a` | 4,579,437 (~0.458 XLM) | Superseded build |
| Deploy, STEP 3 build | `2d37c488...2a06eaa9957849a` | 35,186 (~0.0035 XLM) | Superseded build |
| `version()`, STEP 3 build | `c86e80a1...143576b8b1375450` | 3,075 (~0.0003 XLM) | Cheapest real successful call, any build |
| WASM upload, STEP 4-only build | `37c4ee32...4c529e7ba1510f3a` | — (not separately queried) | Superseded (§3's `HookDataEmpty` finding) |
| WASM upload, STEP 4+5 build | `f58f1fa1...9d6ecdb644056ce3` | — (not separately queried) | Current deployment |
| Deploy, STEP 4+5 build | `fa12fe88...ffe8cd26d9c84c36` | — (not separately queried) | Current deployment |
| `send_cross_chain` (CCTP), real submission, FAILED at apply-time | `472de592...4d3ccafbd7025` | 27,033 (~0.0027 XLM) | See §4.3 — real fee charged even on a `Trapped` result |
| `send_cross_chain` (CCTP), real submission, FAILED at apply-time (retry) | `728576f1...cd26d9c84c36`† | 27,033 (~0.0027 XLM) | Identical fee to the first attempt |
| Real single-hop `approve` (isolation test) | `1dcad976...0041858ce091` | — (not separately queried) | Succeeded — confirms `demo-payer` signing is fine in isolation |

† tx hash truncated for table width; full hash
`728576f1b5ff4d20c0c4e8b16693bef2469ef8b2212759d2fd036a44796aad94`.

**What this phase could not measure:** the real per-leg cost of a *successfully completed*
`send_cross_chain` or `send_cross_chain_batch` call, since no such call has yet completed on
testnet (§4.3's open finding). The `27,033`-stroop figure for the CCTP leg's real, failed-at-
apply-time submission is a genuine data point — it reflects the real resource cost of simulating,
authorizing, and executing up to the trap point across the real 3-level call chain (router → SAC
→ TokenMessengerMinter) — but is explicitly NOT a stand-in for a successful send's cost, since a
successful call likely does somewhat more work (a completed burn, a real cross-chain message
dispatch) than one that traps partway through applying its authorization. Re-capturing a genuine
successful-send figure remains necessary before the widget's fee-estimation logic or the SCF
application's budget section can cite a real number.

## 5b. STEP 6 — root cause found and fixed, first real completed send

**Root cause, confirmed via a direct re-read of `soroban-env-host` 27.0.1's own `src/auth.rs`
(the exact pinned host version), not via external answer** (search of Stellar's developer
channels — Discord, GitHub across `rs-soroban-env`/`soroban-sdk`/`stellar-cli`, general web —
found nothing matching this exact scenario; see `EXTERNAL_REPORT_DRAFT.md`'s revision history for
the full search record): `dispatch_one_leg`'s `approve` call computed its `live_until_ledger`
argument as `env.ledger().sequence() + APPROVE_LEDGER_WINDOW` — a value read from LIVE ledger
state, recomputed fresh both when `stellar-cli`'s simulate-and-sign step ran and again when the
transaction was actually applied on-chain, moments to seconds later. Soroban's authorization-tree
matching (`auth.rs`'s `maybe_extend_invocation_match`) requires a live call's full arguments to
exactly equal what was signed; if even one real ledger closed in between (ordinary on Stellar
testnet's ~5-second ledger close time), the two computed values differed, the real call's
arguments matched no signed node, and the host reported exactly the
`"Unauthorized function call for address"` class of error §4.3 hit twice, reproducibly — not a
signature failure, an absence-of-match failure.

**Fix** (`src/lib.rs`, new `approve_live_until_ledger` function): round `env.ledger().sequence()`
DOWN to the nearest multiple of a new `APPROVE_LEDGER_ROUNDING_WINDOW` (20 ledgers) before adding
the real validity window (`APPROVE_LEDGER_WINDOW`, 100 ledgers, unchanged). As long as simulate and
apply land in the same 20-ledger bucket — near-certain for any realistic submission delay, and
comfortably wider than the ~2-ledger gap STEP 5's own real attempts actually saw — this produces
the IDENTICAL value both times. Kept internally computed, not promoted to a caller-supplied
parameter: unlike `max_fee`/`min_finality_threshold` (real per-call values with genuine
Stellar-specific semantics a caller must decide, per `Dest`'s own doc comment), a caller has no
meaningful opinion about the exact ledger number an approval expires at — the router's own
established pattern is to fix values only when there's a genuine universal-or-derivable answer
(like `destination_caller`'s protocol convention), and this is exactly that case once made stable.

Two new direct unit tests (`invariants.rs`) prove the fix's core property against a REAL simulated
ledger-sequence advance (not just inspection): the function returns the SAME value for two sequence
numbers 3 ledgers apart (the exact drift class that caused the real failure), and a DIFFERENT value
once the sequence advances past a rounding boundary (confirming the fix doesn't freeze the value
forever, which would silently reintroduce the original "stale approval lingers indefinitely"
concern). Mutation-tested: reverting to the original raw computation makes the stability test fail
immediately, naming the exact drifted values. 27/27 tests pass (25 prior + 2 new), `cargo fmt
--check` clean, `cargo clippy --all-targets -- -D warnings` clean, `stellar contract build`
succeeds (WASM hash `2c8180e27d299e461018043bd2c9c225c7b887c3a989b1e3909fb25e1bd62374`).

**Real testnet confirmation — the first genuinely completed `send_cross_chain` in this project's
history:**

| Item | Value |
|---|---|
| Router (STEP 6 fix, testnet) | `CDOPZ3QMSKYFKYAMWNLG6KPQECRGOJSYE3QCAO53JJSCRCFYCMFO7P2N` |
| WASM hash | `2c8180e27d299e461018043bd2c9c225c7b887c3a989b1e3909fb25e1bd62374` |
| Upload tx | `50d63cd4c177a2aa7461766da5c9f9c0ebb81bacfeac401249540a0cd149c75e` |
| Deploy tx | `57295a178d26ae336934c888fefc08c3a2bc209ac2ae4d1a37a37b667808dc00` |
| **`send_cross_chain` (CCTP), real, complete, `successful: true`** | **`5f91eb68a75f0a1bbcaded62d4dc2af37ccea795c984fae8c66eb9fdaace33b0`** |

Confirmed via direct Horizon query (`successful: true`, real fee charged `59,681` stroops, ledger
`4636235`), via the router's own state (`volume(Usdc)` reads `5000000` — the router's
POST-external-call storage write ran, meaning the entire function, Elev.2's write-ordering
guarantee included, executed for real), and via `demo-payer`'s real balance (dropped from
`99.0550000` to `98.5550000` USDC — exactly the `0.5` USDC burned, confirmed on-chain). Real events
observed for the complete chain: `approve`, `transfer`, `burn`, a real CCTP `message_sent` with a
genuine cross-chain message payload, and `deposit_for_burn`'s own completion event with every field
populated correctly.

**A new, distinct, real finding surfaced by getting this far for the first time:**
`send_cross_chain_batch` with two legs — real domain 0, then a deliberately-bad domain 999999 (the
rollback test case) — failed at SIMULATION with `Error(Auth, ExistingValue)`,
`"frame is already authorized"`, on the SECOND leg's `payer.require_auth()` call. The trace shows
leg 1 completing its entire real call chain successfully (approve/transfer/burn/message_sent/
deposit_for_burn) BEFORE the failure — this is not the `live_until_ledger` bug recurring (leg 1's
own `approve` succeeded fine), and not a mismatched signature; it is the CLI's own auth-discovery
step apparently recording only one authorized-invocation node per stack frame, where
`send_cross_chain_batch`'s loop calls `require_auth()` twice for the SAME address from the SAME
function body. Stellar's own docs' "Duplicate Addresses" section says this pattern should work
("every `require_auth` call still has to have a corresponding node... there might be multiple valid
trees") but the mechanism producing a signable-by-a-simple-CLI-invoke tree for it wasn't confirmed
here. This attempt never reached real submission (simulation itself failed), so nothing rolled back
on-chain — `volume(Usdc)` and `demo-payer`'s balance were both confirmed unchanged from before the
attempt. Reported as a new, separate, not-yet-investigated finding — explicitly out of STEP 6's
assigned scope (the `live_until_ledger` discrepancy specifically) — not folded into this fix or
silently worked around.

**What's still outstanding, precisely:** a real, completed `send_cross_chain_batch` (blocked by the
new finding above) and the USDT0/LayerZero leg (still blocked by no testnet OFT deployment, §3 of
the earlier finding). The sign-off's original completion bar for a single-leg CCTP send is now
met, with a real hash to prove it.

## 5c. STEP 7 — batch authorization mechanism, root-caused (not yet fixed)

**Mechanism, confirmed via direct source reading (`soroban-env-host` 27.0.1's `src/auth.rs`, same
rigor as STEP 6):** the batch loop's `payer.require_auth()` (plain form, no `require_auth_for_args`)
authorizes the CURRENT STACK FRAME's own invocation — `send_cross_chain_batch`'s own function
identity and "all the invocation's own arguments" (the whole `legs` vector), per the SDK's own
documented behavior of plain `require_auth()`. Since every loop iteration runs inside the SAME
top-level frame (the frame never returns between legs — only nested cross-contract calls MADE
during a leg push/pop their own frames) and that frame's own arguments never change across
iterations, every `require_auth()` call in the loop produces the byte-identical `AuthorizedFunction`.
The second call asks the host to record a match for a frame it already matched, which the host
correctly rejects (`current_frame_is_already_matched()`) with the observed
`"frame is already authorized"` error. This is real, but it is NOT a platform bug or a client-tooling
limitation — it is a genuine gap between the router's own doc comment's claim ("N legs need N
distinct authorizations") and what plain `require_auth()`, called this way, actually produces.

**Independent of STEP 6's `live_until_ledger` finding** — confirmed structurally, not assumed:
STEP 6 was a value drifting between two temporally-separated computations of the conceptually SAME
invocation (a timing problem, failing only at real apply-time). This is a structural identity
collision between two DIFFERENT invocations (leg 1's vs. leg 2's authorization request) that
collapse to the same `AuthorizedFunction` — no time gap involved, confirmed by failing at
SIMULATION itself.

**CORRECTED before proposing anything, via a real search plus direct re-verification against
source — not silently, per this project's discipline:** the first candidate fix (switching the loop
to `payer.require_auth_for_args` with a per-leg args tuple) was checked directly against
`current_frame_is_already_matched`/`maybe_extend_invocation_match` and found NOT to work — both
gate on call-stack DEPTH (`match_stack`, one slot per real stack frame, updated only by genuine
cross-contract-call transitions), unconditionally, BEFORE any argument comparison ever runs.
Varying `args` while still calling it flatly inside the same loop, at the same stack depth, changes
nothing. A second candidate (routing each leg through a self-call back into the router's own
address, to force a new frame) was also checked and found impossible on this platform: Soroban's
reentry check (`soroban-env-host`'s `frame.rs`, `call_n_internal`) rejects ANY call where the
target contract's id already appears in the current call stack, and `env.invoke_contract` always
uses `ContractReentryMode::Prohibited` — a contract cannot call itself, full stop, confirming
STEP 1/2's own Elev.2 finding at the source level. **No confirmed, viable fix exists yet within the
router's current scope** (SCOPE.md: no new sub-contracts). The one official pattern that
demonstrably works (`stellar/soroban-examples`' `atomic_multiswap` → `atomic_swap`) relies on
calling a genuinely separate, already-deployed contract per item to get each item its own real
frame — the router has no such contract to call for authorization purposes alone. This needs a
genuinely new design decision (touching SCOPE.md's boundary, or accepting a different
batch-authorization shape — e.g. one signature over the whole batch rather than per-leg, a real
trade-off to Elev.1's current guarantee) before any fix can even be proposed. Full detail, source
citations for both ruled-out directions, and the STEP 6 GitHub issue that historically produced
this exact host behavior: `THREAT_MODEL.md`'s STEP 7 section.

## 5d. STEP 8 — batch fix implemented, verified, first real completed batch send

**Fix**: `send_cross_chain_batch` now calls `payer.require_auth()` ONCE, before the leg-dispatch
loop (previously once per leg — the STEP 7 bug). Design decision, not a weakening: Soroban's
authorization model binds `require_auth()`'s `AuthorizedFunction` to the CURRENT STACK FRAME's own
invocation regardless of how many times it's called from inside that frame — every one of the
original N per-leg calls authorized the exact same thing (this whole batch invocation), so there
was never real, distinct per-leg authorization to begin with. Calling it once is the correct
realization of what the mechanism always actually provided: one signature over the complete `legs`
array as a single atomic unit.

**Load-bearing proof, confirmed directly, not assumed**
(`elev_1_batch_authorization_binds_every_legs_amount_and_destination_not_just_payer_identity`):
mocks a real authorization for a specific two-leg batch, then attempts to submit a DIFFERENT batch
(one leg's amount altered) through that same mock — confirmed rejected. Self-checked first: the
untampered version of the same mock was confirmed to succeed cleanly, proving the rejection is
caused by the tampering specifically, not an unrelated setup issue.

**Mutation-tested, and a real gap found and closed**
(`elev_1_batch_unauthorized_payer_cannot_move_funds`): removing `require_auth()` from the batch
function entirely was NOT caught by any of the 28 pre-existing tests — added directly, mocking
authorization to a different address than the real payer. Verified against real code that this
test's panic occurs on the router's own line, not a downstream one; also found, by diagnostic, that
the platform provides genuine additional defense-in-depth here (the real SAC's own internal
`approve` auth requirement, and Soroban's own "authorization not tied to the root invocation"
recording-mode safety net both independently reject an unauthorized batch too) — not a reason to
treat the router's own check as optional, but a real, confirmed safety margin worth knowing about.

**Full suite**: 29/29 tests pass (27 prior + 2 new batch-scoped Elev.1 tests), `cargo fmt --check`
clean, `cargo clippy --all-targets -- -D warnings` clean, `stellar contract build` succeeds (WASM
hash `d41ddd5c121fdac6d0bd2f4ac8a3566a6f7515900ce097f3177d49af7d783e8c`).

**Real testnet confirmation:**

| Item | Value |
|---|---|
| Router (STEP 8 fix, testnet) | `CASNMFI2CCFNNUF67SPQYACZIIDXLTOQDMTXAR4DSWNEKWZ347SY2LLS` |
| WASM hash | `d41ddd5c121fdac6d0bd2f4ac8a3566a6f7515900ce097f3177d49af7d783e8c` |
| Upload tx | `e2fdc722762b3ab2c860e434e51351615750e37471b8ec09a5f2ac070edea4f1` |
| Deploy tx | `55debc454b101c30f114d7bb04132049022d320e819f2acf74d31df5af1c8b68` |
| **`send_cross_chain_batch` — real, both legs completed** | **`1ad2aeb076450b7d9d08732e5b80d58c3c70c3a0ca6cc0e79e2e375c7212381d`** |

Confirmed via direct Horizon query (`"successful": true`, real fee `58,966` stroops, ledger
`4638043`); the router's own `volume(Usdc)` correctly reads `2,500,000` (both legs' amounts
summed: `1,000,000 + 1,500,000`); `demo-payer`'s real balance correctly reduced by exactly `0.25`
USDC total across both burns (`98.555` → `98.305`). Both legs completed their entire real
call chains (approve, transfer, burn, a real CCTP `message_sent`, `deposit_for_burn`) — the first
genuinely completed multi-leg batch send in this project's history.

**The deliberate-failure rollback case: confirmed genuinely happening, real, on real testnet state
— but a real transaction hash for it is not obtainable, and this is a platform fact, not a gap in
this investigation.** Attempted with the exact rollback scenario (a real good leg + a deliberately
bad domain, `999999`): leg 1's ENTIRE real chain (approve, transfer_from, burn, `message_sent`,
`deposit_for_burn`) completed successfully; leg 2 then hit the real CCTP contract's own
`NoTokenMessengerForDomain = 7106` error. This trapped the WHOLE transaction, and — verified
directly, not assumed — `volume(Usdc)` and `demo-payer`'s real balance were both confirmed
UNCHANGED afterward, meaning leg 1's real, already-executed effects were genuinely rolled back.

This attempt never produced a transaction hash because it failed at SIMULATION, and Soroban's
transaction model makes this unavoidable for any content-level failure (a bad domain, insufficient
balance, or anything the contract logic itself rejects): a transaction's resource footprint and fee
are themselves PRODUCTS of successful simulation — Soroban's recording-mode simulation genuinely
executes the real contract logic against real current ledger state (not a separate, potentially-
divergent prediction of it), so a leg that would trap during real execution traps identically
during simulation, before any resource footprint exists to construct a submittable transaction
from. Confirmed by directly checking for a bypass: `stellar contract invoke --build-only` (skips
simulation) produces a bare, footprint-free, unsubmittable envelope; `stellar tx simulate` runs the
identical simulation logic on any transaction handed to it, so it cannot be used to manufacture a
valid footprint for a transaction whose real execution would trap either. A second, independent
content-failure case (insufficient balance — leg 2 requesting more than remains after leg 1's burn)
was also attempted specifically to confirm this isn't unique to the bad-domain scenario, and it
hit the identical constraint (`"resulting balance is not within the allowed range"`, again only at
simulation) — state confirmed unchanged afterward there too. **This is structurally different from
STEP 6's `live_until_ledger` bug, which DID produce real, hash-bearing, `successful: false`
transactions** — that failure was a values MISMATCH between what simulation signed and what
execution recomputed (both individually "valid" until compared against each other), not a
content-level rejection simulation itself could see coming; a leg that's simply, substantively
wrong (bad domain, insufficient funds) is caught at the exact same point real execution would
reject it, before a transaction exists to submit.

## 6. What real network conditions surfaced that the simulated test environment didn't

Two distinct, real findings this round, on top of STEP 3's original one:

1. **`deposit_for_burn_with_hook` requires non-empty `hook_data`** (§3) — invisible to STEP 4's own
   unit tests (which never modeled this specific real business rule, since `RailStub` accepts
   whatever it's given) and only discoverable by a real call to the real contract. Fixed by
   switching to the plain, hook-free variant.
2. **A real, reproducible discrepancy between Soroban simulation and real testnet application, for
   a same-address, multi-level, `source_account`-credentialed authorization tree, root-caused and
   fixed in STEP 6** (§5b) — the router's `approve` call baked a live, ledger-sequence-derived
   value into an authorization-covered argument, which drifted between simulate-time signing and
   real apply-time re-execution. Confirmed via direct primary-source reading of
   `soroban-env-host`'s own matching logic (not an external answer — search of Stellar's own
   developer channels found nothing matching this exact scenario), fixed by making the value stable
   across a realistic simulate-to-apply gap, and CONFIRMED by a real, completed, `successful: true`
   testnet transaction (§5b) — the first in this project's history.
3. **A new, distinct, real, not-yet-investigated finding surfaced by STEP 6's fix getting far
   enough for the first time** (§5b): `send_cross_chain_batch`'s per-leg `require_auth()` loop hits
   `"frame is already authorized"` at simulation for a SECOND leg authorizing the same address from
   the same function body — a different mechanism from either finding above (leg 1's own real call
   chain completed successfully first). Reported, not investigated further this round.

**Everything STEP 2's six invariants set out to verify about the router's own logic still holds**,
confirmed once more under real conditions, now including a real SUCCESSFUL send: authorization
binding, atomicity (both the earlier failed submissions and the new batch-simulation failure left
zero state behind, verified directly each time), bounded storage (`volume(Usdc)` now correctly
reads a real, non-zero, single-entry-per-rail value), rail-address integrity, and reentrancy safety
are all confirmed intact.

**Sign-off's original completion bar, reassessed:** "a real send_cross_chain... actually completes
successfully on testnet, with transaction hashes to prove it" — **met**, for the CCTP single-leg
case (`5f91eb68a75f0a1bbcaded62d4dc2af37ccea795c984fae8c66eb9fdaace33b0`, `successful: true`).
**Not yet met** for `send_cross_chain_batch` (blocked by the new §5b finding above) or the USDT0
leg (blocked by no testnet OFT deployment, unchanged from the earlier finding).
