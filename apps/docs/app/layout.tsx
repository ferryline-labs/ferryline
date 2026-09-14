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

// No dark-mode toggle: matches apps/site's own choice (the reference design has no dark mode to
// invert). fumadocs-ui's RootProvider still needs a theme value; pinning it to "light" keeps the
// two apps' rendered chrome consistent rather than letting fumadocs-ui default to system/dark.
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-white text-black">
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
