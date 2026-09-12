import { nonceUsed } from "@ferryline/sdk";
import { Buffer } from "buffer";

import type { RelayerStellarRpc } from "./stellar-rpc.js";

/**
 * Wraps @ferryline/sdk's `nonceUsed` (MessageTransmitter.is_nonce_used) with the relayer's own hex
 * nonce string and a read-only simulation source. `sourceAccount` must be a real G-address account
 * (Stellar's `Account` type requires an ed25519 public key — a contract id is not valid here, even
 * though the contract itself exists; this was gotten wrong once already while building this file's
 * own tests, see reconcile.integration.test.ts). It is never a signer: this is a simulated view
 * call, the account only needs to exist to fund the simulation's footprint. The relayer's own
 * sponsor account (always funded, since it pays every fee-bump) is the natural choice at call sites.
 */
export async function nonceIsUsedOnStellar(
  rpc: RelayerStellarRpc,
  networkPassphrase: string,
  messageTransmitterContractId: string,
  nonceHex: string,
  sourceAccount: string,
): Promise<boolean> {
  const clean = nonceHex.startsWith("0x") ? nonceHex.slice(2) : nonceHex;
  const nonce = new Uint8Array(Buffer.from(clean, "hex"));
  const source = await rpc.getAccount(sourceAccount);
  return nonceUsed({ rpc, source, networkPassphrase }, messageTransmitterContractId, nonce);
}
