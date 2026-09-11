import { FerrylineError } from "./errors.js";

/**
 * Stellar classic assets and their Stellar Asset Contracts carry 7 decimals.
 * Verified 2026-09-11: the USDT0 SAC's `decimals()` returns 7 (developers.stellar.org/docs/tokens/usdt0-layerzero).
 */
export const STELLAR_DECIMALS = 7;

/**
 * The 6-decimal representation shared across chains: the OFT's `shared_decimals`
 * for USDT0 and the amount field in CCTP messages for USDC.
 * Verified 2026-09-11: OFT `shared_decimals()` on mainnet; Circle's Stellar reference
 * ("CCTP messages use six" decimals). See packages/core/VERIFIED.md.
 */
export const SHARED_DECIMALS = 6;

const MAX_DECIMALS = 38;

/** An integer quantity plus the number of decimal places it is expressed in. Never a float. */
export interface Amount {
  readonly value: bigint;
  readonly decimals: number;
}

/**
 * Result of reducing precision. `dust` is whatever could not be represented at the
 * coarser precision. It is returned, never silently dropped, so callers can refund,
 * display, or refuse it.
 */
export interface ScaledDown {
  readonly amount: Amount;
  /** Remainder, expressed in the ORIGINAL (finer) decimals. */
  readonly dust: Amount;
}

function invalid(message: string): FerrylineError {
  return new FerrylineError("AMOUNT_INVALID", message);
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw invalid(`decimals must be an integer from 0 to ${MAX_DECIMALS}, got ${String(decimals)}`);
  }
}

function assertNonNegative(value: bigint): void {
  if (value < 0n) {
    throw invalid("amounts must not be negative");
  }
}

/** Construct an Amount, validating both parts. */
export function amount(value: bigint, decimals: number): Amount {
  assertDecimals(decimals);
  assertNonNegative(value);
  return { value, decimals };
}

export function isZero(a: Amount): boolean {
  return a.value === 0n;
}

/** Digits, optionally one "." and more digits. No sign, exponent, whitespace, separators, or bare "1." / ".5". */
const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a human decimal string into an Amount at exactly `decimals` precision.
 * Refuses input with more fractional digits than `decimals` rather than rounding,
 * because a silent round here is a silent change to what the user is sending.
 */
export function parseAmount(text: string, decimals: number): Amount {
  assertDecimals(decimals);
  const match = PLAIN_DECIMAL.exec(text);
  if (!match) {
    throw invalid(
      `"${text}" is not a plain decimal number (digits, optional single ".", no sign, exponent, or whitespace)`,
    );
  }
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw invalid(
      `"${text}" has ${String(fraction.length)} fractional digits but this asset allows ${String(decimals)}; refusing to round`,
    );
  }
  return { value: BigInt(whole + fraction.padEnd(decimals, "0")), decimals };
}

/** Fixed-width decimal string: always exactly `decimals` fractional digits, e.g. 2500000000n@7 -> "250.0000000". */
export function formatAmount(a: Amount): string {
  assertDecimals(a.decimals);
  assertNonNegative(a.value);
  const digits = a.value.toString().padStart(a.decimals + 1, "0");
  if (a.decimals === 0) {
    return digits;
  }
  const split = digits.length - a.decimals;
  return `${digits.slice(0, split)}.${digits.slice(split)}`;
}

/**
 * Reduce precision, rounding DOWN, and hand back the remainder as `dust`.
 * Invariant: amount.value * 10^(from - to) + dust.value === original value.
 */
export function scaleDown(a: Amount, toDecimals: number): ScaledDown {
  assertDecimals(a.decimals);
  assertDecimals(toDecimals);
  assertNonNegative(a.value);
  if (toDecimals > a.decimals) {
    throw invalid(
      `scaleDown target of ${String(toDecimals)} decimals is finer than the source's ${String(a.decimals)}; use scaleUp`,
    );
  }
  const factor = 10n ** BigInt(a.decimals - toDecimals);
  // bigint "/" truncates toward zero; value is non-negative, so this is floor.
  return {
    amount: { value: a.value / factor, decimals: toDecimals },
    dust: { value: a.value % factor, decimals: a.decimals },
  };
}

/** Increase precision. Exact; never loses anything. */
export function scaleUp(a: Amount, toDecimals: number): Amount {
  assertDecimals(a.decimals);
  assertDecimals(toDecimals);
  assertNonNegative(a.value);
  if (toDecimals < a.decimals) {
    throw invalid(
      `scaleUp target of ${String(toDecimals)} decimals is coarser than the source's ${String(a.decimals)}; use scaleDown`,
    );
  }
  return { value: a.value * 10n ** BigInt(toDecimals - a.decimals), decimals: toDecimals };
}

/** Stellar 7-decimal amount -> 6-decimal shared amount plus the 7th-decimal dust. */
export function toSharedDecimals(stellar: Amount): ScaledDown {
  if (stellar.decimals !== STELLAR_DECIMALS) {
    throw invalid(
      `expected a ${String(STELLAR_DECIMALS)}-decimal Stellar amount, got ${String(stellar.decimals)}`,
    );
  }
  return scaleDown(stellar, SHARED_DECIMALS);
}

/** 6-decimal shared amount -> Stellar 7-decimal amount. Exact. */
export function fromSharedDecimals(shared: Amount): Amount {
  if (shared.decimals !== SHARED_DECIMALS) {
    throw invalid(
      `expected a ${String(SHARED_DECIMALS)}-decimal shared amount, got ${String(shared.decimals)}`,
    );
  }
  return scaleUp(shared, STELLAR_DECIMALS);
}
