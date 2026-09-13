import type { ReactElement } from "react";

import { LINKS } from "@/lib/content";

import { Button } from "./ui/button";
import { Mono } from "./ui/mono";
import { Reveal } from "./ui/reveal";
import { Section } from "./ui/section";
import { SectionHeader } from "./ui/section-header";
import { TextLink } from "./ui/text-link";

export function OpenSourceSection(): ReactElement {
  return (
    <Section id="open-source">
      <SectionHeader eyebrow="Open source" title="Open source, on purpose" />

      <Reveal variant="up" index={0} className="mt-10 max-w-4-col">
        <p className="text-text-3 text-on-surface-soft">
          Ferryline is Apache-2.0, and the core SDK and relayer will always be free to self-host.
          If you want to help close a real gap — outbound <Mono>CCTP</Mono> delivery,
          smart-account support for <Mono>USDT0</Mono>, or better docs — the contributing guide
          lists exactly where we need it, with the evidence behind each item.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Button href={LINKS.contributing}>Contributing guide</Button>
          <TextLink href={LINKS.openIssue}>Open an issue</TextLink>
          <TextLink href={LINKS.github} external>
            View repo
          </TextLink>
        </div>
      </Reveal>
    </Section>
  );
}
