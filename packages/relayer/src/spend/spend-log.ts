import type { Pool } from "pg";

/**
 * Every spend attempt, written BEFORE submission, to a table separate from `transfers`. Per the
 * sign-off, this must survive independently of the relayer's own "did I already do this" logic: a
 * corrupted or incorrectly-reconciled transfer row must not erase evidence of what the relayer
 * actually tried to spend. This is append-only from the relayer's side — no update or delete method
 * exists here on purpose.
 */
export interface SpendLog {
  record(entry: SpendLogEntry): Promise<void>;
}

export interface SpendLogEntry {
  readonly transferId: string;
  readonly amountStroops: bigint;
  readonly destination: string;
  readonly sponsorAccount: string;
}

export class PostgresSpendLog implements SpendLog {
  constructor(private readonly pool: Pool) {}

  async record(entry: SpendLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO spend_attempts (transfer_id, amount_stroops, destination, sponsor_account)
       VALUES ($1, $2, $3, $4)`,
      [entry.transferId, entry.amountStroops.toString(), entry.destination, entry.sponsorAccount],
    );
  }
}

/** In-memory SpendLog for tests. Rows are retained (never mutated) exactly like the real table. */
export class InMemorySpendLog implements SpendLog {
  readonly entries: (SpendLogEntry & { attemptedAt: Date })[] = [];

  record(entry: SpendLogEntry): Promise<void> {
    this.entries.push({ ...entry, attemptedAt: new Date() });
    return Promise.resolve();
  }
}
