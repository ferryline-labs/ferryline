import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { envSecretEvmSigner } from "./env-secret-evm-signer.js";

/**
 * The EVM mirror of env-secret-signer.test.ts's own sign-off standard: FERRYLINE_OUTBOUND_SPONSOR_SECRET
 * is the single most safety-critical required var in the outbound relayer — it is the actual signing
 * key. This confirms envSecretEvmSigner genuinely refuses to construct a signer without a real,
 * well-formed key (no default, no silently-generated throwaway key), the same "refusal is tested,
 * not just documented" bar every money-related config value in this project is held to.
 */
describe("envSecretEvmSigner", () => {
  it("constructs a working signer whose address matches the secret's real account, when the var is set", () => {
    const privateKey = generatePrivateKey();
    const expectedAddress = privateKeyToAccount(privateKey).address;

    const signer = envSecretEvmSigner({ FERRYLINE_OUTBOUND_SPONSOR_SECRET: privateKey });

    expect(signer.account.address).toBe(expectedAddress);
    return expect(signer.address()).resolves.toBe(expectedAddress);
  });

  it("throws (does not fall back to any default, does not silently generate a throwaway key) when FERRYLINE_OUTBOUND_SPONSOR_SECRET is entirely unset", () => {
    expect(() => envSecretEvmSigner({})).toThrow(/FERRYLINE_OUTBOUND_SPONSOR_SECRET is required/);
  });

  it("throws when FERRYLINE_OUTBOUND_SPONSOR_SECRET is set to an empty string", () => {
    expect(() => envSecretEvmSigner({ FERRYLINE_OUTBOUND_SPONSOR_SECRET: "" })).toThrow(
      /FERRYLINE_OUTBOUND_SPONSOR_SECRET is required/,
    );
  });

  it("throws when the value is set but is not a well-formed 0x-prefixed 32-byte hex key (not a valid key, or the wrong length)", () => {
    expect(() =>
      envSecretEvmSigner({ FERRYLINE_OUTBOUND_SPONSOR_SECRET: "not-a-real-key" }),
    ).toThrow(/must be a 0x-prefixed 32-byte/);

    // A real Stellar secret seed (a genuinely different, real-looking credential shape) must not be
    // silently accepted here either — confirms this checks the EVM key's own real shape, not merely
    // "is this some non-empty string".
    expect(() =>
      envSecretEvmSigner({
        FERRYLINE_OUTBOUND_SPONSOR_SECRET:
          "SBZVMB74Z5EWZJVXTFAMLCX7BWY6XCD5EYQZUKC55N3RQTOP2S6RA5PT",
      }),
    ).toThrow(/must be a 0x-prefixed 32-byte/);

    // One byte short of the real 32-byte length.
    expect(() =>
      envSecretEvmSigner({ FERRYLINE_OUTBOUND_SPONSOR_SECRET: `0x${"ab".repeat(31)}` }),
    ).toThrow(/must be a 0x-prefixed 32-byte/);
  });
});
