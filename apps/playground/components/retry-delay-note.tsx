"use client";

import type { ReactElement } from "react";

import { useInspectorEvents } from "@/lib/use-inspector-events";

/**
 * Surfaces only while the widget is really in its own `awaiting-next-step` phase — the pause
 * between a confirmed Stellar step and building/submitting the next one (today, only the outbound
 * CCTP approve -> burn sequence has a second Stellar step). Detected from the real phase capture,
 * not a fixed timer of this component's own: it appears exactly when, and only when, the real
 * widget is actually in that phase, and disappears the moment it moves on.
 *
 * The explanation itself is grounded directly in POST_APPROVE_BUILD_DELAY_MS's own doc comment
 * (packages/widget/src/index.ts) — an empirically observed pattern (every real tx_bad_seq
 * rejection seen in this project's own testnet testing was the second of two Stellar transactions
 * submitted back to back from the same account), not a documented Soroban RPC platform behavior,
 * and not a guaranteed bound. Without this note, a visitor watching a real transfer pause here for
 * up to 15 real seconds has no way to tell that apart from the widget being stuck.
 */
export function RetryDelayNote(): ReactElement | undefined {
  const events = useInspectorEvents();
  const isAwaitingNextStep = events.some(
    (event) => event.kind === "phase" && event.phase.kind === "awaiting-next-step",
  );

  if (!isAwaitingNextStep) return undefined;

  return (
    <p className="mt-4 text-text-4 text-on-surface-weak">
      This pause (up to 15 real seconds) is deliberate, not a stall: outbound CCTP transfers submit
      two Stellar transactions back to back (approve, then burn) from the same account, and every
      real <code className="font-mono">tx_bad_seq</code> rejection seen during this project&apos;s
      own testnet testing was the second of exactly that pair — the public RPC node&apos;s own
      account state can briefly lag the network&apos;s real current state. This delay is a measured
      mitigation for that observed pattern, not a documented Soroban platform guarantee, so it
      isn&apos;t a fixed promise either — the widget&apos;s own retry/recheck logic is the real
      backstop regardless.
    </p>
  );
}
