import { backoffDelay, sleep, type SleepFn } from "@ferryline/sdk";
import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

import {
  broadcastFeeBump,
  buildSignedFeeBumpMintAndForward,
  SpendCapExceededError,
} from "../chain/mint-and-forward.js";
import { nonceIsUsedOnStellar } from "../chain/nonce-check.js";
import type { RelayerStellarRpc } from "../chain/stellar-rpc.js";
import type { TransferRepository, TransferRow } from "../repo/types.js";
import type { Signer } from "../signer/types.js";
import type { SpendCeiling } from "../spend/ceiling.js";
import type { SpendLog } from "../spend/spend-log.js";
import { RelayerRetryableError } from "./errors.js";

export interface SubmitOptions {
  readonly rpc: RelayerStellarRpc;
  readonly repo: TransferRepository;
  readonly signer: Signer;
  readonly sponsorAccount: string;
  readonly networkPassphrase: string;
  readonly forwarderContractId: string;
  readonly messageTransmitterContractId: string;
  readonly maxFeeBumpStroops: bigint;
  readonly spendCeiling: SpendCeiling;
  readonly spendLog: SpendLog;
  readonly pollIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  readonly sleep?: SleepFn;
  /**
   * Overrides for the two functions that actually simulate/broadcast against real Soroban RPC, for
   * tests that want to exercise THIS file's own logic (the spend-cap sequence, the spend-log/
   * spend-ledger-events write ordering, crash-safe status transitions, error classification) without
   * a full fixture-recorded RPC simulation of `mint_and_forward` — that belongs to
   * chain/mint-and-forward.ts's own test coverage, a separate concern from this file's. Defaults to
   * the real buildSignedFeeBumpMintAndForward/broadcastFeeBump — production code (main.ts, via
   * work/loop.ts) never sets this.
   */
  readonly drivers?: {
    readonly buildSignedFeeBumpMintAndForward?: typeof buildSignedFeeBumpMintAndForward;
    readonly broadcastFeeBump?: typeof broadcastFeeBump;
  };
}

function driversOf(options: SubmitOptions): {
  readonly buildSignedFeeBumpMintAndForward: typeof buildSignedFeeBumpMintAndForward;
  readonly broadcastFeeBump: typeof broadcastFeeBump;
} {
  return {
    buildSignedFeeBumpMintAndForward:
      options.drivers?.buildSignedFeeBumpMintAndForward ?? buildSignedFeeBumpMintAndForward,
    broadcastFeeBump: options.drivers?.broadcastFeeBump ?? broadcastFeeBump,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(clean, "hex"));
}

function asFeeBump(envelopeXdr: string, networkPassphrase: string): FeeBumpTransaction {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
  if (!(tx instanceof FeeBumpTransaction)) {
    throw new Error("expected a fee-bump transaction envelope");
  }
  return tx;
}

function feeBumpHashHex(envelopeXdr: string, networkPassphrase: string): string {
  return Buffer.from(asFeeBump(envelopeXdr, networkPassphrase).hash()).toString("hex");
}

/**
 * Drives one `attested` transfer through submitting `mint_and_forward` to `delivered`.
 *
 * Spend-cap sequence, per the phase-3 sign-off's no-gap requirement:
 *   1. Build the REAL fee-bump quote (not an estimate) — buildSignedFeeBumpMintAndForward, which
 *      also enforces the per-transfer cap against that real quote (capStroops).
 *   2. Reserve the daily ceiling ATOMICALLY against that same real quote — SpendCeiling.reserve is
 *      one Postgres statement that checks-and-increments together (see db/schema.sql and
 *      spend/ceiling.integration.test.ts), so two transfers racing the same ceiling can never both
 *      pass a check against room that only fits one.
 *   3. Broadcast.
 * Steps 1 and 2 happen before ANY write that could be observed as "this transfer is proceeding" —
 * the reservation is what makes step 3 safe, not a prior read of "is there room".
 *
 * If the reservation succeeds (step 2) but the broadcast is rejected before ever reaching the
 * network (step 3's `sendTransaction` returns "ERROR" — nothing was actually spent), the reservation
 * is released with a compensating decrement, so a build/broadcast failure never permanently burns
 * ceiling budget that was never spent.
 *
 * CRITICAL ordering, per the phase-3 sign-off: the transfer's status is written to `submitting` in
 * Postgres WITH the fee-bump's hash — computed deterministically from the already-signed envelope,
 * so no network round-trip is needed to know it — BEFORE `sendTransaction` broadcasts it. A crash
 * between that write and the broadcast (or between the broadcast and observing its result) leaves a
 * row in `submitting` with a real hash that reconcileSubmitting() can resolve on restart by asking
 * Stellar whether the nonce was actually consumed, without ever needing to know whether the
 * broadcast itself happened. See work/reconcile.ts and its crash-recovery test. This write happens
 * AFTER the ceiling reservation (step 2), so a crash between reservation and this write simply
 * leaves the reservation standing with no corresponding submission — the same "reservation without a
 * matching submission" shape as a build failure, and is not a state the daily ceiling needs to
 * distinguish from any other successful reservation: the budget was real, spendable budget at the
 * moment it was reserved, and staying reserved after a crash is the conservative (never-overspend)
 * direction to fail in.
 *
 * STEP 5: alongside spendLog.record's pre-attempt log (spend_attempts), this function also writes a
 * durable event to spend_ledger_events at every point a reservation's outcome becomes known —
 * 'reserved' once reserve() actually succeeds, 'released' (with a typed reason distinguishing the
 * concurrent-race case from the broadcast-rejected case) at either release() call, or 'broadcast'
 * once sendTransaction accepts the fee-bump. Each write happens immediately before its corresponding
 * action, same discipline as every other spend-log write here, so spend_ledger_events plus
 * spend_attempts together reconstruct true net spend independently of this function's own control
 * flow — see db/schema.sql's comments on both tables.
 */
