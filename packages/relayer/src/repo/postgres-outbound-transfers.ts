import type { Pool } from "pg";

import type { OutboundTerminalErrorCode } from "../work/outbound-errors.js";
import type { TransferStatus } from "./types.js";
import { ALLOWED_TRANSITIONS } from "./types.js";
import {
  DuplicateOutboundTransferError,
  OutboundIllegalTransitionError,
  OutboundVersionConflictError,
  type OutboundTransferRepository,
  type OutboundTransferRow,
  type OutboundTransitionPatch,
  type RegisterOutboundTransferInput,
} from "./outbound-types.js";

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
  iris_nonce: string | null;
  iris_message: string | null;
  iris_attestation: string | null;
  error_code: string | null;
  error_detail: string | null;
  // node-postgres returns BIGINT as a string, not a number — see postgres-transfers.ts's identical
  // comment for why parsing it here is safe.
  version: string;
  created_at: Date;
  updated_at: Date;
}

function toRow(r: Row): OutboundTransferRow {
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
    recipient: r.recipient as `0x${string}` | null,
    irisNonce: r.iris_nonce,
    irisMessage: r.iris_message,
    irisAttestation: r.iris_attestation,
    errorCode: r.error_code as OutboundTerminalErrorCode | null,
    errorDetail: r.error_detail,
    version: Number(r.version),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const UNIQUE_VIOLATION = "23505";

/** Postgres-backed OutboundTransferRepository. Mirrors PostgresTransferRepository's own structure and
 *  discipline exactly (single-statement or short-transaction writes, optimistic-concurrency
 *  transitions) — see that class's own doc comment for the reasoning, not repeated here. */
export class PostgresOutboundTransferRepository implements OutboundTransferRepository {
  constructor(private readonly pool: Pool) {}

  async register(input: RegisterOutboundTransferInput): Promise<OutboundTransferRow> {
    try {
      // amount and recipient are deliberately absent here: NULL until the real Iris message is
      // parsed at the attested transition (see work/outbound-attest.ts and db/schema.sql).
      const result = await this.pool.query<Row>(
        `INSERT INTO outbound_transfers (id, rail, status, source_tx_hash, source_domain, destination_chain)
         VALUES ($1, $2, 'pending', $3, $4, $5)
         RETURNING *`,
        [input.id, input.rail, input.sourceTxHash, input.sourceDomain, input.destinationChain],
      );
      return toRow(result.rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateOutboundTransferError(input.sourceTxHash);
      }
      throw error;
    }
  }

  async get(id: string): Promise<OutboundTransferRow | undefined> {
    const result = await this.pool.query<Row>(`SELECT * FROM outbound_transfers WHERE id = $1`, [
      id,
    ]);
    return result.rows[0] ? toRow(result.rows[0]) : undefined;
  }

  async listByStatus(status: TransferStatus): Promise<readonly OutboundTransferRow[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM outbound_transfers WHERE status = $1 ORDER BY created_at ASC`,
      [status],
    );
    return result.rows.map(toRow);
  }

  async transition(
    id: string,
    expectedVersion: number,
    to: TransferStatus,
    patch: OutboundTransitionPatch = {},
  ): Promise<OutboundTransferRow> {
    const current = await this.get(id);
    if (!current) {
      throw new Error(`outbound transfer ${id} does not exist`);
    }
    if (!ALLOWED_TRANSITIONS[current.status].includes(to)) {
      throw new OutboundIllegalTransitionError(id, current.status, to);
    }

    const setClauses = ["status = $3", "version = version + 1", "updated_at = now()"];
    const values: unknown[] = [id, expectedVersion, to];
    let i = 4;
    const columnFor: Record<keyof OutboundTransitionPatch, string> = {
      destinationTxHash: "destination_tx_hash",
      amount: "amount",
      recipient: "recipient",
      irisNonce: "iris_nonce",
      irisMessage: "iris_message",
      irisAttestation: "iris_attestation",
      errorCode: "error_code",
      errorDetail: "error_detail",
    };
    for (const [key, column] of Object.entries(columnFor) as [
      keyof OutboundTransitionPatch,
      string,
    ][]) {
      const value = patch[key];
      if (value !== undefined) {
        setClauses.push(`${column} = $${String(i)}`);
        values.push(value);
        i += 1;
      }
    }

    const result = await this.pool.query<Row>(
      `UPDATE outbound_transfers SET ${setClauses.join(", ")}
       WHERE id = $1 AND version = $2
       RETURNING *`,
      values,
    );
    if (result.rows.length === 0) {
      throw new OutboundVersionConflictError(id);
    }
    return toRow(result.rows[0]!);
  }

  async countByRecipientSince(recipient: `0x${string}`, since: Date): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM outbound_transfers WHERE recipient = $1 AND created_at >= $2`,
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
