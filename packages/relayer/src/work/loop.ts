import { backoffDelay, sleep, type IrisClient, type SleepFn } from "@ferryline/sdk";

import type { RelayerStellarRpc } from "../chain/stellar-rpc.js";
import type { TransferRepository, TransferRow, TransferStatus } from "../repo/types.js";
import type { Signer } from "../signer/types.js";
import type { SpendCeiling } from "../spend/ceiling.js";
import type { SpendLog } from "../spend/spend-log.js";
import { attestUntilDone, type AttestOptions } from "./attest.js";
import { RelayerRetryableError } from "./errors.js";
import { reconcileAllSubmitting, type ReconcileOptions } from "./reconcile.js";
import { submitUntilDelivered, type SubmitOptions } from "./submit.js";

export interface WorkLoopOptions {
  readonly repo: TransferRepository;
  readonly iris: IrisClient;
  readonly rpc: RelayerStellarRpc;
  readonly signer: Signer;
  readonly sponsorAccount: string;
  readonly networkPassphrase: string;
  readonly forwarderContractId: string;
  readonly messageTransmitterContractId: string;
  readonly maxFeeBumpStroops: bigint;
  readonly spendCeiling: SpendCeiling;
  /**
   * The same configured ceiling value `spendCeiling` reserves against (FERRYLINE_DAILY_SPEND_CEILING_STROOPS).
   * Needed here because SpendCeiling itself only exposes spentToday()/wouldExceed()/reserve()/release()
   * — not the ceiling value it was constructed with — and the "should I even start new mints" gate
   * below needs to compare spentToday() directly against it (see that gate's own doc comment for why
   * wouldExceed(0n) is NOT the right check here).
   */
  readonly maxDailySpendCeilingStroops: bigint;
  readonly spendLog: SpendLog;
  /** STEP 4's REAL per-recipient rate limit, checked at the pending -> attested transition once the
   *  recipient is verified — see AttestOptions's own doc comment and RECIPIENT_RATE_LIMITED in
   *  ./errors.js. Distinct from maxConcurrentTransfers (a performance knob) and from
   *  spend/registration-limit.ts's blunt per-API-key check (a spam brake at registration time,
   *  before the recipient is even known). */
  readonly maxTransfersPerRecipient: number;
  readonly recipientRateLimitWindowMs: number;
  /** How often each phase re-lists its status for newly-registered rows. */
  readonly pollIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  /** Max transfers driven concurrently, combined across both phases. See config.ts's doc comment. */
  readonly maxConcurrentTransfers: number;
  readonly sleep?: SleepFn;
  readonly log?: Pick<Console, "error" | "warn" | "info">;
  /**
   * Overrides for the three functions that actually touch Iris/Stellar/Postgres, for tests that
   * want to exercise this file's own sequencing (phase ordering, the ceiling gate, startup
   * reconciliation, concurrency cap, abort-on-shutdown, per-row error handling) without a real RPC
   * simulation of `mint_and_forward` or a real Iris server. Defaults to the real
   * attestUntilDone/submitUntilDelivered/reconcileAllSubmitting — production code (main.ts) never
   * sets this.
   */
  readonly drivers?: {
    readonly attestUntilDone?: typeof attestUntilDone;
    readonly submitUntilDelivered?: typeof submitUntilDelivered;
    readonly reconcileAllSubmitting?: typeof reconcileAllSubmitting;
  };
}

function driversOf(options: WorkLoopOptions): {
  readonly attestUntilDone: typeof attestUntilDone;
  readonly submitUntilDelivered: typeof submitUntilDelivered;
  readonly reconcileAllSubmitting: typeof reconcileAllSubmitting;
} {
  return {
    attestUntilDone: options.drivers?.attestUntilDone ?? attestUntilDone,
    submitUntilDelivered: options.drivers?.submitUntilDelivered ?? submitUntilDelivered,
    reconcileAllSubmitting: options.drivers?.reconcileAllSubmitting ?? reconcileAllSubmitting,
  };
}

