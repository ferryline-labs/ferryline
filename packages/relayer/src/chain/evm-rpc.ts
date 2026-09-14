import { MESSAGE_TRANSMITTER_V2_ABI, type EvmReader } from "@ferryline/sdk";
import type { Chain, Hash, SimulateContractReturnType, TransactionReceipt } from "viem";
import { createPublicClient, createWalletClient, http, type PrivateKeyAccount } from "viem";

/** The prepared, already-simulated request `writeReceiveMessage` broadcasts — viem's own return
 *  shape from `simulateContract`, narrowed to this one ABI/function so callers never need to know
 *  viem's generic machinery, only that "the thing simulateReceiveMessage returned" is what
 *  writeReceiveMessage accepts. */
export type ReceiveMessageRequest = SimulateContractReturnType<
  typeof MESSAGE_TRANSMITTER_V2_ABI,
  "receiveMessage"
>["request"];

/**
 * `RelayerEvmRpc` extends `@ferryline/sdk`'s own `EvmReader` (the same read-only slice the SDK's own
 * usdc-cctp adapter reads through for balance/allowance/usedNonces checks — see
 * packages/sdk/src/evm/reader.ts) with the write-capable operations the outbound relayer needs and
 * the SDK deliberately does not have: simulating (to catch a revert before spending gas on a doomed
 * submission), estimating real gas cost, and actually broadcasting `receiveMessage`. Same
 * "extend, don't replace" reasoning as chain/stellar-rpc.ts's own RelayerStellarRpc: every SDK
 * helper that takes an `EvmReader` still works against a RelayerEvmRpc with no adapter shim, since
 * it is one structurally.
 */
export interface RelayerEvmRpc extends EvmReader {
  /** Estimates the current real gas cost (in wei) of a `receiveMessage` call, for the per-transfer
   *  cap check — called BEFORE simulateReceiveMessage/writeReceiveMessage, so a transfer whose real,
   *  current cost exceeds the cap never reaches the point of being simulated or broadcast. */
  estimateReceiveMessageGasCostWei(args: {
    messageTransmitterV2: `0x${string}`;
    message: `0x${string}`;
    attestation: `0x${string}`;
    account: `0x${string}`;
  }): Promise<bigint>;

  /**
   * Simulates `receiveMessage(message, attestation)` against current chain state, returning the
   * prepared request viem's own `writeContract` needs. Throws if the call would revert (e.g. the
   * nonce is already used, the message is malformed) — this is the ONE place a doomed submission is
   * caught before any gas is spent broadcasting it, mirroring stellar-rpc.ts's own real-network
   * simulate-before-broadcast discipline for the Stellar side.
   */
  simulateReceiveMessage(args: {
    messageTransmitterV2: `0x${string}`;
    message: `0x${string}`;
    attestation: `0x${string}`;
  }): Promise<{ request: ReceiveMessageRequest }>;

  /** Broadcasts an already-simulated `receiveMessage` request, returning immediately with the real
   *  transaction hash (does not wait for confirmation — see waitForReceipt for that, called
   *  separately so the crash-safe "write submitting with the real hash BEFORE waiting" ordering the
   *  crash-recovery contract depends on stays possible). */
  writeReceiveMessage(request: ReceiveMessageRequest): Promise<Hash>;

  /** Waits for a broadcast transaction's receipt (confirmation or revert). */
  waitForReceipt(hash: Hash): Promise<TransactionReceipt>;
}

export function createRelayerEvmRpc(params: {
  chain: Chain;
  rpcUrl: string;
  account: PrivateKeyAccount;
}): RelayerEvmRpc {
  const publicClient = createPublicClient({ chain: params.chain, transport: http(params.rpcUrl) });
  const walletClient = createWalletClient({
    account: params.account,
    chain: params.chain,
    transport: http(params.rpcUrl),
  });

  return {
    readContract: (args) => publicClient.readContract(args),
    getBalance: (args) => publicClient.getBalance(args),

    async estimateReceiveMessageGasCostWei({
      messageTransmitterV2,
      message,
      attestation,
      account,
    }) {
      const [gasEstimate, gasPrice] = await Promise.all([
        publicClient.estimateContractGas({
          address: messageTransmitterV2,
          abi: MESSAGE_TRANSMITTER_V2_ABI,
          functionName: "receiveMessage",
          args: [message, attestation],
          account,
        }),
        publicClient.getGasPrice(),
      ]);
      return gasEstimate * gasPrice;
    },

    async simulateReceiveMessage({ messageTransmitterV2, message, attestation }) {
      const { request } = await publicClient.simulateContract({
        account: params.account,
        address: messageTransmitterV2,
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: "receiveMessage",
        args: [message, attestation],
      });
      return { request: request as never };
    },

    writeReceiveMessage(request) {
      return walletClient.writeContract(request as never);
    },

    waitForReceipt(hash) {
      return publicClient.waitForTransactionReceipt({ hash });
    },
  };
}
