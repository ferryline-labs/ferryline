"use client";

import { use, useId, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { useTheme } from "next-themes";

// Fumadocs' own real, current recommendation (fumadocs.dev/docs/markdown/mermaid, checked
// directly rather than from memory): it has no built-in Mermaid wrapper and recommends this exact
// component, `mermaid` + `next-themes` as real dependencies, and a remark plugin
// (source.config.ts) converting ```mermaid fences into <Mermaid chart="..."/> at build time.
// `useTheme()` is safe to call even though this app disables next-themes' own toggle
// (`RootProvider` gets `theme={{ enabled: false }}` in app/layout.tsx, matching apps/site's own
// no-dark-mode choice) — next-themes' hook returns its default (undefined) `resolvedTheme` with no
// provider mounted, which the ternary below already treats the same as "not dark".
//
// One real departure from Fumadocs' own published snippet: their version gates client-only
// rendering with `useState` + `useEffect(() => setMounted(true), [])`, which is a real,
// synchronous setState-in-an-effect — this project's own `react-hooks/set-state-in-effect` rule
// (hit and fixed the same way earlier, for the site's own reduced-motion detection) flags exactly
// that pattern. `useSyncExternalStore` with a no-op subscribe gets the identical SSR-safe
// server-false/client-true behavior without ever calling setState from an effect body.
function noopSubscribe(): () => void {
  return () => {
    // No-op: nothing to unsubscribe from — the client/server snapshot below never changes after
    // the initial render, so useSyncExternalStore never needs to call this listener at all.
  };
}

function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function Mermaid({ chart }: { chart: string }): ReactElement | undefined {
  const isClient = useIsClient();

  if (!isClient) return undefined;
  return <MermaidContent chart={chart} />;
}

const cache = new Map<string, Promise<unknown>>();

function cachePromise<T>(key: string, setPromise: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached as Promise<T>;

  const promise = setPromise();
  cache.set(key, promise);
  return promise;
}

function MermaidContent({ chart }: { chart: string }): ReactElement {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const { default: mermaid } = use(cachePromise("mermaid", () => import("mermaid")));

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    fontFamily: "inherit",
    themeCSS: "margin: 1.5rem auto 0;",
    theme: resolvedTheme === "dark" ? "dark" : "default",
  });

  const { svg, bindFunctions } = use(
    cachePromise(`${chart}-${String(resolvedTheme)}`, () => {
      return mermaid.render(id, chart.replaceAll("\\n", "\n"));
    }),
  );

  return (
    <div
      ref={(container) => {
        if (container) bindFunctions?.(container);
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
