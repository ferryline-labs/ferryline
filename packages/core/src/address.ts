import { StrKey } from "@stellar/stellar-sdk/base";
import { Buffer } from "buffer";

import { FerrylineError } from "./errors.js";

/**
 * Stellar strkey address kinds Ferryline accepts.
 *   G… account  (ed25519 public key, 32 bytes)
 *   C… contract (contract id, 32 bytes)
 *   M… muxed    (ed25519 public key, 32 bytes, plus a 64-bit id; SEP-23)
 *
 * A muxed address does NOT fit in 32 bytes. `parse` returns its key and id separately;
 * whether a given rail can carry the id at all is a per-adapter question, never assumed here.
 */
export type StellarAddressKind = "account" | "contract" | "muxed";

export type ParsedStellarAddress =
  | { readonly kind: "account"; readonly key: Uint8Array }
  | { readonly kind: "contract"; readonly key: Uint8Array }
  | { readonly kind: "muxed"; readonly key: Uint8Array; readonly muxedId: bigint };

export const KEY_BYTES = 32;
const MUXED_ID_BYTES = 8;
const MAX_U64 = (1n << 64n) - 1n;

function invalid(message: string, cause?: unknown): FerrylineError {
  return cause === undefined
    ? new FerrylineError("ADDRESS_INVALID", message)
    : new FerrylineError("ADDRESS_INVALID", message, { cause });
}

function abbreviate(text: string): string {
  return text.length <= 12 ? text : `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function toBytes(buffer: Uint8Array): Uint8Array {
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice();
}

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw invalid(
      `expected ${String(KEY_BYTES)} key bytes, got ${String((key as { length?: number }).length)}`,
    );
  }
}

function readU64BE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < MUXED_ID_BYTES; i += 1) {
    value = (value << 8n) | BigInt(bytes[offset + i] ?? 0);
  }
  return value;
}

function writeU64BE(bytes: Uint8Array, offset: number, value: bigint): void {
  let remaining = value;
  for (let i = MUXED_ID_BYTES - 1; i >= 0; i -= 1) {
    bytes[offset + i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

/**
 * Parse a G, C or M strkey. Any malformed input throws `ADDRESS_INVALID`: wrong
 * alphabet, wrong length, wrong version byte, or a checksum mismatch. It never
 * returns a "nearby" address for a corrupted input.
 */
export function parseStellarAddress(strkey: string): ParsedStellarAddress {
  if (typeof strkey !== "string" || strkey.length === 0) {
    throw invalid("address must be a non-empty string");
  }
  // The StrKey.isValid* predicates return false on bad checksum, length, alphabet, or version.
  if (StrKey.isValidEd25519PublicKey(strkey)) {
    return { kind: "account", key: toBytes(StrKey.decodeEd25519PublicKey(strkey)) };
  }
  if (StrKey.isValidContract(strkey)) {
    return { kind: "contract", key: toBytes(StrKey.decodeContract(strkey)) };
  }
  if (StrKey.isValidMed25519PublicKey(strkey)) {
    // SEP-23 payload: 32-byte ed25519 key followed by the 8-byte big-endian id.
    const raw = toBytes(StrKey.decodeMed25519PublicKey(strkey));
    if (raw.length !== KEY_BYTES + MUXED_ID_BYTES) {
      throw invalid(
        `muxed payload must be ${String(KEY_BYTES + MUXED_ID_BYTES)} bytes, got ${String(raw.length)}`,
      );
    }
    return { kind: "muxed", key: raw.slice(0, KEY_BYTES), muxedId: readU64BE(raw, KEY_BYTES) };
  }
  throw invalid(`"${abbreviate(strkey)}" is not a valid G, C or M Stellar address`);
}

/** Inverse of `parseStellarAddress`. */
export function formatStellarAddress(parsed: ParsedStellarAddress): string {
  assertKey(parsed.key);
  switch (parsed.kind) {
    case "account":
      return StrKey.encodeEd25519PublicKey(Buffer.from(parsed.key));
    case "contract":
      return StrKey.encodeContract(Buffer.from(parsed.key));
    case "muxed": {
      if (parsed.muxedId < 0n || parsed.muxedId > MAX_U64) {
        throw invalid(
          `muxed id must fit in an unsigned 64-bit integer, got ${String(parsed.muxedId)}`,
        );
      }
      const raw = new Uint8Array(KEY_BYTES + MUXED_ID_BYTES);
      raw.set(parsed.key, 0);
      writeU64BE(raw, KEY_BYTES, parsed.muxedId);
      return StrKey.encodeMed25519PublicKey(Buffer.from(raw));
    }
  }
}

export function isStellarAddress(value: string): boolean {
  try {
    parseStellarAddress(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * C… contract strkey -> its 32-byte contract id.
 * This is the encoding CCTP needs for `mint_recipient` / `destination_caller` when
 * they point at the CctpForwarder contract (see VERIFIED.md). Refuses G and M input.
 */
export function contractAddressToBytes32(strkey: string): Uint8Array {
  const parsed = parseStellarAddress(strkey);
  if (parsed.kind !== "contract") {
    throw invalid(`expected a C… contract address, got a ${parsed.kind} address`);
  }
  return parsed.key;
}

export function bytes32ToContractAddress(bytes: Uint8Array): string {
  assertKey(bytes);
  return formatStellarAddress({ kind: "contract", key: bytes });
}

/** G… account strkey -> its 32-byte ed25519 public key. Refuses C and M input. */
export function accountAddressToBytes32(strkey: string): Uint8Array {
  const parsed = parseStellarAddress(strkey);
  if (parsed.kind !== "account") {
    throw invalid(`expected a G… account address, got a ${parsed.kind} address`);
  }
  return parsed.key;
}

export function bytes32ToAccountAddress(bytes: Uint8Array): string {
  assertKey(bytes);
  return formatStellarAddress({ kind: "account", key: bytes });
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_PAD_BYTES = 12;

/**
 * 20-byte EVM address -> bytes32, left-padded with 12 zero bytes.
 * Verified 2026-09-11 against a real Stellar->Polygon USDT0 send: `SendParam.to` in mainnet tx
 * 9d130f64… was 12 zero bytes + 0xe4b5fcce…301f, and the Polygon receipt shows 1.000000 USDT
 * minted to exactly that address. See packages/core/VERIFIED.md §2.4.
 */
export function evmAddressToBytes32(hex: string): Uint8Array {
  if (!EVM_ADDRESS.test(hex)) {
    throw invalid(`"${abbreviate(hex)}" is not a 0x-prefixed 20-byte hex EVM address`);
  }
  const out = new Uint8Array(KEY_BYTES);
  const body = hex.slice(2);
  for (let i = 0; i < 20; i += 1) {
    out[EVM_PAD_BYTES + i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** bytes32 -> 0x EVM address. Throws if the 12 padding bytes are not all zero. */
export function bytes32ToEvmAddress(bytes: Uint8Array): `0x${string}` {
  assertKey(bytes);
  for (let i = 0; i < EVM_PAD_BYTES; i += 1) {
    if (bytes[i] !== 0) {
      throw invalid("bytes32 is not a left-padded EVM address: padding bytes are not zero");
    }
  }
  let hex = "0x";
  for (let i = EVM_PAD_BYTES; i < KEY_BYTES; i += 1) {
    hex += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return hex as `0x${string}`;
}
