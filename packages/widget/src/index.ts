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
  RegisterOutboundTransferResult,
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
 * The copy below is now THREE variants (updated from an earlier two-variant version that took just
 * `relayerConfigured: boolean` and showed the "has been registered" success text unconditionally
 * whenever a relayer was configured — even when the real `registerOutboundTransfer` call had just
 * genuinely failed; confirmed live: a real 401 from a misconfigured relayer API key still produced
 * that exact success text, an honest false-positive claim). `registerOutboundTransfer` now returns a
 * real {@link RegisterOutboundTransferResult} instead of `void` specifically so this function can
 * tell the difference — see that type's own doc comment in @ferryline/sdk.
 *
 * `relayerConfigured` (a stable, always-known fact — whether a `relayer-url` attribute is set at
 * all) alone decides variant 1, "not automatic for this rail" (same as before — an integrator
 * running the widget with no relayer configured, a real, still-fully-supported mode, must not be
 * told "a relayer is handling this" when none is registered on their behalf). When a relayer IS
 * configured, `registrationResult` decides between the other two: `registered: true` for variant 2,
 * the real, confirmed success text (unchanged); anything else for variant 3, the new, honest
 * failure/uncertain wording — covering both a genuine failure (`error` set) and the brief, real gap
 * where `registered` is still `undefined` because the registration attempt one line earlier in
 * `afterStepSubmitted` has not resolved by this particular render yet ("verified" can already be
 * showing while that await is still in flight) — deliberately never the false "has been registered"
 * claim during that gap either.
 */
function outboundDeliveryCaveat(
  relayerConfigured: boolean,
  registrationResult: RegisterOutboundTransferResult | undefined,
): string {
  if (!relayerConfigured) {
    return (
      "Attestation complete. Delivery on the destination chain is not automatic for this rail — it " +
      "requires someone (you, the recipient, or an integrator's own relayer) to submit the " +
      "attested message on-chain and pay its gas. This can be done by anyone at any time; it is " +
      "not a sign of an error, but it also will not simply arrive on its own."
    );
  }
  if (registrationResult?.registered === true) {
    return (
      "Attestation complete. This transfer has been registered with the configured relayer for " +
      "automatic delivery on the destination chain — but that is not a guaranteed delivery-time " +
      "SLA: receiveMessage remains permissionless, so if the relayer is unavailable or its daily " +
      "spend limit is reached, anyone (you, the recipient, or another relayer) can still submit " +
      "the attested message on-chain and pay its gas. This is normal, expected behavior, not a " +
      "sign of an error."
    );
  }
  return (
    "Attestation complete, but automatic relay registration with the configured relayer failed, so " +
    "this transfer is NOT currently registered for automatic delivery. This transfer may need to be " +
    "completed manually: receiveMessage remains permissionless, so anyone (you, the recipient, or " +
    "another relayer) can still submit the attested message on-chain and pay its gas."
  );
}

/** True only for an outbound (Stellar -> EVM) CCTP quote — the specific case the caveat above applies to. */
function isOutboundCctp(quote: Quote): boolean {
  return quote.rail === "usdc-cctp" && quote.request.from.chain === "stellar";
}

