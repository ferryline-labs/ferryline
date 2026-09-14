/**
 * `<ferryline-widget>` — the real custom element. Framework-agnostic (plain `HTMLElement`, no
 * React wrapper this phase, per the STEP 2 assignment's explicit scope). Wires together, in order:
 *
 *   client.ts (real Ferryline + real rail adapters, testnet-CCTP-only / mainnet-both-rails)
 *   -> wallet.ts (real Stellar Wallets Kit modules: Freighter, xBull, Albedo, ... — see wallet.ts)
 *   -> state.ts (the pure state machine; `signing` is reachable ONLY via `confirmPreviewAndSign`,
 *      called ONLY from this file's preview-confirm button handler — see "the one hard requirement"
 *      note on `renderPreview` below for the structural argument that this can't be bypassed)
 *   -> preview.ts (decodes the real built step for display before that confirm button exists)
 *   -> relayer.ts (real POST /transfers + GET /transfers/:id polling for inbound CCTP tracking)
 *
 * Attributes: `network` ("testnet" | "mainnet", default "testnet"), `rpc-url`, `relayer-url`,
 * `relayer-api-key`. Config beyond that (asset, from/to, amount) is set imperatively via the
 * `request` property — see `set request()` below — since a full TransferRequest doesn't serialize
 * cleanly to a single HTML attribute.
 */
import { formatAmount } from "@ferryline/core";
import type { ChainSlug } from "@ferryline/core";
import { isFinalStep } from "@ferryline/sdk";
import type {
  AssetSymbol,
  BuiltTransfer,
  FerrylineNetwork,
  Quote,
  RailId,
  TransferRequest,
  TransferStage,
} from "@ferryline/sdk";

import { createWidgetClient, type WidgetClient } from "./client.js";
import { GENERATED_STYLE } from "./generated-style.js";
import { buildPreviewSummary, type PreviewSummary } from "./preview.js";
import { registerTransfer, trackRelayerTransfer, type RelayerConfig } from "./relayer.js";
import {
  buildFailed,
  buildSucceeded,
  confirmPreviewAndSign,
  isTerminal,
  quoteFailed,
  quoteSucceeded,
  reset as resetPhase,
  signFailed,
  signedAwaitingNextStep,
  startBuilding,
  startQuoting,
  startTracking,
  trackingUpdated,
  type WidgetPhase,
} from "./state.js";
import { RealWalletSession, type ConnectedWallet, type WalletSession } from "./wallet.js";

export const WIDGET_TAG = "ferryline-widget";

/** Human copy for each transfer stage. Kept here so the SDK stays UI-free. */
export const STAGE_LABELS: Readonly<Record<TransferStage, string>> = {
  created: "Ready to sign",
  submitted: "Submitted, waiting for verification",
  verified: "Verified, delivering",
  delivered: "Delivered",
  failed: "Failed",
};

/** Real testnet faucets, surfaced only in testnet mode (STEP 2D). Both independently confirmed
 * real and public in earlier phases (see packages/core/VERIFIED.md / experiment reports). */
const TESTNET_FAUCETS = [
  { label: "XLM (Friendbot)", url: "https://friendbot.stellar.org" },
  { label: "USDC (Circle testnet faucet)", url: "https://faucet.circle.com" },
] as const;

const RAIL_LABELS: Readonly<Record<RailId, string>> = {
  "usdc-cctp": "USDC via CCTP",
  "usdt0-layerzero": "USDT0 via LayerZero",
};

/**
 * STEP 3 finding (widget phase, confirmed 2026-09-12 against Circle's own CCTP technical guide —
 * see technical-doc.md's threat-model table for the full, sourced writeup), UPDATED for the
 * outbound-auto-registration phase: Circle's own infrastructure still has no automatic relay for
 * outbound (Stellar -> EVM) CCTP delivery on testnet OR mainnet — that has not changed and is not
 * something this project controls. What HAS changed: Ferryline now ships a real, testnet-proven,
 * self-hostable outbound relayer (packages/relayer/) that this widget registers with
 * automatically once a real burn tx hash is known (see index.ts's markSubmitted call site, which
 * triggers @ferryline/sdk's Ferryline.registerOutboundTransfer — see that method's own doc comment
 * for the full mechanism, including its "never breaks the underlying flow" guarantee).
 *
 * Still NOT a guaranteed delivery-time SLA — same honesty standard as OUTBOUND_SCOPE.md's own
 * "not a guaranteed delivery-time SLA" section, restated here for the widget's own copy:
 * `receiveMessage` remains genuinely permissionless (Circle's own design, not this project's
 * choice), so a transfer can still be completed manually by anyone at any time if the configured
 * relayer is unavailable, misconfigured, or its own spend ceiling is exhausted for the day — the
 * exact same real, already-documented recourse that existed before this phase, just no longer the
 * ONLY path. `track()`'s "verified" stage still only means the attestation is real and complete —
 * it does NOT mean delivery is imminent or guaranteed, with or without a relayer configured.
 *
 * The copy below is two variants, chosen by whether THIS widget instance has a relayer configured
 * at all (relayerUrl set) — an integrator running the widget with no relayer configured (a real,
 * still-fully-supported mode, see FerrylineConfig.relayerUrl's own doc comment) must not be told
 * "a relayer is handling this" when none is registered on their behalf.
 */
