import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetInstalledForTests,
  clearEvents,
  getEvents,
  installInspectorCapture,
} from "./inspector-capture";

describe("inspector-capture", () => {
  const originalFetch = window.fetch.bind(window);
  const originalLog = console.log.bind(console);

  beforeEach(() => {
    clearEvents();
    __resetInstalledForTests();
  });

  afterEach(() => {
    window.fetch = originalFetch;
    console.log = originalLog;
    vi.restoreAllMocks();
  });

  it("captures a fetch call's URL, method, JSON request body, and JSON response body", async () => {
    window.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "PENDING" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    installInspectorCapture();

    await fetch("https://soroban-testnet.stellar.org", {
      method: "POST",
      headers: { Authorization: "Bearer super-secret-relayer-key" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: { transaction: "AAAA" },
      }),
    });

    const events = getEvents();
    expect(events).toHaveLength(1);
    const event = events[0];
    if (event?.kind !== "fetch") throw new Error("expected a fetch event");
    expect(event.url).toBe("https://soroban-testnet.stellar.org");
    expect(event.method).toBe("POST");
    expect(event.requestBody).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "sendTransaction",
      params: { transaction: "AAAA" },
    });
    expect(event.responseStatus).toBe(200);
    expect(event.responseOk).toBe(true);
    expect(event.responseBody).toEqual({ status: "PENDING" });
  });

  it("never captures the Authorization header value anywhere in the event, even though it was really sent", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    installInspectorCapture();

    await fetch("https://relayer.example.com/transfers", {
      method: "POST",
      headers: {
        Authorization: "Bearer super-secret-relayer-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transferId: "abc" }),
    });

    const event = getEvents()[0];
    // Structural, not a redaction check on rendered output: the event object itself has no
    // `headers` field in its type, so this asserts there is nowhere for the secret to be, not
    // just that this one test happened not to print it.
    expect(event).not.toHaveProperty("headers");
    expect(JSON.stringify(event)).not.toContain("super-secret-relayer-key");
  });

  it("captures a rejected fetch as an error event, not a thrown exception this module swallows", async () => {
    window.fetch = vi.fn().mockRejectedValue(new Error("network down"));
    installInspectorCapture();

    await expect(fetch("https://iris-api-sandbox.circle.com/v2/messages/0")).rejects.toThrow(
      "network down",
    );

    const event = getEvents()[0];
    if (event?.kind !== "fetch") throw new Error("expected a fetch event");
    expect(event.error).toBe("network down");
    expect(event.responseStatus).toBeUndefined();
  });

  it("captures a widget phase transition logged via the real [ferryline-widget] phase line", () => {
    installInspectorCapture();

    console.log("[ferryline-widget] phase -> quoting", { kind: "quoting" });
    console.log("[ferryline-widget] some other diagnostic line", { irrelevant: true });

    const events = getEvents();
    expect(events).toHaveLength(1);
    const event = events[0];
    if (event?.kind !== "phase") throw new Error("expected a phase event");
    expect(event.phase).toEqual({ kind: "quoting" });
  });

  it("is idempotent: installing twice does not double-wrap fetch or double-capture events", async () => {
    window.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    installInspectorCapture();
    installInspectorCapture();

    await fetch("https://example.com");

    expect(getEvents()).toHaveLength(1);
  });
});
