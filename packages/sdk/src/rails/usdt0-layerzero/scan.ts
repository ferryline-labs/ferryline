import { FerrylineError, type TransferStage } from "@ferryline/core";

/**
 * LayerZero Scan API, GET {base}/v1/messages/tx/{txHash}. Public, no key, and it indexes Stellar
 * transaction hashes: recorded responses for two real mainnet USDT0 sends are at
 * packages/core/verified/experiments/evidence/layerzero-scan.mainnet.*.json (2026-09-11).
 */
export const LAYERZERO_SCAN_MAINNET = "https://scan.layerzero-api.com";

export interface ScanMessage {
  readonly guid: string;
  readonly status: { readonly name: string; readonly message?: string };
  readonly pathway: { readonly srcEid: number; readonly dstEid: number; readonly nonce?: number };
  readonly source?: { readonly status?: string; readonly tx?: { readonly txHash?: string } };
  readonly destination?: { readonly status?: string; readonly tx?: { readonly txHash?: string } };
}

export interface ScanClient {
  /** Empty when Scan has not indexed the transaction yet. */
  messagesByTx(txHash: string): Promise<readonly ScanMessage[]>;
}

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function createScanClient(
  baseUrl: string = LAYERZERO_SCAN_MAINNET,
  fetchFn: FetchLike = fetch,
): ScanClient {
  return {
    async messagesByTx(txHash) {
      const response = await fetchFn(`${baseUrl}/v1/messages/tx/${encodeURIComponent(txHash)}`);
      if (response.status === 404) {
        return [];
      }
      if (!response.ok) {
        throw new FerrylineError(
          "UPSTREAM_ERROR",
          `LayerZero Scan returned HTTP ${String(response.status)}`,
        );
      }
      const body = (await response.json()) as { data?: unknown };
      return Array.isArray(body.data) ? (body.data as ScanMessage[]) : [];
    },
  };
}

export interface ScanStage {
  readonly stage: TransferStage;
  readonly terminal: boolean;
  readonly retryable: boolean;
}

/**
 * Map Scan's status name onto Ferryline stages.
 * Observed on mainnet: DELIVERED. The other names are LayerZero Scan's published vocabulary and
 * have not yet been observed by this repo; they are mapped conservatively (unknown => "submitted").
 */
export function stageFromScanStatus(name: string): ScanStage {
  switch (name) {
    case "DELIVERED":
      return { stage: "delivered", terminal: true, retryable: false };
    case "CONFIRMING":
      return { stage: "verified", terminal: false, retryable: false };
    case "PAYLOAD_STORED":
      // Verified but the executor could not deliver (for USDT0 into Stellar, the classic cause is a
      // missing trustline). LayerZero allows re-execution once the cause is fixed.
      return { stage: "failed", terminal: true, retryable: true };
    case "FAILED":
    case "BLOCKED":
    case "APPLICATION_BURNED":
    case "MALFORMED_COMMAND":
    case "UNRESOLVABLE_COMMAND":
      return { stage: "failed", terminal: true, retryable: false };
    default:
      return { stage: "submitted", terminal: false, retryable: false };
  }
}
