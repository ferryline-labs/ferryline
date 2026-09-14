import type { Pool } from "pg";

/**
 * The global daily gas-spend ceiling for the outbound direction — the EVM mirror of spend/ceiling.ts's
 * own SpendCeiling, same atomic reserve-then-commit discipline exactly (see that file's own doc
 * comment for the full reasoning, not repeated verbatim here), keyed by (spend_date,
 * destination_chain) rather than just spend_date, per OUTBOUND_THREAT_MODEL.md's own
 * "forward-looking key shape, not forward-looking behavior" note — see db/schema.sql's
 * outbound_daily_spend comment for the full reasoning.
 *
 * `reserve` is the operation the work loop must use before broadcasting: a single atomic
 * check-and-increment, so two transfers racing the same ceiling can never both pass a check against
 * room that only fits one (see outbound-ceiling.integration.test.ts for the real, concurrency-tested
 * proof, the exact same standard spend/ceiling.integration.test.ts already set for inbound).
 */
export interface OutboundSpendCeiling {
  /** Today's UTC total confirmed spend for this destination chain, in wei. Read-only; do not gate a
   *  broadcast on this. */
  spentToday(destinationChain: string): Promise<bigint>;
  /** True once spentToday(destinationChain) + amountWei would exceed the ceiling. Read-only, same
   *  caveat as above. */
  wouldExceed(destinationChain: string, amountWei: bigint): Promise<boolean>;
  /**
   * Atomically reserves `amountWei` against today's ceiling for `destinationChain`: increments and
   * checks in one statement. Returns `{ reserved: true, spentAfter }` if the reservation fit (the
   * increment is already committed), or `{ reserved: false, spentAfter }` if it would have exceeded
   * the ceiling (nothing was written; `spentAfter` is today's total as it stood at the attempt).
   *
   * Call this BEFORE broadcasting, with the REAL, current gas-cost quote, not an estimate made
   * earlier. If the reservation succeeds but the broadcast is then rejected before reaching the
   * network, call `release` with the same amount to give the budget back.
   */
  reserve(
    destinationChain: string,
    amountWei: bigint,
  ): Promise<{ reserved: boolean; spentAfter: bigint }>;
  /** Compensating decrement for a reservation whose broadcast never reached the network. */
  release(destinationChain: string, amountWei: bigint): Promise<void>;
}

function utcDateKey(now: () => Date = () => new Date()): string {
  return now().toISOString().slice(0, 10);
}

export class PostgresOutboundSpendCeiling implements OutboundSpendCeiling {
  constructor(
    private readonly pool: Pool,
    private readonly ceilingWei: bigint,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async spentToday(destinationChain: string): Promise<bigint> {
    const result = await this.pool.query<{ spent_wei: string }>(
      `SELECT spent_wei::text FROM outbound_daily_spend WHERE spend_date = $1 AND destination_chain = $2`,
      [utcDateKey(this.now), destinationChain],
    );
    return BigInt(result.rows[0]?.spent_wei ?? "0");
  }

  async wouldExceed(destinationChain: string, amountWei: bigint): Promise<boolean> {
    const spent = await this.spentToday(destinationChain);
    return spent + amountWei > this.ceilingWei;
  }

  async reserve(
    destinationChain: string,
    amountWei: bigint,
  ): Promise<{ reserved: boolean; spentAfter: bigint }> {
    const date = utcDateKey(this.now);
    // Single statement: check-and-increment atomically. Same race-free-under-real-concurrency
    // property as daily_spend's own reservation statement — see db/schema.sql's
    // outbound_daily_spend comment for the exact SQL and why the row-level lock makes this safe.
    const result = await this.pool.query<{ spent_wei: string }>(
      `INSERT INTO outbound_daily_spend (spend_date, destination_chain, spent_wei)
       VALUES ($1, $2, $3)
       ON CONFLICT (spend_date, destination_chain) DO UPDATE
         SET spent_wei = outbound_daily_spend.spent_wei + EXCLUDED.spent_wei
         WHERE outbound_daily_spend.spent_wei + EXCLUDED.spent_wei <= $4
       RETURNING spent_wei`,
      [date, destinationChain, amountWei.toString(), this.ceilingWei.toString()],
    );
    if (result.rows.length > 0) {
      return { reserved: true, spentAfter: BigInt(result.rows[0]!.spent_wei) };
    }
    // The WHERE clause excluded the row from RETURNING: nothing was written. Read the current total
    // back (a second statement is fine here — no write happened, so there is nothing to race).
    const spent = await this.spentToday(destinationChain);
    return { reserved: false, spentAfter: spent };
  }

  async release(destinationChain: string, amountWei: bigint): Promise<void> {
    // Bounded at zero: a release must never make the ledger go negative, which would otherwise
    // manufacture extra budget out of a bug (e.g. a double release).
    await this.pool.query(
      `UPDATE outbound_daily_spend
       SET spent_wei = GREATEST(spent_wei - $3, 0)
       WHERE spend_date = $1 AND destination_chain = $2`,
      [utcDateKey(this.now), destinationChain, amountWei.toString()],
    );
  }
}

/** In-memory OutboundSpendCeiling for tests that do not need Postgres. `reserve` is atomic with
 *  respect to this process's own event loop — same caveat as InMemorySpendCeiling's own doc
 *  comment: the claim that the real ceiling is safe across multiple relayer processes rests on
 *  PostgresOutboundSpendCeiling and its integration test, not on this fake. */
export class InMemoryOutboundSpendCeiling implements OutboundSpendCeiling {
  private readonly byKey = new Map<string, bigint>();

  constructor(
    private readonly ceilingWei: bigint,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key(destinationChain: string): string {
    return `${utcDateKey(this.now)}:${destinationChain}`;
  }

  spentToday(destinationChain: string): Promise<bigint> {
    return Promise.resolve(this.byKey.get(this.key(destinationChain)) ?? 0n);
  }

  async wouldExceed(destinationChain: string, amountWei: bigint): Promise<boolean> {
    const spent = await this.spentToday(destinationChain);
    return spent + amountWei > this.ceilingWei;
  }

  reserve(
    destinationChain: string,
    amountWei: bigint,
  ): Promise<{ reserved: boolean; spentAfter: bigint }> {
    const key = this.key(destinationChain);
    const current = this.byKey.get(key) ?? 0n;
    const next = current + amountWei;
    if (next > this.ceilingWei) {
      return Promise.resolve({ reserved: false, spentAfter: current });
    }
    this.byKey.set(key, next);
    return Promise.resolve({ reserved: true, spentAfter: next });
  }

  release(destinationChain: string, amountWei: bigint): Promise<void> {
    const key = this.key(destinationChain);
    const current = this.byKey.get(key) ?? 0n;
    const next = current - amountWei;
    this.byKey.set(key, next < 0n ? 0n : next);
    return Promise.resolve();
  }
}
