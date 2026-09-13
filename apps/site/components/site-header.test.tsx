import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("renders the wordmark and the desktop nav links", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: "Ferryline" })).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "Docs" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "GitHub" })[0]).toHaveAttribute("target", "_blank");
  });

  it("toggles the mobile menu's expanded state on click", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("closes the mobile menu when a mobile nav link is activated", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("button", { name: "Close menu" })).toBeInTheDocument();

    const mobileNav = screen.getByRole("navigation", { name: "Primary (mobile)" });
    const contributingLink = within(mobileNav).getByRole("link", { name: "Contributing" });

    await user.click(contributingLink);
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("marks the toggle button as an accessible control for the disclosure panel", () => {
    render(<SiteHeader />);

    const toggle = screen.getByRole("button", { name: "Open menu" });
    const panelId = toggle.getAttribute("aria-controls");

    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId ?? "")).not.toBeNull();
  });
});
