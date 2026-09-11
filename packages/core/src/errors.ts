/**
 * Every error Ferryline raises on purpose carries a stable `code` so callers can
 * branch on it without parsing messages.
 */
export type FerrylineErrorCode =
  | "AMOUNT_INVALID"
  | "ADDRESS_INVALID"
  | "TRANSFER_ID_INVALID"
  | "ROUTE_UNSUPPORTED"
  | "ADAPTER_CONFLICT"
  | "TRANSFER_UNKNOWN"
  /** Recipient address kind this rail cannot deliver to yet (e.g. C or M for inbound USDT0). */
  | "UNSUPPORTED_RECIPIENT_KIND"
  /** A preflight check in the quote failed; build() refuses rather than warns. */
  | "PREFLIGHT_FAILED"
  | "REFUND_ADDRESS_INVALID"
  | "QUOTE_EXPIRED"
  /** A build was attempted for a sender that cannot pay the transaction fee itself. */
  | "FEE_SOURCE_REQUIRED"
  /** Upstream RPC or API returned something we refuse to interpret. */
  | "UPSTREAM_ERROR"
  /** A rail-specific parameter the caller must supply is missing (no default exists on purpose). */
  | "PARAMETER_REQUIRED"
  | "PARAMETER_INVALID"
  /** The on-chain allowance is below what the next step needs; approve first. */
  | "ALLOWANCE_INSUFFICIENT"
  /** CCTP toward Stellar: mint_recipient or destination_caller is not the CctpForwarder. Funds would strand. */
  | "FORWARDER_FIELDS_INVALID"
  /** A deferred step was requested before its prerequisite step was confirmed. */
  | "STEP_NOT_READY";

export class FerrylineError extends Error {
  readonly code: FerrylineErrorCode;

  constructor(code: FerrylineErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FerrylineError";
    this.code = code;
  }
}
