/**
 * Real relayer client — POST /transfers to register an inbound CCTP transfer, then poll
 * GET /transfers/:id for its real state machine status. Same shapes and sequencing STEP 1's
 * `experiments/widget-seam-inbound-relayer.ts` proved end to end against a real, running,
 * docker-composed relayer instance — this is that same real API, now called from inside the
 * component instead of a standalone script.
 *
 * Outbound sends never call anything here (per the roadmap's own architecture: outbound goes
 * straight from the SDK to Stellar's rail contracts, no relayer in that path at all — confirmed
 * directly from the relayer's own schema in STEP 1, `sourceTxHash` is typed as an EVM tx hash).
 */
export interface RelayerConfig {
  readonly url: string;
  readonly apiKey?: string;
}

export interface RegisterTransferInput {
  readonly transferId: string;
  readonly sourceChain: string;
  readonly sourceTxHash: string;
  readonly rail: "usdc-cctp";
}

export interface RelayerTransferStatus {
  readonly id: string;
  readonly status: "pending" | "attested" | "submitting" | "delivered" | "failed";
  readonly sourceChain: string;
  readonly sourceTxHash: string;
  readonly destinationTxHash?: string | null;
  readonly amount?: string | null;
  readonly recipient?: string | null;
  readonly errorCode?: string | null;
  readonly errorDetail?: string | null;
}

function headers(config: RelayerConfig): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) {
    h["Authorization"] = `Bearer ${config.apiKey}`;
  }
  return h;
}

export async function registerTransfer(
  config: RelayerConfig,
  input: RegisterTransferInput,
): Promise<RelayerTransferStatus> {
  const response = await fetch(`${config.url}/transfers`, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify(input),
  });
  const body: unknown = await response.json();
  if (response.status !== 201) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `HTTP ${String(response.status)}`;
    throw new Error(`relayer registration failed: ${message}`);
  }
  return body as RelayerTransferStatus;
}

export async function getTransferStatus(
  config: RelayerConfig,
  transferId: string,
): Promise<RelayerTransferStatus> {
  const response = await fetch(`${config.url}/transfers/${transferId}`, {
    headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
  });
  if (!response.ok) {
    throw new Error(`relayer status check failed: HTTP ${String(response.status)}`);
  }
  return (await response.json()) as RelayerTransferStatus;
}

const TERMINAL_STATUSES = new Set(["delivered", "failed"]);

/**
 * Polls until a terminal status or the signal aborts. Every real transient fetch failure is
 * retried, not fatal — the same robustness fix STEP 1 needed after a real container restart
 * crashed its own polling loop mid-run (see experiments/widget-seam-inbound-relayer.ts's own
 * report for that finding).
 */
export async function* trackRelayerTransfer(
  config: RelayerConfig,
  transferId: string,
  options: { readonly pollIntervalMs?: number; readonly signal?: AbortSignal } = {},
): AsyncGenerator<RelayerTransferStatus> {
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  let last: string | undefined;
  for (;;) {
    if (options.signal?.aborted) {
      throw new Error("tracking aborted");
    }
    let status: RelayerTransferStatus | undefined;
    try {
      status = await getTransferStatus(config, transferId);
    } catch {
      // Real transient failure (network blip, relayer restart) — retry, don't crash the tracker.
    }
    if (status) {
      const key = `${status.status}:${status.destinationTxHash ?? ""}`;
      if (key !== last) {
        last = key;
        yield status;
      }
      if (TERMINAL_STATUSES.has(status.status)) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
