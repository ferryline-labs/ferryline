import { describe, expect, it } from "vitest";

import { loadSpendConfig } from "./config.js";

/**
 * STEP 6 sign-off: "confirm this refusal is actually implemented and tested — if main.ts currently
 * falls back to any default for a spend-related config value, that's a bug, fix it." This file is
 * that confirmation: every spend-related env var loadSpendConfig reads is proven here to have NO
 * default and to throw a specific, actionable error when unset — not just documented as required in
 * a comment, but verified to actually refuse.
 */

function validEnv(): NodeJS.ProcessEnv {
  return {
    FERRYLINE_MAX_FEE_BUMP_STROOPS: "10000000",
    FERRYLINE_MAX_TRANSFERS_PER_RECIPIENT: "5",
    FERRYLINE_RECIPIENT_RATE_LIMIT_WINDOW_MS: "3600000",
    FERRYLINE_DAILY_SPEND_CEILING_STROOPS: "1000000000",
  };
}

describe("loadSpendConfig: no defaults for anything spend-related", () => {
  it("succeeds and returns the parsed values when every required var is set", () => {
    const config = loadSpendConfig(validEnv());
    expect(config).toEqual({
      maxFeeBumpStroops: 10_000_000n,
      maxTransfersPerRecipient: 5,
      recipientRateLimitWindowMs: 3_600_000,
      dailySpendCeilingStroops: 1_000_000_000n,
    });
  });

  const required = [
    "FERRYLINE_MAX_FEE_BUMP_STROOPS",
    "FERRYLINE_MAX_TRANSFERS_PER_RECIPIENT",
    "FERRYLINE_RECIPIENT_RATE_LIMIT_WINDOW_MS",
    "FERRYLINE_DAILY_SPEND_CEILING_STROOPS",
  ] as const;

  it.each(required)(
    "throws (does not fall back to a default) when %s is entirely unset",
    (name) => {
      const env = validEnv();
      delete env[name];
      expect(() => loadSpendConfig(env)).toThrow(new RegExp(`${name} is required`));
    },
  );

  it.each(required)("throws when %s is set to an empty string", (name) => {
    const env = validEnv();
    env[name] = "";
    expect(() => loadSpendConfig(env)).toThrow(new RegExp(`${name} is required`));
  });

  it.each(required)("throws when %s is set to whitespace only", (name) => {
    const env = validEnv();
    env[name] = "   ";
    expect(() => loadSpendConfig(env)).toThrow(new RegExp(`${name} is required`));
  });

  it.each(["FERRYLINE_MAX_FEE_BUMP_STROOPS", "FERRYLINE_DAILY_SPEND_CEILING_STROOPS"] as const)(
    "throws when %s is not a valid integer",
    (name) => {
      const env = validEnv();
      env[name] = "not-a-number";
      expect(() => loadSpendConfig(env)).toThrow(/not a valid integer/);
    },
  );

  it.each(["FERRYLINE_MAX_FEE_BUMP_STROOPS", "FERRYLINE_DAILY_SPEND_CEILING_STROOPS"] as const)(
    "throws when %s is zero or negative — a spend cap of 0 is not 'unlimited', it is invalid",
    (name) => {
      for (const bad of ["0", "-1"]) {
        const env = validEnv();
        env[name] = bad;
        expect(() => loadSpendConfig(env), `${name}=${bad}`).toThrow(/must be a positive integer/);
      }
    },
  );

  it.each([
    "FERRYLINE_MAX_TRANSFERS_PER_RECIPIENT",
    "FERRYLINE_RECIPIENT_RATE_LIMIT_WINDOW_MS",
  ] as const)("throws when %s is zero, negative, or not an integer", (name) => {
    for (const bad of ["0", "-1", "1.5", "not-a-number"]) {
      const env = validEnv();
      env[name] = bad;
      expect(() => loadSpendConfig(env), `${name}=${bad}`).toThrow(/must be a positive integer/);
    }
  });

  it("does not use process.env as a hidden fallback when an explicit (incomplete) env is passed", () => {
    // Guards against a future regression where requireEnv's default parameter (`env =
    // process.env`) could let a real ambient env var silently satisfy a call site that passed an
    // explicit, deliberately incomplete env object for testing.
    const original = process.env["FERRYLINE_MAX_FEE_BUMP_STROOPS"];
    process.env["FERRYLINE_MAX_FEE_BUMP_STROOPS"] = "999999999";
    try {
      const env = validEnv();
      delete env["FERRYLINE_MAX_FEE_BUMP_STROOPS"];
      expect(() => loadSpendConfig(env)).toThrow(/FERRYLINE_MAX_FEE_BUMP_STROOPS is required/);
    } finally {
      if (original === undefined) {
        delete process.env["FERRYLINE_MAX_FEE_BUMP_STROOPS"];
      } else {
        process.env["FERRYLINE_MAX_FEE_BUMP_STROOPS"] = original;
      }
    }
  });
});
