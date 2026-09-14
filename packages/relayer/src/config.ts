import type { CctpNetwork } from "@ferryline/sdk";

/**
 * Non-spend-related runtime config for the OUTBOUND (Stellar -> EVM) direction, mirroring
 * RelayerConfig's own "sensible defaults for non-money values" rule. Only loaded/required when
 * FERRYLINE_OUTBOUND_ENABLED=true — see loadOutboundRelayerConfig's own doc comment for why
 * outbound is opt-in per deployment rather than always-on: a deployment that only wants inbound
 * should not be forced to configure an EVM signer/RPC/spend caps it will never use.
 */
export interface OutboundRelayerConfig {
  /** The destination EVM chain's slug, validated against @ferryline/sdk's cctpEvmChain for this
   *  process's configured network (e.g. "ethereum-sepolia" on testnet) — per OUTBOUND_SCOPE.md's
   *  single-destination-chain v1 scope. */
  readonly destinationChain: string;
  /** The destination EVM chain's own JSON-RPC endpoint (genuinely different from
   *  FERRYLINE_STELLAR_RPC_URL — a separate chain, a separate RPC). */
  readonly evmRpcUrl: string;
  readonly pollIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  readonly maxConcurrentTransfers: number;
}

/**
 * Non-spend-related runtime config: everything main.ts needs to construct the repository, RPC
 * client, Iris client, and HTTP server. Kept separate from spend/config.ts's SpendConfig, which has
 * its own stricter "no defaults, ever" rule for money-related values — these values are allowed
 * sensible defaults (a poll interval, a port) because getting them wrong is inconvenient, not unsafe.
 */
export interface RelayerConfig {
  readonly network: CctpNetwork;
  readonly databaseUrl: string;
  readonly rpcUrl: string;
  readonly host: string;
  readonly port: number;
  readonly version: string;
  readonly pollIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  /**
   * Max transfers the work loop drives concurrently, combined across both phases (pending->attested
   * and attested->delivered). Each in-flight transfer holds its own long-lived poll against Iris or
   * Stellar RPC (see work/loop.ts) until it resolves, so this bounds how many such polls run at once
   * — a performance/load knob, not a correctness one: too high risks hammering Iris/RPC under a
   * burst of registrations, too low just means new transfers queue longer before starting. 20 is a
   * reasonable default for a single relayer instance; raise it if Iris/RPC comfortably support more.
   */
  readonly maxConcurrentTransfers: number;
  /**
   * STEP 4's registration-time defense: a per-API-key rolling-window count on POST /transfers,
   * checked before the recipient is even known (see spend/registration-limit.ts's own doc comment
   * for why this is a blunt spam brake, not the real per-recipient rate limit). Unlike
   * spend/config.ts's SpendConfig, this IS allowed a sensible default — per the STEP 4 sign-off,
   * getting this wrong risks over/under-blocking spam, not mis-spending the sponsor's funds, so it
   * does not need the "refuse to start if unset" treatment spend-related values get.
   */
  readonly registrationLimitMaxAttempts: number;
  readonly registrationLimitWindowMs: number;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string, hint: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required (${hint}). The relayer refuses to start without it.`);
  }
  return value;
}

function isCctpNetwork(value: string): value is CctpNetwork {
  return value === "mainnet" || value === "testnet";
}

/**
 * Whether this process should run the outbound (Stellar -> EVM) direction at all. Deliberately
 * opt-in (default "false"), NOT inferred from whether outbound-specific env vars happen to be set:
 * an operator who has not yet decided to run outbound should get a clean, well-documented "not
 * running" rather than the relayer guessing intent from partial config. Once opted in, every
 * outbound-specific value below (and every value in spend/outbound-config.ts) becomes genuinely
 * required — see loadOutboundRelayerConfig's own refusal-to-start behavior, identical in spirit to
 * loadRelayerConfig's FERRYLINE_NETWORK check above.
 */
export function outboundEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["FERRYLINE_OUTBOUND_ENABLED"] === "true";
}

/**
 * Loads OutboundRelayerConfig. Call this ONLY when outboundEnabled(env) is true — main.ts's own
 * gating ensures that. Every value here is required once outbound is enabled: an operator who
 * opted in but left one of these unset gets a specific, actionable refusal, the same "no silent
 * partial configuration" discipline as loadRelayerConfig/loadSpendConfig/loadOutboundSpendConfig.
 */
export function loadOutboundRelayerConfig(
  env: NodeJS.ProcessEnv = process.env,
): OutboundRelayerConfig {
  return {
    destinationChain: requireEnv(
      env,
      "FERRYLINE_OUTBOUND_DESTINATION_CHAIN",
      'the destination EVM chain slug, e.g. "ethereum-sepolia" (must be a chain @ferryline/sdk\'s cctpEvmChain recognizes for the configured network)',
    ),
    evmRpcUrl: requireEnv(
      env,
      "FERRYLINE_OUTBOUND_EVM_RPC_URL",
      "the destination EVM chain's own JSON-RPC endpoint",
    ),
    pollIntervalMs: Number.parseInt(env["FERRYLINE_OUTBOUND_POLL_INTERVAL_MS"] ?? "2000", 10),
    pollMaxIntervalMs: Number.parseInt(
      env["FERRYLINE_OUTBOUND_POLL_MAX_INTERVAL_MS"] ?? "30000",
      10,
    ),
    maxConcurrentTransfers: Number.parseInt(
      env["FERRYLINE_OUTBOUND_MAX_CONCURRENT_TRANSFERS"] ?? "20",
      10,
    ),
  };
}

export function loadRelayerConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  const rawNetwork = requireEnv(
    env,
    "FERRYLINE_NETWORK",
    'which CCTP network to run against: "mainnet" or "testnet"',
  );
  if (!isCctpNetwork(rawNetwork)) {
    throw new Error(`FERRYLINE_NETWORK must be "mainnet" or "testnet", got "${rawNetwork}".`);
  }

  return {
    network: rawNetwork,
    databaseUrl: requireEnv(env, "DATABASE_URL", "a Postgres connection string"),
    rpcUrl: requireEnv(env, "FERRYLINE_STELLAR_RPC_URL", "the Soroban RPC endpoint to use"),
    host: env["HOST"] ?? "0.0.0.0",
    port: Number.parseInt(env["PORT"] ?? "8080", 10),
    version: env["FERRYLINE_RELAYER_VERSION"] ?? "0.0.0",
    pollIntervalMs: Number.parseInt(env["FERRYLINE_POLL_INTERVAL_MS"] ?? "2000", 10),
    pollMaxIntervalMs: Number.parseInt(env["FERRYLINE_POLL_MAX_INTERVAL_MS"] ?? "30000", 10),
    maxConcurrentTransfers: Number.parseInt(env["FERRYLINE_MAX_CONCURRENT_TRANSFERS"] ?? "20", 10),
    registrationLimitMaxAttempts: Number.parseInt(
      env["FERRYLINE_REGISTRATION_LIMIT_MAX_ATTEMPTS"] ?? "60",
      10,
    ),
    registrationLimitWindowMs: Number.parseInt(
      env["FERRYLINE_REGISTRATION_LIMIT_WINDOW_MS"] ?? "60000",
      10,
    ),
  };
}
