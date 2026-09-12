import type { Pool } from "pg";

/**
 * STEP 4's registration-time defense: a per-API-key rolling-window count, checked at POST
 * /transfers before touching anything else. This is deliberately a BLUNT instrument, not a
 * precision control — the recipient is not known at registration time (see the security-property
 * comment on registerTransferBodySchema in http/schemas.ts), so this can only ever key on what IS
 * known there: the caller's own API key. Its job is to stop trivial spam ("one caller floods the
 * relayer with junk transferIds"), not to enforce the real per-recipient limit — that is
 * countByRecipientSince, checked separately at the pending -> attested transition once the
 * recipient is verified (see work/attest.ts and RECIPIENT_RATE_LIMITED in work/errors.ts). Do not
 * confuse the two, and do not remove this comment when reading either check in isolation.
 *
 * Unlike spend/ceiling.ts's daily ceiling, this does NOT need a single atomic check-and-increment
 * statement: nothing here spends the sponsor's money or reserves a scarce, shared budget, so a
 * narrow race between two concurrent registrations from the same key at most admits one extra
 * registration past the limit for one instant — an acceptable, non-money-safety outcome for a spam
 * brake, unlike the daily ceiling where the phase-3 sign-off required true atomicity.
 */
export interface RegistrationLimiter {
  /**
   * Records this attempt and returns whether it is within the configured window/threshold.
   * Recording happens regardless of the verdict — a caller that gets rejected still counts toward
   * their own window, same reasoning as RECIPIENT_RATE_LIMITED transfers still counting toward
   * countByRecipientSince: excluding rejected attempts would let a caller retry past their own
   * limit for free.
   */
  recordAndCheck(keyHash: string): Promise<{ allowed: boolean; countInWindow: number }>;
}

export interface RegistrationLimiterConfig {
  readonly maxAttemptsPerWindow: number;
  readonly windowMs: number;
}

export class PostgresRegistrationLimiter implements RegistrationLimiter {
  constructor(
    private readonly pool: Pool,
    private readonly config: RegistrationLimiterConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordAndCheck(keyHash: string): Promise<{ allowed: boolean; countInWindow: number }> {
    const now = this.now();
    const windowStart = new Date(now.getTime() - this.config.windowMs);

    // Record first, then count: an attempt that gets rejected still counts toward the caller's own
    // window (see this file's class-level doc comment for why). Two statements, not one atomic
    // operation, is an accepted tradeoff here — see the same doc comment for why this is fine for a
    // spam brake in a way it would not be for the daily spend ceiling.
    await this.pool.query(
      `INSERT INTO registration_attempts (key_hash, attempted_at) VALUES ($1, $2)`,
      [keyHash, now],
    );
    const result = await this.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM registration_attempts
       WHERE key_hash = $1 AND attempted_at >= $2`,
      [keyHash, windowStart],
    );
    const countInWindow = Number(result.rows[0]?.count ?? "0");
    return { allowed: countInWindow <= this.config.maxAttemptsPerWindow, countInWindow };
  }
}

/** In-memory RegistrationLimiter for tests. */
export class InMemoryRegistrationLimiter implements RegistrationLimiter {
  private readonly attempts: { keyHash: string; attemptedAt: Date }[] = [];

  constructor(
    private readonly config: RegistrationLimiterConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  recordAndCheck(keyHash: string): Promise<{ allowed: boolean; countInWindow: number }> {
    const now = this.now();
    const windowStart = now.getTime() - this.config.windowMs;
    this.attempts.push({ keyHash, attemptedAt: now });
    const countInWindow = this.attempts.filter(
      (a) => a.keyHash === keyHash && a.attemptedAt.getTime() >= windowStart,
    ).length;
    return Promise.resolve({
      allowed: countInWindow <= this.config.maxAttemptsPerWindow,
      countInWindow,
    });
  }
}
