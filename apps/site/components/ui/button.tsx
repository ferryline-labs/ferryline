import type { ReactElement, ReactNode } from "react";

import { FOCUS_RING, cx } from "@/lib/styles";

type ButtonVariant = "brand" | "dark" | "light";

interface ButtonProps {
  href: string;
  variant?: ButtonVariant;
  external?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}

// The doc's own "keeps size identical across variants" trick: every variant carries a real 1px
// border, transparent unless the variant actually needs one visible (`light`) — so switching
// variants never changes the button's box size. Each variant owns its border color outright
// (never a separate always-on base class) so two border-color utilities never compete on one
// element — the same "one Record lookup, not concatenated classes" rule Card already follows.
//
// `on-brand` is white, not the doc's literal black — see the file-level comment in
// tailwind.config.ts. `px-5` (20px) is the doc's own literal horizontal padding; `py-3` (12px,
// not the doc's own 10px) is this project's own correction so the button clears its 44px
// accessibility floor — text-3's baked-in 21.12px line-height plus 10px padding renders at
// 41.12px, measured, same shortfall as the doc's own measured 43px button.
const VARIANTS: Record<ButtonVariant, string> = {
  brand: "border-transparent bg-brand text-on-brand",
  dark: "border-transparent bg-black text-white",
  light: "border-on-surface-weaker bg-on-surface-muted text-on-surface-dark",
};

// The ripple's own circle color: gray-300 at low opacity, regardless of variant — the doc's own
// button hover never changes with the button's fill color, only over it.
const RIPPLE = "bg-gray-300";

/** The one button treatment used for every call to action on the site — the doc's own 4-layer
 * structure: a transparent-bordered shape, a clipped ripple layer (an expanding circle plus a
 * flat wash, both fading in on hover), and the label on top. No `active:scale` — hover/active
 * here only ever move a fill or opacity, never the box.
 *
 * `rounded-lg` (20px), not the doc's own literal `rounded` (10px) — a direct request for more
 * corner rounding. It also happens to fix a real mismatch: the nav's pill container is
 * `rounded-lg` too (see site-header.tsx), so a button at the doc's default 10px sat noticeably
 * less rounded than the pill around it; matching radii here removes that clash entirely.
 */
export function Button({
  href,
  variant = "brand",
  external = false,
  className,
  children,
  onClick,
}: ButtonProps): ReactElement {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cx(
        "group relative inline-block rounded-lg border transition-colors duration-200",
        VARIANTS[variant],
        FOCUS_RING,
        className,
      )}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      <span aria-hidden className="absolute inset-0 overflow-hidden rounded-lg">
        {/* the expanding circle */}
        <span
          className={cx(
            "absolute left-1/2 top-1/2 aspect-square w-[110%] -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full opacity-30 transition-transform duration-[400ms] ease-[cubic-bezier(0.1,0,0.3,1)] group-hover:scale-100",
            RIPPLE,
          )}
        />
        {/* the flat wash, fading in alongside */}
        <span
          className={cx(
            "absolute inset-0 opacity-0 transition-opacity duration-btn group-hover:opacity-30",
            RIPPLE,
          )}
        />
      </span>
      <span className="relative z-[1] block px-5 py-3 text-text-3 font-medium">{children}</span>
    </a>
  );
}
