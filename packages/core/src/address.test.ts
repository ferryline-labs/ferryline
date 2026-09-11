import { Account, MuxedAccount, StrKey } from "@stellar/stellar-sdk/base";
import { Buffer } from "buffer";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  KEY_BYTES,
  accountAddressToBytes32,
  bytes32ToAccountAddress,
  bytes32ToContractAddress,
  bytes32ToEvmAddress,
  contractAddressToBytes32,
  evmAddressToBytes32,
  formatStellarAddress,
  isStellarAddress,
  parseStellarAddress,
  type ParsedStellarAddress,
} from "./address.js";
import { FerrylineError } from "./errors.js";

/** Addresses from Stellar's USDT0 launch page and Circle's Stellar contracts page, verified 2026-09-11. */
const USDT0_ISSUER = "GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q";
const USDT0_OFT = "CBOWOLFSDM5PZXNFIVDMP5NZ7U2GSIHED6H6R446QOHF266XINKUMMF6";
const CCTP_FORWARDER_MAINNET = "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_U64 = (1n << 64n) - 1n;

const key32 = fc.uint8Array({ minLength: KEY_BYTES, maxLength: KEY_BYTES });
const muxedId = fc.bigInt({ min: 0n, max: MAX_U64 });

const accountStrkey = key32.map((k) => StrKey.encodeEd25519PublicKey(Buffer.from(k)));
const contractStrkey = key32.map((k) => StrKey.encodeContract(Buffer.from(k)));
const muxedStrkey = fc.tuple(key32, muxedId).map(([k, id]) => {
  const raw = Buffer.alloc(40);
  Buffer.from(k).copy(raw, 0);
  raw.writeBigUInt64BE(id, 32);
  return StrKey.encodeMed25519PublicKey(raw);
});
const anyStrkey = fc.oneof(accountStrkey, contractStrkey, muxedStrkey);

function expectAddressError(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FerrylineError);
  expect((caught as FerrylineError).code).toBe("ADDRESS_INVALID");
}

describe("parseStellarAddress on known addresses", () => {
  it("classifies the USDT0 issuer as an account", () => {
    const parsed = parseStellarAddress(USDT0_ISSUER);
    expect(parsed.kind).toBe("account");
    expect(parsed.key).toHaveLength(KEY_BYTES);
    expect(formatStellarAddress(parsed)).toBe(USDT0_ISSUER);
  });

  it("classifies the USDT0 OFT and the CctpForwarder as contracts", () => {
    for (const address of [USDT0_OFT, CCTP_FORWARDER_MAINNET]) {
      const parsed = parseStellarAddress(address);
      expect(parsed.kind).toBe("contract");
      expect(bytes32ToContractAddress(contractAddressToBytes32(address))).toBe(address);
    }
  });

  it("agrees with stellar-base's MuxedAccount on the muxed layout (key then big-endian id)", () => {
    const muxed = new MuxedAccount(new Account(USDT0_ISSUER, "0"), "1").accountId();
    const parsed = parseStellarAddress(muxed);
    expect(parsed.kind).toBe("muxed");
    if (parsed.kind !== "muxed") {
      throw new Error("unreachable");
    }
    expect(parsed.muxedId).toBe(1n);
    expect(Buffer.from(parsed.key).equals(StrKey.decodeEd25519PublicKey(USDT0_ISSUER))).toBe(true);
    expect(formatStellarAddress(parsed)).toBe(muxed);
  });
});

describe("round trips", () => {
  it("format(parse(x)) == x for random valid G, C and M addresses", () => {
    fc.assert(
      fc.property(anyStrkey, (strkey) => {
        expect(formatStellarAddress(parseStellarAddress(strkey))).toBe(strkey);
        expect(isStellarAddress(strkey)).toBe(true);
      }),
    );
  });

  it("parse(format(p)) deep-equals p for random parsed values", () => {
    const parsedArb: fc.Arbitrary<ParsedStellarAddress> = fc.oneof(
      key32.map((key): ParsedStellarAddress => ({ kind: "account", key })),
      key32.map((key): ParsedStellarAddress => ({ kind: "contract", key })),
      fc
        .tuple(key32, muxedId)
        .map(([key, id]): ParsedStellarAddress => ({ kind: "muxed", key, muxedId: id })),
    );
    fc.assert(
      fc.property(parsedArb, (parsed) => {
        expect(parseStellarAddress(formatStellarAddress(parsed))).toEqual(parsed);
      }),
    );
  });

  it("bytes32 helpers round-trip accounts and contracts", () => {
    fc.assert(
      fc.property(key32, (key) => {
        const g = bytes32ToAccountAddress(key);
        const c = bytes32ToContractAddress(key);
        expect(accountAddressToBytes32(g)).toEqual(key);
        expect(contractAddressToBytes32(c)).toEqual(key);
        expect(g.startsWith("G")).toBe(true);
        expect(c.startsWith("C")).toBe(true);
      }),
    );
  });
});

