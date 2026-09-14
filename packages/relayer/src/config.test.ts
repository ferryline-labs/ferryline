import { describe, expect, it } from "vitest";

import { loadOutboundRelayerConfig, loadRelayerConfig, outboundEnabled } from "./config.js";

function validEnv(): NodeJS.ProcessEnv {
  return {
    FERRYLINE_NETWORK: "mainnet",
    DATABASE_URL: "postgres://user:pass@localhost:5432/ferryline",
    FERRYLINE_STELLAR_RPC_URL: "https://soroban-rpc.example.com",
  };
}

describe("loadRelayerConfig", () => {
  it("succeeds with just the three genuinely required vars, using documented defaults for the rest", () => {
    const config = loadRelayerConfig(validEnv());
    expect(config).toMatchObject({
      network: "mainnet",
      databaseUrl: "postgres://user:pass@localhost:5432/ferryline",
      rpcUrl: "https://soroban-rpc.example.com",
      host: "0.0.0.0",
      port: 8080,
      pollIntervalMs: 2000,
      pollMaxIntervalMs: 30_000,
      maxConcurrentTransfers: 20,
      registrationLimitMaxAttempts: 60,
      registrationLimitWindowMs: 60_000,
    });
  });

  it.each(["FERRYLINE_NETWORK", "DATABASE_URL", "FERRYLINE_STELLAR_RPC_URL"] as const)(
    "throws when %s is unset — these three are genuinely required, unlike the load-balancing/performance knobs below",
    (name) => {
      const env = validEnv();
      delete env[name];
      expect(() => loadRelayerConfig(env)).toThrow(new RegExp(`${name} is required`));
    },
  );

  it("throws with a specific message when FERRYLINE_NETWORK is set to something other than mainnet/testnet", () => {
    const env = validEnv();
    env["FERRYLINE_NETWORK"] = "devnet";
    expect(() => loadRelayerConfig(env)).toThrow(/must be "mainnet" or "testnet"/);
  });

  it("honors an explicit override for every performance/load knob (STEP 4: these are allowed sensible defaults)", () => {
    const config = loadRelayerConfig({
      ...validEnv(),
      HOST: "127.0.0.1",
      PORT: "9090",
      FERRYLINE_POLL_INTERVAL_MS: "500",
      FERRYLINE_POLL_MAX_INTERVAL_MS: "5000",
      FERRYLINE_MAX_CONCURRENT_TRANSFERS: "5",
      FERRYLINE_REGISTRATION_LIMIT_MAX_ATTEMPTS: "10",
      FERRYLINE_REGISTRATION_LIMIT_WINDOW_MS: "30000",
    });
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 9090,
      pollIntervalMs: 500,
      pollMaxIntervalMs: 5000,
      maxConcurrentTransfers: 5,
      registrationLimitMaxAttempts: 10,
      registrationLimitWindowMs: 30_000,
    });
  });
});

describe("outboundEnabled", () => {
  it("is false when FERRYLINE_OUTBOUND_ENABLED is unset — outbound is opt-in, not inferred", () => {
    expect(outboundEnabled({})).toBe(false);
  });

  it('is false for anything other than the exact string "true" (no truthy-string guessing)', () => {
    for (const value of ["1", "yes", "True", "TRUE", " true", "true "]) {
      expect(outboundEnabled({ FERRYLINE_OUTBOUND_ENABLED: value }), `value=${value}`).toBe(false);
    }
  });

  it('is true when FERRYLINE_OUTBOUND_ENABLED is exactly "true"', () => {
    expect(outboundEnabled({ FERRYLINE_OUTBOUND_ENABLED: "true" })).toBe(true);
  });
});

function validOutboundEnv(): NodeJS.ProcessEnv {
  return {
    FERRYLINE_OUTBOUND_DESTINATION_CHAIN: "ethereum-sepolia",
    FERRYLINE_OUTBOUND_EVM_RPC_URL: "https://sepolia.example.com",
  };
}

describe("loadOutboundRelayerConfig", () => {
  it("succeeds with just the two genuinely required vars, using documented defaults for the rest", () => {
    const config = loadOutboundRelayerConfig(validOutboundEnv());
    expect(config).toEqual({
      destinationChain: "ethereum-sepolia",
      evmRpcUrl: "https://sepolia.example.com",
      pollIntervalMs: 2000,
      pollMaxIntervalMs: 30_000,
      maxConcurrentTransfers: 20,
    });
  });

  it.each(["FERRYLINE_OUTBOUND_DESTINATION_CHAIN", "FERRYLINE_OUTBOUND_EVM_RPC_URL"] as const)(
    "throws when %s is unset",
    (name) => {
      const env = validOutboundEnv();
      delete env[name];
      expect(() => loadOutboundRelayerConfig(env)).toThrow(new RegExp(`${name} is required`));
    },
  );

  it("honors an explicit override for every performance/load knob", () => {
    const config = loadOutboundRelayerConfig({
      ...validOutboundEnv(),
      FERRYLINE_OUTBOUND_POLL_INTERVAL_MS: "500",
      FERRYLINE_OUTBOUND_POLL_MAX_INTERVAL_MS: "5000",
      FERRYLINE_OUTBOUND_MAX_CONCURRENT_TRANSFERS: "5",
    });
    expect(config).toMatchObject({
      pollIntervalMs: 500,
      pollMaxIntervalMs: 5000,
      maxConcurrentTransfers: 5,
    });
  });
});
