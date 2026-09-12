import type { Pool } from "pg";

/**
 * The global daily spend ceiling. Tracks ACTUAL, confirmed spend (never an estimate) in Postgres, so
 * it is correct across restarts and multiple relayer processes.
 *
 * `reserve` is the operation the work loop must use before broadcasting: a single atomic
 * check-and-increment, so two transfers racing the same ceiling can never both pass a check against
 * room that only fits one (see db/schema.sql's daily_spend comment for the exact statement and why
 * it is race-free under real concurrency, not just sequential correctness). `spentToday` and
 * `wouldExceed` are read-only and exist for reporting (GET /healthz) — never use them to decide
 * whether to spend; there is an unavoidable gap between reading and any later write.
 */
export interface SpendCeiling {
  /** Today's UTC total confirmed spend, in stroops. Read-only; do not gate a broadcast on this. */
  spentToday(): Promise<bigint>;
  /** True once spentToday() + amountStroops would exceed the ceiling. Read-only, same caveat as above. */
  wouldExceed(amountStroops: bigint): Promise<boolean>;
  /**
   * Atomically reserves `amountStroops` against today's ceiling: increments and checks in one
   * statement. Returns `{ reserved: true, spentAfter }` if the reservation fit (the increment is
   * already committed), or `{ reserved: false, spentAfter }` if it would have exceeded the ceiling
   * (nothing was written; `spentAfter` is today's total as it stood at the attempt).
   *
   * Call this BEFORE broadcasting, with the REAL fee-bump quote, not an estimate. If the reservation
   * succeeds but the broadcast is then rejected before reaching the network, call `release` with the
   * same amount to give the budget back.
   */
  reserve(amountStroops: bigint): Promise<{ reserved: boolean; spentAfter: bigint }>;
  /** Compensating decrement for a reservation whose broadcast never reached the network. */
  release(amountStroops: bigint): Promise<void>;
}

function utcDateKey(now: () => Date = () => new Date()): string {
  return now().toISOString().slice(0, 10);
}

export class PostgresSpendCeiling implements SpendCeiling {
  constructor(
    private readonly pool: Pool,
    private readonly ceilingStroops: bigint,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async spentToday(): Promise<bigint> {
    const result = await this.pool.query<{ spent_stroops: string }>(
      `SELECT spent_stroops::text FROM daily_spend WHERE spend_date = $1`,
      [utcDateKey(this.now)],
    );
    return BigInt(result.rows[0]?.spent_stroops ?? "0");
  }

  async wouldExceed(amountStroops: bigint): Promise<boolean> {
    const spent = await this.spentToday();
    return spent + amountStroops > this.ceilingStroops;
  }

  async reserve(amountStroops: bigint): Promise<{ reserved: boolean; spentAfter: bigint }> {
    const date = utcDateKey(this.now);
    // Single statement: check-and-increment atomically. See db/schema.sql for why this is race-free
    // under real concurrency (row-level lock held for the statement's duration, not application-level
    // locking or a timing assumption).
    const result = await this.pool.query<{ spent_stroops: string }>(
      `INSERT INTO daily_spend (spend_date, spent_stroops)
       VALUES ($1, $2)
       ON CONFLICT (spend_date) DO UPDATE
         SET spent_stroops = daily_spend.spent_stroops + EXCLUDED.spent_stroops
         WHERE daily_spend.spent_stroops + EXCLUDED.spent_stroops <= $3
       RETURNING spent_stroops`,
      [date, amountStroops.toString(), this.ceilingStroops.toString()],
    );
    if (result.rows.length > 0) {
      return { reserved: true, spentAfter: BigInt(result.rows[0]!.spent_stroops) };
    }
    // The WHERE clause excluded the row from RETURNING: nothing was written. Read the current total
    // back (a second statement is fine here — no write happened, so there is nothing to race).
    const spent = await this.spentToday();
    return { reserved: false, spentAfter: spent };
  }

  async release(amountStroops: bigint): Promise<void> {
    // Bounded at zero: a release must never make the ledger go negative, which would otherwise
    // manufacture extra budget out of a bug (e.g. a double release).
    await this.pool.query(
      `UPDATE daily_spend
       SET spent_stroops = GREATEST(spent_stroops - $2, 0)
       WHERE spend_date = $1`,
      [utcDateKey(this.now), amountStroops.toString()],
    );
  }
}

/**
 * In-memory SpendCeiling for tests that do not need Postgres. `reserve` is atomic with respect to
 * this process's own event loop (a single synchronous check-then-mutate, no `await` in between), so
 * it is safe for concurrent async callers WITHIN one Node process — it does not, and cannot, model
 * cross-process concurrency. The claim that the real ceiling is safe across multiple relayer
 * processes rests on PostgresSpendCeiling and its integration test, not on this fake.
 */
export class InMemorySpendCeiling implements SpendCeiling {
  private readonly byDate = new Map<string, bigint>();

  constructor(
    private readonly ceilingStroops: bigint,
    private readonly now: () => Date = () => new Date(),
  ) {}

  spentToday(): Promise<bigint> {
    return Promise.resolve(this.byDate.get(utcDateKey(this.now)) ?? 0n);
  }

  async wouldExceed(amountStroops: bigint): Promise<boolean> {
    const spent = await this.spentToday();
    return spent + amountStroops > this.ceilingStroops;
  }

  reserve(amountStroops: bigint): Promise<{ reserved: boolean; spentAfter: bigint }> {
    const key = utcDateKey(this.now);
    const current = this.byDate.get(key) ?? 0n;
    const next = current + amountStroops;
    if (next > this.ceilingStroops) {
      return Promise.resolve({ reserved: false, spentAfter: current });
    }
    this.byDate.set(key, next);
    return Promise.resolve({ reserved: true, spentAfter: next });
  }

  release(amountStroops: bigint): Promise<void> {
    const key = utcDateKey(this.now);
    const current = this.byDate.get(key) ?? 0n;
    const next = current - amountStroops;
    this.byDate.set(key, next < 0n ? 0n : next);
    return Promise.resolve();
  }
}
