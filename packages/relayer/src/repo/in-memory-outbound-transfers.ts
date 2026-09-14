import { ALLOWED_TRANSITIONS } from "./types.js";
import type { TransferStatus } from "./types.js";
import {
  DuplicateOutboundTransferError,
  OutboundIllegalTransitionError,
  OutboundVersionConflictError,
  type OutboundTransferRepository,
  type OutboundTransferRow,
  type OutboundTransitionPatch,
  type RegisterOutboundTransferInput,
} from "./outbound-types.js";

/**
 * In-memory OutboundTransferRepository, used in tests. Mirrors InMemoryTransferRepository's own
 * "implements the same interface as the Postgres version, run against both via a shared contract
 * test" discipline — see repo-outbound-contract.test.ts.
 */
export class InMemoryOutboundTransferRepository implements OutboundTransferRepository {
  private readonly rows = new Map<string, OutboundTransferRow>();
  private readonly sourceTxIndex = new Set<string>();

  register(input: RegisterOutboundTransferInput): Promise<OutboundTransferRow> {
    if (this.sourceTxIndex.has(input.sourceTxHash)) {
      return Promise.reject(new DuplicateOutboundTransferError(input.sourceTxHash));
    }
    const now = new Date();
    const row: OutboundTransferRow = {
      id: input.id,
      rail: input.rail,
      status: "pending",
      sourceChain: "stellar",
      sourceTxHash: input.sourceTxHash,
      sourceDomain: input.sourceDomain,
      destinationChain: input.destinationChain,
      destinationTxHash: null,
      amount: null,
      recipient: null,
      irisNonce: null,
      irisMessage: null,
      irisAttestation: null,
      errorCode: null,
      errorDetail: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    this.sourceTxIndex.add(input.sourceTxHash);
    return Promise.resolve(row);
  }

  get(id: string): Promise<OutboundTransferRow | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  listByStatus(status: TransferStatus): Promise<readonly OutboundTransferRow[]> {
    const matches = [...this.rows.values()]
      .filter((r) => r.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.resolve(matches);
  }

  transition(
    id: string,
    expectedVersion: number,
    to: TransferStatus,
    patch: OutboundTransitionPatch = {},
  ): Promise<OutboundTransferRow> {
    const current = this.rows.get(id);
    if (!current) {
      return Promise.reject(new Error(`outbound transfer ${id} does not exist`));
    }
    if (!ALLOWED_TRANSITIONS[current.status].includes(to)) {
      return Promise.reject(new OutboundIllegalTransitionError(id, current.status, to));
    }
    if (current.version !== expectedVersion) {
      return Promise.reject(new OutboundVersionConflictError(id));
    }
    const updated: OutboundTransferRow = {
      ...current,
      status: to,
      destinationTxHash: patch.destinationTxHash ?? current.destinationTxHash,
      amount: patch.amount ?? current.amount,
      recipient: patch.recipient ?? current.recipient,
      irisNonce: patch.irisNonce ?? current.irisNonce,
      irisMessage: patch.irisMessage ?? current.irisMessage,
      irisAttestation: patch.irisAttestation ?? current.irisAttestation,
      errorCode: patch.errorCode ?? current.errorCode,
      errorDetail: patch.errorDetail ?? current.errorDetail,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  countByRecipientSince(recipient: `0x${string}`, since: Date): Promise<number> {
    const count = [...this.rows.values()].filter(
      (r) => r.recipient === recipient && r.createdAt.getTime() >= since.getTime(),
    ).length;
    return Promise.resolve(count);
  }
}
