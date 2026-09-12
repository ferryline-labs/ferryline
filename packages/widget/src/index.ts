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
 * see technical-doc.md's threat-model table for the full, sourced writeup): outbound CCTP delivery
 * (Stellar -> EVM) has no automatic relay on testnet OR mainnet. Circle's documentation states "An
 * API consumer must query this attestation and submits it onchain to the destination domain's
 * MessageTransmitterV2#receiveMessage function" with no testnet/mainnet distinction anywhere, and
 * never describes Circle itself operating a relayer for this. `track()`'s "verified" stage means
 * the attestation is real and complete — it does NOT mean delivery is imminent or automatic. This
 * caveat exists so the widget never implies an ETA-bound "just wait" status for a step that may
 * never complete unless someone (sender, recipient, or a future dedicated relayer) submits it.
 */
const OUTBOUND_CCTP_DELIVERY_CAVEAT =
  "Attestation complete. Delivery on the destination chain is not automatic for this rail — it " +
  "requires someone (you, the recipient, or an integrator's own relayer) to submit the attested " +
  "message on-chain and pay its gas. This can be done by anyone at any time; it is not a sign of " +
  "an error, but it also will not simply arrive on its own.";

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
    const nextIndex = stepIndex + 1;
    if (nextIndex < built.steps.length) {
      this.setPhase(signedAwaitingNextStep({ quote, built, stepIndex: nextIndex }));
      const nextStep = await this.client().ferryline.prepareStep(built.transferId, nextIndex);
      const rebuilt = {
        ...built,
        steps: built.steps.map((s, i) => (i === nextIndex ? nextStep : s)),
      };
      this.setPhase(buildSucceeded(quote, rebuilt, nextIndex));
      return;
    }
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
   * widget's own signing flow — see the confirmAndSign note on evm-transaction steps above). */
  async registerInboundTransfer(
    transferId: string,
    sourceChain: ChainSlug,
    sourceTxHash: string,
  ): Promise<void> {
    const relayerUrl = this.relayerUrl;
    if (!relayerUrl) {
      throw new Error("registerInboundTransfer requires a relayer-url attribute or property");
    }
    const config: RelayerConfig = {
      url: relayerUrl,
      ...(this.relayerApiKey !== undefined ? { apiKey: this.relayerApiKey } : {}),
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
      <style>${STYLE}</style>
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
            <div>Send: ${formatAmount(phase.quote.debit)}</div>
            <div>Receive: ${formatAmount(phase.quote.credit)}</div>
            ${phase.quote.etaSeconds ? `<div>ETA: ~${String(phase.quote.etaSeconds)}s</div>` : ""}
          </div>
          <button part="build-button" data-action="build">Build transaction</button>`;
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
              ${this.#connected ? `<span>Connected: ${escapeHtml(this.#connected.address)}</span>` : renderWalletModules(this.wallet())}
            </div>
            <div class="actions">
              <button part="cancel-button" data-action="cancel">Cancel</button>
              <button part="confirm-button" data-action="confirm" ${this.#connected ? "" : "disabled"}>Confirm and sign</button>
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
              ? `<div part="delivery-caveat" class="caveat">${OUTBOUND_CCTP_DELIVERY_CAVEAT}</div>`
              : ""
          }
          ${phase.status.sourceTxHash ? `<div part="source-tx">Source tx: ${escapeHtml(phase.status.sourceTxHash)}</div>` : ""}`;
      case "done":
        return `
          <p part="status">${STAGE_LABELS[phase.status.stage]}</p>
          ${phase.status.destinationTxHash ? `<div part="dest-tx">Destination tx: ${escapeHtml(phase.status.destinationTxHash)}</div>` : ""}
          ${phase.status.failure ? `<div part="failure" class="error">${escapeHtml(phase.status.failure.message)}</div>` : ""}
          <button part="reset-button" data-action="reset">Start a new transfer</button>`;
      case "build-failed":
        return `<p part="status" class="error">Build failed: ${escapeHtml(phase.message)}</p>`;
      case "sign-failed":
        return `<p part="status" class="error">Signing failed: ${escapeHtml(phase.message)}</p>
          <button part="reset-button" data-action="reset">Start over</button>`;
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
        `<button part="wallet-module-button" data-wallet-module="${m.productId}">${escapeHtml(m.productName)}</button>`,
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
      <div>Rail: ${escapeHtml(RAIL_LABELS[summary.rail as RailId] ?? summary.rail)}</div>
      <div>You send: ${escapeHtml(summary.debit)}</div>
      <div>Recipient gets: ${escapeHtml(summary.credit)}</div>
      <div>Destination: ${escapeHtml(summary.destination)}</div>
      ${summary.fees.map((f) => `<div>Fee (${escapeHtml(f.label)}): ${escapeHtml(f.amount)} ${escapeHtml(f.symbol)}</div>`).join("")}
      ${summary.dust ? `<div>Dust (not sent): ${escapeHtml(summary.dust)}</div>` : ""}
      ${summary.etaSeconds ? `<div>ETA: ~${String(summary.etaSeconds)}s</div>` : ""}
      ${decodedHtml}
    </div>`;
}

const STYLE = `
  :host {
    display: block;
    font-family: var(--ferryline-font, system-ui, sans-serif);
    font-size: var(--ferryline-font-size, 14px);
    color: var(--ferryline-fg, #1a2531);
    --ferryline-radius: var(--ferryline-border-radius, 8px);
  }
  .shell {
    border: 1px solid var(--ferryline-border, #d3dce2);
    border-radius: var(--ferryline-radius);
    padding: var(--ferryline-spacing, 16px);
    background: var(--ferryline-bg, #ffffff);
  }
  .net { font-size: 12px; color: var(--ferryline-muted, #54667a); text-transform: uppercase; letter-spacing: 0.08em; }
  .error { color: var(--ferryline-danger, #c0392b); }
  .caveat { color: var(--ferryline-muted, #54667a); font-size: 12px; margin: 6px 0; }
  .faucets { font-size: 12px; margin: 4px 0; }
  .faucets a { color: var(--ferryline-accent, #2c6fbb); }
  button {
    background: var(--ferryline-accent, #2c6fbb);
    color: var(--ferryline-accent-fg, #ffffff);
    border: none;
    border-radius: var(--ferryline-radius);
    padding: 8px 14px;
    font-size: inherit;
    cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .actions { display: flex; gap: 8px; margin-top: 8px; }
  /* Mobile bottom-sheet layout (STEP 2D): below the breakpoint, the shell docks to the bottom of
     the viewport instead of sitting inline, with a rounded top edge only - the standard mobile
     "sheet" affordance. An integrator embedding this in their own bottom-sheet container can
     still override position/inset via the :host selector's normal cascade if they need to. */
  @media (max-width: 480px) {
    :host {
      position: fixed;
      inset: auto 0 0 0;
      z-index: var(--ferryline-z-index, 1000);
    }
    .shell {
      border-radius: var(--ferryline-radius) var(--ferryline-radius) 0 0;
      border-bottom: none;
      max-height: 85vh;
      overflow-y: auto;
    }
  }
`;

/** Register the element once. Safe to call more than once. */
export function defineFerrylineWidget(tagName: string = WIDGET_TAG): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, FerrylineWidget);
  }
}

export { isTerminal };
export type { AssetSymbol, WidgetPhase };
