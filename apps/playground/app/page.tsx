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

      {/* Both columns share one fixed height (720px — a bit taller than the widget's own natural
          empty-state height of 532px, measured directly, to leave room for its longer real states —
          the full review table, the wallet-selector list — before anything needs to scroll) and
          scroll their own overflow internally; neither one's content is allowed to grow the shared
          row. Fixing only one side isn't enough: either side can get long on its own (the inspector
          after 80+ captured polling events; the widget's own wallet-selector list, which alone runs
          to a dozen-plus rows), and grid's default stretch alignment means either one's growth drags
          the other column's height up to match. tablet: reverts to natural stacked height — there's
          no shared row to protect once the columns aren't side by side. */}
      <div className="mt-10 grid grid-cols-2 gap-gutter tablet:grid-cols-1">
        <div className="h-[720px] overflow-y-auto tablet:h-auto tablet:overflow-visible">
          <WidgetEmbedLoader />
          <RetryDelayNote />
        </div>
        <div className="h-[720px] overflow-y-auto tablet:h-auto tablet:overflow-visible">
          <InspectorPanel />
        </div>
      </div>
    </Section>
  );
}
