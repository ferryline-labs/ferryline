/**
 * The relayer's error taxonomy for the work loop. Per the phase-3 sign-off: `failed` is a terminal
 * status reached ONLY from the explicit terminal codes below — never a catch-all `catch` block. Any
 * error that does not match one of these codes is treated as retryable (the transfer's status does
 * not change; the work loop backs off and tries again via backoffDelay from @ferryline/sdk).
 *
 * This file is the single place that decides "is this error terminal or retryable" — the work loop
 * and the repository call `classifyError`, they do not re-derive the answer themselves.
 */

/**
 * Terminal: nothing about retrying can fix these. Each one names the concrete condition observed,
 * not a generic "something is permanently wrong".
 */
export type TerminalErrorCode =
  /** MessageTransmitter.is_nonce_used(nonce) was true before we ever submitted mint_and_forward:
   *  someone else (or a prior, unreconciled run of this same relayer) already delivered it. */
  | "NONCE_ALREADY_USED"
  /** Iris returned a message whose byte layout parseCctpMessage()/parseCctpBurnBody() could not
   *  parse, or a hook data payload buildForwarderHookData()/parseForwarderHookData() rejects. */
  | "MALFORMED_MESSAGE"
  /** The registered transfer's amount is at or below what Circle's minimum-fee/dust rules make
   *  economically pointless to relay (see MIN_RELAYABLE_AMOUNT_STROOPS in spend/limits.ts). */
  | "BELOW_MINIMUM_AMOUNT"
  /** assertForwarderFields (imported from @ferryline/sdk, not reimplemented here) rejected the
   *  message's mint_recipient/destination_caller: they are not the CctpForwarder contract id. This
   *  is Circle's message, not ours, so the safe response is to refuse, never to "fix" and forward. */
  | "FORWARDER_FIELDS_INVALID"
  /** Circle attested the message with a status this repo has never observed and does not recognize
   *  as either "pending" or "complete" — see the SDK's IRIS_STATUS_COMPLETE comment. Rather than
   *  guess whether that new status means the message is dead, a human decides. */
  | "IRIS_STATUS_UNRECOGNIZED_TERMINAL"
  /** The registered transfer's recipient failed to parse as a Stellar strkey, or is a G/M account
   *  we cannot verify has (or ever will have) a USDC trustline the forwarder can pay out to. This
   *  repo does not add trustlines on a recipient's behalf (that is the SDK/widget's job at quote
   *  time, before a transfer is ever registered here); a persistently-untrusted recipient is a
   *  terminal condition for the relayer, not a retry target. */
  | "RECIPIENT_UNRESOLVABLE"
  /** The single-transfer spend cap (FERRYLINE_MAX_FEE_BUMP_STROOPS) would be exceeded by the real
   *  fee-bump quote for this transfer. Not a config problem — a per-transfer decision. */
  | "TRANSFER_EXCEEDS_SPEND_CAP"
  /** This recipient has registered maxTransfersPerRecipient-or-more transfers within
   *  recipientRateLimitWindowMs (see countByRecipientSince, checked at the pending -> attested
   *  transition once the recipient is known from the verified on-chain message). This is a policy
   *  rejection, not a transient condition: per the STEP 4 sign-off, it is deliberately terminal
   *  rather than retryable, so a rate-limited transfer does not silently keep retrying against a
   *  limit that has not changed, and so it counts toward the recipient's future windows (excluding
   *  it would let an attacker spam past its own block for free — see spend/registration-limit.ts's
   *  own doc comment for the same reasoning applied at registration time). No spend-log entry is
   *  written for this case: nothing here was ever a spend candidate — see work/submit.ts's
   *  spend-log-before-reservation ordering for what IS logged and why this case is different. */
  | "RECIPIENT_RATE_LIMITED";

const TERMINAL_CODES: ReadonlySet<string> = new Set<TerminalErrorCode>([
  "NONCE_ALREADY_USED",
  "MALFORMED_MESSAGE",
  "BELOW_MINIMUM_AMOUNT",
  "FORWARDER_FIELDS_INVALID",
  "IRIS_STATUS_UNRECOGNIZED_TERMINAL",
  "RECIPIENT_UNRESOLVABLE",
  "TRANSFER_EXCEEDS_SPEND_CAP",
  "RECIPIENT_RATE_LIMITED",
]);

export function isTerminalErrorCode(code: string): code is TerminalErrorCode {
  return TERMINAL_CODES.has(code);
}

/** Thrown to move a transfer to `failed` with one of the enumerated terminal codes above. */
export class RelayerTerminalError extends Error {
  readonly code: TerminalErrorCode;

  constructor(code: TerminalErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RelayerTerminalError";
    this.code = code;
  }
}

/**
 * Everything else: RPC timeouts, Iris 5xx, DNS blips, connection resets, a not-yet-attested
 * message. The work loop catches these, does NOT change the transfer's status, and retries with
 * backoff. Distinguished by NOT being a RelayerTerminalError.
 */
export class RelayerRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RelayerRetryableError";
  }
}
