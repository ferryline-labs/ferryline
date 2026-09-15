import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  clearEvents,
  installInspectorCapture,
  __resetInstalledForTests,
} from "@/lib/inspector-capture";

import { RetryDelayNote } from "./retry-delay-note";

describe("RetryDelayNote", () => {
  it("renders nothing when the widget has never reached awaiting-next-step", () => {
    clearEvents();
    __resetInstalledForTests();
    installInspectorCapture();

    const { container } = render(<RetryDelayNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the real explanation once the widget's own phase log reports awaiting-next-step", () => {
    clearEvents();
    __resetInstalledForTests();
    installInspectorCapture();

    // eslint-disable-next-line no-console -- simulating the widget's own real diagnostic log line
    console.log("[ferryline-widget] phase -> awaiting-next-step", {
      kind: "awaiting-next-step",
      quote: {},
      built: {},
      stepIndex: 1,
    });

    render(<RetryDelayNote />);
    expect(screen.getByText(/tx_bad_seq/)).toBeInTheDocument();
  });
});
