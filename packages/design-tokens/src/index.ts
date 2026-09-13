/**
 * Ferryline's design-system values, as plain data.
 *
 * This is NOT a Tailwind config — it imports nothing from `tailwindcss` and has no framework
 * dependency at all (verified: this package's own package.json declares zero dependencies).
 * `apps/site/tailwind.config.ts` and `packages/widget/tailwind.config.ts` each import this object
 * and extend their own `theme` independently — two configs, one value source. Changing a color
 * means editing this file once, not both configs by hand.
 *
 * Every value below is copied verbatim from `apps/site/tailwind.config.ts` (re-read fresh as of
 * this writing, 2026-09-13 — confirmed unchanged from earlier in this project's history). See that
 * file's own header comment for the full provenance (a literal port of a measured audit of
 * trymeridian.com, with three disclosed departures: brand hue, on-brand contrast, typeface). This
 * file does not repeat that history — it only re-homes the *values*, so drop back to that file's
 * comments if you need the "why," not just the "what."
 */

/** The raw gray ramp, copied verbatim from the site's config — no brand identity, so no reason to
 * depart from the doc's own values. */
export const gray = {
  50: "#eff0f0",
  100: "#e2e2e3",
  200: "#c5c7c8", // the ONLY border/divider color on the site
  300: "#9da0a3",
  400: "#888b8e",
  500: "#75777a",
  600: "#66696b",
  700: "#454748",
  800: "#202020",
  900: "#0f1215",
} as const;

/** Ferryline's own brand hue (indigo, not the audited doc's literal orange) and its two
 * luminance-adjusted variants — one hue needs different luminances depending on what surface it
 * sits on to keep AA contrast, so `brand` itself is not reused directly on black or as text. */
export const brand = {
  DEFAULT: "#4F46E5",
  soft: "#EEF0FF", // this project's own equivalent of the doc's orange-100
  onDark: "#818CF8", // brand indigo brightened for use ON black surfaces (7.04:1 on black)
} as const;

/** Semantic text/surface roles, applied to the raw values above. Names match the site's config
 * verbatim (`on-surface-weak` etc., camelCased for plain JS/TS use here). */
export const semantic = {
  onBrand: "#ffffff", // text on the solid brand fill — white, not the doc's literal black (contrast)
  onSurfaceDark: "#000000", // primary text
  onSurfaceSoft: "#454748", // secondary text (gray.700)
  onSurfaceWeak: "#66696b", // muted text on light surfaces (gray.600 — corrected from the doc's gray.300)
  onSurfaceWeaker: "#c5c7c8", // border color (gray.200)
  onSurfaceMuted: "#eff0f0", // light card fill (gray.50)
  onSurfaceLight: "#ffffff", // text on dark surfaces
  onDarkWeak: "#9da0a3", // muted text specifically on black surfaces (gray.300 passes fine there)
} as const;

/** The site's own radius scale — genuinely just four values, `DEFAULT` doing almost all the work. */
export const radius = {
  none: "0",
  DEFAULT: "10px", // cards, buttons, images — the default for everything
  xs: "4px", // chips, tiny tags
  lg: "20px", // rare, large panels
  full: "9999px", // pills and circles
} as const;

/** The site's own two easing curves — every transition on the page uses one of these. */
export const easing = {
  1: "cubic-bezier(0.17, 0.25, 0.30, 1.00)", // eas-1 — ~95% of all motion
  2: "cubic-bezier(0.00, 0.00, 0.00, 1.00)", // eas-2 — violent ease-out, settles only
} as const;

/** The site's own five duration tokens. */
export const duration = {
  1: "1000ms", // slow, big elements
  2: "2000ms", // very slow, ambient
  3: "500ms", // scroll reveals, dropdowns
  btn: "300ms", // hover
  btnFast: "150ms", // opacity on hover
} as const;

/** The site's own fluid type ramp — each clamp() carries its own baked-in line-height and
 * letter-spacing, copied verbatim. Tuned for Space Grotesk/Space Mono's metrics on a full page;
 * a consumer using system fonts (the widget) should treat these as the *shape* of the scale
 * (tracking tightens as size grows) rather than assume identical rendered proportions. */
export const fontSize = {
  "title-0": {
    size: "clamp(3.75rem, 3.108rem + 3.21vw, 6rem)",
    lineHeight: "0.88",
    letterSpacing: "-0.07em",
  },
  "title-1": {
    size: "clamp(3.5rem, 3.072rem + 2.14vw, 5rem)",
    lineHeight: "0.95",
    letterSpacing: "-0.07em",
  },
  "title-2": {
    size: "clamp(2.5rem, 2.322rem + 0.89vw, 3.125rem)",
    lineHeight: "1.1",
    letterSpacing: "-0.05em",
  },
  "title-3": {
    size: "clamp(1.125rem, 1.089rem + 0.18vw, 1.25rem)",
    lineHeight: "1",
    letterSpacing: "-0.03em",
  },
  "text-1": {
    size: "clamp(1.5rem, 1.286rem + 1.07vw, 2.25rem)",
    lineHeight: "1.1",
    letterSpacing: "-0.05em",
  },
  "text-2": {
    size: "clamp(1.125rem, 1.089rem + 0.18vw, 1.25rem)",
    lineHeight: "1.4",
    letterSpacing: "-0.03em",
  },
  "text-3": { size: "1rem", lineHeight: "1.32", letterSpacing: undefined },
  "text-4": { size: "0.75rem", lineHeight: "1.2", letterSpacing: undefined },
} as const;

/** The site's own spacing constants reused by name. */
export const spacing = {
  gutter: "20px",
  margin: "clamp(0.75rem, 0.608rem + 0.71vw, 1.25rem)",
} as const;

/** All tokens, grouped, for a consumer that wants the whole object rather than named imports. */
export const tokens = {
  gray,
  brand,
  semantic,
  radius,
  easing,
  duration,
  fontSize,
  spacing,
} as const;

export type Tokens = typeof tokens;

export default tokens;
