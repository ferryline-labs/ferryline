import { amount, InMemoryTransferStore, newTransferId } from "@ferryline/core";
import type {
  BuiltTransfer,
  Quote,
  RailAdapter,
  TransferId,
  TransferRequest,
  TransferStage,
  TransferStatus,
  TransferStep,
} from "@ferryline/sdk";
import { Account, BASE_FEE, Contract, Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";

import { FerrylineWidget, STAGE_LABELS, WIDGET_TAG, defineFerrylineWidget } from "./index.js";
import type { WidgetClient } from "./client.js";
import type { ConnectedWallet, WalletSession } from "./wallet.js";
import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const SENDER = Keypair.random().publicKey();
const RECIPIENT_EVM = "0x7be6fa75805d77bc3fe8f004bbec49f7d4f1ac50";
const TOKEN_MESSENGER = "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP";

/** A real, minimal signable Stellar step — a genuine invoke-contract transaction, not placeholder XDR. */
function realStellarStep(description: string): TransferStep {
  const source = new Account(SENDER, "100");
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(TOKEN_MESSENGER).call("deposit_for_burn"))
    .setTimeout(300)
    .build();
  return { chain: "stellar", kind: "stellar-transaction", xdr: tx.toXDR(), description };
}

/**
 * A fake `RailAdapter` implementing the real interface with realistic, fixture-shaped values —
 * NOT a re-test of the SDK's own adapter internals (those are tested inside @ferryline/sdk itself;
 * see preview.test.ts's own doc comment for why duplicating that harness here would be a real DRY
 * violation). This exists to drive the WIDGET's own orchestration — state transitions, rendering,
 * the preview gate — which is this package's actual code under test.
 */
class FakeAdapter implements RailAdapter {
  readonly rail = "usdc-cctp" as const;
  readonly store = new InMemoryTransferStore();
  quoteError: string | undefined;
  statuses: TransferStatus[] = [];

  supports(): boolean {
    return true;
  }

  async quote(request: TransferRequest): Promise<Quote> {
    if (this.quoteError) {
      throw new Error(this.quoteError);
    }
    return {
      rail: "usdc-cctp",
      request,
      debit: amount(1_000_0000000n, 7),
      credit: amount(1_000_000000n, 6),
      dust: amount(0n, 7),
      fees: [{ label: "Circle CCTP fee", amount: amount(0n, 6), symbol: "USDC" }],
      etaSeconds: 20,
      checks: [],
      expiresAt: Date.now() + 30_000,
      refundAddress: request.from.address,
    };
  }

  async build(quote: Quote): Promise<BuiltTransfer> {
    const transferId = newTransferId();
    const built: BuiltTransfer = {
      transferId,
      rail: "usdc-cctp",
      steps: [realStellarStep("Burn USDC")],
    };
    await this.store.put({
      transferId,
      rail: "usdc-cctp",
      request: quote.request,
      createdAt: Date.now(),
    } as never);
    return built;
  }

  async *track(transferId: TransferId, _signal?: AbortSignal): AsyncIterable<TransferStatus> {
    for (const status of this.statuses) {
      yield { ...status, transferId };
    }
  }
}

function fakeModule(productId: string, productName: string): ModuleInterface {
  // A minimal but interface-complete fake: renderWalletModules only ever reads productId/productName,
  // but ModuleInterface is the kit's own real external type, so every required member gets a real,
  // if inert, implementation rather than an `as` cast past the type checker.
  return {
    moduleType: 0,
    productId,
    productName,
    productUrl: "https://example.invalid",
    productIcon: "",
    isAvailable: () => Promise.resolve(true),
    getAddress: () => Promise.resolve({ address: "GFAKE...WALLET" }),
    signTransaction: (xdr: string) => Promise.resolve({ signedTxXdr: xdr }),
    signAuthEntry: (entry: string) => Promise.resolve({ signedAuthEntry: entry }),
    signMessage: (message: string) => Promise.resolve({ signedMessage: message }),
  } as unknown as ModuleInterface;
}

class FakeWalletSession implements WalletSession {
  connected: ConnectedWallet = { address: "GFAKE...WALLET", moduleId: "freighter" };
  signedXdr: string | undefined;
  signError: string | undefined;
  connectError: string | undefined;

  async connect(): Promise<ConnectedWallet> {
    if (this.connectError) {
      throw new Error(this.connectError);
    }
    return this.connected;
  }

  async signTransaction(xdr: string): Promise<string> {
    if (this.signError) {
      throw new Error(this.signError);
    }
    this.signedXdr = xdr;
    return xdr; // a fake "signature": same envelope back, since submission is separately stubbed below.
  }

  async disconnect(): Promise<void> {
    /* no-op */
  }

  listModules(): readonly ModuleInterface[] {
    return [fakeModule("freighter", "Freighter"), fakeModule("xbull", "xBull")];
  }
}

