import { backoffDelay, sleep, type SleepFn } from "@ferryline/sdk";

import { nonceIsUsedOnEvm } from "../chain/evm-nonce-check.js";
import type { RelayerEvmRpc } from "../chain/evm-rpc.js";
import type { OutboundTransferRepository, OutboundTransferRow } from "../repo/outbound-types.js";
import type { EvmSigner } from "../signer/evm-types.js";
import type { OutboundSpendCeiling } from "../spend/outbound-ceiling.js";
import type { OutboundSpendLog } from "../spend/outbound-spend-log.js";
import { OutboundRelayerRetryableError } from "./outbound-errors.js";

export interface OutboundSubmitOptions {
  readonly rpc: RelayerEvmRpc;
  readonly repo: OutboundTransferRepository;
  readonly signer: EvmSigner;
  readonly messageTransmitterV2: `0x${string}`;
  readonly destinationChain: string;
  readonly maxGasCostWei: bigint;
  readonly spendCeiling: OutboundSpendCeiling;
  readonly spendLog: OutboundSpendLog;
  readonly pollIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  readonly sleep?: SleepFn;
}

/**
 * Drives one `attested` outbound transfer through submitting `receiveMessage` to `delivered`.
 * Mirrors submit.ts's own submitUntilDelivered exactly — same spend-cap sequence, same no-gap
 * requirement, same crash-safe write-before-broadcast ordering, same append-only spend-log
 * discipline — adapted for viem's simulate/estimate/write shape instead of Stellar's
 * build-signed-fee-bump shape.
 *
 * Spend-cap sequence, per the phase-3 sign-off's no-gap requirement (identical to submit.ts's own,
 * restated here for this file's own real values):
 *   1. Get the REAL, current gas-cost quote (estimateReceiveMessageGasCostWei) — NOT a stale
 *      estimate from whenever this transfer was first attested — and enforce the per-transfer cap
 *      against THAT quote. This is what makes a retry safe: every attempt re-quotes and re-checks
 *      against maxGasCostWei fresh, so a transfer can never sneak a higher-than-cap spend through by
 *      virtue of being a retry (see outbound-submit.test.ts's explicit retry-cap test).
 *   2. Reserve the daily ceiling ATOMICALLY against that same real quote — OutboundSpendCeiling.reserve
 *      is one Postgres statement that checks-and-increments together (see db/schema.sql and
 *      outbound-ceiling.integration.test.ts), so two transfers racing the same ceiling can never both
 *      pass a check against room that only fits one.
 *   3. Simulate (catches a revert — e.g. nonce already used — before spending anything on it).
 *   4. Broadcast.
 * Steps 1 and 2 happen before ANY write that could be observed as "this transfer is proceeding".
 *
 * If the reservation succeeds (step 2) but simulation/broadcast is then rejected before ever
 * reaching the network, the reservation is released with a compensating decrement — identical
 * "never permanently burn ceiling budget that was never spent" guarantee as the inbound version.
 *
 * CRITICAL ordering, identical to submit.ts's own: status is written to `submitting` in Postgres
 * WITH the real receiveMessage transaction hash BEFORE waiting for its receipt — writeReceiveMessage
 * returns the hash immediately on broadcast acceptance, without waiting for confirmation, so this
 * write can happen before any network round-trip for confirmation is needed. A crash between that
 * write and confirmation leaves a row in `submitting` with a real hash that
 * reconcileOutboundSubmitting can resolve on restart by asking the destination chain whether the
 * nonce was actually consumed — see work/outbound-reconcile.ts and its crash-recovery test.
 *
 * Spend-log discipline: spendLog.record's pre-attempt log (outbound_spend_attempts) happens BEFORE
 * the ceiling reservation is even tried; spendLog.recordEvent writes the outcome ('reserved',
 * 'released', or 'broadcast') to outbound_spend_ledger_events at every point that outcome becomes
 * known, each call immediately before the corresponding action — identical discipline to submit.ts.
 */
