/* Test double for RelayerEvmRpc. Not shipped: not reachable from src/index.ts. */
import type { ReceiveMessageRequest, RelayerEvmRpc } from "./evm-rpc.js";

/**
 * Unlike FakeRelayerStellarRpc (which replays a REAL recorded mainnet `is_nonce_used` simulation —
 * see that file's own doc comment and src/chain/__fixtures__/), this fake is deliberately synthetic:
 * this relayer has not yet made any real call against a real EVM MessageTransmitterV2 (that real
 * proof is STEP 6's own testnet run, not this unit-level test double). What this fake DOES test
 * honestly is the same thing FakeRelayerStellarRpc's own doc comment names as its real job: the
 * state machine's handling of used/unused nonces and broadcast outcomes, driven by a
 * caller-controlled verdict map, not a claim about Circle's real on-chain behavior.
 *
 * `usedNonces` verdicts are set per-nonce via the constructor (mirroring the real, verified
 * MESSAGE_TRANSMITTER_V2_ABI's own `usedNonces(bytes32) view returns (uint256)` shape: 0n = unused,
 * nonzero = used — real ABI from @ferryline/sdk, only the RETURNED VALUES here are synthetic).
 */
export class FakeRelayerEvmRpc implements RelayerEvmRpc {
  readonly broadcastCalls: ReceiveMessageRequest[] = [];
  nextGasCostWei = 100_000_000_000_000n; // 0.0001 ETH-equivalent, an arbitrary but realistic-shaped default
  nextSimulateShouldRevert = false;
  nextWaitForReceiptStatus: "success" | "reverted" = "success";
  /** Overridable per-instance so healthz-style "balance unknown" tests can simulate an RPC failure
   *  without changing every other test's default happy-path balance. */
  nextGetBalanceShouldFail = false;

  constructor(private readonly nonceVerdicts: ReadonlyMap<string, bigint>) {}

  readContract(args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown> {
    if (args.functionName !== "usedNonces") {
      throw new Error(
        `FakeRelayerEvmRpc.readContract only replays usedNonces calls, got "${args.functionName}"`,
      );
    }
    const nonce = args.args?.[0] as string | undefined;
    if (!nonce || !this.nonceVerdicts.has(nonce)) {
      throw new Error(
        `FakeRelayerEvmRpc: no configured usedNonces verdict for nonce ${String(nonce)}. ` +
          `Configured nonces: ${[...this.nonceVerdicts.keys()].join(", ")}`,
      );
    }
    return Promise.resolve(this.nonceVerdicts.get(nonce)!);
  }

  getBalance(): Promise<bigint> {
    if (this.nextGetBalanceShouldFail) {
      return Promise.reject(new Error("FakeRelayerEvmRpc: simulated getBalance failure"));
    }
    return Promise.resolve(1_000_000_000_000_000_000n); // 1 ETH-equivalent
  }

  estimateReceiveMessageGasCostWei(): Promise<bigint> {
    return Promise.resolve(this.nextGasCostWei);
  }

  simulateReceiveMessage(): Promise<{ request: ReceiveMessageRequest }> {
    if (this.nextSimulateShouldRevert) {
      throw new Error(
        "FakeRelayerEvmRpc: simulated revert (nonce already used, or malformed message)",
      );
    }
    // A minimal, structurally-real-enough stand-in — this fake's callers only ever pass this value
    // straight to writeReceiveMessage, which is also this fake, so its internal shape never needs to
    // satisfy viem's own real generic constraints the way the production createRelayerEvmRpc does.
    return Promise.resolve({ request: {} as ReceiveMessageRequest });
  }

  writeReceiveMessage(request: ReceiveMessageRequest): Promise<`0x${string}`> {
    this.broadcastCalls.push(request);
    const hash: `0x${string}` = "0xabababababababababababababababababababababababababababababab";
    return Promise.resolve(hash);
  }

  waitForReceipt(): ReturnType<RelayerEvmRpc["waitForReceipt"]> {
    return Promise.resolve({
      status: this.nextWaitForReceiptStatus,
    } as unknown as Awaited<ReturnType<RelayerEvmRpc["waitForReceipt"]>>);
  }
}
