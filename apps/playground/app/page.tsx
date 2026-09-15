import type { ReactElement } from "react";

import { Section, SectionHeader } from "@ferryline/ui";

import { InspectorPanel } from "@/components/inspector-panel";
import { RetryDelayNote } from "@/components/retry-delay-note";
import { WidgetEmbedLoader } from "@/components/widget-embed-loader";

export default function PlaygroundPage(): ReactElement {
  return (
    <Section>
      <SectionHeader
        eyebrow="Playground"
        title="A real, live widget"
        description="The real <ferryline-widget>, on testnet, with a protocol inspector showing the actual XDR/attestation/relayer calls as they happen — not a screen recording."
      />

      <div className="mt-10 grid grid-cols-2 gap-gutter tablet:grid-cols-1">
        <div>
          <WidgetEmbedLoader />
          <RetryDelayNote />
        </div>
        <InspectorPanel />
      </div>
    </Section>
  );
}
