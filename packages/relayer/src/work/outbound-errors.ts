/**
 * The outbound relayer's error taxonomy, mirroring work/errors.ts's own discipline exactly: `failed`
 * is a terminal status reached ONLY from the explicit terminal codes below, never a catch-all. Any
 * error that does not match one of these codes is treated as retryable.
 *
 * Deliberately NOT a 1:1 copy of TerminalErrorCode — two inbound-only codes are absent here, each for
 * a real, checked reason, not an oversight:
 *   - FORWARDER_FIELDS_INVALID: inbound's fund-stranding guard (assertForwarderFields) exists because
 *     inbound delivers to STELLAR, where mintRecipient/destinationCaller must equal the CctpForwarder
 *     contract id or funds are unrecoverable. Outbound delivers to an EVM chain: mintRecipient IS the
 *     real destination address directly (confirmed by reading @ferryline/sdk's own message.ts — see
 *     work/outbound-attest.ts's doc comment), there is no forwarder indirection to validate.
 *   - RECIPIENT_UNRESOLVABLE: inbound's version covers a Stellar strkey that fails to parse or an
 *     account without (or unable to get) a USDC trustline — both Stellar-account-model concepts with
 *     no EVM equivalent. An outbound recipient is a plain 20-byte EVM address; CCTP's own wire format
 *     already guarantees mintRecipient decodes to a well-formed address (bytes32ToEvmAddress throws
 *     on a non-zero-padded value, which would mean a malformed message — see MALFORMED_MESSAGE below,
 *     not a distinct "unresolvable recipient" concept the way a missing trustline is).
 */
export type OutboundTerminalErrorCode =
  /** MessageTransmitterV2.usedNonces(nonce) was nonzero before we ever submitted receiveMessage:
   *  someone else (the sender, the recipient, or a prior unreconciled run of this same relayer)
   *  already delivered it. Confirmed real, permissionless behavior — see FAQ.md. */
  | "NONCE_ALREADY_USED"
  /** Iris returned a message whose byte layout parseCctpMessage()/parseCctpBurnBody() could not
   *  parse, or whose mintRecipient does not decode to a well-formed EVM address
   *  (bytes32ToEvmAddress's own "padding bytes are not zero" check). */
  | "MALFORMED_MESSAGE"
  /** Circle attested the message with a status this repo has never observed and does not recognize
   *  as either "pending" or "complete" — identical reasoning to the inbound code of the same name. */
  | "IRIS_STATUS_UNRECOGNIZED_TERMINAL"
  /** The single-transfer gas cap (FERRYLINE_OUTBOUND_MAX_GAS_WEI) would be exceeded by the real,
   *  current gas-price quote for this transfer's receiveMessage call. Not a config problem — a
   *  per-transfer decision, same reasoning as inbound's TRANSFER_EXCEEDS_SPEND_CAP. */
  | "TRANSFER_EXCEEDS_SPEND_CAP"
  /** This recipient has registered maxTransfersPerRecipient-or-more transfers within
   *  recipientRateLimitWindowMs. Deliberately terminal, not retryable — identical reasoning to
   *  inbound's RECIPIENT_RATE_LIMITED (see that code's own doc comment; unchanged here). */
  | "RECIPIENT_RATE_LIMITED";

const TERMINAL_CODES: ReadonlySet<string> = new Set<OutboundTerminalErrorCode>([
  "NONCE_ALREADY_USED",
  "MALFORMED_MESSAGE",
  "IRIS_STATUS_UNRECOGNIZED_TERMINAL",
  "TRANSFER_EXCEEDS_SPEND_CAP",
  "RECIPIENT_RATE_LIMITED",
]);

export function isOutboundTerminalErrorCode(code: string): code is OutboundTerminalErrorCode {
  return TERMINAL_CODES.has(code);
}

/** Thrown to move an outbound transfer to `failed` with one of the enumerated terminal codes above. */
export class OutboundRelayerTerminalError extends Error {
  readonly code: OutboundTerminalErrorCode;

  constructor(code: OutboundTerminalErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OutboundRelayerTerminalError";
    this.code = code;
  }
}

/**
 * Everything else: RPC timeouts, Iris 5xx, DNS blips, connection resets, a not-yet-attested message,
 * a currently-exhausted gas ceiling. The work loop catches these, does NOT change the transfer's
 * status, and retries with backoff. Distinguished by NOT being an OutboundRelayerTerminalError.
 */
export class OutboundRelayerRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OutboundRelayerRetryableError";
  }
}
