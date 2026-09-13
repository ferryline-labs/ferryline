"use client";

import Link from "next/link";
import { type ReactElement, useId, useState } from "react";

import { LINKS } from "@/lib/content";
import { FOCUS_RING, cx } from "@/lib/styles";

import { Button } from "./ui/button";
import { Container } from "./ui/container";

const NAV_LINKS = [
  { label: "Docs", href: LINKS.docs },
  { label: "GitHub", href: LINKS.github, external: true },
  { label: "Contributing", href: LINKS.contributing },
] as const;

interface NavLinkProps {
  label: string;
  href: string;
  external?: boolean;
  onClick?: () => void;
}

/**
 * The doc's own nav-link hover, literally: the label exists twice, stacked, transitioning on
 * different curves (`transform .3s eas-1`, `opacity .15s eas-1`) — the resting copy exits upward
 * shrinking toward scale 0.8 as the duplicate drops in from scale 1.1 relaxing to 1, with a pill
 * background fading in behind both. `aria-label` on the link carries the accessible name once;
 * both visual copies are decorative duplicates (the doc does the same, "do the same or screen
 * readers read every link twice").
 */
function DesktopNavLink({ label, href, external, onClick }: NavLinkProps): ReactElement {
  return (
    <a
      href={href}
      aria-label={label}
      onClick={onClick}
      className={cx(
        "group relative inline-flex h-9 items-center overflow-clip rounded-full px-4 text-text-4 uppercase text-on-surface-dark",
        FOCUS_RING,
      )}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      <span
        aria-hidden
        className="absolute inset-0 -z-10 rounded-full bg-on-surface-muted opacity-0 transition-opacity duration-btn-fast ease-1 group-hover:opacity-100"
      />
      {/* h-[14.4px]: text-4's own baked-in line-height (12px × 1.2) — without an explicit height
          here, this wrapper only gets its size from the first (in-flow) copy while sitting
          flex-centered inside the taller pill, so the clip boundary ends up several pixels away
          from the actual glyphs on every side. Because these labels are all-caps with no
          descenders, that gap doesn't crop any visible ink — it just fails to clip at all, so
          both copies render fully, permanently, instead of the second staying hidden until
          hover. */}
      <span className="relative block h-[14.4px] overflow-clip">
        <span
          aria-hidden
          className="block scale-100 transition-transform duration-btn ease-1 group-hover:-translate-y-full group-hover:scale-[0.8] motion-reduce:transition-none"
        >
          {label}
        </span>
        <span
          aria-hidden
          className="absolute inset-0 translate-y-full scale-110 transition-transform duration-btn ease-1 group-hover:translate-y-0 group-hover:scale-100 motion-reduce:transition-none"
        >
          {label}
        </span>
      </span>
    </a>
  );
}

/** Mobile disclosure panel row: plain text, no roll trick — there's no hover on a touch panel. */
function MobileNavLink({ label, href, external, onClick }: NavLinkProps): ReactElement {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cx(
        "flex min-h-11 items-center rounded-full px-2 text-text-3 text-on-surface-dark",
        FOCUS_RING,
      )}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
    >
      {label}
    </a>
  );
}

function MenuIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
    >
      {open ? (
        <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
      )}
    </svg>
  );
}

// The doc's own progressive blur: a stack of panels behind the nav, each blurring less than the
// last and masked to a narrower band further down the strip, so the blur fades out smoothly
// instead of ending at a hard edge. Six panels (of the doc's own measured ten) is, per the doc,
// visually indistinguishable from all ten. Values are a geometric series, ratio 0.4, exactly as
// measured; panels 3–5 extrapolate the doc's own stated rule ("each: blur × 0.4, mask band
// shifted +10%") past where its table stops spelling them out.
const BLUR_PANELS = [
  { blur: 8, mask: "linear-gradient(#000 0%, #000 10%, transparent 30%)" },
  { blur: 3.2, mask: "linear-gradient(transparent 0%, #000 10%, #000 20%, transparent 40%)" },
  { blur: 1.28, mask: "linear-gradient(transparent 0%, #000 20%, #000 30%, transparent 50%)" },
  { blur: 0.512, mask: "linear-gradient(transparent 10%, #000 30%, #000 40%, transparent 60%)" },
  { blur: 0.2048, mask: "linear-gradient(transparent 20%, #000 40%, #000 50%, transparent 70%)" },
  { blur: 0.08192, mask: "linear-gradient(transparent 30%, #000 50%, #000 60%, transparent 80%)" },
] as const;

