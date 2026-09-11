import type {
  BuiltTransfer,
  Quote,
  RailAdapter,
  RailId,
  TransferId,
  TransferRequest,
  TransferStatus,
  TransferStore,
} from "@ferryline/core";
import { FerrylineError, InMemoryTransferStore } from "@ferryline/core";

export type FerrylineNetwork = "mainnet" | "testnet";

export interface FerrylineConfig {
  readonly network: FerrylineNetwork;
  /** Stellar RPC endpoint. */
  readonly rpcUrl: string;
  /** Ferryline relayer endpoint, needed for inbound USDC. Optional until the relayer exists. */
  readonly relayerUrl?: string;
  /** Where transfers are remembered between build() and track(). Defaults to in-memory. */
  readonly store?: TransferStore;
}

/**
 * Routes requests to registered rail adapters. Holds no rail-specific logic itself.
 * Adapters are registered explicitly (nothing is wired by default yet) so that the
 * money-moving code paths are opt-in and reviewable one rail at a time.
 */
export class Ferryline {
  readonly config: FerrylineConfig;
  readonly store: TransferStore;
  private readonly adapters = new Map<RailId, RailAdapter>();

  constructor(config: FerrylineConfig) {
    this.config = config;
    this.store = config.store ?? new InMemoryTransferStore();
  }

  registerAdapter(adapter: RailAdapter): this {
    if (this.adapters.has(adapter.rail)) {
      throw new FerrylineError(
        "ADAPTER_CONFLICT",
        `an adapter for rail "${adapter.rail}" is already registered`,
      );
    }
    this.adapters.set(adapter.rail, adapter);
    return this;
  }

  rails(): readonly RailId[] {
    return [...this.adapters.keys()];
  }

  async quote(request: TransferRequest): Promise<Quote> {
    return await this.adapterFor(request).quote(request);
  }

  async build(quote: Quote): Promise<BuiltTransfer> {
    return await this.adapterByRail(quote.rail).build(quote);
  }

  /** Tell Ferryline which hash the wallet got back after submitting the first step. */
  markSubmitted(transferId: TransferId, sourceTxHash: string): Promise<void> {
    return this.store.markSubmitted(transferId, sourceTxHash);
  }

  async *track(transferId: TransferId, signal?: AbortSignal): AsyncIterable<TransferStatus> {
    const record = await this.store.get(transferId);
    if (!record) {
      throw new FerrylineError("TRANSFER_UNKNOWN", `no transfer with id ${transferId}`);
    }
    yield* this.adapterByRail(record.rail).track(transferId, signal);
  }

  private adapterFor(request: TransferRequest): RailAdapter {
    for (const adapter of this.adapters.values()) {
      if (adapter.supports(request)) {
        return adapter;
      }
    }
    throw new FerrylineError(
      "ROUTE_UNSUPPORTED",
      `no registered rail moves ${request.asset} from ${request.from.chain} to ${request.to.chain}`,
    );
  }

  private adapterByRail(rail: RailId): RailAdapter {
    const adapter = this.adapters.get(rail);
    if (!adapter) {
      throw new FerrylineError("ROUTE_UNSUPPORTED", `no adapter registered for rail "${rail}"`);
    }
    return adapter;
  }
}

export type {
  Amount,
  AssetSymbol,
  BuiltTransfer,
  ChainAddress,
  Fee,
  PreflightCheck,
  Quote,
  RailAdapter,
  RailId,
  TransferId,
  TransferRequest,
  TransferStage,
  TransferStatus,
  TransferStep,
  TransferStore,
} from "@ferryline/core";
export { FerrylineError, InMemoryTransferStore } from "@ferryline/core";

export * from "./rails/usdt0-layerzero/index.js";