function attestOptions(options: WorkLoopOptions): AttestOptions {
  return {
    iris: options.iris,
    repo: options.repo,
    forwarderContractId: options.forwarderContractId,
    pollIntervalMs: options.pollIntervalMs,
    pollMaxIntervalMs: options.pollMaxIntervalMs,
    maxTransfersPerRecipient: options.maxTransfersPerRecipient,
    recipientRateLimitWindowMs: options.recipientRateLimitWindowMs,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };
}

function submitOptions(options: WorkLoopOptions): SubmitOptions {
  return {
    rpc: options.rpc,
    repo: options.repo,
    signer: options.signer,
    sponsorAccount: options.sponsorAccount,
    networkPassphrase: options.networkPassphrase,
    forwarderContractId: options.forwarderContractId,
    messageTransmitterContractId: options.messageTransmitterContractId,
    maxFeeBumpStroops: options.maxFeeBumpStroops,
    spendCeiling: options.spendCeiling,
    spendLog: options.spendLog,
    pollIntervalMs: options.pollIntervalMs,
    pollMaxIntervalMs: options.pollMaxIntervalMs,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };
}

function reconcileOptions(options: WorkLoopOptions): ReconcileOptions {
  return {
    rpc: options.rpc,
    repo: options.repo,
    networkPassphrase: options.networkPassphrase,
    messageTransmitterContractId: options.messageTransmitterContractId,
    sourceAccount: options.sponsorAccount,
  };
}

/**
 * On startup: resolve every transfer left in `submitting` from a prior run (crash recovery) BEFORE
 * any new work is picked up, per the phase-3 sign-off. Transfers reconcileSubmitting reports as
 * "resubmit" are not re-broadcast here — they are handed to submitUntilDelivered exactly as the
 * normal `attested` phase would, so there is exactly one code path that ever broadcasts. This runs
 * to completion (not concurrency-capped, not abortable) before startWorkLoop is ever called — see
 * main.ts — so it does not need to participate in the running loop's in-flight tracking.
 */
export async function runStartupReconciliation(
  options: WorkLoopOptions,
): Promise<{ alreadyDelivered: number; resubmitted: number }> {
  const log = options.log ?? console;
  const drivers = driversOf(options);
  const outcomes = await drivers.reconcileAllSubmitting(reconcileOptions(options));
  let alreadyDelivered = 0;
  let resubmitted = 0;
  for (const outcome of outcomes) {
    if (outcome.kind === "already-delivered") {
      alreadyDelivered += 1;
      log.info?.(`reconcile: transfer ${outcome.row.id} was already delivered`);
      continue;
    }
    resubmitted += 1;
    log.info?.(`reconcile: transfer ${outcome.row.id} was not delivered, resubmitting`);
    try {
      await drivers.submitUntilDelivered(outcome.row, submitOptions(options));
    } catch (error) {
      // A retryable failure here (e.g. the ceiling is currently exhausted, or Stellar RPC is down)
      // leaves the row exactly where reconcileSubmitting found it (`submitting`, real hash intact).
      // The running loop does not poll `submitting` rows (only `pending`/`attested`), so on a
      // genuinely stuck reconciliation this transfer is not retried again until the NEXT process
      // restart. This is a known limitation of the current loop (not silently swallowed: logged
      // loudly), tracked for a later checkpoint rather than solved here, since it is a scheduling
      // concern, not a correctness one — the row's on-chain truth is unaffected either way.
      log.error(
        `reconcile: resubmitting transfer ${outcome.row.id} failed and will not be retried until ` +
          `the next restart: ${String(error)}`,
      );
    }
  }
  return { alreadyDelivered, resubmitted };
}

/**
 * Drives ONE row to completion: exactly one call to attestUntilDone/submitUntilDelivered, which
 * itself polls internally until success, a terminal error (already converted to a `failed`
 * transition inside that call), or `signal` aborts. Spawned once per row by runPhase and left alone
 * until it settles — never called again for a row already tracked in `inFlight`.
 */
