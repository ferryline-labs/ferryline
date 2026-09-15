import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import type { ReactElement, ReactNode } from "react";

import { SkipLink } from "@ferryline/ui";

import { PlaygroundFooter } from "@/components/playground-footer";
import { PlaygroundHeader } from "@/components/playground-header";

import "./globals.css";

// Same typeface pair as apps/site and apps/docs — see @ferryline/design-tokens' file-level
// comment for why Space Grotesk/Space Mono over generic substitutes. Registered separately per
// Next.js app (a next/font call can't be shared as an importable value across apps).
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});
const spaceMono = Space_Mono({ subsets: ["latin"], weight: "400", variable: "--font-mono" });

export const metadata: Metadata = {
  metadataBase: new URL("https://playground.ferryline.dev"),
  title: { default: "Ferryline Playground", template: "%s | Ferryline Playground" },
  description:
    "A real, live <ferryline-widget> on testnet CCTP, with a protocol inspector showing the actual XDR/attestation/relayer calls as they happen.",
};

// One theme, no toggle — same choice as apps/site (the reference design has no dark mode to
// invert, and this app has no reason to diverge from that).
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body className="bg-white text-black">
        <SkipLink />
        <PlaygroundHeader />
        <main id="main-content">{children}</main>
        <PlaygroundFooter />
      </body>
    </html>
  );
}
