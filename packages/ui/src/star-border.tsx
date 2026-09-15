import type { CSSProperties, ReactElement, ReactNode } from "react";

import { cx } from "./styles.js";

interface StarBorderProps {
  children: ReactNode;
  className?: string;
  /** Drives the glow's gradient — defaults to the site's own brand indigo, not the original
   * snippet's arbitrary "white"/cyan/magenta (a second hue here would break the page's "one
   * accent" restraint). This is a genuinely separate value from `borderColor` below, exactly as
   * in the original snippet — changing the glow doesn't have to change the resting border. */
  color?: string;
  /** The static border's own color — the original snippet's `borderColor` prop, kept as its own
   * separate value (default `#222222` there; here, a soft tint of the glow color by default, but
   * independently overridable). */
  borderColor?: string;
  speed?: CSSProperties["animationDuration"];
  /** Border width in px. The original snippet only ever pads top/bottom (`padding: Npx 0`) and
   * puts the actual border on an inner div it fully owns — reasonable for a single-line button.
   * A card needs a border on all four sides (nothing was visible on the left/right edges
   * otherwise), so this pads and borders every side instead of just top/bottom — the one
   * structural change from the snippet, made because this wraps arbitrary existing card content
   * rather than owning a button-shaped box itself. */
  thickness?: number;
}

/**
 * A visible border with an animated glow traveling along it — an external component (react-bits'
 * `StarBorder`), applied by direct request, not derived from the doc.
 *
 * Every *number* in the two glow layers below (position, size, opacity, gradient fade stop) is
 * the original snippet's own literal value, and the keyframe/animation names
 * (`star-movement-top`/`star-movement-bottom`) match the snippet's own names exactly, not a
 * shortened version of them.
 *
 * Consumer requirement: `animate-star-movement-top`/`-bottom` reference keyframes/animations
 * defined in apps/site's own tailwind.config.ts (`extend.keyframes`/`extend.animation`), not
 * Tailwind defaults and not part of @ferryline/design-tokens — any consuming app needs the same
 * two keyframe/animation entries for the glow to actually move.
 *
 * The two deliberate, necessary departures from the snippet, both because this wraps arbitrary
 * card content instead of owning a self-contained button — a literal, fully self-contained port
 * (forcing its own `backgroundColor`/`textColor`/fixed `rounded-[20px]`/centered 16px padding
 * onto whatever it wraps) was tried and reverted: it broke every card's own layout, radius, and
 * height-matching across a grid row:
 * - No forced `backgroundColor`/`textColor` on an inner content box — every card already has its
 *   own background and text color; this only ever adds the border and the glow behind whatever
 *   `children` supplies.
 * - The border sits on the *outer* wrapper, not a separate inner div, and covers all four sides
 *   (see `thickness` above) rather than the snippet's vertical-only padding.
 */
export function StarBorder({
  children,
  className,
  color = "#4F46E5",
  borderColor,
  speed = "6s",
  thickness = 1.5,
}: StarBorderProps): ReactElement {
  return (
    <div
      className={cx("relative overflow-hidden", className)}
      style={{ padding: `${thickness}px`, border: `1px solid ${borderColor ?? `${color}33`}` }}
    >
      <div
        className="absolute w-[300%] h-[50%] opacity-70 bottom-[-11px] right-[-250%] rounded-full animate-star-movement-bottom z-0"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed,
        }}
      ></div>
      <div
        className="absolute w-[300%] h-[50%] opacity-70 top-[-10px] left-[-250%] rounded-full animate-star-movement-top z-0"
        style={{
          background: `radial-gradient(circle, ${color}, transparent 10%)`,
          animationDuration: speed,
        }}
      ></div>
      {/* h-full: without this, a card stretched taller by its grid row (to match a taller
          sibling) only stretches this *wrapper* — height:100% doesn't propagate through an
          intermediate div that has no height of its own — leaving the actual visible card
          content at its own shorter natural height, with the glow (correctly clipped to the
          now-taller outer box) visible in the resulting gap underneath. */}
      <div className="relative z-[1] h-full">{children}</div>
    </div>
  );
}
