import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetInstalledForTests,
  clearEvents,
  installInspectorCapture,
} from "@/lib/inspector-capture";

import { InspectorPanel } from "./inspector-panel";

describe("InspectorPanel", () => {
  const originalFetch = window.fetch.bind(window);

  afterEach(() => {
    window.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows the honest empty-state message when nothing has been captured yet", () => {
    clearEvents();
    __resetInstalledForTests();

    render(<InspectorPanel />);
    expect(screen.getByText(/Nothing captured yet/)).toBeInTheDocument();
  });

  it("auto-opens the section whose own latest event is genuinely most recent, not just the last one in groupEventsIntoSections' fixed category order", async () => {
    clearEvents();
    __resetInstalledForTests();
    window.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    installInspectorCapture();

    // Reproduces the real sequence observed live: an Iris fees call happens during quoting
    // (chronologically FIRST — Iris sorts into a section that comes AFTER "Unsigned XDR" in
    // groupEventsIntoSections' own fixed, readability-ordered list), then the widget reaches its
    // own real "preview" phase AFTERWARDS. Before the fix, `sections.at(-1)` picked Iris as
    // "most recent" purely because of its fixed-list position, even though preview's own event
    // timestamp is genuinely later.
    await fetch("https://iris-api-sandbox.circle.com/v2/burn/USDC/fees/27/0");
    // eslint-disable-next-line no-console -- simulating the widget's own real diagnostic log line
    console.log("[ferryline-widget] phase -> preview", {
      kind: "preview",
      quote: {},
      built: { transferId: "t1", rail: "usdc-cctp", steps: [] },
      stepIndex: 0,
    });

    render(<InspectorPanel />);

    expect(screen.getByRole("button", { name: /Unsigned XDR/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: /Circle Iris attestation/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("renders a phase event carrying real bigint amounts without crashing (reproduces a real live bug: JSON.stringify cannot serialize BigInt)", () => {
    clearEvents();
    __resetInstalledForTests();
    installInspectorCapture();

    // eslint-disable-next-line no-console -- simulating a real preview phase's real quote/built shape
    console.log("[ferryline-widget] phase -> preview", {
      kind: "preview",
      quote: {
        debit: { amount: 1000000n, decimals: 7 },
        credit: { amount: 1000000n, decimals: 6 },
      },
      built: { transferId: "t1", rail: "usdc-cctp", steps: [] },
      stepIndex: 0,
    });

    expect(() => {
      render(<InspectorPanel />);
    }).not.toThrow();
    // Expand it: EventRow/eventBody only runs once the section is open, so the bug only
    // reproduces once a visitor actually looks at this step, matching the collapsed-by-default
    // design. The panel starts this section open (it's the only one), so it's already expanded.
    expect(screen.getAllByText(/1000000/).length).toBeGreaterThan(0);
  });
});
