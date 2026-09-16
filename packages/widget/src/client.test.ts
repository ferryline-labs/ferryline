import { Buffer } from "buffer";

import { Account, BASE_FEE, Contract, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { Api, type Server } from "@stellar/stellar-sdk/rpc";
import { describe, expect, it, vi } from "vitest";

import {
  isAllowanceInsufficient,
  pollPrepareStep,
  submitStellarTransactionWithRejectionRecheck,
  waitForStellarConfirmation,
} from "./client.js";

const { SUCCESS, NOT_FOUND: NOT_FOUND_STATUS, FAILED } = Api.GetTransactionStatus;

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SENDER = Keypair.random().publicKey();
const TOKEN_MESSENGER = "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP";

type FakeableServer = Pick<Server, "sendTransaction" | "getTransaction">;

/** A real, signed, minimal invoke-contract transaction — same shape used throughout index.test.ts's
 *  own fixtures, not placeholder XDR. `tx.hash()` on the returned object is the real, deterministic
 *  hash the function under test is required to compute independently of anything a fake `Server`
 *  returns. */
function realSignedTransaction(): Parameters<Server["sendTransaction"]>[0] {
  const source = new Account(SENDER, "100");
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(TOKEN_MESSENGER).call("deposit_for_burn"))
    .setTimeout(300)
    .build();
}

const NOT_FOUND: Api.GetMissingTransactionResponse = {
  status: Api.GetTransactionStatus.NOT_FOUND,
  txHash: "unused",
  latestLedger: 1,
  latestLedgerCloseTime: 1,
  oldestLedger: 1,
  oldestLedgerCloseTime: 1,
};

function successResponse(txHash: string): Api.GetSuccessfulTransactionResponse {
  return {
    status: Api.GetTransactionStatus.SUCCESS,
    txHash,
    latestLedger: 1,
    latestLedgerCloseTime: 1,
    oldestLedger: 1,
    oldestLedgerCloseTime: 1,
    ledger: 1,
    createdAt: 1,
    applicationOrder: 1,
    feeBump: false,
    envelopeXdr: {} as Api.GetSuccessfulTransactionResponse["envelopeXdr"],
    resultXdr: {} as Api.GetSuccessfulTransactionResponse["resultXdr"],
    resultMetaXdr: {} as Api.GetSuccessfulTransactionResponse["resultMetaXdr"],
    events: {} as Api.GetSuccessfulTransactionResponse["events"],
  };
}

function rejected(hash: string): Api.SendTransactionResponse {
  return { status: "ERROR", hash, latestLedger: 1, latestLedgerCloseTime: 1 };
}

function accepted(hash: string): Api.SendTransactionResponse {
  return { status: "PENDING", hash, latestLedger: 1, latestLedgerCloseTime: 1 };
}

/** Fake `Server` exposing only what submitStellarTransactionWithRejectionRecheck needs, with
 *  call-count tracking so tests can assert the retry/recheck bound is actually respected. Each
 *  call consumes the next fixture from its list; calling past the end of a list is a test bug. */
function fakeServer(options: {
  readonly sendTransactionResults: readonly Api.SendTransactionResponse[];
  readonly getTransactionResults: readonly Api.GetTransactionResponse[];
}): FakeableServer & { sendTransactionCalls: number; getTransactionCalls: number } {
  let sendIndex = 0;
  let getIndex = 0;
  const counts = { sendTransactionCalls: 0, getTransactionCalls: 0 };
  return {
    ...counts,
    async sendTransaction(): Promise<Api.SendTransactionResponse> {
      counts.sendTransactionCalls += 1;
      const result = options.sendTransactionResults[sendIndex];
      if (!result) {
        throw new Error("fakeServer: sendTransaction called more times than fixtures provided");
      }
      sendIndex += 1;
      return result;
    },
    async getTransaction(): Promise<Api.GetTransactionResponse> {
      counts.getTransactionCalls += 1;
      const result = options.getTransactionResults[getIndex];
      if (!result) {
        throw new Error("fakeServer: getTransaction called more times than fixtures provided");
      }
      getIndex += 1;
      return result;
    },
    get sendTransactionCalls() {
      return counts.sendTransactionCalls;
    },
    get getTransactionCalls() {
      return counts.getTransactionCalls;
    },
  };
}

