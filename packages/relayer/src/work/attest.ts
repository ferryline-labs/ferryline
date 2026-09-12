import {
  assertForwarderFields,
  backoffDelay,
  FerrylineError,
  parseCctpMessage,
  parseForwarderHookData,
  sleep,
  type IrisClient,
  type SleepFn,
} from "@ferryline/sdk";

import type { TransferRepository, TransferRow } from "../repo/types.js";
import { RelayerRetryableError, RelayerTerminalError } from "./errors.js";

export interface AttestOptions {
  readonly iris: IrisClient;
  readonly repo: TransferRepository;
  readonly forwarderContractId: string;
  readonly pollIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  /**
   * STEP 4's REAL per-recipient rate limit (distinct from the blunt, per-API-key registration-time
   * defense in spend/registration-limit.ts). Checked here, once `recipient` is known from the
   * verified on-chain message, and nowhere else — this is the only point in the relayer where the
   * recipient can be trusted. See countByRecipientSince on TransferRepository and
   * RECIPIENT_RATE_LIMITED in ./errors.js.
   */
  readonly maxTransfersPerRecipient: number;
  readonly recipientRateLimitWindowMs: number;
  readonly sleep?: SleepFn;
  /** Defaults to `() => new Date()`. Overridable for deterministic tests of the rate-limit window. */
  readonly now?: () => Date;
}

/**
 * One poll attempt for a `pending` transfer: ask Iris for its attestation by source tx hash. Throws
 * RelayerRetryableError while Iris has not indexed it yet or answers non-"complete" (see the SDK's
 * IRIS_STATUS_COMPLETE comment: only "complete" has been observed, so anything else is "not ready",
 * not "broken", UNLESS it is unmistakably a dead message — see below). On success, verifies the
 * forwarder fields (reusing @ferryline/sdk's assertForwarderFields — the ONE place that rule lives)
 * and transitions the row to `attested`.
 */
export async function attestOnce(
  transfer: TransferRow,
  options: AttestOptions,
): Promise<TransferRow> {
  const messages = await options.iris.messagesByTx(transfer.sourceDomain, transfer.sourceTxHash);
  const message = messages[0];
  if (!message) {
    throw new RelayerRetryableError(`Iris has not indexed ${transfer.sourceTxHash} yet`);
  }
  if (message.status !== "complete") {
    throw new RelayerRetryableError(
      `Iris status for ${transfer.sourceTxHash} is "${message.status}", not yet complete`,
    );
  }

  let parsed: ReturnType<typeof parseCctpMessage>;
  try {
    parsed = parseCctpMessage(message.message);
  } catch (error) {
    const detail = error instanceof FerrylineError ? error.message : String(error);
    throw new RelayerTerminalError("MALFORMED_MESSAGE", `Iris message failed to parse: ${detail}`, {
      cause: error,
    });
  }

  try {
    assertForwarderFields(
      {
        mintRecipient: parsed.body.mintRecipient,
        destinationCaller: parsed.header.destinationCaller,
      },
      options.forwarderContractId,
    );
  } catch (error) {
    const detail = error instanceof FerrylineError ? error.message : String(error);
    throw new RelayerTerminalError(
      "FORWARDER_FIELDS_INVALID",
      `registered transfer's message does not target the forwarder: ${detail}`,
      { cause: error },
    );
  }

  // The real recipient lives in the forwarder hook data (parseForwarderHookData, the same parser
  // the SDK's CCTP rail uses), NOT as a caller-supplied claim from POST /transfers — this is
  // verified on-chain truth by construction, since it is only ever read here after the message
  // passed assertForwarderFields above.
  let recipient: string;
  try {
    recipient = parseForwarderHookData(parsed.body.hookData).forwardRecipient;
  } catch (error) {
    const detail = error instanceof FerrylineError ? error.message : String(error);
    throw new RelayerTerminalError(
      "MALFORMED_MESSAGE",
      `hook data did not contain a valid forward recipient: ${detail}`,
      { cause: error },
    );
  }

  const amount = parsed.body.amount.toString();

  // STEP 4's REAL per-recipient rate limit, now that `recipient` is verified on-chain truth. This
  // is the ONLY point in the relayer where the recipient can be trusted, so it is also the ONLY
  // point this check can run — see AttestOptions's own doc comment. Checked BEFORE the `attested`
  // transition: a rate-limited transfer never becomes `attested` at all, it goes straight to
  // `failed`, carrying the real amount/recipient it was extracted with (per the STEP 4 sign-off:
  // an audit trail that goes blank on exactly the row someone needs to investigate would defeat the
  // purpose of having one). This transition happens directly here, not by throwing and letting
  // attestUntilDone's generic terminal-error handler apply it, specifically because that generic
  // handler only ever sets errorCode/errorDetail — it has no reason to also carry amount/recipient,
  // since every OTHER terminal code in this file fires before those fields are known.
  const now = options.now ?? (() => new Date());
  const windowStart = new Date(now().getTime() - options.recipientRateLimitWindowMs);
  const countInWindow = await options.repo.countByRecipientSince(recipient, windowStart);
  if (countInWindow >= options.maxTransfersPerRecipient) {
    return options.repo.transition(transfer.id, transfer.version, "failed", {
      amount,
      recipient,
      errorCode: "RECIPIENT_RATE_LIMITED",
      errorDetail:
        `recipient ${recipient} has ${String(countInWindow)} transfer(s) registered within the ` +
        `rate-limit window (limit: ${String(options.maxTransfersPerRecipient)})`,
    });
  }

  return options.repo.transition(transfer.id, transfer.version, "attested", {
    amount,
    recipient,
    irisNonce: message.eventNonce,
    irisMessage: message.message,
    irisAttestation: message.attestation,
    mintRecipient: options.forwarderContractId,
    destinationCaller: options.forwarderContractId,
  });
}

/**
 * Drives one `pending` transfer to `attested`, polling with the shared SDK backoff helper (not
 * reimplemented) until success, a terminal error, or `signal` aborts. "Terminal" here covers two
 * shapes: attestOnce can itself return a `failed` row directly (the RECIPIENT_RATE_LIMITED case,
 * which needs to carry amount/recipient alongside errorCode/errorDetail — see attestOnce's own
 * comment for why that one case does its own transition rather than throwing), or it can throw a
 * RelayerTerminalError, which this loop catches and converts to `failed` with just
 * errorCode/errorDetail, same as before.
 */
export async function attestUntilDone(
  transfer: TransferRow,
  options: AttestOptions,
  signal?: AbortSignal,
): Promise<TransferRow> {
  const wait = options.sleep ?? sleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await attestOnce(transfer, options);
    } catch (error) {
      if (error instanceof RelayerTerminalError) {
        return options.repo.transition(transfer.id, transfer.version, "failed", {
          errorCode: error.code,
          errorDetail: error.message,
        });
      }
      await wait(
        backoffDelay(attempt, {
          initialMs: options.pollIntervalMs,
          maxMs: options.pollMaxIntervalMs,
        }),
        signal,
      );
    }
  }
}
