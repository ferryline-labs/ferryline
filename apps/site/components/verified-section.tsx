import type { ReactElement } from "react";

import { Reveal } from "./ui/reveal";
import { Section } from "./ui/section";
import { StarBorder } from "./ui/star-border";

const FINDINGS = [
  "CCTP's hook data isn't a 32-byte address the way it looks. It's a length-prefixed string. Assuming otherwise would have permanently stranded funds.",
  "Stellar's smart contract auth model binds to the exact call, not to general authorization. That detail broke a naive batch-transfer design on real testnet, caught before mainnet.",
  "A burn from Stellar is two transactions, not one. The published interface doesn't say so; the deployed contract does.",
];

/**
 * A dark "verification log" panel — a bespoke build rather than the shared `Card`, since a plain
 * black rectangle of run-in text had nothing marking it as a *log* rather than just a dark box:
 * a labeled header (with a status dot, echoing the brand-dot elsewhere on the page) gives it a
 * reason to be black at all, and numbering the findings (rather than a repeated checkmark glyph,
 * which rendered inconsistently across platforms) reads as an audit trail, not a bullet list. The
 * divider under the header is a filled 1px strip, not a `border` utility — the same trick used
 * for every other hairline on the page. Wrapped in `StarBorder` like every other card, since it
 * doesn't go through the shared `Card` component.
 */
function VerificationLog(): ReactElement {
  return (
    <StarBorder className="h-full rounded">
      <div className="h-full rounded bg-black p-6">
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-on-dark" />
          <p className="font-mono text-text-4 uppercase tracking-wide text-on-dark-weak">
            Verification log
          </p>
        </div>
        <div aria-hidden className="mt-4 h-px bg-white/10" />
        <ul className="mt-5 space-y-5">
          {FINDINGS.map((finding, index) => (
            <li key={finding} className="flex gap-4">
              <span className="shrink-0 font-mono text-text-4 text-on-dark-weak">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="font-mono text-text-3 leading-relaxed text-white">{finding}</p>
            </li>
          ))}
        </ul>
      </div>
    </StarBorder>
  );
}

/**
 * The heading lives *inside* the left column here, not in a full-width `SectionHeader` above the
 * grid — with a two-column text/card layout and no header description to fill the right side,
 * putting the heading above the grid left the card starting well below "Verified" with nothing
 * beside it, an empty gap at the top right of the section. Grouping eyebrow + title + paragraph
 * in one column lets the card start at the same row as the heading instead.
 */
export function VerifiedSection(): ReactElement {
  return (
    <Section id="verified">
      <div className="grid grid-cols-2 items-start gap-gutter tablet:grid-cols-1">
        <div>
          <Reveal
            as="p"
            variant="up"
            className="text-title-3 font-medium uppercase text-on-surface-weak"
          >
            Verified
          </Reveal>
          <Reveal as="h2" variant="line" index={1} className="mt-2 text-title-2 font-medium text-on-surface-dark">
            Verified, not assumed
          </Reveal>
          <Reveal variant="up" index={2} className="mt-6 max-w-4-col text-text-3 text-on-surface-soft">
            We don&apos;t assume how Stellar, LayerZero, or Circle behave. Every claim in this
            codebase is either checked against a real deployed contract or marked unverified, in
            the open, in the repo.
          </Reveal>
        </div>

        <Reveal variant="card" index={1}>
          <VerificationLog />
        </Reveal>
      </div>
    </Section>
  );
}
