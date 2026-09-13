import type { ReactElement } from "react";

import { RelayerIcon, RouterIcon, SdkIcon, WidgetIcon } from "./route-icons";
import { Card } from "./ui/card";
import { Reveal } from "./ui/reveal";
import { Section } from "./ui/section";
import { SectionHeader } from "./ui/section-header";

interface Stop {
  name: string;
  description: string;
  Icon: (props: { className: string }) => ReactElement;
}

const STOPS: readonly Stop[] = [
  {
    name: "SDK",
    description:
      "One TypeScript interface for both rails: quote, build, sign, track. The entry point most integrations start from.",
    Icon: SdkIcon,
  },
  {
    name: "Relayer",
    description: "Completes inbound delivery automatically. Self-host it for free.",
    Icon: RelayerIcon,
  },
  {
    name: "Router",
    description:
      "A Soroban contract for one-call and batch cross-chain payouts from your own contracts.",
    Icon: RouterIcon,
  },
  {
    name: "Widget",
    description: "A drop-in deposit-and-withdraw panel. Works in React, Vue, or plain HTML.",
    Icon: WidgetIcon,
  },
];

/**
 * The doc's own "4-up" grid — `repeat(4, 1fr)`, 20px gaps, resolving to 334px columns at the
 * design width — happens to fit Ferryline's four real architecture pieces exactly, one per
 * column, no invented fifth item needed. One card recipe (`Card`, unchanged) for all four: the
 * doc doesn't ask for a different construction per card the way the previous design pass did —
 * "10px is the radius for everything" is the point, one card system reused everywhere.
 */
/**
 * The connecting line, desktop only (`tablet:hidden`) — at the tablet/mobile-landscape tiers the
 * card grid itself reflows to 2 then 1 column (see the grid below), and a left-to-right connector
 * stops meaning anything once the stops are no longer in a single row. Built as its own 4-column
 * grid mirroring the card grid's own column count, not absolutely-positioned magic-number offsets:
 * each cell centers one dot, and a line half-fills each cell from whichever side reaches toward
 * its neighbor, so the dot always lands exactly above its card regardless of gutter width. The
 * two end cells only draw their inward half, so the line starts and ends at the first and last
 * dot rather than running off the section's own edges. Same visual grammar as the hero's transfer
 * connector (`transfer-preview.tsx`): a 1px `bg-on-surface-weaker` line, a small filled `bg-brand`
 * dot at each node.
 */
function RouteConnector(): ReactElement {
  return (
    <div aria-hidden className="mb-3 grid grid-cols-4 gap-gutter tablet:hidden">
      {STOPS.map((_, index) => {
        const isFirst = index === 0;
        const isLast = index === STOPS.length - 1;
        return (
          <div key={index} className="relative flex h-4 items-center justify-center">
            {!isFirst ? (
              <span className="absolute inset-y-1/2 left-0 h-px w-1/2 -translate-y-1/2 bg-on-surface-weaker" />
            ) : null}
            {!isLast ? (
              <span className="absolute inset-y-1/2 right-0 h-px w-1/2 -translate-y-1/2 bg-on-surface-weaker" />
            ) : null}
            <span className="relative h-2 w-2 rounded-full bg-brand" />
          </div>
        );
      })}
    </div>
  );
}

export function RouteArchitecture(): ReactElement {
  return (
    <Section id="architecture">
      <SectionHeader
        eyebrow="Architecture"
        title="How it fits together"
        description="Four pieces. The architecture really is this shape — use one, or all four."
      />

      <div className="mt-10">
        <RouteConnector />
        <div className="grid grid-cols-4 gap-gutter tablet:grid-cols-2 mobile-landscape:grid-cols-1">
          {STOPS.map((stop, index) => (
            <Reveal key={stop.name} variant="card" index={index}>
              <Card className="h-full">
                <stop.Icon className="h-6 w-6 text-on-surface-dark" />
                <h3 className="mt-4 text-text-2 text-on-surface-dark">{stop.name}</h3>
                <p className="mt-2 text-text-3 text-on-surface-weak">{stop.description}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}
