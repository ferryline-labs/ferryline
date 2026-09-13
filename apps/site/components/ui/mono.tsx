import type { ReactElement, ReactNode } from "react";

/**
 * Wraps a literal technical identifier (USDT0, CCTP, `@ferryline/sdk`, ...) in the mono
 * typeface. Not for eyebrow labels or section tags — only real code or real identifiers, so the
 * typeface stays functional rather than decorative.
 */
export function Mono({ children }: { children: ReactNode }): ReactElement {
  return <code className="font-mono text-[0.92em] text-on-surface-dark">{children}</code>;
}
