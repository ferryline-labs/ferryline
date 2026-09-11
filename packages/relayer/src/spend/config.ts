/**
 * Every spend-related config value here is REQUIRED: none has a default, per the phase-3 sign-off
 * ("no default values for anything spend-related"). Call `loadSpendConfig` once at startup; it
 * throws with a specific, actionable message per missing/invalid value, and the relayer must not
 * start if it throws — see main.ts.
 */
export interface SpendConfig {
  /** Max XLM stroops the relayer will fee-bump for a single mint_and_forward. */
  readonly maxFeeBumpStroops: bigint;
  /** Max transfers a single recipient may register within the rolling window below. */
  readonly maxTransfersPerRecipient: number;
  readonly recipientRateLimitWindowMs: number;
  /** Max total XLM stroops (actual, confirmed spend) the relayer will fee-bump per UTC calendar day. */
  readonly dailySpendCeilingStroops: bigint;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string, hint: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required (${hint}). The relayer refuses to start without it.`);
  }
  return value;
}

function requirePositiveBigInt(env: NodeJS.ProcessEnv, name: string, hint: string): bigint {
  const raw = requireEnv(env, name, hint);
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    throw new Error(`${name}="${raw}" is not a valid integer (${hint}).`);
  }
  if (value <= 0n) {
    throw new Error(`${name} must be a positive integer, got "${raw}" (${hint}).`);
  }
  return value;
}

function requirePositiveInt(env: NodeJS.ProcessEnv, name: string, hint: string): number {
  const raw = requireEnv(env, name, hint);
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0 || String(value) !== raw.trim()) {
    throw new Error(`${name} must be a positive integer, got "${raw}" (${hint}).`);
  }
  return value;
}

export function loadSpendConfig(env: NodeJS.ProcessEnv = process.env): SpendConfig {
  return {
    maxFeeBumpStroops: requirePositiveBigInt(
      env,
      "FERRYLINE_MAX_FEE_BUMP_STROOPS",
      "max XLM stroops fee-bumped for a single mint_and_forward, e.g. 10000000 for 1 XLM",
    ),
    maxTransfersPerRecipient: requirePositiveInt(
      env,
      "FERRYLINE_MAX_TRANSFERS_PER_RECIPIENT",
      "max transfers one recipient may register per rate-limit window",
    ),
    recipientRateLimitWindowMs: requirePositiveInt(
      env,
      "FERRYLINE_RECIPIENT_RATE_LIMIT_WINDOW_MS",
      "rolling window length in milliseconds for the per-recipient rate limit, e.g. 3600000 for 1 hour",
    ),
    dailySpendCeilingStroops: requirePositiveBigInt(
      env,
      "FERRYLINE_DAILY_SPEND_CEILING_STROOPS",
      "max total XLM stroops fee-bumped per UTC calendar day across all transfers",
    ),
  };
}
