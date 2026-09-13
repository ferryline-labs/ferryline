/**
 * External and future-route destinations. Every value is `#` because none of these has a real,
 * live URL yet (no public repo URL, no hosted docs, no npm package). Do not invent one — replace
 * the value here once the real destination exists; nothing that reads LINKS needs to change.
 */
export const LINKS = {
  /** Hosted docs, or this app's own /docs route once that's built out. */
  docs: "#",
  /** The public GitHub org/repo URL, once one exists. */
  github: "#",
  /** CONTRIBUTING.md (or a "good first issue" view), once the repo is public. */
  contributing: "#",
  /** A pre-filled "open an issue" link, once the repo is public. */
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