export async function submitOutboundUntilDelivered(
  transfer: OutboundTransferRow,
  options: OutboundSubmitOptions,
  signal?: AbortSignal,
): Promise<OutboundTransferRow> {
  if (
    !transfer.irisMessage ||
    !transfer.irisAttestation ||
    !transfer.irisNonce ||
    !transfer.recipient
  ) {
    throw new Error(
      `outbound transfer ${transfer.id} is attested but missing its Iris message/attestation/nonce/` +
        `recipient (attestOutboundOnce always sets all four together; this indicates a bug, not a ` +
        `normal null case)`,
    );
  }
  const message = transfer.irisMessage as `0x${string}`;
  const attestation = transfer.irisAttestation as `0x${string}`;
  const account = await options.signer.address();

  // Step 1: the REAL, current gas-cost quote — fetched fresh on every call (including a retry), so
  // the per-transfer cap is always enforced against today's real price, never a stale figure from an
  // earlier attempt. This is the property that makes "same cap on every retry" true by construction
  // rather than by a separate check: there is no cached quote anywhere in this function for a retry
  // to inherit.
  let gasCostWei: bigint;
  try {
    gasCostWei = await options.rpc.estimateReceiveMessageGasCostWei({
      messageTransmitterV2: options.messageTransmitterV2,
      message,
      attestation,
      account,
    });
  } catch (error) {
    throw new OutboundRelayerRetryableError(
      `failed to estimate receiveMessage gas cost: ${String(error)}`,
      {
        cause: error,
      },
    );
  }

  if (gasCostWei > options.maxGasCostWei) {
    return options.repo.transition(transfer.id, transfer.version, "failed", {
      errorCode: "TRANSFER_EXCEEDS_SPEND_CAP",
      errorDetail:
        `estimated gas cost ${gasCostWei.toString()} wei exceeds the configured per-transfer cap ` +
        `of ${options.maxGasCostWei.toString()} wei`,
    });
  }

  // Every spend attempt is logged BEFORE submission, to a table independent of `outbound_transfers`
  // (see spend/outbound-spend-log.ts). This must happen even if the process dies on the very next
  // line.
  await options.spendLog.record({
    transferId: transfer.id,
    amountWei: gasCostWei,
    destination: transfer.recipient,
    destinationChain: options.destinationChain,
    sponsorAccount: account,
  });

  // Step 2: reserve the daily ceiling atomically against the REAL quote, with no gap before
  // simulation/broadcast.
  const reservation = await options.spendCeiling.reserve(options.destinationChain, gasCostWei);
  if (!reservation.reserved) {
    // Same reasoning as submit.ts's own identical branch: a global, time-bound condition, not a fact
    // about this transfer. Stays `attested`; the work loop's next poll pass (or the ceiling gate's
    // "stop starting new work" check) picks it up again. Deliberately no spend_ledger_events row: the
    // reservation never actually happened.
    throw new OutboundRelayerRetryableError(
      `daily gas ceiling reached: reserving ${gasCostWei.toString()} wei would push today's total ` +
        `past the configured limit (currently ${reservation.spentAfter.toString()} wei spent)`,
    );
  }

  await options.spendLog.recordEvent({
    type: "reserved",
    transferId: transfer.id,
    amountWei: gasCostWei,
  });

  // Step 3: simulate — catches a revert (nonce already used, malformed message) before spending
  // anything broadcasting it. A NONCE_ALREADY_USED revert here means someone else (or a prior
  // unreconciled run of this same relayer) already delivered this message — permissionless
  // receiveMessage, per FAQ.md — so this transfer can go straight to `delivered`... except we cannot
  // safely assert that without checking usedNonces directly (a revert's message text is not a
  // contract-verified fact the way a direct usedNonces read is), so instead this checks usedNonces
  // explicitly on a simulation failure, giving the same crash-recovery-quality answer
  // reconcileOutboundSubmitting gives on restart, rather than guessing from the revert reason string.
  let prepared: Awaited<ReturnType<RelayerEvmRpc["simulateReceiveMessage"]>>;
  try {
    prepared = await options.rpc.simulateReceiveMessage({
      messageTransmitterV2: options.messageTransmitterV2,
      message,
      attestation,
    });
  } catch (simulateError) {
    // The reservation was for a broadcast that will never happen from here — release it before
    // deciding anything else, same "log before you act" ordering as every other release in this
    // function.
    await options.spendLog.recordEvent({
      type: "released",
      transferId: transfer.id,
      amountWei: gasCostWei,
      reason: "broadcast_rejected",
    });
    await options.spendCeiling.release(options.destinationChain, gasCostWei);

    const used = await nonceIsUsedOnEvm(
      options.rpc,
      options.messageTransmitterV2,
      transfer.irisNonce as `0x${string}`,
    );
    if (used) {
      return options.repo.transition(transfer.id, transfer.version, "failed", {
        errorCode: "NONCE_ALREADY_USED",
        errorDetail:
          `receiveMessage simulation reverted and usedNonces confirms the nonce is already ` +
          `consumed on-chain: ${String(simulateError)}`,
      });
    }
    throw new OutboundRelayerRetryableError(
      `receiveMessage simulation reverted for a reason other than an already-used nonce: ${String(simulateError)}`,
      { cause: simulateError },
    );
  }

  // STEP 5: the critical write — status -> submitting, WITH the real destination tx hash, BEFORE
  // waiting for confirmation. writeReceiveMessage returns the hash on broadcast acceptance without
  // waiting for a receipt (see chain/evm-rpc.ts's own doc comment), so this ordering is possible the
  // same way submit.ts's deterministic fee-bump-hash-before-broadcast ordering is.
  let hash: `0x${string}`;
  try {
    hash = await options.rpc.writeReceiveMessage(prepared.request);
  } catch (broadcastError) {
    // Rejected before ever reaching the network (e.g. underpriced, nonce/sequencing issue on the
    // relayer's OWN EVM account — not to be confused with the CCTP message nonce) — nothing was
    // spent, so release.
    await options.spendLog.recordEvent({
      type: "released",
      transferId: transfer.id,
      amountWei: gasCostWei,
      reason: "broadcast_rejected",
    });
    await options.spendCeiling.release(options.destinationChain, gasCostWei);
    throw new OutboundRelayerRetryableError(
      `writeReceiveMessage was rejected before broadcast: ${String(broadcastError)}`,
      { cause: broadcastError },
    );
  }

  // Broadcast accepted: the reservation stands as real, committed spend.
  await options.spendLog.recordEvent({
    type: "broadcast",
    transferId: transfer.id,
    amountWei: gasCostWei,
  });

  let submitting: OutboundTransferRow;
  try {
    submitting = await options.repo.transition(transfer.id, transfer.version, "submitting", {
      destinationTxHash: hash,
    });
  } catch {
    // A concurrent worker (or a prior crashed run's reconciler, already racing this same row) moved
    // it past `attested` first. The broadcast has ALREADY happened by this point (unlike the
    // Stellar-side submit.ts, where the equivalent race is caught before broadcasting) — re-read and
    // hand back wherever the row actually is now. This does not need its own spend-ledger release:
    // the broadcast already succeeded and was already logged as 'broadcast' above; this is a
    // bookkeeping race on which task gets to record the transition, not a spend outcome.
    const current = await options.repo.get(transfer.id);
    if (current) {
      return current;
    }
    throw new OutboundRelayerRetryableError(
      `outbound transfer ${transfer.id} vanished between attested and submitting`,
    );
  }

  return waitForOutboundDelivery(submitting, options, signal);
}

/** Polls usedNonces on the destination EVM chain until receiveMessage is confirmed, then marks
 *  delivered. Mirrors submit.ts's own waitForDelivery exactly, adapted to poll usedNonces instead of
 *  is_nonce_used. */
export async function waitForOutboundDelivery(
  transfer: OutboundTransferRow,
  options: Pick<
    OutboundSubmitOptions,
    "rpc" | "repo" | "messageTransmitterV2" | "pollIntervalMs" | "pollMaxIntervalMs" | "sleep"
  >,
  signal?: AbortSignal,
): Promise<OutboundTransferRow> {
  const wait = options.sleep ?? sleep;
  const nonce = transfer.irisNonce;
  if (!nonce) {
    throw new Error(`outbound transfer ${transfer.id} has no iris_nonce to check delivery against`);
  }
  for (let attempt = 0; ; attempt += 1) {
    const used = await nonceIsUsedOnEvm(
      options.rpc,
      options.messageTransmitterV2,
      nonce as `0x${string}`,
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