describe("submitStellarTransactionWithRejectionRecheck", () => {
  it("sendTransaction accepts on the first try: returns the locally-computed hash, never calls getTransaction", async () => {
    const tx = realSignedTransaction();
    const realHash = Buffer.from(tx.hash()).toString("hex");
    const server = fakeServer({
      sendTransactionResults: [accepted(realHash)],
      getTransactionResults: [],
    });

    const hash = await submitStellarTransactionWithRejectionRecheck(server, tx);

    expect(hash).toBe(realHash);
    expect(server.sendTransactionCalls).toBe(1);
    expect(server.getTransactionCalls).toBe(0);
  });

  it("sendTransaction rejects, but getTransaction confirms it landed anyway: returns success, not an error", async () => {
    const tx = realSignedTransaction();
    const realHash = Buffer.from(tx.hash()).toString("hex");
    // The exact reproduced scenario: a real rejection (tx_bad_seq-style), paired with the
    // transaction actually being found on-chain when independently checked.
    const server = fakeServer({
      sendTransactionResults: [rejected("some-untrustworthy-hash-from-the-rejected-response")],
      getTransactionResults: [successResponse(realHash)],
    });

    const hash = await submitStellarTransactionWithRejectionRecheck(
      server,
      tx,
      /* maxAttempts */ 2,
      /* confirmationMaxAttempts */ 5,
      /* confirmationPollIntervalMs */ 1,
    );

    // Must return the LOCALLY-computed hash (from tx.hash()), not whatever sendTransaction's own
    // rejected response happened to carry.
    expect(hash).toBe(realHash);
    expect(server.sendTransactionCalls).toBe(1);
    expect(server.getTransactionCalls).toBe(1);
  });

  it("sendTransaction rejects, not found on the first on-chain recheck, found on a later resubmit: still returns success", async () => {
    const tx = realSignedTransaction();
    const realHash = Buffer.from(tx.hash()).toString("hex");
    const server = fakeServer({
      sendTransactionResults: [rejected(realHash), rejected(realHash)],
      // First rejection's recheck: waitForStellarConfirmation polls once (confirmationMaxAttempts=1
      // below) and times out NOT_FOUND, triggering an outer resubmit. Second rejection's recheck
      // finds it.
      getTransactionResults: [NOT_FOUND, successResponse(realHash)],
    });

    const hash = await submitStellarTransactionWithRejectionRecheck(
      server,
      tx,
      /* maxAttempts */ 3,
      /* confirmationMaxAttempts */ 1,
      /* confirmationPollIntervalMs */ 1,
    );

    expect(hash).toBe(realHash);
    expect(server.sendTransactionCalls).toBe(2);
    expect(server.getTransactionCalls).toBe(2);
  });

  it("genuine failure: rejected AND never found on-chain even after the bounded retries — reports failure", async () => {
    const tx = realSignedTransaction();
    const realHash = Buffer.from(tx.hash()).toString("hex");
    const server = fakeServer({
      sendTransactionResults: [rejected(realHash), rejected(realHash), rejected(realHash)],
      getTransactionResults: [NOT_FOUND, NOT_FOUND, NOT_FOUND],
    });

    await expect(
      submitStellarTransactionWithRejectionRecheck(
        server,
        tx,
        /* maxAttempts */ 3,
        /* confirmationMaxAttempts */ 1,
        /* confirmationPollIntervalMs */ 1,
      ),
    ).rejects.toThrow(/submission rejected/);

    // Bounded: exactly maxAttempts, not fewer (must actually retry) and not more (must actually
    // stop).
    expect(server.sendTransactionCalls).toBe(3);
    expect(server.getTransactionCalls).toBe(3);
  });

  it("a resolved on-chain FAILED status (not just NOT_FOUND) is surfaced as a genuine failure without exhausting the outer retries", async () => {
    const tx = realSignedTransaction();
    const realHash = Buffer.from(tx.hash()).toString("hex");
    const server = fakeServer({
      sendTransactionResults: [rejected(realHash)],
      getTransactionResults: [
        {
          status: Api.GetTransactionStatus.FAILED,
          txHash: realHash,
          latestLedger: 1,
          latestLedgerCloseTime: 1,
          oldestLedger: 1,
          oldestLedgerCloseTime: 1,
          ledger: 1,
          createdAt: 1,
          applicationOrder: 1,
          feeBump: false,
          envelopeXdr: {} as Api.GetFailedTransactionResponse["envelopeXdr"],
          resultXdr: {} as Api.GetFailedTransactionResponse["resultXdr"],
          resultMetaXdr: {} as Api.GetFailedTransactionResponse["resultMetaXdr"],
          events: {} as Api.GetFailedTransactionResponse["events"],
        },
      ],
    });

    await expect(
      submitStellarTransactionWithRejectionRecheck(
        server,
        tx,
        /* maxAttempts */ 3,
        /* confirmationMaxAttempts */ 1,
        /* confirmationPollIntervalMs */ 1,
      ),
    ).rejects.toThrow(/did not succeed: FAILED/);

    // A resolved FAILED is definite, real on-chain state, not ambiguous "not found yet": only one
    // send/recheck pair should happen, not the full outer retry budget.
    expect(server.sendTransactionCalls).toBe(1);
    expect(server.getTransactionCalls).toBe(1);
  });

  it("retries resubmit the SAME signed transaction object, never rebuilding it", async () => {
    const tx = realSignedTransaction();
    const realHash = Buffer.from(tx.hash()).toString("hex");
    const seenTxObjects: unknown[] = [];
    let sendCalls = 0;
    let getCalls = 0;
    const server: FakeableServer = {
      async sendTransaction(t): Promise<Api.SendTransactionResponse> {
        seenTxObjects.push(t);
        sendCalls += 1;
        return sendCalls === 1 ? rejected(realHash) : accepted(realHash);
      },
      async getTransaction(): Promise<Api.GetTransactionResponse> {
        getCalls += 1;
        return NOT_FOUND;
      },
    };

    const hash = await submitStellarTransactionWithRejectionRecheck(
      server,
      tx,
      /* maxAttempts */ 3,
      /* confirmationMaxAttempts */ 1,
      /* confirmationPollIntervalMs */ 1,
    );

    expect(hash).toBe(realHash);
    expect(seenTxObjects).toEqual([tx, tx]);
    expect(getCalls).toBe(1);
  });
});

