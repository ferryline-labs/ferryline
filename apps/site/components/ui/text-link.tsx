import type { ReactElement, ReactNode } from "react";

import { FOCUS_RING, cx } from "@ferryline/ui/styles";

interface TextLinkProps {
  href: string;
  external?: boolean;
  children: ReactNode;
}

/**
 * The doc's own inline-link treatment, literally: underlined at rest, and the underline
 * *retracts* on hover (the reverse of the usual pattern) — a `::before` line, `scaleX(1)` from
 * the left at rest, `scaleX(0)` toward the right on hover, on a 150ms-delayed 0.5s transition.
 */
export function TextLink({ href, external = false, children }: TextLinkProps): ReactElement {
  return (
    <a
      href={href}
      className={cx(
        "relative inline-block text-on-surface-dark before:absolute before:inset-x-0 before:bottom-0.5 before:h-px before:origin-left before:scale-x-100 before:bg-current before:transition-transform before:duration-3 before:delay-150 before:ease-1 before:content-[''] hover:before:origin-right hover:before:scale-x-0",
        FOCUS_RING,
      )}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      {children}
    </a>
  );
}
