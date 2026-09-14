import type { IrisClient, IrisMessage } from "@ferryline/sdk";
import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { InMemoryOutboundTransferRepository } from "../repo/in-memory-outbound-transfers.js";
import type { OutboundTransferRow } from "../repo/outbound-types.js";
import type { EvmSigner } from "../signer/evm-types.js";
import { InMemoryOutboundSpendCeiling } from "../spend/outbound-ceiling.js";
import { InMemoryOutboundSpendLog } from "../spend/outbound-spend-log.js";
import { OutboundRelayerRetryableError } from "./outbound-errors.js";
import {
  runOutboundStartupReconciliation,
  startOutboundWorkLoop,
  type OutboundWorkLoopOptions,
} from "./outbound-loop.js";
import type { OutboundReconcileOutcome } from "./outbound-reconcile.js";

/**
 * Mirrors loop.test.ts's own structure and coverage exactly, adapted for the outbound direction:
 * the long-lived-task-per-row model, the shared concurrency cap, the ceiling gate, startup
 * reconciliation, and abort-on-shutdown. Not a real EVM simulation or real Iris server — where a
 * phase would need that, attestOutboundUntilDone/submitOutboundUntilDelivered/
 * reconcileAllOutboundSubmitting are replaced via `drivers`, the same seam loop.ts exposes;
 * production code (main.ts) never sets it. outbound-attest.ts/outbound-submit.ts/
 * outbound-reconcile.ts each have their own dedicated tests for their internals.
 */

const MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;
const SEPOLIA = "ethereum-sepolia";

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

function fakeSigner(): EvmSigner {
  const account = privateKeyToAccount(generatePrivateKey());
  return { account, address: () => Promise.resolve(account.address) };
}

function baseOptions(overrides: Partial<OutboundWorkLoopOptions> = {}): OutboundWorkLoopOptions {
  return {
    repo: new InMemoryOutboundTransferRepository(),
    iris: new FakeIris(),
    rpc: {} as OutboundWorkLoopOptions["rpc"],
    signer: fakeSigner(),
    messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
    destinationChain: SEPOLIA,
    maxGasCostWei: 10_000_000_000_000_000n,
    spendCeiling: new InMemoryOutboundSpendCeiling(1_000_000_000_000_000_000n),
    maxDailyGasCeilingWei: 1_000_000_000_000_000_000n,
    spendLog: new InMemoryOutboundSpendLog(),
    maxTransfersPerRecipient: 1000,
    recipientRateLimitWindowMs: 60_000,
    // Same "deliberately not zero" reasoning as loop.test.ts's own baseOptions: a few real
    // milliseconds keeps every test's spin rate finite (see that file's own comment for the OOM
    // this avoided) while staying fast enough for vi.waitFor's default polling.
    pollIntervalMs: 5,
    pollMaxIntervalMs: 5,
    maxConcurrentTransfers: 20,
    log: { error: () => undefined, warn: () => undefined, info: () => undefined },
    ...overrides,
  };
}

async function registerPending(
  repo: InMemoryOutboundTransferRepository,
  overrides: Partial<Parameters<InMemoryOutboundTransferRepository["register"]>[0]> = {},
): Promise<OutboundTransferRow> {
  return repo.register({
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    rail: "usdc-cctp",
    sourceTxHash: "a".repeat(64),
    sourceDomain: 27,
    destinationChain: SEPOLIA,
    ...overrides,
  });
}

async function registerAttested(
  repo: InMemoryOutboundTransferRepository,
  id: string,
): Promise<OutboundTransferRow> {
  const pending = await registerPending(repo, { id, sourceTxHash: id.padEnd(64, "0") });
  return repo.transition(pending.id, pending.version, "attested", {
    amount: "1000000",
    recipient: `0x${"a".repeat(40)}`,
    irisNonce: "0xnonce",
    irisMessage: "0xmessage",
    irisAttestation: "0xattestation",
  });
}

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

