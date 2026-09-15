import type {
  BuiltTransfer,
  Quote,
  RailAdapter,
  RailId,
  TransferId,
  TransferRecord,
  TransferRequest,
  TransferStatus,
  TransferStep,
  TransferStore,
} from "@ferryline/core";
import { FerrylineError, InMemoryTransferStore } from "@ferryline/core";

export type FerrylineNetwork = "mainnet" | "testnet";

/**
 * Real outcome of a {@link Ferryline.registerOutboundTransfer} call — replaces the method's
 * original `Promise<void>` specifically so a caller (the widget, or any other integrator) can tell
 * a genuine registration success apart from every other case, without registerOutboundTransfer's
 * own "never break the caller's flow" guarantee (see that method's own doc comment) changing at
 * all: it still never throws, for any reason.
 *
 * `registered: true` only for a real, confirmed 201 response from the relayer — the transfer is
 * genuinely tracked for automatic delivery.
 *
 * `registered: false` for every other case, deliberately NOT further distinguished by a reason
 * code this pass: both the two silent "not applicable" gates (no relayerUrl configured at all;
 * the transfer isn't an outbound CCTP transfer) and the two internal-failure gates (the transfer
 * store couldn't be read; no sourceTxHash recorded yet — neither should happen in real usage, see
 * the method's own doc comment) report `registered: false, error: undefined` — the exact same
 * "nothing to show the user" outcome those cases already had before this type existed, so no new
 * UI surfaces for a scenario the widget was never reacting to. `error` is present, with a real,
 * specific message (not a generic code), ONLY when a relayer registration attempt genuinely
 * happened and failed — the one case that actually needs a distinct, honest caller-facing message
 * (this is exactly what `Ferryline.registerOutboundTransfer`'s "Gate 3" below produces).
 */
export interface RegisterOutboundTransferResult {
  readonly registered: boolean;
  readonly error?: string;
}

export interface FerrylineConfig {
  readonly network: FerrylineNetwork;
  /** Stellar RPC endpoint. */
  readonly rpcUrl: string;
  /**
   * Ferryline relayer endpoint, shared by both directions: inbound (EVM -> Stellar) registration
   * and outbound (Stellar -> EVM) registration both read this same value. Optional — a caller with
   * no relayer configured still gets a fully working SDK for quote/build/track; only the
   * register-with-a-relayer calls become no-ops (see registerOutboundTransfer's own doc comment).
   */
  readonly relayerUrl?: string;
  /** Bearer token for the relayer configured above, if it requires one. Ignored if relayerUrl is unset. */
  readonly relayerApiKey?: string;
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

  /** Assemble a deferred step (see TransferStep) once the step it depends on is confirmed. */
  async prepareStep(transferId: TransferId, stepIndex: number): Promise<TransferStep> {
    const record = await this.store.get(transferId);
    if (!record) {
      throw new FerrylineError("TRANSFER_UNKNOWN", `no transfer with id ${transferId}`);
    }
    const adapter = this.adapterByRail(record.rail);
    if (!adapter.prepareStep) {
      throw new FerrylineError("ROUTE_UNSUPPORTED", `rail "${record.rail}" has no deferred steps`);
    }
    return await adapter.prepareStep(transferId, stepIndex);
  }

  /**
   * Tell Ferryline which hash the wallet got back after submitting a step. Called once per SIGNED
   * step, including intermediate ones (e.g. an outbound CCTP transfer's approve step, before its
   * burn) — `markSubmitted` itself has no notion of "final", it just records whatever hash it's
   * given for later reads (see TransferStore.markSubmitted).
   *
   * IMPORTANT, learned the hard way (see registerOutboundTransfer's own doc comment for the full
   * story): this method does NOT trigger outbound relayer registration itself, specifically BECAUSE
   * it is called after every step, not just the final one. A caller (the widget, or any other
   * integrator) must call registerOutboundTransfer explicitly, and ONLY once the transfer's FINAL
   * step has been confirmed — never from inside a per-step callback that also fires for
   * intermediate steps. See isFinalStep, a small exported helper for identifying that point
   * correctly without reimplementing `stepIndex === built.steps.length - 1` at every call site.
   */
  markSubmitted(transferId: TransferId, sourceTxHash: string): Promise<void> {
    return this.store.markSubmitted(transferId, sourceTxHash);
  }

