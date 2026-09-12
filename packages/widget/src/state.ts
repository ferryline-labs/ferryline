/**
 * Pure widget state machine: quote -> build -> preview -> signing -> tracking -> done/error.
 * No DOM, no wallet kit, no network calls of its own — every transition is driven by data the
 * caller already has (a Quote, a BuiltTransfer, a TransferStatus). This is deliberately the most
 * heavily unit-tested part of the widget (per the phase's own testing bar: component-level tests
 * using real SDK response shapes, not a full mutation-testing regime — this is a version-bump-risk
 * component, not the router or relayer).
 */
import type { BuiltTransfer, Quote, TransferId, TransferStatus } from "@ferryline/sdk";

export type WidgetPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "quoting" }
  | { readonly kind: "quoted"; readonly quote: Quote }
  | { readonly kind: "quote-failed"; readonly message: string }
  | { readonly kind: "building"; readonly quote: Quote }
  | {
      readonly kind: "preview";
      readonly quote: Quote;
      readonly built: BuiltTransfer;
      readonly stepIndex: number;
    }
  | {
      readonly kind: "signing";
      readonly quote: Quote;
      readonly built: BuiltTransfer;
      readonly stepIndex: number;
    }
  | {
      readonly kind: "awaiting-next-step";
      readonly quote: Quote;
      readonly built: BuiltTransfer;
      readonly stepIndex: number;
    }
  | {
      readonly kind: "tracking";
      readonly quote: Quote;
      readonly built: BuiltTransfer;
      readonly status: TransferStatus;
    }
  | {
      readonly kind: "done";
      readonly quote: Quote;
      readonly built: BuiltTransfer;
      readonly status: TransferStatus;
    }
  | { readonly kind: "build-failed"; readonly quote: Quote; readonly message: string }
  | {
      readonly kind: "sign-failed";
      readonly quote: Quote;
      readonly built: BuiltTransfer;
      readonly message: string;
    };

/**
 * The ONE structural rule this module exists to enforce: `signing` is reachable ONLY from
 * `preview`. There is no transition function here that goes straight from `quoted`/`building` to
 * `signing` — every real path that reaches `signing` passes through `preview` first. This is what
 * "the preview step cannot be bypassed" means at the code level; see index.ts's own doc comment
 * and state.test.ts's `signing is only reachable through preview` test for the direct proof.
 */
export function startQuoting(): WidgetPhase {
  return { kind: "quoting" };
}

export function quoteSucceeded(quote: Quote): WidgetPhase {
  return { kind: "quoted", quote };
}

export function quoteFailed(message: string): WidgetPhase {
  return { kind: "quote-failed", message };
}

export function startBuilding(quote: Quote): WidgetPhase {
  return { kind: "building", quote };
}

export function buildFailed(quote: Quote, message: string): WidgetPhase {
  return { kind: "build-failed", quote, message };
}

/**
 * The ONLY function in this module that produces a `preview` phase. `stepIndex` starts at 0 (the
 * first signable step) and this function is also how a caller re-enters preview for a LATER step
 * (a deferred step assembled via `prepareStep`, e.g. CCTP's approve-then-burn) — every subsequent
 * step gets its own preview, not just the first.
 */
export function buildSucceeded(quote: Quote, built: BuiltTransfer, stepIndex = 0): WidgetPhase {
  return { kind: "preview", quote, built, stepIndex };
}

/**
 * The ONLY function in this module that produces a `signing` phase, and its ONLY valid input is a
 * `preview` phase — the type signature itself makes `quoted`/`building`/`tracking` etc. impossible
 * arguments, not just a runtime check. There is no other way to reach `signing` in this file.
 */
export function confirmPreviewAndSign(phase: {
  readonly kind: "preview";
  readonly quote: Quote;
  readonly built: BuiltTransfer;
  readonly stepIndex: number;
}): WidgetPhase {
  return { kind: "signing", quote: phase.quote, built: phase.built, stepIndex: phase.stepIndex };
}

export function signFailed(
  phase: {
    readonly quote: Quote;
    readonly built: BuiltTransfer;
  },
  message: string,
): WidgetPhase {
  return { kind: "sign-failed", quote: phase.quote, built: phase.built, message };
}

/** After a step signs and broadcasts successfully, but the BuiltTransfer has more steps left. */
export function signedAwaitingNextStep(phase: {
  readonly quote: Quote;
  readonly built: BuiltTransfer;
  readonly stepIndex: number;
}): WidgetPhase {
  return {
    kind: "awaiting-next-step",
    quote: phase.quote,
    built: phase.built,
    stepIndex: phase.stepIndex,
  };
}

/** After the LAST step signs and broadcasts, hand off to track()'s real lifecycle. */
export function startTracking(
  quote: Quote,
  built: BuiltTransfer,
  status: TransferStatus,
): WidgetPhase {
  return { kind: "tracking", quote, built, status };
}

export function trackingUpdated(
  phase: { readonly quote: Quote; readonly built: BuiltTransfer },
  status: TransferStatus,
): WidgetPhase {
  if (status.stage === "delivered" || status.stage === "failed") {
    return { kind: "done", quote: phase.quote, built: phase.built, status };
  }
  return { kind: "tracking", quote: phase.quote, built: phase.built, status };
}

export function reset(): WidgetPhase {
  return { kind: "idle" };
}

export function isTerminal(phase: WidgetPhase): boolean {
  return (
    phase.kind === "done" ||
    phase.kind === "quote-failed" ||
    phase.kind === "build-failed" ||
    phase.kind === "sign-failed"
  );
}

/** The transferId, once one exists (from a successful `build()` onward). Undefined before that,
 * and undefined for `build-failed` too — a failed build never produced a BuiltTransfer to have a
 * transferId in the first place. */
export function transferIdOf(phase: WidgetPhase): TransferId | undefined {
  switch (phase.kind) {
    case "preview":
    case "signing":
    case "awaiting-next-step":
    case "tracking":
    case "done":
    case "sign-failed":
      return phase.built.transferId;
    case "idle":
    case "quoting":
    case "quoted":
    case "quote-failed":
    case "building":
    case "build-failed":
      return undefined;
  }
}
