import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactElement, ReactNode } from "react";

import "./global.css";

// Same typeface pair as apps/site, registered separately per Next.js app (a next/font call can't
// be shared as an importable value across apps) — see @ferryline/design-tokens' file-level
// comment for why Space Grotesk/Space Mono over the doc's own recommended substitutes.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});
const spaceMono = Space_Mono({ subsets: ["latin"], weight: "400", variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://docs.ferryline.dev"),
  title: { default: "Ferryline Docs", template: "%s | Ferryline Docs" },
  description:
    "Reference and guides for @ferryline/sdk, the relayer, the Soroban router, and the widget: everything needed to ship a real USDC/USDT0 bridging integration.",
};

// Real light/dark/system theme switcher (this app only — apps/site and packages/widget keep their
// own separate "no dark mode" choice unchanged, since neither has a dark design to invert).
// Omitting `theme.enabled: false` restores fumadocs-ui's own default RootProvider behavior, which
// already is `defaultTheme: "system", enableSystem: true` (fumadocs-ui/provider/base.js) — the
// exact "default to system" behavior asked for, so nothing further needs configuring here. The
// sidebar's actual light/dark/system toggle UI is enabled via `themeSwitch: { mode:
// "light-dark-system" }` in lib/layout.shared.tsx (fumadocs-ui's toggle defaults to a light/dark-
// only two-icon mode otherwise).
//
// `colorScheme: "light dark"` (rather than pinning "light") lets native browser chrome — scrollbars,
// form controls — follow whichever theme actually resolves. `themeColor` is given both values via a
// media-query array for the same reason (mobile browser UI chrome color); the dark value is
// fumadocs-ui's own real default dark background (`--color-fd-background` in
// fumadocs-ui/css/lib/default-colors.css: hsl(0, 0%, 7.04%) ≈ #121212) since this project has no
// branded dark palette of its own to use instead (see global.css's own theme comment for why).
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121212" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
