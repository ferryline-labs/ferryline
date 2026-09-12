import {
  ALLOWED_TRANSITIONS,
  DuplicateTransferError,
  IllegalTransitionError,
  VersionConflictError,
  type RegisterTransferInput,
  type TransferRepository,
  type TransferRow,
  type TransferStatus,
  type TransitionPatch,
} from "./types.js";

/**
 * In-memory TransferRepository, used in tests. Deliberately implements the SAME interface as
 * PostgresTransferRepository (see repo-contract.test.ts, run against both), so a test that passes
 * against this fake is evidence about the real thing's behavior too, not just about the fake.
 */
export class InMemoryTransferRepository implements TransferRepository {
  private readonly rows = new Map<string, TransferRow>();
  private sourceTxIndex = new Set<string>();

  register(input: RegisterTransferInput): Promise<TransferRow> {
    const key = `${input.sourceChain}:${input.sourceTxHash}`;
    if (this.sourceTxIndex.has(key)) {
      return Promise.reject(new DuplicateTransferError(input.sourceChain, input.sourceTxHash));
    }
    const now = new Date();
    const row: TransferRow = {
      id: input.id,
      rail: input.rail,
      status: "pending",
      sourceChain: input.sourceChain,
      sourceTxHash: input.sourceTxHash,
      sourceDomain: input.sourceDomain,
      destinationChain: "stellar",
      destinationTxHash: null,
      amount: null,
      recipient: null,
      mintRecipient: null,
      destinationCaller: null,
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
    this.sourceTxIndex.add(key);
    return Promise.resolve(row);
  }

  get(id: string): Promise<TransferRow | undefined> {
    return Promise.resolve(this.rows.get(id));
  }

  listByStatus(status: TransferStatus): Promise<readonly TransferRow[]> {
    const matches = [...this.rows.values()]
      .filter((r) => r.status === status)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return Promise.resolve(matches);
  }

  transition(
    id: string,
    expectedVersion: number,
    to: TransferStatus,
    patch: TransitionPatch = {},
  ): Promise<TransferRow> {
    const current = this.rows.get(id);
    if (!current) {
      return Promise.reject(new Error(`transfer ${id} does not exist`));
    }
    if (!ALLOWED_TRANSITIONS[current.status].includes(to)) {
      return Promise.reject(new IllegalTransitionError(id, current.status, to));
    }
    if (current.version !== expectedVersion) {
      return Promise.reject(new VersionConflictError(id));
    }
    const updated: TransferRow = {
      ...current,
      status: to,
      destinationTxHash: patch.destinationTxHash ?? current.destinationTxHash,
      amount: patch.amount ?? current.amount,
      recipient: patch.recipient ?? current.recipient,
      mintRecipient: patch.mintRecipient ?? current.mintRecipient,
      destinationCaller: patch.destinationCaller ?? current.destinationCaller,
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

  countByRecipientSince(recipient: string, since: Date): Promise<number> {
    const count = [...this.rows.values()].filter(
      (r) => r.recipient === recipient && r.createdAt.getTime() >= since.getTime(),
    ).length;
    return Promise.resolve(count);
  }
}
