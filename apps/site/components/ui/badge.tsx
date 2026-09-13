import type { ReactElement, ReactNode } from "react";

/**
 * A small status tag. The doc reserves uppercase for exactly two contexts — mono type, and
 * `title-3` at w500 — so this uses `text-4-mono` (12px mono, uppercase): the doc's own "meta,
 * tags, captions" role, and `rounded-xs` (4px), its own "chips, tiny tags" radius tier.
 */
export function Badge({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex items-center rounded-xs bg-on-surface-muted px-2 py-1 font-mono text-text-4 uppercase text-on-surface-soft">
      {children}
    </span>
  );
}
