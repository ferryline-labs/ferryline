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

// Same real design tokens and the same full-replacement style as apps/site's own
// tailwind.config.ts (this app has no third-party Tailwind-consuming component library either, so
// nothing depends on Tailwind's own default scale being reachable) — apps/site, apps/playground,
// and packages/widget all build their own theme from the one shared @ferryline/design-tokens
// source rather than each inventing its own palette/radius/type scale.
//
// Three custom keys below aren't from design-tokens at all — they're required by specific
// @ferryline/ui components and documented in each component's own doc comment:
//   - `screens.mobile-landscape` — Section's responsive padding step.
//   - `extend.maxWidth["6-col"]`/`["4-col"]` — SectionHeader's title cap / general narrow-copy cap.
//   - `extend.keyframes`/`animation["star-movement-top"/"-bottom"]` — StarBorder's glow motion.
// Copied verbatim from apps/site's own tailwind.config.ts (the same three requirements apply
// there); everything else specific to apps/site's own landing page (its hero/footer decorative
// keyframes — logo-loop, globe-spin, flow — and its two custom boxShadow recipes) is left out here
// on purpose: no @ferryline/ui component needs them, and this app has no landing-page hero/footer
// of its own to use them for. Not dropped by oversight — checked directly against every
// packages/ui/src/*.tsx file for a reference to them first.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "../../packages/ui/dist/**/*.js"],
  theme: {
    screens: {
      tablet: { max: "991px" },
      "mobile-landscape": { max: "767px" },
      "mobile-portrait": { max: "479px" },
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
    extend: {
      fontFamily: {
        // Same pair as apps/site — see @ferryline/design-tokens' file-level comment for why Space
        // Grotesk/Space Mono over generic substitutes.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "title-0": [
          fontSize["title-0"].size,
          {
            lineHeight: fontSize["title-0"].lineHeight,
            letterSpacing: fontSize["title-0"].letterSpacing,
          },
        ],
        "title-1": [
          fontSize["title-1"].size,
          {
            lineHeight: fontSize["title-1"].lineHeight,
            letterSpacing: fontSize["title-1"].letterSpacing,
          },
        ],
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
      maxWidth: {
        "4-col": "456px",
        "6-col": "690px",
      },
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
      keyframes: {
        "star-movement-top": {
          "0%": { transform: "translate(0%, 0%)", opacity: "1" },
          "100%": { transform: "translate(100%, 0%)", opacity: "0" },
        },
        "star-movement-bottom": {
          "0%": { transform: "translate(0%, 0%)", opacity: "1" },
          "100%": { transform: "translate(-100%, 0%)", opacity: "0" },
        },
      },
      animation: {
        "star-movement-top": "star-movement-top linear infinite alternate",
        "star-movement-bottom": "star-movement-bottom linear infinite alternate",
      },
    },
  },
  plugins: [],
};

export default config;
