import type { Config } from "tailwindcss";

import { brand, duration, easing, gray, radius, semantic } from "@ferryline/design-tokens";

// The widget's own Tailwind config — deliberately NOT the same file as apps/site/tailwind.config.ts
// (different build target: this compiles to static CSS text injected into a shadow-DOM <style>
// block, the site's compiles to a linked stylesheet for a full page). Both import the same raw
// values from @ferryline/design-tokens so the two never drift on what "brand" or "radius" mean,
// without being coupled to one literal config file.
//
// Scope is deliberately narrower than the site's: no screens/boxShadow/keyframes/animation the
// widget doesn't use, no fluid clamp() type scale (the widget keeps system fonts — see README —
// so the site's Space-Grotesk-tuned clamp sizes don't carry over verbatim), no `content` globs
// scanning app/ or components/ that don't exist here.
const config: Config = {
  // This is the ONLY source of truth for what Tailwind scans — style.css's own `@import
  // "tailwindcss" source(none)` disables Tailwind v4's automatic filesystem-wide source detection
  // (its real default: confirmed directly that a trivial one-class test file with no @config at
  // all still compiled to 24KB/132 selectors, scanning the whole project tree). Excludes
  // generated-style.ts explicitly: it's this exact build step's own PREVIOUS output (a giant
  // string literal of compiled CSS, written by scripts/build-style.mjs), not real source — without
  // this exclusion a plain glob would have Tailwind re-scanning its own prior output.
  content: ["./src/**/*.{ts,tsx}", "!./src/generated-style.ts"],
  theme: {
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
    },
  },
  plugins: [],
};

export default config;
