import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/**
 * Layout options shared by the docs layout (app/docs/layout.tsx) and, if this site ever grows a
 * marketing shell around the docs, any other layout wrapping fumadocs-ui's navigation. Kept in one
 * function, per fumadocs-ui's own convention, rather than repeating the same nav/links object
 * anywhere a layout needs it.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Ferryline",
    },
    // The two real cross-app destinations: apps/site and apps/playground's own current real
    // deployments (their Vercel-assigned URLs — no custom domain live for either yet). `external:
    // true` since both are genuinely separate deployed apps, not routes within this one.
    links: [
      { text: "Site", url: "https://ferryline-site.vercel.app/", external: true },
      { text: "Playground", url: "https://playground-tau-beige.vercel.app/", external: true },
    ],
    // `githubUrl` (rather than a manual entry in `links`) is fumadocs-ui's own built-in way to add
    // a GitHub link (resolveLinkItems, fumadocs-ui/layouts/shared/index.js) — it appends a real
    // `type: "icon"` item carrying fumadocs-ui's own GitHub mark SVG, which the sidebar renders as
    // a small icon button in the same footer row as the theme switch, instead of the theme switch
    // sitting alone with empty reserved space beside it. Site/Playground above are plain text nav
    // links; this one gets the dedicated icon-button treatment instead, specifically because
    // fumadocs-ui already builds that treatment in for GitHub and nothing else.
    githubUrl: "https://github.com/ferryline-labs/ferryline",
    // fumadocs-ui's sidebar theme toggle defaults to a light/dark-only two-icon button
    // (`mode: "light-dark"`, its own default — fumadocs-ui/layouts/shared/slots/theme-switch.js).
    // "light-dark-system" is the real, documented alternative that renders all three as separate
    // buttons (light/dark/system), matching what this site's RootProvider (app/layout.tsx) now
    // actually wires up via next-themes.
    themeSwitch: {
      mode: "light-dark-system",
    },
  };
}
