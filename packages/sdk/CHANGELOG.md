# Changelog

All notable changes to `@ferryline/sdk` are documented in this file. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); this package has not yet cut a numbered release
(still `0.0.0`, pre-alpha), so entries are dated rather than versioned.

## Unreleased

### Fixed

- **2026-09-12 — both outbound rail builders (`usdc-cctp`'s `deposit_for_burn`, `usdt0-layerzero`'s
  `send`) attached a `MEMO_TEXT` to the Stellar transaction they built — but Soroban
  `InvokeHostFunctionOp` transactions can never carry a memo, on any network. Confirmed with a real
  testnet RPC rejection while proving the widget phase's outbound wallet-signing seam:
  `"Transaction contains a memo. Soroban transactions do not support memos."` Every real outbound
  send on either rail was broken for every caller before this fix — not a partial or edge-case bug.
  A third, identical instance in `@ferryline/relayer`'s own `mint_and_forward` builder
  (`packages/relayer/src/chain/mint-and-forward.ts`) was found and fixed the same day, before a real
  inbound delivery could hit it.

  **This supersedes a design decision from phase 2** (introduced in commit `094c632`, "Phase 2:
  USDT0 LayerZero adapter..."), which explicitly chose `MEMO_TEXT` as the correlation mechanism
  between a `transferId` and its on-chain Stellar transaction, specifically so a caller "can
  correlate the on-chain transaction with this transfer without a database round-trip." That
  mechanism is now confirmed structurally impossible, not merely buggy — a Soroban transaction has
  no code path that lets it carry a memo, so this was never something a more careful implementation
  could have salvaged.

  **What actually replaced it, confirmed by tracing every real line of `track()` (both rails), not
  assumed:** nothing new needed to be built. `track()` never actually read the memo back in the
  first place — it has always resolved `sourceTxHash` from the caller's own `TransferStore`
  (written once via the already-public `Ferryline.markSubmitted(transferId, sourceTxHash)`, using
  the real, network-issued transaction hash the wallet gets back after broadcasting), then polls
  `stellarRpc.getTransaction(sourceTxHash)` by that real hash directly. For `usdt0-layerzero`
  specifically, the LayerZero GUID needed for Scan lookups is read from the confirmed transaction's
  own real on-chain return value (`tx.returnValue`), not from a memo either. The `MEMO_TEXT`
  attachment was pure write-only dead weight from `track()`'s point of view: a real value written
  on-chain that no real code path ever read back. Confirmed by an exhaustive repo-wide sweep (every
  `TransactionBuilder`/`buildInvocation` call site, SDK + relayer + experiments) that these three
  call sites were the only three that ever attempted to attach a memo to a Soroban invocation — no
  fourth instance exists.

  **Positive, unplanned side effect:** the phase-2 comment this supersedes also documented a
  standing limitation — a sender whose Stellar account is hosted by a custodial service that
  attaches its own memo to every outgoing transaction "cannot use this rail through Ferryline"
  under the old design, since the memo attachment was unconditional and left no room for a
  custodian's own memo. That limitation is fully and permanently resolved by this fix: Ferryline no
  longer needs a memo on this call at all, so a custodian's own memo (whatever it is) no longer
  conflicts with anything.

  **Public API surface at the time of this fix:** `memoFitsText` and `buildInvocation`'s `memoText`
  parameter were left in place, on the reasoning that they were unused rather than unusable. See the
  follow-up entry below — that reasoning was revisited the same day and those two were removed too.
  The one behavioral change a caller could theoretically observe from the two rail-builder fixes
  above: `buildOutbound` no longer throws `TRANSFER_ID_INVALID` if a `transferId` doesn't fit
  `MEMO_TEXT`'s 28-byte limit. This was already unreachable in practice (`transferId`s are ULIDs,
  fixed at 26 characters, always within that limit) — `TRANSFER_ID_INVALID` itself remains a real,
  defined error code (`@ferryline/core`'s `errors.ts`), still thrown from `assertTransferId` for an
  actually-malformed transfer id; only this one, never-reachable throw site was removed.

  Independent corroborating evidence found during the same sweep: a real mainnet CCTP burn
  recorded on 2026-09-11 (`packages/sdk/src/rails/usdc-cctp/__fixtures__/mainnet-2026-09-11.json`,
  predating this bug) shows `memo: "memoNone"` — a real, successful mainnet burn never carried a
  memo either, a signal that was available before this bug was introduced.

  83 SDK tests and 98 relayer tests pass after the fix (this bug never touched the Rust/Soroban
  router contract, only the TypeScript SDK and relayer). See
  `packages/core/verified/experiments/2026-09-12-widget-seam-outbound-cctp.md` and
  `.../2026-09-12-widget-seam-inbound-relayer.md` for the real, on-chain transactions that surfaced
  and then confirmed the fix.

- **2026-09-12 (same-day follow-up) — `memoFitsText` and `buildInvocation`'s `memoText` parameter
  removed.** The memo-bug fix above deliberately left these two in place at the time, reasoning
  that they were merely unused, not unusable. Revisited while wiring the widget's own real
  `RailAdapter` usage (`packages/widget/src/`): `buildInvocation`/`buildUnsimulated`
  (`packages/sdk/src/stellar/rpc.ts`) still accepted a `memoText` field and, if passed, would call
  `builder.addMemo(Memo.text(...))` on a Soroban `InvokeHostFunctionOp` transaction — the exact
  mechanism the three fixed call sites had funneled the original bug through, still live and still
  documented (wrongly, post-fix) as "Attached as MEMO_TEXT. Must be at most 28 bytes." A repo-wide
  search confirmed zero real callers of either `memoText` or `memoFitsText` remained anywhere in
  `packages/sdk`, `packages/relayer`, or `packages/widget`, and neither had any test coverage.
  Removed both outright rather than leaving them unused: this makes it a compile-time impossibility
  for a future rail adapter to reintroduce the memo bug through this shared primitive, not merely a
  matter of nobody currently choosing to. **Public API surface:** `memoFitsText` (a named export of
  `@ferryline/sdk`) and `InvokeParams.memoText` are both removed; both were unreachable code paths
  with no real caller, not behavior anything actually exercised. 83 SDK tests still pass unchanged
  (none referenced either symbol); relayer typechecks clean.

