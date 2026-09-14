import { privateKeyToAccount } from "viem/accounts";

import type { EvmSigner } from "./evm-types.js";

/**
 * MVP EvmSigner: a hot key read from an environment variable at startup — the EVM mirror of
 * env-secret-signer.ts's own EnvSecretSigner, same discipline exactly: this is the ONLY file in the
 * outbound relayer that reads FERRYLINE_OUTBOUND_SPONSOR_SECRET or calls viem's privateKeyToAccount
 * on a raw hex key. Every other module receives an EvmSigner (or, more commonly, a RelayerEvmRpc
 * already constructed from one — see chain/evm-rpc.ts's createRelayerEvmRpc) and never touches the
 * raw key itself. Swapping this for a KMS/HSM-backed signer later means writing one new file that
 * implements `EvmSigner` and changing one line of wiring in main.ts — identical property to the
 * Stellar signer's own doc comment, same reason it is shaped this way.
 */
export class EnvSecretEvmSigner implements EvmSigner {
  readonly account: ReturnType<typeof privateKeyToAccount>;

  constructor(privateKeyHex: `0x${string}`) {
    this.account = privateKeyToAccount(privateKeyHex);
  }

  address(): Promise<`0x${string}`> {
    return Promise.resolve(this.account.address);
  }
}

const HEX_PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * Reads FERRYLINE_OUTBOUND_SPONSOR_SECRET from `env`. Throws with a clear message (no default, no
 * fallback, no "generate one for me") if it is unset or not a well-formed 32-byte hex private key —
 * the relayer must refuse to start rather than run keyless or with a silently generated throwaway
 * key, the exact same reasoning as envSecretSigner's own doc comment for the Stellar side.
 */
export function envSecretEvmSigner(env: NodeJS.ProcessEnv): EnvSecretEvmSigner {
  const secret = env["FERRYLINE_OUTBOUND_SPONSOR_SECRET"];
  if (!secret) {
    throw new Error(
      "FERRYLINE_OUTBOUND_SPONSOR_SECRET is required (a 0x-prefixed 32-byte hex EVM private key). " +
        "The outbound relayer signs and broadcasts every receiveMessage from this account; there is " +
        "no default.",
    );
  }
  if (!HEX_PRIVATE_KEY.test(secret)) {
    throw new Error(
      "FERRYLINE_OUTBOUND_SPONSOR_SECRET must be a 0x-prefixed 32-byte (64 hex character) EVM " +
        `private key, got a value of length ${String(secret.length)}.`,
    );
  }
  return new EnvSecretEvmSigner(secret as `0x${string}`);
}
