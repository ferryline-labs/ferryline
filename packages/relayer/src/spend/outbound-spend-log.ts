import type { Pool } from "pg";

/**
 * The EVM mirror of spend-log.ts's own SpendLog, same append-only, two-table discipline exactly —
 * see that file's own doc comment for the full reasoning (not repeated verbatim here). This is
 * append-only from the relayer's side — no update or delete method exists here on purpose.
 *
 * `record` writes the reservation-INTENT log (outbound_spend_attempts): one row per attempt, before
 * that attempt's ceiling reservation is even tried. `recordEvent` writes the OUTCOME of that
 * reservation — 'reserved', 'released', or 'broadcast' — to outbound_spend_ledger_events, a separate
 * append-only table, each call made immediately before the corresponding action in the outbound work
 * loop (before spendCeiling.reserve()/release(), or right after the receiveMessage broadcast is
 * accepted). See db/schema.sql's comments on both tables for the full reasoning.
 */
export interface OutboundSpendLog {
  record(entry: OutboundSpendLogEntry): Promise<void>;
  recordEvent(event: OutboundSpendLedgerEvent): Promise<void>;
}

export interface OutboundSpendLogEntry {
  readonly transferId: string;
  readonly amountWei: bigint;
  readonly destination: string;
  readonly destinationChain: string;
  readonly sponsorAccount: string;
}

/** Why a reservation was released — a typed value, not free text, so this is queryable/aggregatable.
 *  Identical set to the inbound direction's own ReleaseReason (see spend-log.ts): the two ways a
 *  reservation can be given back are direction-agnostic — losing a concurrent race, or the broadcast
 *  itself being rejected before it ever reached the network. */
export type OutboundReleaseReason = "concurrent_race_lost" | "broadcast_rejected";

export type OutboundSpendLedgerEvent =
  | { readonly type: "reserved"; readonly transferId: string; readonly amountWei: bigint }
  | {
      readonly type: "released";
      readonly transferId: string;
      readonly amountWei: bigint;
      readonly reason: OutboundReleaseReason;
    }
  | { readonly type: "broadcast"; readonly transferId: string; readonly amountWei: bigint };

export class PostgresOutboundSpendLog implements OutboundSpendLog {
  constructor(private readonly pool: Pool) {}

  async record(entry: OutboundSpendLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO outbound_spend_attempts
         (transfer_id, amount_wei, destination, destination_chain, sponsor_account)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.transferId,
        entry.amountWei.toString(),
        entry.destination,
        entry.destinationChain,
        entry.sponsorAccount,
      ],
    );
  }

  async recordEvent(event: OutboundSpendLedgerEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO outbound_spend_ledger_events (transfer_id, event_type, release_reason, amount_wei)
       VALUES ($1, $2, $3, $4)`,
      [
        event.transferId,
        event.type,
        event.type === "released" ? event.reason : null,
        event.amountWei.toString(),
      ],
    );
  }
}

/** In-memory OutboundSpendLog for tests. Rows are retained (never mutated) exactly like the real
 *  tables. */
export class InMemoryOutboundSpendLog implements OutboundSpendLog {
  readonly entries: (OutboundSpendLogEntry & { attemptedAt: Date })[] = [];
  readonly events: (OutboundSpendLedgerEvent & { occurredAt: Date })[] = [];

  record(entry: OutboundSpendLogEntry): Promise<void> {
    this.entries.push({ ...entry, attemptedAt: new Date() });
    return Promise.resolve();
  }

  recordEvent(event: OutboundSpendLedgerEvent): Promise<void> {
    this.events.push({ ...event, occurredAt: new Date() });
    return Promise.resolve();
  }
}
