import type { Pool } from "pg";

/**
 * Every spend attempt, written BEFORE submission, to a table separate from `transfers`. Per the
 * sign-off, this must survive independently of the relayer's own "did I already do this" logic: a
 * corrupted or incorrectly-reconciled transfer row must not erase evidence of what the relayer
 * actually tried to spend. This is append-only from the relayer's side — no update or delete method
 * exists here on purpose.
 *
 * `record` writes the reservation-INTENT log (spend_attempts): one row per attempt, before that
 * attempt's ceiling reservation is even tried. `recordEvent` (STEP 5's completeness fix) writes the
 * OUTCOME of that reservation — 'reserved', 'released', or 'broadcast' — to spend_ledger_events, a
 * separate append-only table, each call made immediately before the corresponding action in
 * submit.ts (before spendCeiling.reserve()/release(), or right after sendTransaction accepts). See
 * db/schema.sql's comments on both tables for the full reasoning and how to reconstruct net spend
 * from them together — spend_attempts alone is NOT sufficient for that; see its own updated comment.
 */
export interface SpendLog {
  record(entry: SpendLogEntry): Promise<void>;
  recordEvent(event: SpendLedgerEvent): Promise<void>;
}

export interface SpendLogEntry {
  readonly transferId: string;
  readonly amountStroops: bigint;
  readonly destination: string;
  readonly sponsorAccount: string;
}

/** Why a reservation was released — a typed value, not free text, so this is queryable/aggregatable. */
export type ReleaseReason = "concurrent_race_lost" | "broadcast_rejected";

export type SpendLedgerEvent =
  | { readonly type: "reserved"; readonly transferId: string; readonly amountStroops: bigint }
  | {
      readonly type: "released";
      readonly transferId: string;
      readonly amountStroops: bigint;
      readonly reason: ReleaseReason;
    }
  | { readonly type: "broadcast"; readonly transferId: string; readonly amountStroops: bigint };

export class PostgresSpendLog implements SpendLog {
  constructor(private readonly pool: Pool) {}

  async record(entry: SpendLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO spend_attempts (transfer_id, amount_stroops, destination, sponsor_account)
       VALUES ($1, $2, $3, $4)`,
      [entry.transferId, entry.amountStroops.toString(), entry.destination, entry.sponsorAccount],
    );
  }

  async recordEvent(event: SpendLedgerEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO spend_ledger_events (transfer_id, event_type, release_reason, amount_stroops)
       VALUES ($1, $2, $3, $4)`,
      [
        event.transferId,
        event.type,
        event.type === "released" ? event.reason : null,
        event.amountStroops.toString(),
      ],
    );
  }
}

/** In-memory SpendLog for tests. Rows are retained (never mutated) exactly like the real tables. */
export class InMemorySpendLog implements SpendLog {
  readonly entries: (SpendLogEntry & { attemptedAt: Date })[] = [];
  readonly events: (SpendLedgerEvent & { occurredAt: Date })[] = [];

  record(entry: SpendLogEntry): Promise<void> {
    this.entries.push({ ...entry, attemptedAt: new Date() });
    return Promise.resolve();
  }

  recordEvent(event: SpendLedgerEvent): Promise<void> {
    this.events.push({ ...event, occurredAt: new Date() });
    return Promise.resolve();
  }
}
