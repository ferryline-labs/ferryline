import { describe, expect, it } from "vitest";

import { loadOutboundSpendConfig } from "./outbound-config.js";

/**
 * The EVM mirror of config.test.ts's own sign-off standard: every spend-related env var
 * loadOutboundSpendConfig reads is proven here to have NO default and to throw a specific,
 * actionable error when unset — not just documented as required in a comment, but verified to
 * actually refuse.
 */

function validEnv(): NodeJS.ProcessEnv {
  return {
    FERRYLINE_OUTBOUND_MAX_GAS_WEI: "5000000000000000",
    FERRYLINE_OUTBOUND_MAX_TRANSFERS_PER_RECIPIENT: "5",
    FERRYLINE_OUTBOUND_RECIPIENT_RATE_LIMIT_WINDOW_MS: "3600000",
    FERRYLINE_OUTBOUND_DAILY_GAS_CEILING_WEI: "1000000000000000000",
  };
}

describe("loadOutboundSpendConfig: no defaults for anything spend-related", () => {
  it("succeeds and returns the parsed values when every required var is set", () => {
    const config = loadOutboundSpendConfig(validEnv());
    expect(config).toEqual({
      maxGasCostWei: 5_000_000_000_000_000n,
      maxTransfersPerRecipient: 5,
      recipientRateLimitWindowMs: 3_600_000,
      dailyGasCeilingWei: 1_000_000_000_000_000_000n,
    });
  });

  const required = [
    "FERRYLINE_OUTBOUND_MAX_GAS_WEI",
    "FERRYLINE_OUTBOUND_MAX_TRANSFERS_PER_RECIPIENT",
    "FERRYLINE_OUTBOUND_RECIPIENT_RATE_LIMIT_WINDOW_MS",
    "FERRYLINE_OUTBOUND_DAILY_GAS_CEILING_WEI",
  ] as const;

  it.each(required)(
    "throws (does not fall back to a default) when %s is entirely unset",
    (name) => {
      const env = validEnv();
      delete env[name];
      expect(() => loadOutboundSpendConfig(env)).toThrow(new RegExp(`${name} is required`));
    },
  );

  it.each(required)("throws when %s is set to an empty string", (name) => {
    const env = validEnv();
    env[name] = "";
    expect(() => loadOutboundSpendConfig(env)).toThrow(new RegExp(`${name} is required`));
  });

  it.each(required)("throws when %s is set to whitespace only", (name) => {
    const env = validEnv();
    env[name] = "   ";
    expect(() => loadOutboundSpendConfig(env)).toThrow(new RegExp(`${name} is required`));
  });

  it.each(["FERRYLINE_OUTBOUND_MAX_GAS_WEI", "FERRYLINE_OUTBOUND_DAILY_GAS_CEILING_WEI"] as const)(
    "throws when %s is not a valid integer",
    (name) => {
      const env = validEnv();
      env[name] = "not-a-number";
      expect(() => loadOutboundSpendConfig(env)).toThrow(/not a valid integer/);
    },
  );

  it.each(["FERRYLINE_OUTBOUND_MAX_GAS_WEI", "FERRYLINE_OUTBOUND_DAILY_GAS_CEILING_WEI"] as const)(
    "throws when %s is zero or negative — a spend cap of 0 is not 'unlimited', it is invalid",
    (name) => {
      for (const bad of ["0", "-1"]) {
        const env = validEnv();
        env[name] = bad;
        expect(() => loadOutboundSpendConfig(env), `${name}=${bad}`).toThrow(
          /must be a positive integer/,
        );
      }
    },
  );

  it.each([
    "FERRYLINE_OUTBOUND_MAX_TRANSFERS_PER_RECIPIENT",
    "FERRYLINE_OUTBOUND_RECIPIENT_RATE_LIMIT_WINDOW_MS",
  ] as const)("throws when %s is zero, negative, or not an integer", (name) => {
    for (const bad of ["0", "-1", "1.5", "not-a-number"]) {
      const env = validEnv();
      env[name] = bad;
      expect(() => loadOutboundSpendConfig(env), `${name}=${bad}`).toThrow(
        /must be a positive integer/,
      );
    }
  });

  it("does not use process.env as a hidden fallback when an explicit (incomplete) env is passed", () => {
    // Guards against a future regression where requireEnv's default parameter (`env =
    // process.env`) could let a real ambient env var silently satisfy a call site that passed an
    // explicit, deliberately incomplete env object for testing.
    const original = process.env["FERRYLINE_OUTBOUND_MAX_GAS_WEI"];
    process.env["FERRYLINE_OUTBOUND_MAX_GAS_WEI"] = "999999999999999999";
    try {
      const env = validEnv();
      delete env["FERRYLINE_OUTBOUND_MAX_GAS_WEI"];
      expect(() => loadOutboundSpendConfig(env)).toThrow(
        /FERRYLINE_OUTBOUND_MAX_GAS_WEI is required/,
      );
    } finally {
      if (original === undefined) {
        delete process.env["FERRYLINE_OUTBOUND_MAX_GAS_WEI"];
      } else {
        process.env["FERRYLINE_OUTBOUND_MAX_GAS_WEI"] = original;
      }
    }
  });
});
