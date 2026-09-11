import type { TerminalErrorCode } from "../work/errors.js";

export type TransferStatus = "pending" | "attested" | "submitting" | "delivered" | "failed";

/** The state machine's only legal edges. Enforced by TransferRepository.transition, not by callers. */
export const ALLOWED_TRANSITIONS: Readonly<Record<TransferStatus, readonly TransferStatus[]>> = {
  pending: ["attested", "failed"],
  attested: ["submitting", "failed"],
  submitting: ["delivered", "failed"],
  delivered: [],
  failed: [],
};

export interface TransferRow {
  readonly id: string;
  readonly rail: string;
  readonly status: TransferStatus;
  readonly sourceChain: string;
  readonly sourceTxHash: string;
  readonly sourceDomain: number;
  readonly destinationChain: string;
  readonly destinationTxHash: string | null;
  /** 6-decimal USDC units, as a string (NUMERIC in Postgres; avoids float precision loss). */
  readonly amount: string;
  readonly recipient: string;
  readonly mintRecipient: string | null;
  readonly destinationCaller: string | null;
  readonly irisNonce: string | null;
  readonly irisMessage: string | null;
  readonly irisAttestation: string | null;
  readonly errorCode: TerminalErrorCode | null;
  readonly errorDetail: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RegisterTransferInput {
  readonly id: string;
  readonly rail: string;
  readonly sourceChain: string;
  readonly sourceTxHash: string;
  readonly sourceDomain: number;
  readonly amount: string;
  readonly recipient: string;
}

/** Thrown by `transition` when the row's version does not match `expectedVersion` (lost the race). */
export class VersionConflictError extends Error {
  constructor(readonly transferId: string) {
    super(`transfer ${transferId} was modified concurrently; re-read before retrying`);
    this.name = "VersionConflictError";
  }
}

/** Thrown by `transition` when the requested status change is not in ALLOWED_TRANSITIONS. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly transferId: string,
    readonly from: TransferStatus,
    readonly to: TransferStatus,
  ) {
    super(`transfer ${transferId}: ${from} -> ${to} is not an allowed transition`);
    this.name = "IllegalTransitionError";
  }
}

/** Thrown by `register` when a transfer with the same (sourceChain, sourceTxHash) already exists. */
export class DuplicateTransferError extends Error {
  constructor(
    readonly sourceChain: string,
    readonly sourceTxHash: string,
  ) {
    super(`a transfer for ${sourceChain}:${sourceTxHash} is already registered`);
    this.name = "DuplicateTransferError";
  }
}

export interface TransitionPatch {
  readonly destinationTxHash?: string;
  readonly mintRecipient?: string;
  readonly destinationCaller?: string;
  readonly irisNonce?: string;
  readonly irisMessage?: string;
  readonly irisAttestation?: string;
  readonly errorCode?: TerminalErrorCode;
  readonly errorDetail?: string;
}

export interface TransferRepository {
  /** Insert a new transfer at status 'pending'. Throws DuplicateTransferError on a repeat sourceTxHash. */
  register(input: RegisterTransferInput): Promise<TransferRow>;

  get(id: string): Promise<TransferRow | undefined>;

  /**
   * Every row currently in `status`, oldest first. The work loop's entry point for each poll pass —
   * it never keeps its own in-memory queue, so a restart loses no work: everything not yet
   * `delivered` or `failed` is still findable here.
   */
  listByStatus(status: TransferStatus): Promise<readonly TransferRow[]>;

  /**
   * Move a transfer from its current status to `to`, applying `patch`, gated on `expectedVersion`.
   * Throws IllegalTransitionError if `to` is not reachable from the row's actual current status,
   * VersionConflictError if `expectedVersion` is stale. Both are distinct failure modes callers
   * handle differently: illegal-transition means a logic bug or a race that changed the *meaning*
   * of the row; version-conflict means "re-read and decide again", which is exactly what
   * crash-recovery reconciliation does on restart.
   */
  transition(
    id: string,
    expectedVersion: number,
    to: TransferStatus,
    patch?: TransitionPatch,
  ): Promise<TransferRow>;

  /** How many transfers a recipient has registered within [since, now]. Used by the rate limiter. */
  countByRecipientSince(recipient: string, since: Date): Promise<number>;
}
