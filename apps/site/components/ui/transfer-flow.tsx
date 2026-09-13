"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
// A brief head start before the count begins, so it doesn't race the card's own entrance fade
// (see Reveal in transfer-preview.tsx) — the numbers start moving just after the card has
// actually appeared, not underneath its own fade-in.
const START_DELAY_MS = 500;
const COUNT_DURATION_MS = 1800;

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Server default (false) is safe: the client corrects it on the very first paint, and this
 * only ever shortens an animation duration, never changes layout — no hydration mismatch. */
function getServerReducedMotionSnapshot(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot,
  );
}

/**
 * A single 0→1 run (not a loop — the count happens once, on page load; only the CSS dot on the
 * connector loops, see hero.tsx/transfer-preview.tsx), eased with the same sine-based ease-in-out
 * shape as the CSS dot's own `ease-in-out` timing function. Reduced motion isn't a special early
 * branch (which would mean calling `setState` synchronously at the top of the effect body,
 * flagged by `react-hooks/set-state-in-effect`) — it just collapses the duration to near-zero, so
 * every `setProgress` call still happens inside the `requestAnimationFrame` callback, the pattern
 * that hook expects.
 */
function useOneShotProgress(): number {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [progress, setProgress] = useState(0);
  const durationMs = prefersReducedMotion ? 1 : COUNT_DURATION_MS;

  useEffect(() => {
    let frameId: number;

    const timeoutId = window.setTimeout(() => {
      const start = performance.now();

      const tick = (now: number): void => {
        const linear = Math.min(1, (now - start) / durationMs);
        setProgress(0.5 - 0.5 * Math.cos(linear * Math.PI));
        if (linear < 1) {
          frameId = requestAnimationFrame(tick);
        }
      };

      frameId = requestAnimationFrame(tick);
    }, START_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
      cancelAnimationFrame(frameId);
    };
  }, [durationMs]);

  return progress;
}

interface TransferFlowProps {
  /** The amount leaving the source, as a plain number (already parsed from EXAMPLE_TRANSFER). */
  amount: number;
  /** The amount arriving at the destination — `amount - fee`, so the countdown/count-up pair
   * actually reflects the fee being deducted in transit, not just the same number twice. */
  arrival: number;
}

/**
 * The two live numbers this card was missing: a countdown on the source side and a count-up on
 * the destination side, both driven by one shared progress value so they move in lockstep — the
 * source number visibly empties out exactly as the destination number fills in, dramatizing the
 * transfer instead of just labeling it. Runs once on load; only the connector's dot animation
 * loops.
 */
export function useTransferAmounts({ amount, arrival }: TransferFlowProps): {
  sourceValue: string;
  destValue: string;
} {
  const progress = useOneShotProgress();
  return {
    sourceValue: (amount * (1 - progress)).toFixed(2),
    destValue: (arrival * progress).toFixed(2),
  };
}
