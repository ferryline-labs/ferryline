import type { Pool } from "pg";

/**
 * The global daily spend ceiling. Tracks ACTUAL, confirmed spend (never an estimate) in Postgres, so
 * it is correct across restarts and multiple relayer processes. Per the sign-off: when the ceiling is
 * hit, the relayer must actually stop starting new mints — this module is what the work loop consults
 * before every fee-bump submission, and its `reserve` call is the only place daily_spend is written.
 */
export interface SpendCeiling {
  /** Today's UTC total confirmed spend, in stroops. */
  spentToday(): Promise<bigint>;
  /** True once spentToday() + config's dailySpendCeilingStroops would be exceeded by `amountStroops`. */
  wouldExceed(amountStroops: bigint): Promise<boolean>;
  /**
   * Atomically records a CONFIRMED spend of `amountStroops` against today's total. Call this only
   * after the fee-bump transaction has actually been broadcast and accepted — never speculatively,
   * and never for a submission that was rejected before broadcast.
   */
  recordSpend(amountStroops: bigint): Promise<void>;
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

  async recordSpend(amountStroops: bigint): Promise<void> {
    // UPSERT: the day's row may not exist yet. This single statement is the only writer of
    // daily_spend, so there is no read-then-write race between two relayer instances.
    await this.pool.query(
      `INSERT INTO daily_spend (spend_date, spent_stroops)
       VALUES ($1, $2)
       ON CONFLICT (spend_date) DO UPDATE SET spent_stroops = daily_spend.spent_stroops + EXCLUDED.spent_stroops`,
      [utcDateKey(this.now), amountStroops.toString()],
    );
  }
}

/** In-memory SpendCeiling for tests that do not need Postgres. */
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

  recordSpend(amountStroops: bigint): Promise<void> {
    const key = utcDateKey(this.now);
    this.byDate.set(key, (this.byDate.get(key) ?? 0n) + amountStroops);
    return Promise.resolve();
  }
}
