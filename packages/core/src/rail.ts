import type { Amount } from "./amount.js";
import type { TransferId } from "./transfer-id.js";

/** Assets Ferryline moves. Each maps to exactly one rail today. */
export type AssetSymbol = "USDT0" | "USDC";

/** Rails Ferryline speaks. Adapter implementations live in @ferryline/sdk, one per rail. */
export type RailId = "usdt0-layerzero" | "usdc-cctp";

/** Chain identifiers are lower-case slugs. "stellar" is the only one core knows about. */
export type ChainSlug = "stellar" | (string & {});
export const STELLAR: ChainSlug = "stellar";

export interface ChainAddress {
  readonly chain: ChainSlug;
  /** Native format for that chain: G/C/M strkey on Stellar, 0x hex on EVM chains. */
  readonly address: string;
}

/** What the integrator asks for. `amount` is a plain decimal string in asset units, e.g. "250.00". */
export interface TransferRequest {
  readonly asset: AssetSymbol;
  readonly from: ChainAddress;
  readonly to: ChainAddress;
  readonly amount: string;
  /**
   * Source-chain address that receives dust and fee refunds. Defaults to `from.address`.
   * Adapters validate it at quote time and refuse to build without a valid one.
   */
  readonly refundAddress?: string;
  /**
   * Rail-specific parameters the adapter validates. Core does not interpret them. Each adapter
   * documents and exports the keys it requires; a missing required key throws PARAMETER_REQUIRED.
   */
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export type PreflightCheckId =
  | "sender-format"
  | "recipient-format"
  | "recipient-trustline"
  | "sender-trustline"
  | "sender-native-balance"
  | "sender-asset-balance"
  | "route-limits"
  | "rail-paused";

/** A concrete action that would turn a failed check into a passing one. */
export type Remedy =
  | { readonly kind: "add-trustline"; readonly asset: AssetSymbol }
  | { readonly kind: "fund-native"; readonly minimum: Amount; readonly symbol: string }
  | { readonly kind: "manual"; readonly instructions: string };

export interface PreflightCheck {
  readonly id: PreflightCheckId;
  readonly ok: boolean;
  readonly message: string;
  readonly remedy?: Remedy;
}

export interface Fee {
  /** Human label, e.g. "LayerZero messaging fee" or "Stellar transaction fee". */
  readonly label: string;
  readonly amount: Amount;
  readonly symbol: string;
}

/**
 * Rail-agnostic quote. Nothing in here names LayerZero or Circle; adapters keep their
 * own references privately (see TransferRecord.railRef).
 */
export interface Quote {
  readonly rail: RailId;
  readonly request: TransferRequest;
  /** Debited from the sender, in the source chain's decimals for this asset. */
  readonly debit: Amount;
  /** Credited to the recipient, in the destination chain's decimals for this asset. */
  readonly credit: Amount;
  /** Portion of the requested amount that cannot be moved at shared precision. Never dropped silently. */
  readonly dust: Amount;
  readonly fees: readonly Fee[];
  /** Absent when the rail has no observed timing to base an estimate on. Never a made-up number. */
  readonly etaSeconds?: number;
  readonly checks: readonly PreflightCheck[];
  /** Unix ms after which this quote must not be built. */
  readonly expiresAt: number;
  /** Resolved source-chain refund address (see TransferRequest.refundAddress). */
  readonly refundAddress: string;
}

/**
 * One thing the user's wallet has to sign and submit. Steps run in order. A deferred step cannot be
 * assembled until the step it depends on has been confirmed on-chain (Soroban footprints come from
 * simulation, and a simulation that depends on state written by an earlier step fails until that
 * state exists). Call `RailAdapter.prepareStep` to turn it into a signable step.
 */
export type TransferStep =
  | {
      readonly chain: "stellar";
      readonly kind: "stellar-transaction";
      /** Base64 transaction envelope XDR, unsigned. */
      readonly xdr: string;
      readonly description: string;
    }
  | {
      readonly chain: "stellar";
      readonly kind: "stellar-transaction-deferred";
      /** Index of the step that must be confirmed first. */
      readonly dependsOn: number;
      readonly description: string;
    }
  | {
      readonly chain: ChainSlug;
      readonly kind: "evm-transaction";
      readonly to: `0x${string}`;
      readonly data: `0x${string}`;
      readonly value: bigint;
      readonly description: string;
    };

export interface BuiltTransfer {
  readonly transferId: TransferId;
  readonly rail: RailId;
  readonly steps: readonly TransferStep[];
}

export type TransferStage = "created" | "submitted" | "verified" | "delivered" | "failed";

export interface TransferFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface TransferStatus {
  readonly transferId: TransferId;
  readonly stage: TransferStage;
  /** Unix ms. */
  readonly updatedAt: number;
  readonly detail?: string;
  readonly sourceTxHash?: string;
  readonly destinationTxHash?: string;
  readonly failure?: TransferFailure;
}

/**
 * The contract every rail implements. Shared types only: a LayerZero GUID or a Circle
 * Iris attestation must never appear in these signatures.
 */
export interface RailAdapter {
  readonly rail: RailId;
  /** Cheap, synchronous routing predicate: can this rail serve this request at all? */
  supports(request: TransferRequest): boolean;
  quote(request: TransferRequest): Promise<Quote>;
  /** Turns a quote into unsigned steps and records the transfer so `track` can find it. */
  build(quote: Quote): Promise<BuiltTransfer>;
  /** Yields status updates until a terminal stage ("delivered" or "failed") or the signal aborts. */
  track(transferId: TransferId, signal?: AbortSignal): AsyncIterable<TransferStatus>;
  /**
   * Assemble a deferred step once its prerequisite is confirmed. Throws STEP_NOT_READY (or a more
   * specific code such as ALLOWANCE_INSUFFICIENT) when the chain state it needs is not there yet.
   */
  prepareStep?(transferId: TransferId, stepIndex: number): Promise<TransferStep>;
}
