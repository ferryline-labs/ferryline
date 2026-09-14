import type { OutboundTerminalErrorCode } from "../work/outbound-errors.js";
import type { TransferStatus } from "./types.js";

export { ALLOWED_TRANSITIONS } from "./types.js";
export type { TransferStatus } from "./types.js";

export interface OutboundTransferRow {
  readonly id: string;
  readonly rail: string;
  readonly status: TransferStatus;
  /** Always "stellar" for v1 — a real column, not a hardcoded constant, so a future multi-source
   *  version (unlikely, but consistent with outbound_daily_spend's own forward-looking key shape)
   *  does not need a schema change. */
  readonly sourceChain: string;
  /** The real Stellar deposit_for_burn transaction hash. */
  readonly sourceTxHash: string;
  /** Stellar's own CCTP domain id (27, per @ferryline/sdk's CCTP_STELLAR.{mainnet,testnet}.domain —
   *  identical on both networks). */
  readonly sourceDomain: number;
  /** The destination EVM chain's slug (e.g. "ethereum-sepolia") — v1 always has exactly one real
   *  value here, per OUTBOUND_SCOPE.md's single-destination-chain scope, but this is a real column
   *  (not a constant) so a future multi-chain version needs no schema change. */
  readonly destinationChain: string;
  /** The real receiveMessage transaction hash, once submitted. NULL until status = 'submitting'. */
  readonly destinationTxHash: string | null;
  /**
   * NULL until `attested`. 6-decimal USDC units, as a string (NUMERIC in Postgres; avoids float
   * precision loss). Extracted from the real Iris message body once attested, never accepted from
   * the registration caller — see work/outbound-attest.ts and db/schema.sql.
   */
  readonly amount: string | null;
  /**
   * NULL until `attested`. The destination EVM address (mintRecipient), extracted directly from the
   * real Iris message body — see work/outbound-attest.ts's own doc comment for why outbound has NO
   * forwarder-hook-data indirection the way inbound does (mintRecipient IS the real destination for
   * an EVM-destination burn, not a routing contract's address).
   */
  readonly recipient: `0x${string}` | null;
  readonly irisNonce: string | null;
  readonly irisMessage: string | null;
  readonly irisAttestation: string | null;
  readonly errorCode: OutboundTerminalErrorCode | null;
  readonly errorDetail: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What POST /outbound-transfers actually accepts: which source Stellar transaction to watch, and
 *  which destination chain it targets — nothing else (mirrors RegisterTransferInput's own "only the
 *  pointer, never a claimed amount/recipient" discipline). */
export interface RegisterOutboundTransferInput {
  readonly id: string;
  readonly rail: string;
  readonly sourceTxHash: string;
  readonly sourceDomain: number;
  readonly destinationChain: string;
}

/** Thrown by `transition` when the row's version does not match `expectedVersion` (lost the race). */
export class OutboundVersionConflictError extends Error {
  constructor(readonly transferId: string) {
    super(`outbound transfer ${transferId} was modified concurrently; re-read before retrying`);
    this.name = "OutboundVersionConflictError";
  }
}

/** Thrown by `transition` when the requested status change is not in ALLOWED_TRANSITIONS. */
export class OutboundIllegalTransitionError extends Error {
  constructor(
    readonly transferId: string,
    readonly from: TransferStatus,
    readonly to: TransferStatus,
  ) {
    super(`outbound transfer ${transferId}: ${from} -> ${to} is not an allowed transition`);
    this.name = "OutboundIllegalTransitionError";
  }
}

/** Thrown by `register` when a transfer with the same sourceTxHash already exists. */
export class DuplicateOutboundTransferError extends Error {
  constructor(readonly sourceTxHash: string) {
    super(`an outbound transfer for source tx ${sourceTxHash} is already registered`);
    this.name = "DuplicateOutboundTransferError";
  }
}

export interface OutboundTransitionPatch {
  readonly destinationTxHash?: string;
  readonly amount?: string;
  readonly recipient?: `0x${string}`;
  readonly irisNonce?: string;
  readonly irisMessage?: string;
  readonly irisAttestation?: string;
  readonly errorCode?: OutboundTerminalErrorCode;
  readonly errorDetail?: string;
}

export interface OutboundTransferRepository {
  /** Insert a new outbound transfer at status 'pending'. Throws DuplicateOutboundTransferError on a
   *  repeat sourceTxHash. */
  register(input: RegisterOutboundTransferInput): Promise<OutboundTransferRow>;

  get(id: string): Promise<OutboundTransferRow | undefined>;

  /** Every row currently in `status`, oldest first — same "no in-memory queue" reasoning as the
   *  inbound repository's own listByStatus. */
  listByStatus(status: TransferStatus): Promise<readonly OutboundTransferRow[]>;

  /** Move a transfer from its current status to `to`, applying `patch`, gated on `expectedVersion` —
   *  identical semantics to TransferRepository.transition (see that interface's own doc comment). */
  transition(
    id: string,
    expectedVersion: number,
    to: TransferStatus,
    patch?: OutboundTransitionPatch,
  ): Promise<OutboundTransferRow>;

  /** How many outbound transfers a recipient (destination EVM address) has registered within
   *  [since, now]. Used by the per-recipient rate limiter — same role as the inbound repository's
   *  countByRecipientSince. */
  countByRecipientSince(recipient: `0x${string}`, since: Date): Promise<number>;
}
