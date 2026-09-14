import {
  backoffDelay,
  FerrylineError,
  parseCctpMessage,
  sleep,
  type IrisClient,
  type SleepFn,
} from "@ferryline/sdk";
import { bytes32ToEvmAddress } from "@ferryline/core";

import type { OutboundTransferRepository, OutboundTransferRow } from "../repo/outbound-types.js";
import { OutboundRelayerRetryableError, OutboundRelayerTerminalError } from "./outbound-errors.js";

export interface OutboundAttestOptions {
  readonly iris: IrisClient;
  readonly repo: OutboundTransferRepository;
  readonly pollIntervalMs: number;
  readonly pollMaxIntervalMs: number;
  /** STEP 4's REAL per-recipient rate limit — identical role to AttestOptions's own field in
   *  work/attest.ts, mirrored here. */
  readonly maxTransfersPerRecipient: number;
  readonly recipientRateLimitWindowMs: number;
  readonly sleep?: SleepFn;
  /** Defaults to `() => new Date()`. Overridable for deterministic tests of the rate-limit window. */
  readonly now?: () => Date;
}

/**
 * One poll attempt for a `pending` outbound transfer: ask Iris for its attestation by source
 * (Stellar) tx hash. Mirrors work/attest.ts's own attestOnce almost exactly, with ONE structural
 * simplification: outbound has no forwarder-hook-data indirection to unwrap.
 *
 * For a Stellar-source burn whose destination is an EVM chain, `mintRecipient` in the parsed CCTP
 * message body IS the real destination EVM address directly — there is no CctpForwarder contract
 * and no hook-data-encoded "real recipient" the way inbound's Stellar-destination messages have
 * (see @ferryline/sdk's message.ts and assertForwarderFields's own doc comment, which scopes that
 * whole mechanism to "for any burn whose destination is Stellar" specifically). So this function
 * skips assertForwarderFields and parseForwarderHookData entirely and instead decodes mintRecipient
 * straight to an EVM address with bytes32ToEvmAddress (from @ferryline/core, already tested against
 * a real mainnet transaction — see VERIFIED.md §2.4), rejecting a non-EVM-shaped value as
 * MALFORMED_MESSAGE rather than a distinct terminal code (see outbound-errors.ts's own doc comment
 * for why RECIPIENT_UNRESOLVABLE/FORWARDER_FIELDS_INVALID have no outbound equivalent).
 */
export async function attestOutboundOnce(
  transfer: OutboundTransferRow,
  options: OutboundAttestOptions,
): Promise<OutboundTransferRow> {
  const messages = await options.iris.messagesByTx(transfer.sourceDomain, transfer.sourceTxHash);
  const message = messages[0];
  if (!message) {
    throw new OutboundRelayerRetryableError(`Iris has not indexed ${transfer.sourceTxHash} yet`);
  }
  if (message.status !== "complete") {
    throw new OutboundRelayerRetryableError(
      `Iris status for ${transfer.sourceTxHash} is "${message.status}", not yet complete`,
    );
  }

  let parsed: ReturnType<typeof parseCctpMessage>;
  try {
    parsed = parseCctpMessage(message.message);
  } catch (error) {
    const detail = error instanceof FerrylineError ? error.message : String(error);
    throw new OutboundRelayerTerminalError(
      "MALFORMED_MESSAGE",
      `Iris message failed to parse: ${detail}`,
      { cause: error },
    );
  }

  // mintRecipient IS the real destination EVM address for an outbound (EVM-destination) burn — no
  // forwarder indirection to unwrap, see this function's own doc comment above.
  let recipient: `0x${string}`;
  try {
    recipient = bytes32ToEvmAddress(parsed.body.mintRecipient);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new OutboundRelayerTerminalError(
      "MALFORMED_MESSAGE",
      `mintRecipient did not decode to a well-formed EVM address: ${detail}`,
      { cause: error },
    );
  }

  const amount = parsed.body.amount.toString();

  // STEP 4's REAL per-recipient rate limit, now that `recipient` is verified on-chain truth — same
  // ordering/reasoning as attest.ts's own identical check: this transitions straight to `failed`
  // (carrying amount/recipient) rather than throwing, for the same audit-trail reason.
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
  });
}

/**
 * Drives one `pending` outbound transfer to `attested`, polling with the shared SDK backoff helper
 * until success, a terminal error, or `signal` aborts. Mirrors work/attest.ts's own
 * attestUntilDone exactly — see that function's own doc comment for the two terminal-error shapes
 * (direct `failed` transition for RECIPIENT_RATE_LIMITED, or a caught OutboundRelayerTerminalError
 * for everything else).
 */
export async function attestOutboundUntilDone(
  transfer: OutboundTransferRow,
  options: OutboundAttestOptions,
  signal?: AbortSignal,
): Promise<OutboundTransferRow> {
  const wait = options.sleep ?? sleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await attestOutboundOnce(transfer, options);
    } catch (error) {
      if (error instanceof OutboundRelayerTerminalError) {
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
