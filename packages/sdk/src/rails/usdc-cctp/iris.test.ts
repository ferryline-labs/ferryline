import { describe, expect, it, vi } from "vitest";

import { FerrylineError } from "@ferryline/core";

import { FERRYLINE_SDK_USER_AGENT } from "../../version.js";
import { createIrisClient } from "./iris.js";

const BASE = "https://iris-api.example";

function fakeFetch(
  handler: (
    url: string,
    headers: Record<string, string> | undefined,
  ) => { status: number; body: unknown },
) {
  return vi.fn((input: string, init?: { headers?: Record<string, string> }) => {
    const { status, body } = handler(input, init?.headers);
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  });
}

describe("createIrisClient", () => {
  it("sends the Ferryline SDK User-Agent on every request", async () => {
    const seen: (string | undefined)[] = [];
    const fetchFn = fakeFetch((url, headers) => {
      seen.push(headers?.["user-agent"]);
      return { status: 200, body: url.includes("/v2/burn/") ? [] : { messages: [] } };
    });
    const client = createIrisClient(BASE, fetchFn);
    await client.messagesByTx(27, "deadbeef");
    await client.messagesByNonce(27, "0xabc");
    await client.fees(27, 0);
    expect(seen).toEqual([
      FERRYLINE_SDK_USER_AGENT,
      FERRYLINE_SDK_USER_AGENT,
      FERRYLINE_SDK_USER_AGENT,
    ]);
    expect(FERRYLINE_SDK_USER_AGENT).toMatch(/^ferryline-sdk\//);
  });

  it("also sends the accept header alongside user-agent", async () => {
    let headers: Record<string, string> | undefined;
    const fetchFn = fakeFetch((_url, h) => {
      headers = h;
      return { status: 200, body: { messages: [] } };
    });
    await createIrisClient(BASE, fetchFn).messagesByTx(27, "x");
    expect(headers).toMatchObject({
      accept: "application/json",
      "user-agent": FERRYLINE_SDK_USER_AGENT,
    });
  });

  it("treats HTTP 404 as not-yet-indexed (empty list), not an error", async () => {
    const fetchFn = fakeFetch(() => ({
      status: 404,
      body: { error: "Message not found for provided parameters" },
    }));
    const messages = await createIrisClient(BASE, fetchFn).messagesByTx(27, "unknown");
    expect(messages).toEqual([]);
  });

  it("throws FerrylineError on any other non-ok status", async () => {
    const fetchFn = fakeFetch(() => ({ status: 500, body: { error: "boom" } }));
    await expect(createIrisClient(BASE, fetchFn).messagesByTx(27, "x")).rejects.toBeInstanceOf(
      FerrylineError,
    );
    await expect(createIrisClient(BASE, fetchFn).messagesByTx(27, "x")).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });

  it("builds the documented paths for transactionHash, nonce, and fees", async () => {
    const seen: string[] = [];
    const fetchFn = fakeFetch((url) => {
      seen.push(url);
      return { status: 200, body: url.includes("/v2/burn/") ? [] : { messages: [] } };
    });
    const client = createIrisClient(BASE, fetchFn);
    await client.messagesByTx(27, "abc123");
    await client.messagesByNonce(6, "0xdead");
    await client.fees(27, 6);
    expect(seen[0]).toBe(`${BASE}/v2/messages/27?transactionHash=abc123`);
    expect(seen[1]).toBe(`${BASE}/v2/messages/6?nonce=0xdead`);
    expect(seen[2]).toBe(`${BASE}/v2/burn/USDC/fees/27/6`);
  });

  it("rejects a fees response that is not a list", async () => {
    const fetchFn = fakeFetch(() => ({ status: 200, body: { not: "a list" } }));
    await expect(createIrisClient(BASE, fetchFn).fees(27, 6)).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
    });
  });
});
