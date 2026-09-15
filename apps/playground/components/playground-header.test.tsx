import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlaygroundHeader } from "./playground-header";

describe("PlaygroundHeader", () => {
  it("renders the wordmark linking home and the real cross-app nav links", () => {
    render(<PlaygroundHeader />);

    expect(screen.getByRole("link", { name: /Ferryline.*Playground/s })).toHaveAttribute(
      "href",
      "https://ferryline-site.vercel.app/",
    );
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "https://ferryline-docs.vercel.app/",
    );
    const github = screen.getByRole("link", { name: "GitHub" });
    expect(github).toHaveAttribute("href", "https://github.com/ferryline-labs/ferryline");
    expect(github).toHaveAttribute("target", "_blank");
  });

  it("renders the view-source CTA pointing at the real repo", () => {
    render(<PlaygroundHeader />);

    expect(screen.getByRole("link", { name: "View source" })).toHaveAttribute(
      "href",
      "https://github.com/ferryline-labs/ferryline",
    );
  });

  it("shows a Testnet badge in the header itself, not just the footer's own copy", () => {
    render(<PlaygroundHeader />);

    expect(screen.getByText("Testnet")).toBeInTheDocument();
  });
});