  /**
   * Registers an outbound (Stellar -> EVM) CCTP transfer with the configured Ferryline relayer
   * (FerrylineConfig.relayerUrl/relayerApiKey), so it gets picked up and completed automatically —
   * the SDK-level mirror of the widget's own registerInboundTransfer (packages/widget/src/index.ts),
   * using the same real POST /outbound-transfers + GET /outbound-transfers/:id relayer API the
   * outbound relayer service (packages/relayer/) actually implements.
   *
   * ============================================================================================
   * CALL THIS ONLY AFTER THE FINAL STEP OF A build() RESULT HAS BEEN CONFIRMED — never from a
   * per-step callback that also runs for intermediate steps. This is not a stylistic preference;
   * calling it earlier is a REAL BUG THIS PROJECT ALREADY SHIPPED AND HAD TO FIX: an outbound CCTP
   * transfer that needs an approve step first has TWO signable steps (approve, then burn), and
   * `markSubmitted` is called once per step. Triggering registration from inside `markSubmitted`
   * itself (the original, incorrect design) meant registration fired FIRST with the approve
   * transaction's hash — not a CCTP burn at all, so Iris has no attestation for it — and then AGAIN
   * with the real burn hash. Since the relayer's own primary key is the transferId (not the source
   * tx hash), the second, CORRECT registration was rejected as a duplicate of the first, WRONG one
   * — silently losing the real registration. Use isFinalStep(built, stepIndex) (exported below) to
   * find the right point: `if (isFinalStep(built, stepIndex)) { await
   * ferryline.registerOutboundTransfer(built.transferId); }`, called only once, after that specific
   * step's real tx hash has already been recorded via markSubmitted.
   * ============================================================================================
   *
   * Not called automatically by markSubmitted or anywhere else in this class — an integrator (the
   * widget, or a raw SDK caller) must call this themselves at the point described above. It is
   * side-effect-free to call more than once for the same transferId (each call independently gates
   * itself, see below), but only the correct, final-step, real-burn-tx-hash call actually succeeds
   * against the relayer — see gate 2, and the primary-key note above for why calling it early
   * fails silently rather than "just registering later, correctly, on retry."
   *
   * Returns a {@link RegisterOutboundTransferResult} instead of void — see that type's own doc
   * comment for the full reasoning (in short: a caller like the widget needs to know whether
   * registration genuinely succeeded before claiming so in its own UI; a real, live 401 from a
   * misconfigured relayer API key was silently reported as success before this existed). This does
   * NOT weaken the "never break the caller's flow" guarantee below — this method still never
   * throws, for any reason; a failure is reported in the return value, not an exception.
   *
   * Three real "do nothing" gates, each deliberate, ALL reported as `{ registered: false }` with no
   * `error` (see RegisterOutboundTransferResult's own doc comment for why these stay silent):
   *   1. No relayerUrl configured at all -> skipped silently, not an error. Per the project's own
   *      "works without a relayer" self-hosting story (same reasoning FerrylineConfig.relayerUrl's
   *      own doc comment states): an integrator who has not set up a relayer must still get a
   *      fully working SDK for quote/build/track, not a thrown error from something they never
   *      opted into.
   *   2. The transfer is not an outbound CCTP transfer (any other rail, or the inbound direction)
   *      -> skipped silently. Detected via ONLY the rail-agnostic, already-public
   *      TransferRecord.rail/request fields (`rail === "usdc-cctp"` and
   *      `request.from.chain === "stellar"` — the identical predicate the widget's own
   *      isOutboundCctp already uses), never by reaching into the adapter-private `railRef` (see
   *      TransferStore's own doc comment: railRef is "opaque to everything except the adapter that
   *      wrote it").
   *   3. The transfer store couldn't be read, or has no sourceTxHash recorded yet -> should not
   *      happen in real usage (registerOutboundTransfer is only ever called right after the
   *      markSubmitted write that sets sourceTxHash), logged via console.error same as before.
   *
   * The one real, reportable failure case: registration itself was genuinely attempted and the
   * relayer call failed (unreachable, misconfigured, a non-201 response — including the
   * duplicate-tx-hash 409 the primary-key bug above would produce, a network error, an invalid API
   * key). Still caught and logged via `console.error` exactly as before (the underlying burn
   * already happened on-chain by the time this runs, so this is never re-thrown), but now ALSO
   * returned as `{ registered: false, error: <the real failure message> }` so a caller can react
   * honestly instead of assuming success. See index.test.ts's own dedicated tests proving both the
   * never-throws guarantee AND the new honest result: simulating a relayer failure and confirming
   * the underlying transfer flow still completes normally while the returned result correctly
   * reports `registered: false` with the real error, AND reproducing the two-step approve+burn
   * scenario to confirm registration fires exactly once, with the real burn hash.
   */
  async registerOutboundTransfer(transferId: TransferId): Promise<RegisterOutboundTransferResult> {
    const { relayerUrl, relayerApiKey } = this.config;
    if (!relayerUrl) {
      return { registered: false }; // gate 1: see this method's own doc comment.
    }
    let record: TransferRecord | undefined;
    try {
      record = await this.store.get(transferId);
    } catch (error) {
      console.error(
        `Ferryline.registerOutboundTransfer: failed to read transfer ${transferId} from the store; skipping relayer registration: ${String(error)}`,
      );
      return { registered: false };
    }
    if (record?.rail !== "usdc-cctp" || record.request.from.chain !== "stellar") {
      return { registered: false }; // gate 2: not an outbound CCTP transfer — see doc comment.
    }
    if (!record.sourceTxHash) {
      // Should not happen: registerOutboundTransfer is only ever called from markSubmitted, right
      // after the store write that sets this. Logged, not thrown — same "never break the caller's
      // flow" rule as every other branch here.
      console.error(
        `Ferryline.registerOutboundTransfer: transfer ${transferId} has no sourceTxHash recorded yet; skipping relayer registration.`,
      );
      return { registered: false };
    }
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (relayerApiKey) {
        headers["Authorization"] = `Bearer ${relayerApiKey}`;
      }
      const response = await fetch(`${relayerUrl}/outbound-transfers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          transferId,
          sourceTxHash: record.sourceTxHash,
          destinationChain: record.request.to.chain,
          rail: "usdc-cctp",
        }),
      });
      if (response.status !== 201) {
        const body: unknown = await response.json().catch(() => undefined);
        const message =
          body && typeof body === "object" && "error" in body
            ? String(body.error)
            : `HTTP ${String(response.status)}`;
        throw new Error(`relayer registration failed: ${message}`);
      }
      return { registered: true };
    } catch (error) {
      // Gate 3: registration failing for any reason must never propagate as a thrown exception —
      // see this method's own doc comment for the full reasoning. The real on-chain burn already
      // happened; a relayer being unreachable/misconfigured is the relayer's problem to fix, not a
      // reason to fail the transfer the caller already successfully submitted. It IS, however, now
      // reported honestly in the returned result — see RegisterOutboundTransferResult's own doc
      // comment for why that distinction matters.
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `Ferryline.registerOutboundTransfer: registering transfer ${transferId} with the relayer at ${relayerUrl} failed (the burn itself is unaffected and already on-chain): ${message}`,
      );
      return { registered: false, error: message };
    }
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

/**
 * True if `stepIndex` is the LAST step in `built.steps` — the one, correct point at which to call
 * registerOutboundTransfer (see that method's own doc comment for why calling it any earlier is a
 * real, previously-shipped bug, not a style choice). A tiny helper, not a new field on TransferStep
 * itself: `built.steps` is a plain, already-ordered array whose length is fixed at build() time and
 * never changes as deferred steps are prepared (prepareStep assembles ONE step at a known index; it
 * never changes how many steps the transfer has — confirmed directly against every rail adapter's
 * own prepareStep implementation) — so `stepIndex === built.steps.length - 1` is already the
 * complete, correct answer. This function exists only so every caller uses that one, canonical,
 * tested comparison instead of each reimplementing it (and each independently risking the same
 * off-by-one/wrong-step mistake this exact bug already produced once, inside the widget itself).
 */
export function isFinalStep(built: Pick<BuiltTransfer, "steps">, stepIndex: number): boolean {
  return stepIndex === built.steps.length - 1;
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
export * from "./rails/usdc-cctp/index.js";

// Shared infrastructure other Ferryline services (the relayer) reuse rather than reimplement.
export { backoffDelay, sleep, type BackoffOptions, type SleepFn } from "./util/backoff.js";
export { SDK_VERSION, FERRYLINE_SDK_USER_AGENT } from "./version.js";
export { ERC20_ABI, EVM_ADDRESS, type EvmReader } from "./evm/reader.js";
export {
  simulateView,
  buildInvocation,
  getTrustline,
  getNativeBalance,
  trustlineKey,
  accountKey,
  type StellarRpc,
  type InvokeParams,
  type BuiltInvocation,
  type TrustlineState,
} from "./stellar/rpc.js";
