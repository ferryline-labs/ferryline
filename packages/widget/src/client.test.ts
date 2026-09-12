import { Api } from "@stellar/stellar-sdk/rpc";
import { describe, expect, it, vi } from "vitest";

import { waitForStellarConfirmation } from "./client.js";

const { SUCCESS, NOT_FOUND, FAILED } = Api.GetTransactionStatus;

/**
 * Real regression test for the real bug this phase's own E2E run found: `submitStellarTransaction`
 * originally returned as soon as `sendTransaction` accepted an envelope into the mempool, before
 * ledger confirmation — which caused a real, correct SDK rejection when the widget tried to prepare
 * a deferred step (the burn) that depended on an earlier step's (the approve's) on-chain effect,
 * before that earlier step had actually landed. See
 * packages/core/verified/experiments/2026-09-12-widget-e2e-real-browser-wallet.md for the full,
 * real story (a real Freighter-signed testnet transaction, not a fabricated scenario).
 */
function fakeServer(statuses: readonly Api.GetTransactionStatus[]): {
  getTransaction: (hash: string) => Promise<Api.GetTransactionResponse>;
} & {
  getTransaction: ReturnType<typeof vi.fn>;
} {
  let call = 0;
  return {
    getTransaction: vi.fn(() => {
      const status = statuses[Math.min(call, statuses.length - 1)];
      call += 1;
      return Promise.resolve({ status } as Api.GetTransactionResponse);
    }),
  };
}

describe("waitForStellarConfirmation", () => {
  it("returns SUCCESS once the transaction is no longer NOT_FOUND and succeeded", async () => {
    const server = fakeServer([NOT_FOUND, NOT_FOUND, SUCCESS]);
    const status = await waitForStellarConfirmation(server, "deadbeef", 10, 1);
    expect(status).toBe(SUCCESS);
    expect(server.getTransaction).toHaveBeenCalledTimes(3);
  });

  it("returns FAILED without throwing — the caller decides what a failure means", async () => {
    const server = fakeServer([NOT_FOUND, FAILED]);
    const status = await waitForStellarConfirmation(server, "deadbeef", 10, 1);
    expect(status).toBe(FAILED);
  });

  it("keeps polling past a single NOT_FOUND rather than giving up early", async () => {
    // Regression guard for the exact real bug: an early version effectively treated the FIRST
    // response (always NOT_FOUND immediately after submission) as final, returning before real
    // ledger inclusion. This test fails if that regresses — it demands multiple real polls.
    const server = fakeServer([NOT_FOUND, NOT_FOUND, NOT_FOUND, NOT_FOUND, SUCCESS]);
    const status = await waitForStellarConfirmation(server, "deadbeef", 10, 1);
    expect(status).toBe(SUCCESS);
    expect(server.getTransaction).toHaveBeenCalledTimes(5);
  });

  it("throws after maxAttempts if the transaction is never found", async () => {
    const server = fakeServer([NOT_FOUND]);
    await expect(waitForStellarConfirmation(server, "deadbeef", 3, 1)).rejects.toThrow(
      /not found after/,
    );
    expect(server.getTransaction).toHaveBeenCalledTimes(3);
  });
});
