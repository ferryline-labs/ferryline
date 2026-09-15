import type { ReactElement } from "react";

import { Card, Mono, Reveal, Section } from "@ferryline/ui";

function ComparisonCard(): ReactElement {
  return (
    <Card className="grid grid-cols-2 gap-6 tablet:grid-cols-1">
      <div>
        <p className="text-text-4 uppercase text-on-surface-weak">Without Ferryline</p>
        <ul className="mt-3 space-y-3">
          <li className="flex gap-2.5 text-text-3 text-on-surface-weak">
            <span aria-hidden className="mt-0.5 font-mono">
              ×
            </span>
            <span>
              Convert between Stellar&apos;s 7 decimals and everyone else&apos;s 6, by hand
            </span>
          </li>
          <li className="flex gap-2.5 text-text-3 text-on-surface-weak">
            <span aria-hidden className="mt-0.5 font-mono">
              ×
            </span>
            <span>
              Check for a <Mono>USDT0</Mono> trustline yourself before every send
            </span>
          </li>
          <li className="flex gap-2.5 text-text-3 text-on-surface-weak">
            <span aria-hidden className="mt-0.5 font-mono">
              ×
            </span>
            <span>
              Run your own watcher for <Mono>CCTP</Mono> attestations landing on Stellar
            </span>
          </li>
        </ul>
      </div>
      {/* A second background step (white, against the card's own gray-50), not a border — the
          doc's own "only border color on the site" is reserved for the `light` button variant;
          everywhere else, separation is spacing or a background step. */}
      <div className="rounded bg-white p-5">
        <p className="text-text-4 uppercase text-on-surface-weak">With Ferryline</p>
        <ul className="mt-3 space-y-3">
          <li className="flex gap-2.5 text-text-3 text-on-surface-dark">
            <span aria-hidden className="mt-0.5 text-brand">
              ✓
            </span>
            <span>
              <Mono>quote()</Mono> returns amounts already scaled correctly
            </span>
          </li>
          <li className="flex gap-2.5 text-text-3 text-on-surface-dark">
            <span aria-hidden className="mt-0.5 text-brand">
              ✓
            </span>
            <span>
              <Mono>build()</Mono> refuses the send until the trustline check passes
            </span>
          </li>
          <li className="flex gap-2.5 text-text-3 text-on-surface-dark">
            <span aria-hidden className="mt-0.5 text-brand">
              ✓
            </span>
            <span>The relayer watches attestations and submits the mint for you</span>
          </li>
        </ul>
      </div>
    </Card>
  );
}

/**
 * The heading lives *inside* the left column, not in a full-width `SectionHeader` above the grid
 * — see the identical note in verified-section.tsx: with no header description to fill the right
 * side, the heading sat alone above the grid, and the card only started level with the paragraph
 * beneath it, leaving an empty gap at the top right of the section.
 */
export function WhySection(): ReactElement {
  return (
    <Section>
      {/* The doc's own "2-up" grid (688px columns at the design width) — general-purpose, used
          for the feature grid, footer top, and carousel slides alike. */}
      <div className="grid grid-cols-2 items-start gap-gutter tablet:grid-cols-1">
        <div>
          <Reveal
            as="p"
            variant="up"
            className="text-title-3 font-medium uppercase text-on-surface-weak"
          >
            Why
          </Reveal>
          <Reveal
            as="h2"
            variant="line"
            index={1}
            className="mt-2 text-title-2 font-medium text-on-surface-dark"
          >
            Why this exists
          </Reveal>
          <Reveal variant="up" index={2} className="mt-6 text-text-3 text-on-surface-soft">
            Stellar has two official ways to move dollars across chains now: <Mono>USDT0</Mono> over
            LayerZero, and native USDC over Circle&apos;s <Mono>CCTP</Mono>. Both work, but every
            team that wants them inside a real product ends up solving the same problems. Stellar
            uses 7 decimal places; most other chains use 6. A recipient needs a trustline before{" "}
            <Mono>USDT0</Mono> can land, or the transfer fails outright. Inbound <Mono>CCTP</Mono>{" "}
            has no automatic delivery on Stellar; something has to watch for the attestation and
            submit the mint. Ferryline solves each of these once, in the open, so you don&apos;t
            have to solve them again.
          </Reveal>
        </div>

        <Reveal variant="card" index={1}>
          <ComparisonCard />
        </Reveal>
      </div>
    </Section>
  );
}