/**
 * Deliberate pause, in `afterStepSubmitted` below, specifically between a Stellar step's confirmed
 * on-chain landing and building/submitting the very next Stellar step in the same transfer (today,
 * this is only the outbound CCTP approve -> burn sequence — see `usdc-cctp/adapter.ts`'s own
 * `stellar-transaction-deferred` step, the only place in this codebase two Stellar transactions from
 * the same account are submitted back to back).
 *
 * Why this exists — stated plainly, with the honesty standard this project already holds every
 * platform finding to: this is an EMPIRICALLY OBSERVED PATTERN, not a documented Soroban/Stellar
 * platform behavior. A real verification pass (this widget's own real testnet E2E testing, plus a
 * direct search of Stellar's official developer docs — the RPC `sendTransaction` reference, the
 * account/sequence-number fundamentals page, the transaction lifecycle page, the Stellar blog's own
 * "Proposed Changes To Transaction Submission" post, and the official `stellar-dev` dapp-development
 * skill's own reference `submitSorobanTransaction` implementation) found NO official documentation of
 * "the RPC node's own account/sequence-number state can temporarily lag the network's actual current
 * state for a transaction submitted immediately after a prior one from the same account" — the
 * official reference implementation itself throws immediately on any `ERROR` status, with no retry or
 * delay guidance at all.
 *
 * What IS real: every `tx_bad_seq` rejection observed during this widget's own real testnet
 * E2E testing (many, across multiple sessions) was the SECOND of two Stellar transactions
 * submitted back to back from the same account — the approve confirming, then the burn being built
 * and submitted immediately after. Some of those were false rejections (the transaction had, in
 * fact, landed — confirmed independently via Horizon); others were genuine failures (the
 * transaction never landed even after the rejection-recheck fix's own bounded retries) — see
 * `submitStellarTransactionWithRejectionRecheck`'s own doc comment in client.ts for that fix, which
 * remains the correct backstop here regardless of this delay's effect. This delay is a mitigation
 * aimed at reducing how often the false-rejection class happens in the first place, reasoned from
 * that real, repeated pattern — not a confirmed fix for a documented platform issue.
 *
 * The 3000ms this constant started at was itself found insufficient by further real testing: this
 * exact `tx_bad_seq` rejection kept recurring even with that delay in place. A direct, live
 * measurement taken during that investigation (comparing `getLatestLedger` on
 * `soroban-testnet.stellar.org` against Horizon's own latest ledger at the same moment) found this
 * public RPC endpoint genuinely running about 2 ledgers, roughly 10-12 real seconds, behind the
 * actual network — a real, current lag on this specific node at that time, not a one-off. Bumped to
 * 15000ms to sit comfortably above that measured gap. This value is a snapshot of one measurement,
 * not a guaranteed bound — the lag can vary, and `submitStellarTransactionWithRejectionRecheck`'s
 * own bounded retry/recheck (client.ts) is the actual, correct safety net that still applies
 * regardless of whether this delay turns out to be enough on any given real run.
 */
