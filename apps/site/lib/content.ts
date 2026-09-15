/**
 * External and future-route destinations. `docs`, `playground`, and `github` are real, live
 * values now — `docs`/`playground` are apps/docs and apps/playground's current real deployments
 * (their Vercel-assigned URLs, not yet-live custom domains), and the GitHub repo is confirmed
 * public. The rest are still `#`: no real URL exists yet for any of them (no CONTRIBUTING.md
 * view, no issue template, no LICENSE blob link picked out). Do not invent one — replace the
 * value here once the real destination exists; nothing that reads LINKS needs to change.
 */
export const LINKS = {
  /** apps/docs' own current real deployment. */
  docs: "https://ferryline-docs.vercel.app/",
  /** apps/playground's own current real deployment. */
  playground: "https://playground-tau-beige.vercel.app/",
  /** The public GitHub org/repo URL — confirmed real and live. */
  github: "https://github.com/ferryline-labs/ferryline",
  /** CONTRIBUTING.md (or a "good first issue" view) — the repo is public now, just no real URL
   *  picked out here yet. */
  contributing: "#",
  /** A pre-filled "open an issue" link — same story as contributing above. */
  openIssue: "#",
  /** The LICENSE file, once it has a real URL to live at (e.g. the GitHub repo's blob view). */
  license: "#",
} as const;

/**
 * The one worked example used across the Hero preview and the live demo, so the two don't
 * describe two different, unrelated fictional transfers.
 */
export const EXAMPLE_TRANSFER = {
  asset: "USDC",
  amount: "250.00",
  // Arbitrum → Stellar: bridging an asset onto Stellar, not off it — the more representative
  // direction for what Ferryline is actually for.
  from: "Arbitrum",
  to: "Stellar",
  // Illustrative only — this is a mock of the quote UI's shape, not a claim about live fees or
  // delivery time. See ARCHITECTURE.md / VERIFIED.md for what's actually measured.
  fee: "0.42 USDC",
  eta: "~2 min",
} as const;

/** The stages `ferryline.track()` yields, per the live-demo Track tab's own code sample. */
export const TRACK_STAGES = ["submitted", "verified", "delivered"] as const;
