import type { ReactElement } from "react";

import { Container, GridOverlay } from "@ferryline/ui";

import { LINKS } from "@/lib/content";

const FOOTER_LINKS = [
  { label: "Site", href: LINKS.home, external: false },
  { label: "Docs", href: LINKS.docs, external: true },
  { label: "GitHub", href: LINKS.github, external: true },
] as const;

/** Same "underline grows on hover" treatment as SiteFooter's own (private, not exported)
 *  FooterLink — recreated here rather than imported, since it was never a standalone component
 *  to begin with. */
function FooterLink({
  label,
  href,
  external,
}: {
  label: string;
  href: string;
  external?: boolean;
}): ReactElement {
  return (
    <a
      href={href}
      className="group inline-flex flex-col text-text-3 text-white"
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      {label}
      <span
        aria-hidden
        className="h-px w-0 bg-white transition-[width] duration-3 [transition-timing-function:cubic-bezier(0.165,0.84,0.44,1)] group-hover:w-full"
      />
    </a>
  );
}

/**
 * A new, playground-specific footer — same reasoning as PlaygroundHeader: SiteFooter itself stays
 * in apps/site, but the real building blocks it's made from (Container, GridOverlay, the black
 * surface + on-dark-weak text tokens) are the same shared ones, so this reads as the same site's
 * footer, not an invented one.
 */
export function PlaygroundFooter(): ReactElement {
  return (
    <footer className="relative overflow-hidden bg-black">
      <GridOverlay variant="dark" />
      <Container className="relative py-[4.25rem] mobile-landscape:py-[3.125rem]">
        <div className="grid grid-cols-2 gap-10 gap-y-16 tablet:grid-cols-1">
          <div className="max-w-4-col">
            <p className="text-text-2 text-white">Ferryline Playground</p>
            <p className="mt-4 text-text-3 text-on-dark-weak">
              A real, live &lt;ferryline-widget&gt; on testnet CCTP, with a real protocol inspector
              showing the actual calls as they happen.
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap justify-end gap-x-10 gap-y-4 tablet:justify-start"
          >
            {FOOTER_LINKS.map((link) => (
              <FooterLink key={link.label} {...link} />
            ))}
          </nav>
        </div>

        <p className="mt-16 text-text-4 text-on-dark-weak">
          © {new Date().getFullYear()} Ferryline.
        </p>
      </Container>
    </footer>
  );
}
