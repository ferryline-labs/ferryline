export interface BackoffOptions {
  /** Delay before the first retry. */
  readonly initialMs: number;
  /** Ceiling every later delay is clamped to. */
  readonly maxMs: number;
}

/** Exponential backoff: initial * 2^attempt, clamped to max. attempt 0 is the first wait. */
export function backoffDelay(attempt: number, options: BackoffOptions): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(`attempt must be a non-negative integer, got ${String(attempt)}`);
  }
  const raw = options.initialMs * 2 ** attempt;
  return Math.min(raw, options.maxMs);
}

export type SleepFn = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Default sleep: rejects with "aborted" when the signal fires so polling loops unwind. */
export const sleep: SleepFn = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
