/**
 * Groups the raw, chronological capture-event stream into the named steps the panel actually
 * renders. Pure function, no React — a `CaptureEvent[]` in, an ordered list of sections out, each
 * carrying only the events that actually belong to it. Matching is on real, confirmed shapes:
 * Soroban's own JSON-RPC `method` field (params.transaction is where the signed XDR really lives,
 * confirmed directly against @stellar/stellar-sdk's own rpc/jsonrpc.js), the relayer's own real
 * route shapes (POST /transfers(-outbound) for registration, GET .../:id for polling), and Circle
 * Iris's own real hostname.
 */
import type { CaptureEvent } from "./inspector-capture";

export interface InspectorSection {
  readonly id: string;
  readonly title: string;
  readonly events: readonly CaptureEvent[];
}

function isJsonRpcMethod(event: CaptureEvent, method: string): boolean {
  if (event.kind !== "fetch") return false;
  const body = event.requestBody;
  return (
    typeof body === "object" &&
    body !== null &&
    "jsonrpc" in body &&
    "method" in body &&
    (body as { method: unknown }).method === method
  );
}

function isRelayerRoute(
  event: CaptureEvent,
  pathSuffix: "transfers" | "outbound-transfers",
): boolean {
  if (event.kind !== "fetch") return false;
  try {
    const path = new URL(event.url).pathname;
    return path === `/${pathSuffix}` || path.startsWith(`/${pathSuffix}/`);
  } catch {
    return false;
  }
}

function isRelayerRegistration(event: CaptureEvent): boolean {
  return (
    event.kind === "fetch" &&
    event.method === "POST" &&
    (isRelayerRoute(event, "transfers") || isRelayerRoute(event, "outbound-transfers"))
  );
}

function isRelayerStatusPoll(event: CaptureEvent): boolean {
  return (
    event.kind === "fetch" &&
    event.method === "GET" &&
    (isRelayerRoute(event, "transfers") || isRelayerRoute(event, "outbound-transfers"))
  );
}

function isIris(event: CaptureEvent): boolean {
  if (event.kind !== "fetch") return false;
  try {
    return new URL(event.url).hostname.includes("iris-api");
  } catch {
    return false;
  }
}

function isPreviewOrSigningPhase(event: CaptureEvent): boolean {
  return (
    event.kind === "phase" && (event.phase.kind === "preview" || event.phase.kind === "signing")
  );
}

function isFinalPhase(event: CaptureEvent): boolean {
  if (event.kind !== "phase") return false;
  const { phase } = event;
  return phase.kind === "done" || (phase.kind === "tracking" && phase.status.stage === "delivered");
}

const SECTION_DEFS: readonly {
  id: string;
  title: string;
  match: (event: CaptureEvent) => boolean;
}[] = [
  { id: "unsigned-xdr", title: "Unsigned XDR", match: isPreviewOrSigningPhase },
  {
    id: "submission",
    title: "Signed XDR & submission response",
    match: (e) => isJsonRpcMethod(e, "sendTransaction"),
  },
  {
    id: "confirmation-poll",
    title: "On-chain confirmation polling",
    match: (e) => isJsonRpcMethod(e, "getTransaction"),
  },
  { id: "iris", title: "Circle Iris attestation", match: isIris },
  { id: "relayer-registration", title: "Relayer registration", match: isRelayerRegistration },
  { id: "relayer-status", title: "Relayer status polling", match: isRelayerStatusPoll },
  { id: "final", title: "Final on-chain confirmation", match: isFinalPhase },
];

/** Chronological within each section; a section is omitted entirely once it has no events yet
 *  (nothing to expand, nothing misleadingly showing as "empty"). */
export function groupEventsIntoSections(
  events: readonly CaptureEvent[],
): readonly InspectorSection[] {
  return SECTION_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    events: events.filter(def.match),
  })).filter((section) => section.events.length > 0);
}
