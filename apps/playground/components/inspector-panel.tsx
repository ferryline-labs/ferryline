"use client";

import { type ReactElement, useState } from "react";

import { Badge, Card, CodeBlock } from "@ferryline/ui";
import { cx } from "@ferryline/ui/styles";

import type { CaptureEvent } from "@/lib/inspector-capture";
import type { InspectorSection } from "@/lib/inspector-sections";
import { groupEventsIntoSections } from "@/lib/inspector-sections";
import { useInspectorEvents } from "@/lib/use-inspector-events";

function eventLabel(event: CaptureEvent): string {
  if (event.kind === "phase") return `widget phase: ${event.phase.kind}`;
  if (event.error) return `${event.method} ${event.url} — failed`;
  return `${event.method} ${event.url} — ${event.responseStatus !== undefined ? String(event.responseStatus) : "?"}`;
}

/**
 * A real, live "preview" phase crashed this panel outright before this existed: `JSON.stringify`
 * throws `TypeError: Do not know how to serialize a BigInt`, and a real `WidgetPhase`'s `quote`/
 * `built` genuinely carry `bigint` amounts (`@ferryline/core`'s own `Amount` type is always an
 * integer bigint plus a decimal count, never a float — confirmed directly, not assumed, by this
 * exact crash during a real testnet run). Stringifying to match `Number.prototype.toString()`'s
 * own output, not appending an `n` suffix the way `123n.toString()` would — this is display-only
 * JSON for a human reading the inspector, not data meant to round-trip back through JSON.parse.
 */
function jsonStringifyWithBigInt(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, val: unknown) => (typeof val === "bigint" ? val.toString() : val),
    2,
  );
}

function eventBody(event: CaptureEvent): string {
  if (event.kind === "phase") return jsonStringifyWithBigInt(event.phase);
  const parts: Record<string, unknown> = {};
  if (event.requestBody !== undefined) parts["request"] = event.requestBody;
  if (event.responseBody !== undefined) parts["response"] = event.responseBody;
  if (event.error !== undefined) parts["error"] = event.error;
  return jsonStringifyWithBigInt(parts);
}

function EventRow({ event }: { event: CaptureEvent }): ReactElement {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-text-4 text-on-surface-weak">{eventLabel(event)}</p>
      <div className="mt-1">
        <CodeBlock code={eventBody(event)} ariaLabel={eventLabel(event)} />
      </div>
    </div>
  );
}

/**
 * One collapsible step. Collapsed by default (per the STEP 2 spec: "available for a curious
 * visitor, not forced on a casual one") except the most recently-updated section, which starts
 * open so a visitor watching a live transfer sees the newest real evidence without an extra click.
 */
function CollapsibleSection({
  title,
  events,
  defaultOpen,
}: {
  title: string;
  events: readonly CaptureEvent[];
  defaultOpen: boolean;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-on-surface-weaker py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-text-3 font-medium text-on-surface-dark"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2">
          <Badge>{String(events.length)}</Badge>
          <span
            aria-hidden
            className={cx("transition-transform duration-btn", open && "rotate-90")}
          >
            ›
          </span>
        </span>
      </button>
      {open ? (
        <div className="mt-3">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The section whose OWN latest event is the most recent overall — not just the last section in
 *  groupEventsIntoSections' fixed category order, which is a real, different thing (that order is
 *  "unsigned XDR, submission, ..., final" for readability, not chronological; the Iris fees call
 *  genuinely happens during quoting, before a built transfer's own "preview" phase, so the fixed-
 *  order last section is not reliably the actual most-recently-updated one). Found live: with only
 *  "Unsigned XDR" and "Circle Iris attestation" populated, the fixed order put Iris last even
 *  though the real preview phase event happened after it. */
function findMostRecentSectionId(sections: readonly InspectorSection[]): string | undefined {
  let latestId: string | undefined;
  let latestTimestamp = -Infinity;
  for (const section of sections) {
    for (const event of section.events) {
      if (event.timestamp >= latestTimestamp) {
        latestTimestamp = event.timestamp;
        latestId = section.id;
      }
    }
  }
  return latestId;
}

/**
 * The playground's real protocol inspector: every value below is either a real, fully-typed
 * WidgetPhase captured from the widget's own `[ferryline-widget] phase -> ...` log line, or a real
 * request/response body captured from an actual network call the widget/SDK already made on its
 * own — see lib/inspector-capture.ts's own file comment for exactly which real call families that
 * covers and how each was confirmed, and lib/inspector-sections.ts for how raw events map to the
 * named steps below. Nothing here is placeholder or fabricated content.
 */
export function InspectorPanel(): ReactElement {
  const events = useInspectorEvents();
  const sections = groupEventsIntoSections(events);
  const mostRecentSectionId = findMostRecentSectionId(sections);

  return (
    <Card>
      {/* Light Card wrapping dark CodeBlock content — the same "code on a black panel inside a
          light card" contrast live-demo.tsx's own StatusPanel already establishes, not a new
          "dark card holding dark code blocks" look that would leave every event indistinguishable
          from its own container. */}
      <p className="text-text-4 uppercase text-on-surface-weak">Protocol inspector</p>
      {sections.length === 0 ? (
        <p className="mt-3 text-text-3 text-on-surface-weak">
          Nothing captured yet — start a transfer above. Every step below is the real, actual
          protocol traffic as it happens, not a mock-up.
        </p>
      ) : (
        <div className="mt-3">
          {sections.map((section) => (
            <CollapsibleSection
              key={section.id}
              title={section.title}
              events={section.events}
              defaultOpen={section.id === mostRecentSectionId}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
