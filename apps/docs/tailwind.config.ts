import type { Config } from "tailwindcss";

import {
  brand,
  duration,
  easing,
  fontSize,
  gray,
  radius,
  semantic,
  spacing,
} from "@ferryline/design-tokens";

// Same real design tokens as apps/site and packages/widget — @ferryline/design-tokens is plain
// data (no Tailwind dependency of its own); each consuming app builds its own Tailwind-shaped
// theme from it, the same pattern apps/site/tailwind.config.ts and packages/widget/tailwind.config.ts
// both use. fumadocs-ui's own chrome (sidebar, search, callouts) is themed separately, through the
// --color-fd-* variables set in app/global.css, not through this Tailwind theme — this config only
// governs utility classes this app's own pages/components use directly.
//
// One deliberate departure from apps/site's tailwind.config.ts: apps/site spreads its
// screens/boxShadow/borderRadius/colors as a full replacement (so no default Tailwind class is
// accidentally reachable there — nothing in that app depends on a third-party Tailwind-consuming
// component library). apps/docs can't do that: fumadocs-ui's shipped CSS uses Tailwind's own
// default breakpoint (`md:`, `lg:`, `sm:`, `xl:`) and shadow/radius scale names (`shadow-lg`,
// `rounded-md`) directly — verified by reading its published css/generated/*.css `@source
// inline(...)` strings, not assumed. Replacing those scales broke its build outright (`Cannot
// apply unknown utility class 'rounded-md'`). So `borderRadius`/`colors` go under `extend` here,
// keeping Tailwind's stock scale available for fumadocs-ui while still layering the exact same
// real token values on top for this app's own components.
//
// No content glob for fumadocs-ui's own components: its shipped CSS (imported in global.css)
// already carries its utility classes via `@source inline(...)`, generated at its own build time
// — verified by reading fumadocs-ui's published css/generated/*.css directly, not assumed.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./content/**/*.mdx"],
  theme: {
    extend: {
      fontFamily: {
        // Same pair as apps/site — see @ferryline/design-tokens' file-level comment for why Space
        // Grotesk/Space Mono over the doc's own recommended substitutes. Registered separately per
        // Next.js app via next/font/google (app/layout.tsx); not part of the shared package since a
        // next/font call can't be shared as an importable value across apps.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "title-2": [
          fontSize["title-2"].size,
          {
            lineHeight: fontSize["title-2"].lineHeight,
            letterSpacing: fontSize["title-2"].letterSpacing,
          },
        ],
        "title-3": [
          fontSize["title-3"].size,
          {
            lineHeight: fontSize["title-3"].lineHeight,
            letterSpacing: fontSize["title-3"].letterSpacing,
          },
        ],
        "text-1": [
          fontSize["text-1"].size,
          {
            lineHeight: fontSize["text-1"].lineHeight,
            letterSpacing: fontSize["text-1"].letterSpacing,
          },
        ],
        "text-2": [
          fontSize["text-2"].size,
          {
            lineHeight: fontSize["text-2"].lineHeight,
            letterSpacing: fontSize["text-2"].letterSpacing,
          },
        ],
        "text-3": [fontSize["text-3"].size, { lineHeight: fontSize["text-3"].lineHeight }],
        "text-4": [fontSize["text-4"].size, { lineHeight: fontSize["text-4"].lineHeight }],
      },
      spacing,
      transitionTimingFunction: {
        1: easing[1],
        2: easing[2],
      },
      transitionDuration: {
        1: duration[1],
        2: duration[2],
        3: duration[3],
        btn: duration.btn,
        "btn-fast": duration.btnFast,
      },
      borderRadius: radius,
      colors: {
        transparent: "transparent",
        current: "currentColor",
        black: "#000000",
        white: "#ffffff",

        "gray-50": gray[50],
        "gray-100": gray[100],
        "gray-200": gray[200],
        "gray-300": gray[300],
        "gray-400": gray[400],
        "gray-500": gray[500],
        "gray-600": gray[600],
        "gray-700": gray[700],
        "gray-800": gray[800],
        "gray-900": gray[900],

        brand: brand.DEFAULT,
        "brand-soft": brand.soft,
        "brand-on-dark": brand.onDark,

        "on-brand": semantic.onBrand,
        "on-surface-dark": semantic.onSurfaceDark,
        "on-surface-soft": semantic.onSurfaceSoft,
        "on-surface-weak": semantic.onSurfaceWeak,
        "on-surface-weaker": semantic.onSurfaceWeaker,
        "on-surface-muted": semantic.onSurfaceMuted,
        "on-surface-light": semantic.onSurfaceLight,
        "on-dark-weak": semantic.onDarkWeak,
      },
    },
  },
  plugins: [],
};

export default config;
