/**
 * Cross-app destinations. Unlike apps/site's own lib/content.ts (whose LINKS are still "#"
 * placeholders predating the repo going public), these three are real, known values: the GitHub
 * repo is confirmed public and live (github.com/ferryline-labs/ferryline), and `docs`/`home` are
 * this project's own stated production domains for apps/docs and apps/site respectively — not a
 * guess, but also not independently verified as already deployed/live at the time this file was
 * written. Update here once each is confirmed live; nothing that reads LINKS needs to change.
 */
export const LINKS = {
  /** apps/site's own production domain. */
  home: "https://ferryline.dev",
  /** apps/docs' own production domain. */
  docs: "https://docs.ferryline.dev",
  /** The public GitHub org/repo — confirmed real and live. */
  github: "https://github.com/ferryline-labs/ferryline",
} as const;