function makeElement(): { el: FerrylineWidget; adapter: FakeAdapter; wallet: FakeWalletSession } {
  defineFerrylineWidget();
  const el = document.createElement(WIDGET_TAG) as FerrylineWidget;
  const adapter = new FakeAdapter();
  const client: WidgetClient = {
    ferryline: {
      config: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
      quote: (r: TransferRequest) => adapter.quote(r),
      build: (q: Quote) => adapter.build(q),
      markSubmitted: () => Promise.resolve(),
      // Real method under test at the widget's own call site (afterStepSubmitted) — see that
      // method's own doc comment for why it's called there and not from markSubmitted. This fixture
      // fake never actually calls a relayer; it exists so the widget's own real call to it
      // (unconditional on the final step, per the real bug fix) doesn't throw "not a function" and
      // silently abort the tracking flow the way it did before this fixture was updated.
      registerOutboundTransfer: () => Promise.resolve({ registered: true }),
      track: (id: TransferId, signal?: AbortSignal) => adapter.track(id, signal),
      prepareStep: () => {
        throw new Error("no deferred steps in this fixture");
      },
    } as never,
    availableRails: ["usdc-cctp"],
    networkPassphrase: NETWORK_PASSPHRASE,
    // A real, in-memory "submission": no network call, but genuinely exercises the real code path
    // that decodes/threads the signed XDR through — this is what index.test.ts's own suite is
    // meant to catch regressions in, not the real network round-trip (that's this phase's separate,
    // required real end-to-end run against a real testnet wallet — see e2e/).
    submitStellarTransaction: () => Promise.resolve("fake-source-tx-hash"),
  };
  const wallet = new FakeWalletSession();
  el.testClientOverride = client;
  el.testWalletOverride = wallet;
  document.body.append(el);
  return { el, adapter, wallet };
}

const REQUEST: TransferRequest = {
  asset: "USDC",
  from: { chain: "stellar", address: SENDER },
  to: { chain: "base", address: RECIPIENT_EVM },
  amount: "1000",
  parameters: { maxFee: "0", minFinalityThreshold: 2000 },
};

describe("ferryline-widget — registration and basic rendering", () => {
  it("registers once and tolerates repeat registration", () => {
    defineFerrylineWidget();
    defineFerrylineWidget();
    expect(customElements.get(WIDGET_TAG)).toBe(FerrylineWidget);
  });

  it("renders its network attribute into the shadow root", () => {
    defineFerrylineWidget();
    const element = document.createElement(WIDGET_TAG);
    element.setAttribute("network", "mainnet");
    document.body.append(element);
    expect(element.shadowRoot?.textContent).toContain("mainnet");
    element.setAttribute("network", "testnet");
    expect(element.shadowRoot?.textContent).toContain("testnet");
    element.remove();
  });

  it("has a label for every transfer stage", () => {
    const stages: TransferStage[] = ["created", "submitted", "verified", "delivered", "failed"];
    for (const stage of stages) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
    }
  });

  it("shows real testnet faucet links only in testnet mode", () => {
    defineFerrylineWidget();
    const testnetEl = document.createElement(WIDGET_TAG);
    testnetEl.setAttribute("network", "testnet");
    document.body.append(testnetEl);
    expect(testnetEl.shadowRoot?.querySelector('[part="faucets"]')).not.toBeNull();

    const mainnetEl = document.createElement(WIDGET_TAG);
    mainnetEl.setAttribute("network", "mainnet");
    document.body.append(mainnetEl);
    expect(mainnetEl.shadowRoot?.querySelector('[part="faucets"]')).toBeNull();

    testnetEl.remove();
    mainnetEl.remove();
  });
});

describe("ferryline-widget — quote and build flow (STEP 2A)", () => {
  it("goes idle -> quoting -> quoted, rendering debit/credit/eta from a real Quote shape", async () => {
    const { el } = makeElement();
    expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toContain("waiting");

    el.request = REQUEST;
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="quote"]')).not.toBeNull();
    });
    const quoteText = el.shadowRoot?.querySelector('[part="quote"]')?.textContent ?? "";
    expect(quoteText).toContain("1000.0000000");
    expect(quoteText).toContain("1000.000000");
    expect(quoteText).toContain("20s");
    el.remove();
  });

  it("renders quote-failed with the real error message when the adapter throws", async () => {
    const { el, adapter } = makeElement();
    adapter.quoteError = "no route for this asset pair";
    el.request = REQUEST;
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toContain(
        "Quote failed",
      );
    });
    expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toContain(
      "no route for this asset pair",
    );
    el.remove();
  });

  it("build-button click transitions quoted -> building -> preview, with a real decoded step", async () => {
    const { el } = makeElement();
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );

    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();

    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull();
    });
    const summary = el.shadowRoot?.querySelector('[part="preview-summary"]')?.textContent ?? "";
    expect(summary).toContain("USDC via CCTP");
    expect(summary).toContain("1000.0000000");
    const decoded = el.shadowRoot?.querySelector('[part="decoded-call"]')?.textContent ?? "";
    expect(decoded).toContain(TOKEN_MESSENGER);
    expect(decoded).toContain("deposit_for_burn");
    el.remove();
  });
});

describe("ferryline-widget — wallet connect (STEP 2B)", () => {
  it("lists the wallet session's real modules, and connecting enables the confirm button", async () => {
    const { el, wallet } = makeElement();
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());

    const moduleButtons =
      el.shadowRoot?.querySelectorAll<HTMLButtonElement>("[data-wallet-module]");
    expect(moduleButtons?.length).toBe(wallet.listModules().length);
    expect(el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled")).toBe(
      true,
    );

    moduleButtons?.[0]?.click();
    await vi.waitFor(() => {
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false);
    });
    el.remove();
  });

  it("a failed connection renders a real error that survives a later, unrelated re-render", async () => {
    // Regression guard: renderError/renderInboundStatus used to write directly into shadow DOM
    // nodes that render() then wholesale-replaces on every phase transition (setPhase rebuilds
    // innerHTML from scratch) — a real bug where a wallet error or inbound-status update could be
    // silently wiped by any concurrent re-render. Both are now tracked in instance state and read
    // by render() itself, so they survive exactly this scenario.
    const { el, wallet } = makeElement();
    wallet.connectError = "user rejected the connection request";
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());

    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="wallet-error"]')?.textContent).toContain(
        "user rejected the connection request",
      );
    });

    // An unrelated re-render (cancelling the preview) must not wipe the still-relevant error.
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="cancel-button"]')?.click();
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toContain("waiting");
    });
    expect(el.shadowRoot?.querySelector('[part="wallet-error"]')?.textContent).toContain(
      "user rejected the connection request",
    );
    el.remove();
  });
});