/**
 * Real regression test for the real bug this phase's own E2E run found: `submitStellarTransaction`
 * originally returned as soon as `sendTransaction` accepted an envelope into the mempool, before
 * ledger confirmation — which caused a real, correct SDK rejection when the widget tried to prepare
 * a deferred step (the burn) that depended on an earlier step's (the approve's) on-chain effect,
 * before that earlier step had actually landed. See
 * packages/core/verified/experiments/2026-09-12-widget-e2e-real-browser-wallet.md for the full,
 * real story (a real Freighter-signed testnet transaction, not a fabricated scenario).
 */
function fakeGetTransactionServer(statuses: readonly Api.GetTransactionStatus[]): {
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
    const server = fakeGetTransactionServer([NOT_FOUND_STATUS, NOT_FOUND_STATUS, SUCCESS]);
    const status = await waitForStellarConfirmation(server, "deadbeef", 10, 1);
    expect(status).toBe(SUCCESS);
    expect(server.getTransaction).toHaveBeenCalledTimes(3);
  });

  it("returns FAILED without throwing — the caller decides what a failure means", async () => {
    const server = fakeGetTransactionServer([NOT_FOUND_STATUS, FAILED]);
    const status = await waitForStellarConfirmation(server, "deadbeef", 10, 1);
    expect(status).toBe(FAILED);
  });

  it("keeps polling past a single NOT_FOUND rather than giving up early", async () => {
    // Regression guard for the exact real bug: an early version effectively treated the FIRST
    // response (always NOT_FOUND immediately after submission) as final, returning before real
    // ledger inclusion. This test fails if that regresses — it demands multiple real polls.
    const server = fakeGetTransactionServer([
      NOT_FOUND_STATUS,
      NOT_FOUND_STATUS,
      NOT_FOUND_STATUS,
      NOT_FOUND_STATUS,
      SUCCESS,
    ]);
    const status = await waitForStellarConfirmation(server, "deadbeef", 10, 1);
    expect(status).toBe(SUCCESS);
    expect(server.getTransaction).toHaveBeenCalledTimes(5);
  });

  it("throws after maxAttempts if the transaction is never found", async () => {
    const server = fakeGetTransactionServer([NOT_FOUND_STATUS]);
    await expect(waitForStellarConfirmation(server, "deadbeef", 3, 1)).rejects.toThrow(
      /not found after/,
    );
    expect(server.getTransaction).toHaveBeenCalledTimes(3);
  });

  it("polls until a non-NOT_FOUND status is returned (rejection-recheck fixture shape)", async () => {
    let calls = 0;
    const server: Pick<Server, "getTransaction"> = {
      async getTransaction(): Promise<Api.GetTransactionResponse> {
        calls += 1;
        return calls < 2 ? NOT_FOUND : successResponse("h");
      },
    };

    const status = await waitForStellarConfirmation(server, "h", 5, 1);

    expect(status).toBe("SUCCESS");
    expect(calls).toBe(2);
  });
});

