import { decodeTime, isValid, monotonicFactory } from "ulidx";

import { FerrylineError } from "./errors.js";

/**
 * The one identifier for a transfer across SDK, relayer, widget and logs.
 * A ULID: 26 Crockford-base32 characters, time-ordered, 80 bits of randomness.
 * Rail-native identifiers (LayerZero GUID, CCTP nonce, tx hashes) are mapped to and
 * from this id inside the adapters and never replace it.
 */
export type TransferId = string & { readonly __brand: "TransferId" };

export const TRANSFER_ID_LENGTH = 26;

// One monotonic generator per process: ids minted in the same millisecond still sort in creation order.
const nextUlid = monotonicFactory();

/**
 * Mint a new transfer id. `seedTime` (unix ms) exists for deterministic tests only, and is
 * honoured only when it is not earlier than the last id minted in this process: the generator
 * is monotonic, so an older seed produces the next id in sequence instead of going back in time.
 */
export function newTransferId(seedTime?: number): TransferId {
  return nextUlid(seedTime) as TransferId;
}

/** Canonical ULID text: upper-case Crockford base32, first char 0-7 so the 48-bit timestamp fits. */
const CANONICAL_ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Unix ms encoded in the id's first 10 characters. */
export function transferIdTime(transferId: TransferId): number {
  return decodeTime(transferId);
}

export function isTransferId(value: unknown): value is TransferId {
  return (
    typeof value === "string" &&
    value.length === TRANSFER_ID_LENGTH &&
    CANONICAL_ULID.test(value) &&
    isValid(value)
  );
}

export function assertTransferId(value: unknown): TransferId {
  if (!isTransferId(value)) {
    throw new FerrylineError("TRANSFER_ID_INVALID", `not a transfer id: ${JSON.stringify(value)}`);
  }
  return value;
}
