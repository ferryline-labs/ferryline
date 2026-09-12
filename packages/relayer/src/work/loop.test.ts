import type { IrisClient, IrisMessage } from "@ferryline/sdk";
import { describe, expect, it, vi } from "vitest";

import { InMemoryTransferRepository } from "../repo/in-memory-transfers.js";
import type { TransferRow } from "../repo/types.js";
import { InMemorySpendCeiling } from "../spend/ceiling.js";
import { InMemorySpendLog } from "../spend/spend-log.js";
import { RelayerRetryableError } from "./errors.js";
import { runStartupReconciliation, startWorkLoop, type WorkLoopOptions } from "./loop.js";
import type { ReconcileOutcome } from "./reconcile.js";

const FORWARDER = "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T";
const MESSAGE_TRANSMITTER = "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV";

/**
 * These tests exercise work/loop.ts's own responsibility — the long-lived-task-per-row model, the
 * shared concurrency cap, the ceiling gate, startup reconciliation, and abort-on-shutdown — NOT the
 * real Soroban simulation of mint_and_forward or a real Iris server. Where a phase would need that,
 * attestUntilDone/submitUntilDelivered/reconcileAllSubmitting are replaced via `drivers`, a seam
 * loop.ts exposes for exactly this reason (see its own doc comment); production code (main.ts) never
 * sets it. attest.ts/submit.ts/reconcile.ts each have their own dedicated tests for their internals.
 */

class FakeIris implements IrisClient {
  messagesByTx(): Promise<readonly IrisMessage[]> {
    return Promise.resolve([]);
  }
  messagesByNonce(): Promise<readonly IrisMessage[]> {
    throw new Error("not used by these tests");
  }
  fees(): Promise<readonly []> {
    return Promise.resolve([]);
  }
}

function baseOptions(overrides: Partial<WorkLoopOptions> = {}): WorkLoopOptions {
  return {
    repo: new InMemoryTransferRepository(),
    iris: new FakeIris(),
    // Nothing in these tests calls a real RPC method directly: every path that would is replaced via
    // an injected `drivers` fake instead.
    rpc: {} as WorkLoopOptions["rpc"],
    signer: {} as WorkLoopOptions["signer"],
    sponsorAccount: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    networkPassphrase: "Test SDF Network ; September 2015",
    forwarderContractId: FORWARDER,
    messageTransmitterContractId: MESSAGE_TRANSMITTER,
    maxFeeBumpStroops: 10_000_000n,
    spendCeiling: new InMemorySpendCeiling(1_000_000_000n),
    maxDailySpendCeilingStroops: 1_000_000_000n,
    spendLog: new InMemorySpendLog(),
    // Generous defaults: these loop tests are about orchestration (sequencing, the concurrency cap,
    // the ceiling gate, abort/shutdown), not about the rate-limit check itself — that has its own
    // dedicated tests in work/attest.test.ts. A high limit here means no loop test can accidentally
    // trip it as a side effect of registering several rows to the same fake recipient.
    maxTransfersPerRecipient: 1000,
    recipientRateLimitWindowMs: 60_000,
    // Deliberately NOT zero: with pollIntervalMs 0 and a task that resolves/rejects immediately
    // (as several of these fakes do), a phase whose row keeps getting re-listed and re-spawned with
    // no delay between passes spins as fast as the event loop allows, piling up promises/timers
    // without bound until the test aborts it — this genuinely crashed the test worker (OOM) before
    // this was fixed. A few real milliseconds keeps every test's spin rate finite while still being
    // fast enough that `vi.waitFor`'s default polling comfortably observes the behavior in time.
    pollIntervalMs: 5,
    pollMaxIntervalMs: 5,
    maxConcurrentTransfers: 20,
    log: { error: () => undefined, warn: () => undefined, info: () => undefined },
    ...overrides,
  };
}

async function registerPending(
  repo: InMemoryTransferRepository,
  overrides: Partial<Parameters<InMemoryTransferRepository["register"]>[0]> = {},
): Promise<TransferRow> {
  return repo.register({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    rail: "usdc-cctp",
    sourceChain: "ethereum",
    sourceTxHash: "0xabc",
    sourceDomain: 0,
    ...overrides,
  });
}

async function registerAttested(
  repo: InMemoryTransferRepository,
  id: string,
): Promise<TransferRow> {
  const pending = await registerPending(repo, { id, sourceTxHash: `0x${id}` });
  return repo.transition(pending.id, pending.version, "attested", {
    amount: "1000000",
    recipient: "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    irisNonce: "0xnonce",
    irisMessage: "0xmessage",
    irisAttestation: "0xattestation",
    mintRecipient: FORWARDER,
    destinationCaller: FORWARDER,
  });
}

