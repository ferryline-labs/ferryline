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
  | "TRANSFER_UNKNOWN";

export class FerrylineError extends Error {
  readonly code: FerrylineErrorCode;

  constructor(code: FerrylineErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FerrylineError";
    this.code = code;
  }
}
