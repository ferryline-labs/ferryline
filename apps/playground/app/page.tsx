import type { ReactElement } from "react";

import { Section, SectionHeader } from "@ferryline/ui";

/**
 * Scaffold placeholder — the real <ferryline-widget> embed, testnet-only messaging, USDT0
 * exclusion copy, and the protocol inspector panel are the next phase, built on top of this
 * scaffold rather than as part of it. This page exists so the app is a real, buildable,
 * deployable Next.js app right now, not to stand in for the finished playground.
 */
export default function PlaygroundPage(): ReactElement {
  return (
    <Section>
      <SectionHeader
        eyebrow="Playground"
        title="Coming next: a real, live widget"
        description="This page is a scaffold — the actual <ferryline-widget> embed and protocol inspector land in the next pass."
      />
    </Section>
  );
}
