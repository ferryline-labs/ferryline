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
 * Drives one `attested` transfer through submitting `mint_and_forward` to `delivered`. The daily
 * spend ceiling and per-transfer cap are both enforced by the CALLER (work/loop.ts consults
 * SpendCeiling before ever calling this for a new transfer; this function itself still checks the
 * per-transfer cap via buildSignedFeeBumpMintAndForward's `capStroops`, because that check depends
 * on the real fee-bump quote which is not known until the transaction is built).
 *
 * CRITICAL ordering, per the phase-3 sign-off: the transfer's status is written to `submitting` in
 * Postgres WITH the fee-bump's hash — computed deterministically from the already-signed envelope,
 * so no network round-trip is needed to know it — BEFORE `sendTransaction` broadcasts it. A crash
 * between that write and the broadcast (or between the broadcast and observing its result) leaves a
 * row in `submitting` with a real hash that reconcileSubmitting() can resolve on restart by asking
 * Stellar whether the nonce was actually consumed, without ever needing to know whether the
 * broadcast itself happened. See work/reconcile.ts and its crash-recovery test.
 */
export async function submitUntilDelivered(
  transfer: TransferRow,
  options: SubmitOptions,
  signal?: AbortSignal,
): Promise<TransferRow> {
  if (!transfer.irisMessage || !transfer.irisAttestation || !transfer.irisNonce) {
    throw new Error(
      `transfer ${transfer.id} is attested but missing its Iris message/attestation/nonce`,
    );
  }

  let built: { envelopeXdr: string; feeBumpFeeStroops: bigint };
  try {
    built = await buildSignedFeeBumpMintAndForward({
      rpc: options.rpc,
      signer: options.signer,
      networkPassphrase: options.networkPassphrase,
      sponsorAccount: options.sponsorAccount,
      inputs: {
        forwarderContractId: options.forwarderContractId,
        message: hexToBytes(transfer.irisMessage),
        attestation: hexToBytes(transfer.irisAttestation),
        memoText: transfer.id,
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
    destination: transfer.recipient,
    sponsorAccount: options.sponsorAccount,
  });

  const hash = feeBumpHashHex(built.envelopeXdr, options.networkPassphrase);

  // THE critical write: status -> submitting, WITH the hash, BEFORE broadcast.
  let submitting: TransferRow;
  try {
    submitting = await options.repo.transition(transfer.id, transfer.version, "submitting", {
      destinationTxHash: hash,
    });
  } catch {
    // A concurrent worker (or a prior crashed run's reconciler, already racing this same row)
    // moved it past `attested` first. Re-read and hand back wherever it actually is now rather
    // than attempting to broadcast a transaction whose place in the state machine is unclear.
    const current = await options.repo.get(transfer.id);
    if (current) {
      return current;
    }
    throw new RelayerRetryableError(
      `transfer ${transfer.id} vanished between attested and submitting`,
    );
  }

  const broadcast = await broadcastFeeBump(
    options.rpc,
    options.networkPassphrase,
    built.envelopeXdr,
  );
  if (broadcast.status === "ERROR") {
    // Rejected BEFORE entering the network (bad sequence number, insufficient balance, etc.) —
    // nothing was spent on-chain, so recordSpend must NOT be called. The row stays `submitting`
    // with a hash that will never appear on-chain; the reconciler's is_nonce_used check on restart
    // (or the next call to waitForDelivery below) correctly treats "no such transaction, nonce
    // still unused" as "safe to resubmit", so this is retried, not silently stuck.
    throw new RelayerRetryableError(
      `sendTransaction rejected the fee-bump: ${broadcast.errorDetail ?? "no detail"}`,
    );
  }

  // Confirmed submission accepted by the network: only now does the spend count against the daily
  // ceiling, matching STEP 4's "sum of actual spend, not estimated".
  await options.spendCeiling.recordSpend(built.feeBumpFeeStroops);

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
