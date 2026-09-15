import { defineConfig } from "tsup";

// Two independent builds, not one — found the hard way (a real `next build` of apps/site failed:
// "Attempted to call cx() from the server but cx is on the client"). `Reveal` (src/reveal.tsx) is
// a genuine "use client" component (useState/useEffect/IntersectionObserver), but `cx`/
// `FOCUS_RING`/`FOCUS_RING_ON_DARK` (src/styles.ts) are plain, environment-agnostic functions/
// constants — not components, not hooks. A single bundled dist/index.js can only carry one leading
// directive; marking the WHOLE bundle "use client" doesn't just forgo a server-only optimization
// for the presentational components (an acceptable tradeoff on its own) — it makes `cx` itself
// unusable as a plain function call from a Server Component, since React's "use client" boundary
// rules treat every export of a client module as an opaque reference, not a callable function, the
// moment ANY server-rendered file imports it. So the two are built and exported separately:
// dist/index.js (the component barrel, "use client") and dist/styles.js (plain utilities, no
// directive at all, safe to call from server or client code) — see package.json's `exports` map
// for the two import paths this produces (`@ferryline/ui` and `@ferryline/ui/styles`).
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "es2022",
    dts: true,
    sourcemap: true,
    clean: true,
    banner: { js: '"use client";' },
  },
  {
    entry: { styles: "src/styles.ts" },
    format: ["esm"],
    target: "es2022",
    dts: true,
    sourcemap: true,
    // Does NOT clean: the first config's dist/index.js{,.map,.d.ts} must survive this second build.
    clean: false,
  },
]);