describe("isAllowanceInsufficient", () => {
  it("is true for a real FerrylineError with code ALLOWANCE_INSUFFICIENT", () => {
    const error = new Error("the TokenMessengerMinter may spend 0.0 USDC but the burn needs 0.5");
    (error as { code?: string }).code = "ALLOWANCE_INSUFFICIENT";
    expect(isAllowanceInsufficient(error)).toBe(true);
  });

  it("is false for a real FerrylineError with a different code (e.g. STEP_NOT_READY)", () => {
    const error = new Error("step 1 is not a deferred step");
    (error as { code?: string }).code = "STEP_NOT_READY";
    expect(isAllowanceInsufficient(error)).toBe(false);
  });

  it("is false for a plain Error with no code at all", () => {
    expect(isAllowanceInsufficient(new Error("network request failed"))).toBe(false);
  });

  it("is false for a non-Error value", () => {
    expect(isAllowanceInsufficient("a plain string rejection")).toBe(false);
    expect(isAllowanceInsufficient({ code: "ALLOWANCE_INSUFFICIENT" })).toBe(false);
    expect(isAllowanceInsufficient(undefined)).toBe(false);
  });
});

describe("pollPrepareStep", () => {
  it("returns the result on the very first attempt when it succeeds immediately", async () => {
    let calls = 0;
    const result = await pollPrepareStep(
      () => {
        calls += 1;
        return Promise.resolve("real-step");
      },
      () => true,
      5,
      1,
    );
    expect(result).toBe("real-step");
    expect(calls).toBe(1);
  });

  it("retries exactly as many times as needed when isRetriable keeps returning true, then succeeds", async () => {
    let calls = 0;
    const result = await pollPrepareStep(
      () => {
        calls += 1;
        if (calls <= 3) {
          return Promise.reject(new Error(`not ready yet, attempt ${String(calls)}`));
        }
        return Promise.resolve("real-step");
      },
      () => true,
      10,
      1,
    );
    expect(result).toBe("real-step");
    expect(calls).toBe(4);
  });

  it("rethrows immediately, without retrying, when isRetriable returns false", async () => {
    let calls = 0;
    const nonRetriable = new Error("a real, non-retriable caller bug");
    await expect(
      pollPrepareStep(
        () => {
          calls += 1;
          return Promise.reject(nonRetriable);
        },
        () => false,
        10,
        1,
      ),
    ).rejects.toThrow(nonRetriable);
    expect(calls).toBe(1);
  });

  it("gives up and rethrows the last real error after maxAttempts if the condition never becomes true", async () => {
    let calls = 0;
    await expect(
      pollPrepareStep(
        () => {
          calls += 1;
          return Promise.reject(new Error(`still not ready, attempt ${String(calls)}`));
        },
        () => true,
        3,
        1,
      ),
    ).rejects.toThrow("still not ready, attempt 3");
    expect(calls).toBe(3);
  });

  it("genuinely waits at least pollIntervalMs between retries — a real elapsed-time assertion, not just a call-order one", async () => {
    let calls = 0;
    const callTimes: number[] = [];
    const INTERVAL_MS = 50;
    await pollPrepareStep(
      () => {
        calls += 1;
        callTimes.push(Date.now());
        if (calls <= 2) {
          return Promise.reject(new Error("not ready"));
        }
        return Promise.resolve("done");
      },
      () => true,
      5,
      INTERVAL_MS,
    );
    expect(callTimes).toHaveLength(3);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(INTERVAL_MS);
    expect(callTimes[2]! - callTimes[1]!).toBeGreaterThanOrEqual(INTERVAL_MS);
  });

  it("only calls isRetriable with the real error that was actually thrown", async () => {
    const seenErrors: unknown[] = [];
    let calls = 0;
    const realError = new Error("real error instance");
    await expect(
      pollPrepareStep(
        () => {
          calls += 1;
          return Promise.reject(realError);
        },
        (error) => {
          seenErrors.push(error);
          return false;
        },
        5,
        1,
      ),
    ).rejects.toThrow(realError);
    expect(seenErrors).toEqual([realError]);
    expect(calls).toBe(1);
  });
});
