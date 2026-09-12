import type { Pool } from "pg";

import type { TerminalErrorCode } from "../work/errors.js";
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

interface Row {
  id: string;
  rail: string;
  status: TransferStatus;
  source_chain: string;
  source_tx_hash: string;
  source_domain: number;
  destination_chain: string;
  destination_tx_hash: string | null;
  amount: string | null;
  recipient: string | null;
  mint_recipient: string | null;
  destination_caller: string | null;
  iris_nonce: string | null;
  iris_message: string | null;
  iris_attestation: string | null;
  error_code: string | null;
  error_detail: string | null;
  // node-postgres returns BIGINT as a string, not a number, to avoid silently losing precision
  // above Number.MAX_SAFE_INTEGER. `version` will never get remotely close to that, so parsing it
  // here is safe and keeps every other TransferRepository implementation's `version: number`.
  version: string;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: Row): TransferRow {
  return {
    id: r.id,
    rail: r.rail,
    status: r.status,
    sourceChain: r.source_chain,
    sourceTxHash: r.source_tx_hash,
    sourceDomain: r.source_domain,
    destinationChain: r.destination_chain,
    destinationTxHash: r.destination_tx_hash,
    amount: r.amount,
    recipient: r.recipient,
    mintRecipient: r.mint_recipient,
    destinationCaller: r.destination_caller,
    irisNonce: r.iris_nonce,
    irisMessage: r.iris_message,
    irisAttestation: r.iris_attestation,
    errorCode: r.error_code as TerminalErrorCode | null,
    errorDetail: r.error_detail,
    version: Number(r.version),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const UNIQUE_VIOLATION = "23505";

/** Postgres-backed TransferRepository. Every write is a single statement or a short transaction. */
export class PostgresTransferRepository implements TransferRepository {
  constructor(private readonly pool: Pool) {}

  async register(input: RegisterTransferInput): Promise<TransferRow> {
    try {
      // amount and recipient are deliberately absent here: they are NULL until the real Iris
      // message is parsed at the attested transition (see work/attest.ts and db/schema.sql).
      const result = await this.pool.query<Row>(
        `INSERT INTO transfers (id, rail, status, source_chain, source_tx_hash, source_domain)
         VALUES ($1, $2, 'pending', $3, $4, $5)
         RETURNING *`,
        [input.id, input.rail, input.sourceChain, input.sourceTxHash, input.sourceDomain],
      );
      return toRow(result.rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateTransferError(input.sourceChain, input.sourceTxHash);
      }
      throw error;
    }
  }

  async get(id: string): Promise<TransferRow | undefined> {
    const result = await this.pool.query<Row>(`SELECT * FROM transfers WHERE id = $1`, [id]);
    return result.rows[0] ? toRow(result.rows[0]) : undefined;
  }

  async listByStatus(status: TransferStatus): Promise<readonly TransferRow[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM transfers WHERE status = $1 ORDER BY created_at ASC`,
      [status],
    );
    return result.rows.map(toRow);
  }

  async transition(
    id: string,
    expectedVersion: number,
    to: TransferStatus,
    patch: TransitionPatch = {},
  ): Promise<TransferRow> {
    const current = await this.get(id);
    if (!current) {
      throw new Error(`transfer ${id} does not exist`);
    }
    if (!ALLOWED_TRANSITIONS[current.status].includes(to)) {
      throw new IllegalTransitionError(id, current.status, to);
    }

    const setClauses = ["status = $3", "version = version + 1", "updated_at = now()"];
    const values: unknown[] = [id, expectedVersion, to];
    let i = 4;
    const columnFor: Record<keyof TransitionPatch, string> = {
      destinationTxHash: "destination_tx_hash",
      amount: "amount",
      recipient: "recipient",
      mintRecipient: "mint_recipient",
      destinationCaller: "destination_caller",
      irisNonce: "iris_nonce",
      irisMessage: "iris_message",
      irisAttestation: "iris_attestation",
      errorCode: "error_code",
      errorDetail: "error_detail",
    };
    for (const [key, column] of Object.entries(columnFor) as [keyof TransitionPatch, string][]) {
      const value = patch[key];
      if (value !== undefined) {
        setClauses.push(`${column} = $${String(i)}`);
        values.push(value);
        i += 1;
      }
    }

    const result = await this.pool.query<Row>(
      `UPDATE transfers SET ${setClauses.join(", ")}
       WHERE id = $1 AND version = $2
       RETURNING *`,
      values,
    );
    if (result.rows.length === 0) {
      throw new VersionConflictError(id);
    }
    return toRow(result.rows[0]!);
  }

  async countByRecipientSince(recipient: string, since: Date): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM transfers WHERE recipient = $1 AND created_at >= $2`,
      [recipient, since],
    );
    return Number(result.rows[0]?.count ?? "0");
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