describe("runOutboundStartupReconciliation", () => {
  it("counts already-delivered outcomes without calling submitOutboundUntilDelivered", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const delivered = await registerPending(repo);
    const submitOutboundUntilDelivered = vi.fn();
    const reconcileAllOutboundSubmitting = vi.fn((): Promise<readonly OutboundReconcileOutcome[]> =>
      Promise.resolve([{ kind: "already-delivered", row: delivered }]),
    );

    const result = await runOutboundStartupReconciliation(
      baseOptions({
        repo,
        drivers: { reconcileAllOutboundSubmitting, submitOutboundUntilDelivered },
      }),
    );

    expect(result).toEqual({ alreadyDelivered: 1, resubmitted: 0 });
    expect(submitOutboundUntilDelivered).not.toHaveBeenCalled();
  });

  it("hands resubmit outcomes to submitOutboundUntilDelivered, exactly the row reconcile returned", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const stuck = await registerPending(repo);
    const submitOutboundUntilDelivered = vi.fn(() => Promise.resolve(stuck));
    const reconcileAllOutboundSubmitting = vi.fn((): Promise<readonly OutboundReconcileOutcome[]> =>
      Promise.resolve([{ kind: "resubmit", row: stuck }]),
    );

    const result = await runOutboundStartupReconciliation(
      baseOptions({
        repo,
        drivers: { reconcileAllOutboundSubmitting, submitOutboundUntilDelivered },
      }),
    );

    expect(result).toEqual({ alreadyDelivered: 0, resubmitted: 1 });
    expect(submitOutboundUntilDelivered).toHaveBeenCalledWith(stuck, expect.anything());
  });

  it("logs (does not throw) when a resubmit fails, so one stuck transfer cannot crash startup", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const stuck = await registerPending(repo);
    const submitOutboundUntilDelivered = vi.fn(() =>
      Promise.reject(new OutboundRelayerRetryableError("ceiling exhausted")),
    );
    const reconcileAllOutboundSubmitting = vi.fn((): Promise<readonly OutboundReconcileOutcome[]> =>
      Promise.resolve([{ kind: "resubmit", row: stuck }]),
    );
    const errorLog = vi.fn();

    const result = await runOutboundStartupReconciliation(
      baseOptions({
        repo,
        drivers: { reconcileAllOutboundSubmitting, submitOutboundUntilDelivered },
        log: { error: errorLog, warn: () => undefined, info: () => undefined },
      }),
    );

    expect(result).toEqual({ alreadyDelivered: 0, resubmitted: 1 });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(stuck.id));
  });
});

describe("startOutboundWorkLoop: one row stuck in a long poll never blocks another", () => {
  it("a second pending row is picked up and completes while the first is still polling", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const stuckRow = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA1",
      sourceTxHash: "1".padEnd(64, "0"),
    });
    const quickRow = await registerPending(repo, {
      id: "01ARZ3NDEKTSV4RRFFQ69G5FA2",
      sourceTxHash: "2".padEnd(64, "0"),
    });

    const stuckGate = deferred<OutboundTransferRow>();
    const attestOutboundUntilDone = vi.fn((row: OutboundTransferRow) =>
      row.id === stuckRow.id ? stuckGate.promise : Promise.resolve(quickRow),
    );

    const controller = new AbortController();
    const loopDone = startOutboundWorkLoop(
      baseOptions({ repo, drivers: { attestOutboundUntilDone } }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(attestOutboundUntilDone).toHaveBeenCalledWith(
        quickRow,
        expect.anything(),
        expect.anything(),
      );
      expect(attestOutboundUntilDone).toHaveBeenCalledWith(
        stuckRow,
        expect.anything(),
        expect.anything(),
      );
    });
    const stuckCallCount = attestOutboundUntilDone.mock.calls.filter(
      ([row]) => row.id === stuckRow.id,
    ).length;
    expect(stuckCallCount).toBe(1);

    stuckGate.resolve(stuckRow);
    controller.abort();
    await loopDone;

    expect(
      attestOutboundUntilDone.mock.calls.filter(([row]) => row.id === stuckRow.id),
    ).toHaveLength(1);
  });
});

