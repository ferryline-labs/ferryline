import type { ReactElement } from "react";

import { cx, FOCUS_RING } from "./styles.js";

/** Visually hidden until focused — the first tab stop on every page. */
export function SkipLink(): ReactElement {
  return (
    <a
      href="#main-content"
      className={cx(
        "sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-text-3 focus:font-medium focus:text-on-brand",
        FOCUS_RING,
      )}
    >
      Skip to main content
    </a>
  );
}
