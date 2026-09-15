import type { ReactElement } from "react";

import { Badge, Button, Container } from "@ferryline/ui";
import { cx, FOCUS_RING } from "@ferryline/ui/styles";

import { LINKS } from "@/lib/content";

const NAV_LINKS = [
  { label: "Site", href: LINKS.home, external: false },
  { label: "Docs", href: LINKS.docs, external: true },
  { label: "GitHub", href: LINKS.github, external: true },
] as const;

/**
 * A new, playground-specific header — not SiteHeader itself (that stays in apps/site; a separate
 * deployable app can't reach into another app's local components any more than @ferryline/ui's
 * own extraction was needed for the primitives it now shares). Deliberately simpler than
 * SiteHeader's own text-roll hover animation and mobile disclosure panel: same real building
 * blocks (Container, the same floating rounded-lg pill, the same Button component, the same
 * brand-dot wordmark), same visual language, no invented new one — just without reproducing every
 * micro-interaction SiteHeader has for its own, more elaborate marketing-page nav.
 */
export function PlaygroundHeader(): ReactElement {
  return (
    <header className="sticky inset-x-0 top-0 z-[990] bg-white/80 backdrop-blur">
      <Container className="flex items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <a
            href={LINKS.home}
            className={cx(
              "flex items-center gap-2 rounded-full text-text-3 font-medium text-on-surface-dark",
              FOCUS_RING,
            )}
          >
            <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />
            Ferryline
            <span className="text-on-surface-weak">/ Playground</span>
          </a>
          {/* Header-level, not just mentioned in the footer's own copy: this page defaults the
              widget to testnet, and a visitor deciding whether to connect a wallet needs that
              fact before scrolling, not after. */}
          <Badge>Testnet</Badge>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-brand/40 bg-white p-1">
          <nav aria-label="Primary" className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className={cx(
                  "inline-flex h-9 items-center rounded-full px-4 text-text-4 uppercase text-on-surface-dark transition-colors duration-btn hover:bg-on-surface-muted",
                  FOCUS_RING,
                )}
                {...(link.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <Button href={LINKS.github} external className="ml-2">
            View source
          </Button>
        </div>
      </Container>
    </header>
  );
}
