import type { ReactElement } from "react";

import { cx } from "@/lib/styles";

/**
 * "The single biggest reason the page reads as designed rather than assembled" — a full-viewport,
 * `position: fixed`, pointer-events-none overlay of dashed vertical rules that stays put while
 * content scrolls past. Columns line up with the real content grid (`Container`'s own
 * `max-width` + `px-margin`), so every card edge lands on a rule.
 *
 * The doc's own CSS for this omits the container's side padding on the overlay itself; taken
 * literally that would misalign the lines from the actual content grid, contradicting the doc's
 * own claim that they land exactly on it — `px-margin` here is added to make the stated behavior
 * true, on the assumption that's a trimmed shared class rather than a deliberate offset.
 *
 * Each column's dash is a repeating linear-gradient, not a real border: a 12px tile split
 * 60/40 gives a 7.2px dash / 4.8px gap at 8% opacity, exactly as measured. The first column's
 * line is hidden — it would otherwise sit redundantly on the page's own edge.
 */
export function GridOverlay({ variant = "light" }: { variant?: "light" | "dark" }): ReactElement {
  const lineColor = variant === "light" ? "#000000" : "#ffffff";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 mx-auto grid max-w-[1440px] grid-cols-4 gap-gutter px-margin tablet:grid-cols-2"
    >
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className={cx(
            "relative",
            index === 0 && "opacity-0",
            // "drop the grid overlay to 2 columns" below the tablet tier (the doc's own
            // responsive note) — the track itself switches to grid-cols-2 above, and the two
            // extra column divs are hidden rather than left to auto-wrap into a second row.
            index >= 2 && "tablet:hidden",
          )}
        >
          <div
            className="absolute inset-y-0 left-0 w-px opacity-[0.08] [background-size:1px_12px] [background-repeat:repeat-y]"
            style={{ backgroundImage: `linear-gradient(${lineColor} 60%, transparent 0)` }}
          />
        </div>
      ))}
    </div>
  );
}
