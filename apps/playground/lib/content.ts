/**
 * Cross-app destinations. All three confirmed real and live: the GitHub repo
 * (github.com/ferryline-labs/ferryline), and apps/site and apps/docs' current real deployments —
 * their Vercel-assigned URLs, not the aspirational ferryline.dev/docs.ferryline.dev custom domains
 * this file pointed at before (those aren't wired up to anything yet). Update here once a custom
 * domain is actually live; nothing that reads LINKS needs to change.
 */
export const LINKS = {
  /** apps/site's own current real deployment. */
  home: "https://ferryline-site.vercel.app/",
  /** apps/docs' own current real deployment. */
  docs: "https://ferryline-docs.vercel.app/",
  /** The public GitHub org/repo — confirmed real and live. */
  github: "https://github.com/ferryline-labs/ferryline",
} as const;
