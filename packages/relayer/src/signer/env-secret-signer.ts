import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

import type { Signer } from "./types.js";

/**
 * MVP Signer: a hot key read from an environment variable at startup. This is the ONLY file in the
 * relayer that reads FERRYLINE_SPONSOR_SECRET or constructs a Keypair from a raw secret — every
 * other module receives a `Signer` and calls .sign()/.publicKey() on it. Swapping this for a
 * KMS/HSM-backed signer later means writing one new file that implements `Signer` and changing one
 * line of wiring in main.ts; nothing in work/, http/, or repo/ needs to change.
 */
export class EnvSecretSigner implements Signer {
  private readonly keypair: Keypair;
  private readonly networkPassphrase: string;

  constructor(secret: string, networkPassphrase: string) {
    this.keypair = Keypair.fromSecret(secret);
    this.networkPassphrase = networkPassphrase;
  }

  publicKey(): Promise<string> {
    return Promise.resolve(this.keypair.publicKey());
  }

  sign(unsignedEnvelopeXdr: string): Promise<string> {
    const tx = TransactionBuilder.fromXDR(unsignedEnvelopeXdr, this.networkPassphrase);
    tx.sign(this.keypair);
    return Promise.resolve(tx.toXDR());
  }
}

/**
 * Reads FERRYLINE_SPONSOR_SECRET from `env`. Throws with a clear message (no default, no fallback,
 * no "generate one for me") if it is unset — the relayer must refuse to start rather than run
 * keyless or, worse, with a silently generated throwaway key that holds no funds and fools no one.
 */
export function envSecretSigner(
  env: NodeJS.ProcessEnv,
  networkPassphrase: string,
): EnvSecretSigner {
  const secret = env["FERRYLINE_SPONSOR_SECRET"];
  if (!secret) {
    throw new Error(
      "FERRYLINE_SPONSOR_SECRET is required (a Stellar secret seed, S...). The relayer signs and " +
        "fee-bumps every mint_and_forward from this account; there is no default.",
    );
  }
  return new EnvSecretSigner(secret, networkPassphrase);
}