describe("startOutboundWorkLoop: concurrency cap", () => {
  it("never has more than maxConcurrentTransfers tasks in flight at once, combined across both phases", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    await Promise.all(
      ["1", "2", "3"].map((n) =>
        registerPending(repo, {
          id: `01ARZ3NDEKTSV4RRFFQ69G5F${n}A`,
          sourceTxHash: `p${n}`.padEnd(64, "0"),
        }),
      ),
    );
    await Promise.all(
      ["1", "2", "3"].map((n) => registerAttested(repo, `01ARZ3NDEKTSV4RRFFQ69G5F${n}B`)),
    );

    const gates = new Map<string, ReturnType<typeof deferred<OutboundTransferRow>>>();
    let maxObservedInFlight = 0;
    let currentInFlight = 0;

    const track = (gate: ReturnType<typeof deferred<OutboundTransferRow>>) => {
      currentInFlight += 1;
      maxObservedInFlight = Math.max(maxObservedInFlight, currentInFlight);
      return gate.promise.finally(() => {
        currentInFlight -= 1;
      });
    };

    const attestOutboundUntilDone = vi.fn((row: OutboundTransferRow) => {
      const gate = deferred<OutboundTransferRow>();
      gates.set(row.id, gate);
      return track(gate);
    });
    const submitOutboundUntilDelivered = vi.fn((row: OutboundTransferRow) => {
      const gate = deferred<OutboundTransferRow>();
      gates.set(row.id, gate);
      return track(gate);
    });

    const controller = new AbortController();
    const loopDone = startOutboundWorkLoop(
      baseOptions({
        repo,
        maxConcurrentTransfers: 4,
        drivers: { attestOutboundUntilDone, submitOutboundUntilDelivered },
      }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(
        attestOutboundUntilDone.mock.calls.length + submitOutboundUntilDelivered.mock.calls.length,
      ).toBe(4);
    });
    expect(maxObservedInFlight).toBeLessThanOrEqual(4);

    const [firstGate, secondGate] = [...gates.values()];
    firstGate?.resolve({} as OutboundTransferRow);
    secondGate?.resolve({} as OutboundTransferRow);

    await vi.waitFor(() => {
      expect(
        attestOutboundUntilDone.mock.calls.length + submitOutboundUntilDelivered.mock.calls.length,
      ).toBe(6);
    });
    expect(maxObservedInFlight).toBeLessThanOrEqual(4);

    for (const gate of gates.values()) {
      gate.resolve({} as OutboundTransferRow);
    }
    controller.abort();
    await loopDone;
  });

  it("never spawns a second task for a row that is already in flight", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    await registerPending(repo);
    const gate = deferred<OutboundTransferRow>();
    const attestOutboundUntilDone = vi.fn(() => gate.promise);

    const controller = new AbortController();
    const loopDone = startOutboundWorkLoop(
      baseOptions({ repo, pollIntervalMs: 0, drivers: { attestOutboundUntilDone } }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(attestOutboundUntilDone.mock.calls.length).toBeGreaterThan(0);
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(attestOutboundUntilDone).toHaveBeenCalledTimes(1);

    gate.resolve({} as OutboundTransferRow);
    controller.abort();
    await loopDone;
  });
});

