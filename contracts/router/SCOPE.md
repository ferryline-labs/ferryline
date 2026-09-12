# Ferryline router — v1 scope

What v1 does and, explicitly, does not do — written for an auditor or integrator who should not have
to guess at intent from what is merely absent. Each "not yet" below is a deliberate choice made now,
not a gap discovered later. See `THREAT_MODEL.md` for the safety reasoning behind several of these.

## v1 does

- `send_cross_chain(payer, rail, dest, amount)`: a single-leg cross-chain send for USDC (via CCTP) or
  USDT0 (via LayerZero OFT), authorized by the payer's own `require_auth`, dispatched as a thin call
  into the already-deployed, already-audited-by-their-own-teams TokenMessengerMinter/OFT contracts.
- A batch payout entry point covering several legs (potentially several destinations/rails) in one
  transaction, **all-or-nothing** (see below).
- Smart-account support: the payer parameter is a Soroban `Address`, which Soroban itself treats
  uniformly whether it resolves to a G-account or a C-address smart contract — the router does not
  need special-case logic for smart accounts beyond calling `require_auth`/`require_auth_for_args`
  correctly (see `THREAT_MODEL.md`'s Elev.1).
- A bounded, aggregate on-chain volume footprint (fixed counters, not a per-transfer log — see
  `THREAT_MODEL.md`'s Dos.2) so total volume routed is independently checkable by anyone, without
  trusting the router operator's own reporting.

## v1 explicitly does NOT do

### Isolated-per-leg batch semantics — deferred, not present

**Batch payouts are all-or-nothing for v1**: if any leg's underlying rail call fails, the entire
batch transaction reverts, including every already-attempted leg in that same call. This is not an
oversight or a temporary limitation waiting on more engineering time to remove — it is v1's chosen
semantics, and it is also the **platform's own default behavior** for Soroban cross-contract calls
(see `THREAT_MODEL.md`'s Dos.1: the plain `invoke_contract` path panics/traps on any callee failure,
rolling back the whole transaction; isolating a leg's failure requires deliberately opting into
`try_invoke_contract` instead).

A future version may offer isolated-per-leg semantics (one leg's failure does not prevent the others
from succeeding), but this needs its own design pass beyond "use `try_invoke_contract` instead" —
per `THREAT_MODEL.md`'s Dos.1 caveat, `try_invoke_contract` does not catch resource-limit or internal
host errors, so a naive isolated-per-leg implementation could still fail wholesale under certain
conditions and would need to reason explicitly about which failure modes are actually recoverable.
That design work is out of scope for v1 and not started.

### No upgradability

**This is a deliberate choice, not an oversight.** The router does not implement any upgrade
mechanism (no admin-gated `upgrade()` entry point, no proxy pattern). Rationale: an upgradable
contract that moves other people's funds is a categorically larger attack surface — an upgrade
mechanism is itself a privileged code path that, if compromised, bypasses every other safety property
in this document regardless of how well `send_cross_chain` itself is written. The maintenance plan's
own stated approach (`technical-doc.md`'s Maintenance plan section) treats protocol/dependency
upgrades as something the team ships as a new, separately-deployed contract version with a published
compatibility table, not an in-place mutation of already-deployed router bytecode. If a genuine need
for upgradability emerges, it should be re-evaluated as its own explicit design and security decision,
not added quietly to a router that shipped without it.

### No admin override / pause switch

**Also a deliberate choice, stated explicitly here rather than left to be discovered as an absence.**
v1 has no admin address, no pause function, no denylist, and no way for anyone (including the
Ferryline team) to halt or reverse an in-flight `send_cross_chain`/batch call once submitted. This
follows from the same reasoning as "no upgradability": a pause/admin-override mechanism is a
privileged code path and, unlike the rail contracts themselves (CCTP's TokenMessengerMinter and the
OFT contract both DO have pause/denylist/admin machinery, per the real mainnet interface dumps in
`packages/core/verified/cctp-token-messenger-minter.mainnet.rs`), the router deliberately does not
duplicate that surface. The router's job is authorization-correct dispatch, not operational control
over the rails it dispatches to — an operator who needs to react to an incident does so by acting on
the underlying rail contracts (which they don't control either, being Circle's/LayerZero's) or by the
relayer/SDK layer choosing not to route new traffic to a compromised router version, not by pausing
the router itself. If this reasoning is wrong for v1's actual risk profile, it should be an explicit
disagreement to raise now, not something added defensively without documenting why it wasn't there
before.

### No per-transfer on-chain history

Per `THREAT_MODEL.md`'s Dos.2, the volume footprint is a small set of aggregate counters, not a
queryable log of individual transfers. An integrator or auditor who needs a full transfer history
should use the router's emitted events (Repud.1 in `THREAT_MODEL.md`) combined with off-chain
indexing, the same pattern the relayer/SDK already use for their own transfer tracking
(`@ferryline/core`'s `TransferStore`) — the router does not attempt to be its own on-chain database.

### No generic "any rail" extensibility

v1 supports exactly two rails (USDC via CCTP, USDT0 via LayerZero OFT), matching the two rails the
SDK/relayer already support. `Rail`/`Dest` are not designed as an open, caller-extensible plugin
system — adding a third rail is a new router version with its own review, not a runtime
configuration change. This keeps `Spoof.1` (rail contract address must be a router-owned constant,
never caller-suppliable) simple to reason about: there is no code path where a caller's own input
determines which contract address gets invoked.

### No fee-taking by the router itself

`send_cross_chain` forwards the caller's `amount` to the rail contract; the router does not deduct or
add its own protocol fee. (The relayer's separate sponsor-funded fee-bump mechanism, documented in
`packages/relayer/README.md`, is unrelated — it pays _inbound_ CCTP mint gas costs on Stellar, not an
outbound router fee.) If the router should ever take a fee, that is exactly the kind of
"fee-adjustment step" `THREAT_MODEL.md`'s Elev.1 scenario 1 warns about, and would need the
authorization-binding question resolved explicitly as part of that feature's own design, not folded
in as an afterthought to v1.

### No formal verification / third-party audit yet

Per the roadmap (`technical-doc.md`'s adoption milestones, T1 tranche), an Audit Bank engagement is
planned but has not happened. This document and its accompanying test scaffolding exist specifically
so that engagement starts from a settled threat model rather than needing to reconstruct one from
Rust source, per the SDF Audit Bank's own stated precondition (a completed STRIDE threat model).
