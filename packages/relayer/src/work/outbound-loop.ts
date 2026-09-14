import { backoffDelay, sleep, type IrisClient, type SleepFn } from "@ferryline/sdk";

import type { RelayerEvmRpc } from "../chain/evm-rpc.js";
import type { OutboundTransferRepository, OutboundTransferRow } from "../repo/outbound-types.js";
import type { TransferStatus } from "../repo/types.js";
import type { EvmSigner } from "../signer/evm-types.js";
import type { OutboundSpendCeiling } from "../spend/outbound-ceiling.js";
import type { OutboundSpendLog } from "../spend/outbound-spend-log.js";
import { attestOutboundUntilDone, type OutboundAttestOptions } from "./outbound-attest.js";
import { OutboundRelayerRetryableError } from "./outbound-errors.js";
import {
  reconcileAllOutboundSubmitting,
  type OutboundReconcileOptions,
} from "./outbound-reconcile.js";
import { submitOutboundUntilDelivered, type OutboundSubmitOptions } from "./outbound-submit.js";

export interface OutboundWorkLoopOptions {
  readonly repo: OutboundTransferRepository;
  readonly iris: IrisClient;
  readonly rpc: RelayerEvmRpc;
  readonly signer: EvmSigner;
  readonly messageTransmitterV2: `0x${string}`;
  readonly destinationChain: string;
  readonly maxGasCostWei: bigint;
  readonly spendCeiling: OutboundSpendCeiling;
  /** The same configured ceiling value `spendCeiling` reserves against
   *  (FERRYLINE_OUTBOUND_DAILY_GAS_CEILING_WEI) — needed here for the same reason
   *  WorkLoopOptions.maxDailySpendCeilingStroops is: OutboundSpendCeiling only exposes
   *  spentToday()/wouldExceed()/reserve()/release(), not the ceiling value itself, and the
   *  "should I even start new receiveMessage submissions" gate below needs to compare
   *  spentToday() directly against it. */
  readonly maxDailyGasCeilingWei: bigint;
  readonly spendLog: OutboundSpendLog;
  /** STEP 4's REAL per-recipient rate limit — see OutboundAttestOptions's own doc comment. */
  readonly maxTransfersPerRecipient: number;
  readonly recipientRateLimitWindowMs: number;
  readonly pollIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  /** Max transfers driven concurrently, combined across both phases — same "one shared cap across
   *  both phases" reasoning as WorkLoopOptions.maxConcurrentTransfers. */
  readonly maxConcurrentTransfers: number;
  readonly sleep?: SleepFn;
  readonly log?: Pick<Console, "error" | "warn" | "info">;
  /** Overrides for the three functions that actually touch Iris/the EVM chain/Postgres — identical
   *  reasoning to WorkLoopOptions.drivers: production code (main.ts) never sets this. */
  readonly drivers?: {
    readonly attestOutboundUntilDone?: typeof attestOutboundUntilDone;
    readonly submitOutboundUntilDelivered?: typeof submitOutboundUntilDelivered;
    readonly reconcileAllOutboundSubmitting?: typeof reconcileAllOutboundSubmitting;
  };
}

function driversOf(options: OutboundWorkLoopOptions): {
  readonly attestOutboundUntilDone: typeof attestOutboundUntilDone;
  readonly submitOutboundUntilDelivered: typeof submitOutboundUntilDelivered;
  readonly reconcileAllOutboundSubmitting: typeof reconcileAllOutboundSubmitting;
} {
  return {
    attestOutboundUntilDone: options.drivers?.attestOutboundUntilDone ?? attestOutboundUntilDone,
    submitOutboundUntilDelivered:
      options.drivers?.submitOutboundUntilDelivered ?? submitOutboundUntilDelivered,
    reconcileAllOutboundSubmitting:
      options.drivers?.reconcileAllOutboundSubmitting ?? reconcileAllOutboundSubmitting,
  };
}

function attestOptions(options: OutboundWorkLoopOptions): OutboundAttestOptions {
  return {
    iris: options.iris,
    repo: options.repo,
    pollIntervalMs: options.pollIntervalMs,
    pollMaxIntervalMs: options.pollMaxIntervalMs,
    maxTransfersPerRecipient: options.maxTransfersPerRecipient,
    recipientRateLimitWindowMs: options.recipientRateLimitWindowMs,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };
}

function submitOptions(options: OutboundWorkLoopOptions): OutboundSubmitOptions {
  return {
    rpc: options.rpc,
    repo: options.repo,
    signer: options.signer,
    messageTransmitterV2: options.messageTransmitterV2,
    destinationChain: options.destinationChain,
    maxGasCostWei: options.maxGasCostWei,
    spendCeiling: options.spendCeiling,
    spendLog: options.spendLog,
    pollIntervalMs: options.pollIntervalMs,
    pollMaxIntervalMs: options.pollMaxIntervalMs,
    ...(options.sleep ? { sleep: options.sleep } : {}),
  };
}

function reconcileOptions(options: OutboundWorkLoopOptions): OutboundReconcileOptions {
  return {
    rpc: options.rpc,
    repo: options.repo,
    messageTransmitterV2: options.messageTransmitterV2,
  };
}

