/**
 * Real `Ferryline` construction, one instance per widget element, with the real rail adapters
 * registered per network:
 *
 *  - `usdc-cctp` is ALWAYS registered — it is the only rail with a real Stellar testnet deployment
 *    (confirmed repeatedly across prior phases; see packages/core/VERIFIED.md), so it's the one
 *    rail this widget can complete end to end on testnet today.
 *  - `usdt0-layerzero` is registered ONLY for `network: "mainnet"`. This is not a widget-level
 *    policy check — `Usdt0LayerZeroAdapter`'s own constructor throws `ROUTE_UNSUPPORTED` for
 *    anything but `"mainnet"`, and its options type is literally `{ readonly network: "mainnet" }`
 *    (not a `"testnet" | "mainnet"` union). Attempting to construct it for testnet is a **compile-time**
 *    error, not a runtime one — so this module simply never attempts the construction in testnet
 *    mode, rather than constructing-then-catching. This is what "must not be offered as if it works
 *    when it structurally can't" (STEP 2 assignment) means at the code level: there is no code path
 *    where a testnet widget instance even holds a USDT0 adapter to accidentally route to.
 */
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { createPublicClient, http } from "viem";
import { sepolia, mainnet, arbitrum, base, polygon } from "viem/chains";

import {
  Ferryline,
  InMemoryTransferStore,
  UsdcCctpAdapter,
  Usdt0LayerZeroAdapter,
  type EvmReader,
  type FerrylineNetwork,
  type RailId,
  type StellarRpc,
  type TransferStore,
} from "@ferryline/sdk";

const NETWORK_PASSPHRASE: Readonly<Record<FerrylineNetwork, string>> = {
  testnet: "Test SDF Network ; September 2015",
  mainnet: "Public Global Stellar Network ; September 2015",
};

export interface WidgetClientConfig {
  readonly network: FerrylineNetwork;
  /** Stellar RPC endpoint. Testnet default: Soroban RPC's public testnet endpoint. */
  readonly rpcUrl?: string;
  /** Ferryline relayer endpoint — needed for inbound (EVM -> Stellar) CCTP tracking. */
  readonly relayerUrl?: string;
  readonly store?: TransferStore;
}

const DEFAULT_RPC_URL: Readonly<Record<FerrylineNetwork, string>> = {
  testnet: "https://soroban-testnet.stellar.org",
  mainnet: "https://mainnet.sorobanrpc.com",
};

/** viem chain configs keyed by the SDK's own ChainSlug strings, so both sides agree on names. */
const EVM_CHAINS_BY_SLUG = {
  ethereum: mainnet,
  arbitrum,
  base,
  polygon,
  "ethereum-sepolia": sepolia,
} as const;

export type EvmChainSlug = keyof typeof EVM_CHAINS_BY_SLUG;

function buildEvmReaders(): Readonly<Partial<Record<string, EvmReader>>> {
  const readers: Record<string, EvmReader> = {};
  for (const [slug, chain] of Object.entries(EVM_CHAINS_BY_SLUG)) {
    // viem's PublicClient structurally satisfies EvmReader (readContract + getBalance with matching
    // signatures) — confirmed directly against @ferryline/sdk's own EvmReader interface, the same
    // real client shape STEP 1's inbound seam script used via createPublicClient({ chain: sepolia }).
    readers[slug] = createPublicClient({ chain, transport: http() });
  }
  return readers;
}

export interface WidgetClient {
  readonly ferryline: Ferryline;
  /** Rails actually registered for this network — "usdt0-layerzero" only ever appears for mainnet. */
  readonly availableRails: readonly RailId[];
  readonly networkPassphrase: string;
  /**
   * Submits an already-signed Stellar envelope via the real RPC client and returns the real,
   * network-issued transaction hash. Lives on `WidgetClient` (not called ad hoc from index.ts)
   * specifically so component tests can substitute a fake here instead of hitting a real RPC
   * endpoint — see index.test.ts's own client fixture.
   */
  submitStellarTransaction(signedXdr: string): Promise<string>;
}

