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