function outboundDeliveryCaveat(relayerConfigured: boolean): string {
  return relayerConfigured
    ? "Attestation complete. This transfer has been registered with the configured relayer for " +
        "automatic delivery on the destination chain — but that is not a guaranteed delivery-time " +
        "SLA: receiveMessage remains permissionless, so if the relayer is unavailable or its daily " +
        "spend limit is reached, anyone (you, the recipient, or another relayer) can still submit " +
        "the attested message on-chain and pay its gas. This is normal, expected behavior, not a " +
        "sign of an error."
    : "Attestation complete. Delivery on the destination chain is not automatic for this rail — it " +
        "requires someone (you, the recipient, or an integrator's own relayer) to submit the " +
        "attested message on-chain and pay its gas. This can be done by anyone at any time; it is " +
        "not a sign of an error, but it also will not simply arrive on its own.";
}

/** True only for an outbound (Stellar -> EVM) CCTP quote — the specific case the caveat above applies to. */
function isOutboundCctp(quote: Quote): boolean {
  return quote.rail === "usdc-cctp" && quote.request.from.chain === "stellar";
}

export class FerrylineWidget extends HTMLElement {
  static readonly observedAttributes = [
    "network",
    "rpc-url",
    "relayer-url",
    "relayer-api-key",
  ] as const;

  #client: WidgetClient | undefined;
  #wallet: WalletSession | undefined;
  #connected: ConnectedWallet | undefined;
  #phase: WidgetPhase = { kind: "idle" };
  #request: TransferRequest | undefined;
  #abort: AbortController | undefined;
  #inboundStatus:
    { readonly status: string; readonly destinationTxHash?: string | null } | undefined;
  #walletError: string | undefined;

  /**
   * Test-only injection seams. Component tests set these to a fixture-backed `WidgetClient` /
   * `WalletSession` (the same real `Ferryline` + adapter classes the SDK's own tests use, wired
   * against a fake RPC — see index.test.ts) instead of `createWidgetClient`'s real network calls
   * or `RealWalletSession`'s real browser-extension calls. Left undefined in real usage, where
   * `client()`/`wallet()` fall through to the real constructors below.
   */
  testClientOverride: WidgetClient | undefined;
  testWalletOverride: WalletSession | undefined;

  connectedCallback(): void {
    this.render();
  }

  disconnectedCallback(): void {
    this.#abort?.abort();
  }

  attributeChangedCallback(): void {
    // A network change invalidates any existing client/wallet session — rebuilt lazily on next use.
    this.#client = undefined;
    this.#wallet = undefined;
    this.#connected = undefined;
    this.render();
  }

  get network(): FerrylineNetwork {
    return this.getAttribute("network") === "mainnet" ? "mainnet" : "testnet";
  }

  private get rpcUrl(): string | undefined {
    return this.getAttribute("rpc-url") ?? undefined;
  }

  private get relayerUrl(): string | undefined {
    return this.getAttribute("relayer-url") ?? undefined;
  }

  private get relayerApiKey(): string | undefined {
    return this.getAttribute("relayer-api-key") ?? undefined;
  }

  /** Rail-agnostic request. Set imperatively (`el.request = {...}`) — see class doc comment. */
  set request(value: TransferRequest | undefined) {
    this.#request = value;
    if (value) {
      void this.startQuote(value);
    }
  }

  get request(): TransferRequest | undefined {
    return this.#request;
  }

