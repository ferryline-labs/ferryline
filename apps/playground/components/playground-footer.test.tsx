import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlaygroundFooter } from "./playground-footer";

describe("PlaygroundFooter", () => {
  it("renders the real cross-app footer links", () => {
    render(<PlaygroundFooter />);

    expect(screen.getByRole("link", { name: "Site" })).toHaveAttribute(
      "href",
      "https://ferryline-site.vercel.app/",
    );
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "https://ferryline-docs.vercel.app/",
    );
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/ferryline-labs/ferryline",
    );
  });

  it("renders the current year in the copyright line", () => {
    render(<PlaygroundFooter />);

    expect(
      screen.getByText(`© ${String(new Date().getFullYear())} Ferryline.`),
    ).toBeInTheDocument();
  });
});
