import type { RelayerStellarRpc } from "../chain/stellar-rpc.js";
import { nonceIsUsedOnStellar } from "../chain/nonce-check.js";
import type { TransferRepository, TransferRow } from "../repo/types.js";

export interface ReconcileOptions {
  readonly rpc: RelayerStellarRpc;
  readonly repo: TransferRepository;
  readonly networkPassphrase: string;
  readonly messageTransmitterContractId: string;
  /** Funds the read-only is_nonce_used simulation's footprint. The relayer's sponsor account (always funded). */
  readonly sourceAccount: string;
}

export type ReconcileOutcome =
  | { readonly kind: "already-delivered"; readonly row: TransferRow }
  | { readonly kind: "resubmit"; readonly row: TransferRow };

/**
 * Resolves ONE transfer found in `submitting` at startup — the exact scenario the phase-3 sign-off
 * requires a crash-recovery test for: the process wrote `submitting` (with a real destination tx
 * hash, per submitUntilDelivered's crash-safe ordering) and then died before observing whether that
 * transaction was actually delivered.
 *
 * The only question that matters, and the only one this function asks: is the message's nonce
 * already consumed on Stellar's MessageTransmitter?
 *   - YES -> the prior submission succeeded; we only missed marking it `delivered`. Do that now.
 *     Never re-broadcast — CCTP nonces are one-shot, so resubmitting a delivered mint would fail
 *     (and, per Circle, delivering it a second time is not merely wasteful, it is not possible: the
 *     forwarder's underlying receive_message rejects a reused nonce) but the important property is
 *     we do not attempt to spend again for something already paid for.
 *   - NO -> nothing was ever consumed. Whether the crash happened before, during, or after the
 *     broadcast attempt is irrelevant: it is safe to resubmit, because the nonce is still open.
 *     This function does not resubmit itself (that is submitUntilDelivered's job, called again from
 *     the same `attested`-derived inputs still on the row); it reports which case applies so the
 *     caller (work/loop.ts at startup) knows whether to skip straight to `delivered` or hand the row
 *     back into the normal submit path.
 */
export async function reconcileSubmitting(
  transfer: TransferRow,
  options: ReconcileOptions,
): Promise<ReconcileOutcome> {
  if (transfer.status !== "submitting") {
    throw new Error(
      `reconcileSubmitting called on a transfer in status "${transfer.status}", not "submitting"`,
    );
  }
  if (!transfer.irisNonce) {
    throw new Error(`transfer ${transfer.id} is submitting but has no iris_nonce recorded`);
  }

  const used = await nonceIsUsedOnStellar(
    options.rpc,
    options.networkPassphrase,
    options.messageTransmitterContractId,
    transfer.irisNonce,
    options.sourceAccount,
  );

  if (used) {
    const delivered = await options.repo.transition(transfer.id, transfer.version, "delivered");
    return { kind: "already-delivered", row: delivered };
  }
  return { kind: "resubmit", row: transfer };
}

/**
 * Runs reconcileSubmitting over every row currently in `submitting`. Called once at relayer
 * startup, before the normal work loop begins processing `pending`/`attested` transfers — so a
 * transfer that was mid-flight when the process died is resolved first, deterministically, rather
 * than racing a normal poll pass that might also pick it up.
 */
export async function reconcileAllSubmitting(
  options: ReconcileOptions,
): Promise<readonly ReconcileOutcome[]> {
  const stuck = await options.repo.listByStatus("submitting");
  const outcomes: ReconcileOutcome[] = [];
  for (const transfer of stuck) {
    outcomes.push(await reconcileSubmitting(transfer, options));
  }
  return outcomes;
}