describe("ferryline-widget — preview cannot be bypassed (STEP 2C's one hard requirement)", () => {
  it("the confirm button, and only the confirm button, triggers signTransaction", async () => {
    const { el, wallet } = makeElement();
    const signSpy = vi.spyOn(wallet, "signTransaction");
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());

    // No signing call has happened yet — reaching "preview" never calls the wallet.
    expect(signSpy).not.toHaveBeenCalled();

    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );

    // Cancelling never signs either.
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="cancel-button"]')?.click();
    expect(signSpy).not.toHaveBeenCalled();
    expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toContain("waiting");
    el.remove();
  });

  it("clicking confirm does call signTransaction with the real previewed XDR, exactly once", async () => {
    const { el, wallet, adapter } = makeElement();
    adapter.statuses = [
      { transferId: "" as TransferId, stage: "submitted", updatedAt: Date.now() },
      {
        transferId: "" as TransferId,
        stage: "delivered",
        updatedAt: Date.now(),
        destinationTxHash: "0xdeadbeef",
      },
    ];
    const signSpy = vi.spyOn(wallet, "signTransaction");
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );

    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

    await vi.waitFor(() => {
      expect(signSpy).toHaveBeenCalledTimes(1);
    });
    el.remove();
  });
});

describe("ferryline-widget — outbound CCTP delivery caveat (STEP 3 finding)", () => {
  // Real, sourced finding (see technical-doc.md's threat-model table): Circle's own CCTP technical
  // guide states the API consumer/integrator must submit receiveMessage on the destination chain —
  // with no testnet/mainnet distinction anywhere in that document, and no mention of Circle
  // operating a relayer. Confirmed directly on testnet: a real, fully attested burn sat undelivered
  // for ~46 minutes with no automatic relay. This test guards the widget's own honest disclosure of
  // that gap, not the gap itself (which lives in Circle's infrastructure, outside this repo).

  it("shows the delivery caveat once verified, for an outbound CCTP transfer", async () => {
    const { el, adapter } = makeElement();
    adapter.statuses = [{ transferId: "" as TransferId, stage: "verified", updatedAt: Date.now() }];
    el.request = REQUEST; // REQUEST's from.chain is "stellar" — this IS the outbound CCTP case.
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="delivery-caveat"]')).not.toBeNull();
    });
    const caveatText = el.shadowRoot?.querySelector('[part="delivery-caveat"]')?.textContent ?? "";
    expect(caveatText).toContain("not automatic for this rail");
    expect(caveatText).toContain("submit the attested");
    el.remove();
  });

  it(
    "shows the RELAYER-CONFIGURED caveat variant when a relayer-url attribute is set — never " +
      "overclaiming a guaranteed delivery-time SLA even then",
    async () => {
      const { el, adapter } = makeElement();
      el.setAttribute("relayer-url", "http://localhost:8080"); // real attribute, real getter — see index.ts's relayerUrl
      adapter.statuses = [
        { transferId: "" as TransferId, stage: "verified", updatedAt: Date.now() },
      ];
      el.request = REQUEST;
      await vi.waitFor(() =>
        expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
      );
      el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
      await vi.waitFor(() =>
        expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull(),
      );
      el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
      await vi.waitFor(() =>
        expect(
          el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
        ).toBe(false),
      );
      el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

      await vi.waitFor(() => {
        expect(el.shadowRoot?.querySelector('[part="delivery-caveat"]')).not.toBeNull();
      });
      const caveatText =
        el.shadowRoot?.querySelector('[part="delivery-caveat"]')?.textContent ?? "";
      // Says a relayer is registered/handling it...
      expect(caveatText).toContain("registered with the configured relayer");
      // ...but STILL never claims this is a guaranteed SLA — the same honesty standard as the
      // no-relayer variant, per OUTBOUND_SCOPE.md's own "not a guaranteed delivery-time SLA" section.
      expect(caveatText).toContain("not a guaranteed delivery-time");
      expect(caveatText).toContain("permissionless");
      el.remove();
    },
  );

  it(
    "shows an HONEST FAILURE caveat when relayer registration genuinely fails (the real 401 " +
      "regression this test reproduces: a live, misconfigured relayer API key used to still " +
      "render the SUCCESS text)",
    async () => {
      const { el, adapter } = makeElement();
      el.setAttribute("relayer-url", "http://localhost:8080");
      adapter.statuses = [
        { transferId: "" as TransferId, stage: "verified", updatedAt: Date.now() },
      ];
      // Real reproduction of the exact scenario: registerOutboundTransfer was actually called (a
      // relayer IS configured) but the attempt genuinely failed — same shape a real 401 from an
      // invalid/revoked API key produces (see @ferryline/sdk's own registerOutboundTransfer, gate
      // 3: registered: false with a real error message, never thrown).
      const client: WidgetClient = {
        ferryline: {
          config: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
          quote: (r: TransferRequest) => adapter.quote(r),
          build: (q: Quote) => adapter.build(q),
          markSubmitted: () => Promise.resolve(),
          registerOutboundTransfer: () =>
            Promise.resolve({
              registered: false,
              error: "relayer registration failed: invalid or revoked API key",
            }),
          track: (id: TransferId, signal?: AbortSignal) => adapter.track(id, signal),
          prepareStep: () => {
            throw new Error("no deferred steps in this fixture");
          },
        } as never,
        availableRails: ["usdc-cctp"],
        networkPassphrase: NETWORK_PASSPHRASE,
        submitStellarTransaction: () => Promise.resolve("fake-source-tx-hash"),
      };
      el.testClientOverride = client;
      el.request = REQUEST;
      await vi.waitFor(() =>
        expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
      );
      el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
      await vi.waitFor(() =>
        expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull(),
      );
      el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
      await vi.waitFor(() =>
        expect(
          el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
        ).toBe(false),
      );
      el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

      await vi.waitFor(() => {
        expect(el.shadowRoot?.querySelector('[part="delivery-caveat"]')).not.toBeNull();
      });
      const caveatText =
        el.shadowRoot?.querySelector('[part="delivery-caveat"]')?.textContent ?? "";
      // The core assertion: the FAILURE message, never the success claim, for a registration that
      // genuinely failed.
      expect(caveatText).toContain("registration");
      expect(caveatText).toContain("failed");
      expect(caveatText).toContain("NOT currently registered");
      expect(caveatText).not.toContain("has been registered with the configured relayer");
      el.remove();
    },
  );

  it("does NOT show the caveat once actually delivered — it's specific to the 'verified' waiting stage", async () => {
    const { el, adapter } = makeElement();
    adapter.statuses = [
      { transferId: "" as TransferId, stage: "verified", updatedAt: Date.now() },
      {
        transferId: "" as TransferId,
        stage: "delivered",
        updatedAt: Date.now(),
        destinationTxHash: "0xreal",
      },
    ];
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="dest-tx"]')).not.toBeNull();
    });
    expect(el.shadowRoot?.querySelector('[part="delivery-caveat"]')).toBeNull();
    el.remove();
  });
});

