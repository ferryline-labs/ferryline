import type { ReactElement } from "react";

import { LINKS } from "@/lib/content";

import { Container } from "./ui/container";
import { GridOverlay } from "./ui/grid-overlay";

const FOOTER_LINKS = [
  { label: "Docs", href: LINKS.docs },
  { label: "GitHub", href: LINKS.github, external: true },
  { label: "Contributing", href: LINKS.contributing },
  { label: "License (Apache-2.0)", href: LINKS.license },
] as const;

/** The doc's own "underline grows on hover" footer link, distinct from TextLink's retract. */
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
 * Black, white text — the doc's own one dark surface. A second `GridOverlay` copy in white
 * dashes repeats the page's own alignment grid inside the footer, per the doc's own note to do
 * exactly that. Real content only: brand + description, the same link set the nav and the
 * open-source section already point at, and a copyright line — no invented sitemap columns.
 */
export function SiteFooter(): ReactElement {
  return (
    <footer className="relative overflow-hidden bg-black">
      <GridOverlay variant="dark" />
      <Container className="relative py-[4.25rem] mobile-landscape:py-[3.125rem]">
        {/* No "desktop:" prefix needed for the wide layout — there's no min-width tier in this
            desktop-first screen set (see tailwind.config.ts): unprefixed classes already mean
            "the default, wide view," and `tablet:` is the narrow override. */}
        <div className="grid grid-cols-2 gap-10 gap-y-16 tablet:grid-cols-1">
          <div className="max-w-4-col">
            <p className="text-text-2 text-white">Ferryline</p>
            <p className="mt-4 text-text-3 text-on-dark-weak">
              One SDK for USDT0 and USDC, on and off Stellar. Open source and self-hostable.
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
