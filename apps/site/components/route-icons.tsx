import type { ReactElement } from "react";

/**
 * Small geometric glyphs for the four architecture stops — hand-drawn line icons matching the
 * design system's stroke weight, not a stock icon library. Each is a 24×24 viewBox, stroke-only
 * (plus the odd filled dot as a node marker), `currentColor` so it inherits the card's ink state.
 * `className` is required (not defaulted) so every call site states its own size explicitly.
 *
 * Rebuilt once already: the original `RelayerIcon` had a genuine bug (one of its three arcs was
 * `a8 8 0 0 1 0 0` — a zero-length arc that draws nothing), which is why it read as barely-there
 * rather than a weak design choice. All four are redrawn here with a shared visual grammar — a
 * filled dot marks an endpoint/node wherever the icon has one — so they read as one family.
 */

interface IconProps {
  className: string;
}

const SHARED_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Angle brackets — one interface, called from code. */
export function SdkIcon({ className }: IconProps): ReactElement {
  return (
    <svg aria-hidden {...SHARED_PROPS} className={className}>
      <path d="M9 6.5L3.5 12l5.5 5.5M15 6.5l5.5 5.5-5.5 5.5" />
    </svg>
  );
}

/** A signal broadcasting outward from a source — three concentric arcs over a filled node, the
 * standard "relaying a signal onward" glyph, properly nested (unlike the original). */
export function RelayerIcon({ className }: IconProps): ReactElement {
  return (
    <svg aria-hidden {...SHARED_PROPS} className={className}>
      <circle cx="12" cy="19" r="1.15" fill="currentColor" stroke="none" />
      <path d="M8.5 15.3a5 5 0 0 1 7 0" />
      <path d="M5.5 11.8a10 10 0 0 1 13 0" />
      <path d="M2.5 8.3a15 15 0 0 1 19 0" />
    </svg>
  );
}

/** One node forking into two — a single call, dispatched to multiple destinations. */
export function RouterIcon({ className }: IconProps): ReactElement {
  return (
    <svg aria-hidden {...SHARED_PROPS} className={className}>
      <circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <path d="M5.8 12h3.7" />
      <path d="M9.5 12c0-3.3 2.2-5.5 5.5-5.5h2.2" />
      <path d="M9.5 12c0 3.3 2.2 5.5 5.5 5.5h2.2" />
      <circle cx="19.5" cy="6.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="19.5" cy="17.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A panel with an inset control and a drag handle — a drop-in, embeddable UI surface. */
export function WidgetIcon({ className }: IconProps): ReactElement {
  return (
    <svg aria-hidden {...SHARED_PROPS} className={className}>
      <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
      <path d="M4 9h16" strokeWidth={1.25} />
      <circle cx="7" cy="6.75" r="0.6" fill="currentColor" stroke="none" />
      <rect x="7.5" y="12.5" width="9" height="4" rx="1.25" />
    </svg>
  );
}
