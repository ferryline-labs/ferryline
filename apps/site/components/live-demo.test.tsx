import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { LiveDemo } from "./live-demo";

describe("LiveDemo", () => {
  it("shows the Quote panel by default, with Quote the only selected tab", () => {
    render(<LiveDemo />);

    expect(screen.getByRole("tab", { name: "Quote" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Build & sign" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("ferryline.quote");
  });

  it("switches panels on click and updates aria-selected", async () => {
    const user = userEvent.setup();
    render(<LiveDemo />);

    await user.click(screen.getByRole("tab", { name: "Track" }));

    expect(screen.getByRole("tab", { name: "Track" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Quote" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("ferryline.track");
  });

  it("only the selected tab is in the default tab order (roving tabindex)", () => {
    render(<LiveDemo />);

    expect(screen.getByRole("tab", { name: "Quote" })).toHaveAttribute("tabIndex", "0");
    expect(screen.getByRole("tab", { name: "Build & sign" })).toHaveAttribute("tabIndex", "-1");
    expect(screen.getByRole("tab", { name: "Track" })).toHaveAttribute("tabIndex", "-1");
  });

  it("moves selection with ArrowRight/ArrowLeft and wraps at the ends", async () => {
    const user = userEvent.setup();
    render(<LiveDemo />);

    const quoteTab = screen.getByRole("tab", { name: "Quote" });
    quoteTab.focus();

    await user.keyboard("{ArrowLeft}"); // wraps from the first tab to the last
    expect(screen.getByRole("tab", { name: "Track" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Track" })).toHaveFocus();

    await user.keyboard("{ArrowRight}"); // wraps back to the first
    expect(screen.getByRole("tab", { name: "Quote" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Quote" })).toHaveFocus();
  });

  it("jumps to the first/last tab with Home/End", async () => {
    const user = userEvent.setup();
    render(<LiveDemo />);

    screen.getByRole("tab", { name: "Quote" }).focus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Track" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Quote" })).toHaveAttribute("aria-selected", "true");
  });
});
