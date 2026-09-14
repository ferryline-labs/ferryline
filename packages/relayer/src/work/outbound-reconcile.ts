import { nonceIsUsedOnEvm } from "../chain/evm-nonce-check.js";
import type { RelayerEvmRpc } from "../chain/evm-rpc.js";
import type { OutboundTransferRepository, OutboundTransferRow } from "../repo/outbound-types.js";

export interface OutboundReconcileOptions {
  readonly rpc: RelayerEvmRpc;
  readonly repo: OutboundTransferRepository;
  readonly messageTransmitterV2: `0x${string}`;
}

export type OutboundReconcileOutcome =
  | { readonly kind: "already-delivered"; readonly row: OutboundTransferRow }
  | { readonly kind: "resubmit"; readonly row: OutboundTransferRow };

/**
 * Resolves ONE outbound transfer found in `submitting` at startup — the exact same crash-recovery
 * scenario work/reconcile.ts's reconcileSubmitting handles for the inbound direction, mirrored here:
 * the process wrote `submitting` (with a real destination tx hash, per outbound-submit.ts's
 * crash-safe ordering) and then died before observing whether that transaction was actually
 * confirmed.
 *
 * The only question that matters, and the only one this function asks: is the message's nonce
 * already consumed on the destination EVM chain's MessageTransmitterV2?
 *   - YES -> the prior submission succeeded (or someone else, or a prior unreconciled run of this
 *     same relayer, already delivered it — receiveMessage is permissionless, per FAQ.md). We only
 *     missed marking it `delivered`. Do that now. Never re-broadcast — CCTP nonces are one-shot on
 *     the destination side (confirmed directly from Circle's own real MessageTransmitterV2 source:
 *     `require(usedNonces[_nonce] == 0, "Nonce already used")` — the same one-shot guarantee
 *     Stellar's own is_nonce_used enforces, on the mirror-image chain).
 *   - NO -> nothing was ever consumed. Whether the crash happened before, during, or after the
 *     broadcast attempt is irrelevant: it is safe to resubmit, because the nonce is still open. This
 *     function does not resubmit itself (that is submitOutboundUntilDelivered's job, called again
 *     from the same `attested`-derived inputs still on the row); it reports which case applies so
 *     the caller (work/outbound-loop.ts at startup) knows whether to skip straight to `delivered` or
 *     hand the row back into the normal submit path.
 */
export async function reconcileOutboundSubmitting(
  transfer: OutboundTransferRow,
  options: OutboundReconcileOptions,
): Promise<OutboundReconcileOutcome> {
  if (transfer.status !== "submitting") {
    throw new Error(
      `reconcileOutboundSubmitting called on a transfer in status "${transfer.status}", not "submitting"`,
    );
  }
  if (!transfer.irisNonce) {
    throw new Error(
      `outbound transfer ${transfer.id} is submitting but has no iris_nonce recorded`,
    );
  }

  const used = await nonceIsUsedOnEvm(
    options.rpc,
    options.messageTransmitterV2,
    transfer.irisNonce as `0x${string}`,
  );

  if (used) {
    const delivered = await options.repo.transition(transfer.id, transfer.version, "delivered");
    return { kind: "already-delivered", row: delivered };
  }
  return { kind: "resubmit", row: transfer };
}

/**
 * Runs reconcileOutboundSubmitting over every row currently in `submitting`. Called once at relayer
 * startup, before the normal outbound work loop begins processing `pending`/`attested` transfers —
 * mirrors runStartupReconciliation's own ordering guarantee for the inbound direction exactly.
 */
export async function reconcileAllOutboundSubmitting(
  options: OutboundReconcileOptions,
): Promise<readonly OutboundReconcileOutcome[]> {
  const stuck = await options.repo.listByStatus("submitting");
  const outcomes: OutboundReconcileOutcome[] = [];
  for (const transfer of stuck) {
    outcomes.push(await reconcileOutboundSubmitting(transfer, options));
  }
  return outcomes;
}
