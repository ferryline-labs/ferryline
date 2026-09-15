"use client";

import dynamic from "next/dynamic";

/**
 * `@ferryline/widget`'s own module defines `class FerrylineWidget extends HTMLElement` at the top
 * level (packages/widget/src/index.ts) — importing ANY real (non-type-only) value from it
 * evaluates that class body immediately, which references the global `HTMLElement`. Reproduced
 * directly: a real `next build` crashed prerendering "/" with `ReferenceError: HTMLElement is not
 * defined`, since Next.js still server-renders "use client" components for their initial HTML —
 * "use client" means "also runs on the client," not "never runs on the server."
 *
 * `next/dynamic(..., { ssr: false })` is Next.js's own documented fix for exactly this (a
 * component that depends on a browser-only global) — it defers the import (and therefore
 * @ferryline/widget's module evaluation) entirely to the browser. `ssr: false` is only valid
 * inside a Client Component (confirmed directly in this Next.js version's own bundled docs,
 * app/02-guides/lazy-loading.md — a Server Component throws if it tries this), which is the only
 * reason this one-line wrapper file exists separately from widget-embed.tsx itself: app/page.tsx
 * stays a plain Server Component for its own static shell (Section/SectionHeader), and this is the
 * one Client Component boundary that actually needs the ssr:false option.
 */
export const WidgetEmbedLoader = dynamic(
  () => import("./widget-embed").then((mod) => mod.WidgetEmbed),
  { ssr: false },
);