async function driveRowToCompletion(
  row: TransferRow,
  run: (signal: AbortSignal) => Promise<TransferRow>,
  signal: AbortSignal,
  log: Pick<Console, "error" | "warn" | "info">,
): Promise<void> {
  try {
    await run(signal);
  } catch (error) {
    if (signal.aborted) {
      // Shutdown, not a failure: the row is left exactly where `run` last left it (still
      // `pending`/`attested`, or already at `submitting` with its hash written if the abort landed
      // inside submitUntilDelivered's post-broadcast wait — see submit.ts's waitForDelivery, the
      // only place it actually consults `signal`). Both are states reconcileSubmitting/the next
      // startup's poll can resume cleanly; nothing here needs to clean up further.
      log.info?.(`transfer ${row.id}: task aborted (shutdown), left at its current status`);
      return;
    }
    if (error instanceof RelayerRetryableError) {
      // Should not normally reach here: attestUntilDone/submitUntilDelivered retry retryable errors
      // internally rather than throwing them out to a non-aborted caller. Logged (not silently
      // dropped) in case that assumption is ever violated by a future change to either function.
      log.warn?.(`transfer ${row.id}: retryable error escaped to the loop: ${error.message}`);
      return;
    }
    // Anything else is unmodeled: a bug, or an error outside the RelayerTerminalError/RetryableError
    // taxonomy. Per the phase-3 sign-off's concurrency review: this MUST be logged loudly and the
    // task MUST still be removed from in-flight tracking (runPhase's `finally` handles that) —
    // silently vanishing from tracking while the row sits stuck in the database with nothing
    // watching it is exactly the invisible failure mode to avoid.
    log.error(`transfer ${row.id}: unexpected error, leaving row as-is: ${String(error)}`);
  }
}

/**
 * Runs one phase (`pending` or `attested`) as a set of long-lived per-row tasks, up to
 * `maxConcurrentTransfers` at a time SHARED with the other phase via `inFlight` (the cap is combined
 * across both phases, per the phase-3 sign-off review, not per-phase — both callers in
 * `startWorkLoop` pass the same map). Re-lists its status on an interval to pick up newly-registered
 * rows; a row already being driven is never re-listed into a second task (tracked by id in
 * `inFlight`).
 *
 * `gate`, if given, is checked once per pass, only when there is at least one candidate row, BEFORE
 * spawning anything that pass — used by the `attested` phase for the daily-ceiling "should I even
 * start new mints right now" check (see startWorkLoop). It deliberately runs at most once per pass,
 * not once per row: the point is "stop starting new work while true", not a per-row cost.
 */
async function runPhase(
  name: string,
  status: TransferStatus,
  spawn: (row: TransferRow, signal: AbortSignal) => Promise<TransferRow>,
  options: WorkLoopOptions,
  inFlight: Map<string, Promise<void>>,
  signal: AbortSignal,
  gate?: (
    candidateCount: number,
  ) => Promise<{ readonly proceed: boolean; readonly reason?: string }>,
): Promise<void> {
  const wait = options.sleep ?? sleep;
  const log = options.log ?? console;
  let emptyPasses = 0;
  while (!signal.aborted) {
    let candidates: readonly TransferRow[];
    try {
      candidates = await options.repo.listByStatus(status);
    } catch (error) {
      log.error(
        `work loop (${name}): failed to list ${status} transfers, backing off: ${String(error)}`,
      );
      candidates = [];
    }

    let spawnedThisPass = 0;
    let gateOpen = true;
    if (candidates.length > 0 && gate) {
      const verdict = await gate(candidates.length);
      gateOpen = verdict.proceed;
      if (!gateOpen && verdict.reason) {
        log.warn?.(verdict.reason);
      }
    }

    if (gateOpen) {
      for (const row of candidates) {
        if (signal.aborted) {
          break;
        }
        if (inFlight.has(row.id)) {
          continue; // already being driven by an earlier pass's task
        }
        if (inFlight.size >= options.maxConcurrentTransfers) {
          break; // at the combined cap; the rest of `candidates` waits for a slot next pass
        }
        spawnedThisPass += 1;
        const task = driveRowToCompletion(
          row,
          (taskSignal) => spawn(row, taskSignal),
          signal,
          log,
        ).finally(() => {
          inFlight.delete(row.id);
        });
        inFlight.set(row.id, task);
      }
    }

    emptyPasses = spawnedThisPass > 0 ? 0 : emptyPasses + 1;
    await wait(
      backoffDelay(emptyPasses, {
        initialMs: options.pollIntervalMs,
        maxMs: options.pollMaxIntervalMs,
      }),
      signal,
    ).catch(() => undefined); // sleep rejects on abort; the `while` condition exits on the next check
  }
}

