/**
 * Every spend-related config value here is REQUIRED: none has a default, the exact same
 * "no defaults for anything spend-related" rule spend/config.ts's own SpendConfig follows for the
 * inbound direction. Call `loadOutboundSpendConfig` once at startup; it throws with a specific,
 * actionable message per missing/invalid value, and the outbound relayer must not start if it
 * throws — see main.ts.
 *
 * Deliberately NOT reusing SpendConfig directly, even though the shape is similar: the units are
 * genuinely different (wei, not stroops) and the env var names must be distinct so an operator can
 * configure the two directions' caps independently (a Stellar fee-bump cap has no necessary
 * relationship to an EVM gas cap) — sharing one config type here would either force one number to
 * mean two different things, or need the same kind of per-field renaming this file already does,
 * with no actual code reuse gained either way.
 */
export interface OutboundSpendConfig {
  /** Max wei the relayer will spend on gas for a single receiveMessage call. */
  readonly maxGasCostWei: bigint;
  /** Max transfers a single recipient (destination EVM address) may register within the rolling
   *  window below. */
  readonly maxTransfersPerRecipient: number;
  readonly recipientRateLimitWindowMs: number;
  /** Max total wei (actual, confirmed spend) the relayer will spend on gas per UTC calendar day,
   *  for the one configured destination chain. */
  readonly dailyGasCeilingWei: bigint;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string, hint: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required (${hint}). The outbound relayer refuses to start without it.`,
    );
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

export function loadOutboundSpendConfig(env: NodeJS.ProcessEnv = process.env): OutboundSpendConfig {
  return {
    maxGasCostWei: requirePositiveBigInt(
      env,
      "FERRYLINE_OUTBOUND_MAX_GAS_WEI",
      "max wei spent on gas for a single receiveMessage call, e.g. 5000000000000000 for 0.005 ETH",
    ),
    maxTransfersPerRecipient: requirePositiveInt(
      env,
      "FERRYLINE_OUTBOUND_MAX_TRANSFERS_PER_RECIPIENT",
      "max transfers one recipient may register per rate-limit window",
    ),
    recipientRateLimitWindowMs: requirePositiveInt(
      env,
      "FERRYLINE_OUTBOUND_RECIPIENT_RATE_LIMIT_WINDOW_MS",
      "rolling window length in milliseconds for the per-recipient rate limit, e.g. 3600000 for 1 hour",
    ),
    dailyGasCeilingWei: requirePositiveBigInt(
      env,
      "FERRYLINE_OUTBOUND_DAILY_GAS_CEILING_WEI",
      "max total wei spent on gas per UTC calendar day across all outbound transfers",
    ),
  };
}
