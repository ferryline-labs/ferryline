import { FerrylineError } from "./errors.js";
import type { RailId, TransferRequest } from "./rail.js";
import type { TransferId } from "./transfer-id.js";

/**
 * What the SDK and relayer remember about a transfer. `railRef` is opaque to
 * everything except the adapter that wrote it; that is where rail-native ids live.
 */
export interface TransferRecord<TRailRef = unknown> {
  readonly transferId: TransferId;
  readonly rail: RailId;
  readonly request: TransferRequest;
  /** Unix ms. */
  readonly createdAt: number;
  readonly sourceTxHash?: string;
  readonly railRef: TRailRef;
}

export interface TransferStore {
  get(transferId: TransferId): Promise<TransferRecord | undefined>;
  put(record: TransferRecord): Promise<void>;
  /** Record the hash the wallet reported after submitting the first step. */
  markSubmitted(transferId: TransferId, sourceTxHash: string): Promise<void>;
}

/** Default store for tests and single-process use. Not durable. */
export class InMemoryTransferStore implements TransferStore {
  private readonly records = new Map<TransferId, TransferRecord>();

  get(transferId: TransferId): Promise<TransferRecord | undefined> {
    return Promise.resolve(this.records.get(transferId));
  }

  put(record: TransferRecord): Promise<void> {
    this.records.set(record.transferId, record);
    return Promise.resolve();
  }

  markSubmitted(transferId: TransferId, sourceTxHash: string): Promise<void> {
    const existing = this.records.get(transferId);
    if (!existing) {
      return Promise.reject(
        new FerrylineError("TRANSFER_UNKNOWN", `no transfer with id ${transferId}`),
      );
    }
    this.records.set(transferId, { ...existing, sourceTxHash });
    return Promise.resolve();
  }
}
