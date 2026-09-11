import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  SHARED_DECIMALS,
  STELLAR_DECIMALS,
  amount,
  formatAmount,
  fromSharedDecimals,
  isZero,
  parseAmount,
  scaleDown,
  scaleUp,
  toSharedDecimals,
} from "./amount.js";
import { FerrylineError } from "./errors.js";

function expectAmountError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FerrylineError);
  expect((caught as FerrylineError).code).toBe("AMOUNT_INVALID");
}

const nonNegativeBigInt = fc.bigInt({ min: 0n, max: (1n << 127n) - 1n });
const decimals = fc.integer({ min: 0, max: 38 });

describe("parseAmount", () => {
  it("parses plain decimals at exactly the asset's precision", () => {
    expect(parseAmount("250.00", STELLAR_DECIMALS)).toEqual({ value: 2500000000n, decimals: 7 });
    expect(parseAmount("1.2345678", STELLAR_DECIMALS)).toEqual({ value: 12345678n, decimals: 7 });
    expect(parseAmount("0", SHARED_DECIMALS)).toEqual({ value: 0n, decimals: 6 });
    expect(parseAmount("1", 0)).toEqual({ value: 1n, decimals: 0 });
    expect(parseAmount("007.5", 1)).toEqual({ value: 75n, decimals: 1 });
  });

  it.each([
    "",
    " 1",
    "1 ",
    "-1",
    "+1",
    "1e5",
    "1.",
    ".5",
    "1,000",
    "0x10",
    "1.2.3",
    "abc",
    "1_000",
  ])("rejects %j", (text) => {
    expectAmountError(() => parseAmount(text, STELLAR_DECIMALS));
  });

  it("refuses to round when the input has more fractional digits than the asset allows", () => {
    expectAmountError(() => parseAmount("1.2345678", SHARED_DECIMALS));
    expectAmountError(() => parseAmount("1.5", 0));
  });

  it("rejects impossible decimals", () => {
    expectAmountError(() => parseAmount("1", -1));
    expectAmountError(() => parseAmount("1", 1.5));
    expectAmountError(() => parseAmount("1", 39));
  });
});

describe("formatAmount", () => {
  it("is fixed-width in the asset's decimals", () => {
    expect(formatAmount({ value: 2500000000n, decimals: 7 })).toBe("250.0000000");
    expect(formatAmount({ value: 0n, decimals: 7 })).toBe("0.0000000");
    expect(formatAmount({ value: 5n, decimals: 7 })).toBe("0.0000005");
    expect(formatAmount({ value: 123n, decimals: 0 })).toBe("123");
    expect(formatAmount({ value: 1234567n, decimals: 6 })).toBe("1.234567");
  });

  it("rejects negative values", () => {
    expectAmountError(() => formatAmount({ value: -1n, decimals: 7 }));
  });

  it("round-trips through parseAmount for any value and precision", () => {
    fc.assert(
      fc.property(nonNegativeBigInt, decimals, (value, d) => {
        const a = { value, decimals: d };
        expect(parseAmount(formatAmount(a), d)).toEqual(a);
      }),
    );
  });
});

describe("toSharedDecimals (7 -> 6)", () => {
  it("matches the USDT0 launch-page example: 1.2345678 moves 1.234567 and floors 0.0000008 as dust", () => {
    const { amount: moved, dust } = toSharedDecimals(parseAmount("1.2345678", STELLAR_DECIMALS));
    expect(moved).toEqual({ value: 1234567n, decimals: 6 });
    expect(dust).toEqual({ value: 8n, decimals: 7 });
    expect(formatAmount(moved)).toBe("1.234567");
    expect(formatAmount(dust)).toBe("0.0000008");
  });

  it("never loses value: moved * 10 + dust == original, and dust is the 7th decimal only", () => {
    fc.assert(
      fc.property(nonNegativeBigInt, (value) => {
        const { amount: moved, dust } = toSharedDecimals({ value, decimals: STELLAR_DECIMALS });
        expect(moved.decimals).toBe(SHARED_DECIMALS);
        expect(dust.decimals).toBe(STELLAR_DECIMALS);
        expect(moved.value * 10n + dust.value).toBe(value);
        expect(dust.value >= 0n && dust.value < 10n).toBe(true);
      }),
    );
  });

  it("never rounds up", () => {
    fc.assert(
      fc.property(nonNegativeBigInt, (value) => {
        const { amount: moved } = toSharedDecimals({ value, decimals: STELLAR_DECIMALS });
        expect(moved.value * 10n <= value).toBe(true);
      }),
    );
  });

  it("is exact on the way back only when there was no dust", () => {
    fc.assert(
      fc.property(nonNegativeBigInt, (value) => {
        const { amount: moved, dust } = toSharedDecimals({ value, decimals: STELLAR_DECIMALS });
        const back = fromSharedDecimals(moved);
        expect(back.decimals).toBe(STELLAR_DECIMALS);
        expect(back.value <= value).toBe(true);
        expect(back.value === value).toBe(isZero(dust));
      }),
    );
  });

  it("rejects amounts that are not 7-decimal", () => {
    expectAmountError(() => toSharedDecimals({ value: 1n, decimals: 6 }));
    expectAmountError(() => fromSharedDecimals({ value: 1n, decimals: 7 }));
  });
});

describe("scaleDown / scaleUp (generic)", () => {
  it("preserves value across any precision pair: amount * 10^(from-to) + dust == original", () => {
    fc.assert(
      fc.property(nonNegativeBigInt, decimals, decimals, (value, a, b) => {
        const from = Math.max(a, b);
        const to = Math.min(a, b);
        const { amount: moved, dust } = scaleDown({ value, decimals: from }, to);
        const factor = 10n ** BigInt(from - to);
        expect(moved.value * factor + dust.value).toBe(value);
        expect(dust.value < factor).toBe(true);
        expect(moved.decimals).toBe(to);
        expect(dust.decimals).toBe(from);
      }),
    );
  });

  it("scaleUp is exact and scaleDown of it returns zero dust", () => {
    fc.assert(
      fc.property(nonNegativeBigInt, decimals, decimals, (value, a, b) => {
        const from = Math.min(a, b);
        const to = Math.max(a, b);
        const up = scaleUp({ value, decimals: from }, to);
        expect(up.value).toBe(value * 10n ** BigInt(to - from));
        const back = scaleDown(up, from);
        expect(back.amount.value).toBe(value);
        expect(isZero(back.dust)).toBe(true);
      }),
    );
  });

  it("refuses to go the wrong direction", () => {
    expectAmountError(() => scaleDown({ value: 1n, decimals: 6 }, 7));
    expectAmountError(() => scaleUp({ value: 1n, decimals: 7 }, 6));
  });

  it("rejects negative input everywhere", () => {
    expectAmountError(() => amount(-1n, 7));
    expectAmountError(() => scaleDown({ value: -10n, decimals: 7 }, 6));
    expectAmountError(() => scaleUp({ value: -1n, decimals: 6 }, 7));
  });
});