describe("malformed input throws instead of producing a plausible address", () => {
  it("any single-character substitution in a valid address is rejected", () => {
    fc.assert(
      fc.property(anyStrkey, fc.nat(), fc.constantFrom(...BASE32), (strkey, seed, replacement) => {
        const index = seed % strkey.length;
        fc.pre(strkey[index] !== replacement);
        const mutated = strkey.slice(0, index) + replacement + strkey.slice(index + 1);
        expectAddressError(() => parseStellarAddress(mutated));
        expect(isStellarAddress(mutated)).toBe(false);
      }),
    );
  });

  it("truncated, extended, lower-cased and empty input is rejected", () => {
    fc.assert(
      fc.property(anyStrkey, (strkey) => {
        expectAddressError(() => parseStellarAddress(strkey.slice(0, -1)));
        expectAddressError(() => parseStellarAddress(`${strkey}A`));
        expectAddressError(() => parseStellarAddress(strkey.toLowerCase()));
      }),
    );
    expectAddressError(() => parseStellarAddress(""));
    expectAddressError(() => parseStellarAddress("not an address"));
    expectAddressError(() => parseStellarAddress(USDT0_ISSUER.slice(0, 20)));
  });

  it("rejects non-string input at runtime", () => {
    expectAddressError(() => parseStellarAddress(undefined as unknown as string));
    expectAddressError(() => parseStellarAddress(42 as unknown as string));
  });

  it("rejects secret seeds and other strkey types even though they are well-formed", () => {
    const seed = StrKey.encodeEd25519SecretSeed(Buffer.alloc(32, 7));
    expect(seed.startsWith("S")).toBe(true);
    expectAddressError(() => parseStellarAddress(seed));
  });

  it("kind-specific helpers refuse the other kinds", () => {
    const muxed = new MuxedAccount(new Account(USDT0_ISSUER, "0"), "5").accountId();
    expectAddressError(() => contractAddressToBytes32(USDT0_ISSUER));
    expectAddressError(() => contractAddressToBytes32(muxed));
    expectAddressError(() => accountAddressToBytes32(USDT0_OFT));
    expectAddressError(() => accountAddressToBytes32(muxed));
  });

  it("bytes32 helpers reject wrong lengths", () => {
    expectAddressError(() => bytes32ToAccountAddress(new Uint8Array(31)));
    expectAddressError(() => bytes32ToContractAddress(new Uint8Array(33)));
    expectAddressError(() => bytes32ToEvmAddress(new Uint8Array(20)));
  });

  it("rejects a muxed id outside u64 when formatting", () => {
    const key = new Uint8Array(KEY_BYTES);
    expectAddressError(() => formatStellarAddress({ kind: "muxed", key, muxedId: MAX_U64 + 1n }));
    expectAddressError(() => formatStellarAddress({ kind: "muxed", key, muxedId: -1n }));
  });
});

describe("EVM address <-> bytes32 (proposed, see report)", () => {
  const evmHex = fc
    .uint8Array({ minLength: 20, maxLength: 20 })
    .map((bytes) => `0x${Buffer.from(bytes).toString("hex")}` as const);

  it("left-pads with 12 zero bytes and round-trips", () => {
    fc.assert(
      fc.property(evmHex, (hex) => {
        const bytes = evmAddressToBytes32(hex);
        expect(bytes).toHaveLength(KEY_BYTES);
        expect(Array.from(bytes.slice(0, 12)).every((b) => b === 0)).toBe(true);
        expect(bytes32ToEvmAddress(bytes)).toBe(hex);
      }),
    );
  });

  it("accepts mixed-case hex and normalises to lower-case on the way back", () => {
    const mixed = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
    expect(bytes32ToEvmAddress(evmAddressToBytes32(mixed))).toBe(mixed.toLowerCase());
  });

  it("rejects malformed hex and non-zero padding", () => {
    expectAddressError(() => evmAddressToBytes32("0x1234"));
    expectAddressError(() => evmAddressToBytes32("1234567890123456789012345678901234567890"));
    expectAddressError(() => evmAddressToBytes32("0xZZ34567890123456789012345678901234567890"));
    const dirty = new Uint8Array(KEY_BYTES);
    dirty[0] = 1;
    expectAddressError(() => bytes32ToEvmAddress(dirty));
  });
});