function NavBlur(): ReactElement {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48">
      {BLUR_PANELS.map((panel, index) => (
        <div
          key={index}
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${panel.blur}px)`,
            WebkitMaskImage: panel.mask,
            maskImage: panel.mask,
          }}
        />
      ))}
    </div>
  );
}

/**
 * `.nav { position: fixed; background: transparent }` — the bar itself has no chrome. The white
 * pill (`bg-white`, `p-1`, `gap-4`, holding the links and the one CTA) is the only visible nav
 * surface, floating over the page and the blur strip behind it.
 *
 * The doc's own nav button is a 36px "xs" size inside the pill, smaller than the 43px "m" button
 * elsewhere — this build has only one Button size, sized to clear this project's 44px
 * accessibility floor (see button.tsx), so it's reused here too rather than adding a second,
 * sub-44px variant with no other real use on this page. The pill grows to fit it (a little taller
 * than the doc's literal 40px) instead of shrinking the button to fit the pill.
 */
export function SiteHeader(): ReactElement {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const panelId = useId();
  const closeMenu = (): void => setIsMenuOpen(false);

  return (
    <header className="fixed inset-x-0 top-0 z-[990]">
      <NavBlur />
      <Container className="flex items-center justify-between gap-4 py-4">
        <Link
          href="/"
          className={cx(
            "flex items-center gap-2 rounded-full text-text-3 font-medium text-on-surface-dark",
            FOCUS_RING,
          )}
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />
          Ferryline
        </Link>

        {/* rounded-lg (20px), not rounded-full: the "Get started" button inside uses the doc's
            own default radius (10px, see button.tsx) rather than a full pill, and a fully-round
            container (~26px at this height) around a much-less-rounded button looked like a
            rectangle jammed into a dramatically curved slot. `rounded-lg` on both the container
            and the button (see button.tsx) lets them share one radius and nest cleanly.
            The 1px brand-colored border is a deliberate exception to the "zero borders"
            treatment used everywhere else on the page — a direct request for this one element. */}
        <div className="flex items-center gap-1 rounded-lg border border-brand/40 bg-white p-1 tablet:hidden">
          <nav aria-label="Primary" className="flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <DesktopNavLink key={link.label} {...link} />
            ))}
          </nav>
          <Button href={LINKS.docs} className="ml-2">
            Get started
          </Button>
        </div>

        <button
          type="button"
          aria-expanded={isMenuOpen}
          aria-controls={panelId}
          onClick={() => {
            setIsMenuOpen((open) => !open);
          }}
          className={cx(
            "hidden h-11 w-11 items-center justify-center rounded-full bg-white text-on-surface-dark tablet:inline-flex",
            FOCUS_RING,
          )}
        >
          <span className="sr-only">{isMenuOpen ? "Close menu" : "Open menu"}</span>
          <MenuIcon open={isMenuOpen} />
        </button>
      </Container>

      <div
        id={panelId}
        className="hidden grid-rows-[0fr] transition-[grid-template-rows] duration-3 ease-1 motion-reduce:transition-none tablet:grid"
        style={{ gridTemplateRows: isMenuOpen ? "1fr" : "0fr" }}
      >
        {/* min-w-0: this row is a CSS grid track (needed so the height-collapse transition above
            actually animates), and a grid item's default `min-width: auto` can let it grow to
            fit content instead of shrinking to the header's own width. px-margin (padding) on
            the gutter wrapper, not the old `mx-margin` (margin) on the nav itself — padding can
            never push a box wider than its own width the way margin on an auto/stretched-width
            element can; that combination was the actual overflow, not the button or icon. */}
        <div className="min-w-0 overflow-hidden">
          <div className="px-margin">
            <nav aria-label="Primary (mobile)" className="rounded bg-white px-4 pb-6 pt-2">
              <ul className="flex flex-col gap-1">
                {NAV_LINKS.map((link) => (
                  <li key={link.label}>
                    <MobileNavLink {...link} onClick={closeMenu} />
                  </li>
                ))}
              </ul>
              <Button
                href={LINKS.docs}
                onClick={closeMenu}
                className="mt-4 block w-full text-center"
              >
                Get started
              </Button>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