  /** Rails actually available for the widget's current network (empty until first use). */
  get availableRails(): readonly RailId[] {
    return this.#client?.availableRails ?? [];
  }

  private client(): WidgetClient {
    if (this.testClientOverride) {
      return this.testClientOverride;
    }
    this.#client ??= createWidgetClient({
      network: this.network,
      ...(this.rpcUrl !== undefined ? { rpcUrl: this.rpcUrl } : {}),
      ...(this.relayerUrl !== undefined ? { relayerUrl: this.relayerUrl } : {}),
      ...(this.relayerApiKey !== undefined ? { relayerApiKey: this.relayerApiKey } : {}),
    });
    return this.#client;
  }

  private wallet(): WalletSession {
    if (this.testWalletOverride) {
      return this.testWalletOverride;
    }
    this.#wallet ??= new RealWalletSession(this.network);
    return this.#wallet;
  }

  private setPhase(phase: WidgetPhase): void {
    this.#phase = phase;
    this.render();
  }

  // ---- Quote / build (STEP 2A) ----------------------------------------------------------------

  private async startQuote(request: TransferRequest): Promise<void> {
    this.setPhase(startQuoting());
    try {
      const quote = await this.client().ferryline.quote(request);
      this.setPhase(quoteSucceeded(quote));
    } catch (error) {
      this.setPhase(quoteFailed(message(error)));
    }
  }

  private async build(): Promise<void> {
    if (this.#phase.kind !== "quoted") {
      return;
    }
    const { quote } = this.#phase;
    this.setPhase(startBuilding(quote));
    try {
      const built = await this.client().ferryline.build(quote);
      this.setPhase(buildSucceeded(quote, built, 0));
    } catch (error) {
      this.setPhase(buildFailed(quote, message(error)));
    }
  }

  // ---- Wallet connect (STEP 2B) ----------------------------------------------------------------

  private async connectWallet(moduleId?: string): Promise<void> {
    try {
      this.#connected = await this.wallet().connect(moduleId);
      this.render();
    } catch (error) {
      // Connection failures render inline rather than forcing a phase transition — the user may
      // still be mid-quote/build and a wallet reconnect shouldn't discard that state.
      this.renderError(`Wallet connection failed: ${message(error)}`);
    }
  }

  // ---- Preview + sign (STEP 2C) — "the one hard requirement" -----------------------------------
  //
  // `confirmPreviewAndSign` is the ONLY function that produces a `signing` phase (state.ts's own
  // structural guarantee), and it is called from exactly ONE place in this entire file: the
  // confirm-button handler below, itself reachable only by the user clicking a button rendered
  // ONLY while `this.#phase.kind === "preview"`. There is no quote/build success path that calls
  // `wallet().signTransaction` directly — every signing call in this class is gated through here.

  private async confirmAndSign(): Promise<void> {
    if (this.#phase.kind !== "preview") {
      return; // structurally unreachable via the UI; defensive no-op if called out of order.
    }
    const signingPhase = confirmPreviewAndSign(this.#phase);
    this.setPhase(signingPhase);
    if (signingPhase.kind !== "signing") {
      return;
    }
    const { quote, built, stepIndex } = signingPhase;
    const step = built.steps[stepIndex];
    if (!step) {
      this.setPhase(signFailed({ quote, built }, `no step at index ${String(stepIndex)}`));
      return;
    }
    try {
      if (step.kind === "stellar-transaction") {
        const client = this.client();
        const signedXdr = await this.wallet().signTransaction(step.xdr, client.networkPassphrase);
        const sourceTxHash = await client.submitStellarTransaction(signedXdr);
        await client.ferryline.markSubmitted(built.transferId, sourceTxHash);
        await this.afterStepSubmitted(quote, built, stepIndex);
      } else if (step.kind === "evm-transaction") {
        throw new Error(
          "EVM-side signing (inbound builds) is driven by the sending chain's own wallet, outside this widget's Stellar-wallet session — see relayer.ts's registerTransfer for the inbound flow this widget drives after that external signature.",
        );
      } else {
        throw new Error(`cannot sign a deferred step directly at index ${String(stepIndex)}`);
      }
    } catch (error) {
      this.setPhase(signFailed({ quote, built }, message(error)));
    }
  }

  private cancelPreview(): void {
    this.setPhase(resetPhase());
  }

  /** After a step is signed and its tx hash recorded: advance to the next step, or start tracking. */
  private async afterStepSubmitted(
    quote: Quote,
    built: BuiltTransfer,
    stepIndex: number,
  ): Promise<void> {
    if (!isFinalStep(built, stepIndex)) {
      const nextIndex = stepIndex + 1;
      this.setPhase(signedAwaitingNextStep({ quote, built, stepIndex: nextIndex }));
      const nextStep = await this.client().ferryline.prepareStep(built.transferId, nextIndex);
      const rebuilt = {
        ...built,
        steps: built.steps.map((s, i) => (i === nextIndex ? nextStep : s)),
      };
      this.setPhase(buildSucceeded(quote, rebuilt, nextIndex));
      return;
    }
    // This IS the final step (isFinalStep(built, stepIndex) === true — imported from
    // @ferryline/sdk, the same canonical, tested comparison the SDK ships specifically so no
    // caller reimplements it) — the one, correct point to trigger outbound relayer registration.
    // Real bug this project already shipped and fixed: calling registerOutboundTransfer from
    // inside markSubmitted itself (which fires after EVERY step, including an outbound transfer's
    // approve step before its burn) sent the WRONG tx hash first and caused the correct, later
    // registration to be rejected as a duplicate by the relayer's own transferId primary key — see
    // @ferryline/sdk's registerOutboundTransfer/isFinalStep doc comments for the full story.
    // Fire-and-forget (never awaited into the caller's own flow beyond this): registerOutboundTransfer
    // itself never throws and gates itself off entirely for inbound/non-CCTP transfers and when no
    // relayer is configured — see its own doc comment.
    await this.client().ferryline.registerOutboundTransfer(built.transferId);
    // Seed a "tracking" phase immediately, before the first real status arrives — track()'s first
    // yield can lag by however long the RPC/Horizon round-trip takes, and without this the UI would
    // otherwise show nothing between "wallet accepted the signature" and that first real update.
    this.setPhase(
      startTracking(quote, built, {
        transferId: built.transferId,
        stage: "submitted",
        updatedAt: Date.now(),
      }),
    );
    this.#abort = new AbortController();
    for await (const status of this.client().ferryline.track(
      built.transferId,
      this.#abort.signal,
    )) {
      this.setPhase(trackingUpdated({ quote, built }, status));
      if (status.stage === "delivered" || status.stage === "failed") {
        break;
      }
    }
  }

  // ---- Inbound relayer registration (STEP 2C) ---------------------------------------------------

  /** Called once an inbound EVM burn tx hash is known (from an external EVM wallet, outside this
   * widget's own signing flow — see the confirmAndSign note on evm-transaction steps above).
   *
   * Config source (STEP 0 of the outbound-auto-registration phase): reads relayerUrl/relayerApiKey
   * from `this.client().ferryline.config` — the same FerrylineConfig every other client() caller
   * already uses — rather than this class's own relayer-url/relayer-api-key attribute getters
   * directly. Those attributes still exist and still work exactly as before; they now flow into
   * FerrylineConfig via client() (see that method above and createWidgetClient in client.ts) instead
   * of being read a second time here. Nothing about registerTransfer/trackRelayerTransfer's own call
   * shape, arguments, or error handling changed — only where the URL/API key value comes from. */
  async registerInboundTransfer(
    transferId: string,
    sourceChain: ChainSlug,
    sourceTxHash: string,
  ): Promise<void> {
    const relayerUrl = this.client().ferryline.config.relayerUrl;
    if (!relayerUrl) {
      throw new Error("registerInboundTransfer requires a relayer-url attribute or property");
    }
    const config: RelayerConfig = {
      url: relayerUrl,
      ...(this.client().ferryline.config.relayerApiKey !== undefined
        ? { apiKey: this.client().ferryline.config.relayerApiKey }
        : {}),
    };
    await registerTransfer(config, { transferId, sourceChain, sourceTxHash, rail: "usdc-cctp" });
    this.#abort = new AbortController();
    for await (const status of trackRelayerTransfer(config, transferId, {
      signal: this.#abort.signal,
    })) {
      // Tracked in instance state and read by render() below, rather than a direct DOM write —
      // render() rebuilds innerHTML from scratch on every phase transition (see setPhase), so a
      // direct write here would get silently clobbered by any concurrent outbound-flow re-render.
      this.#inboundStatus = status;
      this.render();
    }
  }

  // ---- Rendering --------------------------------------------------------------------------------

  private renderError(text: string): void {
    // Tracked in instance state and read by render() below, not written directly — see the
    // matching note on the inbound-status loop above for why a direct DOM write here would get
    // silently clobbered by any concurrent re-render.
    this.#walletError = text;
    this.render();
  }

  private render(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${GENERATED_STYLE}</style>
      <div class="shell" part="shell">
        <div class="net" part="network">${this.network}</div>
        ${this.network === "testnet" ? renderFaucets() : ""}
        <div part="wallet-error" class="error">${this.#walletError ? escapeHtml(this.#walletError) : ""}</div>
        <div part="inbound-status">${
          this.#inboundStatus
            ? escapeHtml(
                this.#inboundStatus.destinationTxHash
                  ? `${this.#inboundStatus.status} (${this.#inboundStatus.destinationTxHash})`
                  : this.#inboundStatus.status,
              )
            : ""
        }</div>
        ${this.renderPhase()}
      </div>`;
    this.wireEvents();
  }

  private renderPhase(): string {
    const phase = this.#phase;
    switch (phase.kind) {
      case "idle":
        return `<p part="status">Ferryline widget: waiting for a transfer request.</p>`;
      case "quoting":
        return `<p part="status">Getting a quote…</p>`;
      case "quoted":
        return `
          <p part="status">${STAGE_LABELS.created}</p>
          <div part="quote">
            <div class="row">
              <span class="row-label">Send</span>
              <span class="row-value">${formatAmount(phase.quote.debit)}</span>
            </div>
            <div class="row">
              <span class="row-label">Receive</span>
              <span class="row-value">${formatAmount(phase.quote.credit)}</span>
            </div>
            ${
              phase.quote.etaSeconds
                ? `<div class="row"><span class="row-label">ETA</span><span class="row-value">~${String(phase.quote.etaSeconds)}s</span></div>`
                : ""
            }
          </div>
          <button class="cta" part="build-button" data-action="build">Build transaction</button>`;
      case "quote-failed":
        return `<p part="status" class="error">Quote failed: ${escapeHtml(phase.message)}</p>`;
      case "building":
        return `<p part="status">Preparing the transaction to sign…</p>`;
      case "preview": {
        // The transaction-preview step: see class doc comment on confirmAndSign for why this is
        // the only path that can lead to a signing prompt.
        const step = phase.built.steps[phase.stepIndex];
        const summary: PreviewSummary | undefined = step
          ? buildPreviewSummary(phase.quote, step, this.client().networkPassphrase)
          : undefined;
        return `
          <div part="preview">
            <h3 part="preview-heading">Review before you sign</h3>
            ${summary ? renderSummary(summary) : "<p>No further step to sign.</p>"}
            <div part="wallet-connect">
              ${
                this.#connected
                  ? `<div class="row"><span class="row-label">Connected</span><span class="row-value">${escapeHtml(this.#connected.address)}</span></div>`
                  : renderWalletModules(this.wallet())
              }
            </div>
            <div class="actions">
              <button class="cta cta-secondary" part="cancel-button" data-action="cancel">Cancel</button>
              <button class="cta" part="confirm-button" data-action="confirm" ${this.#connected ? "" : "disabled"}>Confirm and sign</button>
            </div>
          </div>`;
      }
      case "signing":
        return `<p part="status">Waiting for your wallet…</p>`;
      case "awaiting-next-step":
        return `<p part="status">Step confirmed. Preparing the next step…</p>`;
      case "tracking":
        return `
          <p part="status">${STAGE_LABELS[phase.status.stage]}</p>
          ${
            phase.status.stage === "verified" && isOutboundCctp(phase.quote)
              ? `<div part="delivery-caveat" class="caveat">${outboundDeliveryCaveat(Boolean(this.relayerUrl))}</div>`
              : ""
          }
          ${phase.status.sourceTxHash ? `<div part="source-tx" class="tx-hash">Source tx: ${escapeHtml(phase.status.sourceTxHash)}</div>` : ""}`;
      case "done":
        return `
          <p part="status">${STAGE_LABELS[phase.status.stage]}</p>
          ${phase.status.destinationTxHash ? `<div part="dest-tx" class="tx-hash">Destination tx: ${escapeHtml(phase.status.destinationTxHash)}</div>` : ""}
          ${phase.status.failure ? `<div part="failure" class="error">${escapeHtml(phase.status.failure.message)}</div>` : ""}
          <button class="cta" part="reset-button" data-action="reset">Start a new transfer</button>`;
      case "build-failed":
        return `<p part="status" class="error">Build failed: ${escapeHtml(phase.message)}</p>`;
      case "sign-failed":
        return `<p part="status" class="error">Signing failed: ${escapeHtml(phase.message)}</p>
          <button class="cta" part="reset-button" data-action="reset">Start over</button>`;
    }
  }

  private wireEvents(): void {
    this.shadowRoot
      ?.querySelectorAll<HTMLButtonElement>("button[data-action]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.dataset["action"];
          if (action === "build") void this.build();
          else if (action === "confirm") void this.confirmAndSign();
          else if (action === "cancel") this.cancelPreview();
          else if (action === "reset") this.setPhase(resetPhase());
        });
      });
    this.shadowRoot
      ?.querySelectorAll<HTMLButtonElement>("button[data-wallet-module]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const moduleId = button.dataset["walletModule"];
          void this.connectWallet(moduleId);
        });
      });
  }
}

function message(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  // Some wallet-kit modules reject with plain objects rather than real Error instances (confirmed
  // real during this phase's own E2E work — StellarWalletsKit surfaces at least one error shape
  // this way). String(plainObject) always yields the useless "[object Object]", so this looks for
  // a real `message`/`error` field first and only falls back to JSON/String beyond that.
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record["message"] === "string") {
      return record["message"];
    }
    if (typeof record["error"] === "string") {
      return record["error"];
    }
    try {
      return JSON.stringify(error);
    } catch {
      // fall through to String() below — e.g. a circular structure JSON.stringify can't handle.
    }
  }
  return String(error);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderFaucets(): string {
  const links = TESTNET_FAUCETS.map(
    (f) => `<a part="faucet-link" href="${f.url}" target="_blank" rel="noopener">${f.label}</a>`,
  ).join(" · ");
  return `<div part="faucets" class="faucets">Testnet faucets: ${links}</div>`;
}

function renderWalletModules(wallet: WalletSession): string {
  return wallet
    .listModules()
    .map(
      (m) =>
        `<button class="cta cta-secondary" part="wallet-module-button" data-wallet-module="${m.productId}">${escapeHtml(m.productName)}</button>`,
    )
    .join("");
}

function renderSummary(summary: PreviewSummary): string {
  const decoded = summary.decodedStep;
  const decodedHtml =
    decoded.kind === "stellar-invocation"
      ? `<div part="decoded-call">Contract: ${escapeHtml(decoded.contractId)}<br/>Function: ${escapeHtml(decoded.fn)}</div>`
      : decoded.kind === "evm-call"
        ? `<div part="decoded-call">To: ${escapeHtml(decoded.to)}<br/>Function: ${escapeHtml(decoded.fn)}</div>`
        : `<div part="decoded-call">${escapeHtml(decoded.description)}</div>`;
  return `
    <div part="preview-summary">
      <div class="row">
        <span class="row-label">Rail</span>
        <span class="row-value">${escapeHtml(RAIL_LABELS[summary.rail as RailId] ?? summary.rail)}</span>
      </div>
      <div class="row">
        <span class="row-label">You send</span>
        <span class="row-value">${escapeHtml(summary.debit)}</span>
      </div>
      <div class="row">
        <span class="row-label">Recipient gets</span>
        <span class="row-value">${escapeHtml(summary.credit)}</span>
      </div>
      <div class="row">
        <span class="row-label">Destination</span>
        <span class="row-value">${escapeHtml(summary.destination)}</span>
      </div>
      ${summary.fees
        .map(
          (f) =>
            `<div class="row"><span class="row-label">Fee (${escapeHtml(f.label)})</span><span class="row-value">${escapeHtml(f.amount)} ${escapeHtml(f.symbol)}</span></div>`,
        )
        .join("")}
      ${summary.dust ? `<div class="row"><span class="row-label">Dust (not sent)</span><span class="row-value">${escapeHtml(summary.dust)}</span></div>` : ""}
      ${summary.etaSeconds ? `<div class="row"><span class="row-label">ETA</span><span class="row-value">~${String(summary.etaSeconds)}s</span></div>` : ""}
      ${decodedHtml}
    </div>`;
}

/** Register the element once. Safe to call more than once. */
export function defineFerrylineWidget(tagName: string = WIDGET_TAG): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, FerrylineWidget);
  }
}

export { isTerminal };
export type { AssetSymbol, WidgetPhase };
