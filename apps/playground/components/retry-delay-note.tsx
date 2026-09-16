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
 * The explanation itself is grounded directly in `pollPrepareStep`'s own doc comment
 * (`packages/widget/src/client.ts`). This used to describe a fixed-timer wait
 * (`POST_APPROVE_BUILD_DELAY_MS`, up to 15 real seconds) — replaced after that fixed timer shipped
 * to real npm consumers (`@ferryline/widget@0.1.0`/`0.1.1`) without ever being live-validated, and
 * an external, independent integration test caught it failing 100% of the time on a genuinely fresh
 * testnet account. The real mechanism now polls `prepareStep` itself, retrying only on the one
 * specific, real, typed error it throws — `ALLOWANCE_INSUFFICIENT` — until the TokenMessengerMinter
 * allowance the burn needs is genuinely visible, rather than waiting a fixed amount of time and
 * hoping it was enough. See `packages/widget/CHANGELOG.md`'s `0.1.2` entry for the full incident
 * writeup.
 */
export function RetryDelayNote(): ReactElement | undefined {
  const events = useInspectorEvents();
  const isAwaitingNextStep = events.some(
    (event) => event.kind === "phase" && event.phase.kind === "awaiting-next-step",
  );

  if (!isAwaitingNextStep) return undefined;

  return (
    <p className="mt-4 text-text-4 text-on-surface-weak">
      This pause is deliberate, not a stall: outbound CCTP transfers submit two Stellar transactions
      back to back (approve, then burn) from the same account, and every real{" "}
      <code className="font-mono">tx_bad_seq</code> rejection seen during this project&apos;s own
      testnet testing was the second of exactly that pair — the public RPC node&apos;s own account
      state can briefly lag the network&apos;s real current state. Rather than waiting a fixed
      amount of time, the widget polls for the real, specific on-chain condition the burn needs (the
      approve&apos;s allowance genuinely visible to the RPC node) and proceeds the moment
      that&apos;s true — so this pause is usually brief, but can take longer on a slower or more
      degraded RPC node; the widget&apos;s own retry/recheck logic is the real backstop regardless.
    </p>
  );
}