describe("ferryline-widget — registerOutboundTransfer fires exactly once, on the real final step", () => {
  // REQUIRED test (per the outbound-auto-registration phase's own sign-off): reproduces the real,
  // shipped-and-fixed double-registration bug this widget already hit once. markSubmitted fires
  // once per signed step; registerOutboundTransfer used to be called from inside markSubmitted
  // itself, which meant a two-step outbound transfer (approve, then burn) registered TWICE — once
  // with the wrong (approve) tx hash, rejected by the relayer's own transferId-primary-key when
  // the correct (burn) registration arrived second. The fix moved the trigger to
  // afterStepSubmitted's own "no next step" branch (index.ts, isFinalStep(built, stepIndex) ===
  // true there by construction). This suite drives a REAL two-step transfer through the widget's
  // own real DOM-driven confirm flow (not a direct method call) — real signed XDR per step, real
  // click-driven state transitions between steps — and proves registration fires exactly once,
  // carrying the real burn hash, never the approve hash. Also covers the one-step (standing
  // allowance) case, so the fix doesn't accidentally suppress registration for the simpler,
  // far more common path.

  /** A two-step-capable fake RailAdapter: steps = [approve, burn] or steps = [burn], toggled by
   *  needsApprove — the same real shape usdc-cctp's own buildOutbound produces (approve only when
   *  the sender's existing allowance doesn't already cover the amount). Each step's XDR is a real,
   *  distinct, signable transaction (different contract function, different account sequence per
   *  TransactionBuilder call) — not two copies of the same placeholder — specifically so a fake
   *  "submit" can derive a genuinely different, real-shaped tx hash per step. */
  class TwoStepFakeAdapter implements RailAdapter {
    readonly rail = "usdc-cctp" as const;
    readonly store = new InMemoryTransferStore();
    needsApprove = false;
    /** Whatever markSubmitted (below) most recently recorded — mirrors the real
     *  usdc-cctp adapter's own track(), which reports the STORED sourceTxHash (last write wins),
     *  never a per-step value. This is exactly why the real double-registration bug mattered: the
     *  approve step's hash would otherwise get overwritten by the burn step's real hash here too,
     *  but registerOutboundTransfer itself — a SEPARATE call the relayer receives directly — used
     *  to fire once per step with whatever hash was current AT THAT MOMENT, not the final one. */
    lastSubmittedHash: string | undefined;

    supports(): boolean {
      return true;
    }

    markSubmitted(sourceTxHash: string): void {
      this.lastSubmittedHash = sourceTxHash;
    }

    async quote(request: TransferRequest): Promise<Quote> {
      return {
        rail: "usdc-cctp",
        request,
        debit: amount(1_000_0000000n, 7),
        credit: amount(1_000_000000n, 6),
        dust: amount(0n, 7),
        fees: [{ label: "Circle CCTP fee", amount: amount(0n, 6), symbol: "USDC" }],
        etaSeconds: 20,
        checks: [],
        expiresAt: Date.now() + 30_000,
        refundAddress: request.from.address,
      };
    }

    /** Keyed by transferId, so the fixture's own prepareStep (below) can hand back the real,
     *  already-built deferred step — matching a real adapter's own prepareStep contract: it
     *  builds/returns the ONE step at a known index; step COUNT is fixed at build() time and never
     *  changes (see @ferryline/sdk's isFinalStep doc comment). */
    private readonly builtSteps = new Map<string, readonly TransferStep[]>();

    async build(quote: Quote): Promise<BuiltTransfer> {
      const transferId = newTransferId();
      const steps: TransferStep[] = this.needsApprove
        ? [
            contractCallStep("approve", "Approve the TokenMessengerMinter to spend USDC"),
            contractCallStep("deposit_for_burn", "Burn USDC toward base via CCTP"),
          ]
        : [contractCallStep("deposit_for_burn", "Burn USDC toward base via CCTP")];
      this.builtSteps.set(transferId, steps);
      await this.store.put({
        transferId,
        rail: "usdc-cctp",
        request: quote.request,
        createdAt: Date.now(),
      } as never);
      return { transferId, rail: "usdc-cctp", steps };
    }

    prepareStep(transferId: TransferId, stepIndex: number): Promise<TransferStep> {
      const steps = this.builtSteps.get(transferId);
      const step = steps?.[stepIndex];
      if (!step) {
        throw new Error(`no step at index ${String(stepIndex)} for ${transferId}`);
      }
      return Promise.resolve(step);
    }

    async *track(transferId: TransferId, _signal?: AbortSignal): AsyncIterable<TransferStatus> {
      // Real behavior: track() is only ever consulted AFTER the final step's markSubmitted has
      // already run (afterStepSubmitted starts tracking only once isFinalStep is true), so
      // lastSubmittedHash here is always the real burn hash by construction — never the approve
      // hash, the same guarantee registerOutboundTransfer itself depends on. Two yields, matching
      // real adapters' own shape (a non-terminal status the UI renders as "tracking" — carrying
      // sourceTxHash, per index.ts's own `case "tracking"` render — followed by the terminal
      // "delivered" that moves the widget to "done"): a single "delivered"-only yield would skip
      // the "tracking" phase entirely and never render source-tx at all.
      yield {
        transferId,
        stage: "submitted",
        updatedAt: Date.now(),
        ...(this.lastSubmittedHash !== undefined ? { sourceTxHash: this.lastSubmittedHash } : {}),
      };
      yield {
        transferId,
        stage: "delivered",
        updatedAt: Date.now(),
        ...(this.lastSubmittedHash !== undefined ? { sourceTxHash: this.lastSubmittedHash } : {}),
        // A real, distinguishable destination hash — index.ts's own "done" render only shows
        // dest-tx when this is set, and that's the stable, real terminal-state signal this
        // fixture's own tests wait on (see the "two-step transfer" test's own note on why).
        destinationTxHash: "0xdest",
      };
    }
  }

  /** Narrows TransferStep to the one variant this fixture ever produces, so callers can read
   *  `.xdr` directly without re-narrowing the full union at every use site. */
  interface StellarTransactionStep {
    readonly chain: "stellar";
    readonly kind: "stellar-transaction";
    readonly xdr: string;
    readonly description: string;
  }

  /** Builds a real, distinct, signable Stellar invoke-contract transaction — the account's own
   *  sequence number advances with each TransactionBuilder call against the same Account instance
   *  (matching real Stellar SDK behavior), so two calls with different function names produce two
   *  genuinely different XDR strings, never two copies of the same one. */
  function contractCallStep(fn: string, description: string): StellarTransactionStep {
    const tx = new TransactionBuilder(twoStepSourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(TOKEN_MESSENGER).call(fn))
      .setTimeout(300)
      .build();
    return { chain: "stellar", kind: "stellar-transaction", xdr: tx.toXDR(), description };
  }

  let twoStepSourceAccount: Account;

  function makeTwoStepElement(): {
    el: FerrylineWidget;
    adapter: TwoStepFakeAdapter;
    registeredTransferIds: string[];
    registeredSourceTxHashes: Map<string, string>;
  } {
    twoStepSourceAccount = new Account(SENDER, "200");
    defineFerrylineWidget();
    const el = document.createElement(WIDGET_TAG) as FerrylineWidget;
    const adapter = new TwoStepFakeAdapter();
    const registeredTransferIds: string[] = [];
    const registeredSourceTxHashes = new Map<string, string>();
    const client: WidgetClient = {
      ferryline: {
        config: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
        quote: (r: TransferRequest) => adapter.quote(r),
        build: (q: Quote) => adapter.build(q),
        markSubmitted: (_transferId: TransferId, sourceTxHash: string) => {
          // Real widget behavior under test: markSubmitted fires on EVERY step. Delegates to the
          // adapter's own store (below), matching the real SDK — the LAST call's hash is what a
          // real track() call reports back (see TwoStepFakeAdapter.track's own doc comment).
          adapter.markSubmitted(sourceTxHash);
          return Promise.resolve();
        },
        registerOutboundTransfer: (transferId: TransferId) => {
          registeredTransferIds.push(transferId);
          // Captured independently of whatever track()/the DOM later reports, so the assertions
          // below can compare "what registerOutboundTransfer actually received" against "what was
          // submitted for the real final step" without relying on rendering timing at all.
          if (adapter.lastSubmittedHash !== undefined) {
            registeredSourceTxHashes.set(transferId, adapter.lastSubmittedHash);
          }
          return Promise.resolve({ registered: true });
        },
        track: (id: TransferId, signal?: AbortSignal) => adapter.track(id, signal),
        // Real deferred-step preparation: the SDK's own approve->burn flow defers the burn step
        // until the approve confirms. Delegates to the adapter's own prepareStep (above), which
        // hands back the already-built step at that index — matching a real adapter's own
        // contract (build the ONE step at a known index; step count never changes, see
        // @ferryline/sdk's isFinalStep doc comment).
        prepareStep: (transferId: TransferId, stepIndex: number) =>
          adapter.prepareStep(transferId, stepIndex),
      } as never,
      availableRails: ["usdc-cctp"],
      networkPassphrase: NETWORK_PASSPHRASE,
      submitStellarTransaction: (signedXdr: string) =>
        // A real, distinguishable, deterministic "hash" derived from the actual signed XDR content
        // — not a fixed stub — so a wrong-step registration (the real bug) would carry a
        // DIFFERENT, independently-derivable-as-wrong hash, not silently pass by coincidence.
        Promise.resolve(`0x${hashXdr(signedXdr)}`),
    };
    const wallet = new FakeWalletSession();
    el.testClientOverride = client;
    el.testWalletOverride = wallet;
    // This suite's own two-step transfers go through afterStepSubmitted's real deferred-step
    // branch, which now (see POST_APPROVE_BUILD_DELAY_MS in index.ts) waits a real, deliberate
    // delay between the approve confirming and the burn's preview re-appearing. The real,
    // production default (15s) would make every test here far exceed vi.waitFor's own timeout;
    // this override keeps the suite fast while still exercising the real await.
    el.testPostApproveBuildDelayMsOverride = 1;
    document.body.append(el);
    return { el, adapter, registeredTransferIds, registeredSourceTxHashes };
  }

  /** Deterministic, dependency-free string hash — good enough to prove "different input -> visibly
   *  different, reproducible output" for this test's own assertions; not a real cryptographic hash
   *  and not meant to be one. */
  function hashXdr(input: string): string {
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  it("two-step transfer (approve + burn): registerOutboundTransfer fires EXACTLY ONCE, carrying the real BURN hash, never the approve hash", async () => {
    const { el, adapter, registeredTransferIds, registeredSourceTxHashes } = makeTwoStepElement();
    adapter.needsApprove = true;
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );

    // Step 1: sign and submit the APPROVE. registerOutboundTransfer must NOT have fired yet — this
    // is the exact moment the real bug used to fire it, with the wrong hash. Waiting for the
    // widget to re-render a fresh, re-enabled preview for the deferred burn step is itself proof
    // afterStepSubmitted's "next step" branch ran (not the "final step" branch) — the real signal
    // this test needs, more robust than asserting on the transient "Preparing…" status text, which
    // afterStepSubmitted can resolve past before a poll observes it.
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();
    await vi.waitFor(() =>
      expect(
        adapter.lastSubmittedHash,
        "markSubmitted must fire for the approve step",
      ).toBeDefined(),
    );
    const approveHash = adapter.lastSubmittedHash;
    expect(registeredTransferIds).toHaveLength(0);

    // Step 2 (the real final step): the widget must re-render a fresh preview for the deferred
    // burn step, requiring a real second confirm click — not an automatic continuation.
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

    await vi.waitFor(() => expect(registeredTransferIds).toHaveLength(1));
    // Fires EXACTLY once — a second call (the real bug's own signature) never arrives, even after
    // tracking runs to completion and the UI settles on its real terminal state. The fixture's own
    // track() yields "submitted" then "delivered" with no real async delay between them (unlike a
    // real network round-trip), so a polling wait can observe the transient "tracking" render
    // (source-tx) landing and clearing in the same tick — asserting on the real terminal state
    // (dest-tx, below) is the stable, real signal to wait on instead.
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="dest-tx"]')).not.toBeNull();
    });
    expect(registeredTransferIds).toHaveLength(1);

    const [transferId] = registeredTransferIds;
    const registeredHash = transferId ? registeredSourceTxHashes.get(transferId) : undefined;
    expect(registeredHash).toBeDefined();
    expect(approveHash).toBeDefined();
    // The registered hash must be the real BURN step's hash (the final, real step) — and it must
    // NOT equal the approve step's own hash. Checked directly against the independently-captured
    // registration data (not the DOM — see the note above on why the transient tracking render
    // isn't a stable thing to assert on in this fixture).
    expect(registeredHash).not.toBe(approveHash);

    el.remove();
  });

  it("one-step transfer (standing allowance, no approve needed): still registers correctly, exactly once", async () => {
    const { el, adapter, registeredTransferIds, registeredSourceTxHashes } = makeTwoStepElement();
    adapter.needsApprove = false;
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

    await vi.waitFor(() => expect(registeredTransferIds).toHaveLength(1));
    // Real terminal state, not the transient tracking render — see the two-step test's own note.
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="dest-tx"]')).not.toBeNull();
    });
    expect(registeredTransferIds).toHaveLength(1);
    const [transferId] = registeredTransferIds;
    expect(transferId ? registeredSourceTxHashes.get(transferId) : undefined).toBeDefined();
    el.remove();
  });
});