/**
 * Starts both phases (pending->attested, attested->delivered) as long-lived per-row task pools,
 * sharing one combined concurrency cap and one `inFlight` map, until `signal` aborts. Call
 * `runStartupReconciliation` first and await it — this function does not do that itself, so callers
 * cannot accidentally start polling before reconcile has run (see main.ts).
 *
 * On abort: stops spawning NEW row-tasks (both phases' listing loops exit) and awaits every already
 * in-flight task before resolving, so a caller that awaits this function's return knows shutdown is
 * actually complete — no task is left running unobserved after this resolves. Each individual task's
 * own behavior on abort is documented on driveRowToCompletion.
 */
export async function startWorkLoop(options: WorkLoopOptions, signal?: AbortSignal): Promise<void> {
  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  const inFlight = new Map<string, Promise<void>>();

  await Promise.all([
    runPhase(
      "pending->attested",
      "pending",
      (row, taskSignal) =>
        driversOf(options).attestUntilDone(row, attestOptions(options), taskSignal),
      options,
      inFlight,
      controller.signal,
    ),
    runPhase(
      "attested->delivered",
      "attested",
      (row, taskSignal) =>
        driversOf(options).submitUntilDelivered(row, submitOptions(options), taskSignal),
      options,
      inFlight,
      controller.signal,
      // Per the phase-3 sign-off: the relayer must actually stop STARTING new mints while the daily
      // ceiling is exhausted, not merely have each individual attempt fail and retry (which would
      // still build a fresh RPC-backed fee-bump quote per transfer per pass for no reason, and would
      // occupy a concurrency-cap slot doing so). This is a "should I even try" gate, same caveat as
      // spend/ceiling.ts's own doc comments: it never gates the actual spend decision —
      // submitUntilDelivered's atomic `reserve`, called inside the spawned task, is what does that.
      //
      // Deliberately `spentToday() >= ceilingStroops`, NOT `wouldExceed(0n)`: wouldExceed asks
      // "would spentToday() + amountStroops exceed the ceiling", which for amountStroops=0 reduces
      // to "is spentToday() > ceilingStroops" — a state reserve() never produces (it only ever admits
      // a reservation that keeps spent <= ceiling), so wouldExceed(0n) can never be true even when
      // the ceiling is fully, exactly consumed. This is the same check healthz.ts's ceilingReached
      // already uses, kept consistent here rather than reusing wouldExceed for something it does not
      // actually mean.
      async (candidateCount) => {
        const spent = await options.spendCeiling.spentToday();
        const ceilingReached = spent >= options.maxDailySpendCeilingStroops;
        return ceilingReached
          ? {
              proceed: false,
              reason: `work loop: daily spend ceiling reached, deferring ${String(candidateCount)} attested transfer(s) to a later pass`,
            }
          : { proceed: true };
      },
    ),
  ]);

  // Both listing loops have exited (they only do so once `controller.signal.aborted`), but tasks
  // they spawned may still be finishing their own abort unwind. Wait for all of them so a caller
  // awaiting startWorkLoop's return can rely on "shutdown complete" meaning every task actually
  // stopped, not just that no new ones will start.
  await Promise.all([...inFlight.values()]);
}
