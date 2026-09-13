import type { ReactElement } from "react";

import { LINKS } from "@/lib/content";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Mono } from "./ui/mono";
import { Reveal } from "./ui/reveal";
import { Section } from "./ui/section";
import { SectionHeader } from "./ui/section-header";
import { TextLink } from "./ui/text-link";

interface OpenItem {
  key: string;
  title: string;
  effort: string;
  description: string;
}

/**
 * The real, current, dated gap list — the same items VERIFIED.md, THREAT_MODEL.md, and
 * ARCHITECTURE.md track as genuinely open right now, not invented "good first issue" filler. Kept
 * in sync by hand with those documents (they're the source of truth); if one of these resolves,
 * update or remove its row here the same way the docs themselves get a dated revision entry rather
 * than a silent edit.
 *
 * A third item, router per-transfer event emission (Repud.1), was here through 2026-09-12 and was
 * removed 2026-09-13 once THREAT_MODEL.md's own Repud.1 row was updated to "implemented and
 * tested as of STEP 9" — see that file for the real change, not reconstructed from memory here.
 */
const OPEN_ITEMS: readonly OpenItem[] = [
  {
    key: "outbound-relay",
    title: "Outbound CCTP delivery has no relayer",
    effort: "New service",
    description:
      "Stellar → EVM transfers need someone to submit the completing receiveMessage call. Nothing does this automatically today. A design pass, then a build, mirroring the existing inbound relayer.",
  },
  {
    key: "usdt0-c-address",
    title: "Inbound USDT0 to a smart-account recipient",
    effort: "Needs a mainnet run",
    description:
      "Whether the OFT can deliver to a Soroban C-address at all is genuinely untested. Blocked on a funded mainnet operator and a smart account to target, not on code.",
  },
];

function OpenItemCard({ item, index }: { item: OpenItem; index: number }): ReactElement {
  return (
    <Reveal variant="card" index={index}>
      <Card className="h-full">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-text-2 text-on-surface-dark">{item.title}</h3>
          <Badge>{item.effort}</Badge>
        </div>
        <p className="mt-3 text-text-3 text-on-surface-weak">{item.description}</p>
      </Card>
    </Reveal>
  );
}

export function OpenSourceSection(): ReactElement {
  return (
    <Section id="open-source">
      <SectionHeader eyebrow="Open source" title="Open source, on purpose" />

      <Reveal variant="up" index={0} className="mt-10 max-w-4-col">
        <p className="text-text-3 text-on-surface-soft">
          Ferryline is Apache-2.0, and the core SDK and relayer will always be free to self-host. If
          you want to help close a real gap — outbound <Mono>CCTP</Mono> delivery, smart-account
          support for <Mono>USDT0</Mono>, or better docs — the contributing guide lists exactly
          where we need it, with the evidence behind each item.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Button href={LINKS.contributing}>Contributing guide</Button>
          <TextLink href={LINKS.openIssue}>Open an issue</TextLink>
          <TextLink href={LINKS.github} external>
            View repo
          </TextLink>
        </div>
      </Reveal>

      <div className="mt-10 grid grid-cols-3 gap-gutter tablet:grid-cols-1">
        {OPEN_ITEMS.map((item, index) => (
          <OpenItemCard key={item.key} item={item} index={index + 1} />
        ))}
      </div>
    </Section>
  );
}