describe("ferryline-widget — a stale, abandoned submission cannot clobber a newer transfer's phase", () => {
  /**
   * Real bug, found live during the submitStellarTransaction rejection-recheck fix's own real
   * testnet UI testing: `set request` starts a brand new quote/build/sign/submit chain with no
   * cancellation of whatever chain was already in flight. `submitStellarTransactionWithRejectionRecheck`
   * (client.ts) can legitimately take up to ~2 minutes across its bounded retries before settling —
   * long enough that a real user, seeing no progress feedback, gives up and sets a NEW `request`
   * while the OLD one is still awaiting that submission. When the old one finally settles (success
   * OR failure), its async continuation called `this.setPhase(...)` unconditionally, overwriting
   * whatever the NEW transfer's own, already-further-along phase was — confirmed for real: a
   * completed transfer's `tracking` phase was silently replaced by an old, abandoned submission's
   * `sign-failed`, tens of seconds after the new transfer had already succeeded.
   *
   * Fix under test: `#requestGeneration`, bumped on every `set request`, captured by each async flow
   * at entry, and checked by `setPhaseIfCurrent` before every post-`await` phase transition — a
   * stale flow's result is dropped rather than rendered.
   */
  it("an OLD submission that finally REJECTS after a NEWER request has already succeeded does not overwrite the current (successful) phase", async () => {
    const { el, adapter, wallet } = makeElement();
    adapter.statuses = [
      { transferId: "" as TransferId, stage: "submitted", updatedAt: Date.now() },
    ];
    // The OLD transfer's submitStellarTransaction call: deliberately never resolves until the test
    // explicitly settles it below, simulating the real ~2-minute worst case the fix's retry/recheck
    // window can legitimately take.
    let rejectOldSubmission!: (error: Error) => void;
    const oldSubmissionPromise = new Promise<string>((_resolve, reject) => {
      rejectOldSubmission = reject;
    });
    const client = el.testClientOverride!;
    client.submitStellarTransaction = () => oldSubmissionPromise;

    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();
    // Now genuinely stuck inside the OLD submission's still-pending promise, exactly like the real
    // bug: signing already happened, submission is in flight, nothing will move until the promise
    // above settles.
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toContain(
        "Waiting for your wallet",
      ),
    );

    // The user gives up on the stuck transfer and starts a NEW one — the real reproduction. This
    // NEW transfer's own submitStellarTransaction succeeds normally.
    client.submitStellarTransaction = () => Promise.resolve("new-transfer-real-tx-hash");
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

    // The NEW transfer completes for real, all the way to tracking.
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).not.toContain(
        "Waiting for your wallet",
      );
    });
    const statusAfterNewTransferSucceeded =
      el.shadowRoot?.querySelector('[part="status"]')?.textContent;
    expect(statusAfterNewTransferSucceeded).not.toContain("Signing failed");

    // NOW the OLD, abandoned submission's promise finally rejects — exactly like the real
    // tx_bad_seq-class rejection that took the fix's full bounded retry/recheck window to conclude,
    // long after the user had already moved on.
    rejectOldSubmission(new Error("submission rejected: ERROR (stale, abandoned transaction)"));
    // Give the rejected promise's .catch() handler a chance to run (and, if the bug were still
    // present, to call setPhase and clobber the current render).
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The widget's rendered phase must still reflect the NEW, successful transfer — the stale
    // rejection must never have reached the DOM as "Signing failed".
    expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).not.toContain(
      "Signing failed",
    );
    expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toBe(
      statusAfterNewTransferSucceeded,
    );
    expect(wallet.signedXdr).toBeDefined();
    el.remove();
  });

  it("an OLD submission that finally SUCCEEDS after a NEWER request is already in flight does not overwrite the newer transfer's phase either", async () => {
    const { el, adapter, wallet } = makeElement();
    adapter.statuses = [
      { transferId: "" as TransferId, stage: "submitted", updatedAt: Date.now() },
    ];
    let resolveOldSubmission!: (hash: string) => void;
    const oldSubmissionPromise = new Promise<string>((resolve) => {
      resolveOldSubmission = resolve;
    });
    const client = el.testClientOverride!;
    client.submitStellarTransaction = () => oldSubmissionPromise;

    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toContain(
        "Waiting for your wallet",
      ),
    );

    // A new request cancels-in-spirit the old one (the widget moves on to quoting/building fresh),
    // but does NOT actually cancel the old submission's in-flight promise — it's still out there.
    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    const statusAfterNewRequestReachedBuild =
      el.shadowRoot?.querySelector('[part="status"]')?.textContent;

    // The OLD submission finally resolves successfully (e.g. the false-rejection case the retry/
    // recheck fix defends against, resolved as a real success) — but it belongs to a transfer the
    // widget has already moved past.
    resolveOldSubmission("stale-old-transfer-tx-hash");
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The widget must still show the NEW transfer's own current phase (still at "quoted", since
    // the new one's own build button hasn't been clicked yet in this test) — not silently jump to
    // "tracking" for a transferId the current phase's `built` object doesn't even reference.
    expect(el.shadowRoot?.querySelector('[part="status"]')?.textContent).toBe(
      statusAfterNewRequestReachedBuild,
    );
    expect(el.shadowRoot?.querySelector('[part="tracking"]')).toBeNull();
    expect(wallet.signedXdr).toBeDefined();
    el.remove();
  });
});

