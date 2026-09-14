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
    // `githubUrl` (rather than a manual entry in `links`) is fumadocs-ui's own built-in way to add
    // a GitHub link (resolveLinkItems, fumadocs-ui/layouts/shared/index.js) — it appends a real
    // `type: "icon"` item carrying fumadocs-ui's own GitHub mark SVG, which the sidebar renders as
    // a small icon button in the same footer row as the theme switch, instead of the theme switch
    // sitting alone with empty reserved space beside it. No other real external/social link exists
    // anywhere in this project (checked README.md, ARCHITECTURE.md, apps/site's own footer) to add
    // alongside it — not inventing an X/Discord/etc. link with nothing real to point it at.
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
