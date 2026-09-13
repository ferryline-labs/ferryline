"use client";

import { type KeyboardEvent, type ReactElement, useState } from "react";

import { EXAMPLE_TRANSFER, TRACK_STAGES } from "@/lib/content";
import { FOCUS_RING, cx } from "@/lib/styles";

import { Card } from "./ui/card";
import { CodeBlock } from "./ui/code-block";
import { Reveal } from "./ui/reveal";
import { Section } from "./ui/section";
import { SectionHeader } from "./ui/section-header";
import { Stepper } from "./ui/stepper";

interface Tab {
  id: string;
  label: string;
  code: string;
}

const TABS = [
  {
    id: "quote",
    label: "Quote",
    code: `import { Ferryline } from "@ferryline/sdk";

const ferryline = new Ferryline({ network: "mainnet" });

const quote = await ferryline.quote({
  asset: "USDC",
  from: { chain: "arbitrum", address: sender },
  to: { chain: "stellar", address: recipient },
  amount: "250.00",
});`,
  },
  {
    id: "build",
    label: "Build & sign",
    code: `const tx = await ferryline.build(quote);
await wallet.signAndSubmit(tx.xdr);`,
  },
  {
    id: "track",
    label: "Track",
    code: `for await (const status of ferryline.track(tx.transferId)) {
  render(status.stage); // submitted -> verified -> delivered
}`,
  },
] as const satisfies readonly Tab[];

type TabId = (typeof TABS)[number]["id"];

/** The artifact next to the code — what each call actually produces, not the code alone. */
function StatusPanel({ tabId }: { tabId: TabId }): ReactElement {
  switch (tabId) {
    case "quote":
      return (
        <Card className="h-full">
          <p className="text-text-4 uppercase text-on-surface-weak">Example quote</p>
          <p className="mt-2 text-text-1 text-on-surface-dark">
            {EXAMPLE_TRANSFER.amount}{" "}
            <span className="text-text-3 text-on-surface-weak">{EXAMPLE_TRANSFER.asset}</span>
          </p>
          <dl className="mt-6 space-y-2 text-text-3">
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-weak">Route</dt>
              <dd className="text-on-surface-dark">
                {EXAMPLE_TRANSFER.from} → {EXAMPLE_TRANSFER.to}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-weak">Fee</dt>
              <dd className="text-on-surface-dark">{EXAMPLE_TRANSFER.fee}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-weak">ETA</dt>
              <dd className="text-on-surface-dark">{EXAMPLE_TRANSFER.eta}</dd>
            </div>
          </dl>
        </Card>
      );
    case "build":
      return (
        <Card className="h-full">
          <p className="text-text-4 uppercase text-on-surface-weak">Signing status</p>
          <div className="mt-4">
            <Stepper
              steps={["built", "awaiting signature", "submitted"]}
              activeStep="awaiting signature"
            />
          </div>
        </Card>
      );
    case "track":
      return (
        <Card className="h-full">
          <p className="text-text-4 uppercase text-on-surface-weak">Transfer status</p>
          <div className="mt-4">
            <Stepper steps={TRACK_STAGES} activeStep="verified" />
          </div>
        </Card>
      );
  }
}

/**
 * A standard WAI-ARIA tabs widget. Tab labels use the brand-underline marker already established
 * for "the current thing" elsewhere on the page (nav's active-link pill, the stepper's active
 * dot) — the doc's own "one accent, one job" restraint, extended to this one piece of real
 * product UI it has no direct equivalent for.
 */
export function LiveDemo(): ReactElement {
  const [activeId, setActiveId] = useState<TabId>(TABS[0].id);
  const activeIndex = TABS.findIndex((tab) => tab.id === activeId);
  const activeTab = TABS[activeIndex] ?? TABS[0];

  const focusTabAt = (index: number): void => {
    const next = TABS[(index + TABS.length) % TABS.length];
    if (!next) return;
    setActiveId(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusTabAt(activeIndex + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusTabAt(activeIndex - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTabAt(0);
        break;
      case "End":
        event.preventDefault();
        focusTabAt(TABS.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <Section id="demo">
      <SectionHeader
        eyebrow="Live demo"
        title="See it in the SDK"
        description="The same three calls carry both rails: quote, build and sign, track."
      />

      <div role="tablist" aria-label="Live SDK demo" className="mt-10 flex gap-2">
        {TABS.map((tab) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              id={`tab-${tab.id}`}
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                setActiveId(tab.id);
              }}
              onKeyDown={handleKeyDown}
              className={cx(
                "relative min-h-11 px-4 text-text-3 transition-colors duration-200",
                selected
                  ? "text-on-surface-dark"
                  : "text-on-surface-weak hover:text-on-surface-dark",
                FOCUS_RING,
              )}
            >
              {tab.label}
              {selected ? (
                <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 bg-brand" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_18rem] gap-gutter tablet:min-h-0 tablet:grid-cols-1 min-h-[17rem]">
        <Reveal
          key={activeTab.id}
          as="div"
          variant="up"
          role="tabpanel"
          id={`panel-${activeTab.id}`}
          aria-labelledby={`tab-${activeTab.id}`}
          tabIndex={0}
          className="min-w-0"
        >
          <CodeBlock code={activeTab.code} ariaLabel={`${activeTab.label} example`} />
        </Reveal>
        <Reveal key={`${activeTab.id}-status`} as="div" variant="up" index={1} className="min-w-0">
          <StatusPanel tabId={activeTab.id} />
        </Reveal>
      </div>
    </Section>
  );
}
