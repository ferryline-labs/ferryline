"use client";

import type { ReactElement } from "react";

import { EXAMPLE_TRANSFER } from "@/lib/content";

import { Card } from "./ui/card";
import { Reveal } from "./ui/reveal";
import { useTransferAmounts } from "./ui/transfer-flow";

const AMOUNT = parseFloat(EXAMPLE_TRANSFER.amount);
const FEE = parseFloat(EXAMPLE_TRANSFER.fee);
// What actually lands at the destination, net of the fee — so the countdown/count-up pair
// reflects the fee being deducted in transit, not the same number appearing twice.
const ARRIVAL = AMOUNT - FEE;

/**
 * The doc's hero right column holds a decorative gradient sphere — Ferryline has no equivalent
 * artwork, so this is the real thing that column's space goes to instead: the same worked
 * transfer example used in the live demo, not a stand-in graphic.
 *
 * `EXAMPLE_TRANSFER.from` is Arbitrum, `.to` is Stellar (see lib/content.ts) — bridging an asset
 * onto Stellar, the more representative direction for the product. From renders on the left, To
 * on the right (plain reading order — no left/right swap here), and the connector's dot travels
 * left to right to match, source to destination.
 *
 * Both chains show their own live number: the source counts down from the full amount, the
 * destination counts up to the net-of-fee arrival amount, driven by one shared progress value
 * (`useTransferAmounts`) so they empty and fill in lockstep — run once on load, not looped (only
 * the dot's own CSS animation repeats) — which is what makes it read as a transfer actually
 * happening, rather than a label sitting next to an unrelated static amount.
 */
export function TransferPreview(): ReactElement {
  const { sourceValue, destValue } = useTransferAmounts({ amount: AMOUNT, arrival: ARRIVAL });

  return (
    <Reveal variant="up" index={3}>
      {/* shadow-card wraps Card from *outside* it, not as Card's own className: Card's className
          now lands on the content div inside StarBorder's `overflow-hidden` wrapper (see
          ui/card.tsx), and a box-shadow there would be clipped away entirely. This outer div sits
          outside that clip boundary, so the shadow actually renders. */}
      <div className="rounded shadow-card">
        <Card>
          <div className="flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-brand" />
            <p className="text-text-4 uppercase text-on-surface-weak">Example quote</p>
          </div>

          {/* min-w-0 on both text columns: flex items default to `min-width: auto`, meaning they
              won't shrink below their own content's min-content size — at `text-text-1` (24–36px)
              "249.58 USDC" has a real min-content width, and on a narrow phone the two columns
              plus the connector's own 3rem floor add up to more than the card's width, forcing
              the whole page wider. min-w-0 lets these columns actually shrink (wrapping their
              text if truly needed) instead of forcing a page-wide horizontal scroll — the same
              fix already used for the code block in live-demo.tsx. */}
          <div className="mt-5 flex items-center gap-4">
            <div className="min-w-0">
              <p className="text-text-4 text-on-surface-weak">From</p>
              <p className="text-text-2 text-on-surface-dark">{EXAMPLE_TRANSFER.from}</p>
              <p className="mt-1 text-text-1 font-medium text-on-surface-dark">
                {sourceValue}{" "}
                <span className="text-text-3 font-normal text-on-surface-weak">
                  {EXAMPLE_TRANSFER.asset}
                </span>
              </p>
            </div>

            <div aria-hidden className="relative h-px min-w-[3rem] flex-1 bg-on-surface-weaker">
              <span className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-brand shadow-[0_0_8px_rgba(79,70,229,0.6)] motion-reduce:hidden animate-flow" />
            </div>

            <div className="min-w-0 text-right">
              <p className="text-text-4 text-on-surface-weak">To</p>
              <p className="text-text-2 text-on-surface-dark">{EXAMPLE_TRANSFER.to}</p>
              <p className="mt-1 text-text-1 font-medium text-on-surface-dark">
                {destValue}{" "}
                <span className="text-text-3 font-normal text-on-surface-weak">
                  {EXAMPLE_TRANSFER.asset}
                </span>
              </p>
            </div>
          </div>

          <dl className="mt-6 flex gap-6 text-text-3">
            <div>
              <dt className="text-on-surface-weak">Fee</dt>
              <dd className="text-on-surface-dark">{EXAMPLE_TRANSFER.fee}</dd>
            </div>
            <div>
              <dt className="text-on-surface-weak">ETA</dt>
              <dd className="text-on-surface-dark">{EXAMPLE_TRANSFER.eta}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </Reveal>
  );
}