/** Builds one real Ferryline instance, with real adapters, for the given network. */
export function createWidgetClient(config: WidgetClientConfig): WidgetClient {
  const rpcUrl = config.rpcUrl ?? DEFAULT_RPC_URL[config.network];
  // `server` is the real, full rpc.Server (has `sendTransaction`, which the SDK's own narrower
  // `StellarRpc` interface deliberately omits — building/simulating never submits, see rpc.ts's own
  // doc comments). `stellarRpc` is the same instance, narrowed to what the adapters need.
  const server = new Server(rpcUrl);
  const stellarRpc: StellarRpc = server;
  const store = config.store ?? new InMemoryTransferStore();
  const evmReaders = buildEvmReaders();
  const networkPassphrase = NETWORK_PASSPHRASE[config.network];

  const ferryline = new Ferryline({
    network: config.network,
    rpcUrl,
    store,
    // exactOptionalPropertyTypes forbids `relayerUrl: undefined` explicitly — the property is
    // either present with a real string or absent entirely, matching FerrylineConfig's own
    // `relayerUrl?: string` (never `string | undefined`).
    ...(config.relayerUrl !== undefined ? { relayerUrl: config.relayerUrl } : {}),
  });

  ferryline.registerAdapter(
    new UsdcCctpAdapter({ network: config.network, stellarRpc, store, evmReaders }),
  );

  if (config.network === "mainnet") {
    // Only reachable in this branch: `config.network` is narrowed to the literal "mainnet" here,
    // which is the ONLY value Usdt0LayerZeroAdapter's constructor accepts — see this module's own
    // doc comment above for why there is no equivalent branch for "testnet".
    ferryline.registerAdapter(
      new Usdt0LayerZeroAdapter({ network: config.network, stellarRpc, store, evmReaders }),
    );
  }

  return {
    ferryline,
    availableRails: ferryline.rails(),
    networkPassphrase,
    async submitStellarTransaction(signedXdr: string): Promise<string> {
      const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      if (!("operations" in tx)) {
        throw new Error(
          "submitStellarTransaction: expected a plain (non-fee-bump) transaction envelope",
        );
      }
      const sent = await server.sendTransaction(tx);
      if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
        throw new Error(
          `submission rejected: ${sent.status}${"errorResult" in sent && sent.errorResult ? ` (${sent.errorResult.toXDR("base64")})` : ""}`,
        );
      }
      // Real, load-bearing wait: `sendTransaction` returns as soon as the network accepts the
      // envelope into its mempool, well before ledger inclusion — NOT confirmation. A caller that
      // treats this hash as "confirmed" and immediately calls `prepareStep` for a step whose build
      // depends on this one's on-chain effect (e.g. an approve's allowance, before the burn that
      // spends it) will get a real, correct rejection from the SDK, discovered directly during this
      // phase's own real E2E run: "the TokenMessengerMinter may spend 0.0000000 USDC ... but the
      // burn needs 0.5000000; submit the approve step and wait for it to confirm before preparing
      // the burn." Same real wait-for-confirmation pattern as STEP 1's proven outbound seam script
      // (experiments/widget-seam-outbound-cctp.ts's own waitForTransaction).
      const status = await waitForStellarConfirmation(server, sent.hash);
      if (status !== "SUCCESS") {
        throw new Error(`transaction ${sent.hash} did not succeed: ${status}`);
      }
      return sent.hash;
    },
  };
}

/**
 * Exported (not just internal to submitStellarTransaction) specifically so this real,
 * previously-missing wait can be unit-tested directly against a fake `Server`-shaped object,
 * without needing a full `createWidgetClient` call — see client.test.ts. Only `getTransaction` is
 * used, so the fake only needs to satisfy that one method.
 */
export async function waitForStellarConfirmation(
  server: Pick<Server, "getTransaction">,
  hash: string,
  maxAttempts = 40,
  pollIntervalMs = 1500,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const result = await server.getTransaction(hash);
    if (result.status !== Api.GetTransactionStatus.NOT_FOUND) {
      return result.status;
    }
  }
  throw new Error(
    `transaction ${hash} not found after ${String((maxAttempts * pollIntervalMs) / 1000)}s`,
  );
}