const POST_APPROVE_BUILD_DELAY_MS = 15000;

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
  /**
   * Real, observed race: `set request` starts a fresh, independent quote/build/sign/submit chain
   * every time it's called, with no cancellation of whatever chain was already in flight. If the
   * caller (e.g. a user giving up on a stuck submission and starting a new transfer) sets `request`
   * again while a PREVIOUS chain is still awaiting something (most likely
   * `submitStellarTransactionWithRejectionRecheck`'s now-much-longer on-chain recheck window, up to
   * ~2 minutes across its bounded retries), that old chain's async continuation eventually resumes
   * and calls `this.setPhase(...)` unconditionally — clobbering the NEW chain's current phase even
   * after it has already completed successfully. Confirmed for real: a completed transfer's
   * `tracking` phase was silently overwritten by an old, abandoned submission's `sign-failed`
   * several tens of seconds after the new transfer had already succeeded.
   *
   * Fix: every call to `set request` bumps this counter. Each async flow that can outlive a
   * newer request (`startQuote`, `confirmAndSign`, `afterStepSubmitted`) captures the generation it
   * started with and passes it to `setPhaseIfCurrent`, which is a silent no-op once a newer
   * generation exists — the stale chain's result is simply discarded rather than surfacing an error
   * (or a stale success) for a transfer the widget/caller has already moved on from.
   */
  #requestGeneration = 0;
  #inboundStatus:
    { readonly status: string; readonly destinationTxHash?: string | null } | undefined;
  #walletError: string | undefined;
  /** Real result of the one, final-step registerOutboundTransfer call for the CURRENTLY rendered
   *  transfer — see outboundDeliveryCaveat's own doc comment for why this exists (a real, live 401
   *  used to render as if registration had succeeded). Set once, right after that call resolves, in
   *  afterStepSubmitted; read by render()'s own "verified" case below. */
  #outboundRegistrationResult: RegisterOutboundTransferResult | undefined;

  /**
   * Test-only injection seams. Component tests set these to a fixture-backed `WidgetClient` /
   * `WalletSession` (the same real `Ferryline` + adapter classes the SDK's own tests use, wired
   * against a fake RPC — see index.test.ts) instead of `createWidgetClient`'s real network calls
   * or `RealWalletSession`'s real browser-extension calls. Left undefined in real usage, where
   * `client()`/`wallet()` fall through to the real constructors below.
   */
  testClientOverride: WidgetClient | undefined;
  testWalletOverride: WalletSession | undefined;
  /**
   * Test-only override for `POST_APPROVE_BUILD_DELAY_MS` (see that constant's own doc comment for
   * why the real delay exists). NOT a real, documented widget config option — deliberately not
   * exposed as an attribute/property in the public docs, since the real 3-second default is an
   * internal mitigation for observed RPC timing behavior, not something an integrator should be
   * expected to tune. Exists purely so index.test.ts can prove the delay is genuinely applied
   * without a real multi-second wait per test run. `undefined` (the real, shipped default) means
   * "use the real constant" — see `afterStepSubmitted`'s own use of this field below.
   */
  testPostApproveBuildDelayMsOverride: number | undefined;

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
    // Bump BEFORE starting the new chain (if any): startQuote below captures this new value as its
    // own generation, and any PREVIOUS chain still in flight now has a stale, already-superseded
    // generation number baked into its own closure — see #requestGeneration's own doc comment.
    this.#requestGeneration += 1;
    if (value) {
      void this.startQuote(value, this.#requestGeneration);
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
    // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
    console.log(`[ferryline-widget] phase -> ${phase.kind}`, phase);
    this.#phase = phase;
    this.render();
  }

  /**
   * Same as `setPhase`, but for an async flow's own continuation after an `await` — silently drops
   * the update if `generation` is no longer the current `#requestGeneration` (a newer `request` has
   * been set since this flow started, so this result belongs to a transfer the widget has already
   * moved on from). See `#requestGeneration`'s own doc comment for the real race this defends
   * against. Never used for a phase transition triggered synchronously by the current user action
   * (a button click, `cancelPreview`, ...) — those are always for the current generation by
   * construction, since the button that triggered them is only rendered for the current phase.
   */
  private setPhaseIfCurrent(phase: WidgetPhase, generation: number): void {
    if (generation !== this.#requestGeneration) {
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log(
        `[ferryline-widget] DROPPED stale phase -> ${phase.kind} (generation ${String(generation)}, current is ${String(this.#requestGeneration)})`,
        phase,
      );
      return;
    }
    this.setPhase(phase);
  }

  // ---- Quote / build (STEP 2A) ----------------------------------------------------------------

  private async startQuote(request: TransferRequest, generation: number): Promise<void> {
    // Synchronous, so always current by construction (called directly from `set request`, which
    // just bumped the generation to this same value) — setPhase, not setPhaseIfCurrent, is correct
    // here and is what makes the FIRST render of "quoting" actually show up.
    this.setPhase(startQuoting());
    try {
      const quote = await this.client().ferryline.quote(request);
      this.setPhaseIfCurrent(quoteSucceeded(quote), generation);
    } catch (error) {
      this.setPhaseIfCurrent(quoteFailed(message(error)), generation);
    }
  }

  private async build(): Promise<void> {
    if (this.#phase.kind !== "quoted") {
      return;
    }
    const { quote } = this.#phase;
    const generation = this.#requestGeneration;
    this.setPhase(startBuilding(quote));
    try {
      const built = await this.client().ferryline.build(quote);
      this.setPhaseIfCurrent(buildSucceeded(quote, built, 0), generation);
    } catch (error) {
      this.setPhaseIfCurrent(buildFailed(quote, message(error)), generation);
    }
  }

  // ---- Wallet connect (STEP 2B) ----------------------------------------------------------------

  private async connectWallet(moduleId?: string): Promise<void> {
    // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
    console.log(`[ferryline-widget] connectWallet(${moduleId ?? "<default>"}) starting`);
    try {
      this.#connected = await this.wallet().connect(moduleId);
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log("[ferryline-widget] connectWallet succeeded", this.#connected);
      this.render();
    } catch (error) {
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log("[ferryline-widget] connectWallet FAILED", error);
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
    // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
    console.log("[ferryline-widget] confirmAndSign() called, current phase:", this.#phase.kind);
    if (this.#phase.kind !== "preview") {
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log(
        "[ferryline-widget] confirmAndSign() no-op: phase is not 'preview' (button should have been unclickable)",
      );
      return; // structurally unreachable via the UI; defensive no-op if called out of order.
    }
    // Captured up front: this whole flow (through wallet signing, RPC submission, and the retry/
    // recheck fix's own up-to-~2-minute worst case) can outlive a newer `request` being set — see
    // #requestGeneration's own doc comment. Every setPhase call below that follows an `await` uses
    // setPhaseIfCurrent(..., generation) instead of setPhase so a stale result is dropped, not
    // surfaced.
    const generation = this.#requestGeneration;
    const signingPhase = confirmPreviewAndSign(this.#phase);
    this.setPhase(signingPhase);
    if (signingPhase.kind !== "signing") {
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log(
        "[ferryline-widget] confirmAndSign() no-op: confirmPreviewAndSign did not produce a signing phase",
        signingPhase,
      );
      return;
    }
    const { quote, built, stepIndex } = signingPhase;
    const step = built.steps[stepIndex];
    if (!step) {
      this.setPhaseIfCurrent(
        signFailed({ quote, built }, `no step at index ${String(stepIndex)}`),
        generation,
      );
      return;
    }
    try {
      if (step.kind === "stellar-transaction") {
        const client = this.client();
        // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
        console.log(
          `[ferryline-widget] step ${String(stepIndex)}: requesting wallet signature (this is what shows the Freighter popup)`,
        );
        const signedXdr = await this.wallet().signTransaction(step.xdr, client.networkPassphrase);
        // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
        console.log(`[ferryline-widget] step ${String(stepIndex)}: wallet signature received`);
        // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
        console.log(
          `[ferryline-widget] step ${String(stepIndex)}: submitting signed transaction to Stellar RPC`,
        );
        const sourceTxHash = await client.submitStellarTransaction(signedXdr);
        // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
        console.log(
          `[ferryline-widget] step ${String(stepIndex)}: submitStellarTransaction resolved, hash =`,
          sourceTxHash,
        );
        await client.ferryline.markSubmitted(built.transferId, sourceTxHash);
        // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
        console.log(`[ferryline-widget] step ${String(stepIndex)}: markSubmitted done`);
        await this.afterStepSubmitted(quote, built, stepIndex, generation);
        // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
        console.log(`[ferryline-widget] step ${String(stepIndex)}: afterStepSubmitted done`);
      } else if (step.kind === "evm-transaction") {
        throw new Error(
          "EVM-side signing (inbound builds) is driven by the sending chain's own wallet, outside this widget's Stellar-wallet session — see relayer.ts's registerTransfer for the inbound flow this widget drives after that external signature.",
        );
      } else {
        throw new Error(`cannot sign a deferred step directly at index ${String(stepIndex)}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console -- temporary diagnostic logging, see PR description
      console.log(`[ferryline-widget] step ${String(stepIndex)}: FAILED`, error);
      this.setPhaseIfCurrent(signFailed({ quote, built }, message(error)), generation);
    }
  }

  private cancelPreview(): void {
    this.setPhase(resetPhase());
  }

  /** After a step is signed and its tx hash recorded: advance to the next step, or start tracking.
   *  `generation` is the caller's own (confirmAndSign's) captured generation — threaded through
   *  rather than re-read here, since re-reading `this.#requestGeneration` at this point would
   *  always appear "current" even when it isn't (it's the same field a newer `request` bumps). */
  private async afterStepSubmitted(
    quote: Quote,
    built: BuiltTransfer,
    stepIndex: number,
    generation: number,
  ): Promise<void> {
    if (!isFinalStep(built, stepIndex)) {
      const nextIndex = stepIndex + 1;
      this.setPhaseIfCurrent(
        signedAwaitingNextStep({ quote, built, stepIndex: nextIndex }),
        generation,
      );
      // Real, empirically observed pattern (not an officially documented Soroban RPC behavior —
      // see POST_APPROVE_BUILD_DELAY_MS's own doc comment for the full honesty caveat): pause here,
      // between the just-confirmed step's on-chain landing and building/submitting the very next
      // step, specifically because this exact back-to-back-submission shape is what every real
      // tx_bad_seq rejection observed during this widget's own testnet testing had in common.
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          this.testPostApproveBuildDelayMsOverride ?? POST_APPROVE_BUILD_DELAY_MS,
        ),
      );
      const nextStep = await this.client().ferryline.prepareStep(built.transferId, nextIndex);
      const rebuilt = {
        ...built,
        steps: built.steps.map((s, i) => (i === nextIndex ? nextStep : s)),
      };
      this.setPhaseIfCurrent(buildSucceeded(quote, rebuilt, nextIndex), generation);
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
    // registerOutboundTransfer itself never throws and gates itself off entirely for
    // inbound/non-CCTP transfers and when no relayer is configured — see its own doc comment. It
    // DOES, though, now return its real outcome (see RegisterOutboundTransferResult in
    // @ferryline/sdk) instead of void — captured below so render()'s own "verified" case can show
    // an honest message instead of assuming success (a real, live 401 from a misconfigured relayer
    // API key used to render as "registered with the configured relayer" regardless).
    //
    // Registration itself is NOT skipped for a stale generation (an abandoned transfer may already
    // be genuinely submitted on-chain and still deserves real relayer registration/tracking even if
    // the widget's own UI has moved on) — only this instance's OWN rendered phase is guarded below.
    const registrationResult = await this.client().ferryline.registerOutboundTransfer(
      built.transferId,
    );
    if (generation === this.#requestGeneration) {
      // Same staleness guard as setPhaseIfCurrent's own — a stale generation's real registration
      // result must not overwrite the field render() reads for whatever transfer is CURRENT now.
      this.#outboundRegistrationResult = registrationResult;
    }
    // Seed a "tracking" phase immediately, before the first real status arrives — track()'s first
    // yield can lag by however long the RPC/Horizon round-trip takes, and without this the UI would
    // otherwise show nothing between "wallet accepted the signature" and that first real update.
    this.setPhaseIfCurrent(
      startTracking(quote, built, {
        transferId: built.transferId,
        stage: "submitted",
        updatedAt: Date.now(),
      }),
      generation,
    );
    if (generation !== this.#requestGeneration) {
      // A newer transfer is now live and already has its own #abort/track() loop (or none yet) —
      // starting this stale transfer's tracking loop would stomp that one's #abort field. The stale
      // transfer's real on-chain progress is unaffected (registerOutboundTransfer above already ran
      // for real); only this instance's own polling loop for it is skipped.
      return;
    }
    this.#abort = new AbortController();
    for await (const status of this.client().ferryline.track(
      built.transferId,
      this.#abort.signal,
    )) {
      this.setPhaseIfCurrent(trackingUpdated({ quote, built }, status), generation);
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
              ? `<div part="delivery-caveat" class="caveat">${outboundDeliveryCaveat(Boolean(this.relayerUrl), this.#outboundRegistrationResult)}</div>`
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
