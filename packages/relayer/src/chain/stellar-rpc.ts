import type { StellarRpc } from "@ferryline/sdk";
import type { FeeBumpTransaction, Transaction } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";

/**
 * `StellarRpc` (from @ferryline/sdk) is read/simulate-only — the SDK never itself broadcasts, it
 * hands unsigned XDR to a caller's wallet. The relayer is the first Ferryline component that
 * actually submits transactions, so it needs one more method. Extending (not replacing) the SDK's
 * interface means every SDK helper that takes a `StellarRpc` (buildInvocation, nonceUsed, ...)
 * accepts a `RelayerStellarRpc` too, structurally, with no adapter shim.
 */
export interface RelayerStellarRpc extends StellarRpc {
  sendTransaction(tx: Transaction | FeeBumpTransaction): Promise<Api.SendTransactionResponse>;
}

export function createRelayerStellarRpc(rpcUrl: string): RelayerStellarRpc {
  return new Server(rpcUrl);
}

export { Api };
