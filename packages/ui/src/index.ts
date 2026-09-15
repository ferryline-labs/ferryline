/**
 * Ferryline's shared React UI primitives — extracted from apps/site (its own already-shipped,
 * already-reviewed component library) so every app rendering this design system (apps/site,
 * apps/playground, and any future one) shares one component source instead of drifting, the same
 * reason @ferryline/design-tokens itself exists. These components consume that same token package
 * for color/radius/spacing/type/motion; a few (Section, SectionHeader, StarBorder) also reference
 * a handful of custom Tailwind keys that live in each *consuming app's own* tailwind.config.ts
 * (custom breakpoints, a maxWidth scale, two keyframe animations) rather than in design-tokens
 * itself — see each component's own doc comment for exactly which key it needs and why it isn't
 * part of the shared token package.
 *
 * This package ships component logic, not compiled CSS: every class name below is a real Tailwind
 * utility string, resolved by whichever app imports and renders these components through THAT
 * app's own Tailwind build — so a consumer's tailwind.config.ts must include this package's
 * compiled output in its own `content` glob or Tailwind's scanner will never see these class names
 * and silently omit them from the generated CSS.
 *
 * `cx`/`FOCUS_RING`/`FOCUS_RING_ON_DARK` are deliberately NOT re-exported from here — import them
 * from `@ferryline/ui/styles` instead. This whole module is built and marked "use client" (see
 * tsup.config.ts's own comment for why), and those three are plain, environment-agnostic functions/
 * constants that a Server Component needs to be able to call directly; re-exporting them from a
 * "use client" module would make that impossible even though nothing about them actually requires
 * a client environment. One canonical import path per symbol, not two.
 */
export { Badge } from "./badge.js";
export { Button } from "./button.js";
export { Card } from "./card.js";
export { CodeBlock } from "./code-block.js";
export { Container } from "./container.js";
export { GridOverlay } from "./grid-overlay.js";
export { type CodeSegment, highlightCode } from "./highlight.js";
export { Mono } from "./mono.js";
export { Reveal } from "./reveal.js";
export { Section } from "./section.js";
export { SectionHeader } from "./section-header.js";
export { SkipLink } from "./skip-link.js";
export { StarBorder } from "./star-border.js";
export { Stepper } from "./stepper.js";
