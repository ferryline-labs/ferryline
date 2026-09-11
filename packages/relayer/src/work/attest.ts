import {
  assertForwarderFields,
  backoffDelay,
  FerrylineError,
  parseCctpMessage,
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
  readonly sleep?: SleepFn;
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

  return options.repo.transition(transfer.id, transfer.version, "attested", {
    irisNonce: message.eventNonce,
    irisMessage: message.message,
    irisAttestation: message.attestation,
    mintRecipient: options.forwarderContractId,
    destinationCaller: options.forwarderContractId,
  });
}

/**
 * Drives one `pending` transfer to `attested`, polling with the shared SDK backoff helper (not
 * reimplemented) until success, a terminal error, or `signal` aborts.
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
