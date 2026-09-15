import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WidgetEmbed } from "./widget-embed";

describe("WidgetEmbed", () => {
  it("shows the honest relayer-not-configured note when the env vars are genuinely unset", () => {
    // No mocking here on purpose: NEXT_PUBLIC_FERRYLINE_RELAYER_URL/_API_KEY are genuinely unset
    // in this test environment, the same as the real, undeployed state — this proves the
    // graceful-degradation path against reality, not a simulated one.
    expect(process.env["NEXT_PUBLIC_FERRYLINE_RELAYER_URL"]).toBeUndefined();
    expect(process.env["NEXT_PUBLIC_FERRYLINE_RELAYER_API_KEY"]).toBeUndefined();

    render(<WidgetEmbed />);

    expect(screen.getByText(/Automatic relay registration is not configured/)).toBeInTheDocument();
    expect(screen.getByText(/not a sign of anything broken/)).toBeInTheDocument();
  });

  it("does not set relayer-url/relayer-api-key attributes on the widget when unset", () => {
    const { container } = render(<WidgetEmbed />);

    const widget = container.querySelector("ferryline-widget");
    expect(widget).not.toBeNull();
    expect(widget).toHaveAttribute("network", "testnet");
    expect(widget).not.toHaveAttribute("relayer-url");
    expect(widget).not.toHaveAttribute("relayer-api-key");
  });

  it("renders the USDT0-exclusion copy grounded in the real, structural reason", () => {
    render(<WidgetEmbed />);

    expect(
      screen.getByText(/has no Stellar testnet deployment to test against/),
    ).toBeInTheDocument();
  });

  it("renders the sender/recipient/amount form with the real default amount", () => {
    render(<WidgetEmbed />);

    expect(screen.getByLabelText(/Sender/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Recipient/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toHaveValue("1.00");
  });
});
