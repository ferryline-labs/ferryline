import { FerrylineError, contractAddressToBytes32, parseStellarAddress } from "@ferryline/core";
import { Buffer } from "buffer";

/**
 * CCTP V2 message layout, per Circle's technical guide (developers.circle.com/cctp/references/technical-guide,
 * 2026-09-11) and cross-checked against Circle's own `decodedMessage` for a real Stellar -> Base burn
 * (packages/core/verified/experiments/evidence/iris.mainnet.stellar-source-burn.150b5711.json).
 *
 * Header (148 bytes): version u32 | sourceDomain u32 | destinationDomain u32 | nonce 32 | sender 32 |
 *   recipient 32 | destinationCaller 32 | minFinalityThreshold u32 | finalityThresholdExecuted u32 | body…
 * BurnMessage body (228 bytes + hookData): version u32 | burnToken 32 | mintRecipient 32 | amount u256 |
 *   messageSender 32 | maxFee u256 | feeExecuted u256 | expirationBlock u256 | hookData…
 */
export interface CctpMessageHeader {
  readonly version: number;
  readonly sourceDomain: number;
  readonly destinationDomain: number;
  readonly nonce: `0x${string}`;
  readonly sender: Uint8Array;
  readonly recipient: Uint8Array;
  readonly destinationCaller: Uint8Array;
  readonly minFinalityThreshold: number;
  readonly finalityThresholdExecuted: number;
}

export interface CctpBurnBody {
  readonly version: number;
  readonly burnToken: Uint8Array;
  readonly mintRecipient: Uint8Array;
  /** 6-decimal USDC units regardless of chain (Circle: "always in six-decimal subunits"). */
  readonly amount: bigint;
  readonly messageSender: Uint8Array;
  readonly maxFee: bigint;
  readonly feeExecuted: bigint;
  readonly expirationBlock: bigint;
  readonly hookData: Uint8Array;
}

const HEADER_BYTES = 148;
const BODY_FIXED_BYTES = 228;

function u32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

function u256(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 32; i += 1) {
    value = (value << 8n) | BigInt(bytes[offset + i] ?? 0);
  }
  return value;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new FerrylineError("UPSTREAM_ERROR", "message is not valid hex");
  }
  return new Uint8Array(Buffer.from(clean, "hex"));
}

export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export function parseCctpBurnBody(body: Uint8Array): CctpBurnBody {
  if (body.length < BODY_FIXED_BYTES) {
    throw new FerrylineError(
      "UPSTREAM_ERROR",
      `burn message body is ${String(body.length)} bytes, expected at least ${String(BODY_FIXED_BYTES)}`,
    );
  }
  return {
    version: u32(body, 0),
    burnToken: body.slice(4, 36),
    mintRecipient: body.slice(36, 68),
    amount: u256(body, 68),
    messageSender: body.slice(100, 132),
    maxFee: u256(body, 132),
    feeExecuted: u256(body, 164),
    expirationBlock: u256(body, 196),
    hookData: body.slice(BODY_FIXED_BYTES),
  };
}

export function parseCctpMessage(messageHex: string): {
  header: CctpMessageHeader;
  body: CctpBurnBody;
} {
  const bytes = hexToBytes(messageHex);
  if (bytes.length < HEADER_BYTES) {
    throw new FerrylineError(
      "UPSTREAM_ERROR",
      `message is ${String(bytes.length)} bytes, expected at least ${String(HEADER_BYTES)}`,
    );
  }
  return {
    header: {
      version: u32(bytes, 0),
      sourceDomain: u32(bytes, 4),
      destinationDomain: u32(bytes, 8),
      nonce: bytesToHex(bytes.slice(12, 44)),
      sender: bytes.slice(44, 76),
      recipient: bytes.slice(76, 108),
      destinationCaller: bytes.slice(108, 140),
      minFinalityThreshold: u32(bytes, 140),
      finalityThresholdExecuted: u32(bytes, 144),
    },
    body: parseCctpBurnBody(bytes.slice(HEADER_BYTES)),
  };
}

/**
 * CctpForwarder hook data, per Circle's Stellar reference (VERIFIED.md §1.3) and confirmed against
 * three real inbound messages on mainnet (evidence/iris.mainnet.inbound-to-stellar.observed.json):
 *   bytes 0-23 zero (Circle-reserved) | u32 version = 0 | u32 L | forwardRecipient strkey as UTF-8 | optional payload
 */
export const HOOK_MAGIC_BYTES = 24;
export const HOOK_VERSION = 0;
const HOOK_HEADER_BYTES = 32;

export function buildForwarderHookData(
  forwardRecipient: string,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  // Any G, C or M strkey is a valid forward recipient (the forwarder emits MuxedAddress). Malformed input throws.
  parseStellarAddress(forwardRecipient);
  const recipientBytes = new TextEncoder().encode(forwardRecipient);
  const out = new Uint8Array(HOOK_HEADER_BYTES + recipientBytes.length + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(HOOK_MAGIC_BYTES, HOOK_VERSION);
  view.setUint32(HOOK_MAGIC_BYTES + 4, recipientBytes.length);
  out.set(recipientBytes, HOOK_HEADER_BYTES);
  out.set(payload, HOOK_HEADER_BYTES + recipientBytes.length);
  return out;
}

export interface ForwarderHookData {
  readonly version: number;
  readonly forwardRecipient: string;
  readonly payload: Uint8Array;
}

export function parseForwarderHookData(hookData: Uint8Array): ForwarderHookData {
  if (hookData.length < HOOK_HEADER_BYTES) {
    throw new FerrylineError(
      "UPSTREAM_ERROR",
      `hook data is ${String(hookData.length)} bytes, expected at least ${String(HOOK_HEADER_BYTES)}`,
    );
  }
  const view = new DataView(hookData.buffer, hookData.byteOffset, hookData.byteLength);
  const version = view.getUint32(HOOK_MAGIC_BYTES);
  const length = view.getUint32(HOOK_MAGIC_BYTES + 4);
  if (HOOK_HEADER_BYTES + length > hookData.length) {
    throw new FerrylineError("UPSTREAM_ERROR", "hook data length prefix exceeds the data");
  }
  const forwardRecipient = new TextDecoder().decode(
    hookData.slice(HOOK_HEADER_BYTES, HOOK_HEADER_BYTES + length),
  );
  parseStellarAddress(forwardRecipient);
  return { version, forwardRecipient, payload: hookData.slice(HOOK_HEADER_BYTES + length) };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The fund-stranding guard. For any burn whose destination is Stellar, both `mintRecipient` and
 * `destinationCaller` must be the CctpForwarder's 32-byte contract id (Circle: otherwise "funds become
 * permanently stuck and cannot be recovered"). Throws FORWARDER_FIELDS_INVALID on anything else.
 */
export function assertForwarderFields(
  fields: { mintRecipient: Uint8Array; destinationCaller: Uint8Array },
  forwarderContractId: string,
): void {
  const forwarder = contractAddressToBytes32(forwarderContractId);
  if (!equalBytes(fields.mintRecipient, forwarder)) {
    throw new FerrylineError(
      "FORWARDER_FIELDS_INVALID",
      `mintRecipient must be the CctpForwarder contract id ${forwarderContractId}; refusing to build a burn that would strand funds`,
    );
  }
  if (!equalBytes(fields.destinationCaller, forwarder)) {
    throw new FerrylineError(
      "FORWARDER_FIELDS_INVALID",
      `destinationCaller must be the CctpForwarder contract id ${forwarderContractId}; refusing to build a burn that would strand funds`,
    );
  }
}
