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

// Ferryline's design system, rebuilt as a literal port of a measured audit of trymeridian.com —
// every name, number, and role below is the doc's own, not a rounded-off guess, with three
// disclosed departures (two forced by contrast math, one a direct style request):
//   1. `brand` is Ferryline's own indigo, not the doc's literal orange — orange is that site's
//      actual brand identity, not a neutral structural choice, so it doesn't carry over the way a
//      radius or duration does. Every gray, every spacing/radius/type/motion number is unchanged.
//   2. `on-brand` (text on the solid brand button) is white, not the doc's literal black — black
//      only clears 3.34:1 on this indigo (fails the 4.5:1 AA floor); white clears 6.29:1. The
//      doc's own choice is *for their hue*, verified in the doc's own text (~6.4:1 black-on-
//      orange) — same reasoning, different number.
//   3. The typeface is Space Grotesk/Space Mono, not the doc's own recommended Inter Tight/IBM
//      Plex Mono substitutes — a direct request for a more distinctive, "futuristic" feel. See
//      the file-level comment in layout.tsx.
// One further correction, not a departure: the doc's own `on-surface-weak` (muted text) role is
// literally `gray-300`, which measures 2.63:1 on white and 2.30:1 on `gray-50` — well under this
// project's 4.5:1 text-contrast gate. `gray-600` (5.53:1 / 4.84:1) is used for that role instead;
// `gray-300` is kept, unedited, for the one place it actually passes — muted text on the black
// footer (7.99:1).
//
// No dark mode: the reference itself has none (one fixed light page, one black surface — the
// footer), so this rebuild doesn't invent one either.
//
// The literal values (colors, radius, easing, duration, type scale, spacing) now live in
// `@ferryline/design-tokens`, a plain-data package with no Tailwind or React dependency —
// `packages/widget/tailwind.config.ts` imports the same object and extends its own theme
// independently. This file still owns everything Tailwind-specific: `screens`, `boxShadow`,
// `fontFamily`, `keyframes`/`animation`, and the actual `theme`/`extend` shape — only the raw
// values moved out.
const config: Config = {
  // `../../packages/ui/dist/**/*.js`: @ferryline/ui ships component logic, not compiled CSS — its
  // real Tailwind utility class name strings only exist inside its own compiled bundle, and
  // Tailwind's JIT scanner only generates CSS for classes it can actually find in a `content`
  // glob. Without this, every class used exclusively inside a @ferryline/ui component (nothing
  // that also happens to appear verbatim in this app's own source) would silently be missing from
  // the generated CSS — no build error, just unstyled output.
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "../../packages/ui/dist/**/*.js"],
  theme: {
    // Webflow's own default breakpoints (max-width, desktop-first) — listed widest-to-narrowest
    // so a later, narrower rule wins the cascade the way a desktop-first stylesheet does.
    screens: {
      tablet: { max: "991px" },
      "mobile-landscape": { max: "767px" },
      "mobile-portrait": { max: "479px" },
    },
    // A full replacement, not `extend`: only these two shadow recipes exist on the whole page
    // (both purely atmospheric, on the footer's decorative globe) — no general elevation scale.
    boxShadow: {
      none: "none",
      globe:
        "0 6px 100px 60px rgba(79, 70, 229, 0.30), inset 0 6px 80px 60px rgba(192, 193, 159, 0.35)",
      // A soft brand-tinted lift for the one card that floats directly over the hero's own
      // gradient (see hero.tsx) — a glow layer (indigo, wide, low-opacity) plus a tighter
      // neutral contact layer for grounding. Deliberately one of two shadow recipes on the whole
      // page, not a general elevation utility.
      card: "0 24px 48px -16px rgba(79, 70, 229, 0.25), 0 8px 16px -8px rgba(15, 18, 21, 0.12)",
    },
    // A full replacement: the doc's own radius scale is genuinely just four values, one of them
    // ("10px") doing almost all the work — expressed here as Tailwind's own `DEFAULT` key so the
    // bare `rounded` utility literally means "the site-wide default," matching the doc's framing.
    borderRadius: radius,
    colors: {
      transparent: "transparent",
      current: "currentColor",
      black: "#000000",
      white: "#ffffff",

      // The raw gray ramp — neutral grays carry no brand identity, so there's no reason to depart
      // from the doc's own values here. Sourced from @ferryline/design-tokens.
      "gray-50": gray[50],
      "gray-100": gray[100],
      "gray-200": gray[200], // the ONLY border/divider color on the page
      "gray-300": gray[300],
      "gray-400": gray[400],
      "gray-500": gray[500],
      "gray-600": gray[600],
      "gray-700": gray[700],
      "gray-800": gray[800],
      "gray-900": gray[900],

      // Ferryline's own brand hue — see the file-level comment for why this departs from the
      // doc's literal orange while everything else in this file doesn't.
      brand: brand.DEFAULT,
      "brand-soft": brand.soft, // this project's own equivalent of orange-100
      "brand-on-dark": brand.onDark, // brand indigo brightened for use ON black surfaces — the
      // base `brand` value only clears 3.34:1 on black (fails 4.5:1 AA), the same "one hue needs
      // two luminances depending on what it sits on" problem as `on-brand` above, just for accent
      // use rather than fill. Verified: 7.04:1 on black.

      // Semantic roles — the doc's own names, applied to the values above (corrected once, per
      // the file-level comment on `on-surface-weak`).
      "on-brand": semantic.onBrand, // text ON the solid brand button — see file-level comment
      "on-surface-dark": semantic.onSurfaceDark, // primary text
      "on-surface-soft": semantic.onSurfaceSoft, // secondary text (gray-700)
      "on-surface-weak": semantic.onSurfaceWeak, // muted text on light surfaces — corrected, see file-level comment
      "on-surface-weaker": semantic.onSurfaceWeaker, // border color (gray-200)
      "on-surface-muted": semantic.onSurfaceMuted, // light card fill (gray-50)
      "on-surface-light": semantic.onSurfaceLight, // text on dark surfaces
      "on-dark-weak": semantic.onDarkWeak, // muted text specifically on the black footer, where the
      // doc's own literal gray-300 passes fine (7.99:1) — kept separate from `on-surface-weak`
      // because that one is corrected for light surfaces and would read too dark on black.
    },
    extend: {
      fontFamily: {
        // A deliberate departure from the doc's own recommended substitute — see the file-level
        // comment in layout.tsx: Space Grotesk/Space Mono in place of Inter Tight/IBM Plex Mono,
        // for a more distinctive, "futuristic" feel than a neutral grotesk gives.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      // The doc's own fluid type ramp, literally — every clamp() below is copied from the doc's
      // `:root` unchanged (via @ferryline/design-tokens), with line-height and tracking baked in
      // per role (never one constant applied everywhere: 0.88 at the largest size, tightening
      // tracking as size grows). Tracking is the doc's own literal value at every size,
      // unadjusted — the "-0.01em extra for Inter Tight" correction from the earlier build no
      // longer applies now that the display face is Space Grotesk, with its own (wider, more
      // geometric) natural proportions.
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
      // The doc's own spacing constants that get reused by name across many files, kept as
      // tokens instead of retyped literals so the one clamp() string lives in one place.
      spacing,
      maxWidth: {
        "4-col": "456px", // hero copy, narrow paragraph blocks
        "6-col": "690px", // every section heading
      },
      // The doc's own two easing curves and five durations — every transition on the page uses
      // one of these, never a sixth value.
      transitionTimingFunction: {
        1: easing[1], // eas-1 — ~95% of all motion
        2: easing[2], // eas-2 — violent ease-out, image settles only
      },
      transitionDuration: {
        1: duration[1], // slow, big elements
        2: duration[2], // very slow, ambient
        3: duration[3], // scroll reveals, dropdowns
        btn: duration.btn, // hover
        "btn-fast": duration.btnFast, // opacity on hover
      },
      keyframes: {
        "logo-loop": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-100%)" },
        },
        "globe-spin": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        // A dot traveling left-to-right along the hero card's connector (source to destination,
        // Arbitrum to Stellar — see transfer-preview.tsx), fading in/out at each end so it never
        // looks like it's teleporting — slow and ambient (2.8s), the same register as the globe
        // spin and logo loop, not a UI micro-interaction. This one loops forever; the card's own
        // count-up/count-down numbers (ui/transfer-flow.tsx) run once and don't use this token.
        flow: {
          "0%": { left: "0%", opacity: "0" },
          "15%": { opacity: "1" },
          "85%": { opacity: "1" },
          "100%": { left: "100%", opacity: "0" },
        },
        // ui/star-border.tsx: two radial-gradient blobs sweeping the top and bottom edges of a
        // card in opposite directions, fading out as they go — an external component, not from
        // the doc, applied by direct request. Names match the original snippet's own
        // `star-movement-top`/`star-movement-bottom` verbatim, not a shortened version of them.
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
        "logo-loop": "logo-loop 20s linear infinite",
        "globe-spin": "globe-spin 80s linear infinite",
        flow: "flow 2.8s ease-in-out infinite",
        "star-movement-top": "star-movement-top linear infinite alternate",
        "star-movement-bottom": "star-movement-bottom linear infinite alternate",
      },
    },
  },
  plugins: [],
};

export default config;