describe("startOutboundWorkLoop: ceiling gate (attested phase only)", () => {
  it("spawns no attested tasks at all while the ceiling is exhausted", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA1");
    const submitOutboundUntilDelivered = vi.fn();
    const spendCeiling = new InMemoryOutboundSpendCeiling(1n);
    await spendCeiling.reserve(SEPOLIA, 1n);

    const warnLog = vi.fn();
    const controller = new AbortController();
    const loopDone = startOutboundWorkLoop(
      baseOptions({
        repo,
        spendCeiling,
        maxDailyGasCeilingWei: 1n,
        drivers: { submitOutboundUntilDelivered },
        log: { error: () => undefined, warn: warnLog, info: () => undefined },
      }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(warnLog).toHaveBeenCalledWith(expect.stringContaining("ceiling reached"));
    });
    expect(submitOutboundUntilDelivered).not.toHaveBeenCalled();

    controller.abort();
    await loopDone;
  });

  it("STEP 4: a row that is `attested` when the ceiling is hit stays `attested` — not errored, not failed, not advanced — then resumes and is driven through once the ceiling has room again", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const attested = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA7");
    const spendCeiling = new InMemoryOutboundSpendCeiling(10n);
    await spendCeiling.reserve(SEPOLIA, 10n); // fully exhausted from the start

    const submitOutboundUntilDelivered = vi.fn((row: OutboundTransferRow) =>
      repo.transition(row.id, row.version, "submitting", { destinationTxHash: "0xfeedbead" }),
    );
    const warnLog = vi.fn();
    const controller = new AbortController();
    const loopDone = startOutboundWorkLoop(
      baseOptions({
        repo,
        spendCeiling,
        maxDailyGasCeilingWei: 10n,
        drivers: { submitOutboundUntilDelivered },
        log: { error: () => undefined, warn: warnLog, info: () => undefined },
      }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(warnLog.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(submitOutboundUntilDelivered).not.toHaveBeenCalled();
    let reread = await repo.get(attested.id);
    expect(reread?.status).toBe("attested");
    expect(reread?.errorCode).toBeNull();

    await spendCeiling.release(SEPOLIA, 10n);

    await vi.waitFor(() => {
      expect(submitOutboundUntilDelivered).toHaveBeenCalledWith(
        attested,
        expect.anything(),
        expect.anything(),
      );
    });
    reread = await repo.get(attested.id);
    expect(reread?.status).toBe("submitting");

    controller.abort();
    await loopDone;
  });
});

describe("startOutboundWorkLoop: graceful shutdown", () => {
  it("stops spawning new tasks and awaits every in-flight task before resolving", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    await registerPending(repo);
    const gate = deferred<OutboundTransferRow>();
    let taskStarted = false;
    const attestOutboundUntilDone = vi.fn(() => {
      taskStarted = true;
      return gate.promise;
    });

    const controller = new AbortController();
    const loopDone = startOutboundWorkLoop(
      baseOptions({ repo, drivers: { attestOutboundUntilDone } }),
      controller.signal,
    );

    await vi.waitFor(() => expect(taskStarted).toBe(true));

    let settledBeforeAbortResolved = false;
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- intentional fire-and-forget probe
    loopDone.then(() => {
      settledBeforeAbortResolved = true;
    });

    controller.abort();
    await new Promise((r) => setTimeout(r, 20));
    expect(settledBeforeAbortResolved).toBe(false);

    gate.resolve({} as OutboundTransferRow);
    await loopDone;
    expect(settledBeforeAbortResolved).toBe(true);
  });

  it("leaves a row that was mid-poll at abort in a clean state the reconciler can resume: still `submitting`, hash intact", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const attested = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5FA3");

    let sawAbort = false;
    const submitOutboundUntilDelivered = vi.fn(
      async (
        row: OutboundTransferRow,
        _opts: unknown,
        signal?: AbortSignal,
      ): Promise<OutboundTransferRow> => {
        await repo.transition(row.id, row.version, "submitting", {
          destinationTxHash: "0xdeadbeef",
        });
        return new Promise<OutboundTransferRow>((_resolve, reject) => {
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
    const loopDone = startOutboundWorkLoop(
      baseOptions({
        repo,
        drivers: { submitOutboundUntilDelivered },
        log: { error: () => undefined, warn: () => undefined, info: infoLog },
      }),
      controller.signal,
    );

    await vi.waitFor(() => expect(submitOutboundUntilDelivered).toHaveBeenCalled());
    controller.abort();
    await loopDone;

    expect(sawAbort).toBe(true);
    const reread = await repo.get(attested.id);
    expect(reread?.status).toBe("submitting");
    expect(reread?.destinationTxHash).toBe("0xdeadbeef");
    expect(infoLog).toHaveBeenCalledWith(expect.stringContaining("aborted"));
  });
});

describe("startOutboundWorkLoop: unexpected errors", () => {
  it("removes a row from in-flight tracking and logs loudly when its task throws an unmodeled error", async () => {
    const repo = new InMemoryOutboundTransferRepository();
    const row = await registerPending(repo);
    let calls = 0;
    const attestOutboundUntilDone = vi.fn(
      (_row: OutboundTransferRow, _opts: unknown, signal?: AbortSignal) => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error("totally unexpected bug"));
        }
        return new Promise<OutboundTransferRow>((resolve) => {
          signal?.addEventListener("abort", () => resolve(row), { once: true });
        });
      },
    );
    const errorLog = vi.fn();

    const controller = new AbortController();
    const loopDone = startOutboundWorkLoop(
      baseOptions({
        repo,
        drivers: { attestOutboundUntilDone },
        log: { error: errorLog, warn: () => undefined, info: () => undefined },
      }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(attestOutboundUntilDone.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(row.id));
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("unexpected error"));

    controller.abort();
    await loopDone;
  });

  it("keeps polling when listByStatus itself throws, instead of crashing the phase", async () => {
    const repo = new InMemoryOutboundTransferRepository();
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
    const loopDone = startOutboundWorkLoop(
      baseOptions({ repo, log: { error: errorLog, warn: () => undefined, info: () => undefined } }),
      controller.signal,
    );

    await vi.waitFor(() => {
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("db connection reset"));
    });
    await vi.waitFor(() => {
      expect(calls).toBeGreaterThan(1);
    });

    controller.abort();
    await loopDone;
  });
});

