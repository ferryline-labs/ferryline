import type { Config } from "tailwindcss";

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
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
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
      globe: "0 6px 100px 60px rgba(79, 70, 229, 0.30), inset 0 6px 80px 60px rgba(192, 193, 159, 0.35)",
      // A soft brand-tinted lift for the one card that floats directly over the hero's own
      // gradient (see hero.tsx) — a glow layer (indigo, wide, low-opacity) plus a tighter
      // neutral contact layer for grounding. Deliberately one of two shadow recipes on the whole
      // page, not a general elevation utility.
      card: "0 24px 48px -16px rgba(79, 70, 229, 0.25), 0 8px 16px -8px rgba(15, 18, 21, 0.12)",
    },
    // A full replacement: the doc's own radius scale is genuinely just four values, one of them
    // ("10px") doing almost all the work — expressed here as Tailwind's own `DEFAULT` key so the
    // bare `rounded` utility literally means "the site-wide default," matching the doc's framing.
    borderRadius: {
      none: "0",
      DEFAULT: "10px", // r-10 — cards, buttons, images: the default for everything
      xs: "4px", // r-4 — chips, tiny tags
      lg: "20px", // r-20 — rare, large panels
      full: "9999px", // r-round — pills and circles
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      black: "#000000",
      white: "#ffffff",

      // The raw gray ramp, copied verbatim — neutral grays carry no brand identity, so there's no
      // reason to depart from the doc's own values here.
      "gray-50": "#eff0f0",
      "gray-100": "#e2e2e3",
      "gray-200": "#c5c7c8", // the ONLY border/divider color on the page
      "gray-300": "#9da0a3",
      "gray-400": "#888b8e",
      "gray-500": "#75777a",
      "gray-600": "#66696b",
      "gray-700": "#454748",
      "gray-800": "#202020",
      "gray-900": "#0f1215",

      // Ferryline's own brand hue — see the file-level comment for why this departs from the
      // doc's literal orange while everything else in this file doesn't.
      brand: "#4F46E5",
      "brand-soft": "#EEF0FF", // this project's own equivalent of orange-100
      "brand-on-dark": "#818CF8", // brand indigo brightened for use ON black surfaces — the base
      // `brand` value only clears 3.34:1 on black (fails 4.5:1 AA), the same "one hue needs two
      // luminances depending on what it sits on" problem as `on-brand` above, just for accent use
      // rather than fill. Verified: 7.04:1 on black.

      // Semantic roles — the doc's own names, applied to the values above (corrected once, per
      // the file-level comment on `on-surface-weak`).
      "on-brand": "#ffffff", // text ON the solid brand button — see file-level comment
      "on-surface-dark": "#000000", // primary text
      "on-surface-soft": "#454748", // secondary text (gray-700)
      "on-surface-weak": "#66696b", // muted text on light surfaces — corrected, see file-level comment
      "on-surface-weaker": "#c5c7c8", // border color (gray-200)
      "on-surface-muted": "#eff0f0", // light card fill (gray-50)
      "on-surface-light": "#ffffff", // text on dark surfaces
      "on-dark-weak": "#9da0a3", // muted text specifically on the black footer, where the doc's
      // own literal gray-300 passes fine (7.99:1) — kept separate from `on-surface-weak` because
      // that one is corrected for light surfaces and would read too dark on black.
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
      // `:root` unchanged, with line-height and tracking baked in per role (never one constant
      // applied everywhere: 0.88 at the largest size, tightening tracking as size grows). Tracking
      // is the doc's own literal value at every size, unadjusted — the "-0.01em extra for Inter
      // Tight" correction from the earlier build no longer applies now that the display face is
      // Space Grotesk, with its own (wider, more geometric) natural proportions.
      fontSize: {
        "title-0": ["clamp(3.75rem, 3.108rem + 3.21vw, 6rem)", { lineHeight: "0.88", letterSpacing: "-0.07em" }],
        "title-1": ["clamp(3.5rem, 3.072rem + 2.14vw, 5rem)", { lineHeight: "0.95", letterSpacing: "-0.07em" }],
        "title-2": ["clamp(2.5rem, 2.322rem + 0.89vw, 3.125rem)", { lineHeight: "1.1", letterSpacing: "-0.05em" }],
        "title-3": ["clamp(1.125rem, 1.089rem + 0.18vw, 1.25rem)", { lineHeight: "1", letterSpacing: "-0.03em" }],
        "text-1": ["clamp(1.5rem, 1.286rem + 1.07vw, 2.25rem)", { lineHeight: "1.1", letterSpacing: "-0.05em" }],
        "text-2": ["clamp(1.125rem, 1.089rem + 0.18vw, 1.25rem)", { lineHeight: "1.4", letterSpacing: "-0.03em" }],
        "text-3": ["1rem", { lineHeight: "1.32" }],
        "text-4": ["0.75rem", { lineHeight: "1.2" }],
      },
      // The doc's own spacing constants that get reused by name across many files, kept as
      // tokens instead of retyped literals so the one clamp() string lives in one place.
      spacing: {
        gutter: "20px", // the universal grid/card gap
        margin: "clamp(0.75rem, 0.608rem + 0.71vw, 1.25rem)", // page side padding, 12 → 20px
      },
      maxWidth: {
        "4-col": "456px", // hero copy, narrow paragraph blocks
        "6-col": "690px", // every section heading
      },
      // The doc's own two easing curves and five durations — every transition on the page uses
      // one of these, never a sixth value.
      transitionTimingFunction: {
        1: "cubic-bezier(0.17, 0.25, 0.30, 1.00)", // eas-1 — ~95% of all motion
        2: "cubic-bezier(0.00, 0.00, 0.00, 1.00)", // eas-2 — violent ease-out, image settles only
      },
      transitionDuration: {
        1: "1000ms", // slow, big elements
        2: "2000ms", // very slow, ambient
        3: "500ms", // scroll reveals, dropdowns
        btn: "300ms", // hover
        "btn-fast": "150ms", // opacity on hover
      },
      keyframes: {
        "logo-loop": { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-100%)" } },
        "globe-spin": { "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } },
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
