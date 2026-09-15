import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import type { ReactElement, ReactNode } from "react";

import { SkipLink } from "@ferryline/ui";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

// A deliberate departure from the doc's own recommended substitute (Inter Tight, a Formular
// stand-in) — a direct request for a more distinctive, "futuristic" feel than a neutral grotesk
// gives. Space Grotesk/Space Mono is a genuinely paired family (same foundry lineage, drawn to
// sit together), used site-wide for exactly the same two roles Inter Tight and IBM Plex Mono
// held: Space Grotesk for every UI/heading role, Space Mono scoped strictly to real code and
// identifiers. Because this pair has its own natural proportions (wider, more geometric than
// Inter Tight), the `title-*` tokens' tracking in tailwind.config.ts reverts to the doc's own
// literal values — the extra -0.01em tightening was specifically an Inter Tight correction and
// doesn't apply here.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});
const spaceMono = Space_Mono({ subsets: ["latin"], weight: "400", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Ferryline",
  description:
    "One SDK for USDT0 and USDC, on and off Stellar. Open source, self-hostable, and verified against real mainnet behavior.",
};

// One theme, no toggle — the reference itself has no dark mode (a fixed light page with one
// black surface, the footer), and this rebuild follows that literally rather than inventing a
// dark-mode inverse the reference gives no values for.
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body className="bg-white text-black">
        <SkipLink />
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
