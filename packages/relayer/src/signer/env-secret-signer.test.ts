import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { envSecretSigner } from "./env-secret-signer.js";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

/**
 * STEP 6 sign-off: FERRYLINE_SPONSOR_SECRET is arguably the single most safety-critical required
 * var in the whole relayer — it is the actual signing key. This confirms envSecretSigner genuinely
 * refuses to construct a signer without it (no default, no silently-generated throwaway key), the
 * same "refusal is tested, not just documented" bar as the spend-cap config.
 */
describe("envSecretSigner", () => {
  it("constructs a working signer whose publicKey matches the secret's real keypair, when the var is set", async () => {
    const keypair = Keypair.random();
    const signer = envSecretSigner(
      { FERRYLINE_SPONSOR_SECRET: keypair.secret() },
      NETWORK_PASSPHRASE,
    );
    await expect(signer.publicKey()).resolves.toBe(keypair.publicKey());
  });

  it("throws (does not fall back to any default, does not silently generate a throwaway key) when FERRYLINE_SPONSOR_SECRET is entirely unset", () => {
    expect(() => envSecretSigner({}, NETWORK_PASSPHRASE)).toThrow(
      /FERRYLINE_SPONSOR_SECRET is required/,
    );
  });

  it("throws when FERRYLINE_SPONSOR_SECRET is set to an empty string", () => {
    expect(() => envSecretSigner({ FERRYLINE_SPONSOR_SECRET: "" }, NETWORK_PASSPHRASE)).toThrow(
      /FERRYLINE_SPONSOR_SECRET is required/,
    );
  });

  it("throws (via Keypair.fromSecret's own validation) when the value is set but is not a valid Stellar secret seed", () => {
    expect(() =>
      envSecretSigner({ FERRYLINE_SPONSOR_SECRET: "not-a-real-secret" }, NETWORK_PASSPHRASE),
    ).toThrow();
  });
});