export async function submitUntilDelivered(
  transfer: TransferRow,
  options: SubmitOptions,
  signal?: AbortSignal,
): Promise<TransferRow> {
  if (
    !transfer.irisMessage ||
    !transfer.irisAttestation ||
    !transfer.irisNonce ||
    !transfer.recipient
  ) {
    throw new Error(
      `transfer ${transfer.id} is attested but missing its Iris message/attestation/nonce/recipient ` +
        `(attestOnce always sets all four together; this indicates a bug, not a normal null case)`,
    );
  }
  const recipient = transfer.recipient;
  const drivers = driversOf(options);

  // Step 1: the real quote (also enforces the per-transfer cap against it).
  let built: { envelopeXdr: string; feeBumpFeeStroops: bigint };
  try {
    built = await drivers.buildSignedFeeBumpMintAndForward({
      rpc: options.rpc,
      signer: options.signer,
      networkPassphrase: options.networkPassphrase,
      sponsorAccount: options.sponsorAccount,
      inputs: {
        forwarderContractId: options.forwarderContractId,
        message: hexToBytes(transfer.irisMessage),
        attestation: hexToBytes(transfer.irisAttestation),
      },
      capStroops: options.maxFeeBumpStroops,
    });
  } catch (error) {
    if (error instanceof SpendCapExceededError) {
      return options.repo.transition(transfer.id, transfer.version, "failed", {
        errorCode: "TRANSFER_EXCEEDS_SPEND_CAP",
        errorDetail: error.message,
      });
    }
    throw new RelayerRetryableError(`failed to build/sign mint_and_forward: ${String(error)}`, {
      cause: error,
    });
  }

  // Every spend attempt is logged BEFORE submission, to a table independent of `transfers` (see
  // spend/spend-log.ts). This must happen even if the process dies on the very next line.
  await options.spendLog.record({
    transferId: transfer.id,
    amountStroops: built.feeBumpFeeStroops,
    destination: recipient,
    sponsorAccount: options.sponsorAccount,
  });

  // Step 2: reserve the daily ceiling atomically against the REAL quote, with no gap before step 3.
  const reservation = await options.spendCeiling.reserve(built.feeBumpFeeStroops);
  if (!reservation.reserved) {
    // The ceiling has no room RIGHT NOW, but this is a global, time-bound condition, not a fact
    // about this transfer — the ceiling resets at UTC midnight, or an operator can raise it. Marking
    // the transfer permanently `failed` here would strand it forever for a reason that will resolve
    // itself. It stays `attested` (this is a RelayerRetryableError: no status-changing transition
    // happens), and the work loop's next poll pass picks it up again. Per STEP 4, the loop itself
    // (work/loop.ts) is what actually stops starting NEW work while the ceiling is exhausted —
    // this per-transfer retry is what makes that pause harmless rather than a silent drop.
    //
    // Deliberately NO spend_ledger_events row for this case: the reservation never actually
    // happened (reserve() returned reserved: false, nothing was written to daily_spend), so there
    // is no 'reserved' event to record and nothing to later release — this is the "attempted but
    // never became a real reservation" case, distinct from "reserved, then released" below.
    throw new RelayerRetryableError(
      `daily spend ceiling reached: reserving ${built.feeBumpFeeStroops.toString()} stroops would push today's total past the configured limit (currently ${reservation.spentAfter.toString()} stroops spent)`,
    );
  }

  // STEP 5: the reservation just SUCCEEDED — daily_spend's own row already reflects it durably,
  // but this event log makes the reservation's existence and outcome (reserved/released/broadcast)
  // reconstructable per-transfer without needing to diff daily_spend's aggregate against
  // spend_attempts's gross attempts. Written immediately after the reservation is confirmed real
  // (not before attempting it — an attempt that fails to reserve is not a "reserved" event, see the
  // comment above) and before anything that could crash and leave this reservation's existence
  // ambiguous. See db/schema.sql's spend_ledger_events comment for the full reasoning.
  await options.spendLog.recordEvent({
    type: "reserved",
    transferId: transfer.id,
    amountStroops: built.feeBumpFeeStroops,
  });

  const hash = feeBumpHashHex(built.envelopeXdr, options.networkPassphrase);

  // Step 3 (broadcast) starts here. THE critical write: status -> submitting, WITH the hash, BEFORE
  // broadcast.
  let submitting: TransferRow;
  try {
    submitting = await options.repo.transition(transfer.id, transfer.version, "submitting", {
      destinationTxHash: hash,
    });
  } catch {
    // A concurrent worker (or a prior crashed run's reconciler, already racing this same row)
    // moved it past `attested` first. The reservation we just took is for a broadcast that will
    // never happen from here, so give it back, then re-read and hand back wherever the row
    // actually is now rather than attempting to broadcast a transaction whose place in the state
    // machine is unclear.
    //
    // STEP 5: the 'released' event, with its typed reason, is recorded BEFORE the release itself —
    // same "log before you act" rule as every other spend-log write in this function.
    await options.spendLog.recordEvent({
      type: "released",
      transferId: transfer.id,
      amountStroops: built.feeBumpFeeStroops,
      reason: "concurrent_race_lost",
    });
    await options.spendCeiling.release(built.feeBumpFeeStroops);
    const current = await options.repo.get(transfer.id);
    if (current) {
      return current;
    }
    throw new RelayerRetryableError(
      `transfer ${transfer.id} vanished between attested and submitting`,
    );
  }

  const broadcast = await drivers.broadcastFeeBump(
    options.rpc,
    options.networkPassphrase,
    built.envelopeXdr,
  );
  if (broadcast.status === "ERROR") {
    // Rejected BEFORE entering the network (bad sequence number, insufficient balance, etc.) —
    // nothing was spent on-chain, so the reservation must be released: it was never actually spent.
    // The row stays `submitting` with a hash that will never appear on-chain; the reconciler's
    // is_nonce_used check on restart (or the next call to waitForDelivery below) correctly treats
    // "no such transaction, nonce still unused" as "safe to resubmit", so this is retried, not
    // silently stuck — and the retry will take a fresh reservation against the (now-corrected)
    // ceiling rather than double-counting this failed attempt.
    //
    // STEP 5: same "log before you act" rule — the 'released' event, with its own distinct typed
    // reason (this is a different code path than the concurrent-race case above, and an auditor
    // asking "how much capacity did we lose to broadcast failures vs. worker races" needs the two
    // distinguished, not collapsed into one undifferentiated "released").
    await options.spendLog.recordEvent({
      type: "released",
      transferId: transfer.id,
      amountStroops: built.feeBumpFeeStroops,
      reason: "broadcast_rejected",
    });
    await options.spendCeiling.release(built.feeBumpFeeStroops);
    throw new RelayerRetryableError(
      `sendTransaction rejected the fee-bump: ${broadcast.errorDetail ?? "no detail"}`,
    );
  }

  // Broadcast accepted by the network (PENDING/DUPLICATE/TRY_AGAIN_LATER): the reservation stands
  // as real, committed spend. STEP 5: the 'broadcast' event records this outcome — no release will
  // ever follow this reservation now — closing out this transfer's event sequence.
  await options.spendLog.recordEvent({
    type: "broadcast",
    transferId: transfer.id,
    amountStroops: built.feeBumpFeeStroops,
  });

  return waitForDelivery(submitting, options, signal);
}

/** Polls is_nonce_used on Stellar until the forwarder's mint is confirmed, then marks delivered. */
export async function waitForDelivery(
  transfer: TransferRow,
  options: Pick<
    SubmitOptions,
    | "rpc"
    | "repo"
    | "networkPassphrase"
    | "messageTransmitterContractId"
    | "sponsorAccount"
    | "pollIntervalMs"
    | "pollMaxIntervalMs"
    | "sleep"
  >,
  signal?: AbortSignal,
): Promise<TransferRow> {
  const wait = options.sleep ?? sleep;
  const nonce = transfer.irisNonce;
  if (!nonce) {
    throw new Error(`transfer ${transfer.id} has no iris_nonce to check delivery against`);
  }
  for (let attempt = 0; ; attempt += 1) {
    const used = await nonceIsUsedOnStellar(
      options.rpc,
      options.networkPassphrase,
      options.messageTransmitterContractId,
      nonce,
      options.sponsorAccount,
    );
    if (used) {
      return options.repo.transition(transfer.id, transfer.version, "delivered");
    }
    await wait(
      backoffDelay(attempt, {
        initialMs: options.pollIntervalMs,
        maxMs: options.pollMaxIntervalMs,
      }),
      signal,
    );
  }
}
