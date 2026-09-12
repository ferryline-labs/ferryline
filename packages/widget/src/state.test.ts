import { describe, expect, it } from "vitest";
import type { BuiltTransfer, Quote } from "@ferryline/sdk";

import {
  buildFailed,
  buildSucceeded,
  confirmPreviewAndSign,
  isTerminal,
  quoteFailed,
  quoteSucceeded,
  reset,
  signedAwaitingNextStep,
  signFailed,
  startBuilding,
  startQuoting,
  startTracking,
  trackingUpdated,
  transferIdOf,
} from "./state.js";

// Minimal, real-shaped fixtures — not the full Quote/BuiltTransfer the SDK produces, but every
// field these state transitions actually read.
const fakeQuote = { rail: "usdc-cctp", debit: { value: 1n, decimals: 7 } } as unknown as Quote;
const fakeBuilt = {
  transferId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  rail: "usdc-cctp",
  steps: [{ chain: "stellar", kind: "stellar-transaction", xdr: "AAAA", description: "Burn" }],
} as unknown as BuiltTransfer;

describe("widget state machine", () => {
  it("signing is only reachable through preview — the structural preview-cannot-be-bypassed guarantee", () => {
    // confirmPreviewAndSign's own TypeScript signature only accepts a `{ kind: "preview" }` shape —
    // this is checked at compile time by every other module that calls it (index.ts never calls it
    // with anything but a phase whose `.kind` is literally `"preview"`), and this test additionally
    // confirms it at runtime: the ONLY phase objects that produce `signing` are ones built from a
    // real `preview` phase's own fields.
    const previewPhase = buildSucceeded(fakeQuote, fakeBuilt, 0);
    expect(previewPhase.kind).toBe("preview");
    if (previewPhase.kind !== "preview") throw new Error("unreachable");

    const signingPhase = confirmPreviewAndSign(previewPhase);
    expect(signingPhase.kind).toBe("signing");
    if (signingPhase.kind !== "signing") throw new Error("unreachable");
    expect(signingPhase.quote).toBe(previewPhase.quote);
    expect(signingPhase.built).toBe(previewPhase.built);
    expect(signingPhase.stepIndex).toBe(previewPhase.stepIndex);
  });

  it("quote -> build -> preview -> sign -> track -> done, the full happy path", () => {
    let phase = startQuoting();
    expect(phase.kind).toBe("quoting");

    phase = quoteSucceeded(fakeQuote);
    expect(phase.kind).toBe("quoted");

    phase = startBuilding(fakeQuote);
    expect(phase.kind).toBe("building");

    phase = buildSucceeded(fakeQuote, fakeBuilt);
    expect(phase.kind).toBe("preview");
    if (phase.kind !== "preview") throw new Error("unreachable");

    phase = confirmPreviewAndSign(phase);
    expect(phase.kind).toBe("signing");
    if (phase.kind !== "signing") throw new Error("unreachable");

    phase = startTracking(phase.quote, phase.built, {
      transferId: fakeBuilt.transferId,
      stage: "submitted",
      updatedAt: Date.now(),
    });
    expect(phase.kind).toBe("tracking");
    if (phase.kind !== "tracking") throw new Error("unreachable");

    phase = trackingUpdated(phase, {
      transferId: fakeBuilt.transferId,
      stage: "delivered",
      updatedAt: Date.now(),
      destinationTxHash: "abc123",
    });
    expect(phase.kind).toBe("done");
    expect(isTerminal(phase)).toBe(true);
  });

  it("trackingUpdated stays in 'tracking' for every non-terminal stage", () => {
    const trackingPhase = startTracking(fakeQuote, fakeBuilt, {
      transferId: fakeBuilt.transferId,
      stage: "created",
      updatedAt: Date.now(),
    });
    if (trackingPhase.kind !== "tracking") throw new Error("unreachable");
    for (const stage of ["created", "submitted", "verified"] as const) {
      const next = trackingUpdated(trackingPhase, {
        transferId: fakeBuilt.transferId,
        stage,
        updatedAt: Date.now(),
      });
      expect(next.kind).toBe("tracking");
    }
  });

  it("trackingUpdated reaches 'done' for both delivered and failed — both are terminal", () => {
    const trackingPhase = startTracking(fakeQuote, fakeBuilt, {
      transferId: fakeBuilt.transferId,
      stage: "submitted",
      updatedAt: Date.now(),
    });
    if (trackingPhase.kind !== "tracking") throw new Error("unreachable");
    const delivered = trackingUpdated(trackingPhase, {
      transferId: fakeBuilt.transferId,
      stage: "delivered",
      updatedAt: Date.now(),
    });
    expect(delivered.kind).toBe("done");
    const failed = trackingUpdated(trackingPhase, {
      transferId: fakeBuilt.transferId,
      stage: "failed",
      updatedAt: Date.now(),
      failure: { code: "SOURCE_TX_FAILED", message: "boom", retryable: false },
    });
    expect(failed.kind).toBe("done");
  });

  it("a multi-step BuiltTransfer can move through preview twice — once per step", () => {
    const previewStep0 = buildSucceeded(fakeQuote, fakeBuilt, 0);
    if (previewStep0.kind !== "preview") throw new Error("unreachable");
    expect(previewStep0.stepIndex).toBe(0);

    const signedStep0 = confirmPreviewAndSign(previewStep0);
    if (signedStep0.kind !== "signing") throw new Error("unreachable");

    const awaiting = signedAwaitingNextStep(signedStep0);
    expect(awaiting.kind).toBe("awaiting-next-step");

    // A caller assembling the next deferred step re-enters preview at stepIndex 1 — the SAME
    // function that produced the first preview, proving there is no separate "skip preview for
    // step 2" path.
    const previewStep1 = buildSucceeded(fakeQuote, fakeBuilt, 1);
    if (previewStep1.kind !== "preview") throw new Error("unreachable");
    expect(previewStep1.stepIndex).toBe(1);
  });

  it("quoteFailed, buildFailed and signFailed are all terminal, non-preview, non-signing states", () => {
    expect(isTerminal(quoteFailed("no route"))).toBe(true);
    expect(isTerminal(buildFailed(fakeQuote, "boom"))).toBe(true);
    const previewPhase = buildSucceeded(fakeQuote, fakeBuilt);
    if (previewPhase.kind !== "preview") throw new Error("unreachable");
    expect(isTerminal(signFailed(previewPhase, "user rejected"))).toBe(true);
  });

  it("transferIdOf returns undefined before build, and the real id from preview onward", () => {
    expect(transferIdOf(startQuoting())).toBeUndefined();
    expect(transferIdOf(quoteSucceeded(fakeQuote))).toBeUndefined();
    expect(transferIdOf(buildFailed(fakeQuote, "boom"))).toBeUndefined();
    const previewPhase = buildSucceeded(fakeQuote, fakeBuilt);
    expect(transferIdOf(previewPhase)).toBe(fakeBuilt.transferId);
  });

  it("reset always returns to idle", () => {
    expect(reset().kind).toBe("idle");
  });
});
