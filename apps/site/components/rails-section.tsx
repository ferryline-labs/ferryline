import type { ReactElement } from "react";

import { Badge, Card, Mono, Reveal, Section, SectionHeader } from "@ferryline/ui";

interface Rail {
  key: string;
  title: ReactElement;
  status: string;
  description: string;
}

const RAILS: readonly Rail[] = [
  {
    key: "usdt0",
    title: (
      <>
        <Mono>USDT0</Mono> · LayerZero
      </>
    ),
    status: "Mainnet only",
    description:
      "Live on Stellar since September 2026. Mainnet only for now; no Stellar testnet deployment exists yet upstream.",
  },
  {
    key: "usdc",
    title: (
      <>
        USDC · Circle <Mono>CCTP</Mono>
      </>
    ),
    status: "Live",
    description:
      "Standard Transfer supported both directions. Fast Transfer works into Stellar, not yet out of it — confirmed against real attestations, not assumed.",
  },
];

/** One card recipe, the doc's own — no bespoke anatomy per content type, "10px is the radius for
 * everything" applied literally rather than differentiated by section. */
function RailCard({ rail, index }: { rail: Rail; index: number }): ReactElement {
  return (
    <Reveal variant="card" index={index}>
      <Card className="h-full">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-text-2 text-on-surface-dark">{rail.title}</h3>
          <Badge>{rail.status}</Badge>
        </div>
        <p className="mt-3 text-text-3 text-on-surface-weak">{rail.description}</p>
      </Card>
    </Reveal>
  );
}

export function RailsSection(): ReactElement {
  return (
    <Section id="rails">
      <SectionHeader eyebrow="Rails" title="Two rails, one interface" />
      <div className="mt-10 grid grid-cols-2 gap-gutter tablet:grid-cols-1">
        {RAILS.map((rail, index) => (
          <RailCard key={rail.key} rail={rail} index={index} />
        ))}
      </div>
    </Section>
  );
}