/**
 * On startup: resolve every outbound transfer left in `submitting` from a prior run BEFORE any new
 * work is picked up. Mirrors runStartupReconciliation exactly — see that function's own doc comment
 * for the full reasoning (identical here): transfers reconcileAllOutboundSubmitting reports as
 * "resubmit" are handed to submitOutboundUntilDelivered exactly as the normal `attested` phase
 * would, so there is exactly one code path that ever broadcasts.
 */
export async function runOutboundStartupReconciliation(
  options: OutboundWorkLoopOptions,
): Promise<{ alreadyDelivered: number; resubmitted: number }> {
  const log = options.log ?? console;
  const drivers = driversOf(options);
  const outcomes = await drivers.reconcileAllOutboundSubmitting(reconcileOptions(options));
  let alreadyDelivered = 0;
  let resubmitted = 0;
  for (const outcome of outcomes) {
    if (outcome.kind === "already-delivered") {
      alreadyDelivered += 1;
      log.info?.(`outbound reconcile: transfer ${outcome.row.id} was already delivered`);
      continue;
    }
    resubmitted += 1;
    log.info?.(`outbound reconcile: transfer ${outcome.row.id} was not delivered, resubmitting`);
    try {
      await drivers.submitOutboundUntilDelivered(outcome.row, submitOptions(options));
    } catch (error) {
      // Same known, logged (not silently swallowed) limitation as runStartupReconciliation's own
      // identical branch: a retryable failure here leaves the row exactly where reconciliation found
      // it, and it is not retried again until the next process restart. The row's on-chain truth is
      // unaffected either way.
      log.error(
        `outbound reconcile: resubmitting transfer ${outcome.row.id} failed and will not be ` +
          `retried until the next restart: ${String(error)}`,
      );
    }
  }
  return { alreadyDelivered, resubmitted };
}

/** Mirrors driveRowToCompletion exactly, adapted to the outbound error taxonomy
 *  (OutboundRelayerRetryableError instead of RelayerRetryableError). See that function's own doc
 *  comment for the full reasoning behind each branch. */
async function driveRowToCompletion(
  row: OutboundTransferRow,
  run: (signal: AbortSignal) => Promise<OutboundTransferRow>,
  signal: AbortSignal,
  log: Pick<Console, "error" | "warn" | "info">,
): Promise<void> {
  try {
    await run(signal);
  } catch (error) {
    if (signal.aborted) {
      log.info?.(
        `outbound transfer ${row.id}: task aborted (shutdown), left at its current status`,
      );
      return;
    }
    if (error instanceof OutboundRelayerRetryableError) {
      log.warn?.(
        `outbound transfer ${row.id}: retryable error escaped to the loop: ${error.message}`,
      );
      return;
    }
    log.error(`outbound transfer ${row.id}: unexpected error, leaving row as-is: ${String(error)}`);
  }
}

/**
 * Runs one phase (`pending` or `attested`) as a set of long-lived per-row tasks, mirroring
 * runPhase exactly — same combined concurrency cap shared across phases via `inFlight`, same
 * re-listing/backoff/gate semantics. See runPhase's own doc comment for the full reasoning.
 */
async function runPhase(
  name: string,
  status: TransferStatus,
  spawn: (row: OutboundTransferRow, signal: AbortSignal) => Promise<OutboundTransferRow>,
  options: OutboundWorkLoopOptions,
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
    let candidates: readonly OutboundTransferRow[];
    try {
      candidates = await options.repo.listByStatus(status);
    } catch (error) {
      log.error(
        `outbound work loop (${name}): failed to list ${status} transfers, backing off: ${String(error)}`,
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
          continue;
        }
        if (inFlight.size >= options.maxConcurrentTransfers) {
          break;
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
    ).catch(() => undefined);
  }
}

/**
 * Starts both outbound phases (pending->attested, attested->delivered) as long-lived per-row task
 * pools, mirroring startWorkLoop exactly — same combined concurrency cap, same abort-and-await-
 * in-flight shutdown contract. Call `runOutboundStartupReconciliation` first and await it — this
 * function does not do that itself, same reasoning as startWorkLoop's own doc comment.
 */
export async function startOutboundWorkLoop(
  options: OutboundWorkLoopOptions,
  signal?: AbortSignal,
): Promise<void> {
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
        driversOf(options).attestOutboundUntilDone(row, attestOptions(options), taskSignal),
      options,
      inFlight,
      controller.signal,
    ),
    runPhase(
      "attested->delivered",
      "attested",
      (row, taskSignal) =>
        driversOf(options).submitOutboundUntilDelivered(row, submitOptions(options), taskSignal),
      options,
      inFlight,
      controller.signal,
      // Identical "stop STARTING new work while the ceiling is exhausted" gate as loop.ts's own,
      // same >= boundary reasoning (see that gate's own doc comment for why wouldExceed(0n) is not
      // the right check) — kept consistent with healthz.ts's outbound ceilingReached predicate.
      async (candidateCount) => {
        const spent = await options.spendCeiling.spentToday(options.destinationChain);
        const ceilingReached = spent >= options.maxDailyGasCeilingWei;
        return ceilingReached
          ? {
              proceed: false,
              reason: `outbound work loop: daily gas ceiling reached, deferring ${String(candidateCount)} attested transfer(s) to a later pass`,
            }
          : { proceed: true };
      },
    ),
  ]);

  await Promise.all([...inFlight.values()]);
}