/** A controllable deferred promise, for fakes that need to hang until the test lets them proceed. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("runStartupReconciliation", () => {
  it("counts already-delivered outcomes without calling submitUntilDelivered", async () => {
    const repo = new InMemoryTransferRepository();
    const delivered = await registerPending(repo);
    const submitUntilDelivered = vi.fn();
    const reconcileAllSubmitting = vi.fn((): Promise<readonly ReconcileOutcome[]> =>
      Promise.resolve([{ kind: "already-delivered", row: delivered }]),
    );

    const result = await runStartupReconciliation(
      baseOptions({ repo, drivers: { reconcileAllSubmitting, submitUntilDelivered } }),
    );

    expect(result).toEqual({ alreadyDelivered: 1, resubmitted: 0 });
    expect(submitUntilDelivered).not.toHaveBeenCalled();
  });

  it("hands resubmit outcomes to submitUntilDelivered, exactly the row reconcile returned", async () => {
    const repo = new InMemoryTransferRepository();
    const stuck = await registerPending(repo);
    const submitUntilDelivered = vi.fn(() => Promise.resolve(stuck));
    const reconcileAllSubmitting = vi.fn((): Promise<readonly ReconcileOutcome[]> =>
      Promise.resolve([{ kind: "resubmit", row: stuck }]),
    );

    const result = await runStartupReconciliation(
      baseOptions({ repo, drivers: { reconcileAllSubmitting, submitUntilDelivered } }),
    );

    expect(result).toEqual({ alreadyDelivered: 0, resubmitted: 1 });
    expect(submitUntilDelivered).toHaveBeenCalledWith(stuck, expect.anything());
  });

  it("logs (does not throw) when a resubmit fails, so one stuck transfer cannot crash startup", async () => {
    const repo = new InMemoryTransferRepository();
    const stuck = await registerPending(repo);
    const submitUntilDelivered = vi.fn(() =>
      Promise.reject(new RelayerRetryableError("ceiling exhausted")),
    );
    const reconcileAllSubmitting = vi.fn((): Promise<readonly ReconcileOutcome[]> =>
      Promise.resolve([{ kind: "resubmit", row: stuck }]),
    );
    const errorLog = vi.fn();

    const result = await runStartupReconciliation(
      baseOptions({
        repo,
        drivers: { reconcileAllSubmitting, submitUntilDelivered },
        log: { error: errorLog, warn: () => undefined, info: () => undefined },
      }),
    );

    expect(result).toEqual({ alreadyDelivered: 0, resubmitted: 1 });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(stuck.id));
  });

  it("processes every outcome even when an earlier one fails", async () => {
    const repo = new InMemoryTransferRepository();
    const first = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      sourceTxHash: "0x1",
    });
    const second = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      sourceTxHash: "0x2",
    });
    const submitUntilDelivered = vi.fn((row: TransferRow) =>
      row.id === first.id
        ? Promise.reject(new RelayerRetryableError("nope"))
        : Promise.resolve(second),
    );
    const reconcileAllSubmitting = vi.fn((): Promise<readonly ReconcileOutcome[]> =>
      Promise.resolve([
        { kind: "resubmit", row: first },
        { kind: "resubmit", row: second },
      ]),
    );

    const result = await runStartupReconciliation(
      baseOptions({ repo, drivers: { reconcileAllSubmitting, submitUntilDelivered } }),
    );

    expect(result).toEqual({ alreadyDelivered: 0, resubmitted: 2 });
    expect(submitUntilDelivered).toHaveBeenCalledTimes(2);
  });
});

describe("startWorkLoop: one row stuck in a long poll never blocks another", () => {
  it("a second pending row is picked up and completes while the first is still polling", async () => {
    // This is the exact bug the long-lived-task-per-row redesign fixes: attestUntilDone/
    // submitUntilDelivered poll internally to completion, so a per-pass "call each row, wait for it
    // to return" design would let row A's still-pending call starve row B forever.
    const repo = new InMemoryTransferRepository();
    const stuckRow = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      sourceTxHash: "0x1",
    });
    const quickRow = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
      sourceTxHash: "0x2",
    });

    const stuckGate = deferred<TransferRow>();
    const attestUntilDone = vi.fn((row: TransferRow) =>
      row.id === stuckRow.id ? stuckGate.promise : Promise.resolve(quickRow),
    );

    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({ repo, drivers: { attestUntilDone } }),
      controller.signal,
    );

    // Give both tasks a chance to be spawned: the quick row resolves and gets re-spawned repeatedly
    // (it never leaves `pending` in this fake), the stuck row is called exactly once and then waits.
    await vi.waitFor(() => {
      expect(attestUntilDone).toHaveBeenCalledWith(quickRow, expect.anything(), expect.anything());
      expect(attestUntilDone).toHaveBeenCalledWith(stuckRow, expect.anything(), expect.anything());
    });
    // The stuck row's task must still be exactly one call — proof it is genuinely blocked on
    // stuckGate, not silently retried/duplicated, WHILE the quick row kept being driven around it.
    const stuckCallCount = attestUntilDone.mock.calls.filter(
      ([row]) => row.id === stuckRow.id,
    ).length;
    expect(stuckCallCount).toBe(1);
    const quickCallCountBeforeResolve = attestUntilDone.mock.calls.filter(
      ([row]) => row.id === quickRow.id,
    ).length;
    expect(quickCallCountBeforeResolve).toBeGreaterThan(0);

    stuckGate.resolve(stuckRow);
    controller.abort();
    await loopDone;

    // Still exactly one call for the stuck row even after it resolves and the loop shuts down —
    // it was never spawned a second time while its single task was in flight.
    expect(attestUntilDone.mock.calls.filter(([row]) => row.id === stuckRow.id)).toHaveLength(1);
  });
});

describe("startWorkLoop: concurrency cap", () => {
  it("never has more than maxConcurrentTransfers tasks in flight at once, combined across both phases", async () => {
    const repo = new InMemoryTransferRepository();
    const pendingRows = await Promise.all(
      ["1", "2", "3"].map((n) =>
        registerPending(repo, { id: `01ARZ3NDEKTSV4RRFFQ69G5F${n}A`, sourceTxHash: `0xp${n}` }),
      ),
    );
    await Promise.all(
      ["1", "2", "3"].map((n) => registerAttested(repo, `01ARZ3NDEKTSV4RRFFQ69G5F${n}B`)),
    );

    const gates = new Map<string, ReturnType<typeof deferred<TransferRow>>>();
    let maxObservedInFlight = 0;
    let currentInFlight = 0;

    const track = (row: TransferRow, gate: ReturnType<typeof deferred<TransferRow>>) => {
      currentInFlight += 1;
      maxObservedInFlight = Math.max(maxObservedInFlight, currentInFlight);
      return gate.promise.finally(() => {
        currentInFlight -= 1;
      });
    };

    const attestUntilDone = vi.fn((row: TransferRow) => {
      const gate = deferred<TransferRow>();
      gates.set(row.id, gate);
      return track(row, gate);
    });
    const submitUntilDelivered = vi.fn((row: TransferRow) => {
      const gate = deferred<TransferRow>();
      gates.set(row.id, gate);
      return track(row, gate);
    });

    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({
        repo,
        maxConcurrentTransfers: 4,
        drivers: { attestUntilDone, submitUntilDelivered },
      }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(attestUntilDone.mock.calls.length + submitUntilDelivered.mock.calls.length).toBe(4);
    });
    expect(maxObservedInFlight).toBeLessThanOrEqual(4);

    // Free up two slots; the remaining two rows should then get picked up on a later pass.
    const [firstGate, secondGate] = [...gates.values()];
    firstGate?.resolve(pendingRows[0]!);
    secondGate?.resolve(pendingRows[1]!);

    await vi.waitFor(() => {
      expect(attestUntilDone.mock.calls.length + submitUntilDelivered.mock.calls.length).toBe(6);
    });
    expect(maxObservedInFlight).toBeLessThanOrEqual(4);

    for (const gate of gates.values()) {
      gate.resolve({} as TransferRow);
    }
    controller.abort();
    await loopDone;
  });

  it("never spawns a second task for a row that is already in flight", async () => {
    const repo = new InMemoryTransferRepository();
    const row = await registerPending(repo);
    const gate = deferred<TransferRow>();
    const attestUntilDone = vi.fn(() => gate.promise);

    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({ repo, pollIntervalMs: 0, drivers: { attestUntilDone } }),
      controller.signal,
    );

    // Let several passes happen while the one row's task is still pending.
    await vi.waitFor(() => {
      expect(attestUntilDone.mock.calls.length).toBeGreaterThan(0);
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(attestUntilDone).toHaveBeenCalledTimes(1);
    expect(row.id).toBeTruthy(); // keep the registered row referenced for clarity

    gate.resolve({} as TransferRow);
    controller.abort();
    await loopDone;
  });
});

describe("startWorkLoop: ceiling gate (attested phase only)", () => {
  it("spawns no attested tasks at all while the ceiling is exhausted", async () => {
    const repo = new InMemoryTransferRepository();
    await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA1");
    const submitUntilDelivered = vi.fn();
    const spendCeiling = new InMemorySpendCeiling(1n);
    await spendCeiling.reserve(1n); // spentToday() now == the ceiling: fully consumed, exhausted

    const warnLog = vi.fn();
    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({
        repo,
        spendCeiling,
        maxDailySpendCeilingStroops: 1n,
        drivers: { submitUntilDelivered },
        log: { error: () => undefined, warn: warnLog, info: () => undefined },
      }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(warnLog).toHaveBeenCalledWith(expect.stringContaining("ceiling reached"));
    });
    expect(submitUntilDelivered).not.toHaveBeenCalled();

    controller.abort();
    await loopDone;
  });

  it("resumes spawning attested tasks once the ceiling has room again", async () => {
    const repo = new InMemoryTransferRepository();
    const attested = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA2");
    const submitUntilDelivered = vi.fn(() => Promise.resolve(attested));
    // spentToday() (1n) is below the ceiling (2n): room remains, not exhausted.
    const spendCeiling = new InMemorySpendCeiling(2n);
    await spendCeiling.reserve(1n);

    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({
        repo,
        spendCeiling,
        maxDailySpendCeilingStroops: 2n,
        drivers: { submitUntilDelivered },
      }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(submitUntilDelivered).toHaveBeenCalledWith(
        attested,
        expect.anything(),
        expect.anything(),
      );
    });

    controller.abort();
    await loopDone;
  });

  it("STEP 4: a row that is `attested` when the ceiling is hit stays `attested` — not errored, not failed, not advanced — then resumes and is driven through once the ceiling has room again", async () => {
    // This is the specific end-to-end lifecycle the STEP 4 sign-off asked to be proven: the row's
    // real status in the repository, across a real exhausted-then-recovered ceiling, driving the
    // SAME row both times (not two different rows/mocks for the two halves of the claim).
    const repo = new InMemoryTransferRepository();
    const attested = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA7");
    const spendCeiling = new InMemorySpendCeiling(10n);
    await spendCeiling.reserve(10n); // fully exhausted from the start

    const submitUntilDelivered = vi.fn((row: TransferRow) =>
      repo.transition(row.id, row.version, "submitting", { destinationTxHash: "feedbead" }),
    );
    const warnLog = vi.fn();
    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({
        repo,
        spendCeiling,
        maxDailySpendCeilingStroops: 10n,
        drivers: { submitUntilDelivered },
        log: { error: () => undefined, warn: warnLog, info: () => undefined },
      }),
      controller.signal,
    );

    // Give the loop several passes to prove it is not merely "hasn't gotten to it yet" but is
    // actively, repeatedly declining to start new work while exhausted.
    await vi.waitFor(() => {
      expect(warnLog.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(submitUntilDelivered).not.toHaveBeenCalled();
    let reread = await repo.get(attested.id);
    expect(reread?.status).toBe("attested"); // not errored, not failed, not advanced
    expect(reread?.errorCode).toBeNull();

    // An operator effectively "resets" the ceiling (or the UTC window rolls over) by releasing the
    // reservation — spentToday() drops back below the configured ceiling.
    await spendCeiling.release(10n);

    await vi.waitFor(() => {
      expect(submitUntilDelivered).toHaveBeenCalledWith(
        attested,
        expect.anything(),
        expect.anything(),
      );
    });
    reread = await repo.get(attested.id);
    expect(reread?.status).toBe("submitting"); // the SAME row, now actually driven forward

    controller.abort();
    await loopDone;
  });
});

describe("startWorkLoop: graceful shutdown", () => {
  it("stops spawning new tasks and awaits every in-flight task before resolving", async () => {
    const repo = new InMemoryTransferRepository();
    await registerPending(repo);
    const gate = deferred<TransferRow>();
    let taskStarted = false;
    const attestUntilDone = vi.fn(() => {
      taskStarted = true;
      return gate.promise;
    });

    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({ repo, drivers: { attestUntilDone } }),
      controller.signal,
    );

    await vi.waitFor(() => expect(taskStarted).toBe(true));

    let settledBeforeAbortResolved = false;
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- intentional fire-and-forget probe
    loopDone.then(() => {
      settledBeforeAbortResolved = true;
    });

    controller.abort();
    // startWorkLoop must NOT resolve while the in-flight task is still pending, even after abort.
    await new Promise((r) => setTimeout(r, 20));
    expect(settledBeforeAbortResolved).toBe(false);

    gate.resolve({} as TransferRow);
    await loopDone;
    expect(settledBeforeAbortResolved).toBe(true);
  });

  it("leaves a row that was mid-poll at abort in a clean state the reconciler can resume: still `attested`, no partial write", async () => {
    // Reproduces the exact shutdown scenario the phase-3 sign-off review asked to be tested: a
    // submitUntilDelivered task is aborted while polling for delivery — the one place submit.ts's
    // `signal` is actually consulted (see submit.ts's waitForDelivery) — and the row must be left in
    // a state reconcileSubmitting can resume cleanly on the next startup, not half-written.
    const repo = new InMemoryTransferRepository();
    const attested = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA3");

    // The loop's phase lists this row while it is still `attested` (that is what makes it a
    // candidate to spawn at all). The mock then simulates submitUntilDelivered's own real behavior:
    // it does its real work (build quote, reserve ceiling, write `submitting` WITH a hash, broadcast)
    // — represented here by actually performing that same DB transition — and only THEN reaches the
    // one place submit.ts's `signal` is actually consulted, waitForDelivery's poll, where it hangs
    // until aborted. This reproduces the realistic shape of "aborted mid-task" without asserting
    // anything about the real Soroban simulation (see submit.ts for why that would need a separate,
    // fixture-recorded RPC fake this test does not need).
    let sawAbort = false;
    const submitUntilDelivered = vi.fn(
      async (row: TransferRow, _opts: unknown, signal?: AbortSignal): Promise<TransferRow> => {
        await repo.transition(row.id, row.version, "submitting", { destinationTxHash: "deadbeef" });
        return new Promise<TransferRow>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
      },
    );

    const infoLog = vi.fn();
    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({
        repo,
        drivers: { submitUntilDelivered },
        log: { error: () => undefined, warn: () => undefined, info: infoLog },
      }),
      controller.signal,
    );

    await vi.waitFor(() => expect(submitUntilDelivered).toHaveBeenCalled());
    controller.abort();
    await loopDone;

    expect(sawAbort).toBe(true);
    const reread = await repo.get(attested.id);
    // Left exactly at `submitting` with its hash intact — not reverted, not advanced, not corrupted.
    // This is precisely the state work/reconcile.ts's reconcileSubmitting is built to resume from.
    expect(reread?.status).toBe("submitting");
    expect(reread?.destinationTxHash).toBe("deadbeef");
    expect(infoLog).toHaveBeenCalledWith(expect.stringContaining("aborted"));
  });
});

describe("startWorkLoop: unexpected errors", () => {
  it("removes a row from in-flight tracking and logs loudly when its task throws an unmodeled error", async () => {
    const repo = new InMemoryTransferRepository();
    const row = await registerPending(repo);
    let calls = 0;
    const attestUntilDone = vi.fn((_row: TransferRow, _opts: unknown, signal?: AbortSignal) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("totally unexpected bug"));
      }
      // If the row were stuck in tracking after the first failure, it would never be re-spawned;
      // a second call proves it was removed and picked up again on a later pass. Resolves once
      // aborted (like a real poll would, via `sleep` rejecting) rather than hanging forever, so
      // startWorkLoop's own shutdown wait does not block indefinitely on this fake.
      return new Promise<TransferRow>((resolve) => {
        signal?.addEventListener("abort", () => resolve(row), { once: true });
      });
    });
    const errorLog = vi.fn();

    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({
        repo,
        drivers: { attestUntilDone },
        log: { error: errorLog, warn: () => undefined, info: () => undefined },
      }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(attestUntilDone.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(row.id));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("unexpected error"));

    controller.abort();
    await loopDone;
  });

  it("keeps polling when listByStatus itself throws, instead of crashing the phase", async () => {
    const repo = new InMemoryTransferRepository();
    const originalListByStatus = repo.listByStatus.bind(repo);
    let calls = 0;
    repo.listByStatus = (status) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("db connection reset"));
      }
      return originalListByStatus(status);
    };
    const errorLog = vi.fn();

    const controller = new AbortController();
    const loopDone = startWorkLoop(
      baseOptions({ repo, log: { error: errorLog, warn: () => undefined, info: () => undefined } }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("db connection reset"));
    });
    await vi.waitFor(() => {
      expect(calls).toBeGreaterThan(1); // proves the phase kept going past the thrown error
    });

    controller.abort();
    await loopDone;
  });
});
