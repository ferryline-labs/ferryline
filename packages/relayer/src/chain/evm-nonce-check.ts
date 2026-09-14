import { MESSAGE_TRANSMITTER_V2_ABI } from "@ferryline/sdk";

import type { RelayerEvmRpc } from "./evm-rpc.js";

/**
 * Wraps the real, verified `usedNonces(bytes32) view returns (uint256)` read (MESSAGE_TRANSMITTER_V2_ABI,
 * from @ferryline/sdk, checked against real Base mainnet proxy bytecode — see that file's own doc
 * comment) with the relayer's own hex-nonce-string convention. Mirrors chain/nonce-check.ts's own
 * "one small wrapper around a verified SDK primitive" shape for the Stellar side, adapted for the
 * real, different EVM contract semantics: `usedNonces` returns a plain uint256 (0 = unused, nonzero
 * = used — the real MessageTransmitterV2 source declares `uint256 public constant NONCE_USED = 1`
 * and writes exactly that value; this wrapper only checks nonzero, not `=== 1n`, in case a future
 * CCTP version ever uses a different nonzero sentinel — the contract's own invariant is "zero means
 * unused", not "exactly 1 means used"), not a boolean the way Stellar's is_nonce_used already is.
 */
export async function nonceIsUsedOnEvm(
  rpc: RelayerEvmRpc,
  messageTransmitterV2: `0x${string}`,
  nonceHex: `0x${string}`,
): Promise<boolean> {
  const used = (await rpc.readContract({
    address: messageTransmitterV2,
    abi: MESSAGE_TRANSMITTER_V2_ABI,
    functionName: "usedNonces",
    args: [nonceHex],
  })) as bigint;
  return used !== 0n;
}
