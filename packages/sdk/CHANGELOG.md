# Changelog

All notable changes to `@ferryline/sdk` are documented in this file. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). Every entry below predates this file being
updated for a real release (the package first published to npm as `0.1.0` on 2026-09-13, without
this file being revised to say so at the time — a real gap, corrected here rather than silently),
so entries through the `nonceUsed` fix are dated rather than versioned, and reflect work that
shipped as part of `0.1.0`. Starting with `0.1.1`, entries are grouped under their real published
version.

## 0.1.2 (2026-09-15)

### Changed

- **`Ferryline.registerOutboundTransfer(transferId)` now returns
  `Promise<RegisterOutboundTransferResult>` (`{ registered: boolean, error?: string }`) instead of
  `Promise<void>`.** Its existing "never breaks the caller's flow" guarantee is unchanged — it still
  never throws, for any reason (no relayer configured, not an outbound CCTP transfer, a store read
  failure, or the relayer call itself genuinely failing all resolve rather than reject). What changed
  is that a caller can now tell these outcomes apart: `registered: true` only for a real, confirmed
  `201` from the relayer; `registered: false` with no `error` for every "not applicable" case (same
  silent outcome those cases already had); `registered: false` with a real `error` message only when
  a registration attempt genuinely happened and failed.

  **Why:** found live, via `@ferryline/widget`'s own real testnet testing. A misconfigured relayer
  API key produced a genuine `401`, correctly logged via `console.error`, but the widget's delivery
  caveat still rendered "this transfer has been registered with the configured relayer" — an honest
  false-positive claim, because the old `void` return gave the widget no way to know registration had
  actually failed. `@ferryline/widget` now uses the real result to choose between three caveat
  variants (not configured / genuinely registered / genuinely failed) instead of assuming success
  whenever a relayer was configured at all.

  **This is technically a breaking type change** (`Promise<void>` → `Promise<RegisterOutboundTransferResult>`)
  released as a patch rather than a minor bump: pre-1.0, no known external callers besides this
  monorepo's own widget, and additive in practice for any caller who was only ever `await`-ing the
  call without using its return value. If you have code that asserts on this method's resolved value
  being `undefined`, or otherwise types it as `void`, it needs updating to the new
  `RegisterOutboundTransferResult` shape.

  Every real call site in this repo was updated: `@ferryline/widget`'s own `afterStepSubmitted`
  captures the result and threads it into its delivery-caveat rendering; this package's own
  `index.test.ts` (13 tests, 5 needed real changes to assert the new result shape for both the
  not-applicable and genuine-failure cases, and to assert `{ registered: true }` directly on the
  success paths rather than only inferring success from `fetch` call counts).

## 0.1.1 (2026-09-14)

### Fixed

- **2026-09-14 — every EVM address check (`usdc-cctp` and `usdt0-layerzero`, both rails: recipient,
  sender, and refund-address resolution — 7 call sites total) validated format only (`0x` + 40 hex
  characters via a plain regex), not the EIP-55 mixed-case checksum.** A syntactically valid but
  genuinely wrong address — for example a single flipped letter-case in an otherwise-correct
  address, `0x7BE6FA75805d77Bc3FE8F004bbEc49f7d4f1AC50` instead of the real
  `0x7bE6FA75805d77Bc3FE8F004bbEc49f7d4f1AC50` — passed every check silently. All-lowercase and
  all-uppercase input (both checksum-agnostic under EIP-55) are unaffected and still accepted, so
  this closes a real gap without rejecting legitimate input any real wallet or explorer would
  accept. Found while manually double-checking a real address before a real mainnet USDT0 send
  (see `packages/core/verified/experiments/2026-09-14-widget-usdt0-mainnet-outbound.md`) — the SDK
  itself would not have caught a copy-paste checksum error the way that manual check did. Fixed by
  replacing the internal format-only checks with `viem`'s `isAddress` (already an SDK dependency).
  The public `EVM_ADDRESS` export (`packages/sdk/src/evm/reader.ts`) is UNCHANGED — it remains the
  same format-only regex it always was, since it's public API and this fix only tightens Ferryline's
  own internal validation, not that exported contract. Four new tests added (two adapters x
  recipient/sender), each proving the exact same-length, same-hex, wrong-checksum scenario is now
  rejected. 95 SDK tests pass after the fix.

  **If you installed `@ferryline/sdk@0.1.0`, upgrade to `0.1.1`**: this is the only functional
  change in this release, and it is a security-relevant input-validation fix — a copy-paste or
  transcription error that flips a single letter's case in an otherwise-correct EVM address would
  previously have been silently accepted rather than rejected.

## 0.1.0 (2026-09-13)

First published release. Every entry below predates this file being updated to record real
release versions (see the file-level note above) — each was already shipped code by the time
`0.1.0` was actually published, not a promise for a future release.

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

- **2026-09-12 — `nonceUsed` (usdc-cctp/stellar.ts) did not validate the nonce was exactly 32
  bytes before calling `MessageTransmitter.is_nonce_used`.** (Dated 2026-09-15 in an earlier
  version of this entry — a real, pre-existing date error unrelated to any release; the actual
  fix commit is `e3722a9`, 2026-09-12, corrected here while restructuring this file for real
  release versions.) The contract's parameter is `BytesN<32>`, a fixed-size type; a caller passing
  the wrong length reached Soroban and the call trapped with an opaque `HostError: Error(WasmVm,
  InvalidAction)`, confirmed against a real mainnet simulation. `nonceUsed` now rejects a
  wrong-length nonce client-side with a clear `FerrylineError` (code `PARAMETER_INVALID`) before
  ever calling `simulateTransaction`. This function is used by the `usdc-cctp` adapter's
  delivery-tracking (`track()`, added in phase 2b) and by the relayer's reconciliation and
  delivery-polling logic (phase 3) — the bug predates phase 3 but was only caught while building
  the relayer's crash-recovery test, which is the first caller to have exercised it against a
  malformed-length value. See [`packages/core/VERIFIED.md`](../core/VERIFIED.md) for the upstream
  evidence and `packages/sdk/src/rails/usdc-cctp/stellar.test.ts` for the regression test.
