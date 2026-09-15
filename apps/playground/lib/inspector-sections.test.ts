import { describe, expect, it } from "vitest";

import type { CaptureEvent } from "./inspector-capture";
import { groupEventsIntoSections } from "./inspector-sections";

function fetchEvent(overrides: Partial<Extract<CaptureEvent, { kind: "fetch" }>>): CaptureEvent {
  return {
    kind: "fetch",
    id: "id",
    timestamp: 0,
    url: "https://example.com",
    method: "GET",
    requestBody: undefined,
    responseStatus: 200,
    responseOk: true,
    responseBody: undefined,
    error: undefined,
    ...overrides,
  };
}

describe("groupEventsIntoSections", () => {
  it("returns no sections for an empty event stream", () => {
    expect(groupEventsIntoSections([])).toEqual([]);
  });

  it("groups a real sendTransaction call (signed XDR in params.transaction) as submission", () => {
    const events: CaptureEvent[] = [
      fetchEvent({
        url: "https://soroban-testnet.stellar.org",
        method: "POST",
        requestBody: {
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: { transaction: "AAAAAgAAAAA=" },
        },
      }),
    ];

    const sections = groupEventsIntoSections(events);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.id).toBe("submission");
    expect(sections[0]?.events).toHaveLength(1);
  });

  it("distinguishes getTransaction polling from sendTransaction submission", () => {
    const events: CaptureEvent[] = [
      fetchEvent({
        method: "POST",
        requestBody: { jsonrpc: "2.0", method: "sendTransaction", params: {} },
      }),
      fetchEvent({
        method: "POST",
        requestBody: { jsonrpc: "2.0", method: "getTransaction", params: {} },
      }),
      fetchEvent({
        method: "POST",
        requestBody: { jsonrpc: "2.0", method: "getTransaction", params: {} },
      }),
    ];

    const sections = groupEventsIntoSections(events);
    const submission = sections.find((s) => s.id === "submission");
    const polling = sections.find((s) => s.id === "confirmation-poll");
    expect(submission?.events).toHaveLength(1);
    expect(polling?.events).toHaveLength(2);
  });

  it("recognizes Iris calls by hostname regardless of sandbox/mainnet", () => {
    const events: CaptureEvent[] = [
      fetchEvent({ url: "https://iris-api-sandbox.circle.com/v2/messages/0?transactionHash=abc" }),
      fetchEvent({ url: "https://iris-api.circle.com/v2/messages/0?transactionHash=abc" }),
    ];

    expect(groupEventsIntoSections(events)[0]?.events).toHaveLength(2);
  });

  it("distinguishes relayer registration (POST) from status polling (GET), inbound and outbound", () => {
    const events: CaptureEvent[] = [
      fetchEvent({ url: "https://relayer.example.com/transfers", method: "POST" }),
      fetchEvent({ url: "https://relayer.example.com/transfers/abc123", method: "GET" }),
      fetchEvent({ url: "https://relayer.example.com/outbound-transfers", method: "POST" }),
      fetchEvent({ url: "https://relayer.example.com/outbound-transfers/xyz789", method: "GET" }),
    ];

    const sections = groupEventsIntoSections(events);
    const registration = sections.find((s) => s.id === "relayer-registration");
    const polling = sections.find((s) => s.id === "relayer-status");
    expect(registration?.events).toHaveLength(2);
    expect(polling?.events).toHaveLength(2);
  });

  it("does not mistake an unrelated fetch for any known section", () => {
    const events: CaptureEvent[] = [fetchEvent({ url: "https://example.com/unrelated" })];
    expect(groupEventsIntoSections(events)).toEqual([]);
  });

  it("groups preview/signing phases as unsigned XDR, and a delivered tracking phase as final", () => {
    const events: CaptureEvent[] = [
      {
        kind: "phase",
        id: "1",
        timestamp: 0,
        phase: {
          kind: "preview",
          quote: {} as never,
          built: { transferId: "t1", rail: "usdc-cctp", steps: [] } as never,
          stepIndex: 0,
        },
      },
      {
        kind: "phase",
        id: "2",
        timestamp: 1,
        phase: {
          kind: "tracking",
          quote: {} as never,
          built: {} as never,
          status: { transferId: "t1", stage: "delivered", updatedAt: 0 } as never,
        },
      },
    ];

    const sections = groupEventsIntoSections(events);
    expect(sections.find((s) => s.id === "unsigned-xdr")?.events).toHaveLength(1);
    expect(sections.find((s) => s.id === "final")?.events).toHaveLength(1);
  });

  it("omits a section entirely once it has no matching events, rather than showing it empty", () => {
    const events: CaptureEvent[] = [
      fetchEvent({ url: "https://iris-api.circle.com/v2/messages/0" }),
    ];
    const sections = groupEventsIntoSections(events);
    expect(sections.map((s) => s.id)).toEqual(["iris"]);
  });
});