describe("ferryline-widget — deliberate delay before building the step right after a confirmed Stellar step", () => {
  /**
   * Real, deliberate mitigation (see POST_APPROVE_BUILD_DELAY_MS's own doc comment in index.ts for
   * the full honesty caveat: an empirically observed pattern, not a documented Soroban RPC platform
   * behavior) for the real tx_bad_seq class of rejection this project's own real testnet E2E testing
   * hit repeatedly, every time on the SECOND of two Stellar transactions submitted back to back from
   * the same account (the outbound CCTP approve -> burn sequence). These tests use
   * `testPostApproveBuildDelayMsOverride` (test-only; the real, shipped default is
   * POST_APPROVE_BUILD_DELAY_MS = 3000) so the suite proves the delay is genuinely applied without
   * needing a real multi-second wait per run.
   */
  function twoStepBuiltFixture(): {
    readonly built: BuiltTransfer;
    readonly nextStep: TransferStep;
  } {
    const source = new Account(SENDER, "100");
    const approveTx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(TOKEN_MESSENGER).call("approve"))
      .setTimeout(300)
      .build();
    // A real, distinguishable second transaction — different contract function, and built against
    // the account's NEXT sequence number (source.sequenceNumber() auto-increments on .build()
    // above), the same way the real approve -> burn pair genuinely differs on-chain.
    const burnTx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(TOKEN_MESSENGER).call("deposit_for_burn"))
      .setTimeout(300)
      .build();
    const built: BuiltTransfer = {
      transferId: newTransferId(),
      rail: "usdc-cctp",
      steps: [
        {
          chain: "stellar",
          kind: "stellar-transaction",
          xdr: approveTx.toXDR(),
          description: "Approve",
        },
        {
          chain: "stellar",
          kind: "stellar-transaction-deferred",
          dependsOn: 0,
          description: "Burn (prepare after approve confirms)",
        },
      ],
    };
    const nextStep: TransferStep = {
      chain: "stellar",
      kind: "stellar-transaction",
      xdr: burnTx.toXDR(),
      description: "Burn",
    };
    return { built, nextStep };
  }

  it("a two-step transfer (approve -> burn) genuinely waits the full delay before prepareStep is called for the burn", async () => {
    const { el, adapter, wallet } = makeElement();
    const { built, nextStep } = twoStepBuiltFixture();
    adapter.statuses = [
      { transferId: "" as TransferId, stage: "submitted", updatedAt: Date.now() },
    ];
    let prepareStepCalled = false;
    let prepareStepCallTime: number | undefined;
    const client: WidgetClient = {
      ferryline: {
        config: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
        quote: (r: TransferRequest) => adapter.quote(r),
        build: () => Promise.resolve(built),
        markSubmitted: () => Promise.resolve(),
        registerOutboundTransfer: () => Promise.resolve({ registered: true }),
        track: (id: TransferId, signal?: AbortSignal) => adapter.track(id, signal),
        prepareStep: () => {
          prepareStepCalled = true;
          prepareStepCallTime = Date.now();
          return Promise.resolve(nextStep);
        },
      } as never,
      availableRails: ["usdc-cctp"],
      networkPassphrase: NETWORK_PASSPHRASE,
      submitStellarTransaction: () => Promise.resolve("fake-source-tx-hash"),
    };
    el.testClientOverride = client;
    // Deliberately large relative to this suite's own real overhead (state transitions, promise
    // microtasks — all comfortably sub-10ms in practice) so a mutation that removes the delay
    // entirely produces a clearly, reliably too-small elapsed time below, not a flaky near-miss.
    const DELAY_MS = 300;
    el.testPostApproveBuildDelayMsOverride = DELAY_MS;

    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    // Captured right at the click that starts the timed sequence (signing -> submit -> markSubmitted
    // -> the delay itself -> prepareStep) — NOT earlier, so this measures only the real work this
    // delay is gating, not the whole test's unrelated quote/build/wallet-connect setup time.
    const startTime = Date.now();
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

    await vi.waitFor(() => expect(prepareStepCalled).toBe(true));
    const elapsed = (prepareStepCallTime ?? 0) - startTime;
    // Genuinely waited at least the configured delay (not zero, not skipped) — a real elapsed-time
    // assertion, not just a call-order assertion, per the requirement that this be a genuine wait.
    // (Verified via a real mutation test: removing the delay entirely drops this well under 50ms,
    // comfortably below DELAY_MS, reliably failing this assertion — see the fix's own commit.)
    expect(elapsed).toBeGreaterThanOrEqual(DELAY_MS);

    // The transfer still completes correctly afterward — the delay doesn't break the flow, it only
    // postpones this one step.
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    expect(wallet.signedXdr).toBeDefined();
    el.remove();
  });

  it("a single-step transfer (no approve needed) is NOT delayed at all — the delay is scoped to the multi-step branch only", async () => {
    const { el, adapter, wallet } = makeElement();
    adapter.statuses = [
      { transferId: "" as TransferId, stage: "submitted", updatedAt: Date.now() },
      {
        transferId: "" as TransferId,
        stage: "delivered",
        updatedAt: Date.now(),
        destinationTxHash: "0xdeadbeef",
      },
    ];
    let prepareStepCalled = false;
    const client: WidgetClient = {
      ferryline: {
        config: { network: "testnet", rpcUrl: "https://soroban-testnet.stellar.org" },
        quote: (r: TransferRequest) => adapter.quote(r),
        build: (q: Quote) => adapter.build(q),
        markSubmitted: () => Promise.resolve(),
        registerOutboundTransfer: () => Promise.resolve({ registered: true }),
        track: (id: TransferId, signal?: AbortSignal) => adapter.track(id, signal),
        prepareStep: () => {
          prepareStepCalled = true;
          return Promise.reject(
            new Error("prepareStep must never be called for a single-step transfer"),
          );
        },
      } as never,
      availableRails: ["usdc-cctp"],
      networkPassphrase: NETWORK_PASSPHRASE,
      submitStellarTransaction: () => Promise.resolve("fake-source-tx-hash"),
    };
    el.testClientOverride = client;
    // Deliberately left as a large value: if the (single-step) code path incorrectly applied the
    // delay here, this test would time out and fail loudly rather than silently pass on a
    // coincidentally-fast run.
    el.testPostApproveBuildDelayMsOverride = 5000;
    const startTime = Date.now();

    el.request = REQUEST;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector('[part="build-button"]')).not.toBeNull(),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="build-button"]')?.click();
    await vi.waitFor(() => expect(el.shadowRoot?.querySelector('[part="preview"]')).not.toBeNull());
    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-wallet-module="freighter"]')?.click();
    await vi.waitFor(() =>
      expect(
        el.shadowRoot?.querySelector('[part="confirm-button"]')?.hasAttribute("disabled"),
      ).toBe(false),
    );
    el.shadowRoot?.querySelector<HTMLButtonElement>('[part="confirm-button"]')?.click();

    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector('[part="dest-tx"]')).not.toBeNull();
    });
    const elapsed = Date.now() - startTime;
    expect(prepareStepCalled).toBe(false);
    // Completed fast — nowhere near the 5s override, proving that override is never consulted on
    // this path at all (this is the USDT0 / single-step-CCTP shape: no deferred step exists).
    expect(elapsed).toBeLessThan(2000);
    expect(wallet.signedXdr).toBeDefined();
    el.remove();
  });
});
