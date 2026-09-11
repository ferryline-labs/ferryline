import { describe, expect, it } from "vitest";

import { backoffDelay, sleep } from "./backoff.js";

describe("backoffDelay", () => {
  it("doubles from the initial delay and clamps at the cap", () => {
    const o = { initialMs: 5_000, maxMs: 60_000 };
    expect([0, 1, 2, 3, 4, 5, 10].map((a) => backoffDelay(a, o))).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000,
    ]);
  });

  it("stays at zero when polling is disabled for tests", () => {
    expect(backoffDelay(7, { initialMs: 0, maxMs: 60_000 })).toBe(0);
  });

  it("rejects nonsensical attempts", () => {
    expect(() => backoffDelay(-1, { initialMs: 1, maxMs: 2 })).toThrow(RangeError);
    expect(() => backoffDelay(1.5, { initialMs: 1, maxMs: 2 })).toThrow(RangeError);
  });
});

describe("sleep", () => {
  it("rejects when aborted", async () => {
    const controller = new AbortController();
    const pending = sleep(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
