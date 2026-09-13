import type { ReactElement, ReactNode } from "react";

import { cx } from "@/lib/styles";

import { StarBorder } from "./star-border";

type CardTone = "surface" | "dark";

interface CardProps {
  children: ReactNode;
  className?: string;
  tone?: CardTone;
}

// The doc's own measured "Feature card" recipe: radius 10 (the site-wide default), fill gray-50,
// 20px padding, no border — one neutral card used everywhere (feature grid, live-demo status
// readout, rail cards). `dark` is the doc's other measured card fill (`#000`, "footer, dark
// cards") — the doc has no code-block concept at all (it's a marketing site), so this tone is
// this project's own addition for the one thing the doc doesn't cover: real code needs a dark,
// theme-invariant panel to read against.
const TONE_CLASSES: Record<CardTone, string> = {
  surface: "bg-on-surface-muted text-on-surface-dark",
  dark: "bg-black text-white",
};

/**
 * Every card on the page wraps its surface in `StarBorder` — an external component, applied by
 * direct request, not derived from the doc. `className` goes on the actual content div, exactly
 * where it went before `StarBorder` existed — callers use it for both sizing (`h-full`) *and*
 * internal layout (WhySection's comparison card passes `grid grid-cols-2 gap-6` to arrange its
 * own children side by side). `StarBorder` itself always gets a plain `h-full rounded` so it
 * stretches to match its own parent (a grid/flex cell) and keeps this project's own 10px radius,
 * without needing a caller to ask for either specifically.
 */
export function Card({ children, className, tone = "surface" }: CardProps): ReactElement {
  return (
    <StarBorder className="h-full rounded">
      <div className={cx("h-full rounded p-5", TONE_CLASSES[tone], className)}>{children}</div>
    </StarBorder>
  );
}
