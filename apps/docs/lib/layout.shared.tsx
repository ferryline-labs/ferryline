import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/**
 * Layout options shared by the docs layout (app/docs/layout.tsx) and, if this site ever grows a
 * marketing shell around the docs, any other layout wrapping fumadocs-ui's navigation. Kept in one
 * function, per fumadocs-ui's own convention, rather than repeating the same nav/links object
 * anywhere a layout needs it.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Ferryline",
    },
    links: [
      {
        text: "GitHub",
        url: "https://github.com/ferryline-labs/ferryline",
        external: true,
      },
    ],
  };
}
