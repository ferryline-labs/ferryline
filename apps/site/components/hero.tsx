import type { ReactElement } from "react";

import { LINKS } from "@/lib/content";

import { Button } from "./ui/button";
import { Container } from "./ui/container";
import { Mono } from "./ui/mono";
import { Reveal } from "./ui/reveal";
import { TransferPreview } from "./transfer-preview";

/**
 * `height: min(100svh, 1000px)` (the doc's own literal value), dropping to `height: auto` with
 * fixed padding below the `tablet` tier — both taken directly from the doc's own responsive
 * override, not just the desktop rule. `grid-template-columns: 1fr 2fr` with row-gap only (no
 * column gap — the two columns sit flush against each other, exactly as measured) collapses to a
 * single column below `tablet`. The background is the doc's own gradient recipe with Ferryline's
 * brand hue in place of the doc's literal orange (see tailwind.config.ts's file-level comment).
 */
export function Hero(): ReactElement {
  return (
    <div className="relative h-[min(100svh,1000px)] overflow-clip bg-[linear-gradient(0deg,#4F46E5,#eff0f0_50%)] pt-[7.5rem] tablet:h-auto tablet:py-[7.5rem] tablet:pb-[10rem]">
      <Container className="grid h-full grid-cols-[1fr_2fr] items-center gap-y-8 tablet:grid-cols-1">
        <div className="max-w-4-col">
          {/* title-2, not title-0/1: the doc's own type table assigns "every section heading +
              hero H1" to title-2 specifically — the bigger sizes are reserved for a different,
              mid-page emphatic callout this page doesn't have. */}
          <Reveal as="h1" variant="line" index={0} className="text-title-2 font-medium text-black">
            One SDK for USDT0 and USDC.
          </Reveal>
          <Reveal variant="up" index={1} className="mt-6 text-text-2 text-on-surface-soft">
            Ferryline handles the decimals, trustlines, and relaying so your wallet or payout app
            doesn&apos;t have to. Built on the official LayerZero and <Mono>CCTP</Mono> rails.
          </Reveal>
          <Reveal variant="up" index={2} className="mt-8 flex flex-wrap items-center gap-4">
            <Button href={LINKS.docs}>Read the docs</Button>
            <Button href={LINKS.github} variant="light" external>
              View on GitHub
            </Button>
          </Reveal>
        </div>

        <TransferPreview />
      </Container>
    </div>
  );
}
