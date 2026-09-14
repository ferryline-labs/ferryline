import type { Config } from "tailwindcss";

import { theme } from "@ferryline/design-tokens";

// Same real design tokens as apps/site — see @ferryline/design-tokens' src/index.ts for the full
// provenance comment. fumadocs-ui's own chrome (sidebar, search, callouts) is themed separately,
// through the --color-fd-* variables set in app/global.css, not through this Tailwind theme —
// this config only governs utility classes this app's own pages/components use directly.
//
// One deliberate departure from apps/site's own tailwind.config.ts: apps/site spreads `theme`
// as a full replacement of screens/boxShadow/borderRadius/colors (so no default Tailwind class is
// accidentally reachable there — nothing in that app depends on a third-party Tailwind-consuming
// component library). apps/docs can't do that: fumadocs-ui's shipped CSS uses Tailwind's own
// default breakpoint (`md:`, `lg:`, `sm:`, `xl:`) and shadow/radius scale names (`shadow-lg`,
// `rounded-md`) directly — verified by reading its published css/generated/*.css `@source
// inline(...)` strings, not assumed. Replacing those scales broke its build outright (`Cannot
// apply unknown utility class 'rounded-md'`). So here every one of those four goes under `extend`
// instead of the top level, keeping Tailwind's stock scale available for fumadocs-ui while still
// layering the exact same real token values on top for this app's own components. `colors` is the
// one exception worth calling out: fumadocs-ui never references a bare default palette color
// (only its own `--color-fd-*` variables), so making it additive here doesn't fix anything
// fumadocs-ui needs — it's grouped with the other three purely for consistency of this file's own
// reasoning, not because it was independently required.
//
// No content glob for fumadocs-ui's own components: its shipped CSS (imported in global.css)
// already carries its utility classes via `@source inline(...)`, generated at its own build time
// — verified by reading fumadocs-ui's published css/generated/*.css directly, not assumed.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./content/**/*.mdx"],
  theme: {
    extend: {
      ...theme.extend,
      screens: theme.screens,
      boxShadow: theme.boxShadow,
      borderRadius: theme.borderRadius,
      colors: theme.colors,
    },
  },
  plugins: [],
};

export default config;
