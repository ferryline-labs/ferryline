import type { TransferStage } from "@ferryline/sdk";
import { describe, expect, it } from "vitest";

import { FerrylineWidget, STAGE_LABELS, WIDGET_TAG, defineFerrylineWidget } from "./index.js";

describe("ferryline-widget", () => {
  it("registers once and tolerates repeat registration", () => {
    defineFerrylineWidget();
    defineFerrylineWidget();
    expect(customElements.get(WIDGET_TAG)).toBe(FerrylineWidget);
  });

  it("renders its network attribute into the shadow root", () => {
    defineFerrylineWidget();
    const element = document.createElement(WIDGET_TAG);
    element.setAttribute("network", "mainnet");
    document.body.append(element);
    expect(element.shadowRoot?.textContent).toContain("mainnet");
    element.setAttribute("network", "testnet");
    expect(element.shadowRoot?.textContent).toContain("testnet");
    element.remove();
  });

  it("has a label for every transfer stage", () => {
    const stages: TransferStage[] = ["created", "submitted", "verified", "delivered", "failed"];
    for (const stage of stages) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
  });
});
