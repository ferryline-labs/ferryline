"use client";

import { type ElementType, type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";

import { cx } from "@/lib/styles";

type RevealVariant = "line" | "card" | "up";

interface RevealProps {
  children: ReactNode;
  /** `line`: headline text, scales from 1.2. `card`: cards/columns, scales from 1.1. `up`:
   * everything else, rises from 32px. Matches the doc's own three measured reveal recipes. */
  variant?: RevealVariant;
  /** Position among staggered siblings — delay is `index * 133ms`, the doc's own `--stagger`. */
  index?: number;
  as?: ElementType;
  className?: string;
  /** Forwarded to the rendered element — `role`, `id`, `aria-*`, `tabIndex`, and the like, so
   * Reveal can wrap something like an ARIA tabpanel without swallowing its wiring. */
  [key: `aria-${string}`]: unknown;
  id?: string;
  role?: string;
  tabIndex?: number;
}

const FROM_CLASSES: Record<RevealVariant, string> = {
  line: "scale-[1.2] opacity-0",
  card: "scale-110 opacity-0",
  up: "translate-y-8 opacity-0",
};

/**
 * The doc's own scroll-reveal system: one IntersectionObserver, fired once per element at 20% in
 * view, transitioning `transform`/`opacity` over `duration-3` (0.5s) on `ease-1` — never a
 * clip/mask reveal, always a *scale or position* reveal, so the parent needs `overflow: visible`
 * (nothing here sets `overflow: hidden` on the wrapper for exactly that reason).
 *
 * The doc's own headline treatment splits text into a `<div class="line">` per *rendered* line,
 * recomputed on resize — real, working text-reflow measurement. This implementation instead
 * reveals per markup-authored fragment (each `<Reveal variant="line">` is one deliberately short
 * phrase, not a measured DOM line), which sidesteps the doc's own flagged fragility ("`.line`
 * splitting must be recomputed on resize, or reflowed text breaks the reveal") at the cost of not
 * literally tracking the browser's own line breaks.
 */
export function Reveal({
  children,
  variant = "up",
  index = 0,
  as: Component = "div",
  className,
  ...rest
}: RevealProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [isIn, setIsIn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setIsIn(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Component
      ref={ref}
      {...rest}
      style={{ transitionDelay: `${index * 133}ms` }}
      className={cx(
        "transition-[transform,opacity] duration-3 ease-1 motion-reduce:transition-none motion-reduce:!translate-y-0 motion-reduce:!scale-100 motion-reduce:!opacity-100",
        isIn ? "translate-y-0 scale-100 opacity-100" : FROM_CLASSES[variant],
        className,
      )}
    >
      {children}
    </Component>
  );
}