describe("REQUIRED: concurrent-registration race — the atomic cap-check-then-spend sequence under real concurrency", () => {
  it(
    "two transfers attested at the same instant, each individually within the daily ceiling but " +
      "not together, race submitOutboundUntilDelivered directly (not through the loop's own " +
      "sequential spawn order) — only one is ever reserved and broadcast, the other is safely " +
      "retried",
    async () => {
      // This exercises the SAME real reserve() atomicity outbound-ceiling.integration.test.ts proves
      // against real Postgres — here at the level submitOutboundUntilDelivered actually calls it from,
      // firing two genuinely concurrent calls at ONE shared InMemoryOutboundSpendCeiling instance via
      // Promise.all, not two sequential loop passes. InMemoryOutboundSpendCeiling.reserve is
      // synchronous with respect to this process's own event loop (see its own doc comment), so two
      // calls issued back-to-back with no `await` between them race the exact same "check-and-
      // increment" logic the real Postgres statement guarantees atomically.
      const repo = new InMemoryOutboundTransferRepository();
      const ceilingWei = 100n;
      const spendCeiling = new InMemoryOutboundSpendCeiling(ceilingWei);
      const eachCostWei = 60n; // 60 + 60 = 120 > 100: individually fine, together over the ceiling

      const transferA = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5RA1");
      const transferB = await registerAttested(repo, "01ARZ3NDEKTSV4RRFFQ69G5RA2");

      const { submitOutboundUntilDelivered } = await import("./outbound-submit.js");
      const { FakeRelayerEvmRpc } = await import("../chain/fake-evm-rpc.test-support.js");

      const rpcA = new FakeRelayerEvmRpc(new Map());
      rpcA.nextGasCostWei = eachCostWei;
      const rpcB = new FakeRelayerEvmRpc(new Map());
      rpcB.nextGasCostWei = eachCostWei;

      const spendLogA = new InMemoryOutboundSpendLog();
      const spendLogB = new InMemoryOutboundSpendLog();

      const controller = new AbortController();
      controller.abort(); // both calls stop right after the reserve/broadcast step, at waitForOutboundDelivery

      const [resultA, resultB] = await Promise.allSettled([
        submitOutboundUntilDelivered(
          transferA,
          {
            rpc: rpcA,
            repo,
            signer: fakeSigner(),
            messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
            destinationChain: SEPOLIA,
            maxGasCostWei: 10_000_000_000_000_000n,
            spendCeiling,
            spendLog: spendLogA,
            pollIntervalMs: 0,
            pollMaxIntervalMs: 0,
          },
          controller.signal,
        ),
        submitOutboundUntilDelivered(
          transferB,
          {
            rpc: rpcB,
            repo,
            signer: fakeSigner(),
            messageTransmitterV2: MESSAGE_TRANSMITTER_V2,
            destinationChain: SEPOLIA,
            maxGasCostWei: 10_000_000_000_000_000n,
            spendCeiling,
            spendLog: spendLogB,
            pollIntervalMs: 0,
            pollMaxIntervalMs: 0,
          },
          controller.signal,
        ),
      ]);

      // Both calls settle (one fulfilled via the aborted waitForOutboundDelivery rejecting, the other
      // via the ceiling-exhausted OutboundRelayerRetryableError) — the core assertion is how many
      // actually got to broadcast, not which promise shape each took.
      expect(resultA.status === "rejected" || resultB.status === "rejected").toBe(true);

      const broadcastCount = rpcA.broadcastCalls.length + rpcB.broadcastCalls.length;
      // The atomic reservation guarantees exactly one of the two individually-eligible-but-jointly-
      // over-cap transfers ever actually got far enough to broadcast — never both (which would mean
      // 120 wei spent against a 100 wei ceiling) and never neither.
      expect(broadcastCount).toBe(1);
      expect(await spendCeiling.spentToday(SEPOLIA)).toBe(eachCostWei);

      // The loser was never logged as 'reserved' or 'broadcast' — its spend log shows the unconditional
      // pre-attempt record only, with no ledger event, exactly like submit.ts's own "ceiling has no
      // room" branch.
      const loserSpendLog = rpcA.broadcastCalls.length === 0 ? spendLogA : spendLogB;
      expect(loserSpendLog.events.map((e) => e.type)).toEqual([]);

      // And the loser's row is left `attested` (unchanged, safe to retry on the next pass), not
      // corrupted or double-counted.
      const loserId = rpcA.broadcastCalls.length === 0 ? transferA.id : transferB.id;
      const loserRow = await repo.get(loserId);
      expect(loserRow?.status).toBe("attested");
    },
  );
});
