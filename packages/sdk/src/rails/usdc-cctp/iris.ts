import { FerrylineError } from "@ferryline/core";

/**
 * Circle Iris (attestation service) v2. Observed on production 2026-09-11 for real Stellar-source and
 * Stellar-destination messages (evidence/iris.mainnet.*.json):
 *   GET {base}/v2/messages/{sourceDomain}?transactionHash={hash}   -> 200 { messages: [...], sourceTxHash }
 *   GET {base}/v2/messages/{sourceDomain}?nonce=0x{32 bytes}       -> same shape
 *   unknown transaction                                              -> 404 { "error": "Message not found for provided parameters" }
 * Observed `status`: "complete" (17 of 17 messages). Observed `delayReason`: null. No other values have
 * been seen by this repo, and Circle's technical guide does not enumerate them, so anything else is
 * treated as "attestation pending" and surfaced verbatim in `detail`.
 *   GET {base}/v2/burn/USDC/fees/{src}/{dst} -> [{ finalityThreshold, minimumFee (bps) }]
 */
export interface IrisDecodedBody {
  readonly burnToken: string | null;
  readonly mintRecipient: string | null;
  readonly amount: string;
  readonly messageSender: string | null;
  readonly maxFee: string;
  readonly feeExecuted: string;
  readonly expirationBlock: string;
  readonly hookData: string | null;
}

export interface IrisDecodedMessage {
  readonly sourceDomain: string;
  readonly destinationDomain: string;
  readonly nonce: string;
  readonly sender: string | null;
  readonly recipient: string | null;
  readonly destinationCaller: string | null;
  readonly minFinalityThreshold: string;
  readonly finalityThresholdExecuted: string;
  readonly messageBody: string;
  readonly decodedMessageBody: IrisDecodedBody | null;
}

export interface IrisMessage {
  readonly message: string;
  readonly eventNonce: string;
  readonly attestation: string;
  readonly cctpVersion: number;
  readonly status: string;
  readonly delayReason: string | null;
  readonly decodedMessage: IrisDecodedMessage | null;
}

export interface IrisFeeRow {
  readonly finalityThreshold: number;
  /** Basis points, e.g. 1 = 0.01%. May be fractional (1.3 observed). */
  readonly minimumFee: number;
}

export interface IrisClient {
  /** Empty when Iris has not indexed the transaction (HTTP 404). */
  messagesByTx(sourceDomain: number, txHash: string): Promise<readonly IrisMessage[]>;
  messagesByNonce(sourceDomain: number, nonce: `0x${string}`): Promise<readonly IrisMessage[]>;
  fees(sourceDomain: number, destinationDomain: number): Promise<readonly IrisFeeRow[]>;
}

export const IRIS_STATUS_COMPLETE = "complete";

export function attestationComplete(message: IrisMessage): boolean {
  return message.status === IRIS_STATUS_COMPLETE;
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export function createIrisClient(baseUrl: string, fetchFn: FetchLike = fetch): IrisClient {
  async function get(path: string): Promise<unknown> {
    const response = await fetchFn(`${baseUrl}${path}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new FerrylineError(
        "UPSTREAM_ERROR",
        `Iris returned HTTP ${String(response.status)} for ${path}`,
      );
    }
    return response.json();
  }
  async function messages(path: string): Promise<readonly IrisMessage[]> {
    const body = (await get(path)) as { messages?: unknown } | undefined;
    return body && Array.isArray(body.messages) ? (body.messages as IrisMessage[]) : [];
  }
  return {
    messagesByTx: (sourceDomain, txHash) =>
      messages(
        `/v2/messages/${String(sourceDomain)}?transactionHash=${encodeURIComponent(txHash)}`,
      ),
    messagesByNonce: (sourceDomain, nonce) =>
      messages(`/v2/messages/${String(sourceDomain)}?nonce=${nonce}`),
    async fees(sourceDomain, destinationDomain) {
      const body = await get(
        `/v2/burn/USDC/fees/${String(sourceDomain)}/${String(destinationDomain)}`,
      );
      if (!Array.isArray(body)) {
        throw new FerrylineError("UPSTREAM_ERROR", "Iris fees endpoint did not return a list");
      }
      return body as IrisFeeRow[];
    },
  };
}

/**
 * Circle's minimumFee is in basis points and may be fractional. Compute ceil(amount * bps / 10_000)
 * exactly with integers by working in hundredths of a basis point.
 */
export function feeFromBps(amount: bigint, minimumFeeBps: number): bigint {
  const hundredths = BigInt(Math.round(minimumFeeBps * 100));
  const numerator = amount * hundredths;
  const denominator = 1_000_000n;
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}
